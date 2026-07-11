import type { ContentType, LanceStore, SearchResult, TotemConfig } from '@mmnto/totem';

import type { ExemptionShared } from '../exemptions/exemption-schema.js';
import { bold, errorColor, log, success as successColor } from '../ui.js';
import {
  applyCodeBlindGuard,
  formatLessonSection,
  formatResults,
  getSystemPrompt,
  loadConfig,
  loadEnv,
  partitionLessons,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  sanitize,
  wrapXml,
  writeOutput,
} from '../utils.js';
// totem-context: shield-templates is a pure constants + types + prompt-strings module with no runtime logic — static import is correct and the dynamic-imports-in-CLI lint rule is a false positive here
import {
  DISPLAY_TAG, // totem-context: pure constants module import
  MAX_CODE_RESULTS,
  MAX_DIFF_CHARS,
  MAX_FILE_CONTEXT_CHARS,
  MAX_FILE_LINES,
  MAX_LESSONS,
  MAX_SESSION_RESULTS,
  MAX_SPEC_RESULTS,
  QUERY_DIFF_TRUNCATE,
  SHIELD_LEARN_SYSTEM_PROMPT,
  type ShieldFinding,
  type ShieldStructuredVerdict,
  ShieldStructuredVerdictSchema,
  SPEC_SEARCH_POOL,
  STRUCTURAL_SYSTEM_PROMPT_V2,
  SYSTEM_PROMPT_V2,
  TAG,
  VERDICT_RE,
} from './shield-templates.js';

const INCREMENTAL_MAX_LINES = 15;

// Re-export constants & prompts so existing consumers are not broken
export {
  MAX_DIFF_CHARS,
  SHIELD_LEARN_SYSTEM_PROMPT,
  STRUCTURAL_SYSTEM_PROMPT,
} from './shield-templates.js';

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
  lessons: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [allSpecs, sessions, code] = await Promise.all([
    search('spec', SPEC_SEARCH_POOL),
    search('session_log', MAX_SESSION_RESULTS),
    search('code', MAX_CODE_RESULTS),
  ]);

  const { lessons, specs } = partitionLessons(allSpecs, MAX_LESSONS, MAX_SPEC_RESULTS);

  return { specs, sessions, code, lessons };
}

async function buildSearchQuery(changedFiles: string[], diff: string): Promise<string> {
  const path = await import('node:path');
  const fileNames = changedFiles.map((f) => path.basename(f)).join(' ');
  const diffSnippet = diff.slice(0, QUERY_DIFF_TRUNCATE);
  return `${fileNames} ${diffSnippet}`.trim();
}

// ─── File context for false-positive reduction ──────────

export async function buildFileContext(
  changedFiles: string[],
  cwd: string,
  maxLines: number,
  maxChars: number,
): Promise<string> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { classifyFile } = await import('./shield-classify.js');

  const entries: string[] = [];
  let totalChars = 0;

  for (const file of changedFiles) {
    if (totalChars >= maxChars) break;

    // Skip non-code files
    if (classifyFile(file) === 'NON_CODE') continue;

    const fullPath = path.join(cwd, file);

    // Skip deleted files
    if (!fs.existsSync(fullPath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    // Skip binary files (null byte check)
    if (content.includes('\0')) continue;

    // Skip large files
    const lines = content.split('\n');
    if (lines.length > maxLines) continue;

    const entry = `--- ${file} ---\n${content}`;
    if (totalChars + entry.length > maxChars) continue;

    entries.push(entry);
    totalChars += entry.length;
  }

  if (entries.length === 0) return '';
  return `\n=== FILE CONTEXT (unchanged code for reference) ===\n${entries.join('\n\n')}`;
}

// ─── Prompt assembly ────────────────────────────────────

export function assemblePrompt(
  diff: string,
  changedFiles: string[],
  context: RetrievedContext,
  systemPrompt: string,
  smartHints?: string[],
  fileContext?: string,
): string {
  const sections: string[] = [systemPrompt];

  // Diff section
  sections.push('=== DIFF ===');
  sections.push(`Changed files: ${changedFiles.join(', ')}`);
  sections.push('');
  if (diff.length > MAX_DIFF_CHARS) {
    sections.push(
      wrapXml(
        'git_diff',
        diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
      ),
    );
  } else {
    sections.push(wrapXml('git_diff', diff));
  }

  // File context — full source for small changed files
  if (fileContext) {
    sections.push(fileContext);
  }

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RELATED SPECS & ADRs');
  const sessionSection = formatResults(
    context.sessions,
    'LESSONS & SESSION HISTORY (ENFORCE AS CHECKLIST)',
  );
  const codeSection = formatResults(context.code, 'RELATED CODE PATTERNS');

  if (specSection || sessionSection || codeSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
    if (codeSection) sections.push(codeSection);
  }

  // Lessons — full bodies for strict enforcement
  const lessonSection = formatLessonSection(context.lessons);
  if (lessonSection) sections.push(lessonSection);

  // Smart review hints — auto-detected context to reduce false positives
  if (smartHints && smartHints.length > 0) {
    sections.push('\n=== SMART REVIEW HINTS ===');
    sections.push(
      'The following context was auto-detected from the diff. Apply these when reviewing:',
    );
    for (const hint of smartHints) {
      sections.push(`- ${hint}`);
    }
  }

  return sections.join('\n');
}

// ─── Structural prompt assembly ──────────────────────────

export function assembleStructuralPrompt(
  diff: string,
  changedFiles: string[],
  systemPrompt: string,
  smartHints?: string[],
  fileContext?: string,
): string {
  const sections: string[] = [systemPrompt];

  sections.push('=== DIFF ===');
  if (changedFiles.length > 0) {
    sections.push(`Changed files: ${changedFiles.join(', ')}`);
  }
  sections.push('');
  if (diff.length > MAX_DIFF_CHARS) {
    sections.push(
      wrapXml(
        'git_diff',
        diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
      ),
    );
  } else {
    sections.push(wrapXml('git_diff', diff));
  }

  // File context — full source for small changed files
  if (fileContext) {
    sections.push(fileContext);
  }

  // Smart review hints — auto-detected context to reduce false positives
  if (smartHints && smartHints.length > 0) {
    sections.push('\n=== SMART REVIEW HINTS ===');
    sections.push(
      'The following context was auto-detected from the diff. Apply these when reviewing:',
    );
    for (const hint of smartHints) {
      sections.push(`- ${hint}`);
    }
  }

  return sections.join('\n');
}

// ─── Verdict parsing ────────────────────────────────────

export function parseVerdict(content: string): { pass: boolean; reason: string } | null {
  const match = VERDICT_RE.exec(content);
  if (!match) return null;
  return { pass: match[1] === 'PASS', reason: match[2].trim() };
}

// ─── V2 Structured verdict parsing ───────────────────

/**
 * Three-layer JSON extraction from LLM plain-text response.
 * Layer 1: XML tags, Layer 2: markdown code fences, Layer 3: bare JSON.
 * Returns null if all layers fail (caller falls back to V1 regex parseVerdict).
 */
export function extractStructuredVerdict(content: string): ShieldStructuredVerdict | null {
  // Layer 1 — XML tags (primary)
  const xmlMatch = content.match(/<shield_verdict>([\s\S]*?)<\/shield_verdict>/);
  if (xmlMatch) {
    try {
      const parsed = JSON.parse(xmlMatch[1]!);
      const result = ShieldStructuredVerdictSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Move to next layer
    }
  }

  // Layer 2 — Markdown code fences (fallback)
  const fenceMatch = content.match(/(?:```|~~~)(?:json)?\s*\n([\s\S]*?)\n\s*(?:```|~~~)/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]!);
      const result = ShieldStructuredVerdictSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // Move to next layer
    }
  }

  // Layer 3 — Bare JSON (last resort, guarded by "findings" keyword)
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace && content.includes('"findings"')) {
    try {
      const parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));
      const result = ShieldStructuredVerdictSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // All layers exhausted
    }
  }

  return null;
}

/**
 * Deterministic pass/fail based on findings.
 * CRITICAL = fail, WARN/INFO = pass with advisory.
 */
export function computeVerdict(verdict: ShieldStructuredVerdict): {
  pass: boolean;
  reason: string;
} {
  const criticalCount = verdict.findings.filter((f) => f.severity === 'CRITICAL').length;
  const warnCount = verdict.findings.filter((f) => f.severity === 'WARN').length;
  const infoCount = verdict.findings.filter((f) => f.severity === 'INFO').length;

  const pass = criticalCount === 0;
  let reason: string;

  if (pass && warnCount === 0 && infoCount === 0) {
    reason = 'No issues found';
  } else if (pass) {
    const parts: string[] = [];
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
    if (infoCount > 0) parts.push(`${infoCount} info`);
    reason = `No critical issues (${parts.join(', ')})`;
  } else {
    const parts: string[] = [];
    parts.push(`${criticalCount} critical`);
    if (warnCount > 0) parts.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''}`);
    reason = `${parts.join(', ')} found`;
  }

  return { pass, reason };
}

/**
 * Human-readable output for stderr.
 * Groups findings by severity (CRITICAL → WARN → INFO) with colored header.
 */
export function formatVerdictForDisplay(verdict: ShieldStructuredVerdict, pass: boolean): string {
  const lines: string[] = [];

  // Header
  const verdictLabel = pass ? successColor(bold('PASS')) : errorColor(bold('FAIL'));
  lines.push(`Review — ${verdictLabel}`);
  lines.push('');

  // Summary
  lines.push(`Summary: ${verdict.summary}`);

  // Group findings by severity order
  const severityOrder: Array<'CRITICAL' | 'WARN' | 'INFO'> = ['CRITICAL', 'WARN', 'INFO'];
  const sorted = [...verdict.findings].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  if (sorted.length > 0) {
    lines.push('');
    for (const finding of sorted) {
      let location = '';
      if (finding.file) {
        location = finding.line ? `${finding.file}:${finding.line} ` : `${finding.file} `;
      }
      lines.push(`  ${finding.severity} [${finding.confidence}] ${location}— ${finding.message}`);
    }
  }

  // Reason line
  lines.push('');
  const { reason } = computeVerdict(verdict);
  lines.push(reason);

  return lines.join('\n');
}

/**
 * Historical hardcoded source extensions for the review content hash.
 * Kept as the fallback when a caller does not supply the config-driven set
 * (callers on the pre-#1527 signature) so behavior is preserved.
 */
const LEGACY_REVIEW_SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Refresh `<totemDir>/review-extensions.txt` if its contents do not match
 * the supplied extension set (or the file is missing). Closes the stale-
 * canonical-file window when a user edits `totem.config.ts` but forgets to
 * re-run `totem sync`. Best-effort; a write failure does not block the hash
 * computation. (#1527)
 */
function refreshReviewExtensionsFileIfStale(
  totemDirAbs: string,
  extensions: readonly string[],
  fs: typeof import('node:fs'),
  path: typeof import('node:path'),
): void {
  const canonical = path.join(totemDirAbs, 'review-extensions.txt');
  const want = extensions.join('\n') + '\n';
  try {
    const current = fs.readFileSync(canonical, 'utf-8');
    if (current === want) return; // totem-context: intentional cleanup — missing file is expected on first run
  } catch {
    /* fall through to write */
  }
  try {
    if (!fs.existsSync(totemDirAbs)) fs.mkdirSync(totemDirAbs, { recursive: true });
    const tmp = canonical + '.tmp';
    fs.writeFileSync(tmp, want, 'utf-8');
    fs.renameSync(tmp, canonical); // totem-context: intentional cleanup — canonical file is a hook convenience; write failure is TOTEM_DEBUG-only per #1527 spec
  } catch (err) {
    if (process.env['TOTEM_DEBUG'] === '1') {
      console.error(
        '[Totem Error] Review: failed to refresh review-extensions.txt:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Pure content-hash computation for the reviewed-source flag (Prop 304 R2,
 * codex fold 1). Hashes all tracked source-file objects whose extension is in
 * `extensions` — the extension-scoped tracked-source content hash that
 * authorizes an agent push. NO writes: neither the cache flag nor the
 * canonical `review-extensions.txt` refresh happen here, so a caller can
 * compute the hash BEFORE invoking the reviewer and stamp it only if the tree
 * is unchanged afterward — closing the mid-run authorization race.
 *
 * This is a DIFFERENT hash domain from `diffScope.diffHash` (the masked
 * review-payload identity); the two bind different state and are never equal.
 *
 * Returns the hex sha256, or `null` when there are no tracked source files (or
 * the git plumbing is unavailable — the flag is a best-effort hook
 * convenience, so failures are swallowed rather than thrown).
 *
 * The `extensions` parameter drives which file types are hashed. Defaults to
 * the historical hardcoded set for backward compatibility with callers that
 * predate #1527. The set must be pre-validated (see
 * `ReviewSourceExtensionSchema` in core); values are passed as `git ls-files`
 * glob arguments via safeExec and the regex refinement is the shell-injection
 * boundary.
 */
export async function computeReviewedContentHash(
  cwd: string,
  configRoot?: string,
  extensions: readonly string[] = LEGACY_REVIEW_SOURCE_EXTENSIONS,
): Promise<string | null> {
  try {
    const { safeExec } = await import('@mmnto/totem');

    // Compute content hash: hash of all tracked source file objects
    const root = configRoot ?? cwd;

    const globArgs = extensions.map((e) => '*' + e);
    const files = safeExec('git', ['ls-files', '-z', ...globArgs], {
      cwd: root,
    });
    if (!files.trim()) return null; // No source files — nothing to stamp

    // Filter out deleted files (still in index but missing on disk)
    const deleted = new Set(
      safeExec('git', ['ls-files', '--deleted', '-z', ...globArgs], {
        cwd: root,
      })
        .split('\0')
        .filter(Boolean),
    );
    const existing = files.split('\0').filter((f) => f && !deleted.has(f));
    if (existing.length === 0) return null;

    const objectHashes = safeExec('git', ['hash-object', '--stdin-paths'], {
      cwd: root,
      input: existing.join('\n'),
    });

    const crypto = await import('node:crypto');
    // Ensure trailing newline to match bash pipeline output (sha256sum sees it)
    const normalizedHashes = objectHashes.endsWith('\n') ? objectHashes : objectHashes + '\n';
    return crypto.createHash('sha256').update(normalizedHashes).digest('hex'); // totem-context: intentional cleanup — best-effort hook-convenience hash; failure degrades to no-stamp (TOTEM_DEBUG-only log), pre-refactor behavior per #1527
  } catch (err) {
    // Non-fatal — flag is a convenience for PreToolUse hooks
    if (process.env['TOTEM_DEBUG'] === '1') {
      console.error(
        '[Review] Failed to compute .reviewed-content-hash:',
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
}

/**
 * Stamp `<totemDir>/cache/.reviewed-content-hash` with EXACTLY the supplied
 * hash — never recomputes (Prop 304 R2, codex fold 1). Also refreshes the
 * canonical `review-extensions.txt` so the bash pre-push hook keys off the
 * same extension set (#1527). Best-effort; a write failure is non-fatal (the
 * flag is a PreToolUse-hook convenience). The caller owns hash provenance:
 * pass the pre-fan hash so the stamp authorizes the exact tree that was
 * reviewed, not whatever the tree happens to be at stamp time.
 */
export async function writeReviewedContentHashValue(
  precomputedHash: string,
  cwd: string,
  totemDir: string,
  configRoot?: string,
  extensions: readonly string[] = LEGACY_REVIEW_SOURCE_EXTENSIONS,
): Promise<void> {
  try {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const root = configRoot ?? cwd;
    const totemDirAbs = path.join(root, totemDir);

    // Auto-refresh the canonical file if it drifted from the config's set.
    // Closes the stale-canonical-file window without requiring the user to
    // re-run `totem sync` after editing totem.config.ts. (#1527)
    refreshReviewExtensionsFileIfStale(totemDirAbs, extensions, fs, path);

    const cacheDir = path.join(totemDirAbs, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, '.reviewed-content-hash'), precomputedHash);
  } catch (err) {
    // Non-fatal — flag is a convenience for PreToolUse hooks
    if (process.env['TOTEM_DEBUG'] === '1') {
      console.error(
        '[Review] Failed to write .reviewed-content-hash:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Write the .reviewed-content-hash flag on PASS.
 * Uses a content hash of tracked source files (not Git SHA) so the flag
 * survives commits, amends, and rebases. Only breaks when source files change.
 *
 * Now a thin compose of the pure computer + explicit writer (Prop 304 R2): it
 * hashes the CURRENT tree and stamps it. Retained at its original signature
 * for the trivial fast-path stamps (no-changes / all-non-code / filtered-empty
 * — none of which open a mid-run LLM window) and `recordShieldOverride`, where
 * there is no drift race to guard. The LLM review path does NOT use this — it
 * captures the hash pre-fan and compare-and-stamps in `shieldCommand` /
 * `handleVerdictResult` so a mid-review edit can never be authorized.
 */
export async function writeReviewedContentHash(
  cwd: string,
  totemDir: string,
  configRoot?: string,
  extensions: readonly string[] = LEGACY_REVIEW_SOURCE_EXTENSIONS,
): Promise<void> {
  const hash = await computeReviewedContentHash(cwd, configRoot, extensions);
  if (hash === null) return;
  await writeReviewedContentHashValue(hash, cwd, totemDir, configRoot, extensions);
}

/**
 * Record a shield override: append the override event to the Trap Ledger
 * AND stamp the reviewed-content-hash so the push-gate hook unblocks.
 *
 * mmnto-ai/totem#1716: prior to this helper the override branch only wrote the ledger
 * entry; the missing stamp left the contributor stuck behind the push-gate
 * with a tribal-knowledge `git reset --soft HEAD~1 && totem review --staged`
 * workaround. Override is a legitimate completion path (with logged
 * justification) and must produce the same cache state as a passing review.
 */
export async function recordShieldOverride(params: {
  override: string;
  cwd: string;
  totemDir: string;
  configRoot?: string;
  sourceExtensions?: readonly string[];
}): Promise<void> {
  const path = await import('node:path');
  const { appendLedgerEvent } = await import('@mmnto/totem');
  const resolvedTotemDir = path.join(params.configRoot ?? params.cwd, params.totemDir);
  appendLedgerEvent(
    resolvedTotemDir,
    {
      timestamp: new Date().toISOString(),
      type: 'override',
      ruleId: 'shield-override',
      file: '(shield)',
      justification: params.override,
      source: 'shield',
    },
    (msg) => log.dim(DISPLAY_TAG, msg),
  );
  await writeReviewedContentHash(
    params.cwd,
    params.totemDir,
    params.configRoot,
    params.sourceExtensions,
  );
}

// ─── Main command ───────────────────────────────────────

export type ShieldFormat = 'text' | 'sarif' | 'json';

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  /** Explicit ref range for `git diff` (mmnto-ai/totem#1717). Bypasses implicit fallback chain. */
  diff?: string;
  /**
   * Force the branch-vs-base (push-gate) diff scope (mmnto-ai/totem#2091).
   * Mutually exclusive with `staged` and `diff`.
   */
  branch?: boolean;
  /**
   * Explicit base branch name for the forced branch-vs-base scope
   * (mmnto-ai/totem#2091). Implies `branch`; resolved via `getGitBranchDiff`'s
   * origin-preference logic (mmnto-ai/totem#2054).
   */
  base?: string;
  mode?: 'standard' | 'structural';
  learn?: boolean;
  yes?: boolean;
  override?: string;
  suppress?: string[];
  autoCapture?: boolean;
  /**
   * Pre-flight deterministic-rule estimator (mmnto-ai/totem#1714). When
   * true, `shieldCommand` short-circuits to `runEstimate` in
   * `shield-estimate.ts`: same diff-resolution chain as the LLM review
   * path, then `runCompiledRules` against `compiled-rules.json`, then
   * return — no orchestrator, no embedder, no LanceDB. Output is labeled
   * `[Estimate]` (`ESTIMATE_DISPLAY_TAG`) instead of `[Review]` so log
   * lines unmistakably read as a forecast. Mutually incompatible with
   * `--learn`, `--auto-capture`, `--override`, `--suppress`, `--fresh`,
   * `--mode`, and `--raw` — these only apply to the LLM path; combining
   * them throws `TotemConfigError CONFIG_INVALID`.
   */
  estimate?: boolean;
  /**
   * Pattern-history overlay opt-out (mmnto-ai/totem#1731). Default `true`
   * (enabled) when undefined; opt out via `--no-history`. Only effective
   * with `--estimate`; silently ignored on the LLM path. Commander
   * auto-inverts the negative flag, so the user-facing surface is
   * `--no-history` and this field receives `false` when the flag is set.
   */
  history?: boolean;
  /**
   * Explicit round-chain override for the multi-lane fan (Prop 304 R2,
   * mmnto-ai/totem#2106). A prior verdict's content hash: the next round links
   * to it (its round + 1). A lineage mismatch warns and proceeds (honoring the
   * explicit intent). Only meaningful when `review.lanes` is configured and the
   * fan path runs; ignored on the legacy single-lane path.
   */
  continues?: string;
}

// ─── Deterministic mode (delegates to shared engine) ─

// ─── Learn: extract lessons from failed verdict ─────

export async function learnFromVerdict(
  verdictContent: string,
  diff: string,
  options: ShieldOptions,
  config: TotemConfig,
  cwd: string,
  configRoot?: string,
): Promise<void> {
  const path = await import('node:path');
  const { appendLessons, flagSuspiciousLessons, parseLessons, selectLessons } =
    await import('./extract.js');

  log.info(DISPLAY_TAG, 'Extracting lessons from failed verdict...'); // totem-ignore: hardcoded string

  // Assemble extraction prompt: shield verdict + diff as context
  const systemPrompt = getSystemPrompt(
    'shield-learn',
    SHIELD_LEARN_SYSTEM_PROMPT,
    cwd,
    config.totemDir,
  );
  const sections = [
    systemPrompt,
    '=== SHIELD VERDICT (failed review) ===',
    wrapXml('shield_verdict', verdictContent),
    '',
    '=== DIFF UNDER REVIEW ===',
    wrapXml(
      'diff_under_review',
      diff.length > MAX_DIFF_CHARS
        ? diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`
        : diff,
    ),
  ];

  // Add existing lessons for dedup if embedding is available
  if (config.embedding) {
    try {
      const { createEmbedder, LanceStore: Store } = await import('@mmnto/totem');
      const embedder = createEmbedder(config.embedding);
      const store = new Store(path.join(cwd, config.lanceDir), embedder, {
        absolutePathRoot: cwd,
      });
      await store.connect();
      const existing = await store.search({
        query: 'lesson trap pattern decision',
        typeFilter: 'spec',
        maxResults: 10,
      });
      const lessonSection = formatResults(existing, 'EXISTING LESSONS (do NOT duplicate)');
      if (lessonSection) {
        sections.push('\n=== DEDUP CONTEXT ===');
        sections.push(lessonSection);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.dim(DISPLAY_TAG, `Could not query existing lessons for dedup (non-fatal): ${msg}`); // totem-ignore: msg from Error.message
    }
  }

  const prompt = sections.join('\n');
  log.dim(DISPLAY_TAG, `Learn prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    configRoot,
    temperature: 0,
  });
  if (content == null) return; // --raw mode

  const lessons = parseLessons(content);
  if (lessons.length === 0) {
    log.dim(DISPLAY_TAG, 'No systemic lessons extracted from verdict.'); // totem-ignore: hardcoded string
    return;
  }

  log.success(DISPLAY_TAG, `Extracted ${lessons.length} lesson(s) from verdict`); // totem-ignore: count only

  // Flag and select
  const flagged = flagSuspiciousLessons(lessons);

  // Display for review
  if (!options.yes) {
    console.error('');
    for (let i = 0; i < flagged.length; i++) {
      const lesson = flagged[i]!;
      const prefix = lesson.suspiciousFlags?.length ? `[!] ` : '';
      console.error(
        `  [${i + 1}] ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`,
      );
      console.error(`      ${sanitize(lesson.text).replace(/\n/g, '\n      ')}`);
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.error(`      [!] ${flag}`);
        }
      }
      console.error('');
    }
  }

  const selected = await selectLessons(flagged, {
    yes: options.yes,
    isTTY: !!process.stdin.isTTY,
  });

  if (selected.length === 0) {
    log.dim(DISPLAY_TAG, 'No lessons selected — nothing written.'); // totem-ignore: hardcoded string
    return;
  }

  // Sanitize and persist
  const sanitized = selected.map((l) => ({
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text), // totem-ignore: already sanitized
  }));

  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
  appendLessons(sanitized, lessonsDir);
  log.success(DISPLAY_TAG, `Appended ${sanitized.length} lesson(s) to ${config.totemDir}/lessons/`); // totem-ignore: count only

  // Incremental sync (non-fatal — lessons are already written to disk)
  try {
    log.info(DISPLAY_TAG, 'Running incremental sync...');
    const { runSync } = await import('@mmnto/totem');
    const syncResult = await runSync(config, {
      projectRoot: cwd,
      incremental: true,
      onProgress: (msg) => log.dim(DISPLAY_TAG, msg),
    });
    log.success(
      DISPLAY_TAG,
      `Sync complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(DISPLAY_TAG, `Sync failed (lessons saved but not yet indexed): ${msg}`); // totem-ignore: msg from Error.message
  }
}

// ─── Pipeline 5: observation auto-capture ──────────

/** @internal — exported for testing */
export async function captureObservationRules(
  findings: ShieldFinding[],
  cwd: string,
  config: TotemConfig,
  configRoot: string | undefined,
): Promise<void> {
  // Only process findings with file + line (others can't be captured)
  const locatable = findings.filter(
    (f): f is ShieldFinding & { file: string; line: number } => !!f.file && !!f.line,
  );
  if (locatable.length === 0) return;

  const fs = await import('node:fs');
  const path = await import('node:path');
  const {
    deduplicateObservations,
    generateObservationRule,
    generateOutputHash,
    loadCompiledRulesFile,
    readCompileManifest,
    saveCompiledRulesFile,
    writeCompileManifest,
  } = await import('@mmnto/totem');

  const candidates: import('@mmnto/totem').CompiledRule[] = [];
  for (const finding of locatable) {
    const fullPath = path.join(cwd, finding.file);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      if (process.env['TOTEM_DEBUG'] === '1') {
        log.dim(
          DISPLAY_TAG,
          `Skipped ${finding.file}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue; // Deleted or inaccessible file — skip
    }

    const rule = generateObservationRule({
      file: finding.file,
      line: finding.line,
      message: finding.message,
      fileContent: content,
    });
    if (rule) candidates.push(rule);
  }

  if (candidates.length === 0) return;

  const deduped = deduplicateObservations(candidates);

  // Merge into existing compiled rules, skipping duplicates by lessonHash
  const rulesPath = path.join(configRoot ?? cwd, config.totemDir, 'compiled-rules.json');
  try {
    const existing = loadCompiledRulesFile(rulesPath, (msg) => log.dim(DISPLAY_TAG, msg));
    const existingHashes = new Set(existing.rules.map((r) => r.lessonHash));

    const newRules = deduped.filter((r) => !existingHashes.has(r.lessonHash));
    if (newRules.length === 0) return;

    existing.rules.push(...newRules);
    saveCompiledRulesFile(rulesPath, existing);
    log.info(DISPLAY_TAG, `Pipeline 5: captured ${newRules.length} observation rule(s)`);

    // Re-hash the manifest so verify-manifest stays in sync (#1155)
    const resolvedTotemDir = path.join(configRoot ?? cwd, config.totemDir);
    const manifestPath = path.join(resolvedTotemDir, 'compile-manifest.json');
    try {
      const manifest = readCompileManifest(manifestPath);
      manifest.output_hash = generateOutputHash(rulesPath);
      writeCompileManifest(manifestPath, manifest);
    } catch {
      // Non-fatal — manifest may not exist yet (e.g. first run before compile)
    }
  } catch (err) {
    // Non-fatal — auto-capture should never crash the shield command
    if (process.env['TOTEM_DEBUG'] === '1') {
      log.dim(
        DISPLAY_TAG,
        `Pipeline 5 save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ─── Pure per-lane outcome (Prop 304 R2 fan seam) ───

/**
 * The pure result of reviewing one lane's raw model output: the extracted
 * verdict, the exemption-filtered findings, and conformance — no display,
 * cache, or throw side effects. This is the seam the multi-lane fan (a later
 * slice) calls once per lane.
 */
export interface LaneOutcome {
  /**
   * The extracted structured verdict, or `null` when the model output was not
   * extractable by the shared cascade (malformed / unstructured). The null is
   * a distinguishable abstention signal — never a throw — so a fan lane can
   * record it as `abstained` instead of aborting the whole run.
   */
  structuredVerdict: ShieldStructuredVerdict | null;
  /** Actionable findings after the exemption filter — drives pass/fail. */
  filteredFindings: ShieldFinding[];
  /**
   * Exempted findings, downgraded to INFO by the exemption filter. Surfaced so
   * the single-lane display can still show them; never counted toward pass.
   */
  exemptedFindings: ShieldFinding[];
  /** CRITICAL-free after exemptions ⇒ `true`. Also `false` for the null case. */
  pass: boolean;
}

/**
 * Pure per-lane outcome derivation (Prop 304 R2 — codex fold 3). Runs the
 * single shared `extractStructuredVerdict` cascade, applies the exemption
 * filter, and computes conformance, with NO display / cache / throw side
 * effects. Unextractable output surfaces as `structuredVerdict: null` (a
 * distinguishable abstention) rather than a throw, so a fan lane can record it
 * as `abstained`.
 *
 * `shared` exemptions are passed IN (not read from disk) to keep this
 * side-effect-free; the caller owns exemption I/O and any `--suppress`
 * mutation before invoking.
 */
export async function deriveLaneOutcome(
  content: string,
  shared: ExemptionShared,
): Promise<LaneOutcome> {
  const structuredVerdict = extractStructuredVerdict(content);
  if (!structuredVerdict) {
    return { structuredVerdict: null, filteredFindings: [], exemptedFindings: [], pass: false };
  }
  const { filterExemptedFindings } = await import('../exemptions/exemption-engine.js');
  const { filtered, exempted } = filterExemptedFindings(structuredVerdict.findings, shared);
  const { pass } = computeVerdict({ ...structuredVerdict, findings: filtered });
  return {
    structuredVerdict,
    filteredFindings: filtered,
    exemptedFindings: exempted,
    pass,
  };
}

/**
 * Two-hash-domains authorization fix (Prop 304 R2, codex fold 1). On a PASS,
 * re-hash the CURRENT tracked-source tree and compare to the `preFanContentHash`
 * captured before the reviewer ran. A mismatch means a mid-review edit landed:
 * the verdict is bound to a tree that no longer exists on disk, so refuse to
 * stamp — and say so loudly. On an unchanged tree, stamp EXACTLY the pre-fan
 * hash (never a recompute) via the explicit writer.
 *
 * A `null` pre-fan hash means there were no tracked source files (or git
 * plumbing was unavailable) before the fan; the legacy path wrote nothing in
 * that case either, so this is a no-op — preserving prior behavior.
 */
export async function stampReviewedContentHashIfTreeUnchanged(
  preFanContentHash: string | null,
  cwd: string,
  config: TotemConfig,
  configRoot: string | undefined,
): Promise<void> {
  if (preFanContentHash === null) return;

  const currentHash = await computeReviewedContentHash(
    cwd,
    configRoot,
    config.review.sourceExtensions,
  );
  if (currentHash !== preFanContentHash) {
    log.warn(
      DISPLAY_TAG,
      'WORKTREE DRIFT: tracked source files changed during review. The verdict is bound to the pre-review tree, so the reviewed-content-hash was NOT stamped — this review does not authorize a push. Re-run `totem review` against the current tree.',
    );
    return;
  }
  await writeReviewedContentHashValue(
    preFanContentHash,
    cwd,
    config.totemDir,
    configRoot,
    config.review.sourceExtensions,
  );
}

// ─── Shared verdict handler ─────────────────────────

async function handleVerdictResult(
  content: string,
  diff: string,
  options: ShieldOptions,
  config: TotemConfig,
  cwd: string,
  configRoot: string | undefined,
  modeLabel: string,
  preFanContentHash: string | null,
): Promise<void> {
  const { TotemError } = await import('@mmnto/totem');

  writeOutput(content, options.out);
  if (options.out) log.success(DISPLAY_TAG, `Written to ${options.out}`);

  if (options.raw) return;

  // ─── Exemption I/O + --suppress (side effects live in the shell) ──
  const pathMod = await import('node:path');
  const resolvedTotemDir = pathMod.join(configRoot ?? cwd, config.totemDir);
  const cacheDir = pathMod.join(resolvedTotemDir, 'cache');

  const { readSharedExemptions, writeSharedExemptions } =
    await import('../exemptions/exemption-store.js');
  const { addManualSuppression } = await import('../exemptions/exemption-engine.js');

  let shared = readSharedExemptions(resolvedTotemDir, (msg) => log.dim(DISPLAY_TAG, msg));

  // Apply manual --suppress flags
  if (options.suppress?.length) {
    const { appendLedgerEvent: appendExemptionEvent } = await import('@mmnto/totem');
    for (const label of options.suppress) {
      if (!label.trim()) continue;
      shared = addManualSuppression(shared, label, `Manual suppression via --suppress`);
      log.info(DISPLAY_TAG, `Suppression registered: ${label}`);
      appendExemptionEvent(
        resolvedTotemDir,
        {
          timestamp: new Date().toISOString(),
          type: 'exemption',
          ruleId: 'exemption-manual',
          file: '(shield)',
          justification: `--suppress ${label}`,
          source: 'shield',
        },
        (msg) => log.dim(DISPLAY_TAG, msg),
      );
    }
    writeSharedExemptions(resolvedTotemDir, shared, (msg) => log.dim(DISPLAY_TAG, msg));
  }

  // Pure lane derivation: extract → exemption filter → conformance.
  const outcome = await deriveLaneOutcome(content, shared);

  // Try structured parsing first (V2)
  if (outcome.structuredVerdict) {
    const structured = outcome.structuredVerdict;
    const filtered = outcome.filteredFindings;
    const exempted = outcome.exemptedFindings;

    if (exempted.length > 0) {
      log.dim(DISPLAY_TAG, `${exempted.length} finding(s) exempted by suppression rules`);
    }

    // Use filtered verdict for pass/fail, but show all findings in display
    const filteredVerdict = { ...structured, findings: [...filtered, ...exempted] };

    const display = formatVerdictForDisplay(filteredVerdict, outcome.pass);
    console.error(display);

    // ─── Pipeline 5: auto-capture observation rules ──
    if (options.autoCapture === true) {
      await captureObservationRules(filtered, cwd, config, configRoot);
    }

    if (outcome.pass) {
      await stampReviewedContentHashIfTreeUnchanged(preFanContentHash, cwd, config, configRoot);
    } else if (options.override) {
      const criticalFindings = filtered.filter((f) => f.severity === 'CRITICAL');

      log.warn(DISPLAY_TAG, `SHIELD OVERRIDE APPLIED: ${options.override}`);
      for (const finding of criticalFindings) {
        log.warn(DISPLAY_TAG, `  [overridden] ${finding.message}`);
      }

      await recordShieldOverride({
        override: options.override,
        cwd,
        totemDir: config.totemDir,
        configRoot,
        sourceExtensions: config.review.sourceExtensions,
      });

      // Track overridden findings for exemption engine (only non-exempted findings)
      const { readLocalExemptions, writeLocalExemptions } =
        await import('../exemptions/exemption-store.js');
      const { trackFalsePositives } = await import('../exemptions/exemption-engine.js');
      const { PROMOTION_THRESHOLD } = await import('../exemptions/exemption-schema.js');
      const { appendLedgerEvent } = await import('@mmnto/totem');

      const localExemptions = readLocalExemptions(cacheDir, (msg) => log.dim(DISPLAY_TAG, msg));
      const tracked = trackFalsePositives(criticalFindings, 'shield', localExemptions, shared);

      for (const msg of tracked.promoted) {
        log.warn(
          DISPLAY_TAG,
          `Pattern auto-suppressed after ${PROMOTION_THRESHOLD} overrides: ${msg}`,
        );
      }

      writeLocalExemptions(cacheDir, tracked.local, (msg) => log.dim(DISPLAY_TAG, msg));
      if (tracked.promoted.length > 0) {
        shared = tracked.shared;
        writeSharedExemptions(resolvedTotemDir, shared, (msg) => log.dim(DISPLAY_TAG, msg));
        appendLedgerEvent(
          resolvedTotemDir,
          {
            timestamp: new Date().toISOString(),
            type: 'exemption',
            ruleId: 'exemption-promoted',
            file: '(shield)',
            justification: `Auto-promoted after ${PROMOTION_THRESHOLD} overrides`,
            source: 'shield',
          },
          (msg) => log.dim(DISPLAY_TAG, msg),
        );
      }
    } else {
      if (options.learn || config.shieldAutoLearn) {
        await learnFromVerdict(
          JSON.stringify(structured, null, 2),
          diff,
          options,
          config,
          cwd,
          configRoot,
        );
      }
      // Recompute the reason string for the failure message (the pure lane
      // outcome carries `pass` but not the human reason).
      const { reason } = computeVerdict({ ...structured, findings: filtered });
      throw new TotemError(
        'SHIELD_FAILED',
        `Shield ${modeLabel} review failed: ${reason}`,
        'Fix the issues identified in the review above, then re-run `totem review`.',
      );
    }
    return;
  }

  // Fallback: V1 regex parsing (custom prompt overrides)
  const verdict = parseVerdict(content);
  if (verdict) {
    const verdictLabel = verdict.pass ? successColor(bold('PASS')) : errorColor(bold('FAIL'));
    const reason = verdict.reason ? ` — ${verdict.reason}` : '';
    // totem-context: reason is either empty string or pre-prefixed with ' — ', so direct concat is intentional
    log.info(DISPLAY_TAG, `Verdict: ${verdictLabel}${reason}`);
    if (verdict.pass) {
      await stampReviewedContentHashIfTreeUnchanged(preFanContentHash, cwd, config, configRoot);
    } else if (options.override) {
      log.warn(DISPLAY_TAG, `SHIELD OVERRIDE APPLIED: ${options.override}`);

      await recordShieldOverride({
        override: options.override,
        cwd,
        totemDir: config.totemDir,
        configRoot,
        sourceExtensions: config.review.sourceExtensions,
      });
    } else {
      if (options.learn || config.shieldAutoLearn)
        await learnFromVerdict(content, diff, options, config, cwd, configRoot);
      throw new TotemError(
        'SHIELD_FAILED',
        `Shield ${modeLabel} review failed: ${verdict.reason || 'no reason given'}`,
        'Fix the issues identified in the review above, then re-run `totem review`.',
      );
    }
  } else {
    throw new TotemError(
      'SHIELD_FAILED',
      'Verdict not found in LLM output (defaulting to FAIL).',
      'Fix LLM output format — expected structured JSON or VERDICT: PASS/FAIL.',
    );
  }
}

// ─── Incremental shield eligibility (#1010) ─────────

interface IncrementalResult {
  eligible: boolean;
  reason?: string;
  deltaDiff?: string;
  changedFiles?: string[];
  linesChanged?: number;
}

export async function evaluateIncrementalEligibility(
  cwd: string,
  totemDir: string,
  configRoot?: string,
): Promise<IncrementalResult> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { safeExec } = await import('@mmnto/totem');
  const { isAncestor, getShortstat, getNameStatus, getDiffBetween } = await import('../git.js');

  // 1. Read last passed SHA
  const flagPath = path.join(configRoot ?? cwd, totemDir, 'cache', '.shield-passed');
  let lastSha: string;
  try {
    lastSha = fs.readFileSync(flagPath, 'utf-8').trim();
  } catch {
    return { eligible: false, reason: 'No previous shield state' };
  }

  if (!lastSha || lastSha.length < 7) {
    return { eligible: false, reason: 'Invalid shield state' };
  }

  // 2. Check if already at same commit
  let head: string;
  try {
    head = safeExec('git', ['rev-parse', 'HEAD'], { cwd });
  } catch {
    return { eligible: false, reason: 'Cannot resolve HEAD' };
  }
  if (head === lastSha) {
    return { eligible: false, reason: 'Already at passed commit' };
  }

  // 3. Verify ancestry
  if (!isAncestor(cwd, lastSha)) {
    return { eligible: false, reason: 'Last passed commit is not an ancestor (rebase detected)' };
  }

  // 4. Check for new/deleted files
  const nameStatus = getNameStatus(cwd, lastSha);
  const hasNewOrDeleted = nameStatus.some((f) => f.status !== 'M');
  if (hasNewOrDeleted) {
    return { eligible: false, reason: 'Diff contains new or deleted files' };
  }

  // 5. Check line count
  const stats = getShortstat(cwd, lastSha);
  const totalLines = stats.insertions + stats.deletions;
  if (totalLines > INCREMENTAL_MAX_LINES) {
    return {
      eligible: false,
      reason: `Diff exceeds ${INCREMENTAL_MAX_LINES} lines (${totalLines})`,
    };
  }

  // 6. Get the delta diff
  const deltaDiff = getDiffBetween(cwd, lastSha);
  if (!deltaDiff.trim()) {
    return { eligible: false, reason: 'No diff content' };
  }

  const changedFiles = nameStatus.map((f) => f.file);

  return {
    eligible: true,
    deltaDiff,
    changedFiles,
    linesChanged: totalLines,
  };
}

// ─── Main command ───────────────────────────────────

export async function shieldCommand(options: ShieldOptions): Promise<void> {
  const path = await import('node:path');
  const { TotemConfigError, TotemError } = await import('@mmnto/totem');
  const { filterDiffByPatterns, getDiffForReview } = await import('../git.js');
  const { classifyChangedFiles } = await import('./shield-classify.js');
  const { extractShieldContextAnnotations, extractShieldHints } = await import('./shield-hints.js');

  // mmnto-ai/totem#1714: --estimate is the deterministic-rule pre-flight
  // path. Reject incompatible flag combinations BEFORE any other
  // validation (e.g. the --override length check below) so the user-
  // facing error names the actual conflict (`--override is incompatible
  // with --estimate`) instead of a misleading downstream constraint.
  if (options.estimate) {
    type IncompatibleFlag = readonly [keyof ShieldOptions, string];
    const incompatible: readonly IncompatibleFlag[] = [
      ['learn', '--learn'],
      ['autoCapture', '--auto-capture'],
      ['override', '--override'],
      ['suppress', '--suppress'],
      ['fresh', '--fresh'],
      ['mode', '--mode'],
      ['raw', '--raw'],
    ];
    for (const [key, flag] of incompatible) {
      const value = options[key];
      // totem-context: boolean OR in a presence-test, not a numeric-metric default — `??` would change "absent or explicitly-disabled" to "absent" and let `--fresh=false` slip through
      if (value === undefined || value === false) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      throw new TotemConfigError(
        `${flag} is incompatible with --estimate.`,
        'Drop the incompatible flag, or run without --estimate.',
        'CONFIG_INVALID',
      );
    }

    const cwd = process.cwd();
    const configPath = resolveConfigPath(cwd);
    const configRoot = path.dirname(configPath);
    loadEnv(cwd);
    const config = await loadConfig(configPath);
    // Engine boot (mmnto-ai/totem#1794) — see lint.ts wiring for context.
    const { bootstrapEngine } = await import('../utils/bootstrap-engine.js');
    await bootstrapEngine(config, configRoot);
    const { runEstimate } = await import('./shield-estimate.js');
    await runEstimate(options, config, cwd, configRoot);
    return;
  }

  if (options.mode && options.mode !== 'standard' && options.mode !== 'structural') {
    throw new TotemConfigError(
      `Invalid --mode "${options.mode}". Use "standard" or "structural".`,
      'Check `totem review --help` for valid options.',
      'CONFIG_INVALID',
    );
  }
  if (options.override !== undefined && options.override.length < 10) {
    throw new TotemConfigError(
      `--override reason must be at least 10 characters (got ${options.override.length}).`,
      'Provide a meaningful justification, e.g., --override "False positive: onWarn param visible at line 273"',
      'CONFIG_INVALID',
    );
  }
  const cwd = process.cwd();

  // Silently upgrade the pre-push hook if it lacks review auto-refresh (#1045)
  const { upgradePrePushHookIfNeeded } = await import('./install-hooks.js');
  if (upgradePrePushHookIfNeeded(cwd)) {
    log.dim(DISPLAY_TAG, 'Upgraded pre-push hook with review auto-refresh');
  }

  const configPath = resolveConfigPath(cwd);
  const configRoot = path.dirname(configPath);
  loadEnv(cwd);
  const config = await loadConfig(configPath);
  // Engine boot (mmnto-ai/totem#1794) — see lint.ts wiring for context.
  const { bootstrapEngine } = await import('../utils/bootstrap-engine.js');
  await bootstrapEngine(config, configRoot);

  // ── Multi-lane review fan activation (Prop 304 R2, mmnto-ai/totem#2106) ──
  // Validate `review.lanes` at review startup (a hard init error on any
  // violation) and normalize. An explicit `--model` selects a ONE-lane
  // invocation and never joins the configured fan (precedence pinned); the fan
  // also does not apply to structural mode (context-blind single-lane stays
  // legacy). `review.lanes` absent ⇒ [] ⇒ the legacy single-lane path runs
  // byte-for-byte as today (invariant 7).
  const { validateReviewLanes } = await import('./review-fan.js');
  const laneModels = validateReviewLanes(config.review.lanes, config.orchestrator?.provider);
  const fanActive =
    laneModels.length >= 1 && options.model === undefined && options.mode !== 'structural';

  // --- Incremental shield fast-path (#1010) ---
  // If the change since the last passed shield is small enough (< 15 lines,
  // no new files), only evaluate the delta instead of the full branch diff.
  // The fan needs full diff-scope metadata (source/base/head) for lineage, so
  // the incremental fast-path is bypassed when the fan is active.
  let diff: string;
  let changedFiles: string[];
  // Resolved diff-scope metadata (Prop 304 R2) — captured for the fan's verdict
  // `diffScope` + lineage. Only populated on the full-diff path (the fan bypasses
  // the incremental fast-path), so it is defined whenever `fanActive`.
  let diffScopeMeta:
    | {
        source: 'explicit-range' | 'staged' | 'uncommitted' | 'branch-vs-base';
        base?: string;
        head?: string;
      }
    | undefined;

  const incremental: IncrementalResult = fanActive
    ? { eligible: false, reason: 'multi-lane fan requires full diff scope' }
    : await evaluateIncrementalEligibility(cwd, config.totemDir, configRoot);
  if (incremental.eligible && incremental.deltaDiff && incremental.changedFiles) {
    log.info(
      DISPLAY_TAG,
      `Incremental review: ${incremental.linesChanged} line(s) since last pass`,
    );
    diff = incremental.deltaDiff;
    changedFiles = incremental.changedFiles;
  } else {
    if (incremental.reason && incremental.reason !== 'No previous shield state') {
      log.dim(DISPLAY_TAG, `Full review: ${incremental.reason}`);
    }
    // Get git diff — shared helper merges ignore patterns, tries staged/all
    // then falls back to branch diff, and extracts changed file paths.
    const diffResult = await getDiffForReview(options, config, cwd, DISPLAY_TAG);
    if (!diffResult) {
      // No changes = trivial pass — stamp content hash
      await writeReviewedContentHash(
        cwd,
        config.totemDir,
        configRoot,
        config.review.sourceExtensions,
      );
      return;
    }
    diff = diffResult.diff;
    changedFiles = diffResult.changedFiles;
    diffScopeMeta = { source: diffResult.source, base: diffResult.base, head: diffResult.head };
  }

  // Stage 1: Classify files — fast-path for non-code-only diffs
  const classification = classifyChangedFiles(changedFiles);
  if (classification.allNonCode) {
    log.info(DISPLAY_TAG, 'Deterministic fast-path: all changed files are non-code');
    log.dim(DISPLAY_TAG, `Skipped: ${changedFiles.join(', ')}`);
    await writeReviewedContentHash(
      cwd,
      config.totemDir,
      configRoot,
      config.review.sourceExtensions,
    );
    return;
  }

  // Stage 2: Filter diff to code-only files for mixed diffs
  let filteredDiff = diff;
  let filteredFiles = changedFiles;
  if (!classification.allCode && classification.nonCodeFiles.length > 0) {
    filteredDiff = await filterDiffByPatterns(diff, classification.nonCodeFiles);
    filteredFiles = classification.codeFiles;
    if (!filteredDiff.trim()) {
      // After filtering, no code diff remains — fast-path PASS
      log.info(
        DISPLAY_TAG,
        'Deterministic fast-path: no code changes after filtering non-code files',
      );
      await writeReviewedContentHash(
        cwd,
        config.totemDir,
        configRoot,
        config.review.sourceExtensions,
      );
      return;
    }
    log.dim(
      DISPLAY_TAG,
      `Filtered ${classification.nonCodeFiles.length} non-code file(s) from diff`,
    );
  }

  // Extract annotations once (shared between hints and ledger)
  const annotations = extractShieldContextAnnotations(filteredFiles, cwd);

  // Auto-detect smart review hints from the filtered diff
  const smartHints = extractShieldHints(filteredDiff, filteredFiles, cwd, annotations);
  if (smartHints.length > 0) {
    log.dim(DISPLAY_TAG, `${smartHints.length} smart hint(s) detected`);
  }

  // Trap Ledger: record override events for totem-context annotations (ADR-071)
  if (annotations.length > 0) {
    const { appendLedgerEvent } = await import('@mmnto/totem');
    const resolvedTotemDir = path.join(configRoot, config.totemDir);
    for (const ann of annotations) {
      appendLedgerEvent(
        resolvedTotemDir,
        {
          timestamp: new Date().toISOString(),
          type: 'override',
          ruleId: 'totem-context',
          file: ann.file,
          line: ann.line,
          justification: ann.text,
          source: 'shield',
        },
        (msg) => log.dim(DISPLAY_TAG, msg),
      );
    }
    log.dim(DISPLAY_TAG, `${annotations.length} annotation(s) recorded in Trap Ledger`);
  }

  // Build full-file context for small changed files (reduces false positives)
  const fileContext = await buildFileContext(
    filteredFiles.length > 0 ? filteredFiles : changedFiles,
    cwd,
    MAX_FILE_LINES,
    MAX_FILE_CONTEXT_CHARS,
  );
  if (fileContext) {
    log.dim(DISPLAY_TAG, `File context: ${(fileContext.length / 1024).toFixed(0)}KB`);
  }

  // Two hash domains (Prop 304 R2, codex fold 1): capture the extension-scoped
  // tracked-source content hash ONCE, before the reviewer runs, so a PASS
  // stamp authorizes the EXACT tree that was reviewed. The shipped code
  // recomputed this hash after the LLM returned, racing any mid-review edit;
  // `handleVerdictResult` now compare-and-stamps against this pre-fan value and
  // refuses to stamp on drift. Distinct from the review payload's `diffHash`.
  const preFanContentHash = await computeReviewedContentHash(
    cwd,
    configRoot,
    config.review.sourceExtensions,
  );

  // Structural mode — context-blind LLM review, no embeddings, no Totem knowledge
  if (options.mode === 'structural') {
    log.info(DISPLAY_TAG, 'Running structural review (context-blind, no Totem knowledge)...');

    const systemPrompt = getSystemPrompt(
      'shield-structural',
      STRUCTURAL_SYSTEM_PROMPT_V2,
      cwd,
      config.totemDir,
    );
    const prompt = assembleStructuralPrompt(
      filteredDiff,
      filteredFiles,
      systemPrompt,
      smartHints,
      fileContext,
    );
    log.dim(DISPLAY_TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    const content = await runOrchestrator({
      prompt,
      tag: TAG,
      options,
      config,
      cwd,
      configRoot,
      temperature: 0,
    });
    if (content == null && !options.raw) {
      throw new TotemError(
        'SHIELD_FAILED',
        'Orchestrator returned no content (defaulting to FAIL).',
        'Check your orchestrator API key and model configuration.',
      );
    }
    if (content != null) {
      await handleVerdictResult(
        content,
        diff,
        options,
        config,
        cwd,
        configRoot,
        'structural',
        preFanContentHash,
      );
    }
    return;
  }

  // Standard mode — full Totem knowledge retrieval + LLM review
  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const { createEmbedder, LanceStore: Store } = await import('@mmnto/totem');
  const embedder = createEmbedder(embedding);
  const store = new Store(path.join(cwd, config.lanceDir), embedder, {
    absolutePathRoot: cwd,
  });
  await store.connect();

  // Retrieve context from LanceDB — use original changedFiles for better search relevance
  const query = await buildSearchQuery(changedFiles, diff);
  log.info(DISPLAY_TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults =
    context.specs.length + context.sessions.length + context.code.length + context.lessons.length;
  log.info(
    DISPLAY_TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/shield.md override)
  const systemPrompt = getSystemPrompt('shield', SYSTEM_PROMPT_V2, cwd, config.totemDir);

  // Code-blind grounding guard (mmnto-ai/totem#2106): 0 code retrieved → surface
  // an advisory banner + fold a suppression directive into the prompt; never
  // disables (strategy#474 interim ruling).
  const codeBlindGuard = applyCodeBlindGuard(context, systemPrompt);
  if (codeBlindGuard.banner) log.warn(DISPLAY_TAG, codeBlindGuard.banner);

  // Assemble prompt — use filtered diff/files for LLM review
  const prompt = assemblePrompt(
    filteredDiff,
    filteredFiles,
    context,
    codeBlindGuard.systemPrompt,
    smartHints,
    fileContext,
  );
  log.dim(DISPLAY_TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // Grounded run artifact (mmnto-ai/totem#2100): always-on for the standard
  // review verdict path — every run is a future eval fixture. Per-item
  // provenance bundle (mmnto-ai/totem#2101): every retrieved item enters classed
  // similarity-only; hash + summary are DERIVED from the bundle.
  const { ADMISSION_COMPLETION_ONLY, calculateDeterministicHash, summarizeProvenance } =
    await import('@mmnto/totem');
  const { buildRetrievalGroundingBundle } = await import('../utils.js');
  const groundingBundle = buildRetrievalGroundingBundle(context);

  // ── Multi-lane review fan (Prop 304 R2, mmnto-ai/totem#2106) ──
  // When `review.lanes` is configured (and neither --model nor structural mode
  // opts out), fan the IDENTICAL assembled prompt across every lane, converge on
  // a verdict artifact, and enforce the cache-eligibility exit contract. The
  // legacy single-lane path below is left byte-for-byte unchanged (invariant 7).
  if (fanActive) {
    if (diffScopeMeta === undefined) {
      // Unreachable: the fan bypasses the incremental fast-path, so the full
      // getDiffForReview path always populated diffScopeMeta. Fail loud, never a
      // silent scope guess (Tenet 4).
      throw new TotemError(
        'SHIELD_FAILED',
        'Internal: diff-scope metadata was not resolved for the review fan.',
        'Re-run `totem review`; report this if it recurs.',
      );
    }
    // Exemptions are read once here and passed in side-effect-free (the fan is
    // pure over them). --suppress mutation is not wired into the fan this slice;
    // committed shared exemptions still filter each lane.
    const { readSharedExemptions } = await import('../exemptions/exemption-store.js');
    const resolvedTotemDir = path.join(configRoot, config.totemDir);
    const shared = readSharedExemptions(resolvedTotemDir, (msg) => log.dim(DISPLAY_TAG, msg));
    const { runReviewFan } = await import('./review-fan.js');
    await runReviewFan({
      laneModels,
      prompt,
      filteredDiff,
      diffMeta: diffScopeMeta,
      config,
      cwd,
      configRoot,
      totemDirAbs: resolvedTotemDir,
      options,
      groundingHash: calculateDeterministicHash(groundingBundle),
      provenanceSummary: summarizeProvenance(groundingBundle),
      groundingBundle,
      totalResults,
      codeBlind: codeBlindGuard.codeBlind,
      shared,
      preFanContentHash,
      continues: options.continues,
    });
    return;
  }

  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    configRoot,
    totalResults,
    temperature: 0,
    // Admission contract (mmnto-ai/totem#2102): the same value the slice-1
    // constant recorded, now caller-supplied — the review verdict path is
    // factually completion-only. `caller` is the user-facing command identity
    // (`totem review`; `shield` is its hidden deprecated alias).
    backendAdmissionClass: ADMISSION_COMPLETION_ONLY,
    runMetadata: { caller: 'review', codeBlind: codeBlindGuard.codeBlind },
    artifact: {
      groundingHash: calculateDeterministicHash(groundingBundle),
      provenanceSummary: summarizeProvenance(groundingBundle),
      bundle: groundingBundle,
    },
  });
  if (content != null) {
    await handleVerdictResult(
      content,
      diff,
      options,
      config,
      cwd,
      configRoot,
      'standard',
      preFanContentHash,
    );
  }
}

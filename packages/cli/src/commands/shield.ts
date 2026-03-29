import type { ContentType, LanceStore, SearchResult, TotemConfig } from '@mmnto/totem';

import { bold, errorColor, log, success as successColor } from '../ui.js';
import {
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
import {
  MAX_CODE_RESULTS,
  MAX_DIFF_CHARS,
  MAX_FILE_CONTEXT_CHARS,
  MAX_FILE_LINES,
  MAX_LESSONS,
  MAX_SESSION_RESULTS,
  MAX_SPEC_RESULTS,
  QUERY_DIFF_TRUNCATE,
  SHIELD_LEARN_SYSTEM_PROMPT,
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
  lines.push(`Shield Review — ${verdictLabel}`);
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
 * Write the .shield-passed gate flag on PASS so pre-push hooks can verify.
 */
export async function writeShieldPassedFlag(
  cwd: string,
  totemDir: string,
  configRoot?: string,
): Promise<void> {
  try {
    const path = await import('node:path');
    const fs = await import('node:fs');
    const { safeExec } = await import('@mmnto/totem');
    const head = safeExec('git', ['rev-parse', 'HEAD'], { cwd });
    const cacheDir = path.join(configRoot ?? cwd, totemDir, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, '.shield-passed'), head);
  } catch (err) {
    // Non-fatal — flag is a convenience for pre-push hooks
    // Log at debug level so failures are diagnosable
    if (process.env['TOTEM_DEBUG'] === '1') {
      console.error(
        '[Shield] Failed to write .shield-passed:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── Main command ───────────────────────────────────────

export type ShieldFormat = 'text' | 'sarif' | 'json';

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  mode?: 'standard' | 'structural';
  learn?: boolean;
  yes?: boolean;
  override?: string;
  suppress?: string[];
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

  log.info(TAG, 'Extracting lessons from failed verdict...'); // totem-ignore: hardcoded string

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
      const store = new Store(path.join(cwd, config.lanceDir), embedder);
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
      log.dim(TAG, `Could not query existing lessons for dedup (non-fatal): ${msg}`); // totem-ignore: msg from Error.message
    }
  }

  const prompt = sections.join('\n');
  log.dim(TAG, `Learn prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

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
    log.dim(TAG, 'No systemic lessons extracted from verdict.'); // totem-ignore: hardcoded string
    return;
  }

  log.success(TAG, `Extracted ${lessons.length} lesson(s) from verdict`); // totem-ignore: count only

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
    log.dim(TAG, 'No lessons selected — nothing written.'); // totem-ignore: hardcoded string
    return;
  }

  // Sanitize and persist
  const sanitized = selected.map((l) => ({
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text), // totem-ignore: already sanitized
  }));

  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
  appendLessons(sanitized, lessonsDir);
  log.success(TAG, `Appended ${sanitized.length} lesson(s) to ${config.totemDir}/lessons/`); // totem-ignore: count only

  // Incremental sync (non-fatal — lessons are already written to disk)
  try {
    log.info(TAG, 'Running incremental sync...');
    const { runSync } = await import('@mmnto/totem');
    const syncResult = await runSync(config, {
      projectRoot: cwd,
      incremental: true,
      onProgress: (msg) => log.dim(TAG, msg),
    });
    log.success(
      TAG,
      `Sync complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `Sync failed (lessons saved but not yet indexed): ${msg}`); // totem-ignore: msg from Error.message
  }
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
): Promise<void> {
  const { TotemError } = await import('@mmnto/totem');

  writeOutput(content, options.out);
  if (options.out) log.success(TAG, `Written to ${options.out}`);

  if (options.raw) return;

  // Try structured parsing first (V2)
  const structured = extractStructuredVerdict(content);
  if (structured) {
    // ─── Exemption filtering ───────────────────────────
    const pathMod = await import('node:path');
    const resolvedTotemDir = pathMod.join(configRoot ?? cwd, config.totemDir);
    const cacheDir = pathMod.join(resolvedTotemDir, 'cache');

    const { readSharedExemptions, writeSharedExemptions } =
      await import('../exemptions/exemption-store.js');
    const { filterExemptedFindings, addManualSuppression } =
      await import('../exemptions/exemption-engine.js');

    let shared = readSharedExemptions(resolvedTotemDir, (msg) => log.dim(TAG, msg));

    // Apply manual --suppress flags
    if (options.suppress?.length) {
      const { appendLedgerEvent: appendExemptionEvent } = await import('@mmnto/totem');
      for (const label of options.suppress) {
        if (!label.trim()) continue;
        shared = addManualSuppression(shared, label, `Manual suppression via --suppress`);
        log.info(TAG, `Suppression registered: ${label}`);
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
          (msg) => log.dim(TAG, msg),
        );
      }
      writeSharedExemptions(resolvedTotemDir, shared, (msg) => log.dim(TAG, msg));
    }

    // Filter exempted findings
    const { filtered, exempted } = filterExemptedFindings(structured.findings, shared);
    if (exempted.length > 0) {
      log.dim(TAG, `${exempted.length} finding(s) exempted by suppression rules`);
    }

    // Use filtered verdict for pass/fail, but show all findings in display
    const filteredVerdict = { ...structured, findings: [...filtered, ...exempted] };

    const verdict = computeVerdict({ ...structured, findings: filtered });
    const display = formatVerdictForDisplay(filteredVerdict, verdict.pass);
    console.error(display);

    if (verdict.pass) {
      // pass — no action needed
    } else if (options.override) {
      const { appendLedgerEvent } = await import('@mmnto/totem');

      const criticalFindings = filtered.filter((f) => f.severity === 'CRITICAL');

      log.warn(TAG, `SHIELD OVERRIDE APPLIED: ${options.override}`);
      for (const finding of criticalFindings) {
        log.warn(TAG, `  [overridden] ${finding.message}`);
      }

      appendLedgerEvent(
        resolvedTotemDir,
        {
          timestamp: new Date().toISOString(),
          type: 'override',
          ruleId: 'shield-override',
          file: '(shield)',
          justification: options.override,
          source: 'shield',
        },
        (msg) => log.dim(TAG, msg),
      );

      // Track overridden findings for exemption engine (only non-exempted findings)
      const { readLocalExemptions, writeLocalExemptions } =
        await import('../exemptions/exemption-store.js');
      const { trackFalsePositives } = await import('../exemptions/exemption-engine.js');
      const { PROMOTION_THRESHOLD } = await import('../exemptions/exemption-schema.js');

      const localExemptions = readLocalExemptions(cacheDir, (msg) => log.dim(TAG, msg));
      const tracked = trackFalsePositives(criticalFindings, 'shield', localExemptions, shared);

      for (const msg of tracked.promoted) {
        log.warn(TAG, `Pattern auto-suppressed after ${PROMOTION_THRESHOLD} overrides: ${msg}`);
      }

      writeLocalExemptions(cacheDir, tracked.local, (msg) => log.dim(TAG, msg));
      if (tracked.promoted.length > 0) {
        shared = tracked.shared;
        writeSharedExemptions(resolvedTotemDir, shared, (msg) => log.dim(TAG, msg));
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
          (msg) => log.dim(TAG, msg),
        );
      }
    } else {
      if (options.learn) {
        await learnFromVerdict(
          JSON.stringify(structured, null, 2),
          diff,
          options,
          config,
          cwd,
          configRoot,
        );
      }
      throw new TotemError(
        'SHIELD_FAILED',
        `Shield ${modeLabel} review failed: ${verdict.reason}`,
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
    log.info(TAG, `Verdict: ${verdictLabel}${reason}`);
    if (verdict.pass) {
      // pass — no action needed
    } else if (options.override) {
      const { appendLedgerEvent } = await import('@mmnto/totem');
      const pathMod = await import('node:path');
      const resolvedTotemDir = pathMod.join(configRoot ?? cwd, config.totemDir);

      log.warn(TAG, `SHIELD OVERRIDE APPLIED: ${options.override}`);

      appendLedgerEvent(
        resolvedTotemDir,
        {
          timestamp: new Date().toISOString(),
          type: 'override',
          ruleId: 'shield-override',
          file: '(shield)',
          justification: options.override,
          source: 'shield',
        },
        (msg) => log.dim(TAG, msg),
      );
    } else {
      if (options.learn) await learnFromVerdict(content, diff, options, config, cwd, configRoot);
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
    log.dim(TAG, 'Upgraded pre-push hook with review auto-refresh');
  }

  const configPath = resolveConfigPath(cwd);
  const configRoot = path.dirname(configPath);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // --- Incremental shield fast-path (#1010) ---
  // If the change since the last passed shield is small enough (< 15 lines,
  // no new files), only evaluate the delta instead of the full branch diff.
  let diff: string;
  let changedFiles: string[];

  const incremental = await evaluateIncrementalEligibility(cwd, config.totemDir, configRoot);
  if (incremental.eligible && incremental.deltaDiff && incremental.changedFiles) {
    log.info(TAG, `Incremental review: ${incremental.linesChanged} line(s) since last pass`);
    diff = incremental.deltaDiff;
    changedFiles = incremental.changedFiles;
  } else {
    if (incremental.reason && incremental.reason !== 'No previous shield state') {
      log.dim(TAG, `Full review: ${incremental.reason}`);
    }
    // Get git diff — shared helper merges ignore patterns, tries staged/all
    // then falls back to branch diff, and extracts changed file paths.
    const diffResult = await getDiffForReview(options, config, cwd, TAG);
    if (!diffResult) {
      // No changes = trivial pass
      return;
    }
    diff = diffResult.diff;
    changedFiles = diffResult.changedFiles;
  }

  // Stage 1: Classify files — fast-path for non-code-only diffs
  const classification = classifyChangedFiles(changedFiles);
  if (classification.allNonCode) {
    log.info(TAG, 'Deterministic fast-path: all changed files are non-code');
    log.dim(TAG, `Skipped: ${changedFiles.join(', ')}`);
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
      log.info(TAG, 'Deterministic fast-path: no code changes after filtering non-code files');
      return;
    }
    log.dim(TAG, `Filtered ${classification.nonCodeFiles.length} non-code file(s) from diff`);
  }

  // Extract annotations once (shared between hints and ledger)
  const annotations = extractShieldContextAnnotations(filteredFiles, cwd);

  // Auto-detect smart review hints from the filtered diff
  const smartHints = extractShieldHints(filteredDiff, filteredFiles, cwd, annotations);
  if (smartHints.length > 0) {
    log.dim(TAG, `${smartHints.length} smart hint(s) detected`);
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
        (msg) => log.dim(TAG, msg),
      );
    }
    log.dim(TAG, `${annotations.length} annotation(s) recorded in Trap Ledger`);
  }

  // Build full-file context for small changed files (reduces false positives)
  const fileContext = await buildFileContext(
    filteredFiles.length > 0 ? filteredFiles : changedFiles,
    cwd,
    MAX_FILE_LINES,
    MAX_FILE_CONTEXT_CHARS,
  );
  if (fileContext) {
    log.dim(TAG, `File context: ${(fileContext.length / 1024).toFixed(0)}KB`);
  }

  // Structural mode — context-blind LLM review, no embeddings, no Totem knowledge
  if (options.mode === 'structural') {
    log.info(TAG, 'Running structural review (context-blind, no Totem knowledge)...');

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
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

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
      await handleVerdictResult(content, diff, options, config, cwd, configRoot, 'structural');
    }
    return;
  }

  // Standard mode — full Totem knowledge retrieval + LLM review
  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const { createEmbedder, LanceStore: Store } = await import('@mmnto/totem');
  const embedder = createEmbedder(embedding);
  const store = new Store(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB — use original changedFiles for better search relevance
  const query = await buildSearchQuery(changedFiles, diff);
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults =
    context.specs.length + context.sessions.length + context.code.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/shield.md override)
  const systemPrompt = getSystemPrompt('shield', SYSTEM_PROMPT_V2, cwd, config.totemDir);

  // Assemble prompt — use filtered diff/files for LLM review
  const prompt = assemblePrompt(
    filteredDiff,
    filteredFiles,
    context,
    systemPrompt,
    smartHints,
    fileContext,
  );
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    configRoot,
    totalResults,
    temperature: 0,
  });
  if (content != null) {
    await handleVerdictResult(content, diff, options, config, cwd, configRoot, 'standard');
  }
}

import * as path from 'node:path';

import type { ContentType, SearchResult } from '@mmnto/totem';
import { applyRules, createEmbedder, LanceStore, loadCompiledRules } from '@mmnto/totem';

import { extractChangedFiles, getDefaultBranch, getGitBranchDiff, getGitDiff } from '../git.js';
import { bold, errorColor, log, success as successColor } from '../ui.js';
import {
  formatResults,
  getSystemPrompt,
  loadConfig,
  loadEnv,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
  writeOutput,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Shield';
const MAX_DIFF_CHARS = 50_000;
const QUERY_DIFF_TRUNCATE = 2_000;
const MAX_SPEC_RESULTS = 3;
const MAX_SESSION_RESULTS = 5;
const MAX_CODE_RESULTS = 5;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Shield System Prompt — Pre-Flight Code Review

## Identity & Role
You are a ruthless Red Team Reality Checker and Senior QA Engineer. You do not just "review" code; you actively look for reasons this code will fail in production. You are a pessimist. You demand evidence and strict adherence to project standards.

## Core Mission
Perform a hostile pre-flight code review on a git diff. Catch unhandled errors, architectural drift, performance traps, and missing tests before a PR is allowed to be opened.

## Critical Rules
- **Evidence-Based Quality Gate:** If the diff adds new functionality or fixes a bug but DOES NOT include a corresponding update to a \`.test.ts\` file or test logs, you MUST flag this as a CRITICAL failure.
- **Pessimistic Review:** Look for security vulnerabilities (unsanitized inputs, shell injection, prompt injection, env variable injection), unhandled promise rejections, missing database indexes, race conditions, and skipped error handling.
- **Focus on the Diff:** Only comment on code that is actually changing. Reference specific lines/hunks.
- **Use Knowledge:** Cite Totem knowledge when it directly applies (e.g., "Session #142 noted a trap regarding...").
- **Enforce Lessons:** Treat all retrieved Totem lessons as a strict checklist. If the diff violates a retrieved lesson, you MUST flag it as a Critical Issue.

## Output Format
Respond with ONLY the sections below. No preamble, no closing remarks.

### Verdict
[Exactly one line: PASS or FAIL followed by " — " and a one-line reason.]
Example: "PASS — All changes have corresponding test coverage."
Example: "FAIL — New functionality in utils.ts lacks corresponding test updates."

### Summary
[1-2 sentences describing what this diff does at a high level]

### Critical Issues (Must Fix)
[Issues that WILL cause failures or regressions. MUST include missing tests for new features. If none, say "None found."]

### Warnings (Should Fix)
[Pattern violations, potential performance traps, DRY violations, and lessons ignored from past sessions. If none, say "None found."]

### Reality Check
[A single skeptical question or edge case the developer probably didn't test for. (e.g., "What happens if the API rate limits on line 42?")]

### Relevant History
[Specific past traps, lessons, or decisions from Totem knowledge that apply to this diff. If none, say "No relevant history found."]
`;

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [specs, sessions, code] = await Promise.all([
    search('spec', MAX_SPEC_RESULTS),
    search('session_log', MAX_SESSION_RESULTS),
    search('code', MAX_CODE_RESULTS),
  ]);

  return { specs, sessions, code };
}

function buildSearchQuery(changedFiles: string[], diff: string): string {
  const fileNames = changedFiles.map((f) => path.basename(f)).join(' ');
  const diffSnippet = diff.slice(0, QUERY_DIFF_TRUNCATE);
  return `${fileNames} ${diffSnippet}`.trim();
}

// ─── Prompt assembly ────────────────────────────────────

function assemblePrompt(
  diff: string,
  changedFiles: string[],
  context: RetrievedContext,
  systemPrompt: string,
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

  return sections.join('\n');
}

// ─── Verdict parsing ────────────────────────────────────

// Matches "### Verdict" at the START of output (no /m flag — anchored to string start to
// prevent prompt-injection via fake verdict blocks embedded in quoted diff content).
// Tolerant of: leading whitespace, optional heading markers, **PASS**, em-dash (—), en-dash (–), hyphen (-), colon (:).
const VERDICT_RE =
  /^\s*(?:#{1,3}\s+)?\*{0,2}Verdict\*{0,2}\s*\r?\n\*{0,2}(PASS|FAIL)\*{0,2}\s*(?:[—–\-:]+\s*)?(.*)/;

export function parseVerdict(content: string): { pass: boolean; reason: string } | null {
  const match = VERDICT_RE.exec(content);
  if (!match) return null;
  return { pass: match[1] === 'PASS', reason: match[2].trim() };
}

// ─── Main command ───────────────────────────────────────

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  deterministic?: boolean;
}

// ─── Deterministic mode ─────────────────────────────

const COMPILED_RULES_FILE = 'compiled-rules.json';

async function runDeterministicShield(
  diff: string,
  cwd: string,
  totemDir: string,
  outPath?: string,
): Promise<void> {
  const rulesPath = path.join(cwd, totemDir, COMPILED_RULES_FILE);
  const rules = loadCompiledRules(rulesPath);

  if (rules.length === 0) {
    log.error(
      TAG,
      `No compiled rules found at ${totemDir}/${COMPILED_RULES_FILE}. Run \`totem compile\` first.`,
    );
    process.exit(1);
  }

  log.info(TAG, `Running ${rules.length} deterministic rules (zero LLM)...`);

  const violations = applyRules(rules, diff);

  // Build output
  const lines: string[] = [];

  if (violations.length === 0) {
    lines.push('### Verdict');
    lines.push(`**PASS** — All ${rules.length} deterministic rules passed.`);
    lines.push('');
    lines.push('### Details');
    lines.push('No violations detected against compiled lesson rules.');
  } else {
    lines.push('### Verdict');
    lines.push(`**FAIL** — ${violations.length} violation(s) found across ${rules.length} rules.`);
    lines.push('');
    lines.push('### Violations');
    for (const v of violations) {
      lines.push(`- **${v.file}:${v.lineNumber}** — ${v.rule.message}`);
      lines.push(`  Pattern: \`/${v.rule.pattern}/\``);
      lines.push(`  Lesson: "${v.rule.lessonHeading}"`);
      lines.push(`  Line: \`${v.line.trim()}\``);
      lines.push('');
    }
  }

  const output = lines.join('\n');
  writeOutput(output, outPath);
  if (outPath) log.success(TAG, `Written to ${outPath}`);

  if (violations.length > 0) {
    const verdictLabel = errorColor(bold('FAIL'));
    log.info(TAG, `Verdict: ${verdictLabel} — ${violations.length} violation(s)`);
    process.exit(1);
  } else {
    const verdictLabel = successColor(bold('PASS'));
    log.info(TAG, `Verdict: ${verdictLabel} — ${rules.length} rules, 0 violations`);
  }
}

// ─── Main command ───────────────────────────────────

export async function shieldCommand(options: ShieldOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff — try uncommitted/staged first, fall back to branch diff vs main
  const mode = options.staged ? 'staged' : 'all';
  log.info(TAG, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let diff = getGitDiff(mode, cwd);

  if (!diff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(TAG, `No uncommitted changes. Falling back to branch diff (${base}...HEAD)...`);
    diff = getGitBranchDiff(cwd, base);
  }

  if (!diff.trim()) {
    log.warn(TAG, 'No changes detected. Nothing to review.');
    return;
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(TAG, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  // Deterministic mode — use compiled rules, no LLM, no embeddings
  if (options.deterministic) {
    await runDeterministicShield(diff, cwd, config.totemDir, options.out);
    return;
  }

  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = buildSearchQuery(changedFiles, diff);
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults = context.specs.length + context.sessions.length + context.code.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code chunks`,
  );

  // Resolve system prompt (allow .totem/prompts/shield.md override)
  const systemPrompt = getSystemPrompt('shield', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(diff, changedFiles, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);

    // Parse verdict and gate on failure (skip in --raw mode — no LLM output)
    if (!options.raw) {
      const verdict = parseVerdict(content);
      if (verdict) {
        const verdictLabel = verdict.pass ? successColor(bold('PASS')) : errorColor(bold('FAIL'));
        const reason = verdict.reason ? ` — ${verdict.reason}` : '';
        log.info(TAG, `Verdict: ${verdictLabel}${reason}`);
        if (!verdict.pass) process.exit(1);
      } else {
        log.error(TAG, 'Verdict: not found (defaulting to FAIL — fix LLM output format)');
        process.exit(1);
      }
    }
  }
}

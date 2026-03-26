/**
 * PR summary comment for totem lint — single managed comment per PR.
 * Implements #923: deduplicates violations, builds markdown, upserts via gh CLI.
 */

import type { CompiledRule, TotemFinding, Violation } from '@mmnto/totem';

// ─── Types ──────────────────────────────────────────

export interface DedupedFinding {
  file: string;
  line: number;
  message: string;
  severity: 'error' | 'warning';
  ruleCount: number;
}

export interface PRSummaryData {
  totalRules: number;
  errors: number;
  warnings: number;
  findings: DedupedFinding[];
  commitSha: string;
  durationMs: number;
}

// ─── Constants ──────────────────────────────────────

const COMMENT_MARKER = '<!-- totem-lint -->';
const MAX_TABLE_ROWS = 50;

// ─── Deduplication ──────────────────────────────────

/**
 * Deduplicate unified findings by file + line. Multiple findings at the same
 * location collapse into one with the highest severity and a rule count.
 * Canonical dedup implementation (ADR-071).
 */
export function deduplicateFindings(input: TotemFinding[]): DedupedFinding[] {
  const groups = new Map<string, { findings: TotemFinding[] }>();

  let unlocatedIdx = 0;
  for (const f of input) {
    // Findings without file/line get unique keys to avoid incorrect grouping
    const key = f.file && f.line ? `${f.file}:${f.line}` : `__unlocated__${unlocatedIdx++}`;
    const existing = groups.get(key);
    if (existing) {
      existing.findings.push(f);
    } else {
      groups.set(key, { findings: [f] });
    }
  }

  const deduped: DedupedFinding[] = [];

  for (const { findings: group } of groups.values()) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const first = group[0]!;
    const hasError = group.some((f) => f.severity === 'error');
    deduped.push({
      file: first.file ?? '',
      line: first.line ?? 0,
      message: first.message,
      severity: hasError ? 'error' : 'warning',
      ruleCount: group.length,
    });
  }

  deduped.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return deduped;
}

/**
 * Deduplicate violations by file + line. Converts to unified findings
 * and delegates to deduplicateFindings.
 */
export async function deduplicateViolations(violations: Violation[]): Promise<DedupedFinding[]> {
  const { violationToFinding } = await import('@mmnto/totem');
  return deduplicateFindings(violations.map(violationToFinding));
}

// ─── Markdown builder ───────────────────────────────

/**
 * Build the managed PR comment markdown from summary data.
 */
export function buildPRCommentMarkdown(data: PRSummaryData): string {
  const lines: string[] = [COMMENT_MARKER, ''];

  // Header
  const verdict = data.errors > 0 ? 'FAIL' : 'PASS';
  const verdictEmoji = data.errors > 0 ? '🔴' : '🟢';
  const parts = [`${verdictEmoji} **Totem Lint — ${verdict}**`];
  parts.push(`| ${data.totalRules} rules`);
  if (data.errors > 0) parts.push(`| ${data.errors} error(s)`);
  if (data.warnings > 0) parts.push(`| ${data.warnings} warning(s)`);
  lines.push(parts.join(' '));
  lines.push('');

  if (data.findings.length === 0) {
    lines.push('No violations detected.');
  } else {
    // Table
    lines.push('| File | Line | Finding | Severity | Rules |');
    lines.push('|------|------|---------|----------|-------|');

    const shown = data.findings.slice(0, MAX_TABLE_ROWS);
    for (const f of shown) {
      const sev = f.severity === 'error' ? '🔴 error' : '🟡 warning';
      const rules = f.ruleCount > 1 ? `${f.ruleCount} rules` : '1 rule';
      const safeMsg = f.message.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
      const msg = safeMsg.length > 80 ? safeMsg.slice(0, 77) + '...' : safeMsg;
      lines.push(`| \`${f.file}\` | ${f.line} | ${msg} | ${sev} | ${rules} |`);
    }

    const remaining = data.findings.length - shown.length;
    if (remaining > 0) {
      lines.push('');
      lines.push(
        `*...and ${remaining} more finding(s). Run \`totem lint\` locally for full details.*`,
      );
    }
  }

  // Footer
  lines.push('');
  const sha = data.commitSha.slice(0, 7);
  const seconds = (data.durationMs / 1000).toFixed(1);
  lines.push(`<sub>Updated: ${sha} · ${seconds}s · zero LLM calls</sub>`);

  return lines.join('\n');
}

// ─── GitHub comment management ──────────────────────

export interface CommentUpsertOptions {
  prNumber: number;
  markdown: string;
  cwd: string;
}

/**
 * Find the existing totem-lint comment on a PR, or create a new one.
 * Uses `gh api` for reliable JSON output.
 */
export async function upsertPRComment(options: CommentUpsertOptions): Promise<void> {
  const { safeExec } = await import('@mmnto/totem');
  const { GH_TIMEOUT_MS } = await import('./utils.js');

  const { prNumber, markdown, cwd } = options;

  const execOpts = {
    cwd,
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    maxBuffer: 5 * 1024 * 1024,
  };

  // 1. List existing comments, find ours by marker
  // gh api auto-resolves {owner}/{repo} from the local git remote
  let existingId: number | null = null;
  try {
    const raw = safeExec(
      'gh',
      [
        'api',
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        '--paginate',
        '--jq',
        `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`,
      ],
      execOpts,
    );
    const ids = raw
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (ids.length > 0) existingId = Math.max(...ids);
  } catch (err) {
    // If listing fails (auth, rate limit, etc.), fall back to creating a new comment
    const msg = err instanceof Error ? err.message : String(err);
    if (!/ENOENT|not found/i.test(msg)) {
      // Log non-trivial failures for debugging; ENOENT (no gh CLI) is handled by the outer catch
      process.stderr.write(`[Totem] Warning: could not list PR comments: ${msg}\n`);
    }
  }

  // 2. Update or create — pass body via stdin to avoid ARG_MAX limits and shell quoting issues
  const payload = JSON.stringify({ body: markdown });

  if (existingId) {
    safeExec(
      'gh',
      ['api', `repos/{owner}/{repo}/issues/comments/${existingId}`, '-X', 'PATCH', '--input', '-'],
      { ...execOpts, input: payload },
    );
  } else {
    safeExec('gh', ['api', `repos/{owner}/{repo}/issues/${prNumber}/comments`, '--input', '-'], {
      ...execOpts,
      input: payload,
    });
  }
}

// ─── Orchestrator ───────────────────────────────────

export interface PostPRCommentOptions {
  violations: Violation[];
  rules: CompiledRule[];
  prNumber: number;
  commitSha: string;
  durationMs: number;
  cwd: string;
}

/**
 * Post-processing step: dedup violations, build markdown, upsert comment.
 */
export async function postPRComment(options: PostPRCommentOptions): Promise<void> {
  const { violations, rules, prNumber, commitSha, durationMs, cwd } = options;

  const findings = await deduplicateViolations(violations);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  const markdown = buildPRCommentMarkdown({
    totalRules: rules.length,
    errors,
    warnings,
    findings,
    commitSha,
    durationMs,
  });

  await upsertPRComment({ prNumber, markdown, cwd });
}

/**
 * PR summary comment for totem lint — single managed comment per PR.
 * Implements #923: deduplicates violations, builds markdown, upserts via gh CLI.
 */

import type { CompiledRule, Violation } from '@mmnto/totem';

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
 * Deduplicate violations by file + line. Multiple rules matching the same
 * location collapse into one finding with the highest severity and a rule count.
 */
export function deduplicateViolations(violations: Violation[]): DedupedFinding[] {
  const groups = new Map<string, { violations: Violation[] }>();

  for (const v of violations) {
    const key = `${v.file}:${v.lineNumber}`;
    const existing = groups.get(key);
    if (existing) {
      existing.violations.push(v);
    } else {
      groups.set(key, { violations: [v] });
    }
  }

  const findings: DedupedFinding[] = [];

  for (const { violations: group } of groups.values()) {
    const first = group[0]!;
    const hasError = group.some((v) => (v.rule.severity ?? 'error') === 'error');
    findings.push({
      file: first.file,
      line: first.lineNumber,
      message: first.rule.message,
      severity: hasError ? 'error' : 'warning',
      ruleCount: group.length,
    });
  }

  // Sort: errors first, then by file, then by line
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  return findings;
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
      const msg = f.message.length > 80 ? f.message.slice(0, 77) + '...' : f.message;
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
  repo?: string;
}

/**
 * Find the existing totem-lint comment on a PR, or create a new one.
 * Uses `gh api` for reliable JSON output.
 */
export async function upsertPRComment(options: CommentUpsertOptions): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  const { IS_WIN, GH_TIMEOUT_MS } = await import('./utils.js');

  const { prNumber, markdown, cwd, repo } = options;
  const repoFlag = repo ? ['--repo', repo] : [];

  const execOpts = {
    cwd,
    encoding: 'utf-8' as const,
    timeout: GH_TIMEOUT_MS,
    shell: IS_WIN,
    stdio: 'pipe' as const,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    maxBuffer: 5 * 1024 * 1024,
  };

  // 1. List existing comments, find ours by marker
  let existingId: number | null = null;
  try {
    const raw = execFileSync(
      'gh',
      [
        'api',
        ...repoFlag.flatMap((f) => ['--header', f === '--repo' ? '' : f]).filter(Boolean),
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        '--paginate',
        '--jq',
        `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`,
      ],
      execOpts,
    );
    const ids = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(Number)
      .filter((n) => !isNaN(n));
    if (ids.length > 0) existingId = ids[0]!;
  } catch {
    // If listing fails, we'll just create a new comment
  }

  // 2. Update or create
  if (existingId) {
    execFileSync(
      'gh',
      [
        'api',
        `repos/{owner}/{repo}/issues/comments/${existingId}`,
        '-X',
        'PATCH',
        '-f',
        `body=${markdown}`,
      ],
      execOpts,
    );
  } else {
    execFileSync(
      'gh',
      ['api', `repos/{owner}/{repo}/issues/${prNumber}/comments`, '-f', `body=${markdown}`],
      execOpts,
    );
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
  repo?: string;
}

/**
 * Post-processing step: dedup violations, build markdown, upsert comment.
 */
export async function postPRComment(options: PostPRCommentOptions): Promise<void> {
  const { violations, rules, prNumber, commitSha, durationMs, cwd, repo } = options;

  const findings = deduplicateViolations(violations);
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

  await upsertPRComment({ prNumber, markdown, cwd, repo });
}

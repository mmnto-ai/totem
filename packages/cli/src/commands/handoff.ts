import * as fs from 'node:fs';
import * as path from 'node:path';

import { readAllLessons } from '@mmnto/totem'; // totem-ignore

import { sanitize } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Handoff';
const LESSONS_TAIL_LINES = 100;
const RECENT_COMMITS_COUNT = 10;
const MAX_SLUG_LENGTH = 60;

/** Local calendar date as YYYY-MM-DD (avoids UTC off-by-one for evening users). */
function currentLocalDate(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// ─── Lessons file reader ────────────────────────────────

export function readRecentLessons(cwd: string, totemDir: string): string {
  const fullTotemDir = path.join(cwd, totemDir);
  const lessons = readAllLessons(fullTotemDir);
  if (lessons.length === 0) return '';

  // Combine all raw lesson text
  const combined = lessons.map((l) => l.raw).join('\n');
  const lines = combined.split('\n');

  if (lines.length <= LESSONS_TAIL_LINES) return combined.trim();

  return lines.slice(-LESSONS_TAIL_LINES).join('\n').trim();
}

// ─── Slug from branch ───────────────────────────────────

/**
 * Derive a filesystem-safe slug from the git branch name.
 * Falls back to 'session' for main, master, or detached HEAD.
 */
export function slugFromBranch(branch: string): string {
  const generic = ['main', 'master', 'HEAD', '', '(unknown)'];
  if (generic.includes(branch)) return 'session';

  // Strip common prefixes (feat/, fix/, chore/, hotfix/, etc.)
  const stripped = branch.replace(/^[a-z]+\//, '');
  // Sanitize: lowercase, replace non-alphanumeric with hyphens, collapse runs, trim
  return (
    stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, MAX_SLUG_LENGTH) || 'session'
  );
}

// ─── Journal path resolution ────────────────────────────

/**
 * Build the journal file path: .totem/journal/YYYY-MM-DD-<slug>.md
 * If --out is specified, use that path instead.
 */
export function resolveJournalPath(
  cwd: string,
  totemDir: string,
  branch: string,
  outPath?: string,
): string {
  if (outPath) return outPath;

  const date = currentLocalDate(); // YYYY-MM-DD
  const slug = slugFromBranch(branch);
  return path.join(cwd, totemDir, 'journal', `${date}-${slug}.md`);
}

// ─── Journal scaffold builder ───────────────────────────

/**
 * Build the structured journal scaffold with human-editable sections
 * at the top and deterministic git state at the bottom.
 */
export function buildJournalScaffold(
  branch: string,
  status: string,
  diffStat: string,
  recentCommits: string,
  lessons: string,
): string {
  // Sanitize git-sourced fields to strip ANSI escapes / control chars
  const sBranch = sanitize(branch);
  const sStatus = sanitize(status);
  const sDiffStat = sanitize(diffStat);
  const sCommits = sanitize(recentCommits);

  const date = currentLocalDate();
  const lines: string[] = [];

  // ── Human-editable section (top) ──
  lines.push(`# ${date} — ${sBranch}`);
  lines.push('');
  lines.push('## What Shipped');
  lines.push('<!-- What was accomplished this session? -->');
  lines.push('');
  lines.push('## Architectural Decisions');
  lines.push('<!-- Any design choices worth recording? -->');
  lines.push('');
  lines.push('## Open Tickets');
  lines.push('<!-- Tickets filed, referenced, or blocked? -->');
  lines.push('');
  lines.push('## Next Steps');
  lines.push('<!-- What should the next session pick up? -->');
  lines.push('');

  // ── Deterministic git state (bottom) ──
  lines.push('---');
  lines.push('');
  lines.push('### Branch & State');
  lines.push(`${sBranch}; ${sStatus.trim() ? 'dirty working tree' : 'clean working tree'}.`);
  lines.push('');

  lines.push('### Uncommitted Changes');
  if (sStatus.trim()) {
    lines.push('```');
    lines.push(sStatus.trim());
    lines.push('```');
    if (sDiffStat.trim()) {
      lines.push('');
      lines.push('```');
      lines.push(sDiffStat.trim());
      lines.push('```');
    }
  } else {
    lines.push('Working tree is clean.');
  }
  lines.push('');

  lines.push('### Recent Commits');
  if (sCommits.trim()) {
    lines.push('```');
    lines.push(sCommits.trim());
    lines.push('```');
  } else {
    lines.push('No commits found.');
  }
  lines.push('');

  lines.push('### Lessons');
  if (lessons.trim()) {
    const lessonLines = lessons.split('\n');
    lines.push(`${lessonLines.length} lines in lessons file (last ${LESSONS_TAIL_LINES} shown).`);
  } else {
    lines.push('No lessons file found.');
  }

  return lines.join('\n') + '\n';
}

// ─── Editor launcher ────────────────────────────────────

/**
 * Open a file in the user's editor. Uses $VISUAL, then $EDITOR, then vi.
 * Returns true if the editor exited successfully.
 */
export async function openInEditor(filePath: string): Promise<boolean> {
  const { spawnSync } = await import('node:child_process');
  const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
  // Split editor command in case it contains args (e.g. "code --wait")
  const parts = editor.split(/\s+/);
  const cmd = parts[0]!;
  const args = [...parts.slice(1), filePath];

  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

// ─── Main command ───────────────────────────────────────

export interface HandoffOptions {
  noEdit?: boolean;
  lite?: boolean;
  out?: string;
}

export async function handoffCommand(options: HandoffOptions): Promise<void> {
  const { getGitBranch, getGitDiffStat, getGitLogSince, getGitStatus } = await import('../git.js');
  const { log } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Gather git state
  log.info(TAG, 'Gathering git state...');
  const branch = getGitBranch(cwd);
  const status = getGitStatus(cwd);
  log.info(TAG, `Branch: ${branch}`);

  const diffStat = status.trim() ? getGitDiffStat(cwd) : '';
  const recentCommits = getGitLogSince(cwd, undefined, RECENT_COMMITS_COUNT);

  // Read recent lessons
  const lessons = readRecentLessons(cwd, config.totemDir);

  // Build scaffold
  const scaffold = buildJournalScaffold(branch, status, diffStat, recentCommits, lessons);

  // --out: write to the specified path and exit (no editor)
  if (options.out) {
    const outDir = path.dirname(options.out);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(options.out, scaffold, 'utf-8');
    log.success(TAG, `Scaffold written to ${options.out}`);
    return;
  }

  // --no-edit / --lite: print to stdout
  if (options.noEdit || options.lite) {
    process.stdout.write(scaffold);
    log.dim(TAG, 'Scaffold printed to stdout (--no-edit mode).');
    return;
  }

  // Default: write scaffold to journal file and open in editor
  const journalPath = resolveJournalPath(cwd, config.totemDir, branch);
  const journalDir = path.dirname(journalPath);
  if (!fs.existsSync(journalDir)) {
    fs.mkdirSync(journalDir, { recursive: true });
  }

  // If the file already exists, don't overwrite — open it for editing instead
  if (!fs.existsSync(journalPath)) {
    fs.writeFileSync(journalPath, scaffold, 'utf-8');
    log.success(TAG, `Scaffold written to ${journalPath}`);
  } else {
    log.info(TAG, `Journal entry already exists: ${journalPath}`);
  }

  // Open in editor
  log.info(TAG, 'Opening in editor...');
  const ok = await openInEditor(journalPath);
  if (ok) {
    log.success(TAG, 'Journal entry saved.');
  } else {
    log.warn(TAG, `Editor exited with error. Your journal entry is at: ${journalPath}`);
  }
}

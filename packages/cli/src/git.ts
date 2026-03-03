import { execFileSync } from 'node:child_process';

import { IS_WIN } from './utils.js';

// ─── Constants ──────────────────────────────────────────

const GIT_COMMAND_TIMEOUT_MS = 15_000;

// ─── Git helpers ────────────────────────────────────────

export function getGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '(unknown)';
  }
}

export function getGitStatus(cwd: string): string {
  try {
    return execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

export function getGitDiff(mode: 'staged' | 'all', cwd: string): string {
  const args = mode === 'staged' ? ['diff', '--staged'] : ['diff', 'HEAD'];
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] 'git' command not found. Ensure Git is installed and in your PATH.`,
      );
    }
    throw new Error(`[Totem Error] Failed to get git diff: ${msg}`);
  }
}

export function getGitDiffStat(cwd: string): string {
  try {
    return execFileSync('git', ['diff', 'HEAD', '--stat'], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Detect the default branch of the remote (e.g. main, master).
 * Falls back to 'main' if detection fails.
 */
export function getDefaultBranch(cwd: string): string {
  try {
    const ref = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    }).trim();
    // ref is like "origin/main" — strip the remote prefix
    return ref.replace(/^origin\//, '');
  } catch {
    // Fallback: check if 'main' exists, then 'master'
    for (const branch of ['main', 'master']) {
      try {
        execFileSync('git', ['rev-parse', '--verify', branch], {
          cwd,
          encoding: 'utf-8',
          timeout: GIT_COMMAND_TIMEOUT_MS,
          shell: IS_WIN,
        });
        return branch;
      } catch {
        // Try next candidate
      }
    }
    return 'main';
  }
}

export function getGitBranchDiff(cwd: string, base?: string): string {
  const baseBranch = base ?? getDefaultBranch(cwd);
  try {
    return execFileSync('git', ['diff', `${baseBranch}...HEAD`], {
      cwd,
      encoding: 'utf-8',
      timeout: GIT_COMMAND_TIMEOUT_MS,
      shell: IS_WIN,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      throw new Error(
        `[Totem Error] 'git' command not found. Ensure Git is installed and in your PATH.`,
      );
    }
    throw new Error(`[Totem Error] Failed to get branch diff (${baseBranch}...HEAD): ${msg}`);
  }
}

export function extractChangedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      const match = line.match(/^diff --git a\/.+ b\/(.+)$/);
      if (match) files.push(match[1]);
    }
  }
  return files;
}

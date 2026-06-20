/**
 * Cross-platform git hook installer.
 * Copies hook scripts from tools/ to .git/hooks/.
 * Idempotent — safe to re-run.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const gitPath = join(rootDir, '.git');

const hooks = ['pre-commit', 'pre-push', 'post-merge'];

if (!existsSync(gitPath)) {
  console.log('[totem] Not a git repository — skipping hook installation.');
  process.exit(0);
}

/**
 * Resolve the git hooks directory. In a normal checkout `.git` is a directory
 * (hooks live in `.git/hooks`). In a linked worktree (or submodule) `.git` is a
 * FILE of the form `gitdir: <path>` pointing at the per-worktree git dir — in
 * that case `.git/hooks` is not a real path, so we follow the pointer (and its
 * `commondir`, when present) to the shared hooks dir instead. Without this a
 * worktree's `mkdir .git/hooks` fails with ENOTDIR.
 */
function resolveHooksDir() {
  if (statSync(gitPath).isDirectory()) {
    return join(gitPath, 'hooks');
  }
  const pointer = readFileSync(gitPath, 'utf-8').trim();
  const match = /^gitdir:\s*(.+)$/.exec(pointer);
  if (!match) {
    console.log(
      '[totem] .git is not a directory or a gitdir pointer — skipping hook installation.',
    );
    process.exit(0);
  }
  const gitDir = isAbsolute(match[1]) ? match[1] : resolve(rootDir, match[1]);
  // Hooks are shared across worktrees via the common git dir when one is declared.
  const commonDirFile = join(gitDir, 'commondir');
  if (existsSync(commonDirFile)) {
    const commonDir = readFileSync(commonDirFile, 'utf-8').trim();
    return join(isAbsolute(commonDir) ? commonDir : resolve(gitDir, commonDir), 'hooks');
  }
  return join(gitDir, 'hooks');
}

const hooksDir = resolveHooksDir();

mkdirSync(hooksDir, { recursive: true });

for (const hook of hooks) {
  const src = join(__dirname, hook);
  const dest = join(hooksDir, hook);

  if (!existsSync(src)) {
    console.log(`[totem] Hook source not found: ${hook} — skipping.`);
    continue;
  }

  copyFileSync(src, dest);

  // Make executable on Unix (no-op on Windows, git bash handles it)
  try {
    chmodSync(dest, 0o755);
  } catch (_err) {
    // chmod may fail on Windows — hooks still work via git bash
  }

  console.log(`[totem] Installed ${hook} hook.`);
}

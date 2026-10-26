/**
 * Cross-platform git hook installer.
 * Copies hook scripts from tools/ to .git/hooks/.
 * Idempotent — safe to re-run.
 */

import { spawnSync } from 'node:child_process';
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
 *
 * A `commondir` marks a LINKED worktree, and the hooks dir it names is the one
 * every worktree of the repository runs: writing it from here would install
 * THIS branch's templates for all of them, silently reverting a newer main
 * worktree's hooks (mmnto-ai/totem#3122). The main worktree owns the shared
 * hooks, so a linked worktree skips the write (exit 0, one line) unless
 * `TOTEM_HOOKS_FORCE=1` says the caller means it. A BARE common repository has
 * no main worktree, so its worktrees write as before.
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
  // Defensive trim of the captured path: git does not write trailing whitespace,
  // but a non-standard tool might, and an untrimmed value would silently break path
  // resolution (CR #2209).
  const rawGitDir = match[1].trim();
  const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(rootDir, rawGitDir);
  // Hooks are shared across worktrees via the common git dir when one is declared.
  const commonDirFile = join(gitDir, 'commondir');
  if (existsSync(commonDirFile)) {
    const commonDir = readFileSync(commonDirFile, 'utf-8').trim();
    const commonDirPath = isAbsolute(commonDir) ? commonDir : resolve(gitDir, commonDir);
    // A BARE common repository (one worktree per branch, no main working tree)
    // has nothing else to own the shared hooks, so its worktrees write them. The
    // flag lives in `config`, or in `config.worktree` once extensions.worktreeConfig
    // is on (git sparse-checkout turns it on and moves the flag there), in any
    // boolean spelling git accepts.
    // git's own answer first, asked in the common dir; the two files only when git
    // cannot answer, and `config.worktree` only when `config` turns the extension on.
    const asked = spawnSync('git', ['rev-parse', '--is-bare-repository'], {
      cwd: commonDirPath,
      encoding: 'utf-8',
    });
    const bare =
      asked.status === 0 && asked.stdout
        ? asked.stdout.trim() === 'true'
        : configSaysBareInDir(commonDirPath);
    if (!bare && process.env.TOTEM_HOOKS_FORCE !== '1') {
      console.log(
        '[totem] Linked worktree: git hooks are shared by every worktree of this repository and the main worktree owns them — skipping hook installation (run `pnpm install` from the main worktree, or set TOTEM_HOOKS_FORCE=1 to copy them from this branch, each shared hook replaced whole).',
      );
      process.exit(0);
    }
    return join(commonDirPath, 'hooks');
  }
  return join(gitDir, 'hooks');
}

/**
 * Whether a git config text sets `core.bare` true, read the way git reads it: under
 * `[core]` only, the last occurrence winning, a bare key or a value in any boolean
 * spelling git accepts (true, yes, on, 1), a quoted value unquoted, a trailing `#`
 * or `;` comment dropped. The same read as the CLI installer's fallback; this
 * script runs on vanilla Node at `prepare` and cannot import it.
 */
function configBool(text, section, key) {
  const sectionLine = new RegExp('^\\[' + section + '\\]', 'i');
  const keyLine = new RegExp('^' + key + '\\s*(?:=\\s*(.*))?$', 'i');
  let inSection = false;
  let bare = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inSection = sectionLine.test(line);
      continue;
    }
    if (!inSection) continue;
    const match = keyLine.exec(line);
    if (!match) continue;
    const rest = match[1];
    const quoted = rest === undefined ? null : /^"([^"]*)"/.exec(rest);
    const value =
      rest === undefined ? 'true' : quoted ? quoted[1] : rest.replace(/\s*[#;].*$/, '').trim();
    bare = /^(?:true|yes|on|1)$/i.test(value);
  }
  return bare;
}

/** core.bare from `config`, and from `config.worktree` only when `config` turns the extension on. */
function configSaysBareInDir(dir) {
  const configPath = join(dir, 'config');
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
  if (configBool(config, 'core', 'bare')) return true;
  if (!configBool(config, 'extensions', 'worktreeConfig')) return false;
  const worktreeConfigPath = join(dir, 'config.worktree');
  return (
    existsSync(worktreeConfigPath) &&
    configBool(readFileSync(worktreeConfigPath, 'utf-8'), 'core', 'bare')
  );
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

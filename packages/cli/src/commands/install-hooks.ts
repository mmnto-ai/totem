import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { resolveGitRoot } from '../git.js';

const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
const TOTEM_HOOK_END = '[totem] end post-merge';
export const TOTEM_PRECOMMIT_MARKER = '[totem] pre-commit hook';
export const TOTEM_PREPUSH_MARKER = '[totem] pre-push hook';

type HookManager = 'husky' | 'lefthook' | 'simple-git-hooks';

export function detectTotemPrefix(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm exec totem';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn totem';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bunx totem';
  return 'npx totem';
}

function detectSyncCommand(cwd: string): string {
  return `${detectTotemPrefix(cwd)} sync --incremental --quiet`;
}

function buildHookContent(syncCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  echo "[totem] Lessons changed — triggering background re-index..."
  (${syncCmd} > .git/totem-sync.log 2>&1) &
fi
# ${TOTEM_HOOK_END}
`;
}

function detectHookManager(cwd: string): HookManager | null {
  if (fs.existsSync(path.join(cwd, '.husky'))) {
    return 'husky';
  }
  if (
    fs.existsSync(path.join(cwd, 'lefthook.yml')) ||
    fs.existsSync(path.join(cwd, '.lefthook.yml'))
  ) {
    return 'lefthook';
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg: { 'simple-git-hooks'?: unknown } = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg['simple-git-hooks']) {
        return 'simple-git-hooks';
      }
    } catch {
      console.error('[Totem] Warning: could not parse package.json while detecting hook manager.');
    }
  }

  return null;
}

function printHookManagerGuidance(manager: HookManager, syncCmd: string, shieldCmd: string): void {
  switch (manager) {
    case 'husky':
      console.error('[Totem] Detected husky. Add the following to your hook files:');
      console.error('');
      console.error('  # .husky/pre-commit — block direct commits to main/master');
      console.error('  branch=$(git rev-parse --abbrev-ref HEAD)');
      console.error('  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then');
      console.error('    echo "[Totem] Direct commits to $branch blocked."');
      console.error('    exit 1');
      console.error('  fi');
      console.error('');
      console.error('  # .husky/pre-push — deterministic shield gate');
      console.error('  if [ -f ".totem/compiled-rules.json" ]; then');
      console.error(`    ${shieldCmd}`);
      console.error('  fi');
      console.error('');
      console.error('  # .husky/post-merge — background re-index');
      console.error(`  ${syncCmd}`);
      break;
    case 'lefthook':
      console.error('[Totem] Detected lefthook. Add to your lefthook.yml:');
      console.error('  pre-commit:');
      console.error('    commands:');
      console.error('      totem-block-main:');
      console.error(
        '        run: branch=$(git rev-parse --abbrev-ref HEAD); if [ "$branch" = main ] || [ "$branch" = master ]; then echo "[Totem] Direct commits to $branch blocked." && exit 1; fi',
      );
      console.error('  pre-push:');
      console.error('    commands:');
      console.error('      totem-shield:');
      console.error(`        run: 'if [ -f ".totem/compiled-rules.json" ]; then ${shieldCmd}; fi'`);
      console.error('  post-merge:');
      console.error('    commands:');
      console.error('      totem-sync:');
      console.error(`        run: ${syncCmd}`);
      break;
    case 'simple-git-hooks':
      console.error('[Totem] Detected simple-git-hooks. Add to your package.json:');
      console.error('  "simple-git-hooks": {');
      console.error(
        '    "pre-commit": "branch=$(git rev-parse --abbrev-ref HEAD); if [ \\"$branch\\" = main ] || [ \\"$branch\\" = master ]; then echo \\"[Totem] Direct commits to $branch blocked.\\" && exit 1; fi",',
      );
      console.error(
        `    "pre-push": "if [ -f \\".totem/compiled-rules.json\\" ]; then ${shieldCmd}; fi",`,
      );
      console.error(`    "post-merge": "${syncCmd}"`);
      console.error('  }');
      break;
  }
}

export async function installPostMergeHook(cwd: string, rl: readline.Interface): Promise<void> {
  // Guard: must be a git repo — resolve root from any subdirectory
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    console.log('[Totem] Not a git repository — skipping hook installation.');
    return;
  }

  const syncCmd = detectSyncCommand(gitRoot);
  const shieldCmd = `${detectTotemPrefix(gitRoot)} lint`;
  const manager = detectHookManager(gitRoot);

  if (manager) {
    printHookManagerGuidance(manager, syncCmd, shieldCmd);
    return;
  }

  const answer = await rl.question(
    '\nInstall a post-merge git hook to auto-sync Totem after merges? (y/N): ',
  );

  if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
    return;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'post-merge');

  // Idempotency: check if already installed
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(TOTEM_HOOK_MARKER)) {
      console.log('[Totem] Post-merge hook already installed.');
      return;
    }

    // Append to existing hook — reuse buildHookContent, strip shebang
    const separator = existing.endsWith('\n') ? '' : '\n';
    const appendBlock = buildHookContent(syncCmd)
      .replace(/^#!\/bin\/sh\n/, '')
      .trimStart();
    fs.appendFileSync(hookPath, separator + '\n' + appendBlock);
    console.log('[Totem] Appended post-merge hook to existing hook file.');
    return;
  }

  // Create new hook
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, buildHookContent(syncCmd));

  // Make executable (no-op on Windows, git bash handles it)
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod may fail on Windows — hooks still work via git bash
  }

  console.log('[Totem] Installed post-merge hook.');
}

// ─── Enforcement hooks (pre-commit + pre-push) ──────────

export function buildPreCommitHook(): string {
  return `#!/bin/sh
# ${TOTEM_PRECOMMIT_MARKER} — block direct commits to protected branches.
# Override with: git commit --no-verify

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "[Totem] ERROR: Direct commits to '$branch' are blocked."
  echo "[Totem] Create a feature branch: git checkout -b feat/my-feature"
  echo "[Totem] Override with: git commit --no-verify"
  exit 1
fi
`;
}

export function buildPrePushHook(shieldCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

# Only run shield when compiled rules exist (zero Node startup penalty otherwise).
# Uses if/fi block so this is safe to append to existing hooks without early termination.
if [ -f ".totem/compiled-rules.json" ]; then
  ${shieldCmd}
fi
`;
}

const SHELL_SHEBANG_RE = /^#!\/bin\/(ba)?sh|^#!\/usr\/bin\/env\s+(ba)?sh/;

/**
 * Install a single git hook with idempotency and chain preservation.
 * Returns the action taken.
 */
export function installGitHook(
  hooksDir: string,
  hookName: string,
  hookContent: string,
  marker: string,
): 'installed' | 'exists' | 'appended' | 'skipped-non-shell' {
  const hookPath = path.join(hooksDir, hookName);

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(marker)) {
      return 'exists';
    }

    // Guard: do not append bash syntax to non-shell hooks (Node, Python, etc.)
    const firstLine = existing.split('\n')[0] ?? '';
    if (firstLine.startsWith('#!') && !SHELL_SHEBANG_RE.test(firstLine)) {
      return 'skipped-non-shell';
    }

    // Append to existing hook — preserve user's existing hooks
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    const appendBlock = hookContent
      .replace(/^#!\/bin\/sh\n/, '') // Strip shebang when appending
      .trimStart();
    fs.appendFileSync(hookPath, separator + appendBlock);
    return 'appended';
  }

  // Create new hook
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, hookContent);

  // Make executable (no-op on Windows, git bash handles it)
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod may fail on Windows — hooks still work via git bash
  }

  return 'installed';
}

export interface EnforcementHookResult {
  preCommit: 'installed' | 'exists' | 'appended' | 'skipped' | 'skipped-non-shell';
  prePush: 'installed' | 'exists' | 'appended' | 'skipped' | 'skipped-non-shell';
}

/**
 * Install pre-commit (block main) and pre-push (deterministic shield) hooks.
 * Respects hook managers by printing guidance instead of writing raw hooks.
 * Returns actions taken for reporting in init summary.
 */
export async function installEnforcementHooks(
  cwd: string,
  rl: readline.Interface,
): Promise<EnforcementHookResult> {
  const skip: EnforcementHookResult = { preCommit: 'skipped', prePush: 'skipped' };

  // Guard: must be a git repo — resolve root from any subdirectory
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    return skip;
  }

  // Hook managers handle their own installation — print guidance only
  const manager = detectHookManager(gitRoot);
  if (manager) {
    // Guidance is printed by installPostMergeHook which runs next
    return skip;
  }

  // Ask user — default to yes for safety
  const answer = await rl.question(
    '\nInstall git enforcement hooks (block main commits + deterministic shield)? (Y/n): ',
  );

  if (answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no') {
    return skip;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const shieldCmd = `${detectTotemPrefix(gitRoot)} lint`;

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(),
    TOTEM_PRECOMMIT_MARKER,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(shieldCmd),
    TOTEM_PREPUSH_MARKER,
  );

  // Warn about non-shell hooks that Totem cannot safely append to
  if (preCommit === 'skipped-non-shell') {
    console.error(
      '[Totem] Warning: pre-commit hook uses a non-shell interpreter. Manually integrate branch protection into your existing hook.',
    );
  }
  if (prePush === 'skipped-non-shell') {
    console.error(
      '[Totem] Warning: pre-push hook uses a non-shell interpreter. Manually add: ' + shieldCmd,
    );
  }

  return { preCommit, prePush };
}

export async function installHooksCommand(): Promise<void> {
  const cwd = process.cwd();
  const rl = readline.createInterface({ input, output });

  try {
    await installEnforcementHooks(cwd, rl);
    await installPostMergeHook(cwd, rl);
  } finally {
    rl.close();
  }
}

// ─── Non-interactive hooks command ───────────────────

export interface HooksCommandResult {
  preCommit: 'installed' | 'exists' | 'appended' | 'skipped-non-shell';
  prePush: 'installed' | 'exists' | 'appended' | 'skipped-non-shell';
  postMerge: 'installed' | 'exists' | 'appended' | 'skipped-non-shell';
}

/**
 * Non-interactive hook installer for `totem hooks` and `prepare` scripts.
 * Installs pre-commit, pre-push, and post-merge hooks without prompting.
 */
export function installHooksNonInteractive(cwd: string): HooksCommandResult | null {
  // Guard: must be a git repo — resolve root from any subdirectory
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    return null;
  }

  // Hook managers handle their own installation — print guidance only
  const manager = detectHookManager(gitRoot);
  if (manager) {
    const syncCmd = detectSyncCommand(gitRoot);
    const shieldCmd = `${detectTotemPrefix(gitRoot)} lint`;
    printHookManagerGuidance(manager, syncCmd, shieldCmd);
    return null;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const prefix = detectTotemPrefix(gitRoot);
  const shieldCmd = `${prefix} lint`;
  const syncCmd = detectSyncCommand(gitRoot);

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(),
    TOTEM_PRECOMMIT_MARKER,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(shieldCmd),
    TOTEM_PREPUSH_MARKER,
  );

  const postMergeContent = buildHookContent(syncCmd);
  const postMerge = installGitHook(hooksDir, 'post-merge', postMergeContent, TOTEM_HOOK_MARKER);

  return { preCommit, prePush, postMerge };
}

/**
 * Check that all Totem hooks are installed. Returns true if all present.
 */
export function checkHooksInstalled(cwd: string): boolean {
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    return false;
  }
  const hooksDir = path.join(gitRoot, '.git', 'hooks');

  const markers = [
    { file: 'pre-commit', marker: TOTEM_PRECOMMIT_MARKER },
    { file: 'pre-push', marker: TOTEM_PREPUSH_MARKER },
    { file: 'post-merge', marker: TOTEM_HOOK_MARKER },
  ];

  let allPresent = true;
  for (const { file, marker } of markers) {
    const hookPath = path.join(hooksDir, file);
    if (!fs.existsSync(hookPath)) {
      console.error(`[Totem] Missing hook: ${file}`);
      allPresent = false;
      continue;
    }
    const content = fs.readFileSync(hookPath, 'utf-8');
    if (!content.includes(marker)) {
      console.error(`[Totem] Hook ${file} exists but missing Totem marker`);
      allPresent = false;
    }
  }

  return allPresent;
}

/**
 * CLI entrypoint for `totem hooks [--check]`.
 */
export function hooksCommand(opts: { check?: boolean }): void {
  const cwd = process.cwd();

  // Resolve git root once — guards both --check and install paths
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    console.error('[Totem] Not a git repository — skipping hook installation.');
    return;
  }

  if (opts.check) {
    const ok = checkHooksInstalled(cwd);
    if (ok) {
      console.error('[Totem] All hooks installed.');
    } else {
      console.error('[Totem] Some hooks are missing. Run `totem hooks` to install.');
      process.exit(1);
    }
    return;
  }

  const result = installHooksNonInteractive(cwd);

  if (!result) {
    // Hook manager detected — guidance already printed by installHooksNonInteractive
    return;
  }

  const actions = [
    { name: 'pre-commit', status: result.preCommit },
    { name: 'pre-push', status: result.prePush },
    { name: 'post-merge', status: result.postMerge },
  ];

  for (const { name, status } of actions) {
    switch (status) {
      case 'installed':
        console.error(`[Totem] Installed ${name} hook.`);
        break;
      case 'appended':
        console.error(`[Totem] Appended Totem to existing ${name} hook.`);
        break;
      case 'exists':
        console.error(`[Totem] ${name} hook already installed.`);
        break;
      case 'skipped-non-shell':
        console.error(
          `[Totem] Warning: ${name} hook uses a non-shell interpreter. Integrate manually.`,
        );
        break;
    }
  }
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
export const TOTEM_PRECOMMIT_MARKER = '[totem] pre-commit hook';
export const TOTEM_PREPUSH_MARKER = '[totem] pre-push hook';

type HookManager = 'husky' | 'lefthook' | 'simple-git-hooks';

function detectTotemPrefix(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm exec totem';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn totem';
  return 'npx totem';
}

function detectSyncCommand(cwd: string): string {
  return `${detectTotemPrefix(cwd)} sync --incremental`;
}

function buildHookContent(syncCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.

echo "[totem] Triggering background re-index..."
(${syncCmd} > .git/totem-sync.log 2>&1) &
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
      console.log('[Totem] Warning: could not parse package.json while detecting hook manager.');
    }
  }

  return null;
}

function printHookManagerGuidance(manager: HookManager, syncCmd: string, shieldCmd: string): void {
  switch (manager) {
    case 'husky':
      console.log('[Totem] Detected husky. Add Totem hooks manually:');
      console.log('');
      console.log('  # Pre-commit: block direct commits to main/master');
      console.log(
        '  echo \'branch=$(git rev-parse --abbrev-ref HEAD); [ "$branch" = main ] || [ "$branch" = master ] && echo "[Totem] Direct commits to $branch blocked." && exit 1; exit 0\' > .husky/pre-commit',
      );
      console.log('');
      console.log('  # Pre-push: deterministic shield gate');
      console.log(
        `  echo '[ ! -f ".totem/compiled-rules.json" ] && exit 0; ${shieldCmd}' > .husky/pre-push`,
      );
      console.log('');
      console.log('  # Post-merge: background re-index');
      console.log(`  echo '${syncCmd}' >> .husky/post-merge`);
      break;
    case 'lefthook':
      console.log('[Totem] Detected lefthook. Add to your lefthook.yml:');
      console.log('  pre-commit:');
      console.log('    commands:');
      console.log('      totem-block-main:');
      console.log(
        '        run: branch=$(git rev-parse --abbrev-ref HEAD); [ "$branch" = main ] || [ "$branch" = master ] && echo "[Totem] Direct commits to $branch blocked." && exit 1; exit 0',
      );
      console.log('  pre-push:');
      console.log('    commands:');
      console.log('      totem-shield:');
      console.log(`        run: '[ ! -f ".totem/compiled-rules.json" ] && exit 0; ${shieldCmd}'`);
      console.log('  post-merge:');
      console.log('    commands:');
      console.log('      totem-sync:');
      console.log(`        run: ${syncCmd}`);
      break;
    case 'simple-git-hooks':
      console.log('[Totem] Detected simple-git-hooks. Add to your package.json:');
      console.log('  "simple-git-hooks": {');
      console.log(
        '    "pre-commit": "branch=$(git rev-parse --abbrev-ref HEAD); [ \\"$branch\\" = main ] || [ \\"$branch\\" = master ] && echo \\"[Totem] Direct commits to $branch blocked.\\" && exit 1",',
      );
      console.log(
        `    "pre-push": "[ ! -f \\".totem/compiled-rules.json\\" ] && exit 0; ${shieldCmd}",`,
      );
      console.log(`    "post-merge": "${syncCmd}"`);
      console.log('  }');
      break;
  }
}

export async function installPostMergeHook(cwd: string, rl: readline.Interface): Promise<void> {
  // Guard: must be a git repo
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    console.log('[Totem] Not a git repository — skipping hook installation.');
    return;
  }

  const syncCmd = detectSyncCommand(cwd);
  const shieldCmd = `${detectTotemPrefix(cwd)} shield --deterministic`;
  const manager = detectHookManager(cwd);

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

  const hooksDir = path.join(cwd, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'post-merge');

  // Idempotency: check if already installed
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(TOTEM_HOOK_MARKER)) {
      console.log('[Totem] Post-merge hook already installed.');
      return;
    }

    // Append to existing hook
    const separator = existing.endsWith('\n') ? '' : '\n';
    const appendBlock = `${separator}
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.
echo "[totem] Triggering background re-index..."
(${syncCmd} > .git/totem-sync.log 2>&1) &
`;
    fs.appendFileSync(hookPath, appendBlock);
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
# ${TOTEM_PREPUSH_MARKER} — deterministic shield gate.
# Override with: git push --no-verify

# Bail instantly if no compiled rules (zero Node startup penalty)
[ ! -f ".totem/compiled-rules.json" ] && exit 0

${shieldCmd}
`;
}

/**
 * Install a single git hook with idempotency and chain preservation.
 * Returns the action taken.
 */
export function installGitHook(
  hooksDir: string,
  hookName: string,
  hookContent: string,
  marker: string,
): 'installed' | 'exists' | 'appended' {
  const hookPath = path.join(hooksDir, hookName);

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(marker)) {
      return 'exists';
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
  preCommit: 'installed' | 'exists' | 'appended' | 'skipped';
  prePush: 'installed' | 'exists' | 'appended' | 'skipped';
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

  // Guard: must be a git repo
  if (!fs.existsSync(path.join(cwd, '.git'))) {
    return skip;
  }

  // Hook managers handle their own installation — print guidance only
  const manager = detectHookManager(cwd);
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

  const hooksDir = path.join(cwd, '.git', 'hooks');
  const shieldCmd = `${detectTotemPrefix(cwd)} shield --deterministic`;

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

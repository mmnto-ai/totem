import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

const TOTEM_HOOK_MARKER = '[totem] post-merge hook';

type HookManager = 'husky' | 'lefthook' | 'simple-git-hooks';

function detectSyncCommand(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
    return 'pnpm exec totem sync --incremental';
  }
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    return 'yarn totem sync --incremental';
  }
  return 'npx totem sync --incremental';
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

function printHookManagerGuidance(manager: HookManager, syncCmd: string): void {
  switch (manager) {
    case 'husky':
      console.log('[Totem] Detected husky. Add Totem to your post-merge hook:');
      console.log(`  echo '${syncCmd}' >> .husky/post-merge`);
      console.log('  chmod +x .husky/post-merge');
      break;
    case 'lefthook':
      console.log('[Totem] Detected lefthook. Add to your lefthook.yml:');
      console.log('  post-merge:');
      console.log('    commands:');
      console.log('      totem-sync:');
      console.log(`        run: ${syncCmd}`);
      break;
    case 'simple-git-hooks':
      console.log('[Totem] Detected simple-git-hooks. Add to your package.json:');
      console.log('  "simple-git-hooks": {');
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
  const manager = detectHookManager(cwd);

  if (manager) {
    printHookManagerGuidance(manager, syncCmd);
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

export async function installHooksCommand(): Promise<void> {
  const cwd = process.cwd();
  const rl = readline.createInterface({ input, output });

  try {
    await installPostMergeHook(cwd, rl);
  } finally {
    rl.close();
  }
}

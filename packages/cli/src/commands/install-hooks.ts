import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { resolveGitRoot } from '../git.js';

const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
const TOTEM_HOOK_END = '[totem] end post-merge';
const TOTEM_CHECKOUT_MARKER = '[totem] post-checkout hook';
const TOTEM_CHECKOUT_END = '[totem] end post-checkout';
export const TOTEM_PRECOMMIT_MARKER = '[totem] pre-commit hook';
export const TOTEM_PREPUSH_MARKER = '[totem] pre-push hook';

type HookManager = 'husky' | 'lefthook' | 'simple-git-hooks';

/**
 * Determine the package-manager fallback command for invoking totem.
 * Used inside the runtime resolve block when `totem` is not on PATH.
 *
 * Priority: pnpm > yarn > bun > npx (with package.json) > bare totem.
 */
export function getFallbackCommand(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm dlx @mmnto/cli';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn dlx @mmnto/cli';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bunx @mmnto/cli';
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'npx @mmnto/cli';
  return 'totem';
}

/** @deprecated Use {@link getFallbackCommand} instead. Kept for backwards compatibility. */
export function detectTotemPrefix(cwd: string): string {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm exec totem';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn totem';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bunx totem';
  return 'npx totem';
}

/**
 * Build a POSIX shell block that resolves the totem command at runtime.
 * Checks PATH first, falls back to package manager dlx if package.json is present.
 * Sets TOTEM_CMD="" when unavailable — callers must guard with `[ -n "$TOTEM_CMD" ]`.
 * Never exits early to avoid killing chained user hooks.
 */
export function buildResolveBlock(fallbackCmd: string): string {
  return `# Resolve totem command — prefer local workspace build over published package
if command -v totem >/dev/null 2>&1; then
  TOTEM_CMD="totem"
elif [ -f pnpm-workspace.yaml ] && pnpm exec totem --version >/dev/null 2>&1; then
  TOTEM_CMD="pnpm exec totem"
elif [ -f package.json ]; then
  TOTEM_CMD="${fallbackCmd}"
else
  echo "[Totem] totem not found in PATH and no package.json present." >&2
  TOTEM_CMD=""
fi`;
}

function buildHookContent(fallbackCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.

${buildResolveBlock(fallbackCmd)}

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing)
if [ -n "$TOTEM_CMD" ] && git diff-tree -r --name-only ORIG_HEAD HEAD 2>/dev/null | grep -q '\\.totem/lessons/'; then
  ($TOTEM_CMD sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# ${TOTEM_HOOK_END}
`;
}

export function buildPostCheckoutHookContent(fallbackCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_CHECKOUT_MARKER} — background re-index on branch switch.

# $1 = previous HEAD, $2 = new HEAD, $3 = checkout type (1=branch, 0=file)
# Skip file checkouts — only sync on branch switches
if [ "$3" = "0" ]; then
  exit 0
fi

${buildResolveBlock(fallbackCmd)}

# Handle initial checkout (null SHA) — sync if .totem/ exists
if [ "$1" = "0000000000000000000000000000000000000000" ]; then
  if [ -n "$TOTEM_CMD" ] && [ -d ".totem" ]; then
    ($TOTEM_CMD sync --incremental --quiet > .git/totem-sync.log 2>&1) &
  fi
  exit 0
fi

# Only sync when .totem/ files differ between branches
if [ -n "$TOTEM_CMD" ] && git diff --name-only "$1" "$2" 2>/dev/null | grep -q '\\.totem/'; then
  ($TOTEM_CMD sync --incremental --quiet > .git/totem-sync.log 2>&1) &
fi
# ${TOTEM_CHECKOUT_END}
`;
}

/**
 * Generate helper shell scripts under `.totem/hooks/` for hook manager integration.
 * These scripts contain the full guard logic (diff checks, null-SHA guards) that
 * bare inline commands would skip.
 */
export function generateHookHelpers(
  gitRoot: string,
  fallbackCmd: string,
  options?: { tier?: 'strict' | 'standard' },
): void {
  const hooksDir = path.join(gitRoot, '.totem', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const postMerge = buildHookContent(fallbackCmd);
  const postCheckout = buildPostCheckoutHookContent(fallbackCmd);
  const preCommit = buildPreCommitHook(options?.tier);
  const prePush = buildPrePushHook(fallbackCmd, options?.tier);

  fs.writeFileSync(path.join(hooksDir, 'post-merge.sh'), postMerge, { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, 'post-checkout.sh'), postCheckout, { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, 'pre-commit.sh'), preCommit, { mode: 0o755 });
  fs.writeFileSync(path.join(hooksDir, 'pre-push.sh'), prePush, { mode: 0o755 });
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

function printHookManagerGuidance(manager: HookManager): void {
  switch (manager) {
    case 'husky':
      console.error('[Totem] Detected husky. Add the following to your hook files:');
      console.error('');
      console.error('  # .husky/pre-commit');
      console.error('  sh .totem/hooks/pre-commit.sh');
      console.error('');
      console.error('  # .husky/pre-push');
      console.error('  sh .totem/hooks/pre-push.sh');
      console.error('');
      console.error('  # .husky/post-merge');
      console.error('  sh .totem/hooks/post-merge.sh');
      console.error('');
      console.error('  # .husky/post-checkout');
      console.error('  sh .totem/hooks/post-checkout.sh');
      break;
    case 'lefthook':
      console.error('[Totem] Detected lefthook. Add to your lefthook.yml:');
      console.error('  pre-commit:');
      console.error('    commands:');
      console.error('      totem-block-main:');
      console.error('        run: sh .totem/hooks/pre-commit.sh');
      console.error('  pre-push:');
      console.error('    commands:');
      console.error('      totem-review:');
      console.error('        run: sh .totem/hooks/pre-push.sh');
      console.error('  post-merge:');
      console.error('    commands:');
      console.error('      totem-sync:');
      console.error('        run: sh .totem/hooks/post-merge.sh');
      console.error('  post-checkout:');
      console.error('    commands:');
      console.error('      totem-sync-checkout:');
      console.error('        run: sh .totem/hooks/post-checkout.sh');
      break;
    case 'simple-git-hooks':
      console.error('[Totem] Detected simple-git-hooks. Add to your package.json:');
      console.error('  "simple-git-hooks": {');
      console.error('    "pre-commit": "sh .totem/hooks/pre-commit.sh",');
      console.error('    "pre-push": "sh .totem/hooks/pre-push.sh",');
      console.error('    "post-merge": "sh .totem/hooks/post-merge.sh",');
      console.error('    "post-checkout": "sh .totem/hooks/post-checkout.sh"');
      console.error('  }');
      break;
  }
}

export async function installPostMergeHook(
  cwd: string,
  rl: readline.Interface,
  options?: { tier?: 'strict' | 'standard' },
): Promise<void> {
  // Guard: must be a git repo — resolve root from any subdirectory
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    console.log('[Totem] Not a git repository — skipping hook installation.');
    return;
  }

  const fallbackCmd = getFallbackCommand(gitRoot);
  const manager = detectHookManager(gitRoot);

  if (manager) {
    generateHookHelpers(gitRoot, fallbackCmd, options);
    printHookManagerGuidance(manager);
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
    const appendBlock = buildHookContent(fallbackCmd)
      .replace(/^#!\/bin\/sh\n/, '')
      .trimStart();
    fs.appendFileSync(hookPath, separator + '\n' + appendBlock);
    console.log('[Totem] Appended post-merge hook to existing hook file.');
    return;
  }

  // Create new hook
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hookPath, buildHookContent(fallbackCmd));

  // Make executable (no-op on Windows, git bash handles it)
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // chmod may fail on Windows — hooks still work via git bash
  }

  console.log('[Totem] Installed post-merge hook.');
}

// ─── Agent detection snippet (POSIX-compliant) ─────────

function buildAgentDetectionBlock(): string {
  return `# Agent detection — strict enforcement for AI agents
is_agent=0
if [ -n "$CLAUDE_CODE_AGENT" ] || [ -n "$CLAUDE_VERSION" ] || [ -n "$CURSOR_TRACE_ID" ]; then is_agent=1; fi`;
}

// ─── Enforcement hooks (pre-commit + pre-push) ──────────

export function buildPreCommitHook(tier?: 'strict' | 'standard'): string {
  const effectiveTier = tier ?? 'standard';
  const strictBlock = `
# Strict mode: require spec before commit
if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
  if [ ! -f ".totem/cache/.spec-completed" ]; then
    echo "[Totem] BLOCKED: Run 'totem spec <issue>' before committing (strict mode)"
    exit 1
  fi
fi`;

  return `#!/bin/sh
# ${TOTEM_PRECOMMIT_MARKER} — block direct commits to protected branches.
# Override with: git commit --no-verify
TOTEM_HOOK_TIER="${effectiveTier}"

${buildAgentDetectionBlock()}

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "[Totem] ERROR: Direct commits to '$branch' are blocked."
  echo "[Totem] Create a feature branch: git checkout -b feat/my-feature"
  echo "[Totem] Override with: git commit --no-verify"
  exit 1
fi
${strictBlock}
`;
}

export function buildPrePushHook(fallbackCmd: string, tier?: 'strict' | 'standard'): string {
  const effectiveTier = tier ?? 'standard';
  const shieldBlock = `
  # Strict mode: require shield pass before push
  if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
    echo "[Totem] Running shield gate (strict mode)..."
    $TOTEM_CMD review || exit 1
  fi`;

  return `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — stateless enforcement.
TOTEM_HOOK_TIER="${effectiveTier}"

${buildAgentDetectionBlock()}

${buildResolveBlock(fallbackCmd)}

if [ -n "$TOTEM_CMD" ]; then
  # Verify compile manifest is current
  if [ -f ".totem/compile-manifest.json" ]; then
    if ! $TOTEM_CMD verify-manifest > /dev/null 2>&1; then
      echo "[totem] Push blocked: compile manifest is stale. Run 'totem lesson compile'." >&2
      exit 1
    fi
  fi

  # Run deterministic lint
  if [ -f ".totem/compiled-rules.json" ]; then
    if ! $TOTEM_CMD lint; then
      exit 1
    fi
  fi
${shieldBlock}
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
  force?: boolean,
): 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten' {
  const hookPath = path.join(hooksDir, hookName);

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(marker)) {
      if (force) {
        // Force overwrite — replace the entire hook with the new content
        fs.writeFileSync(hookPath, hookContent);
        try {
          fs.chmodSync(hookPath, 0o755);
        } catch {
          // chmod may fail on Windows — hooks still work via git bash
        }
        return 'overwritten';
      }
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
  preCommit: 'installed' | 'exists' | 'appended' | 'skipped' | 'skipped-non-shell' | 'overwritten';
  prePush: 'installed' | 'exists' | 'appended' | 'skipped' | 'skipped-non-shell' | 'overwritten';
}

/**
 * Install pre-commit (block main) and pre-push (totem lint) hooks.
 * Respects hook managers by printing guidance instead of writing raw hooks.
 * Returns actions taken for reporting in init summary.
 */
export async function installEnforcementHooks(
  cwd: string,
  rl: readline.Interface,
  options?: { tier?: 'strict' | 'standard' },
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
    '\nInstall git enforcement hooks (block main commits + totem lint)? (Y/n): ',
  );

  if (answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no') {
    return skip;
  }

  const fallbackCmd = getFallbackCommand(gitRoot);
  const hooksDir = path.join(gitRoot, '.git', 'hooks');

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(options?.tier),
    TOTEM_PRECOMMIT_MARKER,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(fallbackCmd, options?.tier),
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
      '[Totem] Warning: pre-push hook uses a non-shell interpreter. Manually add: totem lint',
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

    // Silently install post-checkout alongside post-merge (same guard — only if post-merge was accepted)
    const gitRoot = resolveGitRoot(cwd);
    if (gitRoot && !detectHookManager(gitRoot)) {
      const hooksDir = path.join(gitRoot, '.git', 'hooks');
      const postMerge = path.join(hooksDir, 'post-merge');
      const hasPostMerge =
        fs.existsSync(postMerge) && fs.readFileSync(postMerge, 'utf-8').includes(TOTEM_HOOK_MARKER);
      if (hasPostMerge) {
        const fallbackCmd = getFallbackCommand(gitRoot);
        installGitHook(
          hooksDir,
          'post-checkout',
          buildPostCheckoutHookContent(fallbackCmd),
          TOTEM_CHECKOUT_MARKER,
        );
      }
    }
  } finally {
    rl.close();
  }
}

// ─── Non-interactive hooks command ───────────────────

export interface HooksCommandResult {
  preCommit: 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten';
  prePush: 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten';
  postMerge: 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten';
  postCheckout: 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten';
}

/**
 * Non-interactive hook installer for `totem hooks` and `prepare` scripts.
 * Installs pre-commit, pre-push, and post-merge hooks without prompting.
 */
export function installHooksNonInteractive(
  cwd: string,
  force?: boolean,
  options?: { tier?: 'strict' | 'standard' },
): HooksCommandResult | null {
  // Guard: must be a git repo — resolve root from any subdirectory
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    return null;
  }

  const fallbackCmd = getFallbackCommand(gitRoot);

  // Hook managers handle their own installation — generate helper scripts + print guidance
  const manager = detectHookManager(gitRoot);
  if (manager) {
    generateHookHelpers(gitRoot, fallbackCmd, options);
    printHookManagerGuidance(manager);
    return null;
  }

  const hooksDir = path.join(gitRoot, '.git', 'hooks');

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(options?.tier),
    TOTEM_PRECOMMIT_MARKER,
    force,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(fallbackCmd, options?.tier),
    TOTEM_PREPUSH_MARKER,
    force,
  );

  const postMergeContent = buildHookContent(fallbackCmd);
  const postMerge = installGitHook(
    hooksDir,
    'post-merge',
    postMergeContent,
    TOTEM_HOOK_MARKER,
    force,
  );

  const postCheckoutContent = buildPostCheckoutHookContent(fallbackCmd);
  const postCheckout = installGitHook(
    hooksDir,
    'post-checkout',
    postCheckoutContent,
    TOTEM_CHECKOUT_MARKER,
    force,
  );

  return { preCommit, prePush, postMerge, postCheckout };
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
    { file: 'post-checkout', marker: TOTEM_CHECKOUT_MARKER },
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
export async function hooksCommand(opts: {
  check?: boolean;
  force?: boolean;
  strict?: boolean;
  standard?: boolean;
}): Promise<void> {
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

  // Resolve tier + pilot: CLI flag > config file > default ('standard')
  let tier: 'strict' | 'standard' | undefined;
  // Resolve tier: CLI flag > config file > default ('standard')
  try {
    const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
    loadEnv(cwd);
    const configPath = resolveConfigPath(cwd);
    if (configPath) {
      const config = await loadConfig(configPath);
      if (!opts.strict && !opts.standard) {
        tier = config.hooks?.tier;
      }
    }
  } catch (err) {
    if (process.env.TOTEM_DEBUG) {
      console.error('[Totem] Could not load config for tier resolution:', err);
    }
  }

  if (opts.strict) {
    tier = 'strict';
  } else if (opts.standard) {
    tier = 'standard';
  }

  const result = installHooksNonInteractive(cwd, opts.force, { tier });

  if (!result) {
    // Hook manager detected — guidance already printed by installHooksNonInteractive
    return;
  }

  const actions = [
    { name: 'pre-commit', status: result.preCommit },
    { name: 'pre-push', status: result.prePush },
    { name: 'post-merge', status: result.postMerge },
    { name: 'post-checkout', status: result.postCheckout },
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
      case 'overwritten':
        console.error(`[Totem] Force-overwritten ${name} hook.`);
        break;
      case 'skipped-non-shell':
        console.error(
          `[Totem] Warning: ${name} hook uses a non-shell interpreter. Integrate manually.`,
        );
        break;
    }
  }
}

// ─── Silent hook upgrade ──────────────────────────────

/**
 * Silently upgrade the pre-push hook if it was installed by Totem but uses
 * an old format (flag-checking or command-executing) instead of the new
 * stateless format that runs verify-manifest + lint directly.
 *
 * Returns true if the hook was upgraded, false otherwise.
 */
export function upgradePrePushHookIfNeeded(cwd: string): boolean {
  try {
    const gitRoot = resolveGitRoot(cwd);
    if (!gitRoot) return false;

    const hookPath = path.join(gitRoot, '.git', 'hooks', 'pre-push');
    if (!fs.existsSync(hookPath)) return false;

    const content = fs.readFileSync(hookPath, 'utf-8');

    // Only upgrade hooks that Totem owns (have our marker)
    if (!content.includes(TOTEM_PREPUSH_MARKER)) return false;

    // Already on the new stateless format — no upgrade needed
    if (content.includes('verify-manifest')) return false;

    // Splice only the totem-managed block, preserving any user-appended content.
    const markerIdx = content.indexOf(`# ${TOTEM_PREPUSH_MARKER}`);
    if (markerIdx === -1) return false;

    // Find the end of the totem block by balancing if/fi depth.
    // Track the LAST balanced fi at depth 0 to handle multi-block hooks
    // (e.g. resolve block + guard block).
    const afterMarker = content.slice(markerIdx);
    const ifFiPattern = /^\s*(if\s|fi\s*$)/gm;
    let depth = 0;
    let endOffset = -1;
    let firstIfFound = false;
    let match;

    // totem-context: RegExp.exec, not child_process
    while ((match = ifFiPattern.exec(afterMarker)) !== null) {
      const keyword = match[1]!.trim();
      if (keyword.startsWith('if')) {
        if (!firstIfFound) firstIfFound = true;
        depth++;
      } else if (keyword === 'fi' && firstIfFound) {
        depth--;
      }
      if (firstIfFound && depth === 0) {
        endOffset = match.index + match[0].length;
        break;
      }
    }

    if (endOffset === -1) return false;

    const blockEnd = markerIdx + endOffset;

    const fallbackCmd = getFallbackCommand(gitRoot);

    // Build the replacement block (strip shebang — we're splicing into existing file)
    const newBlock = buildPrePushHook(fallbackCmd)
      .replace(/^#!\/bin\/sh\n/, '')
      .trimStart();

    // Splice: preserve everything before and after the totem block
    const before = content.slice(0, markerIdx);
    const after = content.slice(blockEnd);
    const upgraded = before + newBlock.trimEnd() + after;

    fs.writeFileSync(hookPath, upgraded);

    try {
      fs.chmodSync(hookPath, 0o755);
    } catch {
      // chmod may fail on Windows — hooks still work via git bash
    }

    return true;
  } catch {
    // Silent upgrade is best-effort — never crash review for a hook upgrade failure
    return false;
  }
}

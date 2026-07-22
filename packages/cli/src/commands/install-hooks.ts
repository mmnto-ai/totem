import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { resolveGitRoot } from '../git.js';

export const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
export const TOTEM_HOOK_END = '[totem] end post-merge';
export const TOTEM_CHECKOUT_MARKER = '[totem] post-checkout hook';
export const TOTEM_CHECKOUT_END = '[totem] end post-checkout';
export const TOTEM_PRECOMMIT_MARKER = '[totem] pre-commit hook';
export const TOTEM_PRECOMMIT_END = '[totem] end pre-commit';
export const TOTEM_PREPUSH_MARKER = '[totem] pre-push hook';
export const TOTEM_PREPUSH_END = '[totem] end pre-push';

type HookManager = 'husky' | 'lefthook' | 'simple-git-hooks';

// ─── Hooks-directory resolution (mmnto-ai/totem#2418) ─────────

/**
 * Resolve the git hooks directory for `gitRoot`. In a plain checkout this is
 * `.git/hooks`, but in a linked worktree (or submodule) `.git` is a FILE
 * (`gitdir: <path>` pointer) and hooks live under the resolved git dir — shared
 * across worktrees via `commondir` — so a blind `.git/hooks` join makes
 * `mkdirSync` crash with ENOTDIR (mmnto-ai/totem#2418; the owner-repo
 * `tools/install-hooks.js` variant already discriminates). Resolution is
 * delegated to `git rev-parse --git-path hooks` — git's own worktree/commondir
 * walk, which also honors `core.hooksPath` — with a filesystem probe as the
 * offline fallback for the plain-directory layout. Returns null when no hooks
 * directory can be resolved: the #2410 declared-skip class — callers skip
 * loudly instead of guessing a path.
 */
export function resolveHooksDir(gitRoot: string): string | null {
  // Raw spawnSync (the doctor.ts idiom): a builtin, so the heavy core barrel
  // stays off the CLI cold-start graph, and a failed invocation reports via
  // `status`/`error` instead of throwing — the probe below is the fallback.
  const resolved = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: gitRoot,
    encoding: 'utf-8',
  });
  if (resolved.status === 0 && resolved.stdout && resolved.stdout.trim()) {
    // git prints forward slashes even on Windows, and a repo-relative path in
    // the common case — normalize and anchor at the git root.
    const hooksDir = path.resolve(gitRoot, path.normalize(resolved.stdout.trim()));
    // `core.hooksPath` can aim hooks at a non-directory (the /dev/null
    // hooks-disabled idiom) — an existing non-directory can never receive hook
    // files, so it joins the declared-skip class instead of crashing the write
    // (#2422 review round).
    if (fs.existsSync(hooksDir) && !fs.statSync(hooksDir).isDirectory()) {
      return null;
    }
    return hooksDir;
  }
  const gitPath = path.join(gitRoot, '.git');
  if (fs.existsSync(gitPath) && fs.statSync(gitPath).isDirectory()) {
    return path.join(gitPath, 'hooks');
  }
  // `.git` is a pointer file git could not resolve for us — never guess.
  return null;
}

/** Skip line shared by every caller that hits an unresolvable hooks directory. */
const HOOKS_DIR_UNRESOLVED_MSG =
  '[Totem] .git is not a directory or a resolvable gitdir pointer — skipping git hook installation.';

/**
 * Whether `err` (typically the TotemGitError thrown by `resolveGitRoot`) stems
 * from a malformed `.git` pointer FILE — git's `fatal: invalid gitfile format`.
 * This is the "unparseable gitdir pointer (worktree/submodule)" member of the
 * #2410 declared-skip class: `totem hook install` must exit 0 on it, not
 * propagate a crash into the consumer's `prepare` lifecycle
 * (mmnto-ai/totem#2418). Walks the cause chain the same bounded way core's
 * not-a-git-repo matcher does.
 */
function isUnparseableGitFileError(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; depth < 5 && cursor !== undefined && cursor !== null; depth++) {
    const text = cursor instanceof Error ? cursor.message : String(cursor);
    if (/invalid gitfile format/i.test(text)) return true;
    cursor = cursor instanceof Error ? cursor.cause : undefined;
  }
  return false;
}

/**
 * `resolveGitRoot` for hook-install paths: maps the malformed `.git` pointer
 * FILE to `{ gitRoot: null, unparseablePointer: true }` instead of letting the
 * throw reach `handleError` → exit 1 — EVERY hook-install entry point owes the
 * #2410 declared skip on it, including the hidden legacy `totem install-hooks`
 * command and the direct `installHooksNonInteractive` API (#2422 review round:
 * only `hooksCommand` was guarded). All other failures stay fail-loud.
 *
 * Exported so the hook-REMOVAL path (`eject`) resolves the git root the SAME way
 * every install entry point does, instead of hand-rolling a second resolver
 * (mmnto-ai/totem#2426).
 */
export function resolveGitRootForHookPath(cwd: string): {
  gitRoot: string | null;
  unparseablePointer: boolean;
} {
  try {
    return { gitRoot: resolveGitRoot(cwd), unparseablePointer: false };
  } catch (err) {
    if (isUnparseableGitFileError(err)) return { gitRoot: null, unparseablePointer: true };
    throw err;
  }
}

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
 *
 * Prefers the lockfile-pinned / in-tree build over a volatile ambient global
 * (mmnto-ai/totem#2053; Tenet 14 — never tie governance to volatile state). Order:
 * workspace-HEAD > pinned `node_modules/@mmnto/cli` > `pnpm exec` > PATH global > dlx fallback.
 * Each pinned tier is identity-guarded on the `@mmnto/cli` package (not a bare `totem` bin name,
 * which a colliding package could shadow).
 * A stale global shadowing a newer workspace build is the `lesson-1ef06d16` foot-gun this
 * order prevents. Sets TOTEM_CMD="" when unavailable — callers must guard with
 * `[ -n "$TOTEM_CMD" ]`. Never exits early, to avoid killing chained user hooks.
 */
export function buildResolveBlock(fallbackCmd: string): string {
  return `# Resolve totem — prefer the pinned / in-tree build over a volatile ambient global
# (mmnto-ai/totem#2053). Order: workspace-HEAD > pinned @mmnto/cli > pnpm exec > PATH > dlx.
if [ -f packages/cli/dist/index.js ] && grep -q '"name": *"@mmnto/cli"' packages/cli/package.json 2>/dev/null; then
  TOTEM_CMD="node packages/cli/dist/index.js"
elif [ -f node_modules/@mmnto/cli/dist/index.js ]; then
  TOTEM_CMD="node node_modules/@mmnto/cli/dist/index.js"
elif [ -f pnpm-workspace.yaml ] && pnpm exec totem --version >/dev/null 2>&1; then
  TOTEM_CMD="pnpm exec totem"
elif command -v totem >/dev/null 2>&1; then
  TOTEM_CMD="totem"
elif [ -f package.json ]; then
  TOTEM_CMD="${fallbackCmd}"
else
  echo "[Totem] totem not found in PATH and no package.json present." >&2
  TOTEM_CMD=""
fi`;
}

export function buildHookContent(fallbackCmd: string): string {
  return `#!/bin/sh
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.

${buildResolveBlock(fallbackCmd)}

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing).
# The trailing -- terminates the revision list so a ref/path ambiguity can never
# reinterpret ORIG_HEAD/HEAD as pathspecs.
if [ -n "$TOTEM_CMD" ] && git diff-tree -r --name-only ORIG_HEAD HEAD -- 2>/dev/null | grep -q '\\.totem/lessons/'; then
  # Resolve the real git dir so the sync-log redirect works in a linked worktree,
  # where .git is a FILE (gitdir: pointer), not a directory (mmnto-ai/totem#2376).
  GIT_DIR_RESOLVED=$(git rev-parse --git-dir 2>/dev/null || echo .git)
  ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
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

# Resolve the real git dir so the sync-log redirect works in a linked worktree,
# where .git is a FILE (gitdir: pointer), not a directory (mmnto-ai/totem#2376).
GIT_DIR_RESOLVED=$(git rev-parse --git-dir 2>/dev/null || echo .git)

# Handle initial checkout (null SHA) — sync if .totem/ exists
if [ "$1" = "0000000000000000000000000000000000000000" ]; then
  if [ -n "$TOTEM_CMD" ] && [ -d ".totem" ]; then
    ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
  fi
  exit 0
fi

# Only sync when .totem/ files differ between branches. The trailing -- terminates
# the revision list so the "$1"/"$2" SHAs can never be reinterpreted as pathspecs.
if [ -n "$TOTEM_CMD" ] && git diff --name-only "$1" "$2" -- 2>/dev/null | grep -q '\\.totem/'; then
  ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
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
  // Guard: must be a git repo — resolve root from any subdirectory. A malformed
  // `.git` pointer file is the same declared-skip class, not a crash (#2422 round:
  // the legacy `totem install-hooks` path previously let it reach handleError).
  const { gitRoot, unparseablePointer } = resolveGitRootForHookPath(cwd);
  if (!gitRoot) {
    console.error(
      unparseablePointer
        ? HOOKS_DIR_UNRESOLVED_MSG
        : '[Totem] Not a git repository — skipping hook installation.',
    );
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

  const hooksDir = resolveHooksDir(gitRoot);
  if (!hooksDir) {
    // stderr like every other skip/diagnostic line (#2422 round: stream parity).
    console.error(HOOKS_DIR_UNRESOLVED_MSG);
    return;
  }
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
if [ -n "$CLAUDE_CODE_AGENT" ] || [ -n "$CLAUDE_VERSION" ] || [ -n "$CURSOR_TRACE_ID" ]; then
  is_agent=1
fi`;
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
# ${TOTEM_PRECOMMIT_END}
`;
}

export function buildPrePushHook(fallbackCmd: string, tier?: 'strict' | 'standard'): string {
  const effectiveTier = tier ?? 'standard';
  // Strict-tier gate per Proposal 273 § 6 Q2 (mmnto-ai/totem#1908): operator-invoked
  // is the default for new checks while behavior calibrates. Doctor's `--strict`
  // mode gates on repo-state `fail` results; unconditional firing would break
  // cohort consumers mid-migration. Wired inside the existing `is_agent` /
  // `TOTEM_HOOK_TIER=strict` guard alongside the shield gate.
  const shieldBlock = `
  # Strict mode: require doctor repo-state + shield pass before push
  if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
    echo "[Totem] Running doctor --strict (repo-state gate)..."
    $TOTEM_CMD doctor --strict || exit 1
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

  # Verify shields.io badges in README.md (mmnto-ai/totem#1926 — deterministic claim-discipline)
  if [ -f "README.md" ] && [ -f ".totem/compiled-rules.json" ]; then
    if ! $TOTEM_CMD verify-badges; then
      exit 1
    fi
  fi

  # Verify lockfile-sync (mmnto-ai/totem#1961 — block caret bumps committed
  # without a regenerated pnpm-lock.yaml). Gate is universally applicable to
  # any repo that tracks pnpm-lock.yaml; pre-conditions are checked inside
  # the command (lockfile tracked + diff range resolvable). Slotted before
  # the WWND claim-discipline gate so this mechanical fast-fail runs before
  # the slower prose-discipline walk.
  if [ -f "pnpm-lock.yaml" ]; then
    if ! $TOTEM_CMD verify-lockfile-sync; then
      exit 1
    fi
  fi

  # WWND claim-discipline gate (Proposal 279 § Implementation Notes Q3 —
  # slot after verify-badges; gates on public-surface absolute promises,
  # missing-Goal-prefix, covenant-without-backing). Fires only when at
  # least one in-scope surface exists. Bypass with mandatory justification:
  #   TOTEM_GATE_BYPASS_JUSTIFICATION="<reason>" git push
  if [ -f ".totem/compiled-rules.json" ] && { [ -f "README.md" ] || [ -f "AGENTS.md" ] || [ -f "design-tenets.md" ] || [ -d "docs/wiki" ]; }; then
    # --scope-to-diff (mmnto-ai/totem#2002): narrow the WWND scan to files
    # touched in the current push diff. Eliminates the standing-gate
    # false-positive class where pre-existing warnings on in-scope surfaces
    # (e.g. docs/wiki/governing-ai-agents.md) fire on diffs that don't touch
    # those files. The flag falls back to a full scan if diff resolution
    # fails (no upstream + no HEAD~1 — fresh/detached state).
    #
    # Defensive degrade: the hook MUST work when \$TOTEM_CMD resolves to an
    # older CLI that doesn't yet ship --scope-to-diff (PATH-resolved global
    # @mmnto/cli predates 1.47.0; cohort bootstrap window). Probe \`--help\`
    # for flag support; fall back to the full standing scan if absent.
    if $TOTEM_CMD doctor --claim-discipline --help 2>/dev/null | grep -q -- '--scope-to-diff'; then
      if ! $TOTEM_CMD doctor --claim-discipline --strict --scope-to-diff; then
        exit 1
      fi
    else
      echo "[totem] Hook running in compat mode (CLI <1.47.0); 'npm i -g @mmnto/cli@latest' enables --scope-to-diff defense." >&2
      if ! $TOTEM_CMD doctor --claim-discipline --strict; then
        exit 1
      fi
    fi
  fi
${shieldBlock}
fi

# Format check — catch unformatted files before CI does
# Only runs if the project defines a format:check script (no workflow opinions)
# Detects package manager from lockfile presence
if [ -f "package.json" ]; then
  FORMAT_CMD=""
  if [ -f "pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
    FORMAT_CMD="pnpm run"
  elif [ -f "yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
    FORMAT_CMD="yarn run"
  elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    command -v bun >/dev/null 2>&1 && FORMAT_CMD="bun run"
  elif command -v npm >/dev/null 2>&1; then
    FORMAT_CMD="npm run"
  fi

  if [ -n "$FORMAT_CMD" ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['format:check'] ? 0 : 1)" 2>/dev/null; then
    if $FORMAT_CMD format:check > /dev/null 2>&1; then
      : # pass
    else
      echo "[totem] ❌ Formatting check failed. Run '$FORMAT_CMD format' to fix." >&2
      exit 1
    fi
  fi
fi
# ${TOTEM_PREPUSH_END}
`;
}

const SHELL_SHEBANG_RE = /^#!\/bin\/(ba)?sh|^#!\/usr\/bin\/env\s+(ba)?sh/;

// Only a shebang line plus the start of the marker comment may precede an owned
// whole-file hook (`#!/bin/sh` then `# <marker> …`). Used to distinguish a
// totem-generated whole file from a user hook with a totem block appended after
// their own content. Mirrors core's isOwnedGeneratedFile shell-hook branch.
const OWNED_WHOLE_FILE_PREAMBLE_RE = /^#![^\n]*\n#[ \t]*$/;

/** POSIX executable mode for git hooks (rwxr-xr-x). */
const HOOK_EXECUTABLE_MODE = 0o755;

/**
 * Write a hook file and mark it executable. On POSIX the chmod failure propagates
 * (Tenet 4 — a hook git cannot execute must fail loud, never silently report
 * `installed`). On Windows the exec bit is skipped explicitly: git-bash owns the
 * executable bit there, and NTFS has no POSIX mode to set.
 */
function writeExecutableHook(hookPath: string, content: string): void {
  fs.writeFileSync(hookPath, content);
  if (process.platform !== 'win32') {
    fs.chmodSync(hookPath, HOOK_EXECUTABLE_MODE);
  }
}

/**
 * Whether an existing hook is a totem-OWNED whole file (generated verbatim by a
 * `build*Hook` template) rather than a user hook with a totem block appended into
 * it. Ownership is the precondition for a no-force drift-repair overwrite: only a
 * whole file totem itself authored may be replaced without `--force`.
 *
 * A bounded totem region is REQUIRED — all four hook templates now emit both a
 * start marker and an end marker, so `endMarker` is a required parameter:
 *   - The totem marker must open the file (only a shebang + comment-start before it),
 *     so no user content precedes the block.
 *   - The end marker must be present. A LEGACY hook written by an old template that
 *     predates the pre-commit / pre-push end markers carries no in-file end marker →
 *     NOT owned → drift-repair declines and the hook takes the one
 *     `totem hook install --force` the changeset prescribes (after which the
 *     regenerated file carries the end marker and self-repair works bounded).
 *   - The user must not have added content AFTER the totem end marker — a whole-file
 *     overwrite would clobber it, so such a file is NOT owned (only trailing
 *     whitespace may follow the end marker).
 */
function isTotemOwnedWholeFile(content: string, marker: string, endMarker: string): boolean {
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  const before = content.slice(0, idx);
  if (before.trim().length !== 0 && !OWNED_WHOLE_FILE_PREAMBLE_RE.test(before)) {
    return false;
  }
  const end = content.indexOf(endMarker, idx + marker.length);
  // Start marker present but end marker missing → region cannot be bounded →
  // not safe to whole-file overwrite without --force (also the legacy-hook path).
  if (end === -1) return false;
  if (content.slice(end + endMarker.length).trim().length !== 0) return false;
  return true;
}

/**
 * Install a single git hook with idempotency and chain preservation.
 * Returns the action taken.
 *
 * When the hook already carries the totem marker and `force` is not set, a
 * totem-OWNED whole file whose content has drifted from the regenerated canonical
 * is repaired in place (`overwritten`) — this makes bare `totem hook install`
 * actually fix a stale hook, so the doctor's drift remediation is truthful
 * (mmnto-ai/totem#2138). A user hook with an appended totem block is left untouched
 * (`exists`); overwriting it still requires `--force`. `endMarker` bounds the totem
 * region so appended user content downstream of it is never clobbered; all four hook
 * templates now emit one. Drift-repair fires only when the caller threads the end
 * marker AND the on-disk hook carries it — a legacy pre-end-marker hook declines to
 * `exists` and takes one `totem hook install --force`.
 */
export function installGitHook(
  hooksDir: string,
  hookName: string,
  hookContent: string,
  marker: string,
  force?: boolean,
  endMarker?: string,
): 'installed' | 'exists' | 'appended' | 'skipped-non-shell' | 'overwritten' {
  const hookPath = path.join(hooksDir, hookName);

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes(marker)) {
      if (force) {
        // Force overwrite — replace the entire hook with the new content
        writeExecutableHook(hookPath, hookContent);
        return 'overwritten';
      }
      // Drift-repair (mmnto-ai/totem#2138): a totem-owned whole file that no longer
      // matches the regenerated canonical is upgraded without --force. A file that
      // already matches, or a user hook with an appended totem block, is left as-is.
      // A bounded region is mandatory: the caller must thread the end marker AND the
      // on-disk hook must carry it, so a call site that omits it (or a legacy hook
      // missing the in-file end marker) declines to `exists` and takes one --force.
      if (
        existing !== hookContent &&
        endMarker !== undefined &&
        isTotemOwnedWholeFile(existing, marker, endMarker)
      ) {
        writeExecutableHook(hookPath, hookContent);
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
  writeExecutableHook(hookPath, hookContent);

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

  // Guard: must be a git repo — resolve root from any subdirectory. Both skip
  // classes stay silent here: installPostMergeHook always runs next in the two
  // callers (init + the legacy install-hooks command) and prints the one line.
  const { gitRoot } = resolveGitRootForHookPath(cwd);
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

  const hooksDir = resolveHooksDir(gitRoot);
  if (!hooksDir) {
    // stderr like every other skip/diagnostic line (#2422 round: stream parity).
    console.error(HOOKS_DIR_UNRESOLVED_MSG);
    return skip;
  }
  const fallbackCmd = getFallbackCommand(gitRoot);

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(options?.tier),
    TOTEM_PRECOMMIT_MARKER,
    undefined,
    TOTEM_PRECOMMIT_END,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(fallbackCmd, options?.tier),
    TOTEM_PREPUSH_MARKER,
    undefined,
    TOTEM_PREPUSH_END,
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

    // Silently install post-checkout alongside post-merge (same guard — only if
    // post-merge was accepted). Bad-pointer skip stays silent: installPostMergeHook
    // above already printed the line.
    const { gitRoot } = resolveGitRootForHookPath(cwd);
    const hooksDir = gitRoot ? resolveHooksDir(gitRoot) : null;
    if (gitRoot && hooksDir && !detectHookManager(gitRoot)) {
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
          undefined,
          TOTEM_CHECKOUT_END,
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
  // Guard: must be a git repo — resolve root from any subdirectory. Not-a-repo
  // stays a silent null (the documented contract — callers print); the malformed
  // pointer prints its declared-skip line here so a direct API caller honors the
  // #2410 contract without hooksCommand's pre-guard (#2422 round).
  const { gitRoot, unparseablePointer } = resolveGitRootForHookPath(cwd);
  if (!gitRoot) {
    if (unparseablePointer) console.error(HOOKS_DIR_UNRESOLVED_MSG);
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

  const hooksDir = resolveHooksDir(gitRoot);
  if (!hooksDir) {
    // Unresolvable hooks dir (worktree/submodule pointer git could not follow) —
    // the #2410 declared-skip class: report and exit 0, never mkdir '.git/hooks'
    // blind (the mmnto-ai/totem#2418 ENOTDIR crash).
    console.error(HOOKS_DIR_UNRESOLVED_MSG);
    return null;
  }

  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook(options?.tier),
    TOTEM_PRECOMMIT_MARKER,
    force,
    TOTEM_PRECOMMIT_END,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook(fallbackCmd, options?.tier),
    TOTEM_PREPUSH_MARKER,
    force,
    TOTEM_PREPUSH_END,
  );

  const postMergeContent = buildHookContent(fallbackCmd);
  const postMerge = installGitHook(
    hooksDir,
    'post-merge',
    postMergeContent,
    TOTEM_HOOK_MARKER,
    force,
    TOTEM_HOOK_END,
  );

  const postCheckoutContent = buildPostCheckoutHookContent(fallbackCmd);
  const postCheckout = installGitHook(
    hooksDir,
    'post-checkout',
    postCheckoutContent,
    TOTEM_CHECKOUT_MARKER,
    force,
    TOTEM_CHECKOUT_END,
  );

  return { preCommit, prePush, postMerge, postCheckout };
}

/**
 * Check that all Totem hooks are installed. Returns true if all present.
 */
export function checkHooksInstalled(cwd: string): boolean {
  // Malformed pointer → false like not-a-repo: a verify that cannot locate the
  // hooks has nothing to certify (hooksCommand's pre-guard already declared the
  // skip on the CLI --check path).
  const { gitRoot } = resolveGitRootForHookPath(cwd);
  if (!gitRoot) {
    return false;
  }
  const hooksDir = resolveHooksDir(gitRoot);
  if (!hooksDir) {
    console.error('[Totem] Git hooks directory could not be resolved — cannot check hooks.');
    return false;
  }

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

  // Resolve git root once — guards both --check and install paths. A malformed
  // `.git` pointer FILE is the "unparseable gitdir pointer (worktree/submodule)"
  // member of the #2410 declared-skip class: exit 0 with a truthful skip line
  // instead of crashing the consumer's `prepare` lifecycle (mmnto-ai/totem#2418).
  const { gitRoot, unparseablePointer } = resolveGitRootForHookPath(cwd);
  if (!gitRoot) {
    console.error(
      unparseablePointer
        ? HOOKS_DIR_UNRESOLVED_MSG
        : '[Totem] Not a git repository — skipping hook installation.',
    );
    return;
  }

  if (opts.check) {
    const ok = checkHooksInstalled(cwd);
    if (ok) {
      console.error('[Totem] All hooks installed.');
    } else {
      console.error('[Totem] Some hooks are missing. Run `totem hook install` to install.');
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

  // The git-hook summary prints ONLY when git hooks were actually written. A null
  // result means a hook manager (husky/lefthook) was detected and
  // installHooksNonInteractive already printed its guidance — but this MUST NOT
  // early-return: the managed session hooks below are Claude/Gemini artifacts,
  // independent of any git-hook manager, and must still be regenerated (a
  // hook-manager repo otherwise recreates the lc#806 stale-session-hook class).
  if (result) {
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
          // `installGitHook` returns `overwritten` for BOTH a forced overwrite and a
          // bare (no-force) drift-repair of a totem-owned bounded region. Print the
          // truthful cause: "Force-overwritten" ONLY when --force was actually passed,
          // "Drift-repaired" for the bare bounded self-repair (mmnto-ai/totem#2410 —
          // fixes the misleading always-"Force-overwritten" message).
          console.error(
            opts.force
              ? `[Totem] Force-overwritten ${name} hook.`
              : `[Totem] Drift-repaired ${name} hook (totem-owned bounded region).`,
          );
          break;
        case 'skipped-non-shell':
          console.error(
            `[Totem] Warning: ${name} hook uses a non-shell interpreter. Integrate manually.`,
          );
          break;
      }
    }
  }

  // ── Managed session-hook regeneration (mmnto-ai/totem#2410 PR-A slice 3) ──
  // Runs on BOTH the manager and no-manager paths (the `if (result)` above only
  // gates the git-hook summary): the `.claude/hooks/*.cjs` and `.gemini/hooks/*.js`
  // artifacts are Claude/Gemini hooks, not git hooks, so they are regenerated
  // whether or not a git-hook manager (husky/lefthook) is in play. The `--check`
  // and not-a-git-repo paths already returned above, so this never fires for the
  // read-only verify or the honest-skip. Regenerate-only-if-present: creation stays
  // with `totem init`; this verb repairs drift in artifacts the repo already adopted.
  await printManagedSessionHookSummary(gitRoot, opts.force);
}

// ─── Managed session-hook regeneration (mmnto-ai/totem#2410 PR-A) ─────

/**
 * The action taken on one managed session-hook artifact by
 * {@link regenerateManagedSessionHooks}:
 *   - `exists`      — present, marker-headed, already byte-identical to canonical (no write).
 *   - `overwritten` — regenerated: a bare bounded drift-repair OR a `--force` overwrite.
 *   - `declined`    — marker present but the region is NOT bounded-owned (legacy file
 *                     with no end marker, or user content after the end marker) and no
 *                     `--force`: left untouched, takes one `totem hook install --force`.
 *   - `skipped`     — a user-owned file carrying NO totem marker at all: never touched,
 *                     not even under `--force`.
 */
export type ManagedSessionHookAction = 'exists' | 'overwritten' | 'declined' | 'skipped';

export interface ManagedSessionHookResult {
  /** Repo-relative path of the artifact. */
  file: string;
  action: ManagedSessionHookAction;
}

/**
 * Walk the {@link MANAGED_SESSION_HOOKS} roster and regenerate the whole-file
 * session-hook artifacts (`.claude/hooks/*.cjs`, `.gemini/hooks/*.js`) that EXIST
 * under `cwd`, applying the #2406 bounded-ownership semantics generalized to the
 * JS/CJS hook family:
 *
 *   - Missing file            → not created (creation is `totem init`'s job); omitted
 *                               from the results entirely.
 *   - Marker + identical      → `exists` (already current).
 *   - Marker + drifted, bounded totem-owned whole file → bare drift-repair
 *                               (`overwritten`), or `--force` → `overwritten`.
 *   - Marker + drifted, unbounded (legacy no-end-marker / trailing user content):
 *                               bare → `declined`; `--force` → `overwritten`.
 *   - Marker does not OPEN the file (no marker, or a merely-quoted marker) →
 *                               `skipped` even under `--force` (never clobber a
 *                               user-owned file).
 *
 * Regenerate-only-if-present, single-writer per invocation. A write failure
 * (perms/FS) PROPAGATES (Tenet 4 — a hook the tool cannot write must fail loud,
 * never silently report success), mirroring `installGitHook`.
 */
export async function regenerateManagedSessionHooks(
  cwd: string,
  force?: boolean,
): Promise<ManagedSessionHookResult[]> {
  // Dynamic-import the roster (large canonical template strings) + the shared
  // ownership helpers so init-templates stays off the CLI cold-start graph
  // (packages/cli lazy-load guideline; mirrors doctor-parity.ts's own import).
  // `isBoundedOwnedFile` is the single shared session-hook ownership checker
  // (mmnto-ai/totem#2413 — was a divergent twin of init's local copy).
  const { MANAGED_SESSION_HOOKS, isBoundedOwnedFile, markerOpensFile } =
    await import('./init-templates.js');

  const results: ManagedSessionHookResult[] = [];
  for (const { rel, content, marker, endMarker } of MANAGED_SESSION_HOOKS) {
    const filePath = path.join(cwd, ...rel.split('/'));
    if (!fs.existsSync(filePath)) {
      // Regenerate-only-if-present: never create a session hook the repo opted out of.
      continue;
    }
    const existing = fs.readFileSync(filePath, 'utf-8');

    // Positional ownership gate (mmnto-ai/totem#2413): the marker must OPEN the file.
    // A user-owned file with NO marker — or one that merely QUOTES the marker string in
    // a comment/string — is never touched, not even under --force. (The old
    // `includes(marker)` gate let a quoting user file be clobbered by --force, breaking
    // the "no marker → never touched, even forced" contract.)
    if (!markerOpensFile(existing, marker)) {
      results.push({ file: rel, action: 'skipped' });
      continue;
    }

    if (existing === content) {
      results.push({ file: rel, action: 'exists' });
      continue;
    }

    // Content differs. --force overwrites any marker-headed file (bounded or not);
    // a bare run repairs only a bounded totem-OWNED whole file, and declines the rest.
    if (force || isBoundedOwnedFile(existing, marker, endMarker)) {
      fs.writeFileSync(filePath, content, 'utf-8');
      results.push({ file: rel, action: 'overwritten' });
    } else {
      results.push({ file: rel, action: 'declined' });
    }
  }
  return results;
}

/**
 * Regenerate the managed session hooks and print one summary line per artifact,
 * mirroring the git-hook summary. The `overwritten` line distinguishes a forced
 * overwrite from a bare bounded drift-repair (same truthful split the git-hook
 * summary uses).
 */
async function printManagedSessionHookSummary(cwd: string, force?: boolean): Promise<void> {
  const results = await regenerateManagedSessionHooks(cwd, force);
  for (const { file, action } of results) {
    switch (action) {
      case 'exists':
        console.error(`[Totem] ${file} session hook already current.`);
        break;
      case 'overwritten':
        console.error(
          force
            ? `[Totem] Force-overwritten ${file} session hook.`
            : `[Totem] Drift-repaired ${file} session hook (totem-owned bounded region).`,
        );
        break;
      case 'declined':
        console.error(
          `[Totem] ${file} session hook has drifted but is not a bounded totem-owned region — run \`totem hook install --force\` to regenerate.`,
        );
        break;
      case 'skipped':
        console.error(`[Totem] ${file}: user-owned file (no Totem marker) — left untouched.`);
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

    const hooksDir = resolveHooksDir(gitRoot);
    if (!hooksDir) return false;

    const hookPath = path.join(hooksDir, 'pre-push');
    if (!fs.existsSync(hookPath)) return false;

    const content = fs.readFileSync(hookPath, 'utf-8');

    // Only upgrade hooks that Totem owns (have our marker)
    if (!content.includes(TOTEM_PREPUSH_MARKER)) return false;

    // Already on the new stateless format — no upgrade needed.
    // SAFETY INVARIANT: old hooks (pre-verify-manifest) have a single top-level
    // if/fi block and no agent detection. The parser below relies on this — it
    // stops at the first balanced fi. If this guard is ever removed, the parser
    // must be updated to handle multi-block hooks (see extractTotemBlock in tests).
    if (content.includes('verify-manifest')) return false;

    // Splice only the totem-managed block, preserving any user-appended content.
    const markerIdx = content.indexOf(`# ${TOTEM_PREPUSH_MARKER}`);
    if (markerIdx === -1) return false;

    // Find the end of the old totem block by balancing if/fi depth.
    // Old hooks have one top-level if/fi block; we stop at its closing fi.
    // Skip inline `if ... fi` on a single line — they don't change depth.
    const afterMarker = content.slice(markerIdx);
    const lines = afterMarker.split('\n');
    let depth = 0;
    let endOffset = -1;
    let firstIfFound = false;
    let charOffset = 0;

    for (const line of lines) {
      const trimmed = line.trimStart();
      const isInlineIfFi = /^if\s.*;\s*fi\s*$/.test(trimmed);

      if (!isInlineIfFi) {
        if (/^if\s/.test(trimmed)) {
          if (!firstIfFound) firstIfFound = true;
          depth++;
        } else if (/^fi\s*$/.test(trimmed) && firstIfFound) {
          depth--;
        }
      }

      if (firstIfFound && depth === 0 && /^fi\s*$/.test(trimmed)) {
        endOffset = charOffset + line.length;
        break;
      }
      charOffset += line.length + 1;
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

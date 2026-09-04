import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

// totem-context: mmnto-ai/totem#2753 — the rule's startup-cost premise does not apply to THIS module, because `install-hooks.js` is reached only through `await import` (index.ts, index-lite.ts, doctor.ts, doctor-parity.ts, eject.ts, init.ts, shield.ts), so it is never on the `--help` graph, and the core barrel is already in its static graph via `../git.js` (`import { safeExec } from '@mmnto/totem'`) and `../artifact-vocabulary.js`. The dynamic form is also unavailable: `isAttestedTrailer` is a SYNCHRONOUS exported predicate by contract and `installGitHook` is synchronous, so the only alternative would be duplicating core's `parseForkMarker` regex in the CLI — the divergence the shared parser exists to prevent.
import { parseForkMarker, writeFileAtomicSync } from '@mmnto/totem';

import {
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_RECORD,
  PROMPT_SOURCE_OVERRIDE,
} from '../artifact-vocabulary.js';
import { resolveGitRoot } from '../git.js';
import { SPEC_REQUIRED_SECTIONS } from './spec-templates.js';

export const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
export const TOTEM_HOOK_END = '[totem] end post-merge';
export const TOTEM_CHECKOUT_MARKER = '[totem] post-checkout hook';
export const TOTEM_CHECKOUT_END = '[totem] end post-checkout';
export const TOTEM_PRECOMMIT_MARKER = '[totem] pre-commit hook';
export const TOTEM_PRECOMMIT_END = '[totem] end pre-commit';
export const TOTEM_PREPUSH_MARKER = '[totem] pre-push hook';
export const TOTEM_PREPUSH_END = '[totem] end pre-push';

/**
 * Hex characters of each sha256 the strict reader's record SENSOR shows when
 * a bound record has been revised (mmnto-ai/totem#2700). Identity at a glance,
 * not a full digest — the comparison itself is over the whole hash.
 */
const RECORD_HASH_DISPLAY_PREFIX = 8;

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

// ─── Hook render options (mmnto-ai/totem#2692) ────────────────

/** The `totemDir` every hook renders when the repo configures none. */
export const DEFAULT_TOTEM_DIR = '.totem';

/**
 * Everything the four hook templates render FROM.
 *
 * Every field is REQUIRED on purpose. A defaulted parameter is exactly how a
 * writer keeps rendering `.totem` under a repo that configured something else —
 * the mmnto-ai/totem#2692 class, where the strict pre-commit reader and `totem
 * spec`'s writer named different trees and the gate failed closed forever. With
 * no default, the compiler forces every call site to thread the resolved value.
 */
export interface HookRenderOptions {
  /** Enforcement tier the hook is generated at. */
  tier: 'strict' | 'standard';
  /** Repo-relative Totem directory the hook must name (config `totemDir`). */
  totemDir: string;
  /** Package-manager fallback invocation for the runtime resolve block. */
  fallbackCmd: string;
}

/** {@link HookRenderOptions} plus the config file they were derived from. */
export interface ResolvedHookRenderOptions extends HookRenderOptions {
  /** Set when `tier` was PINNED by an explicit flag or by `hooks.tier` in config,
   *  rather than falling through to the `'standard'` default. Callers that rewrite
   *  an EXISTING hook use this to tell "the repo asked for standard" apart from
   *  "nobody said" — only in the second case may the installed hook's own declared
   *  tier decide, which is what stops a bare install from silently downgrading a
   *  `--strict` hook (mmnto-ai/totem#2753 fold F4). */
  tierPinned?: true;
  /** The config that supplied the values; undefined when none resolved. */
  configPath?: string;
  /** Set when a config RESOLVED but would not load: the values are the defaults
   *  and the failure was printed (mmnto-ai/totem#2692 amendment A8). */
  configError?: string;
}

/**
 * Whether `value` carries a character that cannot be rendered SAFELY into the
 * managed hooks: a single quote (breaks the `sh` single-quoted word AND the
 * single-quoted `node -e '…'` reader), a double quote or a backslash (breaks the
 * JS string literal inside that reader), a dollar sign or a backtick (the only
 * characters that stay ACTIVE inside the double-quoted `sh` words every guard
 * uses — refusing them is what lets those sites keep the one plain
 * double-quoted form `tools/*` ships; mmnto-ai/totem#2692 amendment A2), or a
 * control character / newline (breaks both, and can forge lines in the hook
 * body).
 *
 * Written as a code-point walk rather than a regex with escape literals so the
 * predicate carries no escape sequence of its own to mis-author.
 */
export function hasUnrenderableTotemDirChar(value: string): boolean {
  for (const ch of value) {
    if (ch === "'" || ch === '"' || ch === '\\' || ch === '$' || ch === '`') return true;
    const code = ch.codePointAt(0) ?? 0;
    // Control characters, DEL, and everything non-ASCII: git C-quotes any path
    // byte above 0x7e in the `diff --name-only` output the two `grep -q` diff
    // filters read (`core.quotePath`, on by default), so a directory name
    // carrying one could never match — the silent-skip class this closes.
    if (code < 0x20 || code > 0x7e) return true;
  }
  return false;
}

/**
 * Why `totemDir` cannot be rendered into the managed hooks, or `null` when it
 * can (mmnto-ai/totem#2692 C4 + amendment A7). Two classes:
 *
 *  - CHARACTERS the quoting regimes cannot carry (see
 *    {@link hasUnrenderableTotemDirChar}) — the `@mmnto/totem` schema refuses
 *    the same set, so a validated config never reaches this arm.
 *  - SHAPES the hooks could never govern, which the schema deliberately still
 *    accepts because other verbs can use them (`.` is the global profile's own
 *    spelling): empty, a trailing slash, `.`, a `.` or empty segment, a `..`
 *    segment, a leading `-`. Each of these renders a hook whose post-merge /
 *    post-checkout diff filter (`grep -q '<dir>/…'` over the repo-relative
 *    paths git prints) can never match, or — for the empty value — an ABSOLUTE
 *    run-store path in the strict pre-commit reader. The schema normalises a
 *    trailing slash away; a raw value reaching a builder directly is refused,
 *    never normalised here (a builder is a pure function of its options).
 */
export function hookTotemDirProblem(totemDir: string): string | null {
  if (hasUnrenderableTotemDirChar(totemDir)) {
    return 'a single quote, double quote, backslash, dollar sign, backtick, non-ASCII character, newline or control character cannot be safely rendered into the managed hooks (git C-quotes non-ASCII paths, so a diff filter naming one could never match)';
  }
  if (totemDir.length === 0) {
    return "an empty totemDir renders an ABSOLUTE run-store path ('/artifacts/runs') into the strict pre-commit reader and a diff filter that matches every path";
  }
  if (totemDir.endsWith('/')) {
    return "a trailing slash renders 'dir//…' into the post-merge / post-checkout diff filters, which then never match — spell it without the slash";
  }
  if (totemDir === '.') {
    return "'.' names the config directory itself; the hooks' diff filters ('grep -q <dir>/…') could never match the repo-relative paths git prints";
  }
  const segments = totemDir.split('/');
  if (segments.includes('.') || segments.includes('')) {
    return "a '.' segment (or '//') never appears in the repo-relative paths git prints, so the diff filters would never match";
  }
  if (segments.includes('..')) {
    return "a '..' segment points outside the worktree the hooks run in; git prints repo-relative paths, so the diff filters could never match";
  }
  if (totemDir.startsWith('-')) {
    return "a leading '-' is read as an option by grep in the diff filters";
  }
  return null;
}

/**
 * Refuse — loudly, naming the value and the reason — a `totemDir` the hook
 * templates cannot render (mmnto-ai/totem#2692 C4/A7). Called by the resolver
 * on the configured value and by every builder as the render-path backstop for
 * direct-API and hand-threaded call sites.
 *
 * Throws rather than degrades: a hook rendered from a value we could not quote
 * is a shell-injection surface, and silently falling back to `.totem` would
 * re-create the very writer/reader split this slice closes (Tenet 4).
 */
export function assertRenderableTotemDir(totemDir: string): void {
  const problem = hookTotemDirProblem(totemDir);
  if (problem === null) return;
  // A plain Error, unprefixed: this backstop sits on the SYNC render path (the
  // builders), where `@mmnto/totem`'s TotemError cannot be lazy-imported; the
  // resolver — the CLI's actual entry — raises the TotemError form of the same
  // refusal. `handleError` adds the `[Totem Error]` tag, so the message carries
  // none of its own (Gemini on mmnto-ai/totem#2701).
  throw new Error(
    `Refusing to render git hooks for totemDir ${JSON.stringify(totemDir)}: ${problem}. ` +
      'Set `totemDir` to a plain relative directory inside the repo and re-run `totem hook install --force`.',
  );
}

/**
 * Escape a validated `totemDir` for a POSIX Basic Regular Expression — the two
 * `grep -q '…'` diff filters. BRE specials are `\ ^ $ . * [ ]`; `^` and `$` are
 * only special positionally, but escaping them unconditionally is still a
 * literal match and keeps the rule one line.
 */
function escapeBre(value: string): string {
  return value.replace(/[\\^$.*[\]]/g, '\\$&');
}

/**
 * THE resolver: config → the options every hook writer renders from
 * (mmnto-ai/totem#2692 C1).
 *
 * `tier` = explicit flag > `hooks.tier` from config > `'standard'` (the
 * precedence `hooksCommand` already implemented, moved here so `totem init`,
 * `installHooksNonInteractive` and the silent pre-push upgrade honor it too) —
 * from whichever config resolves, global profile included, exactly as before.
 *
 * `totemDir` = the REPO-LOCAL config's `totemDir` > `.totem`. Repo-local only,
 * and deliberately asymmetric with `tier`: the value is a path rendered into a
 * hook that runs at the worktree top, so only this project's config can name it.
 * The global `~/.totem/` profile `totem init --global` writes declares
 * `totemDir: '.'` — describing that profile directory itself — and honoring it
 * here would silently re-render every config-less repo's hooks against the
 * checkout root on any machine that has a profile (the mmnto-ai/totem#2692 C3
 * "no consumer's hooks drift on upgrade" invariant, and the same
 * machine-dependence `doctor --parity` guards with `isGlobalConfigPath`).
 *
 * `fallbackCmd` = the lockfile probe anchored at `cwd` — pass the GIT ROOT, the
 * anchor the installer has always used, so a hook installed from a subdirectory
 * still names the repo's package manager.
 *
 * No config at all → the defaults, silently: a config-less repo installing hooks
 * is a supported path, not an error. A config that RESOLVES but will not LOAD
 * (a syntax error, a `totemDir` the schema refines out) → the defaults, LOUDLY:
 * one line names the file and the failure, so a repo whose config says
 * `knowledge/` never gets `.totem/` hooks without a word (mmnto-ai/totem#2692
 * amendment A8 — the silent→loud shape of mmnto-ai/totem#2685). A config that
 * loads but names a `totemDir` the hooks cannot govern (`.`, a `..` segment, a
 * leading `-`) REFUSES — {@link assertRenderableTotemDir}.
 */
export async function resolveHookRenderOptions(
  cwd: string,
  flags?: { tier?: 'strict' | 'standard' },
): Promise<ResolvedHookRenderOptions> {
  const fallbackCmd = getFallbackCommand(cwd);
  // `tierPinned` belongs on the DEFAULTS, not only on the fully-resolved return:
  // both early exits below (no config anywhere, config present but unloadable)
  // hand `defaults` straight back, and a flag is pinned in those states exactly as
  // it is in the resolved one. Without it `tierForHook` would let an installed
  // hook's own declaration override an explicit `--strict` / `--standard` in every
  // config-less repo — `totem hook install --strict` a no-op, and `--force` writing
  // the tier the user just asked to change (mmnto-ai/totem#2753 fold 3 F1).
  const defaults: ResolvedHookRenderOptions = {
    tier: flags?.tier ?? 'standard',
    ...(flags?.tier === undefined ? {} : { tierPinned: true as const }),
    totemDir: DEFAULT_TOTEM_DIR,
    fallbackCmd,
  };
  const { loadConfig, loadEnv, resolveConfigPath, isGlobalConfigPath } =
    await import('../utils.js');
  loadEnv(cwd);

  let configPath: string;
  try {
    configPath = resolveConfigPath(cwd);
    // totem-context: no config anywhere (resolveConfigPath throws CONFIG_MISSING) is the honest-default path — hooks install in config-less repos by design.
  } catch {
    return defaults;
  }

  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    config = await loadConfig(configPath);
    // totem-context: LOUD default, not a swallow — the failure is printed on the line below and surfaced as `configError`; a repo whose config will not load still gets default hooks rather than an aborted install (mmnto-ai/totem#2692 A8, the silent→loud shape of mmnto-ai/totem#2685).
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[Totem] Could not load ${configPath} (${reason.split('\n')[0]}) — the git hooks are rendered at the defaults (totemDir '${DEFAULT_TOTEM_DIR}'); the tier follows an explicit flag, else the tier each installed hook declares, else 'standard'; fix the config and re-run \`totem hook install --force\`.`,
    );
    return { ...defaults, configError: reason };
  }

  const totemDir = isGlobalConfigPath(configPath)
    ? DEFAULT_TOTEM_DIR
    : (config.totemDir ?? DEFAULT_TOTEM_DIR);
  // The CLI-layer form of the refusal: a TotemError with a recovery hint (the
  // sync builders keep the plain-Error backstop, `assertRenderableTotemDir`).
  const problem = hookTotemDirProblem(totemDir);
  if (problem !== null) {
    const { TotemError } = await import('@mmnto/totem');
    throw new TotemError(
      'CONFIG_INVALID',
      `Refusing to render git hooks for totemDir ${JSON.stringify(totemDir)}: ${problem}`,
      'Set `totemDir` to a plain relative directory inside the repo and re-run `totem hook install --force`.',
    );
  }
  const pinned = flags?.tier ?? config.hooks?.tier;
  return {
    tier: pinned ?? 'standard',
    ...(pinned === undefined ? {} : { tierPinned: true as const }),
    totemDir,
    fallbackCmd,
    configPath,
  };
}

/**
 * The enforcement tier an INSTALLED hook declares (`TOTEM_HOOK_TIER="…"`), read from
 * the TOTEM-OWNED BLOCK only — never from the whole file, so a user's own line
 * carrying that assignment above an appended block cannot steer the render (the
 * mmnto-ai/totem#2692 pass-2 F3 lesson, applied on the install side).
 *
 * `undefined` when the hook is absent, carries no marker, or predates the tier line.
 *
 * Only an ASSIGNMENT at the start of a line counts — the templates emit
 * `TOTEM_HOOK_TIER="…"` unindented — so a comment inside the block that quotes the
 * assignment (`# TOTEM_HOOK_TIER="strict" …`) cannot steer the render (Gemini,
 * mmnto-ai/totem#2760 round 1).
 *
 * A hook with a start marker but NO end marker is read from the marker to EOF. That
 * is a POLICY, not an observation about such files: everything below an unbounded
 * start marker is TREATED as ours, because that file's one cure is `--force`, which
 * discards the tail anyway. So a user line below it can only steer the render toward
 * the tier it names — fail-closed toward strict, never a silent downgrade.
 */
export function declaredHookTier(
  content: string,
  marker: string,
  endMarker: string,
): 'strict' | 'standard' | undefined {
  const start = content.indexOf(marker);
  if (start === -1) return undefined;
  const end = content.indexOf(endMarker, start + marker.length);
  const block = end === -1 ? content.slice(start) : content.slice(start, end + endMarker.length);
  return /^TOTEM_HOOK_TIER="(strict|standard)"/m.exec(block)?.[1] as
    | 'strict'
    | 'standard'
    | undefined;
}

/**
 * The tier to RENDER one hook at: an explicit flag or a configured `hooks.tier`
 * (both carried as `render.tierPinned`) wins; otherwise the tier the hook already
 * on disk declares; otherwise `render.tier` (the `'standard'` default).
 *
 * Without this last-but-one rung a bare `totem hook install` or `totem init` on a
 * repo that pins no tier re-renders a `--strict` hook at standard — a SILENT
 * enforcement downgrade performed by a command the user ran to stay current
 * (mmnto-ai/totem#2753 fold F4). doctor already refuses to call a tier difference
 * drift for exactly this reason (mmnto-ai/totem#2692 amendment A10); this is the
 * writer-side half of that ruling.
 */
function tierForHook(
  hooksDir: string,
  hookName: string,
  marker: string,
  endMarker: string,
  render: ResolvedHookRenderOptions,
): 'strict' | 'standard' {
  if (render.tierPinned === true) return render.tier;
  const hookPath = path.join(hooksDir, hookName);
  let existing: string;
  try {
    existing = fs.readFileSync(hookPath, 'utf-8');
    // totem-context: an unreadable/absent hook simply has no declared tier to honor — the caller falls back to the resolved default, which is the pre-#2753 behavior, never a crash of the install.
  } catch {
    return render.tier;
  }
  return declaredHookTier(existing, marker, endMarker) ?? render.tier;
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

export function buildHookContent(options: { fallbackCmd: string; totemDir: string }): string {
  const { fallbackCmd, totemDir } = options;
  assertRenderableTotemDir(totemDir);
  return `#!/bin/sh
# ${TOTEM_HOOK_MARKER} — background re-index after pull/merge.

${buildResolveBlock(fallbackCmd)}

# totem-status refresh-gh — GH-federation snapshot refresh (mmnto-ai/totem-status#127
# C3 residual; tracking mmnto-ai/totem#2556). Spawn-and-forget: the verb's
# exit-0-or-nothing contract (single-flight, atomic rename, no-clobber when gh is
# missing) makes blind firing safe, and the merge must never wait on it. An absent
# binary means the sidecar is not adopted here (non-cohort consumer) — skip silently.
# A SECOND verb rides the same gate: \`totem-status refresh-obligation-store\`
# (mmnto-ai/totem-status#127 slice-two residual, sibling of mmnto-ai/totem#2556)
# writes the durable obligation store beside the GH snapshot, so it gets the same
# post-merge moment. Same presence + primary-checkout gate, same backgrounded
# subshell, same log — and each firing stamps its own verb= field, so the log
# records WHICH verbs fired and in what order. That does NOT restore the #2570
# per-child reap discriminator: child output carries no verb tag and the two
# backgrounded children interleave nondeterministically, so a silent tail
# attributes only to the LAST verb stamped. Reopen when the sidecar tags its own
# output. Blind firing stays safe there too: the verb is in-process single-flight
# only, so it races the daemon exactly the way its manual invocation already does.
# PRIMARY checkout only ([ -d .git ]): in a linked worktree .git is a FILE, and a
# detached child inheriting the worktree cwd holds a Windows directory lock that
# breaks worktree removal; the primary's hooks + the daemon cover the workspace-level
# snapshot, and the verb's single-flight makes extra fires redundant anyway.
if [ -d .git ] && command -v totem-status >/dev/null 2>&1; then
  # Observability leg (mmnto-ai/totem#2570): stamp each firing (time, cwd, and
  # WHICH binary resolved — the shell search order includes cwd on Windows, so
  # a stale checkout-local exe can shadow the installed one) and hand the children
  # the same log, so their output lands after the stamps. Measured caveat now that
  # TWO verbs share one log: child output is unlabelled and the two children
  # interleave nondeterministically, so a silent tail no longer discriminates per
  # child — it attributes only to the LAST verb stamped. The stamps still record
  # which verbs fired, and in what order. Repo-local inside
  # .git (never tracked, per-repo, writable wherever git itself writes); 1 MiB
  # self-cap. If the log is not writable, fall back to the previous blind
  # firing — the 2>/dev/null PRECEDES the append so the open failure itself
  # stays silent (redirections apply left to right).
  TS_REFRESH_LOG=".git/totem-status-refresh-hook.log"
  # Arithmetic expansion normalizes wc output (BSD/macOS wc pads with leading
  # spaces) into a clean integer for -gt on every POSIX sh. Path-derived
  # fields pass through tr -d '[:cntrl:]' so a crafted checkout path cannot
  # forge stamp lines or inject terminal controls into the log.
  if [ -f "$TS_REFRESH_LOG" ] && [ "$(( $(wc -c < "$TS_REFRESH_LOG" 2>/dev/null || echo 0) ))" -gt 1048576 ]; then : > "$TS_REFRESH_LOG"; fi
  if printf '[%s] post-merge spawn cwd=%s bin=%s verb=%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pwd | tr -d '[:cntrl:]')" "$(command -v totem-status | tr -d '[:cntrl:]')" refresh-gh 2>/dev/null >> "$TS_REFRESH_LOG"; then
    (totem-status refresh-gh >> "$TS_REFRESH_LOG" 2>&1 &)
  else
    (totem-status refresh-gh >/dev/null 2>&1 &)
  fi
  # Second verb, same gate and same log. Written out rather than looped so the
  # stamp and the backgrounded invocation each carry a literal verb — a reader of
  # the hook (or of the log) never has to resolve a variable to know which fired.
  if printf '[%s] post-merge spawn cwd=%s bin=%s verb=%s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pwd | tr -d '[:cntrl:]')" "$(command -v totem-status | tr -d '[:cntrl:]')" refresh-obligation-store 2>/dev/null >> "$TS_REFRESH_LOG"; then
    (totem-status refresh-obligation-store >> "$TS_REFRESH_LOG" 2>&1 &)
  else
    (totem-status refresh-obligation-store >/dev/null 2>&1 &)
  fi
fi

# Only sync when lessons changed (suppress errors if ORIG_HEAD is missing).
# The trailing -- terminates the revision list so a ref/path ambiguity can never
# reinterpret ORIG_HEAD/HEAD as pathspecs.
if [ -n "$TOTEM_CMD" ] && git diff-tree -r --name-only ORIG_HEAD HEAD -- 2>/dev/null | grep -q '${escapeBre(totemDir)}/lessons/'; then
  # Resolve the real git dir so the sync-log redirect works in a linked worktree,
  # where .git is a FILE (gitdir: pointer), not a directory (mmnto-ai/totem#2376).
  GIT_DIR_RESOLVED=$(git rev-parse --git-dir 2>/dev/null || echo .git)
  ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
fi
# ${TOTEM_HOOK_END}
`;
}

export function buildPostCheckoutHookContent(options: {
  fallbackCmd: string;
  totemDir: string;
}): string {
  const { fallbackCmd, totemDir } = options;
  assertRenderableTotemDir(totemDir);
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

# Handle initial checkout (null SHA) — sync if ${totemDir}/ exists
if [ "$1" = "0000000000000000000000000000000000000000" ]; then
  if [ -n "$TOTEM_CMD" ] && [ -d "${totemDir}" ]; then
    ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
  fi
  exit 0
fi

# Only sync when ${totemDir}/ files differ between branches. The trailing -- terminates
# the revision list so the "$1"/"$2" SHAs can never be reinterpreted as pathspecs.
if [ -n "$TOTEM_CMD" ] && git diff --name-only "$1" "$2" -- 2>/dev/null | grep -q '${escapeBre(totemDir)}/'; then
  ($TOTEM_CMD sync --incremental --quiet > "$GIT_DIR_RESOLVED/totem-sync.log" 2>&1) &
fi
# ${TOTEM_CHECKOUT_END}
`;
}

/**
 * Generate helper shell scripts under `<totemDir>/hooks/` for hook manager
 * integration. These scripts contain the full guard logic (diff checks, null-SHA
 * guards) that bare inline commands would skip.
 *
 * Takes the RESOLVED {@link ResolvedHookRenderOptions} rather than resolving config
 * itself: both callers already hold the one resolution for this invocation, and
 * a required parameter is the same compiler-enforced thread the builders use
 * (mmnto-ai/totem#2692 C1/C2). `tierPinned` rides along so this path applies the
 * SAME tier rule the git-hook writers do — a hook-manager repo is not a repo whose
 * enforcement tier may be silently reset (mmnto-ai/totem#2753 fold 3 F2).
 */
export function generateHookHelpers(gitRoot: string, render: ResolvedHookRenderOptions): void {
  // Refuse BEFORE the mkdir: the helper dir is joined from the value, and a
  // `..` segment would create a directory outside the checkout before any
  // builder got the chance to refuse it (mmnto-ai/totem#2692 amendment A7).
  assertRenderableTotemDir(render.totemDir);
  const hooksDir = path.join(gitRoot, render.totemDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const postMerge = buildHookContent(render);
  const postCheckout = buildPostCheckoutHookContent(render);
  // Only these two carry `TOTEM_HOOK_TIER`, so only these two can be downgraded.
  // The declaration is read from the helper ALREADY on disk, exactly as the git-hook
  // path reads it from the installed hook.
  const preCommit = buildPreCommitHook({
    ...render,
    tier: tierForHook(
      hooksDir,
      'pre-commit.sh',
      TOTEM_PRECOMMIT_MARKER,
      TOTEM_PRECOMMIT_END,
      render,
    ),
  });
  const prePush = buildPrePushHook({
    ...render,
    tier: tierForHook(hooksDir, 'pre-push.sh', TOTEM_PREPUSH_MARKER, TOTEM_PREPUSH_END, render),
  });

  // Atomic like every other git-hook write (mmnto-ai/totem#2760 round 1, leg F2).
  writeExecutableHook(path.join(hooksDir, 'post-merge.sh'), postMerge);
  writeExecutableHook(path.join(hooksDir, 'post-checkout.sh'), postCheckout);
  writeExecutableHook(path.join(hooksDir, 'pre-commit.sh'), preCommit);
  writeExecutableHook(path.join(hooksDir, 'pre-push.sh'), prePush);
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

/**
 * Print the manual wiring a detected hook manager needs. `totemDir` is the
 * RESOLVED value the helper scripts were just written under — guidance that
 * names `.totem/` in a repo that configured something else points the consumer
 * at files that do not exist (mmnto-ai/totem#2692 C5).
 */
function printHookManagerGuidance(manager: HookManager, totemDir: string): void {
  // The validator accepts whitespace in a totemDir; an unquoted word would split
  // into two arguments in every consumer's shell (CodeRabbit on
  // mmnto-ai/totem#2701). Quote only when needed so the default guidance stays
  // the familiar `sh .totem/hooks/…`. `$` and a backtick are refused upstream, so
  // double quotes are inert; the JSON form escapes them for package.json.
  const needsQuotes = /\s/.test(totemDir);
  const sh = needsQuotes ? `"${totemDir}"` : totemDir;
  const json = needsQuotes ? `\\"${totemDir}\\"` : totemDir;
  switch (manager) {
    case 'husky':
      console.error('[Totem] Detected husky. Add the following to your hook files:');
      console.error('');
      console.error('  # .husky/pre-commit');
      console.error(`  sh ${sh}/hooks/pre-commit.sh`);
      console.error('');
      console.error('  # .husky/pre-push');
      console.error(`  sh ${sh}/hooks/pre-push.sh`);
      console.error('');
      console.error('  # .husky/post-merge');
      console.error(`  sh ${sh}/hooks/post-merge.sh`);
      console.error('');
      console.error('  # .husky/post-checkout');
      console.error(`  sh ${sh}/hooks/post-checkout.sh`);
      break;
    case 'lefthook':
      console.error('[Totem] Detected lefthook. Add to your lefthook.yml:');
      console.error('  pre-commit:');
      console.error('    commands:');
      console.error('      totem-block-main:');
      console.error(`        run: sh ${sh}/hooks/pre-commit.sh`);
      console.error('  pre-push:');
      console.error('    commands:');
      console.error('      totem-review:');
      console.error(`        run: sh ${sh}/hooks/pre-push.sh`);
      console.error('  post-merge:');
      console.error('    commands:');
      console.error('      totem-sync:');
      console.error(`        run: sh ${sh}/hooks/post-merge.sh`);
      console.error('  post-checkout:');
      console.error('    commands:');
      console.error('      totem-sync-checkout:');
      console.error(`        run: sh ${sh}/hooks/post-checkout.sh`);
      break;
    case 'simple-git-hooks':
      console.error('[Totem] Detected simple-git-hooks. Add to your package.json:');
      console.error('  "simple-git-hooks": {');
      console.error(`    "pre-commit": "sh ${json}/hooks/pre-commit.sh",`);
      console.error(`    "pre-push": "sh ${json}/hooks/pre-push.sh",`);
      console.error(`    "post-merge": "sh ${json}/hooks/post-merge.sh",`);
      console.error(`    "post-checkout": "sh ${json}/hooks/post-checkout.sh"`);
      console.error('  }');
      break;
  }
}

export async function installPostMergeHook(
  cwd: string,
  rl: readline.Interface,
  options?: {
    tier?: 'strict' | 'standard';
    /** Threaded from init's single non-interactive predicate (mmnto-ai/totem#2601);
     *  falls back to the bare TTY probe for the standalone `install-hooks` caller.
     *  A prompt raised without a TTY never settles — init dies mid-run with its
     *  mutations already landed. */
    interactive?: boolean;
  },
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

  // One config read per invocation, anchored at the git root — the same anchor
  // getFallbackCommand has always used (mmnto-ai/totem#2692 C1).
  const render = await resolveHookRenderOptions(gitRoot, { tier: options?.tier });
  const manager = detectHookManager(gitRoot);

  if (manager) {
    generateHookHelpers(gitRoot, render);
    printHookManagerGuidance(manager, render.totemDir);
    return;
  }

  const interactive = options?.interactive ?? process.stdin.isTTY === true;
  if (!interactive) {
    // Non-interactive: the Enter default here is (N) — decline, and disclose the verb
    // that installs it later.
    console.error(
      '[Totem] Non-interactive mode — post-merge auto-sync hook not installed. Run `totem install-hooks` to add it.',
    );
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
    // Raw bytes are the user's file; the decoded text serves the probes only.
    const raw = fs.readFileSync(hookPath);
    const existing = raw.toString('utf-8');
    if (existing.includes(TOTEM_HOOK_MARKER)) {
      console.log('[Totem] Post-merge hook already installed.');
      return;
    }

    // Append to existing hook — reuse buildHookContent, strip shebang. Written as
    // one atomic replacement of the whole file (the user's RAW bytes + ours) rather
    // than an append: an interrupted append leaves a hook truncated mid-block,
    // which git still runs (mmnto-ai/totem#2760 round 1, leg F2). The helper
    // keeps the user's file mode.
    const separator = existing.endsWith('\n') ? '' : '\n';
    const appendBlock = buildHookContent(render)
      .replace(/^#!\/bin\/sh\n/, '')
      .trimStart();
    writeFileAtomicSync(
      hookPath,
      Buffer.concat([raw, Buffer.from(separator + '\n' + appendBlock, 'utf-8')]),
    );
    console.log('[Totem] Appended post-merge hook to existing hook file.');
    return;
  }

  // Create new hook — atomic, executable on POSIX, mode skipped on Windows by the
  // helper's own boundary (git bash owns the bit there).
  fs.mkdirSync(hooksDir, { recursive: true });
  writeExecutableHook(hookPath, buildHookContent(render));

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

export function buildPreCommitHook(options: {
  tier: 'strict' | 'standard';
  totemDir: string;
}): string {
  const effectiveTier = options.tier;
  const totemDir = options.totemDir;
  assertRenderableTotemDir(totemDir);
  // The run store the strict arm reads, rendered from the CONFIGURED totemDir so
  // the reader names the tree `totem spec` actually writes (mmnto-ai/totem#2692).
  const runsDir = `${totemDir}/artifacts/runs`;
  // Strict-tier evidence (mmnto-ai/totem#2690, tightened by
  // mmnto-ai/totem#2700): the gate names `totem spec`, so it must pass on what
  // `totem spec` actually writes — the grounded run artifact under
  // <totemDir>/artifacts/runs/ (mmnto-ai/totem#2100; written on every
  // successful run, --fresh included) whose TOP-LEVEL
  // admission.runMetadata.caller is "spec". The read is JSON-aware on purpose:
  // the run store is written by every orchestrator caller, and a `review`
  // artifact's inputBundle embeds the reviewed diff — a substring grep would
  // pass the gate on a review of any text that merely QUOTES the key (this
  // very test fixture). node is already assumed by the pre-push template's
  // format-check block; ~50 ms, no CLI boot, nothing written (Tenet 13). The
  // former <totemDir>/cache/.spec-completed marker is NOT honored: no CLI path
  // ever wrote it, so "compatibility" with it would be compatibility with a
  // hand hack (operator ruling 2026-08-29 — no legacy shims while there is no
  // hard consumer, Tenet 19).
  //
  // #2700 adds the second half of the rule: an artifact is EVIDENCE only when
  // it is ANCHORED (`grounding.anchor.kind` of "issue" or "record" — a
  // "free-text" or "mixed" run is the confabulation surface the rule exists
  // for) and its SUBJECT carries a real shape. The SUBJECT depends on the
  // anchor: for an `issue` run it is the draft (`output.content`); for a
  // `record` run it is the RECORD'S OWN BYTES, re-read from disk at commit
  // time — the draft is discarded on that path, so checking it would check
  // nothing. The record's sha256 is compared and REPORTED (matches / revised
  // since binding) but never blocks: blocking on revision would price every
  // fold of a design record at one LLM call, the friction this slice retires.
  //
  // #2737 fixes what that shape check MEASURED, on both halves. A body now ends
  // only at a heading of the SAME OR SHALLOWER level: a deeper heading neither
  // ends the body nor counts as one, so a section that opens with a `####`
  // sub-heading is no longer read as empty (it was, in 3 of the 7 recorded R3
  // drafts, on the longest section each of them wrote). And a promised heading
  // is matched EXACTLY first, then — only if nothing matched — tolerantly, with
  // ONE trailing parenthetical group stripped from BOTH sides: symmetric, so a
  // dropped `(structural constraint)` and a differing `(required)` both match,
  // and LEVEL-EXACT, because the `###` marker is part of the compared string
  // (`## Problem Statement` never satisfies `### Problem Statement`). A
  // tolerant match is never silent: the pass line carries `· tolerated
  // <promised> ~ <found>` for each one, so the drift is disclosed on the commit
  // that relied on it rather than absorbed. Trailing whitespace is not drift —
  // `trimEnd()` settles it on the exact pass, and nothing is named.
  //
  // Exit vocabulary: 0 evidence · 2 no spec artifact · 3 the newest spec
  // artifact is NOT evidence (reason on stdout) · anything else = the reader
  // itself could not run. The evidence line makes a stale pass VISIBLE (age
  // from the artifact's own createdAt); a freshness rule is a separate policy,
  // deliberately not here. This is the ONLY reader of the rule — the repo's
  // pre-managed-era `.gemini/hooks/BeforeTool.js` (unregistered, inert) was
  // deleted with the marker rather than kept in step.
  //
  // Every value the reader compares against is RENDERED from the one canonical
  // constant via JSON.stringify (the runsDir precedent): the required section
  // headings from `SPEC_REQUIRED_SECTIONS`, the anchor kinds and the
  // prompt-source spelling from the core schema's exported constants. The hook
  // text can never drift from the writer's vocabulary by re-spelling it.
  //
  // The artifact is a plain JSON file a seat can hand-edit, and its NAME comes
  // off the filesystem, so nothing echoed is trusted as text: EVERY value that
  // reaches stdout — the artifact's path, its `createdAt`, `anchor.kind`,
  // `anchor.ref`, `anchor.sha256`, the resolved realpath of a bound record,
  // each required heading, and, on a tolerant match, the draft line it matched
  // — passes through `safe()` first, except the two sha256 prefixes in
  // `recordStatus`, which the preceding `/^[0-9a-f]{64}$/` block proves hex. A
  // newline in any of them would otherwise forge a second `[Totem]` line in the
  // hook's own output; `safe()` collapses C0 (0x00–0x1f), the DEL/C1 band
  // (0x7f–0x9f), and U+2028/U+2029, because U+0085 (NEL) breaks a line on some
  // terminals and U+2028/U+2029 are line separators for the same purpose.
  //
  // `safe()` is necessary but NOT sufficient, because it cannot see the attack
  // that lives in PRINTABLE bytes (mmnto-ai/totem#2737 fold 3). A literal
  // backslash followed by `n` is two printable characters, so it passes
  // `safe()` untouched — and the hole was open wherever `/bin/sh` EXPANDS
  // backslash escapes in `echo`: `dash`, which is `/bin/sh` on Debian and
  // Ubuntu, and macOS's own `/bin/sh`, a bash built with `xpg_echo` on. On
  // those the pair becomes a real newline at the shell and forges the second
  // `[Totem]` line (`\\c` truncates the line instead, swallowing the cure text
  // that follows). Only Git Bash and a plain bash leave it inert, so the hole
  // was invisible in exactly the shells a seat develops in. The two
  // sinks that echo an untrusted value — the evidence line and the BLOCKED
  // reason, both carrying `$spec_evidence` — therefore print through
  // `printf '%s\\n'`, which is defined to treat its ARGUMENT as literal text on
  // every POSIX shell. The remaining echoes in this block carry only
  // `$reader_status` (an integer from `$?`) and the render-time `runsDir`
  // (validated by `assertRenderableTotemDir`, which refuses a backslash), so
  // neither can carry the payload.
  // Containment is decided by RESOLUTION, not by inspecting one segment, and
  // it is decided TWICE. Lexically first: a `record` ref that is absolute
  // (either path flavor) or whose `path.resolve` against `process.cwd()` — the
  // worktree top git runs hooks from — lands outside it is refused, so
  // `sub/../../x.md` and `./../x.md` are caught where a first-segment test let
  // them through, while a mid-path `..` that stays inside stays legal. Then by
  // REALPATH, once the ref is known to exist and before its bytes are read: an
  // in-repo SYMLINK whose target lives outside the tree is lexically contained
  // and would otherwise be read and judged, so the resolved pair is compared
  // too and the block names both spellings. A `record` anchor whose `sha256` is
  // missing and one whose `sha256` is not a 64-hex digest are refused with
  // their OWN reasons — "no sha256" and "not a 64-hex digest" are different
  // repairs — rather than as one malformed sensor line. Every reason and the
  // pass line go out through `fs.writeSync(1, …)`: `process.stdout.write` is
  // asynchronous on a pipe (macOS), so `process.exit` could truncate the text
  // the `sh` arm is about to echo.
  const strictBlock = `
# Strict mode: require spec EVIDENCE before commit (mmnto-ai/totem#2690, mmnto-ai/totem#2700).
# Evidence = a totem spec run artifact (${runsDir}/*.json with a
# top-level admission.runMetadata.caller of "spec"), read JSON-aware — a
# substring match would accept a review artifact that merely quotes the key —
# that is ANCHORED on an issue or a bound design record, and whose subject
# carries a real shape: every promised heading (level-exact; a trailing
# parenthetical may differ or be dropped, and the evidence line names it) each
# with a non-blank body before the next heading of the same or shallower level
# (an issue run drafted by the built-in prompt), or at least one heading with a body (a
# record run, or an issue run drafted under a custom prompt). A record run is
# judged on the bytes of the record at grounding.anchor.ref, re-read here from
# the worktree top; its sha256 is REPORTED, never enforced.
# The former ${totemDir}/cache/.spec-completed marker is not honored (no CLI wrote it).
if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
  spec_evidence=$(node -e '
const fs = require("fs");
const crypto = require("crypto");
const nodePath = require("path");
const dir = ${JSON.stringify(runsDir)};
const REQUIRED = ${JSON.stringify(SPEC_REQUIRED_SECTIONS)};
const KIND_ISSUE = ${JSON.stringify(GROUNDING_ANCHOR_ISSUE)};
const KIND_RECORD = ${JSON.stringify(GROUNDING_ANCHOR_RECORD)};
const PROMPT_OVERRIDE = ${JSON.stringify(PROMPT_SOURCE_OVERRIDE)};
let names = [];
try { names = fs.readdirSync(dir); } catch (err) { names = []; }
let best = null;
for (const name of names) {
  if (!name.endsWith(".json")) continue;
  let a = null;
  try { a = JSON.parse(fs.readFileSync(dir + "/" + name, "utf8")); } catch (err) { continue; }
  const caller = a && a.admission && a.admission.runMetadata && a.admission.runMetadata.caller;
  if (["spec"].indexOf(caller) < 0) continue;
  const at = ["string"].indexOf(typeof a.createdAt) < 0 ? "" : a.createdAt;
  if (!best || at > best.at) best = { name: name, at: at, art: a };
}
if (!best) process.exit(2);
const file = dir + "/" + best.name;
// fs.writeSync, not process.stdout.write: stdout is a PIPE here (the sh arm
// captures it) and a piped write is asynchronous on macOS, so process.exit
// below could truncate the very text the sh arm is about to echo.
function emit(text) { fs.writeSync(1, text); }
function block(reason) { emit(reason); process.exit(3); }
function safe(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const control = code < 32 || (code >= 127 && code <= 159) || [8232, 8233].indexOf(code) > -1;
    out = out + (control ? "?" : text.charAt(i));
  }
  return out;
}
const shownFile = safe(file);
const shownAt = safe(best.at);
function headingLevel(line) {
  let n = 0;
  while (n < line.length && ["#"].indexOf(line.charAt(n)) > -1) n = n + 1;
  if (n < 1 || n > 6) return 0;
  if ([" ", "\\t"].indexOf(line.charAt(n)) < 0) return 0;
  return line.slice(n + 1).trim().length > 0 ? n : 0;
}
function stripParen(s) {
  const t = s.trimEnd();
  if (t.charAt(t.length - 1) !== ")") return t;
  const open = t.lastIndexOf("(");
  if (open < 1) return t;
  return t.slice(0, open).trimEnd();
}
function escapesTop(rel) {
  const norm = rel.split("\\\\").join("/");
  if (nodePath.win32.isAbsolute(norm) || nodePath.posix.isAbsolute(norm)) return true;
  return [".."].indexOf(norm) > -1 || ["../"].indexOf(norm.slice(0, 3)) > -1;
}
function outsideWorktree(r) {
  const norm = r.split("\\\\").join("/");
  if (nodePath.win32.isAbsolute(norm) || nodePath.posix.isAbsolute(norm)) return true;
  const top = process.cwd();
  return escapesTop(nodePath.relative(top, nodePath.resolve(top, norm)));
}
const art = best.art;
const grounding = art.grounding;
const anchor = grounding && grounding.anchor;
if (!anchor || ["string"].indexOf(typeof anchor.kind) < 0) block("the newest spec run artifact (" + shownFile + ") predates the anchored-evidence rule (no grounding.anchor)");
const kind = anchor.kind;
const ref = ["string"].indexOf(typeof anchor.ref) < 0 ? "(no ref)" : anchor.ref;
const shownKind = safe(kind);
const shownRef = safe(ref);
if (kind !== KIND_ISSUE && kind !== KIND_RECORD) block("the newest spec run artifact (" + shownFile + ") is anchored " + shownKind + " (" + shownRef + "), which is not gate evidence");
let subject = "";
let shape = "";
let recordStatus = "";
if (kind !== KIND_RECORD) {
  const content = art.output && art.output.content;
  if (["string"].indexOf(typeof content) < 0) block("the newest spec run artifact (" + shownFile + ") is not evidence: the draft is not text");
  subject = content;
  const meta = art.admission && art.admission.runMetadata;
  const source = meta && meta.promptSource;
  shape = source !== PROMPT_OVERRIDE ? "TEMPLATE" : "DOCUMENT";
} else {
  if (outsideWorktree(ref)) block("the bound record ref is outside the worktree: " + shownRef);
  const bound = ["string"].indexOf(typeof anchor.sha256) < 0 ? "" : anchor.sha256;
  if (bound.length < 1) block("the record anchor carries no sha256 — not evidence (" + shownFile + ")");
  if (!/^[0-9a-f]{64}$/.test(bound)) block("the record anchor sha256 is not a 64-hex digest (" + safe(bound) + ") — not evidence (" + shownFile + ")");
  const missingRecord = "the bound record is missing at " + shownRef + " (bound by " + shownFile + ")";
  if (!fs.existsSync(ref)) block(missingRecord);
  const realRef = fs.realpathSync.native(ref);
  if (escapesTop(nodePath.relative(fs.realpathSync.native(process.cwd()), realRef))) block("the bound record resolves outside the worktree: " + shownRef + " -> " + safe(realRef));
  let bytes = null;
  let read = false;
  try { bytes = fs.readFileSync(ref); read = true; } catch (err) { read = false; }
  if (!read) block(missingRecord);
  subject = bytes.toString("utf8");
  shape = "DOCUMENT";
  const now = crypto.createHash("sha256").update(bytes).digest("hex");
  recordStatus = now !== bound ? "record revised since binding (bound " + bound.slice(0, ${RECORD_HASH_DISPLAY_PREFIX}) + ", now " + now.slice(0, ${RECORD_HASH_DISPLAY_PREFIX}) + ")" : "record sha256 matches";
}
if ([65279].indexOf(subject.charCodeAt(0)) > -1) subject = subject.slice(1);
const lines = subject.split("\\n");
const tolerated = [];
function hasBodyAfter(start, level) {
  for (let i = start + 1; i < lines.length; i++) {
    const n = headingLevel(lines[i]);
    if (n > 0 && n <= level) return false;
    if (n > 0) continue;
    if (lines[i].trim().length > 0) return true;
  }
  return false;
}
if (shape !== "DOCUMENT") {
  for (const heading of REQUIRED) {
    let at = -1;
    for (let i = 0; i < lines.length; i++) { if ([heading].indexOf(lines[i].trimEnd()) > -1) { at = i; break; } }
    let matchedAs = "";
    if (at < 0) {
      const want = stripParen(heading);
      for (let i = 0; i < lines.length; i++) { if ([want].indexOf(stripParen(lines[i].trimEnd())) > -1) { at = i; break; } }
      if (at > -1) { matchedAs = safe(lines[at].trimEnd()); tolerated.push(safe(heading) + " ~ " + matchedAs); }
    }
    if (at < 0) block("the draft in " + shownFile + " is missing heading " + safe(heading));
    const shownHeading = safe(heading) + (matchedAs.length > 0 ? " (matched as " + matchedAs + ")" : "");
    if (!hasBodyAfter(at, headingLevel(lines[at]))) block("the draft in " + shownFile + " has an empty heading " + shownHeading);
  }
} else {
  let bodied = false;
  for (let i = 0; i < lines.length; i++) { const n = headingLevel(lines[i]); if (n > 0 && hasBodyAfter(i, n)) { bodied = true; break; } }
  if (!bodied && kind !== KIND_RECORD) block("the draft in " + shownFile + " has no heading with a body (custom prompt: the built-in template skeleton is not required)");
  if (!bodied) block("the bound record at " + shownRef + " has no heading with a body");
}
const stamp = best.at ? Date.parse(best.at) : NaN;
const days = Number.isNaN(stamp) ? -1 : Math.floor((Date.now() - stamp) / 86400000);
let out = shownFile + " (" + (shownAt || "undated") + (days >= 0 ? ", " + days + " days old" : "") + ")";
out = out + " · anchor " + shownKind + " " + shownRef + " · shape " + shape;
if (tolerated.length > 0) out = out + " · tolerated " + tolerated.join("; ");
if (recordStatus.length > 0) out = out + " · " + recordStatus;
emit(out);
' 2>/dev/null)
  # Reader status: 0 = evidence found · 2 = no spec artifact at all · 3 = the
  # newest spec artifact is NOT evidence (the reason is on stdout) · anything
  # else = the reader itself could not run (node missing from PATH, a crash) —
  # each reported distinctly, never as "no evidence", and all fail-closed.
  reader_status=$?
  if [ "$reader_status" = "0" ] && [ -n "$spec_evidence" ]; then
    printf '%s\\n' "[Totem] spec evidence: $spec_evidence"
  elif [ "$reader_status" = "3" ]; then
    printf '%s\\n' "[Totem] BLOCKED: $spec_evidence — run 'totem spec <issue>' or 'totem spec --from <record>' (add --fresh if the response is cached) (strict mode)"
    exit 1
  elif [ "$reader_status" != "2" ]; then
    echo "[Totem] BLOCKED: the spec-evidence reader could not run (node exit status $reader_status — node missing from PATH, or ${runsDir}/ unreadable); fix the runtime and retry (strict mode)"
    exit 1
  else
    echo "[Totem] BLOCKED: Run 'totem spec <issue>' before committing (strict mode) — no totem spec run artifact under ${runsDir}/ in this checkout"
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

export function buildPrePushHook(options: {
  fallbackCmd: string;
  tier: 'strict' | 'standard';
  totemDir: string;
}): string {
  const { fallbackCmd, totemDir } = options;
  const effectiveTier = options.tier;
  assertRenderableTotemDir(totemDir);
  // The review-leg floor (mmnto-ai/totem#2698; doctrine `model-tiering.md`
  // § Review legs — a self-authored judgment-dense diff owes one falsification
  // leg before it is presented). The gate itself derives everything: whether
  // the push is legs-owed (the changed-file set against `hooks.legsOwed.globs`,
  // read at RUN time so a glob edit needs no hook re-install) and whether a
  // deposit ancestor-or-equal of HEAD answers for it. The hook maps that
  // derivation onto exit codes and NOTHING else — the tier changes only which
  // code blocks, never a line of the text.
  //
  // Since mmnto-ai/totem#2771 the repo's `hooks.legsOwed.enforce` (read at run
  // time by the gate, like the globs) can arm this ONE gate at any tier
  // (`'block'`) or soften it at every tier (`'advisory'`) without touching the
  // spec-evidence and shield arms. The hook never reads the knob: it reads the
  // EXIT CODE the gate has already mapped through it. So 3 and 2 block on
  // every tier — under the advisory flag they only ever come back when the
  // knob says block — and only a failure before the derivation (an unloadable
  // config, which is also how the knob would go unread) stays strict-only,
  // which keeps a knob-less install byte-for-byte on its old behaviour.
  //
  // Slotted BEFORE the shield block deliberately: on strict this is a sub-second
  // local read, and paying for the slow review gate before discovering the push
  // is legs-owed wastes the operator's minute and an LLM call.
  //
  // The `--help` probe is the `--gate` / `--scope-to-diff` precedent, with the
  // OPPOSITE fallback (mmnto-ai/totem#2698 OQ2, ruled): those flags degrade to
  // a bare sensor form that still runs, while an ABSENT VERB has no degraded
  // form at all. So strict FAILS CLOSED with the one-command cure, and only the
  // advisory tiers print the compat line and pass.
  //
  // It probes the VERB'S OWN help for an option only that verb has, never the
  // group's help for the word `gate` (mmnto-ai/totem#2698 fold 2). A CLI that
  // predates `totem legs` answers ANY `legs …` invocation with its curated
  // TOP-LEVEL help and exits 0 — measured on `@mmnto/cli` 1.122.0 — so a
  // group-level `grep gate` is really grepping the top-level command list,
  // which is a moving surface: the queued `merge-gate` verb
  // (mmnto-ai/totem#2708) would make the probe pass on a CLI that has no
  // `legs gate` at all. `--advisory` is specific to this verb, so its presence
  // in that output means the verb itself answered.
  const legsBlock = `
  # The review-leg floor: require a fresh falsification-leg deposit for
  # legs-owed pushes (mmnto-ai/totem#2698, doctrine/model-tiering.md § Review legs).
  # Exit vocabulary of \`totem legs gate\`: 0 = not owed, or a deposit answers for
  # this head · 3 = owed with no fresh deposit · 2 = the gate could not derive
  # (not a git repo, HEAD or the branch diff unresolvable). The strict tier and
  # agent seats run the bare gate; the other tiers pass --advisory, under which
  # the gate prints the SAME lines and exits 0 — unless the repo's
  # hooks.legsOwed.enforce says 'block', in which case the gate exits 3 or 2 at
  # any tier and this hook blocks on it (mmnto-ai/totem#2771); 'advisory' makes
  # it exit 0 at any tier. A status other than 0, 2 or 3 is a failure before
  # the derivation (an unloadable config) and blocks only on the strict arm.
  if $TOTEM_CMD legs gate --help 2>/dev/null | grep -q -- '--advisory'; then
    legs_strict=0
    if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
      legs_strict=1
      $TOTEM_CMD legs gate
      legs_status=$?
    else
      $TOTEM_CMD legs gate --advisory
      legs_status=$?
    fi
    if [ "$legs_status" = "3" ]; then
      echo "[Totem] BLOCKED: this push is legs-owed and carries no fresh falsification-leg deposit — run the leg, then 'totem legs deposit --sha HEAD --from <findings.json>' (mmnto-ai/totem#2698; strict mode, an agent seat, or hooks.legsOwed.enforce: block)"
      exit 1
    elif [ "$legs_status" = "2" ]; then
      echo "[Totem] BLOCKED: the legs gate could not derive (totem legs gate exit status 2) — fix the checkout and retry (strict mode, an agent seat, or hooks.legsOwed.enforce: block)"
      exit 1
    elif [ "$legs_status" != "0" ] && [ "$legs_strict" = "1" ]; then
      echo "[Totem] BLOCKED: the legs gate failed before deriving (totem legs gate exit status $legs_status) — fix the config or the CLI and retry (strict mode or an agent seat)"
      exit 1
    fi
  else
    if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]; then
      echo "[Totem] BLOCKED: this hook expects 'totem legs gate' (mmnto-ai/totem#2698) but the resolved CLI lacks it — 'npm i -g @mmnto/cli@latest' (strict mode)" >&2
      exit 1
    else
      echo "[totem] Hook running without the legs gate (CLI predates 'totem legs'); 'npm i -g @mmnto/cli@latest' enables it." >&2
    fi
  fi`;
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
    # Gate-mapped review invocation (mmnto-ai/totem#2473): --gate IS the
    # wiring's declared disposition→exit mapping — not-applicable admissions
    # and completed rounds pass (findings are report-only in hook context),
    # hard failures and unknown dispositions block. Probe --help for flag
    # support (the --scope-to-diff defensive-degrade precedent); an older CLI
    # falls back to the bare sensor form with a visible compat line.
    if $TOTEM_CMD review --help 2>/dev/null | grep -q -- '--gate'; then
      $TOTEM_CMD review --gate || exit 1
    else
      echo "[totem] Hook running review in compat mode (CLI without --gate); 'npm i -g @mmnto/cli@latest' enables the declared gate mapping." >&2
      $TOTEM_CMD review || exit 1
    fi
  fi`;

  return `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — stateless enforcement.
TOTEM_HOOK_TIER="${effectiveTier}"

${buildAgentDetectionBlock()}

${buildResolveBlock(fallbackCmd)}

if [ -n "$TOTEM_CMD" ]; then
  # Verify compile manifest is current
  if [ -f "${totemDir}/compile-manifest.json" ]; then
    if ! $TOTEM_CMD verify-manifest > /dev/null 2>&1; then
      echo "[totem] Push blocked: compile manifest is stale. Run 'totem lesson compile'." >&2
      exit 1
    fi
  fi

  # Run deterministic lint
  if [ -f "${totemDir}/compiled-rules.json" ]; then
    if ! $TOTEM_CMD lint; then
      exit 1
    fi
  fi

  # Verify shields.io badges in README.md (mmnto-ai/totem#1926 — deterministic claim-discipline)
  if [ -f "README.md" ] && [ -f "${totemDir}/compiled-rules.json" ]; then
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
  if [ -f "${totemDir}/compiled-rules.json" ] && { [ -f "README.md" ] || [ -f "AGENTS.md" ] || [ -f "design-tenets.md" ] || [ -d "docs/wiki" ]; }; then
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
${legsBlock}
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
 * Write a hook file and mark it executable — ATOMICALLY (core's
 * `writeFileAtomicSync`, the Tenet 4 user-file mutation helper, mmnto-ai/totem#2620):
 * the bytes land in a same-directory temp, the mode is applied to the temp, and
 * the rename comes last, so an interrupted install leaves the old hook or the new
 * one and never a truncated file. That matters most on the attested-extension
 * rewrite (mmnto-ai/totem#2753): the trailer is the consumer's own lines, which no
 * template can regenerate (Greptile P1, mmnto-ai/totem#2760 round 1).
 *
 * On POSIX a mode failure propagates from the helper (a hook git cannot execute
 * must fail loud, never silently report `installed`). On Windows the exec bit is
 * skipped by the helper's own boundary: git-bash owns the executable bit there,
 * and NTFS has no POSIX mode to set. Symlinked hooks keep their link identity
 * (the helper writes through to the real path). A DANGLING symlinked hook is the
 * one case the old in-place write handled differently: `fs.writeFileSync` followed
 * the link and created its target, the helper throws ENOENT and leaves the link
 * untouched — remove or re-point the link first. Declared, not defended.
 */
function writeExecutableHook(hookPath: string, content: string | Buffer): void {
  writeFileAtomicSync(hookPath, content, { mode: HOOK_EXECUTABLE_MODE });
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
export function isTotemOwnedWholeFile(content: string, marker: string, endMarker: string): boolean {
  const trailerStart = ownedTrailerStart(content, marker, endMarker);
  if (trailerStart === undefined) return false;
  return content.slice(trailerStart).trim().length === 0;
}

/**
 * The offset just past the totem end marker — where a trailer would begin — for a
 * hook whose managed region OPENS the file and is BOUNDED. `undefined` when either
 * rule fails: no start marker, user content before it (beyond a shebang + the start
 * of the marker comment), or no end marker after it (the legacy-hook path).
 *
 * The one shared prefix/bound rule behind {@link isTotemOwnedWholeFile} and
 * {@link isTotemOwnedWithAttestedTrailer} — the two differ ONLY in what they
 * accept after this offset (mmnto-ai/totem#2753).
 */
function ownedTrailerStart(content: string, marker: string, endMarker: string): number | undefined {
  const idx = content.indexOf(marker);
  if (idx === -1) return undefined;
  const before = content.slice(0, idx);
  if (before.trim().length !== 0 && !OWNED_WHOLE_FILE_PREAMBLE_RE.test(before)) {
    return undefined;
  }
  const end = content.indexOf(endMarker, idx + marker.length);
  // Start marker present but end marker missing → region cannot be bounded →
  // not safe to rewrite without --force (also the legacy-hook path).
  if (end === -1) return undefined;
  return end + endMarker.length;
}

/**
 * {@link ownedTrailerStart} as a BYTE offset into the raw file — the offset the
 * block-rewrite arm slices the trailer at — or `undefined` when the managed region
 * (start of file through the end marker) does not decode as UTF-8 losslessly.
 *
 * The string offset converts to a byte offset only if the region's re-encoded text
 * equals its raw bytes; totem wrote the region, so it does, and the equality check
 * PROVES it rather than assuming it. A region that fails it is not totem's text any
 * more — an ANSI-editor save that turned the template's em dash into one `0x97`
 * byte, say — so the installer reports that shape (`skipped-non-utf8`) and doctor
 * classifies it (`non-utf8`) instead of either guessing an offset or prescribing a
 * bare install that would decline (mmnto-ai/totem#2760 legs F9 and F13). The
 * trailer's own bytes are never decoded by anything that writes them back.
 */
export function ownedTrailerByteStart(
  raw: Buffer,
  marker: string,
  endMarker: string,
): number | undefined {
  const existing = raw.toString('utf-8');
  const trailerStart = ownedTrailerStart(existing, marker, endMarker);
  if (trailerStart === undefined) return undefined;
  const prefixBytes = Buffer.from(existing.slice(0, trailerStart), 'utf-8');
  return raw.subarray(0, prefixBytes.length).equals(prefixBytes) ? prefixBytes.length : undefined;
}

/**
 * A trailer (the text after a managed hook's end marker) is ATTESTED when its
 * LEADING COMMENT RUN carries a full fork attestation — reason, owner and attested
 * all present and non-empty AFTER TRIMMING; a whitespace-only value does not attest
 * (mmnto-ai/totem#2753; the trim from mmnto-ai/totem#2760 round 1).
 *
 * The leading comment run is every line up to the first line that is neither blank
 * nor a shell comment — i.e. up to the extension's first COMMAND. Blank lines inside
 * the run are skipped. The attestation is core's `<!-- totem:fork … -->` marker
 * (`parseForkMarker`), the same shape the parity detector reads, on a comment line:
 *
 *     (blank)
 *     # [lc] docs-inject extension
 *     # <!-- totem:fork reason="…" owner="satur8d" attested="2026-06-07" -->
 *     sh "tools/git-hooks/pre-commit-docs-inject.sh"
 *
 * The run, not the first line: a real consumer labels its block before it signs it.
 * That is the measured liquid-city shape — `tools/git-hooks/install.cjs` emits a
 * `# [lc] <name> extension` line FIRST and the fork marker SECOND — and a
 * first-line-only rule declined the very datum this slice was built from
 * (mmnto-ai/liquid-city#1174).
 *
 * Two things do NOT attest, and both matter:
 *   - A marker below the first command. An attestation buried under code vouches
 *     for nothing above it, so the run ends at that command.
 *   - A marker on a NON-comment line. `rm -rf / # <!-- totem:fork … -->` is a
 *     command, not a signature; only a line whose trimmed text STARTS with `#` can
 *     carry one.
 *
 * The marker must also sit on ONE line: `parseForkMarker` is applied per line here,
 * so core's multi-line (dotAll) form of the marker is deliberately not in play.
 *
 * A BARE `totem:fork` marker — or one missing any of the three fields — is not
 * attested either. That asymmetry with the parity detector (where a bare marker is
 * enough to CLAIM a fork) is deliberate: carrying a consumer's lines through a
 * managed-block rewrite is a maintenance promise, and a promise needs a name, a
 * reason and a date.
 */
export function isAttestedTrailer(trailer: string): boolean {
  for (const line of trailer.split('\n')) {
    const trimmed = line.trim();
    // Blank lines sit inside the run — the measured shape opens with one.
    if (trimmed.length === 0) continue;
    // The first command ends the run: nothing below it can vouch for it.
    if (!trimmed.startsWith('#')) return false;
    const fork = parseForkMarker(line);
    // Trimmed: core's parser captures the quoted value raw, so `reason=" "` would
    // otherwise pass a length check — a promise with no name is not a promise
    // (Greptile P2, mmnto-ai/totem#2760 round 1).
    if (
      fork !== undefined &&
      typeof fork.reason === 'string' &&
      fork.reason.trim().length > 0 &&
      typeof fork.owner === 'string' &&
      fork.owner.trim().length > 0 &&
      typeof fork.attested === 'string' &&
      fork.attested.trim().length > 0
    ) {
      return true;
    }
  }
  // Blank/whitespace-only, or a comment run with no full marker in it.
  return false;
}

/**
 * The mmnto-ai/totem#2406 owned-whole-file shape with ONE relaxation: the trailer may
 * be non-blank if it is attested ({@link isAttestedTrailer}).
 *
 * The precondition for the in-place managed-block rewrite: totem still owns
 * everything from the top of the file through the end marker, and what follows it is
 * a consumer extension that named itself. Everything before the end marker is
 * regenerated; everything after it is carried through byte-for-byte.
 */
export function isTotemOwnedWithAttestedTrailer(
  content: string,
  marker: string,
  endMarker: string,
): boolean {
  const trailerStart = ownedTrailerStart(content, marker, endMarker);
  if (trailerStart === undefined) return false;
  return isAttestedTrailer(content.slice(trailerStart));
}

/**
 * The trailer as it must be re-attached after a regenerated managed block: the BYTES
 * after `endMarker` with exactly ONE leading line terminator (`\r\n` or `\n`)
 * removed. The canonical hook text already ends with the end marker's own
 * terminator, so re-attaching the raw slice would duplicate it (the `upgradeReflexes`
 * seam precedent in init.ts). Everything past that one terminator is untouched —
 * and never decoded: the trailer is the consumer's own file, and a byte that does
 * not round-trip UTF-8 must come back as itself (mmnto-ai/totem#2760 leg F9).
 */
function trailerTailAfterEndMarker(raw: Buffer, trailerStart: number): Buffer {
  const trailer = raw.subarray(trailerStart);
  if (trailer[0] === 0x0d && trailer[1] === 0x0a) return trailer.subarray(2);
  if (trailer[0] === 0x0a) return trailer.subarray(1);
  return trailer;
}

/**
 * The action {@link installGitHook} took on one git hook — the git-hook half of the
 * vocabulary {@link ManagedSessionHookAction} carries for session hooks:
 *   - `installed`         — no hook was there; the canonical file was created.
 *   - `exists`            — present and already current: no write. Includes an
 *                           attested-extension hook whose managed BLOCK already
 *                           equals the canonical (mmnto-ai/totem#2753), and the
 *                           declines — a legacy hook with no end marker, a user hook
 *                           carrying an appended block, and an UNATTESTED trailer —
 *                           each of which takes one `totem hook install --force`.
 *   - `appended`          — a user shell hook carrying no totem marker: the block was
 *                           appended below the user's own content.
 *   - `overwritten`       — the WHOLE file was written: a `--force` overwrite, or the
 *                           bare drift-repair of a totem-owned whole file
 *                           (mmnto-ai/totem#2138).
 *   - `block-rewritten`   — the managed block was regenerated IN PLACE and the
 *                           attested `totem:fork` extension after its end marker was
 *                           carried through byte-for-byte. Bare only —
 *                           `--force` still rewrites the whole file.
 *   - `skipped-non-shell` — a hook with a non-shell interpreter: never touched.
 *   - `skipped-non-utf8`  — an attested-extension hook whose MANAGED REGION does not
 *                           decode as UTF-8 (an ANSI-editor save, say): the block
 *                           cannot be rewritten in place without guessing a byte
 *                           offset, so the file is left byte-identical and the
 *                           skip is REPORTED — re-save as UTF-8, or `--force`
 *                           (mmnto-ai/totem#2760 leg F13). The extension's own
 *                           bytes are never the reason: they are carried as bytes.
 */
export type GitHookAction =
  | 'installed'
  | 'exists'
  | 'appended'
  | 'skipped-non-shell'
  | 'skipped-non-utf8'
  | 'overwritten'
  | 'block-rewritten';

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
 *
 * Since mmnto-ai/totem#2753 a THIRD arm sits between drift-repair and the decline: a
 * file totem owns through its end marker whose trailer is an ATTESTED `totem:fork`
 * extension ({@link isTotemOwnedWithAttestedTrailer}) has its managed block rewritten
 * IN PLACE (`block-rewritten`) — the canonical text plus the existing trailer,
 * byte-identical past the seam. That is the liquid-city shape: a consumer appending
 * its own blocks after totem's end marker never received a managed-hook upgrade
 * through bare `totem init` (measured at `@mmnto/cli` 1.123.0,
 * mmnto-ai/liquid-city#1174). An UNATTESTED trailer still declines to `exists`,
 * unchanged. `--force` is untouched by all of this: it overwrites the WHOLE file,
 * trailer included.
 */
export function installGitHook(
  hooksDir: string,
  hookName: string,
  hookContent: string,
  marker: string,
  force?: boolean,
  endMarker?: string,
): GitHookAction {
  const hookPath = path.join(hooksDir, hookName);

  if (fs.existsSync(hookPath)) {
    // Raw bytes are the user's file; the decoded text serves the PROBES only
    // (markers, shebang, terminator). Every write below that carries the user's
    // content carries it as BYTES — a hook that does not round-trip UTF-8 must
    // never come back with U+FFFD where its bytes were (the mmnto-ai/totem#2620
    // eject ruling, re-learned on mmnto-ai/totem#2760 leg F8).
    const raw = fs.readFileSync(hookPath);
    const existing = raw.toString('utf-8');
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
      // In-place managed-block rewrite (mmnto-ai/totem#2753): totem owns the file
      // through its end marker and what follows is an ATTESTED `totem:fork`
      // extension. Regenerate the block, carry the trailer through byte-for-byte.
      // The currency compare here is the RECOMPOSED file, not the whole existing
      // one — an attested-trailer hook whose block already equals the canonical is
      // current (`exists`, no write), which is what makes a second bare run a no-op.
      if (endMarker !== undefined && isTotemOwnedWithAttestedTrailer(existing, marker, endMarker)) {
        // "Byte-for-byte" is literal: the trailer is sliced from the RAW file at the
        // byte offset `ownedTrailerByteStart` PROVES — the region above the
        // extension (shebang line and managed block) re-encodes to its own bytes.
        // That is the ONE marker scan, shared with doctor (fold F11's rule, one
        // implementation); the predicate above ran it too, and a second run on the
        // same string is cheaper than a second implementation. A region that does
        // not round-trip is not ours to rewrite — and not something to stay silent
        // about: the skip is REPORTED, and doctor senses the same shape with the
        // same predicate (legs F13, F16). The trailer's bytes are never decoded.
        const trailerByteStart = ownedTrailerByteStart(raw, marker, endMarker);
        if (trailerByteStart === undefined) return 'skipped-non-utf8';
        const rewritten = Buffer.concat([
          Buffer.from(hookContent, 'utf-8'),
          trailerTailAfterEndMarker(raw, trailerByteStart),
        ]);
        if (rewritten.equals(raw)) return 'exists';
        writeExecutableHook(hookPath, rewritten);
        return 'block-rewritten';
      }
      return 'exists';
    }

    // Guard: do not append bash syntax to non-shell hooks (Node, Python, etc.)
    const firstLine = existing.split('\n')[0] ?? '';
    if (firstLine.startsWith('#!') && !SHELL_SHEBANG_RE.test(firstLine)) {
      return 'skipped-non-shell';
    }

    // Append to existing hook — preserve user's existing hooks. One atomic
    // replacement of the whole file (their RAW bytes + ours), not an append: an
    // interrupted append leaves a hook truncated mid-block, which git still
    // runs (mmnto-ai/totem#2760 round 1, leg F2). The helper keeps the user's
    // file mode and writes through a symlink to its real path.
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    const appendBlock = hookContent
      .replace(/^#!\/bin\/sh\n/, '') // Strip shebang when appending
      .trimStart();
    writeFileAtomicSync(
      hookPath,
      Buffer.concat([raw, Buffer.from(separator + appendBlock, 'utf-8')]),
    );
    return 'appended';
  }

  // Create new hook
  fs.mkdirSync(hooksDir, { recursive: true });
  writeExecutableHook(hookPath, hookContent);

  return 'installed';
}

export interface EnforcementHookResult {
  preCommit: GitHookAction | 'skipped';
  prePush: GitHookAction | 'skipped';
}

/**
 * Install pre-commit (block main) and pre-push (totem lint) hooks.
 * Respects hook managers by printing guidance instead of writing raw hooks.
 * Returns actions taken for reporting in init summary.
 */
export async function installEnforcementHooks(
  cwd: string,
  rl: readline.Interface,
  options?: {
    tier?: 'strict' | 'standard';
    /** See installPostMergeHook — the same non-interactive predicate, threaded
     *  (mmnto-ai/totem#2601). */
    interactive?: boolean;
  },
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
  const interactive = options?.interactive ?? process.stdin.isTTY === true;
  if (interactive) {
    const answer = await rl.question(
      '\nInstall git enforcement hooks (block main commits + totem lint)? (Y/n): ',
    );

    if (answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no') {
      return skip;
    }
  } else {
    // Non-interactive: take the (Y) default. Both hooks are marker-bounded and
    // idempotent, so the unattended install is reversible and never clobbers.
    console.error('[Totem] Non-interactive mode — installing git enforcement hooks.');
  }

  const hooksDir = resolveHooksDir(gitRoot);
  if (!hooksDir) {
    // stderr like every other skip/diagnostic line (#2422 round: stream parity).
    console.error(HOOKS_DIR_UNRESOLVED_MSG);
    return skip;
  }
  // `totem init` writes the config BEFORE this runs, so — when init runs at the
  // git root, the supported layout — the resolved options are the ones the repo
  // just declared, and init and `totem hook install` render identically
  // (mmnto-ai/totem#2692 C1/C7). Off the root, init writes its config at cwd
  // while every hook writer resolves at the git root: a pre-existing split this
  // slice names and does not close.
  const render = await resolveHookRenderOptions(gitRoot, { tier: options?.tier });

  // Render each hook at the tier it is entitled to keep (mmnto-ai/totem#2753 fold
  // F4): nothing pinned + an installed `--strict` hook → strict, not a silent
  // downgrade to standard.
  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook({
      ...render,
      tier: tierForHook(
        hooksDir,
        'pre-commit',
        TOTEM_PRECOMMIT_MARKER,
        TOTEM_PRECOMMIT_END,
        render,
      ),
    }),
    TOTEM_PRECOMMIT_MARKER,
    undefined,
    TOTEM_PRECOMMIT_END,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook({
      ...render,
      tier: tierForHook(hooksDir, 'pre-push', TOTEM_PREPUSH_MARKER, TOTEM_PREPUSH_END, render),
    }),
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
  // A skip with its reason, never a silent "already installed" (mmnto-ai/totem#2760 leg F13).
  for (const [name, action] of [
    ['pre-commit', preCommit],
    ['pre-push', prePush],
  ] as const) {
    if (action === 'skipped-non-utf8') {
      console.error(
        `[Totem] Skipped ${name} hook: the region above its extension (shebang line and managed block) does not decode as UTF-8, so it was left byte-identical. Re-save the hook as UTF-8 and re-run, or take \`totem hook install --force\` (rewrites the whole file and drops your extension).`,
      );
    }
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
        const render = await resolveHookRenderOptions(gitRoot);
        installGitHook(
          hooksDir,
          'post-checkout',
          buildPostCheckoutHookContent(render),
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
  preCommit: GitHookAction;
  prePush: GitHookAction;
  postMerge: GitHookAction;
  postCheckout: GitHookAction;
}

/**
 * Non-interactive hook installer for `totem hooks` and `prepare` scripts.
 * Installs pre-commit, pre-push, and post-merge hooks without prompting.
 *
 * Async since mmnto-ai/totem#2692: the hook text is rendered from the repo's
 * CONFIGURED `totemDir` (and `hooks.tier`), which means one config read —
 * {@link resolveHookRenderOptions} — before anything is written.
 */
export async function installHooksNonInteractive(
  cwd: string,
  force?: boolean,
  options?: { tier?: 'strict' | 'standard' },
): Promise<HooksCommandResult | null> {
  // Guard: must be a git repo — resolve root from any subdirectory. Not-a-repo
  // stays a silent null (the documented contract — callers print); the malformed
  // pointer prints its declared-skip line here so a direct API caller honors the
  // #2410 contract without hooksCommand's pre-guard (#2422 round).
  const { gitRoot, unparseablePointer } = resolveGitRootForHookPath(cwd);
  if (!gitRoot) {
    if (unparseablePointer) console.error(HOOKS_DIR_UNRESOLVED_MSG);
    return null;
  }

  const render = await resolveHookRenderOptions(gitRoot, { tier: options?.tier });

  // Hook managers handle their own installation — generate helper scripts + print guidance
  const manager = detectHookManager(gitRoot);
  if (manager) {
    generateHookHelpers(gitRoot, render);
    printHookManagerGuidance(manager, render.totemDir);
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

  // Same entitlement rule as the init path (mmnto-ai/totem#2753 fold F4) — and it
  // has to hold HERE above all, because `totem hook install` is the bare command
  // the doctor's own stale-block remedy sends people to.
  const preCommit = installGitHook(
    hooksDir,
    'pre-commit',
    buildPreCommitHook({
      ...render,
      tier: tierForHook(
        hooksDir,
        'pre-commit',
        TOTEM_PRECOMMIT_MARKER,
        TOTEM_PRECOMMIT_END,
        render,
      ),
    }),
    TOTEM_PRECOMMIT_MARKER,
    force,
    TOTEM_PRECOMMIT_END,
  );

  const prePush = installGitHook(
    hooksDir,
    'pre-push',
    buildPrePushHook({
      ...render,
      tier: tierForHook(hooksDir, 'pre-push', TOTEM_PREPUSH_MARKER, TOTEM_PREPUSH_END, render),
    }),
    TOTEM_PREPUSH_MARKER,
    force,
    TOTEM_PREPUSH_END,
  );

  const postMergeContent = buildHookContent(render);
  const postMerge = installGitHook(
    hooksDir,
    'post-merge',
    postMergeContent,
    TOTEM_HOOK_MARKER,
    force,
    TOTEM_HOOK_END,
  );

  const postCheckoutContent = buildPostCheckoutHookContent(render);
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

  // Tier precedence (CLI flag > config `hooks.tier` > 'standard') now lives in
  // `resolveHookRenderOptions`, the ONE config→hook-render seam
  // (mmnto-ai/totem#2692 C1) — which `installHooksNonInteractive` calls with the
  // flag below, so the config is read exactly once per invocation and at the
  // git-root anchor the installer writes from.
  const tier: 'strict' | 'standard' | undefined = opts.strict
    ? 'strict'
    : opts.standard
      ? 'standard'
      : undefined;

  const result = await installHooksNonInteractive(cwd, opts.force, { tier });

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
        case 'block-rewritten':
          // Distinct from the whole-file line above: this write REGENERATED the
          // managed block and left everything after the end marker alone. Saying so
          // is the point — a consumer that extends its hooks needs to read, from the
          // summary, that its extension survived (mmnto-ai/totem#2753).
          console.error(
            `[Totem] Drift-repaired ${name} hook (managed block rewritten in place; the attested extension after its end marker carried through unchanged).`,
          );
          break;
        case 'skipped-non-shell':
          console.error(
            `[Totem] Warning: ${name} hook uses a non-shell interpreter. Integrate manually.`,
          );
          break;
        case 'skipped-non-utf8':
          // The eject precedent (mmnto-ai/totem#2620): a skip is reported with its
          // reason and the file is left byte-identical — never "already installed".
          console.error(
            `[Totem] Skipped ${name} hook: the region above its extension (shebang line and managed block) does not decode as UTF-8, so it was left byte-identical. Re-save the hook as UTF-8 and re-run, or take --force (rewrites the whole file and drops your extension).`,
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
  //
  // The Gemini `.js`→`.cjs` migration (mmnto-ai/totem#2481) runs FIRST so the renamed
  // successor is materialized before drift-repair walks the roster — a pre-migration
  // consumer would otherwise be skipped by regenerate-only-if-present and keep its
  // fail-open `.js`.
  await printGeminiHookMigrationSummary(gitRoot, opts.force);
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

// ─── Gemini hook .js→.cjs migration (mmnto-ai/totem#2481 + #2488) ───
//
// A pre-#2481 Totem distributed the write-time guard as `.gemini/hooks/BeforeTool.js`,
// and a pre-#2488 Totem the session briefing as `.gemini/hooks/SessionStart.js`.
// In a `"type": "module"` consumer Node resolves either `.js` as ESM and the hook
// throws `require is not defined` at its top-level `require`. For BeforeTool —
// which IS registered in `.gemini/settings.json` — Gemini CLI degrades the crash
// to a warning, so the write-time guard fail-opens SILENTLY; SessionStart has no
// registration at all (mmnto-ai/totem#2558), so its break bites the host/plain-node
// paths that actually execute it. These functions migrate an upgraded consumer to the `.cjs`
// successors on the upgrade path (`totem hook install`, which the prepare wrapper
// invokes) and on `totem init`. The roster of pairs is data —
// LEGACY_MANAGED_SESSION_HOOKS in init-templates.ts.
//
// Deliberately bounded (the #2478 OPTION 1 ruling routed the adoption/arming slice
// OUT): rename + registration migration + legacy cleanup only — no arming-verification
// and no NEW ownership predicate (reuses markerOpensFile / isBoundedOwnedFile).
// The registration seam is BeforeTool-only by construction: `totem init` emits no
// `.gemini/settings.json` SessionStart command (mmnto-ai/totem#2558), so the
// SessionStart migration is a pure file rename with nothing to rewrite.

export interface GeminiHookMigrationResult {
  /** Repo-relative legacy path acted on. */
  file: string;
  /** `migrated` — successor materialized + legacy removed; `declined` — drifted
   *  unbounded, awaits `--force`; `skipped` — user-owned file, never touched. */
  action: 'migrated' | 'declined' | 'skipped';
  /** Why a non-`migrated` action was taken, when the bare action is not enough.
   *  `user-owned-successor` / `drifted-successor` name a block caused by the file at
   *  the SUCCESSOR path (mmnto-ai/totem#2488): no Totem marker there — the migration
   *  never overwrites a user's successor (even under `--force`); or marker-headed but
   *  unbounded (user content past the end marker) — awaits `--force`. Both files stay
   *  either way. `unreadable-legacy` / `unreadable-successor` name a candidate at the
   *  respective path that could not be READ (a directory sharing the name, a
   *  permissions failure): unprovable ownership is the skip arm, never a crash
   *  (mmnto-ai/totem#2601), and BOTH summary consumers must render it as unreadable —
   *  not as "user-owned", an ownership claim no read ever established. The `totem
   *  init` path surfaces `migrated` and the unreadable reasons; the rest are disclosed
   *  on the `totem hook install` summary path (what `prepare` runs). */
  reason?:
    | 'user-owned-successor'
    | 'drifted-successor'
    | 'unreadable-legacy'
    | 'unreadable-successor';
}

/**
 * Rename-migrate the whole-file artifacts in {@link LEGACY_MANAGED_SESSION_HOOKS}:
 * materialize each `successorRel` from canonical content and remove the bounded
 * totem-owned `legacyRel`. Ownership gate mirrors {@link regenerateManagedSessionHooks}:
 *
 *   - Legacy missing                     → nothing to migrate (omitted from results).
 *   - Legacy present but UNREADABLE      → `skipped` + `reason: 'unreadable-legacy'`
 *                                          (mmnto-ai/totem#2601): a directory sharing
 *                                          the name reads EISDIR, and an ownership gate
 *                                          that crashes init mid-run is worse than one
 *                                          that declines and says so.
 *   - Marker does not OPEN the file      → `skipped` even under `--force` (a user file
 *                                          that merely shares the name is never touched).
 *   - Marker + bounded totem-owned whole file, OR `--force` → materialize successor +
 *                                          remove legacy → `migrated`.
 *   - Marker + drifted/unbounded (trailing user content), no `--force` → `declined`.
 *   - USER-OWNED file at `successorRel`  → `skipped` + `reason: 'user-owned-successor'`,
 *                                          even under `--force`: the ownership gate
 *                                          protects the successor path too, so a
 *                                          hand-authored successor (e.g. an ESM rewrite
 *                                          of the briefing) is never clobbered by the
 *                                          canonical write; both files stay in place.
 *   - Marker-headed but DRIFTED-UNBOUNDED file at `successorRel`, no `--force`
 *                                        → `declined` + `reason: 'drifted-successor'`
 *                                          (same bar as the legacy arm and as
 *                                          regenerateManagedSessionHooks: a bare run
 *                                          repairs only bounded totem-owned files;
 *                                          `--force` overwrites any marker-headed one).
 *
 * A write/remove failure PROPAGATES (Tenet 4 — a migration the tool cannot complete
 * fails loud, never silently reports success), matching the drift-repair path.
 */
export async function migrateLegacyGeminiHooks(
  cwd: string,
  force?: boolean,
): Promise<GeminiHookMigrationResult[]> {
  const { LEGACY_MANAGED_SESSION_HOOKS, isBoundedOwnedFile, markerOpensFile } =
    await import('./init-templates.js');

  const results: GeminiHookMigrationResult[] = [];
  for (const {
    legacyRel,
    successorRel,
    content,
    marker,
    endMarker,
  } of LEGACY_MANAGED_SESSION_HOOKS) {
    const legacyPath = path.join(cwd, ...legacyRel.split('/'));
    if (!fs.existsSync(legacyPath)) continue;

    let existing: string;
    // totem-context: intentional cleanup — a legacy candidate that cannot be read (a DIRECTORY sharing the name → EISDIR, a permissions failure) is not a provably totem-owned artifact to migrate; it takes the same skip arm as a user-owned file, disclosed via `reason`, because the ownership gate must never crash init mid-run.
    try {
      existing = fs.readFileSync(legacyPath, 'utf-8');
      // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
    } catch {
      results.push({ file: legacyRel, action: 'skipped', reason: 'unreadable-legacy' });
      continue;
    }
    if (!markerOpensFile(existing, marker)) {
      results.push({ file: legacyRel, action: 'skipped' });
      continue;
    }
    if (!force && !isBoundedOwnedFile(existing, marker, endMarker)) {
      results.push({ file: legacyRel, action: 'declined' });
      continue;
    }

    // The ownership gate protects the SUCCESSOR path too (mmnto-ai/totem#2488),
    // mirroring regenerateManagedSessionHooks arm for arm: a user-authored file
    // (no marker) is refused even under `--force`; a marker-headed-but-unbounded
    // one (user content past the end marker) is declined until `--force`; only a
    // bounded totem-owned successor — or `--force` on a marker-headed one — takes
    // the canonical write below as an idempotent repair.
    const successorPath = path.join(cwd, ...successorRel.split('/'));
    if (fs.existsSync(successorPath)) {
      let successorExisting: string;
      // totem-context: intentional cleanup — an unreadable successor (a directory sharing the name, EISDIR/EACCES) cannot be proven totem-owned; the ownership gate declines and says so rather than crashing init mid-run (mmnto-ai/totem#2601, same arm as the legacy read).
      try {
        successorExisting = fs.readFileSync(successorPath, 'utf-8');
        // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      } catch (err) {
        void err;
        results.push({ file: legacyRel, action: 'skipped', reason: 'unreadable-successor' });
        continue;
      }
      if (!markerOpensFile(successorExisting, marker)) {
        results.push({ file: legacyRel, action: 'skipped', reason: 'user-owned-successor' });
        continue;
      }
      if (!force && !isBoundedOwnedFile(successorExisting, marker, endMarker)) {
        results.push({ file: legacyRel, action: 'declined', reason: 'drifted-successor' });
        continue;
      }
    }

    // Materialize the successor (idempotent — canonical content) then remove the
    // stale fail-open legacy file. Regenerate-only-if-present would not create the
    // renamed successor on upgrade, but a present legacy artifact is proof of adoption.
    fs.mkdirSync(path.dirname(successorPath), { recursive: true });
    fs.writeFileSync(successorPath, content, 'utf-8');
    fs.rmSync(legacyPath);
    results.push({ file: legacyRel, action: 'migrated' });
  }
  return results;
}

const GEMINI_LEGACY_HOOK_BASENAME_RE = /BeforeTool\.js(?!\w)/g;

/**
 * Idempotently rewrite an existing `.gemini/settings.json` hook registration whose
 * command references the legacy `BeforeTool.js` basename to the `.cjs` successor.
 *
 * Rewrite-if-present ONLY: never CREATES a registration (arming the hook is the
 * deferred adoption slice — #2478 OPTION 1), and fail-soft on unreadable/malformed
 * JSON (preserve user content, mirroring `scaffoldMcpConfig`). Basename matching is
 * separator- and prefix-agnostic, so `$GEMINI_PROJECT_DIR/.gemini/hooks/BeforeTool.js`,
 * `node .gemini/hooks/BeforeTool.js`, and an absolute path all migrate. The rewrite is
 * scoped to the `hooks` subtree, and the file is only rewritten when a change occurred
 * (no churn / reformat on a no-op).
 */
export function migrateGeminiHookRegistration(cwd: string): { changed: boolean; err?: string } {
  const settingsPath = path.join(cwd, '.gemini', 'settings.json');
  if (!fs.existsSync(settingsPath)) return { changed: false };

  let raw: string;
  // Fail-soft is the contract (mmnto-ai/totem#2481): a settings file the tool cannot
  // read/parse is user content and is never clobbered — the read/parse failure is
  // surfaced as a returned `err`, mirroring scaffoldMcpConfig's IO posture.
  try {
    raw = fs.readFileSync(settingsPath, 'utf-8');
    // totem-context: intentional cleanup — surface a read failure as a returned `err`, never a silent swallow.
  } catch (err) {
    return { changed: false, err: err instanceof Error ? err.message : String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // totem-context: intentional cleanup — a malformed settings file is user-owned content, preserved; surface the parse failure as a returned `err`.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      changed: false,
      err: `Could not parse .gemini/settings.json (invalid JSON): ${message}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null) return { changed: false };

  const settings = parsed as Record<string, unknown>;
  const hooks = settings.hooks;
  if (typeof hooks !== 'object' || hooks === null) return { changed: false };

  let changed = false;
  const rewrite = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const next = node.replace(GEMINI_LEGACY_HOOK_BASENAME_RE, 'BeforeTool.cjs');
      if (next !== node) changed = true;
      return next;
    }
    if (Array.isArray(node)) return node.map(rewrite);
    if (typeof node === 'object' && node !== null) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = rewrite(value);
      }
      return out;
    }
    return node;
  };

  settings.hooks = rewrite(hooks);
  if (!changed) return { changed: false };

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    // totem-context: intentional cleanup — surface a write failure as a returned `err` for the caller to log; must not abort the hook-install lifecycle.
  } catch (err) {
    return { changed: false, err: err instanceof Error ? err.message : String(err) };
  }
  return { changed: true };
}

/**
 * Run the Gemini `.js`→`.cjs` migration on the upgrade path and print one summary
 * line per action. Runs BEFORE {@link printManagedSessionHookSummary} so the freshly
 * materialized `.cjs` successor is reported as already-current by drift-repair.
 */
async function printGeminiHookMigrationSummary(cwd: string, force?: boolean): Promise<void> {
  for (const { file, action, reason } of await migrateLegacyGeminiHooks(cwd, force)) {
    switch (action) {
      case 'migrated':
        console.error(
          `[Totem] Migrated ${file} → .cjs (ESM fail-open fix, mmnto-ai/totem#2481 + #2488).`,
        );
        break;
      case 'declined':
        console.error(
          reason === 'drifted-successor'
            ? `[Totem] ${file}: its .cjs successor is marker-headed but has drifted past the bounded region — run \`totem hook install --force\` to overwrite it with canonical.`
            : `[Totem] ${file} has drifted but is not a bounded totem-owned region — run \`totem hook install --force\` to migrate it to .cjs.`,
        );
        break;
      case 'skipped':
        // "User-owned" is an ownership CLAIM — it must never render for the
        // unreadable reasons, where no read ever established ownership (#2601).
        console.error(
          reason === 'user-owned-successor'
            ? `[Totem] ${file}: its .cjs successor already exists and is user-owned — left both files untouched (remove the legacy .js manually if unwanted).`
            : reason === 'unreadable-legacy'
              ? `[Totem] ${file}: could not be read — left in place (remove or rename it to complete the .cjs migration).`
              : reason === 'unreadable-successor'
                ? `[Totem] ${file}: its .cjs successor could not be read — left both files untouched (remove or rename the successor to complete the migration).`
                : `[Totem] ${file}: user-owned file (no Totem marker) — left untouched.`,
        );
        break;
    }
  }
  const registration = migrateGeminiHookRegistration(cwd);
  if (registration.err) {
    console.error(
      `[Totem] .gemini/settings.json BeforeTool registration not migrated: ${registration.err}`,
    );
  } else if (registration.changed) {
    console.error('[Totem] Migrated .gemini/settings.json BeforeTool registration → .cjs.');
  }
}

// ─── Silent hook upgrade ──────────────────────────────

/**
 * Silently upgrade the pre-push hook if it was installed by Totem but uses
 * an old format (flag-checking or command-executing) instead of the new
 * stateless format that runs verify-manifest + lint directly.
 *
 * Returns true if the hook was upgraded, false otherwise.
 *
 * Async since mmnto-ai/totem#2692: the spliced block is rendered from the repo's
 * configured `totemDir` and `hooks.tier` like every other writer, so it no
 * longer silently downgrades a strict hook to standard on the upgrade path.
 */
export async function upgradePrePushHookIfNeeded(cwd: string): Promise<boolean> {
  try {
    const gitRoot = resolveGitRoot(cwd);
    if (!gitRoot) return false;

    const hooksDir = resolveHooksDir(gitRoot);
    if (!hooksDir) return false;

    const hookPath = path.join(hooksDir, 'pre-push');
    if (!fs.existsSync(hookPath)) return false;

    const rawContent = fs.readFileSync(hookPath);
    const content = rawContent.toString('utf-8');

    // Only upgrade hooks that Totem owns (have our marker) — block presence FIRST,
    // the order eject.ts ruled, so the two sites read alike even though this one
    // returns a bare `false` either way.
    if (!content.includes(TOTEM_PREPUSH_MARKER)) return false;

    // The splice below is text on both sides of the block, so it is byte-exact
    // only when the whole file decoded losslessly. A hook that does not
    // round-trip UTF-8 is declined here — this upgrader's ruled posture is a
    // silent `false` (mmnto-ai/totem#2692 N4), and declining beats writing U+FFFD
    // over a user's bytes (mmnto-ai/totem#2620's eject ruling, mmnto-ai/totem#2760
    // leg F9). Such a hook keeps its old block and takes `totem hook install --force`.
    if (!Buffer.from(content, 'utf-8').equals(rawContent)) return false;

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

    // totem-context: mmnto-ai/totem#2753 — this upgrader is unreachable for any hook carrying TOTEM_HOOK_TIER (the verify-manifest guard above skips every current template), so it renders from config alone; if that guard ever changes, route through tierForHook.
    const render = await resolveHookRenderOptions(gitRoot);

    // Build the replacement block (strip shebang — we're splicing into existing file)
    const newBlock = buildPrePushHook(render)
      .replace(/^#!\/bin\/sh\n/, '')
      .trimStart();

    // Splice: preserve everything before and after the totem block
    const before = content.slice(0, markerIdx);
    const after = content.slice(blockEnd);
    const upgraded = before + newBlock.trimEnd() + after;

    // The splice keeps the user's lines on BOTH sides of the block — the exact
    // shape Greptile P1 named on the attested-extension arm — so it takes the same
    // atomic, executable write (mmnto-ai/totem#2760 round 1, leg F4).
    writeExecutableHook(hookPath, upgraded);

    return true;
  } catch {
    // Silent upgrade is best-effort — never crash review for a hook upgrade failure
    return false;
  }
}

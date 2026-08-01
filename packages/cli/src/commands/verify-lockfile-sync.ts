// ─── Constants ──────────────────────────────────────────

const TAG = 'VerifyLockfileSync';

// Single-lockfile assumption (pnpm-only per mmnto-ai/totem#1961 NOT-in-scope).
// Workspaces produce a single root lockfile by default; nested lockfiles in
// pnpm are rare and not covered by this gate.
const LOCKFILE_PATH = 'pnpm-lock.yaml';

const AUX_LOOKUP_TIMEOUT_MS = 10_000;

// Match dependency-pin additions in a unified diff. Anchors, left to right:
//   `^\+`         — line starts with a single `+`. Unified-diff file-header
//                   lines (`+++ b/path`) fail because the next char is `+`,
//                   not `\s` or `"`.
//   `\s*"`        — optional indent, then the opening quote of a JSON key.
//   `(?!version")` — negative lookahead rejects the package's own top-level
//                   `"version"` field, which appears in every Version
//                   Packages release commit without a lockfile diff yet
//                   correctly indicates the lockfile WAS regenerated (it
//                   appears separately in the diff and trips the fast-pass).
//                   The exclusion only matters when the lockfile happens to
//                   be absent for unrelated reasons.
//   `[^"]+"\s*:\s*"`
//                — the rest of the key plus the `: "` value-opener.
//   `[\^~]?\d+\.\d+`
//                — value starts with optional caret/tilde, then requires a
//                   major.minor digit pair. Rejects bare integer values like
//                   `"node": "20"` in the `engines` block (an over-tightening
//                   that costs one false-negative class on engine-only bumps,
//                   which generally don't require a lockfile diff anyway) and
//                   rejects `workspace:^` references (no leading digit).
const DEP_BUMP_RE = /^\+\s*"(?!version")[^"]+"\s*:\s*"[\^~]?\d+\.\d+/m;

// Match a QUOTED pnpm-lockfile key line (sign already stripped when the line
// comes from a diff). Anchors, left to right:
//   `^\s+`   — required indent. Every key that names a package is nested (an
//              importer's dependency block, `packages:`, `snapshots:`), so the
//              document-level keys (`lockfileVersion:`, `importers:`) never match.
//   `'([^']+)'`
//            — the quoted key. pnpm quotes any key containing `@` or another
//              YAML-special char, which is every scoped name and every
//              `name@version` packages/snapshots key.
//   `:`      — the key terminator. A quoted key is accepted with or without a
//              scalar value: pnpm only quotes package names, so there is no
//              metadata-key collision to exclude here.
const LOCKFILE_QUOTED_KEY_RE = /^\s+'([^']+)':/;

// Match a BARE pnpm-lockfile key line (sign already stripped). Same indent
// anchor as above, plus:
//   `([^'\s:]+)`
//            — the unquoted key (`ajv@8.18.0`, `commander`, `packages/cli`).
//   `:(?:\s*\{\})?\s*$`
//            — the key must carry NO scalar value (`foo@1.0.0:`) or the empty
//              mapping (`foo@1.0.0: {}`). That is what pnpm emits for package
//              keys, and it structurally excludes the scalar metadata keys
//              (`resolution:`, `specifier:`, `version:`, `engines:`, `optional:`)
//              without maintaining a blocklist. A package that disappears from
//              the lockfile always loses its valueless `packages:`/`snapshots:`
//              key line, so the restriction costs no detection.
const LOCKFILE_BARE_KEY_RE = /^\s+([^'\s:]+):(?:\s*\{\})?\s*$/;

// pnpm-lockfile GRAMMAR keys that are valueless like a package key but never
// name a package. Without this, removing a repo's last devDependency would make
// `devDependencies` a candidate — absent from the HEAD lockfile, and "declared"
// because package.json still carries a `"devDependencies": {}` key — a false
// block on a legitimate push. The cost is that a dependency named EXACTLY one of
// these strings is invisible to the gate; a false block on a real push is the
// worse failure (mmnto-ai/totem#2473 class).
const LOCKFILE_STRUCTURAL_KEYS = new Set([
  'catalogs',
  'dependencies',
  'devDependencies',
  'importers',
  'optionalDependencies',
  'overrides',
  'packages',
  'patchedDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'settings',
  'snapshots',
  'transitivePeerDependencies',
]);

// The manifest blocks whose keys are install-resolvable dependency
// declarations — the only blocks that answer "is this pin still declared?".
// `overrides` / `resolutions` are excluded by design (see isDeclaredAtHead).
const MANIFEST_DEPENDENCY_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

// `git show` / `git grep -l` blob-ref prefix for the HEAD revision. Named once
// so the ref built here and the ref parsed out of grep's output cannot drift.
const HEAD_REF_PREFIX = 'HEAD:';

// The reason-string discriminant for the removed-pin failure class
// (mmnto-ai/totem-strategy#630). `VerifyLockfileSyncResult` carries no class
// field by contract, so the CLI wrapper keys its recovery hint off this prefix —
// the two failure classes must never share a remedy.
const REMOVED_PIN_REASON_PREFIX = `${LOCKFILE_PATH} no longer contains any entry for a package whose pin is still declared in a tracked package.json at HEAD`;

// ─── Types ──────────────────────────────────────────────

/** The `safeExec` surface this command uses (core's signature, narrowed). */
type SafeExecFn = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => string;

/** The `log` surface the best-effort probes use for their declared skips. */
type SkipLogger = { info: (tag: string, msg: string) => void };

export interface VerifyLockfileSyncResult {
  valid: boolean;
  /** Set only when valid === false; describes the detected failure. The recovery action lives on the TotemError's recoveryHint at the CLI layer. */
  reason?: string;
}

// ─── Removed-pin predicate (mmnto-ai/totem-strategy#630) ─

/**
 * The package NAME a lockfile key denotes, or `null` when the line is not a key
 * line. Strips a peer parenthetical (`pkg@1.0.0(react@19.0.0)`) and the trailing
 * `@<version>` suffix: npm forbids `@` inside a package name except the leading
 * scope marker, so the last `@` past index 0 always opens the version.
 */
function lockfileKeyName(line: string): string | null {
  const match = LOCKFILE_QUOTED_KEY_RE.exec(line) ?? LOCKFILE_BARE_KEY_RE.exec(line);
  if (match === null) return null;
  if (LOCKFILE_STRUCTURAL_KEYS.has(match[1]!)) return null;
  const key = match[1]!.split('(')[0]!;
  const versionAt = key.lastIndexOf('@');
  return versionAt > 0 ? key.slice(0, versionAt) : key;
}

/**
 * Whether `name` is still declared as a dependency of a tracked package.json at
 * HEAD.
 *
 * The quoted-key `git grep` is only a cheap PREFILTER, never the answer: the
 * manifest key namespace overlaps the npm name namespace, so `"<name>":` also
 * matches a manifest FIELD. A repo legitimately removing the real npm package
 * `type` would match `"type": "module"` in every manifest and be told its pin is
 * still declared — a false block on a legitimate push (mmnto-ai/totem#2473
 * class). Membership is therefore decided by parsing each prefilter hit and
 * testing the install-resolvable dependency blocks.
 *
 * `overrides` / `resolutions` are deliberately NOT counted: a name appearing
 * only there constrains how some OTHER package's dependency resolves and is not
 * itself a declaration that must resolve. The #630 class is about declared
 * dependencies that silently stop resolving.
 */
function isDeclaredAtHead(safeExec: SafeExecFn, repoRoot: string, name: string): boolean {
  let hits: string[];
  try {
    hits = safeExec(
      'git',
      [
        'grep',
        '-l',
        '--fixed-strings',
        `"${name}":`,
        'HEAD',
        '--',
        'package.json',
        '**/package.json',
      ],
      { cwd: repoRoot, timeout: AUX_LOOKUP_TIMEOUT_MS },
    )
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    // totem-context: git grep exits 1 on NO MATCH, which safeExec surfaces as a throw — indistinguishable here from a genuine probe failure, and both answer "not declared" so the gate passes (mmnto/totem#1440 Tenet 4 init-class: a probe that cannot answer never blocks a push)
  } catch {
    return false;
  }

  for (const hit of hits) {
    // `git grep -l <rev>` prints `<rev>:<path>`; read that exact blob back.
    const file = hit.startsWith(HEAD_REF_PREFIX) ? hit.slice(HEAD_REF_PREFIX.length) : hit;
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        safeExec('git', ['show', `${HEAD_REF_PREFIX}${file}`], {
          cwd: repoRoot,
          timeout: AUX_LOOKUP_TIMEOUT_MS,
        }),
      );
      // totem-context: per-file best-effort — a manifest that cannot be read or parsed at HEAD cannot answer the membership question, so this hit is skipped rather than counted as a declaration (mmnto/totem#1440 Tenet 4 init-class: a probe that cannot answer never blocks a push)
    } catch {
      continue;
    }
    if (typeof manifest !== 'object' || manifest === null) continue;
    for (const block of MANIFEST_DEPENDENCY_BLOCKS) {
      const declared = (manifest as Record<string, unknown>)[block];
      if (typeof declared !== 'object' || declared === null) continue;
      if (Object.hasOwn(declared, name)) return true;
    }
  }
  return false;
}

/**
 * Packages the diff range removes from the lockfile entirely while their pin
 * stays declared — the mmnto-ai/totem-strategy#630 live-fire class, where a
 * failed optional-dependency fetch drops every importer/packages/snapshots entry
 * for a working dep and `pnpm install` still exits 0.
 *
 * Candidate generation deliberately over-generates (any removed key line whose
 * name is not re-added in the same diff); the decisive predicate below filters:
 * a candidate fails only when it resolves NOWHERE in the lockfile at HEAD AND is
 * still declared in a tracked package.json at HEAD. Every git read is
 * best-effort — a probe that cannot answer logs a skip and passes the gate, per
 * the file's #1440 carve-out.
 */
function findRemovedPins(
  safeExec: SafeExecFn,
  log: SkipLogger,
  repoRoot: string,
  resolvedRef: string,
): string[] {
  let lockfileDiff: string;
  try {
    lockfileDiff = safeExec('git', ['diff', `${resolvedRef}...HEAD`, '--', LOCKFILE_PATH], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort lockfile-diff lookup — failure means the removed-pin check cannot evaluate, so it declares the skip and passes rather than blocking (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    log.info(TAG, `Could not read the ${LOCKFILE_PATH} diff — skipping the removed-pin check.`);
    return [];
  }

  const removed = new Set<string>();
  const added = new Set<string>();
  for (const line of lockfileDiff.split('\n')) {
    const sign = line[0];
    if (sign !== '-' && sign !== '+') continue;
    const name = lockfileKeyName(line.slice(1));
    if (name === null) continue;
    (sign === '-' ? removed : added).add(name);
  }
  const candidates = [...removed].filter((name) => !added.has(name));
  if (candidates.length === 0) return [];

  let headLockfile: string;
  try {
    headLockfile = safeExec('git', ['show', `${HEAD_REF_PREFIX}${LOCKFILE_PATH}`], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort HEAD-lockfile probe — without it a dedupe is indistinguishable from a full removal, so the check declares the skip and passes (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    log.info(TAG, `Could not read ${LOCKFILE_PATH} at HEAD — skipping the removed-pin check.`);
    return [];
  }
  const headNames = new Set<string>();
  for (const line of headLockfile.split('\n')) {
    const name = lockfileKeyName(line);
    if (name !== null) headNames.add(name);
  }

  return candidates.filter(
    (name) => !headNames.has(name) && isDeclaredAtHead(safeExec, repoRoot, name),
  );
}

// ─── Main command ───────────────────────────────────────

/**
 * Programmatic surface — returns the verification result without exiting or
 * throwing. The CLI action layer wraps this and throws a `TotemError` when
 * `result.valid === false` so the top-level `handleError` produces the exit
 * code (avoids direct `process.exit()` calls per AGENTS.md doctrine).
 *
 * Best-effort fall-through on git failures (matches verify-manifest's pattern
 * at packages/cli/src/commands/verify-manifest.ts:127-131): init-class
 * transient failures (no remote, detached HEAD, missing refs) skip the gate
 * rather than block pushes that are otherwise legitimate. Tenet 4's
 * fail-loud mandate has a documented carve-out for best-effort init-time
 * surfaces; the empty catches below carry `totem-context:` directives
 * locating that carve-out.
 */
export async function verifyLockfileSyncCommand(): Promise<VerifyLockfileSyncResult> {
  const { getDefaultBranch, resolveGitRoot, safeExec } = await import('@mmnto/totem');
  const { bold, log, success: successColor } = await import('../ui.js');

  const cwd = process.cwd();
  const repoRoot = resolveGitRoot(cwd);
  if (!repoRoot) {
    log.info(TAG, 'Not inside a git repo — skipping lockfile-sync verification.');
    return { valid: true };
  }

  // Precondition: the lockfile must be tracked. When gitignored or absent
  // from the index the gate does not apply (e.g., consumers using a
  // different package manager, or workspaces that explicitly exclude the
  // lockfile).
  let trackedLockfile = '';
  try {
    trackedLockfile = safeExec('git', ['ls-files', '--', LOCKFILE_PATH], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort tracking probe — git failures here fall through to pass, matching verify-manifest's getDefaultBranch carve-out (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }
  if (trackedLockfile.length === 0) {
    log.info(TAG, `${LOCKFILE_PATH} is not tracked — skipping.`);
    return { valid: true };
  }

  // Resolve the default branch for the diff range. Best-effort: a degraded
  // git state (no remote, detached HEAD) falls through rather than blocking
  // pushes whose ref topology happens to defeat detection.
  let baseBranch: string;
  try {
    baseBranch = getDefaultBranch(repoRoot);
    // totem-context: best-effort default-branch lookup — git failures here fall through to pass, matching verify-manifest's getDefaultBranch carve-out (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }

  // Prefer origin/<base> over local <base> — local refs may be stale when
  // the user hasn't pulled recently, producing inconsistent gate behavior
  // between local and CI. Matches verify-manifest's `tryReadBaseFingerprint`
  // ref-order pattern.
  let changedFiles = '';
  let resolvedRef: string | null = null;
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    try {
      changedFiles = safeExec('git', ['diff', '--name-only', `${ref}...HEAD`], {
        cwd: repoRoot,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
      });
      resolvedRef = ref;
      break;
      // totem-context: best-effort diff-range probe — try next ref candidate; fully exhausted both → fall through to pass (mmnto/totem#1440 Tenet 4 init-class)
    } catch {
      continue;
    }
  }
  if (resolvedRef === null) {
    log.info(TAG, 'Could not resolve diff range against default branch — skipping.');
    return { valid: true };
  }

  const files = changedFiles.split('\n').filter(Boolean);

  // Fast-pass: lockfile present in the diff range → the push includes the
  // expected lockfile companion to whatever package.json changes ride
  // alongside it. Most cohort-sync PRs and all Version Packages PRs land
  // here.
  if (files.includes(LOCKFILE_PATH)) {
    // A present lockfile is not a synced lockfile: the diff can also REMOVE a
    // package outright while package.json keeps its pin
    // (mmnto-ai/totem-strategy#630). Checked before the pass so the fast-pass
    // cannot launder that shape.
    const removedPins = findRemovedPins(safeExec, log, repoRoot, resolvedRef);
    if (removedPins.length > 0) {
      return {
        valid: false,
        reason: `${REMOVED_PIN_REASON_PREFIX}: ${removedPins.join(', ')}. The diff range removes every lockfile entry for the package(s), so the declared dependency cannot resolve.`,
      };
    }
    const label = successColor(bold('PASS'));
    log.success(TAG, `${label} — ${LOCKFILE_PATH} present in diff range.`);
    return { valid: true };
  }

  // Filter to package.json files in any directory (monorepo nested case).
  const pkgJsonPaths = files.filter((f) => f === 'package.json' || f.endsWith('/package.json'));
  if (pkgJsonPaths.length === 0) {
    return { valid: true };
  }

  // Pull the unified diff for the package.json files and scan for
  // dependency-pin additions. `safeExec`'s arg-array form handles quoting,
  // so multiple paths pass safely with no shell metacharacter risk.
  let unifiedDiff = '';
  try {
    unifiedDiff = safeExec('git', ['diff', `${resolvedRef}...HEAD`, '--', ...pkgJsonPaths], {
      cwd: repoRoot,
      timeout: AUX_LOOKUP_TIMEOUT_MS,
    });
    // totem-context: best-effort unified-diff lookup — failure here means the gate cannot evaluate confidently, so fall through to pass rather than block (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    return { valid: true };
  }

  if (DEP_BUMP_RE.test(unifiedDiff)) {
    return {
      valid: false,
      reason: `Tracked lockfile detected, but ${LOCKFILE_PATH} is missing from the diff range while a package.json adds a dependency pin.`,
    };
  }

  const label = successColor(bold('PASS'));
  log.success(TAG, `${label} — package.json diff present without dependency-pin additions.`);
  return { valid: true };
}

/**
 * CLI entry — wraps `verifyLockfileSyncCommand` and throws on failure so the
 * top-level `handleError` produces the non-zero exit code without a direct
 * `process.exit` call.
 */
export async function verifyLockfileSyncCliCommand(): Promise<void> {
  const { TotemError } = await import('@mmnto/totem');

  const result = await verifyLockfileSyncCommand();
  if (!result.valid) {
    // Two failure classes, two remedies. The removed-pin class is NOT fixed by a
    // plain `pnpm install` — that is precisely the command that produced it.
    const recoveryHint = result.reason!.startsWith(REMOVED_PIN_REASON_PREFIX)
      ? `A failed optional-dependency fetch (an expired or missing registry token) silently removes every ${LOCKFILE_PATH} entry for a package while its pin stays declared in package.json — exit 0, no warning (mmnto-ai/totem-strategy#630 class). Verify registry auth with \`npm whoami\`, regenerate with \`pnpm update <pkg>\` (NOT \`pnpm install --lockfile-only\`, which false-reports "Already up to date" on an optional-dependency drop), then commit the regenerated ${LOCKFILE_PATH}.`
      : `Run \`pnpm install\` from the repo root to regenerate ${LOCKFILE_PATH}, then stage and commit it before re-pushing. CI runs with \`--frozen-lockfile\` and rejects pushes where a tracked package.json declares dependency pins that the lockfile does not reflect.`;
    throw new TotemError('CHECK_FAILED', result.reason!, recoveryHint);
  }
}

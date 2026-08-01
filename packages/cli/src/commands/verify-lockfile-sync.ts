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

// Parse ONE lockfile line into its indent and key. Anchors, left to right:
//   `^( *)`  — the indent, CAPTURED: YAML nesting is the only structure signal
//              the lockfile gives, and the section walker needs the depth, not
//              just the key.
//   `(?:'([^']+)'|([^'\s:]+))`
//            — the key, quoted (pnpm quotes scoped names and any key holding a
//              YAML-special char) or bare (`ajv@8.18.0`, `packages/cli`, `.`).
//   `:(?:\s.*)?$`
//            — the key terminator plus an optional value. A value is NOT
//              disqualifying here, unlike the candidate-side regexes: the walker
//              decides membership by section and depth, so it needs no
//              value-shape proxy for structure.
const LOCKFILE_KEY_LINE_RE = /^( *)(?:'([^']+)'|([^'\s:]+)):(?:\s.*)?$/;

// Ceiling on removed-key candidates before the check declares a skip. A
// lockfile-format rewrite (a pnpm major migration) rewrites every key in the
// file: an uncapped run on a v6→v9 migration generates ~900 candidates and
// grinds for ~26 seconds inside a push gate. A declared skip naming the count is
// honest; a silent grind is not.
const MAX_REMOVED_PIN_CANDIDATES = 25;

// pnpm-lockfile GRAMMAR keys that are valueless like a package key but never
// name a package. Candidate parsing works line-by-line off a DIFF, which carries
// no section context, so the guard is still needed there (the HEAD-side harvest
// is section-aware and needs no blocklist). Without it, removing a repo's last
// devDependency would make `devDependencies` a candidate — absent from the HEAD
// lockfile, and "declared" because package.json still carries a
// `"devDependencies": {}` key — a false block on a legitimate push. The cost is
// that a dependency named EXACTLY one of these strings is invisible to the gate;
// a false block on a real push is the worse failure (mmnto-ai/totem#2473 class).
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
// `overrides` / `resolutions` are excluded by design (see
// collectImporterDeclarations). Doubles as the importer-side dependency-block
// set for the lockfile walker: the lockfile mirrors these manifest blocks.
const MANIFEST_DEPENDENCY_BLOCKS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

// `git show` blob-ref prefix for the HEAD revision. Named once so every
// HEAD-blob read in this file builds the same ref shape.
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

/** What the lockfile at HEAD says about itself. */
interface HeadLockfileIndex {
  /** Package names this lockfile RESOLVES at HEAD. */
  resolved: Set<string>;
  /** Workspace importer paths — `.` for the repo root, else a directory path. */
  importers: string[];
}

export interface VerifyLockfileSyncResult {
  valid: boolean;
  /** Set only when valid === false; describes the detected failure. The recovery action lives on the TotemError's recoveryHint at the CLI layer. */
  reason?: string;
}

// ─── Removed-pin predicate (mmnto-ai/totem-strategy#630) ─

/**
 * The package NAME a lockfile key denotes. Strips a peer parenthetical
 * (`pkg@1.0.0(react@19.0.0)`) and the trailing `@<version>` suffix: npm forbids
 * `@` inside a package name except the leading scope marker, so the last `@`
 * past index 0 always opens the version.
 */
function packageNameFromKey(key: string): string {
  const withoutPeers = key.split('(')[0]!;
  const versionAt = withoutPeers.lastIndexOf('@');
  return versionAt > 0 ? withoutPeers.slice(0, versionAt) : withoutPeers;
}

/**
 * The package NAME a REMOVED diff line denotes, or `null` when the line is not a
 * key line. Diff-side only: a hunk carries no section context, so this leans on
 * key shape plus the structural-key blocklist.
 */
function lockfileKeyName(line: string): string | null {
  const match = LOCKFILE_QUOTED_KEY_RE.exec(line) ?? LOCKFILE_BARE_KEY_RE.exec(line);
  if (match === null) return null;
  if (LOCKFILE_STRUCTURAL_KEYS.has(match[1]!)) return null;
  return packageNameFromKey(match[1]!);
}

/**
 * Index the lockfile at HEAD by SECTION and DEPTH, not by key-line shape.
 *
 * A shape-only harvest laundered the very class this gate exists to catch:
 * `peerDependenciesMeta:` children (`      zod:` / `optional: true`) are
 * valueless key lines that SURVIVE a package's total removal, so a fully dropped
 * package still answered "resolves at HEAD" and the gate passed — 21 such blocks
 * in this repo's own lockfile. Only two things prove resolution: a
 * `packages:`/`snapshots:` entry, and a workspace importer's dependency-block
 * key (a workspace link has no `packages:` entry). Peer metadata, catalogs and
 * settings are commentary ABOUT resolution, not resolution.
 *
 * The same pass collects the importer paths — the lockfile's own answer to
 * "which manifests do I resolve?" — which scopes the declaration probe below.
 *
 * Child indents are learned from the file rather than hardcoded: the first line
 * deeper than a section header defines that level's indent.
 */
function indexHeadLockfile(content: string): HeadLockfileIndex {
  const resolved = new Set<string>();
  const importers: string[] = [];

  let section: string | null = null;
  let sectionChildIndent: number | null = null;
  let dependencyBlockIndent: number | null = null;
  let declarationIndent: number | null = null;
  let inDependencyBlock = false;

  for (const line of content.split('\n')) {
    const match = LOCKFILE_KEY_LINE_RE.exec(line);
    if (match === null) continue;
    const indent = match[1]!.length;
    const key = match[2] ?? match[3]!;

    if (indent === 0) {
      section = key;
      sectionChildIndent = null;
      dependencyBlockIndent = null;
      declarationIndent = null;
      inDependencyBlock = false;
      continue;
    }
    if (section === null) continue;

    if (section === 'packages' || section === 'snapshots') {
      sectionChildIndent ??= indent;
      if (indent === sectionChildIndent) resolved.add(packageNameFromKey(key));
      continue;
    }
    if (section !== 'importers') continue;

    sectionChildIndent ??= indent;
    if (indent === sectionChildIndent) {
      importers.push(key);
      dependencyBlockIndent = null;
      declarationIndent = null;
      inDependencyBlock = false;
      continue;
    }
    dependencyBlockIndent ??= indent;
    if (indent === dependencyBlockIndent) {
      inDependencyBlock = (MANIFEST_DEPENDENCY_BLOCKS as readonly string[]).includes(key);
      declarationIndent = null;
      continue;
    }
    if (!inDependencyBlock) continue;
    declarationIndent ??= indent;
    if (indent === declarationIndent) resolved.add(packageNameFromKey(key));
  }

  return { resolved, importers };
}

/** The manifest an importer path owns (`.` is the repo root). */
function importerManifestPath(importer: string): string {
  return importer === '.' ? 'package.json' : `${importer}/package.json`;
}

/**
 * The lockfile at HEAD, indexed — or `null` with a declared skip when it cannot
 * be read. Both the resolves-at-HEAD test and the importer scope derive from it,
 * so a failed read means neither question can be answered honestly.
 */
function readHeadLockfileIndex(
  safeExec: SafeExecFn,
  log: SkipLogger,
  repoRoot: string,
): HeadLockfileIndex | null {
  try {
    return indexHeadLockfile(
      safeExec('git', ['show', `${HEAD_REF_PREFIX}${LOCKFILE_PATH}`], {
        cwd: repoRoot,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
      }),
    );
    // totem-context: declared-skip probe — without the HEAD lockfile the gate cannot tell a dedupe from a full removal, nor a workspace manifest from a stray one, so it announces the skip and passes (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    log.info(
      TAG,
      `Could not read ${LOCKFILE_PATH} at HEAD — skipping the workspace-scoped checks.`,
    );
    return null;
  }
}

/**
 * Every package name declared in an install-resolvable dependency block of a
 * WORKSPACE IMPORTER manifest at HEAD.
 *
 * Scoped to importers deliberately. A tracked manifest that is NOT an importer —
 * a separately-deployed service, a test fixture — declares pins this lockfile
 * never resolves, so counting it converts a legitimate transitive-dependency
 * drop into a hard block with an unusable remedy. Reproduced against the built
 * CLI: a `@modelcontextprotocol/sdk` bump dropped transitive `hono`, which
 * `services/compile-worker/package.json` declares, and the gate blocked the
 * push. The importer set is the lockfile's own definition of the manifests it
 * resolves, so it is the only sound scope for the question.
 *
 * `overrides` / `resolutions` are not counted: a name appearing only there
 * constrains how some OTHER package's dependency resolves and is not itself a
 * declaration that must resolve.
 */
function collectImporterDeclarations(
  safeExec: SafeExecFn,
  log: SkipLogger,
  repoRoot: string,
  importers: string[],
): Set<string> {
  const declared = new Set<string>();
  const unreadable: string[] = [];

  for (const importer of importers) {
    const file = importerManifestPath(importer);
    let manifest: unknown;
    try {
      manifest = JSON.parse(
        safeExec('git', ['show', `${HEAD_REF_PREFIX}${file}`], {
          cwd: repoRoot,
          timeout: AUX_LOOKUP_TIMEOUT_MS,
        }),
      );
      // totem-context: per-manifest skip, DECLARED once below — an unreadable or unparseable importer manifest at HEAD cannot answer the membership question; the paths are collected and reported in a single log line rather than silently dropped or spammed per file (mmnto/totem#1440 Tenet 4 init-class)
    } catch {
      unreadable.push(file);
      continue;
    }
    if (typeof manifest !== 'object' || manifest === null) {
      unreadable.push(file);
      continue;
    }
    for (const block of MANIFEST_DEPENDENCY_BLOCKS) {
      const deps = (manifest as Record<string, unknown>)[block];
      if (typeof deps !== 'object' || deps === null) continue;
      for (const name of Object.keys(deps)) declared.add(name);
    }
  }

  if (unreadable.length > 0) {
    log.info(
      TAG,
      `Could not read ${unreadable.length} importer manifest(s) at HEAD (${unreadable.join(', ')}) — their declarations are not counted.`,
    );
  }
  return declared;
}

/**
 * Packages the diff range removes from the lockfile entirely while their pin
 * stays declared by a workspace importer — the mmnto-ai/totem-strategy#630
 * live-fire class, where a failed optional-dependency fetch drops every
 * importer/packages/snapshots entry for a working dep and `pnpm install` still
 * exits 0.
 *
 * Candidates are every name on a REMOVED key line, with no added-side
 * subtraction: that subtraction was an optimization the corrected
 * resolves-at-HEAD test already subsumes, and it was itself a laundering vector
 * (an ADDED `peerDependenciesMeta` child naming the dropped package excluded it
 * from the candidate set entirely). Over-generation stays safe because the
 * decisive predicate is sound: a candidate fails only when it resolves NOWHERE
 * at HEAD AND a workspace importer still declares it. Every git read is
 * best-effort with a DECLARED skip — this feature has no silent skips.
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
    // totem-context: declared-skip probe — failure means the removed-pin check cannot evaluate, so it announces the skip and passes rather than blocking (mmnto/totem#1440 Tenet 4 init-class)
  } catch {
    log.info(TAG, `Could not read the ${LOCKFILE_PATH} diff — skipping the removed-pin check.`);
    return [];
  }

  const candidates = new Set<string>();
  for (const line of lockfileDiff.split('\n')) {
    if (line[0] !== '-') continue;
    const name = lockfileKeyName(line.slice(1));
    if (name !== null) candidates.add(name);
  }
  if (candidates.size === 0) return [];
  if (candidates.size > MAX_REMOVED_PIN_CANDIDATES) {
    log.info(
      TAG,
      `The ${LOCKFILE_PATH} diff removes ${candidates.size} distinct package keys (cap ${MAX_REMOVED_PIN_CANDIDATES}) — that is a lockfile-format rewrite or a pnpm major migration, not a dropped pin; skipping the removed-pin check.`,
    );
    return [];
  }

  const index = readHeadLockfileIndex(safeExec, log, repoRoot);
  if (index === null) return [];

  const unresolved = [...candidates].filter((name) => !index.resolved.has(name));
  if (unresolved.length === 0) return [];

  const declared = collectImporterDeclarations(safeExec, log, repoRoot, index.importers);
  return unresolved.filter((name) => declared.has(name));
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

  // Narrow to WORKSPACE IMPORTER manifests. A tracked manifest this lockfile
  // does not resolve — a test fixture, a separately-deployed service — needs no
  // lockfile companion when it gains a pin, so counting it hard-fails a correct
  // push (reproduced against the built CLI). The importer set is the lockfile's
  // own answer, so it is derived from the lockfile at HEAD here too.
  const headIndex = readHeadLockfileIndex(safeExec, log, repoRoot);
  if (headIndex === null) {
    return { valid: true };
  }
  const importerManifests = new Set(headIndex.importers.map(importerManifestPath));
  const workspacePkgJsonPaths = pkgJsonPaths.filter((f) => importerManifests.has(f));
  if (workspacePkgJsonPaths.length === 0) {
    log.info(
      TAG,
      `Changed package.json file(s) are not workspace importers of ${LOCKFILE_PATH} — no lockfile companion is required.`,
    );
    return { valid: true };
  }

  // Pull the unified diff for the package.json files and scan for
  // dependency-pin additions. `safeExec`'s arg-array form handles quoting,
  // so multiple paths pass safely with no shell metacharacter risk.
  let unifiedDiff = '';
  try {
    unifiedDiff = safeExec(
      'git',
      ['diff', `${resolvedRef}...HEAD`, '--', ...workspacePkgJsonPaths],
      {
        cwd: repoRoot,
        timeout: AUX_LOOKUP_TIMEOUT_MS,
      },
    );
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

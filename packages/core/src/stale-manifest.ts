/**
 * Stale `installed-packs.json` detector for the rule-engine UX nudge
 * fast-path (mmnto-ai/totem#1811, ADR-101).
 *
 * When `applyAstRulesToAdditions` hits a Tree-sitter language miss
 * (file extension mapped by no registered language), it normally
 * throws `TotemParseError` with an "install the pack" hint. After
 * `mmnto-ai/totem#1811` the rule-engine first asks this module
 * whether the user is one `totem sync --packs-only` away from a
 * working state — pre-1.27.0 manifest, missing manifest, malformed
 * cohort, or a cohort whose major.minor differs from the running
 * engine. Patch-level cohort drift passes (caret-range pack semver
 * tolerance — OQ2 disposition).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as semver from 'semver';

import { TotemError } from './errors.js';
import { InstalledPacksManifestSchema, resolveEngineVersion } from './pack-discovery.js';

export type StaleManifestReason = 'no-manifest' | 'no-cohort' | 'cohort-mismatch';

export interface StaleManifestDetection {
  readonly reason: StaleManifestReason;
  /** Manifest's recorded cohort, if present and parseable. */
  readonly manifestCohort?: string;
  /** Running `@mmnto/totem` engine version. */
  readonly engineVersion: string;
}

export interface DetectStaleManifestOptions {
  /** Project root (where `.totem/` lives). */
  readonly workingDirectory: string;
  /** Totem directory name, defaults to `.totem`. */
  readonly totemDir?: string;
  /** Test seam: stub the engine-version resolver. */
  readonly resolveVersion?: () => string;
  /** Test seam: stub the file reader (returns null for ENOENT). */
  readonly readManifest?: (manifestPath: string) => string | null;
}

/**
 * Decide whether the running engine is ahead of (or out of sync with)
 * the manifest's recorded cohort. Returns `null` when no nudge is
 * warranted (manifest reads cleanly and major.minor matches the
 * engine), otherwise returns a structured detection that the caller
 * surfaces as a `STALE_MANIFEST` `TotemError`.
 *
 * Failure-mode discipline (Tenet 4):
 * - Manifest missing (ENOENT): `{ reason: 'no-manifest' }`.
 * - Manifest unreadable / non-JSON / fails schema: treated as missing
 *   (`'no-manifest'`). The lint-time path is a UX nudge, not a
 *   correctness gate; surfacing schema noise here would mask the
 *   underlying "user just needs to re-sync" signal.
 * - Cohort field absent (pre-1.27.0 manifest): `'no-cohort'`.
 * - Cohort field present but not semver-valid: `'no-cohort'`
 *   (defensive fallback — design doc spec line for malformed cohort).
 * - Cohort major.minor differs from engine: `'cohort-mismatch'`.
 */
export function detectStaleManifest(
  opts: DetectStaleManifestOptions,
): StaleManifestDetection | null {
  const totemDir = opts.totemDir ?? '.totem';
  const manifestPath = path.join(opts.workingDirectory, totemDir, 'installed-packs.json');
  const resolve = opts.resolveVersion ?? resolveEngineVersion;
  const reader = opts.readManifest ?? defaultReadManifest;

  const engineVersion = resolve();

  const raw = reader(manifestPath);
  if (raw === null) {
    return { reason: 'no-manifest', engineVersion };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw); // totem-context: intentional cleanup — corrupted manifest JSON is treated as missing for the lint-time UX-nudge fast-path; the boot-time loader at pack-discovery.ts:readManifestAndResolveCallbacks is the strict-failure surface (re-throws), this fallback is downstream of it
  } catch {
    return { reason: 'no-manifest', engineVersion };
  }

  const validation = InstalledPacksManifestSchema.safeParse(parsedJson);
  if (!validation.success) {
    return { reason: 'no-manifest', engineVersion };
  }

  const manifestCohort = validation.data.cohort;
  if (manifestCohort === undefined) {
    return { reason: 'no-cohort', engineVersion };
  }

  if (!semver.valid(manifestCohort)) {
    return { reason: 'no-cohort', manifestCohort, engineVersion };
  }

  // Tolerate patch drift; flag minor or major mismatches. Caret-range
  // pack semver semantics already accept patch bumps without ABI
  // change, so rebuilding the manifest on a 1.27.0 → 1.27.1 bump is
  // spurious (mmnto-ai/totem#1811 OQ2).
  if (
    semver.major(manifestCohort) !== semver.major(engineVersion) || // totem-context: `||` combines two booleans (`semver.major` returns are integers, `!==` produces booleans); the "use ?? for numeric metric defaults" rule targets `metric || fallback` numeric-coercion, not boolean OR
    semver.minor(manifestCohort) !== semver.minor(engineVersion)
  ) {
    return { reason: 'cohort-mismatch', manifestCohort, engineVersion };
  }

  return null;
}

/**
 * Build the `TotemError('STALE_MANIFEST', ...)` surfaced when a
 * Tree-sitter language miss collides with an out-of-sync manifest.
 * The diagnostic always points at the same recovery: `totem sync
 * --packs-only`. The message reflects which class of staleness
 * fired so users can correlate with their environment (CI vs local,
 * pre-1.27.0 manifest vs minor bump).
 */
export function staleManifestError(
  detection: StaleManifestDetection,
  context: { readonly file: string; readonly extension: string; readonly ruleHash: string },
): TotemError {
  const summary =
    detection.reason === 'no-manifest'
      ? `installed-packs.json is missing or unreadable`
      : detection.reason === 'no-cohort'
        ? `installed-packs.json was written by a pre-1.27.0 totem (no cohort field)`
        : `installed-packs.json was written by totem ${detection.manifestCohort ?? 'unknown'} but the running engine is ${detection.engineVersion}`;
  const message = `Tree-sitter language not registered for '${context.extension}' while AST rule '${context.ruleHash}' expected to lint '${context.file}'. ${summary}; the pack manifest is stale.`;
  const hint = `Run \`totem sync --packs-only\` to regenerate \`.totem/installed-packs.json\` (no API key required). If the rule still fails after re-sync, install the pack that registers '${context.extension}' (e.g., \`pnpm add -D @mmnto/pack-rust-architecture\` for '.rs').`;
  return new TotemError('STALE_MANIFEST', message, hint);
}

// totem-context: intentional cleanup — every read failure (ENOENT,
// EACCES, transient I/O) collapses to the same "no manifest" sentinel
// for this UX-nudge fast-path. The caller maps the null to the
// `'no-manifest'` reason and surfaces a structured `STALE_MANIFEST`
// error pointing at `totem sync --packs-only`. The boot-time loader
// at `pack-discovery.ts:readManifestAndResolveCallbacks` is the
// strict-failure surface (re-throws on non-ENOENT); this helper is a
// best-effort sibling for the lint-time nudge.
function defaultReadManifest(manifestPath: string): string | null {
  try {
    return fs.readFileSync(manifestPath, 'utf-8'); // totem-context: synchronous read keeps the per-file Tree-sitter language-miss check non-async; the caller's parse-error path is hot — threading a Promise here would cascade async into every AST rule dispatch site
  } catch {
    return null;
  }
}

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemConfigError } from './errors.js';
import { readJsonSafe } from './sys/fs.js';

export const FREEZE_FILE = 'freeze.json';

// Stable machine key a freeze-consuming actuator binds to. Schema-enforced
// kebab slug (strategy#584 settle, codex W3): prose `subsystem` stays the
// human surface; rewording it must never silently unbind a gate consumer.
const FREEZE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The ONE freeze id the verify-manifest gate consults (#2137, strategy#584
 * sub-task 4). Exported so consumers import the constant instead of
 * duplicating the literal.
 */
export const RULE_COMPILATION_FREEZE_ID = 'rule-compilation';

/**
 * Distribution class of a freeze entry (strategy#584): `local` = this repo's
 * own parked work (the pre-scope implicit behavior); `cohort` = a freeze on a
 * cohort-orphaned subsystem that applies to every consumer repo and rides the
 * `@mmnto/strategy-doctrine` snapshot channel.
 */
export const FreezeScopeSchema = z.enum(['local', 'cohort']);
export type FreezeScope = z.infer<typeof FreezeScopeSchema>;

const FreezeEntrySchema = z.object({
  subsystem: z.string().min(1, 'subsystem must be a non-empty string'),
  id: z.string().regex(FREEZE_ID_RE, 'id must be a kebab-case slug (machine match key)').optional(),
  scope: FreezeScopeSchema.default('local'),
  since: z.string().optional(),
  reason: z.string().optional(),
  tracking: z.string().optional(),
  'do-not': z.array(z.string()).optional(),
});

const FreezeConfigSchema = z.object({
  _note: z.string().optional(),
  frozen: z.array(FreezeEntrySchema),
});

export type FreezeEntry = z.infer<typeof FreezeEntrySchema>;
export type FreezeConfig = z.infer<typeof FreezeConfigSchema>;

/**
 * Read `<totemDir>/freeze.json`, the WS1 freeze primitive.
 *
 * - **Absent file → `null`.** Absence means "nothing is frozen" — the only
 *   allow-on-absence in the gate layer, and semantically correct.
 * - **Present but unparseable/invalid → THROWS `TotemConfigError` (fail-closed).**
 *   A corrupt freeze file must never silently bypass itself (Tenet 4).
 *
 * This deliberately diverges from the graceful (warn-and-continue) ledger reader:
 * a gate's deterministic input failing to parse is a hard error, not a shrug.
 */
export function readFreezeConfig(totemDir: string): FreezeConfig | null {
  const filePath = path.join(totemDir, FREEZE_FILE);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new TotemConfigError(
      `Failed to read ${FREEZE_FILE}`,
      'Check filesystem permissions for the .totem directory.',
      'CONFIG_MISSING',
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TotemConfigError(
      `Malformed ${FREEZE_FILE}`,
      'Fix the JSON syntax in .totem/freeze.json, or remove the file if nothing is frozen.',
      'CONFIG_INVALID',
      err,
    );
  }

  const result = FreezeConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new TotemConfigError(
      `Invalid ${FREEZE_FILE}: ${result.error.issues.map((i) => i.message).join('; ')}`,
      'freeze.json must be { frozen: [{ subsystem, id?, scope?, since?, reason?, tracking?, "do-not"? }] }.',
      'CONFIG_INVALID',
      result.error,
    );
  }

  return result.data;
}

// ─── Distributed cohort-freeze read (strategy#584 read half) ─────────────

/**
 * Channel status for the distributed read. The two absent states are
 * deliberately distinct (Tenet 14): "channel not adopted" (`absent-package`)
 * is not "channel adopted, snapshot predates freeze distribution"
 * (`absent-file`).
 */
export type CohortFreezeStatus = 'ok' | 'absent-package' | 'absent-file' | 'corrupt';

export interface CohortFreezeResult {
  status: CohortFreezeStatus;
  /** Cohort-scoped entries ONLY — the read-time leak filter. The snapshot is
   *  a byte-copy of the publisher's whole freeze file (P292 §10.2 bind), so
   *  publisher-local parked work rides along and must never surface here. */
  entries: FreezeEntry[];
  /** Installed snapshot package version, when the package resolved. */
  packageVersion?: string;
  /** Renderable warnings. Core never console-logs channel states; every
   *  surface (human, structured, gate) renders these deliberately. */
  warnings: string[];
}

/**
 * Upward `node_modules` walk for an installed package dir — mirrors the
 * parity-detect resolution seam (workspace hoisting puts workspace deps in
 * the ROOT `node_modules`, so a cwd-only read would miss them).
 */
function findInstalledPackageDir(startDir: string, packageName: string): string | undefined {
  const segments = packageName.split('/');
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, 'node_modules', ...segments);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Read cohort-scoped freezes from an installed doctrine-snapshot package
 * (strategy#584 fix (b): cohort freezes ride the established distribution
 * channel, not per-repo manual copies).
 *
 * Failure contract — deliberately diverges from `readFreezeConfig`'s
 * fail-closed: this reader NEVER throws and never touches the network or
 * writes to disk. Corruption/invalidity degrades to `status: 'corrupt'` with
 * zero visible entries — the conservative direction for every consumer (a
 * freeze-consulting gate stays blocking; renderers show the warning). The
 * package name is caller-injected so core stays cohort-agnostic.
 */
export function readCohortFreezes(cwd: string, packageName: string): CohortFreezeResult {
  const warnings: string[] = [];

  const pkgDir = findInstalledPackageDir(cwd, packageName);
  if (pkgDir === undefined) {
    return { status: 'absent-package', entries: [], warnings };
  }

  let packageVersion: string | undefined;
  try {
    const pkg = readJsonSafe<{ version?: unknown }>(path.join(pkgDir, 'package.json'));
    if (typeof pkg.version === 'string') packageVersion = pkg.version;
    // totem-context: unreadable/odd snapshot package.json is non-fatal — provenance renders without a version, the freeze read proceeds
  } catch {
    warnings.push(`${packageName}/package.json unreadable — provenance version unavailable.`);
  }

  const freezePath = path.join(pkgDir, FREEZE_FILE);
  let raw: string;
  try {
    raw = fs.readFileSync(freezePath, 'utf-8');
    // totem-context: the never-throws channel contract — a non-ENOENT read failure degrades to status 'corrupt', reported via the result's warnings; consumers stay conservative (the gate keeps blocking)
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent-file', entries: [], packageVersion, warnings };
    }
    warnings.push(
      `Failed reading ${packageName}/${FREEZE_FILE} — distributed freezes not visible (consumers stay conservative).`,
    );
    return { status: 'corrupt', entries: [], packageVersion, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // totem-context: the never-throws channel contract — malformed JSON degrades to status 'corrupt', reported via the result's warnings; consumers stay conservative (the gate keeps blocking)
  } catch {
    warnings.push(
      `Malformed JSON in ${packageName}/${FREEZE_FILE} — distributed freezes not visible (consumers stay conservative).`,
    );
    return { status: 'corrupt', entries: [], packageVersion, warnings };
  }

  const result = FreezeConfigSchema.safeParse(parsed);
  if (!result.success) {
    warnings.push(
      `Invalid ${packageName}/${FREEZE_FILE}: ${result.error.issues
        .map((i) => i.message)
        .join('; ')} — distributed freezes not visible (consumers stay conservative).`,
    );
    return { status: 'corrupt', entries: [], packageVersion, warnings };
  }

  const entries = result.data.frozen.filter((f) => f.scope === 'cohort');
  for (const entry of entries) {
    if (entry.id === undefined) {
      warnings.push(
        `Cohort freeze entry "${entry.subsystem}" carries no stable id — machine consumers cannot bind to it (it renders, but never gate-matches).`,
      );
    }
  }
  return { status: 'ok', entries, packageVersion, warnings };
}

// ─── Effective freeze (local ∪ distributed) ──────────────────────────────

export type LocalFreezeStatus = 'ok' | 'absent';

export interface ActiveFreeze {
  entry: FreezeEntry;
  provenance: 'local' | 'cohort';
  /** Snapshot package version (cohort provenance only). */
  sourceVersion?: string;
}

export interface EffectiveFreezeResult {
  entries: ActiveFreeze[];
  localStatus: LocalFreezeStatus;
  cohortStatus: CohortFreezeStatus;
  cohortPackageVersion?: string;
  warnings: string[];
}

/**
 * Union of repo-local + distributed cohort freezes with per-source status
 * that SURVIVES into every consumer — absent-package / absent-file / corrupt /
 * genuinely-none must never flatten into "none" at a rendering surface.
 *
 * No dedup, no demotion: a subsystem frozen both locally and cohort-wide
 * yields two entries with distinct provenance. The LOCAL read keeps its
 * fail-closed contract — a corrupt local freeze file still THROWS.
 */
export function readEffectiveFreezes(
  cwd: string,
  totemDir: string,
  packageName: string,
): EffectiveFreezeResult {
  const local = readFreezeConfig(totemDir);
  const cohort = readCohortFreezes(cwd, packageName);

  const entries: ActiveFreeze[] = [
    ...(local?.frozen ?? []).map((entry) => ({ entry, provenance: 'local' as const })),
    ...cohort.entries.map((entry) => ({
      entry,
      provenance: 'cohort' as const,
      sourceVersion: cohort.packageVersion,
    })),
  ];

  return {
    entries,
    localStatus: local === null ? 'absent' : 'ok',
    cohortStatus: cohort.status,
    cohortPackageVersion: cohort.packageVersion,
    warnings: cohort.warnings,
  };
}

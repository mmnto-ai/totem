/**
 * Append-only, content-addressed storage for run artifacts
 * (mmnto-ai/totem#2100). Layout: `<totemDir>/artifacts/runs/<hash>.json`,
 * where `<hash>` is the sha256 of the artifact's canonical serialization
 * EXCLUDING `createdAt` — identical runs dedup to one record regardless of
 * when they ran, and a rerun NEVER mutates a prior record (write-if-absent).
 *
 * The directory is machine-local state (gitignored alongside
 * `.totem/cache/`); growth is bounded per-run and pruning is a future verb,
 * deliberately not this slice.
 *
 * Reads go through `readJsonSafe` + `RunArtifactSchema` so a corrupted or
 * wrong-major artifact is a loud `TotemParseError`, never a silent partial
 * (Tenet 4). Version tolerance within the major + the migration-on-read
 * registry implement the F1 evolution policy from the #2100 design review.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { rethrowAsParseError, TotemParseError } from '../errors.js';
import { readJsonSafe } from '../sys/fs.js';
import { calculateDeterministicHash } from './hash.js';
import type { RunArtifact } from './schema.js';
import { RunArtifactSchema } from './schema.js';

/** Storage layout segments under the totem dir (exact layout = impl call, #2100). */
const RUNS_DIR_SEGMENTS = ['artifacts', 'runs'] as const;

/** Filename guard — the id IS a filesystem path segment, so gate it hard. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Migration-on-read registry (F1). Keyed by MAJOR; each entry lifts a parsed
 * raw object of that major to the current `RunArtifact` shape. EMPTY at
 * 1.0.0 by design — the policy requires a major bump to land its migration
 * entry here BEFORE the writer ships, so the registry being empty is the
 * honest statement that no other major has ever been written.
 */
const MIGRATIONS: ReadonlyMap<number, (raw: unknown) => RunArtifact> = new Map();

/** Absolute runs directory for a given absolute totem dir. */
export function runsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, ...RUNS_DIR_SEGMENTS);
}

/**
 * Content address of an artifact: deterministic hash over everything EXCEPT
 * `createdAt` (observability, not identity — see schema docstring).
 */
export function computeRunArtifactContentHash(artifact: RunArtifact): string {
  const { createdAt: _excluded, ...identity } = artifact;
  return calculateDeterministicHash(identity);
}

export interface SaveRunArtifactResult {
  /** The content address (= filename stem). */
  hash: string;
  /** Absolute path of the stored artifact. */
  path: string;
  /** True when an identical logical run was already recorded (no write happened). */
  existed: boolean;
}

/**
 * Persist an artifact at its content address, write-if-absent. An existing
 * file is NEVER rewritten: same hash ⇒ same logical content by construction,
 * and the original record (including its `createdAt`) is the durable one —
 * append-only means the FIRST write wins forever.
 */
export function saveRunArtifact(totemDirAbs: string, artifact: RunArtifact): SaveRunArtifactResult {
  // Validate on the way OUT too — a writer bug must not poison the ledger
  // with a record the reader will later reject (the corpus is the point).
  const validated = RunArtifactSchema.parse(artifact);
  const hash = computeRunArtifactContentHash(validated);
  const dir = runsDir(totemDirAbs);
  const filePath = path.join(dir, `${hash}.json`);

  if (fs.existsSync(filePath)) {
    return { hash, path: filePath, existed: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  try {
    // `wx` = atomic create-exclusive: closes the TOCTOU window between the
    // existsSync fast-path and the write, so concurrent saves of the same
    // hash can never overwrite the first record (CR review on #2114) —
    // first-write-wins is enforced by the filesystem, not the check above.
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600, // matches the response-cache mode — run records carry prompt content
      flag: 'wx',
    });
  } catch (err) {
    // A concurrent writer won the race — same hash ⇒ same logical content,
    // so the existing record IS this save's outcome (append-only dedup).
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { hash, path: filePath, existed: true };
    }
    throw err;
  }
  return { hash, path: filePath, existed: false };
}

/**
 * Load + validate an artifact by content address. Throws `TotemParseError`
 * on a missing file, corrupt JSON, or schema violation (including an unknown
 * major with no migration entry) — loud, never a silent partial.
 */
export function loadRunArtifact(totemDirAbs: string, hash: string): RunArtifact {
  if (!SHA256_HEX.test(hash)) {
    throw new TotemParseError(
      `Invalid run-artifact id "${hash}" — expected a 64-char sha256 hex content address.`,
      'Pass the hash exactly as reported at emission (or from the artifacts/runs/ filename).',
    );
  }
  const filePath = path.join(runsDir(totemDirAbs), `${hash}.json`);

  // Migration seam (F1): peek the major BEFORE strict validation so a known
  // older major routes through its migration instead of failing the current
  // schema. With an empty registry this is a straight fall-through today.
  const raw = readJsonSafe(filePath);
  const major = readMajor(raw);
  if (major !== undefined) {
    const migrate = MIGRATIONS.get(major);
    if (migrate !== undefined) return migrate(raw);
  }

  try {
    return RunArtifactSchema.parse(raw);
  } catch (err) {
    // Normalize the ZodError to the module's stated load contract (GCA + CR
    // review on #2114): JSON-read failures and schema failures both surface
    // as TotemParseError, with the Zod issue text (incl. the rejected
    // schemaVersion) preserved via the message + cause.
    rethrowAsParseError(
      `Run artifact ${hash} failed schema validation`,
      err,
      'The artifact may be corrupted or written by an incompatible totem version; re-emit it (or add the migration entry for its major).',
    );
  }
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const version = (raw as Record<string, unknown>)['schemaVersion'];
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}

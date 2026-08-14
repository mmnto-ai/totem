/**
 * Admission-record contract — the machine-readable disposition a deterministic
 * review skip leaves behind (mmnto-ai/totem#2473, operator-ruled 2026-08-12).
 *
 * The admission phase precedes fan execution: a poll of the diff that resolves
 * to nothing reviewable is a `not-applicable` ADMISSION VERDICT, never a lane
 * outcome and never an `InvokeFailureKind` (#2452's taxonomy describes failures
 * after an invocation was attempted). The record is DISCLOSURE, not
 * authorization — no skip path ever stamps the push-gate cache — but it is
 * still a claim about a projection, so it binds the exact observation that
 * produced it (codex review, 2026-08-14): the normalized diff scope, a hash of
 * the pre-filter diff bytes, and a canonical hash of the effective selection
 * policy. Equal bytes under a changed policy are a DIFFERENT observation.
 *
 * Store mechanics mirror the verdict store deliberately (one idiom, two
 * artifact kinds): content-addressed with `createdAt` excluded as
 * observability-only, `wx` create-exclusive writes with EEXIST as
 * logical-identity dedup, raw-address verification BEFORE schema parsing on
 * load, and a version-tolerant-within-major reader with a migration registry
 * for future majors. Resolution by consumers is deterministic and
 * exact-current: `totem review --covariate` re-derives the CURRENT admission
 * classification and looks up that exact identity — never wall-clock
 * arbitration across record families.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { rethrowAsParseError, TotemError, TotemParseError } from '../errors.js';
import { readJsonSafe } from '../sys/fs.js';
import { calculateDeterministicHash } from './hash.js';

// ─── Schema version (mirrors VerdictArtifact / RunArtifact F1 policy) ───────

/**
 * The admission schemaVersion WRITTEN by this code. Readers accept any 1.x;
 * a MAJOR bump requires a migration entry in {@link loadAdmissionRecord}
 * before the writer ships.
 */
export const ADMISSION_RECORD_SCHEMA_VERSION = '1.0.0';

// ─── Reasons + scope ────────────────────────────────────────────────────────

/**
 * The closed set of deterministic not-applicable reasons (mmnto-ai/totem#2473
 * ruling item 1). Order here is the documentation order; the value is data.
 */
export const NOT_APPLICABLE_REASONS = [
  'no-diff',
  'all-non-code',
  'filtered-empty',
  'all-generated',
] as const;

export type NotApplicableReason = (typeof NOT_APPLICABLE_REASONS)[number];

const NotApplicableReasonSchema = z.enum(NOT_APPLICABLE_REASONS);

/**
 * Normalized diff-scope identity. ALWAYS present on a record — including
 * `no-diff`, where the resolution chain found nothing: there `source` is
 * `'none'`, `base`/`head` are null, and `selectorForm` records the REQUESTED
 * selector expression, so two no-diff runs under different selectors are
 * different observations (a global null identity fails the base/range
 * constraint — codex blocking finding 1).
 */
export const AdmissionScopeSchema = z
  .object({
    source: z.enum(['explicit-range', 'staged', 'uncommitted', 'branch-vs-base', 'none']),
    base: z.string().nullable(),
    head: z.string().nullable(),
    selectorForm: z.string().nullable(),
  })
  .strict();

export type AdmissionScope = z.infer<typeof AdmissionScopeSchema>;

// ─── Selection-policy fingerprint ───────────────────────────────────────────

/**
 * The effective selection policy whose projection produced the admission
 * outcome. `not-applicable` is a projection result; equal diff bytes classify
 * differently when any of these inputs change, so the record binds them
 * (codex: the disclosure/authorization distinction does not remove the
 * binding requirement).
 *
 * The caller (the CLI) assembles the EFFECTIVE values — config-resolved
 * extensions, seeded generated globs unioned with `.gitattributes` rules,
 * ignore/filter patterns, and an identifier for the classifier whose
 * non-code/code partition applies. Core owns only the canonicalization.
 */
export interface ProjectionPolicy {
  /** Effective review source extensions (config-resolved). */
  sourceExtensions: readonly string[];
  /** Effective generated-artifact globs (defaults ∪ .gitattributes generated). */
  generatedGlobs: readonly string[];
  /** Effective NOT-generated exclusions (.gitattributes -linguist-generated). */
  notGeneratedGlobs: readonly string[];
  /** Effective ignore/filter patterns applied during diff resolution. */
  ignorePatterns: readonly string[];
  /**
   * Identifier + version of the non-code classifier whose partition applies
   * (e.g. `'classifyChangedFiles@1'`). Bumped when the classification
   * BEHAVIOR changes without any config input changing — a projection-version
   * bump explains drift with no input change (ADR-113's distinction).
   */
  classifierId: string;
}

/**
 * Canonical fingerprint over the effective selection policy. Deterministic by
 * construction: array fields are sorted copies (set semantics — ordering is
 * config-file incidental), and `calculateDeterministicHash` performs a
 * recursive key sort. Fixture-locked for cross-platform / key-order stability.
 */
export function computeProjectionPolicyHash(policy: ProjectionPolicy): string {
  const canonical = {
    classifierId: policy.classifierId,
    generatedGlobs: [...policy.generatedGlobs].sort(),
    ignorePatterns: [...policy.ignorePatterns].sort(),
    notGeneratedGlobs: [...policy.notGeneratedGlobs].sort(),
    sourceExtensions: [...policy.sourceExtensions].sort(),
  };
  return calculateDeterministicHash(canonical);
}

// ─── Record schema ──────────────────────────────────────────────────────────

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const AdmissionRecordSchema = z.object({
  /** Writer version; readers tolerate any 1.x (F1 policy). */
  schemaVersion: z.string().regex(/^1\.\d+\.\d+$/),
  /** The only admission disposition persisted: an admitted run persists a verdict instead. */
  disposition: z.literal('not-applicable'),
  reason: NotApplicableReasonSchema,
  /** Observability ONLY — excluded from the content address; never a resolution key. */
  createdAt: z.string(),
  scope: AdmissionScopeSchema,
  /** sha256 over the pre-filter diff bytes (hash of the empty string for `no-diff`). */
  inputHash: Sha256HexSchema,
  /** {@link computeProjectionPolicyHash} over the effective selection policy. */
  projectionPolicyHash: Sha256HexSchema,
  /** Count only, never names (names ride the CLI's dim stderr line; smallest honest record). */
  skippedFileCount: z.number().int().nonnegative(),
});

export type AdmissionRecord = z.infer<typeof AdmissionRecordSchema>;

/** A loaded record paired with its VERIFIED content address (the filename stem). */
export interface AdmissionWithAddress {
  record: AdmissionRecord;
  /** The verified content address = filename stem (raw-payload hash, `createdAt` excluded). */
  contentHash: string;
}

// ─── Content addressing (createdAt = observability-only, excluded) ──────────

/** Content address over the validated record with ONLY `createdAt` excluded. */
export function computeAdmissionContentHash(record: AdmissionRecord): string {
  const { createdAt: _excluded, ...identity } = record;
  return calculateDeterministicHash(identity);
}

/** Raw-payload variant for load verification (unknown-key tamper caught; forward-minor verifies). */
function computeRawAdmissionContentHash(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) {
    return calculateDeterministicHash(raw);
  }
  const { createdAt: _excluded, ...identity } = raw as Record<string, unknown>;
  return calculateDeterministicHash(identity);
}

function admissionsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, 'artifacts', 'admissions');
}

// ─── Save / load ────────────────────────────────────────────────────────────

export interface SaveAdmissionRecordResult {
  /** The content address (= filename stem). */
  hash: string;
  /** Absolute path of the stored record. */
  path: string;
  /** True when an identical logical record was already recorded (no write happened). */
  existed: boolean;
}

/**
 * Persist an admission record at its content address, write-if-absent (`wx`).
 * Validates on the way OUT so a writer bug never poisons the store. EEXIST is
 * logical-identity dedup: with `scope` + `inputHash` + `projectionPolicyHash`
 * bound, an identical address IS the same observation repeated — first-write-
 * wins, and the verified load below surfaces any address collision loud.
 */
export function saveAdmissionRecord(
  totemDirAbs: string,
  record: AdmissionRecord,
): SaveAdmissionRecordResult {
  const validated = AdmissionRecordSchema.parse(record);
  const hash = computeAdmissionContentHash(validated);
  const dir = admissionsDir(totemDirAbs);
  const filePath = path.join(dir, `${hash}.json`);

  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600, // matches the artifact-store default posture (verdicts/runs)
      flag: 'wx',
    });
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      // Verified load: proves the incumbent hashes back to THIS address — the
      // same logical observation modulo createdAt. A differing or corrupt
      // record cannot occupy this address without failing loud there.
      loadAdmissionRecord(totemDirAbs, hash);
      return { hash, path: filePath, existed: true };
    }
    throw err;
  }
  return { hash, path: filePath, existed: false };
}

/** Future-major migration registry (empty at 1.x — mirrors the verdict store's shape). */
const MIGRATIONS = new Map<number, (raw: unknown) => unknown>();

/**
 * Load + validate an admission record by content address. Raw-address
 * verification runs FIRST (identity is major-agnostic, over the on-disk bytes
 * minus `createdAt`); only then is any migration applied and the output
 * validated against the current schema. Throws loud on a missing file,
 * corrupt JSON, schema violation, address mismatch, or unknown major.
 */
export function loadAdmissionRecord(totemDirAbs: string, hash: string): AdmissionWithAddress {
  if (!Sha256HexSchema.safeParse(hash).success) {
    throw new TotemParseError(
      `Invalid admission-record id "${hash}" — expected a 64-char sha256 hex content address.`,
      'Pass the hash exactly as reported at emission (or from the artifacts/admissions/ filename).',
    );
  }
  const filePath = path.join(admissionsDir(totemDirAbs), `${hash}.json`);
  const raw = readJsonSafe(filePath);

  const verificationHash = computeRawAdmissionContentHash(raw);
  if (verificationHash !== hash) {
    throw new TotemError(
      'DATABASE_MISMATCH',
      `Admission record at ${filePath} fails content-address verification: its recomputed content hash ${verificationHash} does not match the filename address ${hash} (modulo createdAt).`,
      'This should be unreachable in a content-addressed store. Investigate a mis-addressed copy, a hand-edited/corrupted record, or a hash collision, then re-run `totem review`.',
    );
  }

  const major = readMajor(raw);
  const migrate = major !== undefined ? MIGRATIONS.get(major) : undefined;
  if (migrate !== undefined) {
    return { record: AdmissionRecordSchema.parse(migrate(raw)), contentHash: hash };
  }
  const result = AdmissionRecordSchema.safeParse(raw);
  if (!result.success) {
    rethrowAsParseError(
      `Admission record ${hash} failed schema validation`,
      result.error,
      'The record may be corrupted or written by an incompatible totem version; re-run `totem review` (or add the migration entry for its major).',
    );
  }
  return { record: result.data, contentHash: hash };
}

/**
 * Exact-identity lookup: does a record for THIS observation exist? The caller
 * re-derives the current admission outcome, builds the record identity, and
 * asks for exactly its address — deterministic, no scanning, no wall-clock.
 * Returns `undefined` when absent; a PRESENT-but-corrupt record routes to
 * `onCorrupt` and returns `undefined` (the caller's loud no-current-record
 * sensor covers both — never a silent fallback to an older verdict).
 */
export function findAdmissionRecordByIdentity(
  totemDirAbs: string,
  identity: Omit<AdmissionRecord, 'createdAt'>,
  onCorrupt: (message: string) => void,
): AdmissionWithAddress | undefined {
  const hash = calculateDeterministicHash(identity);
  const filePath = path.join(admissionsDir(totemDirAbs), `${hash}.json`);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return loadAdmissionRecord(totemDirAbs, hash);
  } catch (err) {
    onCorrupt(
      `Admission record ${hash.slice(0, 8)} exists but failed verified load: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

// ─── Renderer (covariate-line family — one format authority) ────────────────

/**
 * The core-owned admission form of the `local-lane:` line. Same prefix as
 * {@link renderCovariateLine} so the round-disposition comment carries either
 * form. `at=` renders the RECORD's timestamp: under dedup a repeat identical
 * skip shows the first observation's stamp (the record's own truth, named in
 * the changeset so it never reads as staleness of the check).
 */
export function renderAdmissionLine(admission: AdmissionWithAddress): string {
  const hash8 = admission.contentHash.slice(0, 8);
  return `local-lane: not-applicable (${admission.record.reason}) recorded=${hash8} at=${admission.record.createdAt}`;
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) return undefined;
  const version = raw.schemaVersion;
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}

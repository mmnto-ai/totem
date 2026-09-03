/**
 * Leg-deposit contract — the machine-readable record a falsification leg
 * leaves behind after it READ a diff (mmnto-ai/totem#2698, ruled 2026-09-03).
 *
 * The gate's question is deliberately narrow: *was THIS head read by a leg?*
 * So the store is keyed by the READ sha — `<totemDir>/artifacts/legs/<diffSha>.json`
 * — and NOT content-addressed like the verdict/admission/run families. Two
 * legs that read the same head are the same answer to that question; a rerun
 * on the same head supersedes by INTENT, which is why the writer is
 * create-exclusive and a `replace` discloses the `readAt` it overwrote rather
 * than silently deduping (the content-addressed stores' EEXIST-is-dedup rule
 * would be a lie here — the second read is a different observation).
 *
 * Store mechanics still mirror the sibling families where the semantics agree:
 * validate-on-write so a writer bug never poisons the store, a
 * tolerant-within-major reader whose newer-major refusal is NAMED (an older
 * CLI meeting a newer deposit reports "upgrade", never "corrupt"), unknown
 * keys tolerated (forward-minor additive fields), and `0o600` bytes.
 *
 * Two properties are specific to this family:
 *
 * 1. **The loader never throws.** A deposit is a hand-editable JSON file that
 *    a pre-push hook reads on every push; one bad file must never take the
 *    gate down or hide a valid sibling. Every per-file failure — unreadable,
 *    non-JSON, schema-invalid, wrong major, or a filename that disagrees with
 *    the stored `diffSha` — becomes a one-line `corrupt` row the caller
 *    prints (Tenet 4: loud, never silent).
 * 2. **Every stored string that reaches stdout is control-byte free at the
 *    SCHEMA boundary**, at write and at read alike. `verdict`, `claim`,
 *    `counterexample` and `file` land inside a hook's `[Totem] …` line; a
 *    newline in any of them would forge a second line, so the schema refuses
 *    C0 (0-31) and DEL/C1 (127-159) outright. "Single-line" needs no separate
 *    rule: LF and CR are inside that band.
 *
 * Core never shells out. Ancestry is supplied by the CLI through the injected
 * {@link LegGitAdapter}, so every resolution rule here is unit-testable
 * without a git fixture.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemError } from '../errors.js';
import { writeFileAtomicSync } from '../fs-atomic.js';

// ─── Schema version (mirrors the RunArtifact / panel F1 policy) ─────────────

/** The leg-deposit schemaVersion WRITTEN by this code. Readers accept any 1.x. */
export const LEG_DEPOSIT_SCHEMA_VERSION = '1.0.0';

/** The major this reader understands; another major needs a migration entry. */
export const LEG_DEPOSIT_KNOWN_MAJOR = 1;

/** Major-1 semver literal — keep in sync with {@link LEG_DEPOSIT_KNOWN_MAJOR}. */
const LEG_SCHEMA_VERSION_RE = /^1\.\d+\.\d+$/;

/**
 * Accept any 1.x version; refuse another major with a NAMED reason (the panel
 * precedent). Zod `.regex()` is the validation boundary — not a bare
 * `RegExp.test` — so the ZodError carries the offending value, and the
 * refusal reads the same at write and at read.
 */
const legSchemaVersionField = z.string().regex(LEG_SCHEMA_VERSION_RE, {
  message: `unsupported leg-deposit schemaVersion — this reader understands major ${LEG_DEPOSIT_KNOWN_MAJOR}.x; a newer major needs a newer @mmnto/cli`,
});

/** The read sha: a full 40-char lowercase git object name, never abbreviated. */
const DIFF_SHA_RE = /^[0-9a-f]{40}$/;

/** Finding ids are filename-safe and short — they are echoed and cross-referenced. */
const LEG_FINDING_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

// ─── Control-byte discipline ────────────────────────────────────────────────

/**
 * True when `text` carries any C0 (0-31) or DEL/C1 (127-159) code point.
 *
 * Written as a `charCodeAt` loop on purpose, mirroring the pre-commit hook's
 * `safe()` (`install-hooks.ts`): the equivalent regex character class would
 * have to be authored with `\u`/`\x` escapes, and this repo has a banked
 * incident where an editing tool decoded such an escape into a RAW control
 * byte in the source. The loop states the same rule with no escape to decode.
 * U+0085 (NEL) is inside the band because it breaks a line on some terminals.
 */
function hasControlByte(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

/** Replace every control byte with `?` — used for the one-line `corrupt` reasons. */
function toSingleLine(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const control = code < 32 || (code >= 127 && code <= 159);
    out = out + (control ? '?' : text.charAt(i));
  }
  return out;
}

/** A string field that reaches a hook's stdout: no C0/C1 bytes, hence single-line. */
function controlFreeText(label: string): z.ZodEffects<z.ZodString, string, string> {
  return z.string().refine((value) => !hasControlByte(value), {
    message: `${label} must be a single line free of control characters (C0 0-31, DEL/C1 127-159) — the value is echoed on the gate's stdout`,
  });
}

/** Same, but also non-empty. */
function requiredControlFreeText(label: string): z.ZodEffects<z.ZodString, string, string> {
  return z
    .string()
    .min(1, `${label} must not be empty`)
    .refine((value) => !hasControlByte(value), {
      message: `${label} must be a single line free of control characters (C0 0-31, DEL/C1 127-159) — the value is echoed on the gate's stdout`,
    });
}

// ─── Findings ───────────────────────────────────────────────────────────────

/**
 * The leg's severity vocabulary. Deliberately NOT the verdict family's
 * CRITICAL/WARN/INFO: a leg deposit answers "what did the leg find", and the
 * doctrine spelling for that is BLOCKING (the fold must land) / MATERIAL (the
 * seat rules) / MINOR (disclosed). Order here is documentation order; the
 * value is data. One spelling — {@link LegFindingSeveritySchema} is built
 * from this array, never a second literal list.
 */
export const LEG_FINDING_SEVERITIES = ['BLOCKING', 'MATERIAL', 'MINOR'] as const;

export type LegFindingSeverity = (typeof LEG_FINDING_SEVERITIES)[number];

export const LegFindingSeveritySchema = z.enum(LEG_FINDING_SEVERITIES);

/** The finding id — required, so `folded` can NAME a finding rather than index it. */
export const LegFindingIdSchema = z
  .string()
  .regex(LEG_FINDING_ID_RE, 'a finding id must be 1-32 characters of [A-Za-z0-9_-]');

/**
 * One typed finding. `id` is required (mmnto-ai/totem#2698 OQ1, ruled): the
 * contract JSON had none, and without one `folded` cannot reference a finding
 * — positional indexes are fragile under reordering, and a bare count cannot
 * be checked against anything.
 */
export const LegFindingSchema = z.object({
  /** Unique within the deposit; the referent of every `folded` entry. */
  id: LegFindingIdSchema,
  severity: LegFindingSeveritySchema,
  /** Repo-relative path the finding is about (free-form: core never resolves it). */
  file: requiredControlFreeText('finding.file'),
  /** 0 means "the file, no particular line" — never a sentinel like -1. */
  line: z.number().int().nonnegative(),
  /** The falsifiable claim, one line. */
  claim: requiredControlFreeText('finding.claim'),
  /** The evidence. MAY be empty — a claim with no counterexample is still disclosed. */
  counterexample: controlFreeText('finding.counterexample'),
});

export type LegFinding = z.infer<typeof LegFindingSchema>;

// ─── Deposit ────────────────────────────────────────────────────────────────

/**
 * The deposit itself. Every field is required; the arrays may be empty (a leg
 * that found nothing still deposits — that IS the evidence the gate wants).
 *
 * Unknown keys are TOLERATED, not refused (the run-artifact precedent): a
 * forward-minor writer may add a field this reader strips, and a deposit is
 * evidence a newer leg wrote, not a contract this reader gets to narrow.
 */
export const LegDepositSchema = z
  .object({
    /** Writer version; readers tolerate any 1.x, refuse another major by name. */
    schemaVersion: legSchemaVersionField,
    /** The head the leg READ — a full 40-hex commit, and the file's own name. */
    diffSha: z.string().regex(DIFF_SHA_RE, 'diffSha must be a 40-character lowercase hex sha'),
    /** The leg's own instant, ISO-8601. Ties are broken on it, so it is contract. */
    readAt: z.string().datetime(),
    findings: z.array(LegFindingSchema),
    /** Ids of findings the seat FOLDED — a subset of `findings[].id` (superRefine). */
    folded: z.array(LegFindingIdSchema),
    /** The leg's one-line disposition; echoed verbatim on the gate's evidence line. */
    verdict: requiredControlFreeText('verdict'),
  })
  .superRefine((deposit, ctx) => {
    const seen = new Set<string>();
    for (const [index, finding] of deposit.findings.entries()) {
      if (seen.has(finding.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['findings', index, 'id'],
          message: `duplicate finding id "${finding.id}" — ids must be unique within a deposit (folded names them)`,
        });
      }
      seen.add(finding.id);
    }
    for (const [index, id] of deposit.folded.entries()) {
      if (!seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['folded', index],
          message: `folded names "${id}", which is not a finding id in this deposit`,
        });
      }
    }
  });

export type LegDeposit = z.infer<typeof LegDepositSchema>;

/** A loaded deposit paired with the address it was found at (the filename stem). */
export interface LegDepositWithAddress {
  deposit: LegDeposit;
  /** Absolute path of the stored deposit. */
  path: string;
  /** The verified address = the filename stem = `deposit.diffSha`. */
  diffSha: string;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

/** Storage layout segments under the totem dir (mirrors `runsDir`'s idiom). */
const LEGS_DIR_SEGMENTS = ['artifacts', 'legs'] as const;

/** Absolute legs directory for a given absolute totem dir. */
export function legsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, ...LEGS_DIR_SEGMENTS);
}

/** Absolute path of the deposit for `diffSha` — the sha IS the filename stem. */
export function legDepositPath(totemDirAbs: string, diffSha: string): string {
  return path.join(legsDir(totemDirAbs), `${diffSha}.json`);
}

// ─── Save ───────────────────────────────────────────────────────────────────

/**
 * Refusal to overwrite an existing deposit without `replace`. Typed so the
 * CLI can print the incumbent's `readAt` and the one-flag cure rather than
 * re-deriving either. `existingReadAt` is `undefined` when the incumbent
 * itself is unreadable/corrupt — the refusal still stands (the seat decides
 * whether to replace it), and the honest report is that its instant could not
 * be read.
 */
export class LegDepositExistsError extends TotemError {
  readonly diffSha: string;
  readonly existingReadAt: string | undefined;
  readonly depositPath: string;

  constructor(diffSha: string, existingReadAt: string | undefined, depositPath: string) {
    super(
      'LEG_DEPOSIT_EXISTS',
      `A leg deposit already exists for ${diffSha} (read ${existingReadAt ?? 'at an unreadable instant'}) at ${depositPath}.`,
      'Pass --replace to overwrite it (the replaced readAt is reported), or deposit against the current head.',
    );
    this.name = 'LegDepositExistsError';
    this.diffSha = diffSha;
    this.existingReadAt = existingReadAt;
    this.depositPath = depositPath;
  }
}

export interface SaveLegDepositOptions {
  /** Overwrite an existing deposit for this sha, reporting the `readAt` replaced. */
  replace?: boolean;
}

export interface SaveLegDepositResult {
  /** Absolute path of the stored deposit. */
  path: string;
  /**
   * Present IFF an existing deposit was overwritten. `readAt` is the
   * incumbent's instant, or `undefined` when the incumbent was corrupt enough
   * that its instant could not be read.
   */
  replaced?: { readAt: string | undefined };
}

/** Best-effort read of an incumbent's `readAt` — for disclosure only, never a gate. */
function peekReadAt(filePath: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (typeof raw !== 'object' || raw === null) return undefined;
    const readAt = (raw as Record<string, unknown>)['readAt'];
    return typeof readAt === 'string' ? toSingleLine(readAt) : undefined;
    // totem-context: intentional best-effort — the incumbent's instant is DISCLOSURE beside a refusal that happens either way; a corrupt incumbent must not turn "already deposited" into a read error
  } catch {
    return undefined;
  }
}

/**
 * Persist a deposit at `<legsDir>/<diffSha>.json`, create-exclusive by default.
 *
 * Ordering is contract: the deposit is VALIDATED before the filesystem is
 * touched at all, and the occupancy check precedes the write — so a refused
 * write (schema-invalid, or occupied without `replace`) leaves no file and no
 * temp behind. The write itself goes through the shared atomic helper
 * (temp in the same directory, fsync, rename), so a reader never observes a
 * torn deposit.
 *
 * The file's name is DERIVED from `deposit.diffSha`, which is how the store's
 * "the name is the read sha" invariant holds by construction; the loader
 * re-checks it on the way back in, since the name comes off a filesystem a
 * human can rename.
 */
export function saveLegDeposit(
  totemDirAbs: string,
  deposit: LegDeposit,
  options: SaveLegDepositOptions = {},
): SaveLegDepositResult {
  // Validate on the way OUT (the run/admission/verdict precedent): a writer bug
  // must never poison a store whose reader would then report it as corrupt.
  const validated = LegDepositSchema.parse(deposit);
  const filePath = legDepositPath(totemDirAbs, validated.diffSha);

  let replaced: { readAt: string | undefined } | undefined;
  if (fs.existsSync(filePath)) {
    const existingReadAt = peekReadAt(filePath);
    if (options.replace !== true) {
      throw new LegDepositExistsError(validated.diffSha, existingReadAt, filePath);
    }
    replaced = { readAt: existingReadAt };
  }

  fs.mkdirSync(legsDir(totemDirAbs), { recursive: true });
  writeFileAtomicSync(filePath, JSON.stringify(validated, null, 2), { mode: 0o600 });

  return replaced === undefined ? { path: filePath } : { path: filePath, replaced };
}

// ─── Load ───────────────────────────────────────────────────────────────────

/** One disclosed unusable file: the name as it sits on disk, and why it is not a deposit. */
export interface LegDepositCorruptEntry {
  /** The filename as read from the directory (not a path — the caller joins). */
  file: string;
  /** One line, control-byte free, safe to echo. */
  reason: string;
}

export interface LoadLegDepositsResult {
  deposits: LegDepositWithAddress[];
  corrupt: LegDepositCorruptEntry[];
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const version = (raw as Record<string, unknown>)['schemaVersion'];
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}

/** Flatten a ZodError into one echo-safe line. */
function oneLineZodReason(zodError: z.ZodError): string {
  return toSingleLine(
    zodError.issues
      .map((issue) => {
        const at = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${at}: ${issue.message}`;
      })
      .join('; '),
  );
}

/**
 * Read every deposit in the store, TOLERANTLY.
 *
 * Never throws: a missing directory is an empty store, a non-`.json` entry is
 * not a deposit at all (ignored silently — the directory is not the store's
 * inventory), and every other per-file failure is a `corrupt` row carrying a
 * one-line reason. The reading is JSON-AWARE through the schema, so a file
 * that merely *mentions* `diffSha` or `findings` in some other shape — a
 * review artifact copied in, say — is corrupt, never a deposit.
 *
 * The filename is re-checked against the stored `diffSha`: the name is the
 * store's address, a human can rename a file, and a deposit resolved under
 * someone else's sha would answer the gate's question about the wrong head.
 */
export function loadLegDeposits(totemDirAbs: string): LoadLegDepositsResult {
  const dir = legsDir(totemDirAbs);
  const deposits: LegDepositWithAddress[] = [];
  const corrupt: LegDepositCorruptEntry[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
    // totem-context: intentional — a missing/unreadable store dir IS the "no deposit" state the gate already has a loud arm for; the loader's contract is that it never throws
  } catch {
    return { deposits, corrupt };
  }

  for (const entry of [...entries].sort()) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(dir, entry);
    const stem = entry.slice(0, -'.json'.length);

    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // totem-context: intentional — an unreadable or non-JSON file becomes a NAMED corrupt row (reason carried, control bytes collapsed) and never a throw; the loader's contract is tolerant-per-file so one bad deposit can never mask a valid sibling
    } catch (err) {
      corrupt.push({
        file: entry,
        reason: toSingleLine(
          `unreadable or not JSON: ${err instanceof Error ? err.message : String(err)}`,
        ),
      });
      continue;
    }

    const major = readMajor(raw);
    if (major !== undefined && major > LEG_DEPOSIT_KNOWN_MAJOR) {
      corrupt.push({
        file: entry,
        reason: `written by a newer totem (schemaVersion major ${major}; this reader understands ${LEG_DEPOSIT_KNOWN_MAJOR}.x) — upgrade @mmnto/cli to read it, the deposit is valid`,
      });
      continue;
    }

    const parsed = LegDepositSchema.safeParse(raw);
    if (!parsed.success) {
      corrupt.push({ file: entry, reason: `schema-invalid: ${oneLineZodReason(parsed.error)}` });
      continue;
    }

    if (parsed.data.diffSha !== stem) {
      corrupt.push({
        file: entry,
        reason: `filename does not match its stored diffSha ${parsed.data.diffSha} — the name is this store's address`,
      });
      continue;
    }

    deposits.push({ deposit: parsed.data, path: filePath, diffSha: parsed.data.diffSha });
  }

  return { deposits, corrupt };
}

// ─── Head resolution ────────────────────────────────────────────────────────

/**
 * The git seam the resolver needs, INJECTED. Core never shells out — the CLI
 * supplies an adapter over `git cat-file`/`merge-base --is-ancestor`/
 * `rev-list --count`, and every rule below stays unit-testable with a fake.
 */
export interface LegGitAdapter {
  /** Does this sha name a commit object in THIS repo? */
  isCommit(sha: string): boolean;
  /** Is `base` an ancestor of `head`? (Called only for shas `isCommit` accepted.) */
  isAncestor(base: string, head: string): boolean;
  /** Commits from `base` to `head` (`rev-list --count base..head`). */
  distance(base: string, head: string): number;
  /**
   * Paths changed between `base` and `head` (`git diff --name-only base...head`,
   * three-dot). This is what a leg reading at `head` COULD have seen, and it is
   * the only input the coverage predicate needs. Called only for ancestor
   * candidates, and only when a coverage query is supplied.
   */
  changedFiles(base: string, head: string): readonly string[];
}

/** How a deposit reaches the head: it IS the head, or it is behind it. */
export type LegDepositRank = 'exact' | 'ancestor';

/** Why a deposit cannot answer for this head. */
export type LegDepositStaleReason = 'unknown-commit' | 'not-ancestor' | 'no-coverage';

/**
 * How much of what this push OWES a leg the candidate could actually have read
 * (mmnto-ai/totem#2698 fold 3, operator-ruled).
 *
 * Ancestry alone is not freshness. A deposit written against the branch's merge
 * base satisfies ancestor-or-equal and reports a small `distance`, yet the leg
 * that wrote it saw NONE of the diff the push proposes — the exhibit that
 * produced this rule. Coverage is the second half of the question: of the owed
 * paths, how many were inside the diff the candidate's own head contained?
 */
export interface LegDepositCoverage {
  /** Owed paths the candidate's own branch diff contained. */
  covered: number;
  /** Owed paths in total — the deduplicated files in the basis. */
  owed: number;
  /** The owed paths the candidate could NOT have read, in basis order. */
  missing: string[];
}

/**
 * The inputs the coverage predicate needs, supplied by a caller that resolved a
 * BRANCH scope. Omitted by callers that cannot (a staged or explicit-range
 * scope has no branch base to measure a candidate's reach against), and the
 * resolution then reports `coverage: undefined` so those callers disclose the
 * limit rather than imply full coverage.
 */
export interface LegCoverageQuery {
  /** The base ref the caller resolved for HEAD — the same one, or the measure lies. */
  base: string;
  /** The owed paths (the deduplicated files in the basis). */
  owedFiles: readonly string[];
}

export interface LegDepositWinner extends LegDepositWithAddress {
  rank: LegDepositRank;
  /** Commits landed since the leg read: 0 for `exact`. */
  distance: number;
  /** Absent iff no coverage query was supplied. */
  coverage?: LegDepositCoverage;
}

export interface LegDepositSuperseded {
  diffSha: string;
  readAt: string;
  rank: LegDepositRank;
  distance: number;
  /** Absent iff no coverage query was supplied. */
  coverage?: LegDepositCoverage;
}

export interface LegDepositStale {
  diffSha: string;
  readAt: string;
  reason: LegDepositStaleReason;
}

export interface LegDepositResolution {
  /** Absent when no deposit is ancestor-or-equal of the head. */
  winner?: LegDepositWinner;
  /** Valid candidates the winner outranked — disclosed, never silently dropped. */
  superseded: LegDepositSuperseded[];
  /** Deposits that name no commit here, that are not ancestors, or that cover nothing. */
  stale: LegDepositStale[];
  /** Files that are not deposits at all, with their reasons. */
  corrupt: LegDepositCorruptEntry[];
}

/**
 * Resolve which deposit (if any) answers for `headSha`.
 *
 * A deposit read at X answers for every DESCENDANT of X — the contract's
 * ancestor-or-equal rule — so the ranking is: `exact` first, then the NEAREST
 * ancestor (fewest commits since the read), ties to the LATEST `readAt`. The
 * winner carries its `distance` so the caller can print "+N commits since the
 * leg read" rather than pass a stale read off as a fresh one.
 *
 * Since mmnto-ai/totem#2698 fold 3 ancestry is only HALF the question. When a
 * `coverage` query is supplied, each ancestor candidate is also measured on
 * what it could have READ — the branch diff up to its own head, intersected
 * with the owed paths — and a candidate covering NONE of them is stale, not a
 * winner: it satisfies ancestor-or-equal while its leg saw nothing this push
 * proposes (the merge-base deposit that produced the ruling). An EXACT match
 * covers everything by construction and costs no git call.
 *
 * Ranking is unchanged: along one lineage a nearer ancestor's diff is a
 * superset of a farther one's, so nearest-first already orders by coverage.
 *
 * Nothing here decides POLICY beyond that floor: partial coverage still
 * resolves, and a distance of 200 still resolves. Whether either is evidence
 * enough is the gate's disclosure to make and doctrine's re-arm to rule.
 */
export function findLegDepositForHead(
  totemDirAbs: string,
  headSha: string,
  git: LegGitAdapter,
  coverage?: LegCoverageQuery,
): LegDepositResolution {
  const { deposits, corrupt } = loadLegDeposits(totemDirAbs);
  const stale: LegDepositStale[] = [];
  const candidates: LegDepositWinner[] = [];

  // Deduplicated here as well as by the caller: `owed` is PRINTED as the
  // denominator of `covers K/N`, and one file matching three globs must not
  // inflate N into a number no reader can reconcile with the basis.
  const owedFiles = coverage === undefined ? [] : [...new Set(coverage.owedFiles)];
  const fullCoverage = (): LegDepositCoverage => ({
    covered: owedFiles.length,
    owed: owedFiles.length,
    missing: [],
  });

  for (const found of deposits) {
    if (found.diffSha === headSha) {
      // An exact match read THIS head: every owed path is inside the diff it
      // saw, by construction. No git call — and an adapter that would throw on
      // one is never reached, which is the property the test pins.
      candidates.push({
        ...found,
        rank: 'exact',
        distance: 0,
        ...(coverage === undefined ? {} : { coverage: fullCoverage() }),
      });
      continue;
    }
    if (!git.isCommit(found.diffSha)) {
      stale.push({
        diffSha: found.diffSha,
        readAt: found.deposit.readAt,
        reason: 'unknown-commit',
      });
      continue;
    }
    if (!git.isAncestor(found.diffSha, headSha)) {
      stale.push({ diffSha: found.diffSha, readAt: found.deposit.readAt, reason: 'not-ancestor' });
      continue;
    }
    let measured: LegDepositCoverage | undefined;
    if (coverage !== undefined && owedFiles.length === 0) {
      // Nothing owed: the intersection is empty whatever the candidate reached,
      // so the probe would be a git call whose result cannot change the answer
      // (mmnto-ai/totem#2698 fold 5, Q3). `0/0` is vacuously covered.
      measured = fullCoverage();
    } else if (coverage !== undefined) {
      const reachable = new Set(git.changedFiles(coverage.base, found.diffSha));
      const missing = owedFiles.filter((file) => !reachable.has(file));
      measured = { covered: owedFiles.length - missing.length, owed: owedFiles.length, missing };
      // Reached only with a non-empty owed set (the empty case returned above),
      // so covering none of it is a real coverage failure.
      if (measured.covered === 0) {
        stale.push({
          diffSha: found.diffSha,
          readAt: found.deposit.readAt,
          reason: 'no-coverage',
        });
        continue;
      }
    }
    candidates.push({
      ...found,
      rank: 'ancestor',
      // Measured AFTER coverage, so a candidate that is already stale costs no
      // second git call.
      distance: git.distance(found.diffSha, headSha),
      ...(measured === undefined ? {} : { coverage: measured }),
    });
  }

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank === 'exact' ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    // Equal reach: the LATEST read wins — the later leg saw everything the
    // earlier one did, at the same head.
    return Date.parse(b.deposit.readAt) - Date.parse(a.deposit.readAt);
  });

  const [winner, ...rest] = candidates;
  return {
    ...(winner === undefined ? {} : { winner }),
    superseded: rest.map((candidate) => ({
      diffSha: candidate.diffSha,
      readAt: candidate.deposit.readAt,
      rank: candidate.rank,
      distance: candidate.distance,
      ...(candidate.coverage === undefined ? {} : { coverage: candidate.coverage }),
    })),
    stale,
    corrupt,
  };
}

// ─── Counts + the covariate field ───────────────────────────────────────────

export interface LegFindingCounts {
  blocking: number;
  material: number;
  minor: number;
  /** `folded.length` — the ids the seat folded, which are STILL counted above. */
  folded: number;
}

/**
 * Count a deposit's findings by severity, plus how many were folded.
 *
 * A folded finding is still a finding: it is counted in its severity bucket
 * AND in `folded`. The covariate prints both, so a reader can see "3 blocking,
 * 3 folded" (all addressed) apart from "3 blocking, 0 folded" (none were).
 */
export function countLegFindings(deposit: LegDeposit): LegFindingCounts {
  let blocking = 0;
  let material = 0;
  let minor = 0;
  for (const finding of deposit.findings) {
    if (finding.severity === 'BLOCKING') blocking++;
    else if (finding.severity === 'MATERIAL') material++;
    else minor++;
  }
  return { blocking, material, minor, folded: deposit.folded.length };
}

/**
 * Render the covariate line's format-v1.2 `leg:` field — the ONE spelling of
 * this text, exactly:
 *
 *   `leg: <sha8> blocking=N material=N folded=N`   (a deposit resolved)
 *   `leg: none`                                    (none did)
 *
 * The field is COMPOSED BESIDE {@link renderCovariateLine} / `renderAdmissionLine`,
 * never inside them: the v1 shapes stay byte-identical, and a consumer keeps
 * discriminating on the second token. The text is contract — the pilot ledger
 * greps this line — so it is spelled here and nowhere else.
 *
 * `minor` is deliberately absent from the field: the round rules on blocking
 * and material, and `folded` is what says whether they were addressed. The
 * full counts stay available via {@link countLegFindings}.
 */
export function renderLegField(deposit: LegDeposit | undefined): string {
  if (deposit === undefined) return 'leg: none';
  const counts = countLegFindings(deposit);
  const sha8 = deposit.diffSha.slice(0, 8);
  return `leg: ${sha8} blocking=${counts.blocking} material=${counts.material} folded=${counts.folded}`;
}

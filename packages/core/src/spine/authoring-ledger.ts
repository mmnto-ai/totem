// ─── ADR-112 §8 — the authoring-ledger (the FM(e)/FM(g) attestation artifact) ─
//
// Append-only NDJSON at `.totem/spine/authoring-ledger.ndjson`. UNLIKE the
// best-effort Trap Ledger (`core/ledger.ts` `appendLedgerEvent`, which SWALLOWS
// write failures behind `onWarn` — correct for observability, WRONG for a
// falsifying-metric gate), every authoring-ledger write is FAIL-LOUD +
// READ-BACK-VERIFIED: a row that cannot be written, re-read, or re-parsed THROWS,
// so no `AuthoredRuleRecord` can reach the compiler without a durable, complete
// §8 ledger entry (FM(e)). This is the codex/gemini reconciliation: the low-level
// NDJSON-append MECHANIC is shared house style, but the ERROR POLICY is distinct
// (throw + verify, never warn-and-swallow).
//
// Each entry binds the rule's stable identity (`ruleId` + `author` +
// `targetDefect` — the latter needed so the upsert index can map a re-read
// `(author,targetDefect)` back to its persisted id), the declared engine, the
// leakage-guard ATTESTATIONS (`splitRef` / `authoredAfterSplit` /
// `heldOutNonInspectionAttestation` — RECORDED in slice B, mechanically VERIFIED
// in slice C), the INDEPENDENT structural-eligibility verdict (§3), the §7
// accelerant lineage, and the fixture PRs. `contentHash` makes a re-author
// idempotent: an unchanged rule re-read appends no duplicate row (codex upsert).

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { canonicalStringify } from '../compile-manifest.js';
import { TotemError } from '../errors.js';
import {
  AuthoredOriginSchema,
  DeclaredEngineSchema,
  StructEligResultSchema,
} from './authored-rule.js';

const nonEmpty = (label: string) =>
  z.string().refine((s) => s.trim().length > 0, { message: `${label} must be non-empty` });

/** The spine subdirectory + filename the authoring-ledger lives at, under `.totem/`. */
export const AUTHORING_LEDGER_DIR = 'spine';
export const AUTHORING_LEDGER_FILE = 'authoring-ledger.ndjson';

/**
 * ADR-112 §8 — one authoring-ledger row. `.strict()` so a malformed/extra-field
 * row fails the read loudly (the attestation chain must not silently degrade).
 */
export const AuthoringLedgerEntrySchema = z
  .object({
    ruleId: nonEmpty('ruleId'),
    author: nonEmpty('author'),
    /** Identity component — `ruleId` is seeded from `sha256(author·targetDefect)`; recorded so the upsert index can resolve a re-read to its persisted id. */
    targetDefect: nonEmpty('targetDefect'),
    authoredAt: nonEmpty('authoredAt'),
    declaredEngine: DeclaredEngineSchema,
    splitRef: nonEmpty('splitRef'),
    authoredAfterSplit: z.literal(true),
    heldOutNonInspectionAttestation: z.literal(true),
    structuralEligibility: StructEligResultSchema,
    origin: AuthoredOriginSchema,
    /**
     * The train-side `positiveFixtures` PRs bound by this rule — the §5(2) leakage-guard
     * attestation. Every positive fixture must resolve to the train slice (the matcher was
     * authored against it); the ledger is the CI-observable FM(e) artifact that enumerates
     * them so C can verify train-side membership.
     *
     * The §5(2) attestation is POSITIVES-ONLY (strategy#770 + the Q-C ruling): a §6 negative
     * control is a SILENCE-ONLY near-miss with no `pr`. A synthetic `kind:'lesson'` exemplar
     * has no corpus position, so there is nothing to train-side-leak-check — §5(2)'s guard
     * targets *corpus-drawn* fixtures, and only `positiveFixtures` are mandated train-side.
     * Enumerating negative PRs was an impl-extra beyond the contract; the attestation drops it.
     * (A future `kind:'commit'` near-miss DOES have a corpus position; its train-side
     * `commitSha` attestation returns WITH the deferred commit-source fallback — parallel to
     * the commit-pair preimage deferral.)
     */
    positiveFixturePrs: z.array(z.number().int().positive()),
    /**
     * LEGACY READ-COMPAT ONLY (pre-#770) — NOT an attestation. `totem rule author` ≤1.81.1
     * wrote `negativeFixturePrs: []` on every row, and `runRuleAuthor` re-reads the FULL
     * existing ledger before writing, so this `.strict()` reader must still PARSE those rows
     * rather than throw on upgrade (greptile-P1 / CR). It is NEVER written by the current
     * intake (the attestation is positives-only, above), so the ledger self-heals to the new
     * shape on the next revision write. Optional + tolerated, never read for leakage-checking.
     */
    negativeFixturePrs: z.array(z.number().int().positive()).optional(),
    /**
     * ADR-112 §5.1/§8 R1 — the frozen split's `freezeCommitment`
     * (`sha256(splitRef · frozenAt · corpusIntegrity)`), chained from the frozen
     * artifact into every entry authored under it (the (b) tamper-evidence leg:
     * a re-freeze changes the commitment, the commitment is INSIDE the
     * `authoringContentHash` material, so every downstream entry reads
     * would-revise — orphaned loudly, never silently current). Optional: rows
     * authored before R1 (or under a legacy free-text splitRef) omit it; the R1
     * materialize path fail-louds when a frozen-artifact run meets an
     * uncommitted entry.
     */
    freezeCommitment: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    /**
     * Fingerprint of the MATERIAL author input (engine / class / matcher /
     * fixtures / origin) — identity (`author`/`targetDefect`/`ruleId`) AND
     * `authoredAt` EXCLUDED, so a pure timestamp refresh is a no-op (§8: a
     * timestamp drift must not churn the rule) while a matcher/fixture edit
     * appends a new revision row under the SAME `ruleId`. Equal hash on re-read ⇒
     * no append.
     */
    contentHash: nonEmpty('contentHash'),
  })
  .strict();
export type AuthoringLedgerEntry = z.infer<typeof AuthoringLedgerEntrySchema>;

/**
 * Recursively LF-normalize every string in a value. Keeps the material-hash
 * determinism SINGLE-HOMED in the hash (Tenet-20, gemini diff-review): the hash
 * is CRLF-invariant regardless of whether the caller pre-normalized, so a future
 * caller of `authoringContentHash` can't silently produce a divergent hash by
 * passing un-normalized CRLF input.
 */
function lfDeepNormalize(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n/g, '\n');
  if (Array.isArray(value)) return value.map(lfDeepNormalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, lfDeepNormalize(v)]),
    );
  }
  return value;
}

/**
 * Deterministic fingerprint of the MATERIAL author fields (§8 idempotency).
 * SELF-normalizes newlines (CRLF→LF) on every string it hashes, so a Windows-
 * authored and an LF-authored identical rule hash identically REGARDLESS of the
 * caller — the determinism is single-homed in the hash, not the reader (Tenet-20,
 * gemini diff-review). Identity + `authoredAt` are NOT part of the material (see
 * `AuthoringLedgerEntrySchema.contentHash`).
 *
 * The file-level ATTESTATIONS (`splitRef` + the booleans) ARE part of the material
 * (greptile-P1 + CR diff-review): they are what this command records, so an
 * attestation-only change (e.g. the split was re-frozen) must trigger a revision
 * row — otherwise the rule reads `unchanged`, no row is appended, and the ledger
 * keeps the STALE split. `authoredAt` stays excluded (a timestamp refresh is a
 * no-op, §8); every OTHER ledger-attested mutable field is covered here.
 */
export function authoringContentHash(material: {
  declaredEngine: string;
  structuralClass: string;
  dslSource: string;
  positiveFixtures: unknown;
  negativeFixtures?: unknown;
  origin: unknown;
  splitRef: string;
  authoredAfterSplit: boolean;
  heldOutNonInspectionAttestation: boolean;
  /** The producer VERDICT (CR diff-review) — incl. `judgedBy`/`basis`; a verdict change must revise. */
  structuralEligibility: unknown;
  /**
   * ADR-112 R1 — the frozen split's freeze commitment, INSIDE the material
   * (codex fold-2: adjacent-to-the-hash would let a re-frozen split read
   * `unchanged`). Absent (legacy / free-text splitRef) ⇒ the key is dropped by
   * canonicalStringify, so every pre-R1 hash is byte-identical — additive.
   */
  freezeCommitment?: string;
}): string {
  return createHash('sha256')
    .update(canonicalStringify(lfDeepNormalize(material)))
    .digest('hex')
    .slice(0, 32);
}

function ledgerPath(totemDir: string): string {
  return path.join(totemDir, AUTHORING_LEDGER_DIR, AUTHORING_LEDGER_FILE);
}

/**
 * Read the full authoring-ledger (append order = revision order; the LAST entry
 * per `ruleId` is effective). FAIL-LOUD on a malformed/invalid row — a corrupt
 * attestation chain must never be silently skipped. Returns `[]` if the ledger
 * does not exist yet (first author).
 */
export function readAuthoringLedger(totemDir: string): AuthoringLedgerEntry[] {
  const file = ledgerPath(totemDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new TotemError(
      'PARSE_FAILED',
      `authoring-ledger could not be read: ${file}`,
      'Check the file exists and is readable; the ledger is the FM(e) attestation chain.',
      err,
    );
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new TotemError(
        'PARSE_FAILED',
        `authoring-ledger line ${i + 1} is not valid JSON`,
        'The ledger is append-only and machine-written; do not hand-edit it.',
        err,
      );
    }
    const res = AuthoringLedgerEntrySchema.safeParse(parsed);
    if (!res.success) {
      throw new TotemError(
        'GATE_INVALID',
        `authoring-ledger line ${i + 1} violates the ADR-112 §8 entry schema: ${res.error.message}`,
        'A malformed entry breaks the FM(e) attestation chain; restore the ledger from version control.',
        res.error,
      );
    }
    return res.data;
  });
}

/**
 * Append one §8 entry, FAIL-LOUD + READ-BACK-VERIFIED. Validates the entry
 * (throws on an incomplete row — FM(e)), appends canonically, then re-reads the
 * ledger and asserts the last row round-trips byte-identically. Any failure
 * THROWS so the caller never lets the rule reach compile feed on an unpersisted
 * attestation. (Distinct from `appendLedgerEvent`'s warn-and-continue.)
 *
 * Semantics are APPEND-ONLY, not transactional (codex diff-review): a read-back
 * mismatch on a row that did persist correctly is a report/state mismatch, not a
 * corrupt record — the next run reads the (valid) row as effective state. The
 * throw is the honest signal that THIS write could not be confirmed; it is never
 * a path to an invalid record (an actually-wrong row fails the schema re-read). A
 * heavier temp-file/lock/transaction story is deferred unless the cert demands it.
 */
export function appendAuthoringLedgerEntry(totemDir: string, entry: AuthoringLedgerEntry): void {
  const validated = AuthoringLedgerEntrySchema.parse(entry);
  const dir = path.join(totemDir, AUTHORING_LEDGER_DIR);
  const file = ledgerPath(totemDir);
  const line = canonicalStringify(validated);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, `${line}\n`, 'utf-8');
  // Verify the row is PRESENT, not necessarily LAST (CR diff-review): a concurrent
  // `runRuleAuthor` could append a row between our `appendFileSync` and this read, so a
  // `back[back.length-1]` check would false-throw on a SUCCESSFUL append. `appendFileSync`
  // writes a complete line atomically, so our line is intact in the file even if not last.
  // A raw substring check on the appended `${line}\n` (GCA diff-review) preserves that
  // present-not-last semantics WITHOUT re-parsing + Zod-validating the whole ledger on every
  // append — the read-back was O(N²) across the append loop. The trailing newline pins the
  // match to a complete line (canonical entries are single-line, so it can't match mid-row).
  const rawContent = fs.readFileSync(file, 'utf-8');
  if (!rawContent.includes(`${line}\n`)) {
    throw new TotemError(
      'GATE_INVALID',
      `authoring-ledger read-back could not confirm the row for ruleId '${entry.ruleId}'`,
      'The ledger write did not persist verbatim; the rule is withheld from compile feed (FM(e)).',
    );
  }
}

/**
 * Fold the ledger to its EFFECTIVE state: the LAST entry per `ruleId` (append
 * order = revision order, so a later revision supersedes). Returned in each
 * ruleId's FIRST-appearance order (Map insertion order, stable). The D5 authored
 * freeze/cert gates read these — a superseded revision must never gate the run.
 */
export function foldEffectiveLedgerEntries(
  entries: readonly AuthoringLedgerEntry[],
): AuthoringLedgerEntry[] {
  const byRuleId = new Map<string, AuthoringLedgerEntry>();
  for (const e of entries) byRuleId.set(e.ruleId, e);
  return [...byRuleId.values()];
}

/**
 * The effective state of one authored rule, folded from its ledger lineage: the
 * persisted `ruleId` + the latest material `contentHash`. Keyed by the identity
 * pair so the reader can upsert a re-read `(author,targetDefect)` onto its
 * existing id instead of self-colliding to a fresh `-N`.
 */
export interface AuthoredIdentity {
  ruleId: string;
  contentHash: string;
}

/**
 * The upsert identity key. Uses the SAME injective encoding as mintAuthoredRuleId's seed
 * (JSON.stringify of [author, targetDefect]) so the upsert key and the minted id agree on
 * what "one identity" is. A naive author-space-targetDefect join is NON-injective: a space
 * in either free-text field aliases distinct identities -- ('alice','off by one') and
 * ('alice off','by one') collapse onto one key (the #2259 CR-major class the mint already
 * fixed; strategy-claude flagged the upsert-key inconsistency on the slice-B seam review).
 * JSON.stringify of the pair can never collide across distinct inputs.
 */
export function identityKey(author: string, targetDefect: string): string {
  return JSON.stringify([author, targetDefect]);
}

/**
 * Fold the ledger into the upsert index: `(author,targetDefect)` → the effective
 * `{ruleId, contentHash}` (append order means the LAST row per identity wins —
 * the latest revision). Also returns every persisted `ruleId` so a genuinely NEW
 * identity mints against the full set. FAIL-LOUD on BOTH uniqueness violations
 * (codex diff-review): one `(author,targetDefect)` mapping to two `ruleId`s, AND
 * one `ruleId` shared by two distinct identities — the reverse would let one
 * authoring run materialize two records sharing an authored identity (both with
 * `authoringLedgerRef = ruleId`), which the fail-loud reader must reject too.
 */
export function buildAuthoredIdentityIndex(entries: readonly AuthoringLedgerEntry[]): {
  byIdentity: Map<string, AuthoredIdentity>;
  allRuleIds: Set<string>;
} {
  const byIdentity = new Map<string, AuthoredIdentity>();
  const allRuleIds = new Set<string>();
  const identityOfRuleId = new Map<string, string>();
  for (const e of entries) {
    const key = identityKey(e.author, e.targetDefect);
    const existing = byIdentity.get(key);
    if (existing && existing.ruleId !== e.ruleId) {
      throw new TotemError(
        'GATE_INVALID',
        `authoring-ledger maps identity (${e.author} · ${e.targetDefect}) to two ruleIds ('${existing.ruleId}' and '${e.ruleId}')`,
        'A single (author,targetDefect) must own exactly one ruleId; the ledger is corrupt.',
      );
    }
    const priorIdentity = identityOfRuleId.get(e.ruleId);
    if (priorIdentity !== undefined && priorIdentity !== key) {
      throw new TotemError(
        'GATE_INVALID',
        `authoring-ledger maps ruleId '${e.ruleId}' to two distinct identities`,
        'A single ruleId must own exactly one (author,targetDefect); the ledger is corrupt.',
      );
    }
    identityOfRuleId.set(e.ruleId, key);
    byIdentity.set(key, { ruleId: e.ruleId, contentHash: e.contentHash });
    allRuleIds.add(e.ruleId);
  }
  return { byIdentity, allRuleIds };
}

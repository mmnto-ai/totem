// ─── ADR-112 §8 — the authored-rule intake producer (synchronous library) ─────
//
// `runRuleAuthor` reads `.totem/spine/authored-rules.yaml`, establishes each
// rule's structural eligibility INDEPENDENTLY (never trusting the author),
// mints/upserts a stable identity, and records the §8 authoring-ledger — the
// FM(d)/(e) trust boundary slice A deferred. This is a LIBRARY module (not a CLI
// command), so it keeps static imports; the command wrapper (`commands/rule-author.ts`)
// is the lazy-loaded surface (the `.coderabbit.yaml` lazy-load rule targets CLI
// *commands* — CR's own suggested split for the synchronous producer).
//
// The author may set ONLY author-owned fields (`AuthoredRuleInput` is `.strict()`,
// and a recursive scan rejects producer-owned keys at ANY depth). The reader re-runs
// `evaluateStructuralEligibility` over the DI whitelist (never in core, Tenet 5) and
// OVERWRITES any author claim. Two passes for fail-loud atomicity: pass 1 is PURE
// (parse → re-run eligibility → construct records → diff the ledger), so any invalid
// rule throws before a single byte is written; pass 2 appends ledger rows (fail-loud
// + read-back). SLICE B: the records are produced + ledgered but not yet fed to the
// certifying corpus (B2 / C/D), which must key on `ruleId`, not `lessonHash`.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  appendAuthoringLedgerEntry,
  type AuthoredOrigin,
  type AuthoredRuleRecord,
  AuthoredRuleRecordSchema,
  AuthoredRulesFileSchema,
  authoringContentHash,
  type AuthoringLedgerEntry,
  buildAuthoredIdentityIndex,
  evaluateStructuralEligibility,
  identityKey,
  mintAuthoredRuleId,
  readAuthoringLedger,
  TotemError,
} from '@mmnto/totem';

import { authoredWhitelist } from './commands/authored-whitelist.js';

/** `.totem`-relative path to the authoring input. */
export const AUTHORED_RULES_REL = path.join('spine', 'authored-rules.yaml');

/** Normalize CRLF → LF so a Windows-authored and an LF-authored identical rule hash + record identically. */
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

const FROM_SCRATCH: AuthoredOrigin = { kind: 'from-scratch' };

// FM(d) defense-in-depth (codex diff-review): the top-level `.strict()` rejects producer-owned
// keys at the rule/file level, but Zod `.strict()` is NOT recursive — a reserved key NESTED inside
// a fixture or origin object would be STRIPPED, not rejected. This scan makes the contract promise
// ("producer fields are inexpressible ANYWHERE in authored-rules.yaml") literally true: the
// eligibility verdict, identity, and disposition are minted by the producer at every depth.
const RESERVED_PRODUCER_KEYS: ReadonlySet<string> = new Set([
  'structuralEligibility',
  'decidable',
  'judgedBy',
  'basis',
  'ruleId',
  'authoringLedgerRef',
  'classifierDisposition',
  'disposition',
  'routing',
  'unverified',
]);

function assertNoReservedProducerKeys(value: unknown, at = '<root>'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoReservedProducerKeys(v, `${at}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    if (RESERVED_PRODUCER_KEYS.has(k)) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored-rules.yaml carries a producer-owned key '${k}' at ${at} — the producer establishes it, not the author (ADR-112 §3 / FM(d))`,
        'Remove the field; the structural-eligibility verdict, rule id, and disposition are minted by the producer.',
      );
    }
    assertNoReservedProducerKeys(v, `${at}.${k}`);
  }
}

/** A rule the whitelist could not decide — recorded, not minted, not ledgered (no record reaches compile). */
export interface RejectedAuthoredRule {
  author: string;
  targetDefect: string;
  structuralClass: string;
  declaredEngine: string;
  reason: string;
}

export interface RuleAuthorResult {
  /** The eligible, materialized records (slice-B output; fed to the compiler in B2). */
  records: AuthoredRuleRecord[];
  /** Newly minted identities this run. */
  minted: number;
  /** Existing identities with a material change → a new ledger revision (same ruleId). */
  revised: number;
  /** Existing identities unchanged → no ledger append (idempotent re-read). */
  unchanged: number;
  /** Non-decidable rules — excluded from the producer output, surfaced for the author. */
  rejected: RejectedAuthoredRule[];
}

/** One pending ledger write paired with its constructed record (pass-1 product). */
interface PendingRule {
  record: AuthoredRuleRecord;
  entry: AuthoringLedgerEntry;
  write: boolean; // false ⇒ unchanged (idempotent no-op, no append)
  action: 'minted' | 'revised' | 'unchanged';
}

/**
 * ADR-112 §8 — ingest `.totem/spine/authored-rules.yaml` into authored records +
 * the authoring-ledger. `judgedBy` names the independent check (NEVER the author)
 * recorded on every eligibility verdict. Pure + deterministic except the ledger IO.
 */
export function runRuleAuthor(totemDir: string, opts: { judgedBy: string }): RuleAuthorResult {
  const file = path.join(totemDir, AUTHORED_RULES_REL);

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    throw new TotemError(
      'CONFIG_MISSING',
      `authored-rules.yaml not found: ${file}`,
      'Create .totem/spine/authored-rules.yaml with a splitRef header + a rules list (ADR-112 §8).',
      err,
    );
  }

  let doc: unknown;
  try {
    doc = parseYaml(lf(text));
  } catch (err) {
    throw new TotemError(
      'PARSE_FAILED',
      `authored-rules.yaml is not valid YAML: ${file}`,
      'Fix the YAML syntax; the file is hand-editable but must parse.',
      err,
    );
  }

  // FM(d): reject reserved producer keys at ANY depth (codex — `.strict()` is not recursive),
  // THEN strict-parse the top level (any unknown top-level/rule key also fails, never stripped).
  assertNoReservedProducerKeys(doc);
  const parsed = AuthoredRulesFileSchema.safeParse(doc);
  if (!parsed.success) {
    throw new TotemError(
      'CONFIG_INVALID',
      `authored-rules.yaml is invalid: ${parsed.error.message}`,
      'The file may set only author-owned fields; producer fields (structuralEligibility, ruleId, decidable, disposition, …) are established by the producer, not the author (ADR-112 §3 / FM(d)).',
      parsed.error,
    );
  }
  const fileDoc = parsed.data;

  // Reject a duplicate identity WITHIN the file (codex — ambiguous which rule owns the id) +
  // enforce §3 independence: the eligibility check's `judgedBy` must never be a rule's own author
  // (codex diff-review — `--judged-by` is user-settable, so guard it at the boundary).
  const seenInFile = new Set<string>();
  for (const r of fileDoc.rules) {
    if (r.author === opts.judgedBy) {
      throw new TotemError(
        'CONFIG_INVALID',
        `judgedBy '${opts.judgedBy}' is also rule author '${r.author}' — the independent structural-eligibility check must never be the author (ADR-112 §3)`,
        'Pass a --judged-by that names the CHECK (e.g. static-whitelist@cert-1), distinct from any rule author.',
      );
    }
    const key = identityKey(r.author, r.targetDefect);
    if (seenInFile.has(key)) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored-rules.yaml declares the identity (${r.author} · ${r.targetDefect}) more than once`,
        'Each (author, targetDefect) is exactly one rule identity — merge the duplicates or change the targetDefect.',
      );
    }
    seenInFile.add(key);
  }

  // Upsert index from the persisted ledger (fail-loud on a corrupt chain).
  const { byIdentity, allRuleIds } = buildAuthoredIdentityIndex(readAuthoringLedger(totemDir));
  const mintedIds = new Set<string>(allRuleIds);

  // ── Pass 1 (PURE): eligibility, identity, record construction — no writes ──
  const pending: PendingRule[] = [];
  const rejected: RejectedAuthoredRule[] = [];
  for (const r of fileDoc.rules) {
    // Re-run the INDEPENDENT eligibility check; the author's structuralClass is a CLAIM.
    const structuralEligibility = evaluateStructuralEligibility(
      { declaredEngine: r.declaredEngine, structuralClass: r.structuralClass },
      authoredWhitelist(),
      opts.judgedBy,
    );
    if (!structuralEligibility.decidable) {
      rejected.push({
        author: r.author,
        targetDefect: r.targetDefect,
        structuralClass: r.structuralClass,
        declaredEngine: r.declaredEngine,
        reason: `no unambiguous whitelist match for (${r.declaredEngine}, ${r.structuralClass}) — not structurally decidable (ADR-112 §3)`,
      });
      continue;
    }

    const origin: AuthoredOrigin = r.origin ?? FROM_SCRATCH;
    const dslSource = lf(r.dslSource);
    // The file-level attestations are part of the revision fingerprint (greptile-P1 + CR): an
    // attestation-only change (e.g. a re-frozen split) must append a fresh row, never read `unchanged`.
    const contentHash = authoringContentHash({
      declaredEngine: r.declaredEngine,
      structuralClass: r.structuralClass,
      dslSource,
      positiveFixtures: r.positiveFixtures,
      negativeFixtures: r.negativeFixtures,
      origin,
      splitRef: fileDoc.splitRef,
      authoredAfterSplit: fileDoc.authoredAfterSplit,
      heldOutNonInspectionAttestation: fileDoc.heldOutNonInspectionAttestation,
    });

    const key = identityKey(r.author, r.targetDefect);
    const existing = byIdentity.get(key);
    let ruleId: string;
    let action: PendingRule['action'];
    if (existing) {
      ruleId = existing.ruleId; // reuse the persisted id — NEVER re-mint an existing identity
      action = existing.contentHash === contentHash ? 'unchanged' : 'revised';
    } else {
      ruleId = mintAuthoredRuleId(r.author, r.targetDefect, mintedIds);
      mintedIds.add(ruleId);
      action = 'minted';
    }

    // Construct + validate the record. `authoredAt` calendar validity is enforced at intake
    // (AuthoredRuleInputSchema), but wrap defensively so any residual construction failure
    // surfaces as a clean TotemError, not a raw ZodError (GCA diff-review — the library throws;
    // the command formats + sets the exit code, never the other way around).
    let record: AuthoredRuleRecord;
    try {
      record = AuthoredRuleRecordSchema.parse({
        ruleId,
        provenance: {
          kind: 'authored',
          author: r.author,
          authoredAt: r.authoredAt,
          targetDefect: r.targetDefect,
          positiveFixtures: r.positiveFixtures,
          ...(r.negativeFixtures ? { negativeFixtures: r.negativeFixtures } : {}),
        },
        structuralEligibility,
        origin,
        declaredEngine: r.declaredEngine,
        authoringLedgerRef: ruleId, // the ledger lineage for this ruleId; the latest entry is effective
        dslSource,
        unverified: true,
      });
    } catch (err) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored rule (${r.author} · ${r.targetDefect}) failed validation: ${(err as Error).message}`,
        'Fix the offending field in authored-rules.yaml.',
        err,
      );
    }

    const entry: AuthoringLedgerEntry = {
      ruleId,
      author: r.author,
      targetDefect: r.targetDefect,
      authoredAt: r.authoredAt,
      declaredEngine: r.declaredEngine,
      splitRef: fileDoc.splitRef,
      authoredAfterSplit: fileDoc.authoredAfterSplit,
      heldOutNonInspectionAttestation: fileDoc.heldOutNonInspectionAttestation,
      structuralEligibility,
      origin,
      positiveFixturePrs: r.positiveFixtures.map((f) => f.pr),
      negativeFixturePrs: (r.negativeFixtures ?? []).map((f) => f.pr),
      contentHash,
    };

    pending.push({ record, entry, write: action !== 'unchanged', action });
  }

  // ── Pass 2 (IO): append ledger rows fail-loud (pass 1 already proved every record valid) ──
  let minted = 0;
  let revised = 0;
  let unchanged = 0;
  const records: AuthoredRuleRecord[] = [];
  for (const p of pending) {
    if (p.write) appendAuthoringLedgerEntry(totemDir, p.entry);
    records.push(p.record);
    if (p.action === 'minted') minted += 1;
    else if (p.action === 'revised') revised += 1;
    else unchanged += 1;
  }

  return { records, minted, revised, unchanged, rejected };
}

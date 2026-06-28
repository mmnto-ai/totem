// ─── ADR-112 §8 — `totem rule author`: the authored-rule producer surface ─────
//
// Reads `.totem/spine/authored-rules.yaml`, establishes each rule's structural
// eligibility INDEPENDENTLY (never trusting the author), mints/upserts a stable
// identity, and records the §8 authoring-ledger — the FM(d)/(e) trust boundary
// slice A deferred. The author may set ONLY author-owned fields (`AuthoredRuleInput`
// is `.strict()`); a hand-edited `decidable`/`structuralEligibility`/`ruleId` is
// rejected at parse, never read. The whitelist is DI'd (Tenet 5 — never in core).
//
// Two passes for fail-loud atomicity: pass 1 is PURE (parse → re-run eligibility →
// construct records → diff against the ledger), so any invalid rule throws before
// a single byte is written; pass 2 appends ledger rows (fail-loud + read-back).
// SLICE B is the producer + intake; feeding records to the compiler (`toCompileFeed`
// → `runCompileStage`) is B2 validation, and the identity-bearing certifying-corpus
// assembly is deferred to C/D (it must key on `ruleId`, not `lessonHash`).

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

import { authoredWhitelist } from './authored-whitelist.js';

/** `.totem`-relative path to the authoring input. */
export const AUTHORED_RULES_REL = path.join('spine', 'authored-rules.yaml');

/** Normalize CRLF → LF so a Windows-authored and an LF-authored identical rule hash + record identically. */
const lf = (s: string): string => s.replace(/\r\n/g, '\n');

const FROM_SCRATCH: AuthoredOrigin = { kind: 'from-scratch' };

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

  // FM(d): strict parse — any producer-owned field (structuralEligibility / ruleId /
  // decidable / disposition / …) is an unknown key and fails here, never silently stripped.
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

  // Reject a duplicate identity WITHIN the file (codex — ambiguous which rule owns the id).
  const seenInFile = new Set<string>();
  for (const r of fileDoc.rules) {
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
    const contentHash = authoringContentHash({
      declaredEngine: r.declaredEngine,
      structuralClass: r.structuralClass,
      dslSource,
      positiveFixtures: r.positiveFixtures,
      negativeFixtures: r.negativeFixtures,
      origin,
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

    // Construct + validate the record (the provenance refine enforces authoredAt calendar validity).
    const record = AuthoredRuleRecordSchema.parse({
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
      fixturePrs: r.positiveFixtures.map((f) => f.pr),
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

/**
 * CLI entry for `totem rule author`. Resolves the `.totem` dir, ingests
 * `authored-rules.yaml`, and reports. A non-decidable rule is surfaced LOUDLY —
 * a warning + a non-zero exit signal — so it is NEVER a silent omission
 * (ADR-112 §3 / the strategy seam-review (f) ask). SLICE B: from-YAML only
 * (interactive authoring is a later upgrade, §8); the records are produced +
 * ledgered but not yet fed to the certifying corpus (B2 / C/D).
 */
export async function ruleAuthorCommand(opts: { judgedBy?: string }): Promise<void> {
  const { loadConfig, resolveConfigPath } = await import('../utils.js');
  const cwd = process.cwd();
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);

  const judgedBy = opts.judgedBy?.trim() || 'static-whitelist@cert-1';
  const result = runRuleAuthor(totemDir, { judgedBy });

  console.log(
    `[RuleAuthor] ${result.records.length} authored rule(s): ` +
      `${result.minted} minted, ${result.revised} revised, ${result.unchanged} unchanged.`,
  );
  for (const rec of result.records) {
    console.log(`  + ${rec.ruleId}  ${rec.provenance.author} :: ${rec.provenance.targetDefect}`);
  }

  if (result.rejected.length > 0) {
    console.warn(
      `\n[RuleAuthor] WARNING: ${result.rejected.length} rule(s) REJECTED — not structurally ` +
        `decidable, excluded from the producer output:`,
    );
    for (const r of result.rejected) {
      console.warn(`  x ${r.author} :: ${r.targetDefect}: ${r.reason}`);
    }
    // Non-zero signal (strategy seam-review (f)) — a rejected rule is never a silent omission.
    process.exitCode = 1;
  }
}

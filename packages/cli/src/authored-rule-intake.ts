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
// PROP 310 slice 3 (§ Design 1, OQ-1 records-only): an entry no longer carries the
// rule inline. It carries a `record:` reference to `.totem/rules/<slug>.rule.yaml`,
// which this module resolves, reads through the LF admit hop, content-hashes, and
// parses with the V1 grammar. The engine the whitelist judges is DERIVED from the
// record's `target.type`; each positive fixture's certification `preimageSource` is
// DERIVED from `examples[<its ordinal>]` under the § Design 10 `(ruleId, ordinal)`
// key. An `dslSource` / `declaredEngine` / `preimageSource` key anywhere in the
// envelope is a MIGRATION error rejected by name.
//
// The author may set ONLY author-owned fields (`AuthoredRuleInput` is `.strict()`,
// and a recursive scan rejects producer-owned keys at ANY depth). The reader re-runs
// `evaluateStructuralEligibility` over the DI whitelist (never in core, Tenet 5) and
// OVERWRITES any author claim. Two passes for fail-loud atomicity: pass 1 is PURE
// (parse → re-run eligibility → construct records → diff the ledger), so any invalid
// rule throws before a single byte is written; pass 2 appends ledger rows (fail-loud
// + read-back). SLICE B: the records are produced + ledgered but not yet fed to the
// certifying corpus (B2 / C/D), which must key on `ruleId`, not `lessonHash`.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  appendAuthoringLedgerEntry,
  type AuthoredFixture,
  type AuthoredOrigin,
  type AuthoredRuleInput,
  type AuthoredRuleRecord,
  AuthoredRuleRecordSchema,
  AuthoredRulesFileSchema,
  authoringContentHash,
  type AuthoringLedgerEntry,
  buildAuthoredIdentityIndex,
  evaluateStructuralEligibility,
  type FrozenSplitArtifact,
  identityKey,
  mintAuthoredRuleId,
  type ParsedRuleRecord,
  parseRuleRecord,
  readAuthoringLedger,
  RECORD_FILE_SUFFIX,
  RECORDS_DIR_REL,
  sanitizeForTerminal,
  SPLIT_REF_RE,
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

/**
 * Prop 310 § Design 1 (OQ-1 ruling, records-only) — keys the PRE-slice-3 envelope
 * carried that the record grammar now owns. Rejected BY NAME rather than as a
 * generic unknown key, so the author is told WHERE the value went instead of that
 * they typo'd a field:
 *
 *   - `dslSource` / `declaredEngine` — the rule half moved into the record file;
 *     the engine is DERIVED there from `target.type` (§ Design 3/R17) and is never
 *     author-mirrored.
 *   - `preimageSource` — Amendment 1 makes the record's `examples` block the
 *     EDITABLE home and the envelope's side DERIVED, so hand-writing it would be
 *     the second copy the ruling exists to remove. The fixture references a pair by
 *     `example: <ordinal>` instead.
 *
 * Scanned at every depth for the same reason the producer set is: Zod `.strict()`
 * is not recursive, so a nested occurrence would be STRIPPED rather than rejected.
 */
const MIGRATED_RECORD_KEYS: ReadonlyMap<string, string> = new Map([
  [
    'dslSource',
    'the rule itself now lives in a record file — move the matcher into `target:` there',
  ],
  [
    'declaredEngine',
    'the engine is DERIVED from the record’s `target.type` (Prop 310 § Design 3/R17), never declared on the envelope',
  ],
  [
    'preimageSource',
    'the bad/good pair now lives in the record’s `examples:` block and the envelope’s `preimageSource` is DERIVED from it (Prop 310 Amendment 1) — reference a pair with `example: <ordinal>` instead',
  ],
]);

/**
 * `recordForm` is the reference shape THIS repo uses — derived from the caller's
 * actual `totemDir`, never the hardcoded `.totem/`. A repo whose config names a
 * different totem directory would otherwise be handed a migration instruction
 * that does not resolve there (MIN-6).
 */
function assertNoReservedProducerKeys(value: unknown, recordForm: string, at = '<root>'): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoReservedProducerKeys(v, recordForm, `${at}[${i}]`));
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
    const migrated = MIGRATED_RECORD_KEYS.get(k);
    if (migrated !== undefined) {
      // The FULL key path, not just the parent: a migration message is an
      // instruction to go edit one line, so it names the line.
      throw new TotemError(
        'CONFIG_INVALID',
        `authored-rules.yaml carries '${k}' at ${at}.${k} — ${migrated}. Since Prop 310 slice 3 an authored entry carries ONLY a \`record:\` reference to \`${recordForm}\` (Prop 310 § Design 1, OQ-1 records-only).`,
        `Move the rule into a record file at \`${recordForm}\` and replace the key with \`record: ${recordForm}\`.`,
      );
    }
    assertNoReservedProducerKeys(v, recordForm, `${at}.${k}`);
  }
}

/** The `record:` reference shape for a given `.totem` dir, as the author must write it. */
function recordReferenceForm(totemDir: string): string {
  return `${path.basename(totemDir)}/${RECORDS_DIR_REL}/<slug>${RECORD_FILE_SUFFIX}`;
}

// ── Prop 310 § Design 1 — reading the referenced record ──────────────────────

/** One ingested record: the resolved path, its LF-admitted content hash, and slice 1's parse. */
export interface IngestedRecord {
  /** The reference exactly as the envelope wrote it — informational, never identity. */
  path: string;
  /** sha256 of the LF-admitted bytes — what every §8 attestation binds to. */
  contentHash: string;
  parsed: ParsedRuleRecord;
}

/**
 * The closed set of § Design 1 shape rules an envelope `record:` reference can
 * violate. A runtime value, not a bare union, so the test table can assert every
 * rule has a negative fixture — the same discipline `GLOB_DIALECT_RULES` applies
 * on the record-grammar side.
 */
export const RECORD_REFERENCE_RULES = [
  'separator',
  'absolute-path',
  'drive-letter',
  'unc-path',
  'empty-segment',
  'current-segment',
  'parent-segment',
  'records-dir-prefix',
  'suffix',
  'is-the-records-dir',
] as const;

export type RecordReferenceRule = (typeof RECORD_REFERENCE_RULES)[number];

// Vocabulary deliberately MIRRORS `checkGlobDialect`'s (rule-record.ts): a
// backslash is a `separator` violation, a leading `/` an `absolute-path`, a
// `C:` prefix a `drive-letter`, and so on, so an author who has met one surface
// reads the other without relearning it. `checkGlobDialect` itself is NOT called
// here — it bans `[ ( ) ? + | ^ $`, which are perfectly legal in a FILENAME.
const DRIVE_LETTER_RE = /^[A-Za-z]:/;

/**
 * LEXICAL validation of a `record:` reference — pure string rules over the value
 * as written, run BEFORE any path resolution.
 *
 * Why lexical and why first (falsification leg MIN-2): `path.resolve` +
 * `path.relative` reach the same verdict for a POSIX-clean reference on every
 * platform, but they DIVERGE on the malformed ones. On win32 a backslash is a
 * separator and on linux it is a filename character; a drive-letter absolute that
 * happens to land inside the root passes containment; `//` collapses; and the
 * default filesystem case-insensitivity lets `.totem/Rules/x.rule.yaml` resolve
 * into the real directory on Windows and fail on linux. The reference is also
 * recorded VERBATIM in the tracked `authoring-ledger.ndjson`, so an accepted
 * absolute or backslashed form would commit a machine-specific path into a shared
 * attestation. These rules give one verdict on both platforms, on the text.
 *
 * Returns the violated rule, or `null` when the reference is well-formed. The
 * resolved-containment check in `resolveRecordPath` stays as the second line of
 * defence.
 */
export function checkRecordReference(
  totemDirName: string,
  reference: string,
): RecordReferenceRule | null {
  if (reference.includes('\\')) return 'separator';
  if (reference.startsWith('//')) return 'unc-path';
  if (reference.startsWith('/')) return 'absolute-path';
  if (DRIVE_LETTER_RE.test(reference)) return 'drive-letter';

  const requiredPrefix = `${totemDirName}/${RECORDS_DIR_REL}/`;
  // CASE-SENSITIVE by construction (plain `startsWith`): the record class is the
  // git-tracked path NAME, which is case-sensitive, and accepting a case variant
  // here would admit a reference that resolves on a case-folding filesystem and
  // dangles everywhere else.
  if (!reference.startsWith(requiredPrefix)) return 'records-dir-prefix';
  if (reference === requiredPrefix) return 'is-the-records-dir';

  for (const segment of reference.split('/')) {
    if (segment.length === 0) return 'empty-segment';
    if (segment === '.') return 'current-segment';
    if (segment === '..') return 'parent-segment';
  }

  // Last: a well-shaped path pointing at the wrong FILE CLASS is the most
  // specific defect, so it reads after the structural ones.
  if (!reference.endsWith(RECORD_FILE_SUFFIX)) return 'suffix';
  return null;
}

/** Why each rule fired, in the author's terms. */
const RECORD_REFERENCE_DETAIL: Record<RecordReferenceRule, string> = {
  separator: 'contains a backslash — records use `/` exclusively, on every platform',
  'absolute-path': 'is an absolute path — the reference is repo-relative',
  'drive-letter': 'carries a drive letter — the reference is repo-relative',
  'unc-path': 'is a UNC path — the reference is repo-relative',
  'empty-segment': 'contains an empty path segment',
  'current-segment': 'contains a `.` segment — write the path without it',
  'parent-segment': 'contains a `..` segment — a reference never navigates upward',
  'records-dir-prefix':
    'does not begin with the records directory, compared CASE-SENSITIVELY against the git-tracked path name',
  suffix: `does not end in '${RECORD_FILE_SUFFIX}'`,
  'is-the-records-dir': 'names the records directory itself rather than a record file',
};

/**
 * Resolve an envelope `record:` reference to an absolute path.
 *
 * Two gates, in order: the platform-independent LEXICAL rules above, then the
 * resolved-containment check as defence in depth.
 *
 * The reference is repo-relative (§ Design 1) and this library is git-free, so the
 * repo root it resolves against is `dirname(totemDir)` — the layout `.totem/` and
 * every fixture use. A nested `totemDir` would put the containment check out of
 * reach of a repo-relative reference; that fails LOUD with the path named rather
 * than silently resolving somewhere else.
 */
function resolveRecordPath(totemDir: string, reference: string): string {
  const rulesRoot = path.resolve(totemDir, RECORDS_DIR_REL);
  const totemDirName = path.basename(totemDir);
  const expectedForm = recordReferenceForm(totemDir);
  const reject = (rule: string, why: string): never => {
    throw new TotemError(
      'CONFIG_INVALID',
      `authored-rules.yaml record reference '${reference}' ${why} [${rule}] — a record is referenced as \`${expectedForm}\` (Prop 310 § Design 1)`,
      `Write \`record: ${expectedForm}\` with forward slashes, no leading \`./\` or \`/\`, and the directory name exactly as it appears in git.`,
    );
  };

  const violation = checkRecordReference(totemDirName, reference);
  if (violation !== null) reject(violation, RECORD_REFERENCE_DETAIL[violation]);

  const resolved = path.resolve(path.dirname(totemDir), reference);
  const relative = path.relative(rulesRoot, resolved);
  // `..` as a whole SEGMENT, not as a prefix: a bare `startsWith('..')` also
  // rejects `..hidden/x.rule.yaml` and `..a.rule.yaml`, which are ordinary file
  // names that resolve INSIDE the root. The escape this guards is a path that
  // steps OUT, and only a leading `..` segment does that.
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`);
  if (relative === '' || escapes || path.isAbsolute(relative)) {
    reject('containment', `does not resolve inside ${rulesRoot}`);
  }
  return resolved;
}

/** Read + parse one referenced record. A `RuleRecordParseError` propagates UNWRAPPED (§ Failure modes). */
function ingestRecord(totemDir: string, reference: string): IngestedRecord {
  const file = resolveRecordPath(totemDir, reference);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    throw new TotemError(
      'CONFIG_MISSING',
      `rule record not found: ${file} (referenced as '${reference}' in authored-rules.yaml)`,
      `Create the record, or correct the \`record:\` reference (Prop 310 § Design 1).`,
      err,
    );
  }
  // The LF image is the ONE representation everything downstream sees: the parse,
  // the content hash, and the derived exemplars. That is the shipped admit hop
  // (Amendment 1 item 2's `serialization-admit` class), and it is what makes a
  // CRLF-authored record hash and derive identically to its LF twin.
  const text = lf(raw);
  const contentHash = createHash('sha256').update(text).digest('hex');
  // NOT wrapped: `RuleRecordParseError` already names the file AND the offending
  // record key path, and § Failure modes requires it reach the author intact rather
  // than flattened into a generic reject.
  const parsed = parseRuleRecord(text, reference);
  return { path: reference, contentHash, parsed };
}

/**
 * Prop 310 § Design 10 / Amendment 1 — DERIVE each positive fixture's
 * `preimageSource` from the record's `examples[ordinal]`, keyed `(ruleId, ordinal)`
 * with the CR-blind pair hash as drift sensor.
 *
 * Called AFTER the identity is resolved, because the derived key carries the real
 * minted `ruleId` — deriving before the mint would anchor the pair to a placeholder.
 * A dangling ordinal and a duplicate ordinal both fail LOUD naming the rule and the
 * ordinal ("a dangling, duplicate, or hash-mismatched reference fails loud at
 * intake — never a silent re-pair"); the hash-mismatch leg is the ledger's own
 * `contentHash` comparison, which needs no second mechanism.
 */
export function deriveRecordFixtures(
  rule: AuthoredRuleInput,
  ingested: IngestedRecord,
  ruleId: string,
): AuthoredFixture[] {
  const examples = ingested.parsed.record.examples;
  const who = `${sanitizeForTerminal(rule.author)} · ${sanitizeForTerminal(rule.targetDefect)}`;
  const seenOrdinals = new Set<number>();
  return rule.positiveFixtures.map((fixture) => {
    const ordinal = fixture.example;
    const example = examples[ordinal];
    if (example === undefined) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored rule (${who}) declares a positive fixture referencing example ordinal ${ordinal}, but its record '${sanitizeForTerminal(ingested.path)}' carries ${examples.length} example pair(s) — the reference is DANGLING (Prop 310 § Design 10)`,
        `Use an ordinal in 0..${examples.length - 1}, or add the missing pair to the record's \`examples:\` block.`,
      );
    }
    if (seenOrdinals.has(ordinal)) {
      throw new TotemError(
        'CONFIG_INVALID',
        `authored rule (${who}) declares two positive fixtures referencing the SAME example ordinal ${ordinal} — one exemplar pair cannot serve two corpus loci (Prop 310 § Design 10)`,
        "Author a second bad/good pair in the record's `examples:` block and point the second fixture at its ordinal.",
      );
    }
    seenOrdinals.add(ordinal);
    // Looked up by the `ordinal` FIELD, not by array position: `examplePairHashes`
    // is a list of `{ordinal, hash}` records, so indexing it would silently bind a
    // fixture to the wrong pair the moment the list is ever filtered or reordered —
    // a wrong drift sensor is worse than none, because it reads as intact.
    const pairHash = ingested.parsed.examplePairHashes.find((h) => h.ordinal === ordinal);
    if (pairHash === undefined) {
      // A PRODUCER bug, not an authoring defect: `parseRuleRecord` emits one hash
      // per example. Reaching here means a hand-built `ParsedRuleRecord`, and
      // recomputing the hash to paper over it would mint a § Design 10 drift sensor
      // from a value nothing attested. Fail loud, in the incumbent idiom.
      throw new Error(
        `[Totem Error] deriveRecordFixtures: rule '${ruleId}' has no example-pair hash for ordinal ${ordinal} — the parser emits one per \`examples[i]\` (Prop 310 Amendment 1 item 3), so a missing hash means the ParsedRuleRecord was hand-built or a producer dropped it; deriving the fixture anyway would give it a drift sensor nothing computed from the record.`,
      );
    }
    return {
      pr: fixture.pr,
      filePath: fixture.filePath,
      matchedSpan: fixture.matchedSpan,
      contentHash: fixture.contentHash,
      preimageSource: {
        kind: 'record',
        ruleId,
        ordinal,
        // The parser's own per-pair hash, never recomputed here: one home for the
        // Amendment 1 item 3 basis (Tenet 20).
        pairHash: pairHash.hash,
        badExample: example.bad,
        goodExample: example.good,
      },
    };
  });
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
export function runRuleAuthor(
  totemDir: string,
  opts: {
    judgedBy: string;
    verifyOnly?: boolean;
    /**
     * ADR-112 §5.1/§8 R1 — the VERIFIED frozen split this authoring run binds to.
     * The caller (the command layer) resolves the artifact by the file's
     * content-addressed splitRef AND proves it on the shared ref
     * (spine-freeze-proof.ts) BEFORE handing it here — this git-free library
     * only enforces the binding facts. REQUIRED whenever the file's splitRef is
     * content-addressed (`split:<sha256>`); forbidden otherwise.
     */
    freezeBinding?: { artifact: FrozenSplitArtifact };
    /**
     * ADR-112 §5.2 leakage semantics (#2294 couple, operator option (a)): fixture
     * PRs the caller PROVED strictly pre-window by ancestry against the artifact's
     * `cutBoundarySha` (`verifyPreWindowFixturePrs`, spine-fixture-ancestry.ts —
     * the command layer owns the git; this library stays git-free and consumes
     * the verified result, the same seam as `freezeBinding`). Absent/empty ⇒ the
     * strict train-only behavior, byte-unchanged.
     */
    verifiedPreWindowFixturePrs?: ReadonlySet<number>;
  },
): RuleAuthorResult {
  // Normalize at the PRODUCER boundary (CR re-review): the command trims `--judged-by`, but this
  // function is exported + callable directly, so an untrimmed `' Alice '` must not bypass the
  // §3 independence guard against `author: 'Alice'`. Trim once, use everywhere downstream; a blank
  // judgedBy is rejected here, not deferred to the downstream `StructEligResult` non-empty refine.
  const judgedBy = opts.judgedBy.trim();
  if (judgedBy.length === 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      'judgedBy must name the independent eligibility check — it cannot be blank (ADR-112 §3)',
      'Pass a non-empty --judged-by (e.g. static-whitelist@cert-1).',
    );
  }
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
  assertNoReservedProducerKeys(doc, recordReferenceForm(totemDir));
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

  // ── R1 freeze binding (ADR-112 §5.1/§8): a content-addressed splitRef engages the
  //    mechanical chain; a legacy free-text splitRef stays the pre-R1 adherence-class
  //    shape (recorded, verified at materialize). The partition is total: content-
  //    addressed WITHOUT a verified artifact fails, and a commitment on a free-text
  //    ref fails (it would be an unanchored claim). ──
  const refIsContentAddressed = SPLIT_REF_RE.test(fileDoc.splitRef);
  const binding = opts.freezeBinding;
  if (refIsContentAddressed && binding === undefined) {
    throw new TotemError(
      'GATE_INVALID',
      `authored-rules.yaml declares the content-addressed splitRef ${fileDoc.splitRef} but no verified frozen split was bound — the caller must resolve + prove the artifact on the shared ref first (freeze-proof)`,
      'Run `totem rule author` (the command performs the shared-history proof), or pass a verified freezeBinding when calling runRuleAuthor programmatically.',
    );
  }
  if (!refIsContentAddressed && fileDoc.freezeCommitment !== undefined) {
    throw new TotemError(
      'GATE_INVALID',
      'authored-rules.yaml carries a freezeCommitment on a legacy free-text splitRef — a commitment binds only a content-addressed frozen artifact (ADR-112 §5.1 R1)',
      'Use the frozen artifact splitRef (`split:<sha256>`) from `totem spine freeze-split`, or drop the freezeCommitment.',
    );
  }
  if (binding !== undefined) {
    const artifact = binding.artifact;
    if (fileDoc.splitRef !== artifact.splitRef) {
      throw new TotemError(
        'GATE_INVALID',
        `authored-rules.yaml splitRef ${fileDoc.splitRef} does not match the bound frozen artifact's splitRef ${artifact.splitRef}`,
        'Author against the artifact the freeze PR landed; the ref is its content address.',
      );
    }
    if (fileDoc.freezeCommitment === undefined) {
      throw new TotemError(
        'GATE_INVALID',
        `authored-rules.yaml omits freezeCommitment — a content-addressed authoring session must declare the frozen artifact's commitment (${artifact.freezeCommitment})`,
        'Copy freezeCommitment from the frozen split artifact into the authored-rules.yaml header.',
      );
    }
    if (fileDoc.freezeCommitment !== artifact.freezeCommitment) {
      throw new TotemError(
        'GATE_INVALID',
        `authored-rules.yaml freezeCommitment ${fileDoc.freezeCommitment} does not match the frozen artifact's ${artifact.freezeCommitment} — the split was re-frozen after this header was written (t1)`,
        'Re-author under the current freeze: update the header from the live artifact and re-verify every rule.',
      );
    }
    // §5(2) flips mechanical at intake — LEAKAGE SEMANTICS (#2294 couple, operator
    // option (a) on strategy#810): a fixture PR is legal iff ∉ heldOut AND
    // (∈ train OR proven strictly pre-window by the caller's ancestry proof).
    // Held-out is checked FIRST and never overridable by the verified set (FM (c)
    // is the load-bearing condition). Previously first checked at materialize —
    // compose, never replace; the materialize gate stays.
    const train = new Set(artifact.split.trainPrs);
    const heldOut = new Set(artifact.split.heldOutPrs);
    const verifiedPreWindow = opts.verifiedPreWindowFixturePrs ?? new Set<number>();
    for (const r of fileDoc.rules) {
      // `author`/`targetDefect` are author-controlled YAML text landing in CLI-facing
      // error output — escape before interpolation (terminal injection, CR #2297).
      const who = `${sanitizeForTerminal(r.author)} · ${sanitizeForTerminal(r.targetDefect)}`;
      for (const f of r.positiveFixtures) {
        if (heldOut.has(f.pr)) {
          throw new TotemError(
            'GATE_INVALID',
            `authored rule (${who}) declares positive fixture PR #${f.pr} which is in the HELD-OUT slice — a held-out positive fixture is the ADR-112 §5(2)/FM(c) leakage violation`,
            'Anchor the fixture to a train-slice or strictly pre-window PR; held-out code is never an authoring exemplar.',
          );
        }
        if (!train.has(f.pr) && !verifiedPreWindow.has(f.pr)) {
          throw new TotemError(
            'GATE_INVALID',
            `authored rule (${who}) declares positive fixture PR #${f.pr} which is outside the window and NOT proven strictly pre-window — fixtures must be ∉ heldOut ∧ (∈ train ∨ pre-window by ancestry) (ADR-112 §5.2 leakage semantics)`,
            `Train slice of ${artifact.splitRef}: [${artifact.split.trainPrs.join(', ')}]. A pre-window anchor needs the lc clone at the command boundary (--lc-dir) so its ancestry to the cut boundary can be proven.`,
          );
        }
      }
    }
  }

  // Reject a duplicate identity WITHIN the file (codex — ambiguous which rule owns the id) +
  // enforce §3 independence: the eligibility check's `judgedBy` must never be a rule's own author
  // (codex diff-review — `--judged-by` is user-settable, so guard it at the boundary).
  const seenInFile = new Set<string>();
  for (const r of fileDoc.rules) {
    // Case-INSENSITIVE (GCA diff-review): `author: Alice` + `--judged-by alice` is the same
    // human self-judging — a case variant must not slip past the §3 independence guard. Both
    // sides are already trimmed (author at intake, judgedBy in the command).
    if (r.author.toLowerCase() === judgedBy.toLowerCase()) {
      throw new TotemError(
        'CONFIG_INVALID',
        `judgedBy '${judgedBy}' is the rule author '${r.author}' (case-insensitive) — the independent structural-eligibility check must never be the author (ADR-112 §3)`,
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
    // Prop 310 § Design 1: read + parse the referenced record FIRST — the engine the
    // whitelist judges is DERIVED from it (§ Design 3/R17), so nothing downstream can
    // run before the record is in hand. A grammar failure propagates as the parser's
    // own typed error, naming the file and the offending key path.
    const ingested = ingestRecord(totemDir, r.record);
    const declaredEngine = ingested.parsed.derivedEngine;

    // Re-run the INDEPENDENT eligibility check; the author's structuralClass is a CLAIM.
    const structuralEligibility = evaluateStructuralEligibility(
      { declaredEngine, structuralClass: r.structuralClass },
      authoredWhitelist(),
      judgedBy,
    );
    if (!structuralEligibility.decidable) {
      rejected.push({
        author: r.author,
        targetDefect: r.targetDefect,
        structuralClass: r.structuralClass,
        declaredEngine,
        reason: `no unambiguous whitelist match for (${declaredEngine}, ${r.structuralClass}) — not structurally decidable (ADR-112 §3)`,
      });
      continue;
    }

    const origin: AuthoredOrigin = r.origin ?? FROM_SCRATCH;

    // ── Identity BEFORE the material hash (Prop 310 slice 3 reorder) ──
    // The derived `preimageSource` carries the minted `ruleId` as half of the
    // § Design 10 join key, and the derived fixtures are material — so the identity
    // has to be resolved first. The DECISION is unchanged: an existing identity
    // reuses its persisted id and is judged by hash equality; only a genuinely new
    // one mints. `ruleId` is stable per identity, so putting it inside the material
    // cannot churn a rule that did not change.
    const key = identityKey(r.author, r.targetDefect);
    const existing = byIdentity.get(key);
    let ruleId: string;
    if (existing) {
      ruleId = existing.ruleId; // reuse the persisted id — NEVER re-mint an existing identity
    } else {
      ruleId = mintAuthoredRuleId(r.author, r.targetDefect, mintedIds);
      mintedIds.add(ruleId);
    }

    const positiveFixtures = deriveRecordFixtures(r, ingested, ruleId);

    // The file-level attestations are part of the revision fingerprint (greptile-P1 + CR): an
    // attestation-only change (e.g. a re-frozen split) must append a fresh row, never read `unchanged`.
    const contentHash = authoringContentHash({
      declaredEngine,
      structuralClass: r.structuralClass,
      // § Design 1: the record's BYTES are the material, its path is not — a rename
      // changes no identity and must not force a re-attestation.
      recordContentHash: ingested.contentHash,
      // The DERIVED fixtures, not the author's ordinal references: the derivation
      // carries the pair's text and its CR-blind hash, so an `examples` edit flips
      // this fingerprint through the § Design 10 drift sensor as well as through
      // the record's own content hash.
      positiveFixtures,
      negativeFixtures: r.negativeFixtures,
      origin,
      splitRef: fileDoc.splitRef,
      authoredAfterSplit: fileDoc.authoredAfterSplit,
      heldOutNonInspectionAttestation: fileDoc.heldOutNonInspectionAttestation,
      // The producer VERDICT is part of the fingerprint too (CR outside-diff): a verdict change
      // (e.g. a different `judgedBy`, or a whitelist update altering the basis) must append a fresh
      // row, not read `unchanged` and keep the stale `structuralEligibility` on the effective entry.
      structuralEligibility,
      // R1 (codex fold-2): the freeze commitment lives INSIDE the material, so a re-freeze
      // flips every downstream entry to would-revise — the (b)-leg orphaning property.
      // Absent (legacy free-text splitRef) ⇒ dropped by canonicalStringify, hash unchanged.
      ...(binding !== undefined ? { freezeCommitment: binding.artifact.freezeCommitment } : {}),
    });

    let action: PendingRule['action'];
    if (existing) {
      action = existing.contentHash === contentHash ? 'unchanged' : 'revised';
    } else {
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
          positiveFixtures,
          ...(r.negativeFixtures ? { negativeFixtures: r.negativeFixtures } : {}),
        },
        structuralEligibility,
        origin,
        declaredEngine,
        authoringLedgerRef: ruleId, // the ledger lineage for this ruleId; the latest entry is effective
        record: {
          path: ingested.path,
          contentHash: ingested.contentHash,
          parsed: ingested.parsed,
        },
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
      declaredEngine,
      splitRef: fileDoc.splitRef,
      authoredAfterSplit: fileDoc.authoredAfterSplit,
      heldOutNonInspectionAttestation: fileDoc.heldOutNonInspectionAttestation,
      structuralEligibility,
      origin,
      // § Design 1 attestation relocation: the entry records WHICH bytes were
      // ingested, so the §5 embargo proof stays content-addressed to the exact
      // record set rather than weakening to an ambient claim. `path` rides along
      // for diagnosis only — it is not in the material hash.
      record: { path: ingested.path, contentHash: ingested.contentHash },
      positiveFixturePrs: r.positiveFixtures.map((f) => f.pr),
      // No negativeFixturePrs: §6 near-misses are silence-only with no `pr` (strategy#770 +
      // Q-C ruling); only positiveFixtures are train-side-attested (§5(2)).
      // R1: the entry CARRIES the commitment it was hashed under, so the chain is
      // readable from the ledger alone (and a frozen-artifact materialize can
      // fail-loud on an absent/mismatched entry commitment).
      ...(binding !== undefined ? { freezeCommitment: binding.artifact.freezeCommitment } : {}),
      contentHash,
    };

    pending.push({ record, entry, write: action !== 'unchanged', action });
  }

  // ── verifyOnly (ADR-112 §8 no-mint precondition — strategy ruling 2026-06-30, Q1–Q4) ──
  // A cert-run re-derive (`buildAuthoredCertifyingCorpus`, always verifyOnly) is side-effect-free
  // against the authoring-ledger and asserts every current rule already has an `unchanged` recorded
  // entry: any `minted`/`revised` action fails loud BEFORE a single append (a cert run is NOT the
  // first author — Q2: revise is forbidden identically to mint; only `unchanged` passes). This is
  // the read-side sibling of D2's §8 source-flip (line 167): the cert-run re-read writes nothing.
  // Tenet-13 sensor-not-actuator ⊕ Tenet-4 fail-loud-no-drift. Gate placement = the writer itself
  // (Q1: single source of the mint/revise decision; a separate pre-check would be a second source,
  // the Tenet-20 mirror strategy#787 closed). Composes with — never replaces — the producer's step-0
  // empty-ledger and step-3 judgedBy/split gates (Q3). The authoring path leaves verifyOnly unset
  // and still mints/revises below (Q4: cert-path-only).
  if (opts.verifyOnly) {
    const wouldAuthor = pending.filter((p) => p.write);
    if (wouldAuthor.length > 0) {
      const summary = wouldAuthor.map((p) => `${p.record.ruleId} (${p.action})`).join(', ');
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: ${wouldAuthor.length} authored rule(s) would be authored ` +
          `(minted/revised) during cert-run assembly — ${summary}. A cert run consumes only ` +
          `already-recorded, unchanged ledger entries; it is NOT the first author (ADR-112 §8).`,
        'Run `totem rule author` to record/revise the rule(s) into the ledger BEFORE the cert run, ' +
          'then re-run the cert. The ledger entry must pre-exist and match the current authored YAML.',
      );
    }
  }

  // ── Pass 2 (IO): append ledger rows fail-loud (pass 1 already proved every record valid).
  //    Under verifyOnly the gate above already threw on any `p.write`, so every append here is a
  //    no-op (all `unchanged`) — the cert path writes zero rows. ──
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

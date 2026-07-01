import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { readAuthoringLedger } from '@mmnto/totem';

import { runRuleAuthor } from '../authored-rule-intake.js';

let totemDir: string;
let yamlPath: string;
beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ruleauthor-'));
  totemDir = path.join(root, '.totem');
  fs.mkdirSync(path.join(totemDir, 'spine'), { recursive: true });
  yamlPath = path.join(totemDir, 'spine', 'authored-rules.yaml');
});
afterEach(() => {
  fs.rmSync(path.dirname(totemDir), { recursive: true, force: true });
});

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
// §4 FALLBACK: a commit-pair preimageSource (land-then-fix).
const fixture = (pr: number) => ({
  pr,
  preimageSource: { kind: 'commit', preimageCommitSha: SHA_B, mergeCommitSha: SHA_A },
  filePath: 'src/x.ts',
  matchedSpan: 'L1-L2',
  contentHash: 'h'.repeat(8),
});
// §4 PRIMARY: a lesson-anchored preimageSource (review-caught) — the cert-#1 path.
const lessonFixture = (pr: number) => ({
  pr,
  preimageSource: {
    kind: 'lesson',
    lessonRef: 'a1b2c3d4e5f60718',
    badExample: 'console.log("dbg")',
    goodExample: 'logger.debug("dbg")',
  },
  filePath: 'src/x.ts',
  matchedSpan: 'L1-L2',
  contentHash: 'h'.repeat(8),
});
// §6 SILENCE-ONLY near-miss (strategy#770): one side, NO `pr`, no bad/good pair.
const nearMissFixture = () => ({
  filePath: 'src/x.ts',
  matchedSpan: 'L9',
  nearMissSource: { kind: 'lesson', example: 'logger.debug("ok")' },
});

// A rule the inert exemplar whitelist (regex, forbidden-literal-token) decides true.
const decidableRule = (over: Record<string, unknown> = {}) => ({
  author: 'alice',
  authoredAt: '2026-06-27',
  targetDefect: 'forbidden console.log in prod', // spaces → exercises the injective identity key
  declaredEngine: 'regex',
  structuralClass: 'forbidden-literal-token',
  dslSource: 'console\\.log',
  positiveFixtures: [fixture(101)],
  ...over,
});

const writeYaml = (rules: unknown[], header: Record<string, unknown> = {}) => {
  const doc = {
    splitRef: 'split-2026-06-27',
    authoredAfterSplit: true,
    heldOutNonInspectionAttestation: true,
    ...header,
    rules,
  };
  fs.writeFileSync(yamlPath, yamlStringify(doc), 'utf-8');
};

const run = () => runRuleAuthor(totemDir, { judgedBy: 'static-whitelist@test' });

describe('runRuleAuthor — FM(d) reject-loud at the reader (the trust boundary)', () => {
  it('rejects an author-injected structuralEligibility (producer field) over the REAL reader', () => {
    writeYaml([
      decidableRule({
        structuralEligibility: { decidable: true, basis: 'whitelist:x', judgedBy: 'self' },
      }),
    ]);
    expect(() => run()).toThrow(/producer-owned|invalid/i);
  });
  it('rejects each producer-owned field (decidable / ruleId / disposition / judgedBy)', () => {
    for (const bad of [
      { decidable: true },
      { ruleId: 'x'.repeat(16) },
      { disposition: 'structural' },
      { judgedBy: 'self' },
    ]) {
      writeYaml([decidableRule(bad)]);
      expect(() => run()).toThrow();
    }
  });
  it('rejects a producer-owned key NESTED inside a fixture (FM(d) at any depth — codex)', () => {
    writeYaml([
      decidableRule({
        positiveFixtures: [{ ...fixture(101), structuralEligibility: { decidable: true } }],
      }),
    ]);
    expect(() => run()).toThrow(/producer-owned key/i);
  });
  it('rejects a producer-owned key nested inside origin', () => {
    writeYaml([decidableRule({ origin: { kind: 'from-scratch', ruleId: 'x'.repeat(16) } })]);
    expect(() => run()).toThrow(/producer-owned key/i);
  });
  it('rejects a producer-owned key nested inside preimageSource (recursive scan walks the §4 union — FM(d))', () => {
    writeYaml([
      decidableRule({
        positiveFixtures: [
          {
            ...fixture(101),
            preimageSource: { ...fixture(101).preimageSource, ruleId: 'x'.repeat(16) },
          },
        ],
      }),
    ]);
    expect(() => run()).toThrow(/producer-owned key/i);
  });
});

describe('runRuleAuthor — eligibility re-run OVERWRITES the author claim', () => {
  it('a whitelisted (engine,class) produces an INDEPENDENT verdict (judgedBy = the check, not the author)', () => {
    writeYaml([decidableRule()]);
    const res = run();
    expect(res.records).toHaveLength(1);
    expect(res.records[0]?.structuralEligibility.decidable).toBe(true);
    expect(res.records[0]?.structuralEligibility.judgedBy).toBe('static-whitelist@test');
    expect(res.records[0]?.structuralEligibility.basis).toBe('whitelist:forbidden-literal-token');
  });
  it('a non-whitelisted structuralClass is REJECTED even though the author declared it', () => {
    writeYaml([decidableRule({ structuralClass: 'behavioral-smell', dslSource: 'x' })]);
    const res = run();
    expect(res.records).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.structuralClass).toBe('behavioral-smell');
  });
  it('an engine/class mismatch (class whitelisted for a different engine) is rejected', () => {
    writeYaml([decidableRule({ declaredEngine: 'regex', structuralClass: 'node-shape-presence' })]);
    expect(run().rejected).toHaveLength(1);
  });
});

describe('runRuleAuthor — upsert idempotency', () => {
  it('mints once, then a re-read is a no-op (no second ledger row)', () => {
    writeYaml([decidableRule()]);
    const first = run();
    expect(first.minted).toBe(1);
    const id = first.records[0]?.ruleId;
    const second = run();
    expect(second.minted).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.records[0]?.ruleId).toBe(id);
    expect(readAuthoringLedger(totemDir)).toHaveLength(1);
  });
  it('a dslSource edit keeps the ruleId + appends a revision', () => {
    writeYaml([decidableRule()]);
    const id = run().records[0]?.ruleId;
    writeYaml([decidableRule({ dslSource: 'console\\.error' })]);
    const res = run();
    expect(res.revised).toBe(1);
    expect(res.records[0]?.ruleId).toBe(id);
    expect(readAuthoringLedger(totemDir)).toHaveLength(2);
  });
  it('a targetDefect edit is a NEW identity (new ruleId)', () => {
    writeYaml([decidableRule()]);
    const id1 = run().records[0]?.ruleId;
    writeYaml([decidableRule({ targetDefect: 'a different defect entirely' })]);
    const res = run();
    expect(res.minted).toBe(1);
    expect(res.records[0]?.ruleId).not.toBe(id1);
  });
  it('rejects a duplicate (author,targetDefect) within one file (spaces would alias under a naive join)', () => {
    writeYaml([decidableRule(), decidableRule({ dslSource: 'other' })]);
    expect(() => run()).toThrow(/more than once/i);
  });
});

describe('runRuleAuthor — CRLF determinism', () => {
  it('a CRLF re-save of identical content causes NO spurious revision', () => {
    writeYaml([decidableRule()]);
    run();
    const lf = fs.readFileSync(yamlPath, 'utf-8');
    fs.writeFileSync(yamlPath, lf.replace(/\n/g, '\r\n'), 'utf-8');
    const res = run();
    expect(res.unchanged).toBe(1);
    expect(res.revised).toBe(0);
    expect(readAuthoringLedger(totemDir)).toHaveLength(1);
  });
});

describe('runRuleAuthor — fail-loud IO', () => {
  it('missing authored-rules.yaml throws (not found)', () => {
    expect(() => run()).toThrow(/not found/i);
  });
  it('invalid YAML throws on the YAML-parse path (not a coincidental throw)', () => {
    fs.writeFileSync(yamlPath, 'splitRef: [unclosed\n', 'utf-8');
    expect(() => run()).toThrow(/not valid YAML/i);
  });
});

describe('runRuleAuthor — codex/agy diff-review folds', () => {
  it('the ledger binds positive fixture PRs only; a silence-only negative near-miss carries no PR (strategy#770)', () => {
    // §6 negatives are SILENCE-ONLY with no `pr` — a synthetic near-miss has no corpus
    // position, so the §5(2) train-side PR attestation enumerates positives only (Q-C ruling).
    // The reader still ACCEPTS the declared near-miss (it feeds §6 controls.negative[] in C2b).
    writeYaml([decidableRule({ negativeFixtures: [nearMissFixture()] })]);
    run();
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger[0]?.positiveFixturePrs).toEqual([101]);
    expect(ledger[0]).not.toHaveProperty('negativeFixturePrs');
  });
  it('authors a lesson-anchored (PRIMARY, review-caught) positive fixture end-to-end (§4 cert-#1 path)', () => {
    writeYaml([decidableRule({ positiveFixtures: [lessonFixture(101)] })]);
    const res = run();
    expect(res.minted).toBe(1);
    const src = res.records[0]?.provenance.positiveFixtures[0]?.preimageSource;
    expect(src?.kind).toBe('lesson');
    if (src?.kind === 'lesson') expect(src.lessonRef).toBe('a1b2c3d4e5f60718');
  });
  it('a revision appends a row carrying the NEW contentHash under the SAME ruleId (agy)', () => {
    writeYaml([decidableRule()]);
    run();
    const before = readAuthoringLedger(totemDir)[0]?.contentHash;
    writeYaml([decidableRule({ dslSource: 'console\\.error' })]);
    run();
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.contentHash).not.toBe(before);
    expect(ledger[1]?.ruleId).toBe(ledger[0]?.ruleId);
  });
  it('two distinct decidable rules in one file → 2 records, 2 rows, distinct ids', () => {
    writeYaml([
      decidableRule(),
      decidableRule({ targetDefect: 'another defect', dslSource: 'TODO' }),
    ]);
    const res = run();
    expect(res.minted).toBe(2);
    expect(res.records).toHaveLength(2);
    expect(new Set(res.records.map((r) => r.ruleId)).size).toBe(2);
    expect(readAuthoringLedger(totemDir)).toHaveLength(2);
  });
  it('rejects judgedBy equal to a rule author (§3 independence — codex)', () => {
    writeYaml([decidableRule({ author: 'mallory' })]);
    expect(() => runRuleAuthor(totemDir, { judgedBy: 'mallory' })).toThrow(/never be the author/i);
  });
  it('an attestation-only edit (splitRef change) triggers a revision, not unchanged (greptile-P1/CR)', () => {
    writeYaml([decidableRule()]); // splitRef default 'split-2026-06-27'
    run();
    // same rule material, only the file-level split attestation changes:
    writeYaml([decidableRule()], { splitRef: 'split-2026-07-01' });
    const res = run();
    expect(res.revised).toBe(1);
    expect(res.unchanged).toBe(0);
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.splitRef).toBe('split-2026-07-01'); // the new row records the new split (no longer stale)
  });
  it('rejects judgedBy equal to a rule author CASE-INSENSITIVELY (GCA re-review)', () => {
    writeYaml([decidableRule({ author: 'Alice' })]);
    expect(() => runRuleAuthor(totemDir, { judgedBy: 'alice' })).toThrow(/never be the author/i);
  });
  it('normalizes judgedBy (trim) at the producer boundary so " alice " cannot bypass (CR re-review)', () => {
    writeYaml([decidableRule({ author: 'Alice' })]);
    expect(() => runRuleAuthor(totemDir, { judgedBy: '  alice  ' })).toThrow(
      /never be the author/i,
    );
  });
  it('rejects a blank judgedBy at the producer boundary (CR re-review)', () => {
    writeYaml([decidableRule()]);
    expect(() => runRuleAuthor(totemDir, { judgedBy: '   ' })).toThrow(/cannot be blank/i);
  });
  it('trims splitRef so a whitespace variant is NOT a spurious revision (GCA re-review)', () => {
    writeYaml([decidableRule()], { splitRef: 'split-x' });
    run();
    writeYaml([decidableRule()], { splitRef: '  split-x  ' });
    const res = run();
    expect(res.unchanged).toBe(1);
    expect(res.revised).toBe(0);
    expect(readAuthoringLedger(totemDir)).toHaveLength(1);
  });
  it('a producer-verdict change (judgedBy) triggers a revision (CR outside-diff)', () => {
    writeYaml([decidableRule()]);
    runRuleAuthor(totemDir, { judgedBy: 'check-a' });
    const res = runRuleAuthor(totemDir, { judgedBy: 'check-b' });
    expect(res.revised).toBe(1);
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.structuralEligibility.judgedBy).toBe('check-b');
  });
});

describe('runRuleAuthor — verifyOnly no-mint precondition (ADR-112 §8, strategy ruling Q1–Q4)', () => {
  const JUDGED_BY = 'static-whitelist@test';
  const verify = () => runRuleAuthor(totemDir, { judgedBy: JUDGED_BY, verifyOnly: true });
  const snapshot = () => JSON.stringify(readAuthoringLedger(totemDir));

  it('a re-derive of an UNCHANGED ledger passes read-only: records returned, ZERO rows appended', () => {
    writeYaml([decidableRule()]);
    const id = run().records[0]?.ruleId; // author first (cert run is NOT the first author)
    const before = snapshot();
    const res = verify();
    expect(res.unchanged).toBe(1);
    expect(res.minted).toBe(0);
    expect(res.revised).toBe(0);
    expect(res.records[0]?.ruleId).toBe(id);
    expect(snapshot()).toBe(before); // side-effect-free against the authoring-ledger (Tenet-13)
  });

  it('a would-MINT rule (no prior ledger entry) fails loud BEFORE any write; ledger stays empty (Q2 minted)', () => {
    writeYaml([decidableRule()]);
    expect(readAuthoringLedger(totemDir)).toHaveLength(0); // nothing authored yet
    expect(verify).toThrow(/NOT the first author/i);
    expect(verify).toThrow(/\(minted\)/); // the action is named explicitly
    expect(readAuthoringLedger(totemDir)).toHaveLength(0); // zero writes on the throw (no drift, Tenet-4)
  });

  it('a would-REVISE rule (dslSource edit since authoring) fails loud identically to mint; ledger unmutated (Q2 revised)', () => {
    writeYaml([decidableRule()]);
    run(); // author the original
    const before = snapshot();
    writeYaml([decidableRule({ dslSource: 'console\\.error' })]); // YAML diverged from the recorded entry
    expect(verify).toThrow(/\(revised\)/); // revise is forbidden identically to mint (Q2)
    expect(snapshot()).toBe(before); // no revision row appended (read-only)
  });

  it('a mixed run (one unchanged + one new) fails loud on the new rule and writes NOTHING (no partial append)', () => {
    writeYaml([decidableRule()]);
    run(); // author rule #1
    const before = snapshot();
    writeYaml([
      decidableRule(),
      decidableRule({ targetDefect: 'another defect', dslSource: 'TODO' }),
    ]);
    expect(verify).toThrow(/NOT the first author/i);
    expect(snapshot()).toBe(before); // the unchanged rule did not mask the new one; zero writes overall
  });

  it('verifyOnly defaults off — the authoring path (totem rule author) still mints (Q4: cert-path-only)', () => {
    writeYaml([decidableRule()]);
    const res = runRuleAuthor(totemDir, { judgedBy: JUDGED_BY }); // no verifyOnly → writer
    expect(res.minted).toBe(1);
    expect(readAuthoringLedger(totemDir)).toHaveLength(1);
  });
});

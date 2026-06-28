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
const fixture = (pr: number) => ({
  pr,
  mergeCommitSha: SHA_A,
  preimageCommitSha: SHA_B,
  filePath: 'src/x.ts',
  matchedSpan: 'L1-L2',
  contentHash: 'h'.repeat(8),
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
  it('the ledger binds BOTH positive AND negative fixture PRs (codex)', () => {
    writeYaml([decidableRule({ negativeFixtures: [fixture(202)] })]);
    run();
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger[0]?.positiveFixturePrs).toEqual([101]);
    expect(ledger[0]?.negativeFixturePrs).toEqual([202]);
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
});

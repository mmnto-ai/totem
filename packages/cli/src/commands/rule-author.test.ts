import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import {
  readAuthoringLedger,
  RuleRecordNoSilentSkipError,
  RuleRecordParseError,
} from '@mmnto/totem';

import { runRuleAuthor } from '../authored-rule-intake.js';

let root: string;
let totemDir: string;
let yamlPath: string;
let rulesDir: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ruleauthor-'));
  totemDir = path.join(root, '.totem');
  rulesDir = path.join(totemDir, 'rules');
  fs.mkdirSync(path.join(totemDir, 'spine'), { recursive: true });
  fs.mkdirSync(rulesDir, { recursive: true });
  yamlPath = path.join(totemDir, 'spine', 'authored-rules.yaml');
  writeRecord(DEFAULT_RECORD_SLUG);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ── Prop 310 § Design 1 — the record carrier the envelope references ──────────
//
// The rule half now lives in `.totem/rules/<slug>.rule.yaml`. Every assertion in
// this file is the one it always made; only the CARRIER moved (OQ-1 records-only).
// The whitelist row exercised is the shipped `(regex, forbidden-literal-token)`
// exemplar, so the record declares `target.type: regex` and the intake DERIVES
// that engine — the envelope never states it.

const DEFAULT_RECORD_SLUG = 'no-console-log';

/** The default record body: a regex rule with ONE example pair at ordinal 0. */
const recordBody = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  severity: 'warning',
  message: 'console.log is banned in production code.',
  target: {
    type: 'regex',
    pattern: 'console\\.log',
    scope: { fileGlobs: ['src/**/*.ts'] },
  },
  examples: [{ bad: 'console.log("dbg")', good: 'logger.debug("dbg")' }],
  ...over,
});

/** Write a record file and return the repo-relative reference the envelope uses. */
function writeRecord(
  slug: string,
  body: Record<string, unknown> = recordBody(),
  opts: { crlf?: boolean } = {},
): string {
  const text = yamlStringify(body);
  fs.writeFileSync(
    path.join(rulesDir, `${slug}.rule.yaml`),
    opts.crlf === true ? text.replace(/\n/g, '\r\n') : text,
    'utf-8',
  );
  return recordRef(slug);
}

const recordRef = (slug: string): string => `.totem/rules/${slug}.rule.yaml`;

/** The § Design 10 fixture: the ADR-112 §6 corpus anchor + an `examples[i]` ordinal reference. */
const fixture = (pr: number, example = 0) => ({
  pr,
  filePath: 'src/x.ts',
  matchedSpan: 'L1-L2',
  contentHash: 'h'.repeat(8),
  example,
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
  structuralClass: 'forbidden-literal-token',
  record: recordRef(DEFAULT_RECORD_SLUG),
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
  it('rejects a producer-owned key nested inside a NEGATIVE fixture too (the scan walks every depth)', () => {
    writeYaml([
      decidableRule({
        negativeFixtures: [{ ...nearMissFixture(), routing: 'rag-only' }],
      }),
    ]);
    expect(() => run()).toThrow(/producer-owned key/i);
  });
});

// ── Prop 310 § Design 1 (OQ-1 records-only) — the migration rejections ────────

describe('runRuleAuthor — the pre-slice-3 carrier keys are rejected BY NAME', () => {
  const RECORD_FORM = /\.totem\/rules\/<slug>\.rule\.yaml/;

  it('rejects an inline dslSource, naming the key, the JSON path, and the record form', () => {
    writeYaml([decidableRule({ dslSource: 'console\\.log' })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as Error).message;
    expect(message).toContain("carries 'dslSource'");
    expect(message).toContain('<root>.rules[0].dslSource');
    expect(message).toMatch(/rules\/<slug>\.rule\.yaml/);
    expect((thrown as { code?: string }).code).toBe('CONFIG_INVALID');
    // The recovery hint carries the record form too — the message says WHAT is
    // wrong, the hint says where the value goes.
    expect((thrown as { recoveryHint?: string }).recoveryHint).toMatch(RECORD_FORM);
  });

  it('rejects an inline declaredEngine — the engine is DERIVED from the record’s target.type', () => {
    writeYaml([decidableRule({ declaredEngine: 'regex' })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as Error).message;
    expect(message).toContain("carries 'declaredEngine'");
    expect(message).toContain('<root>.rules[0].declaredEngine');
    expect(message).toMatch(/rules\/<slug>\.rule\.yaml/);
    expect((thrown as { code?: string }).code).toBe('CONFIG_INVALID');
  });

  it('rejects an inline fixture preimageSource AT DEPTH — the envelope side is derived', () => {
    writeYaml([
      decidableRule({
        positiveFixtures: [
          {
            ...fixture(101),
            preimageSource: {
              kind: 'lesson',
              lessonRef: 'a1b2c3d4e5f60718',
              badExample: 'console.log("dbg")',
              goodExample: 'logger.debug("dbg")',
            },
          },
        ],
      }),
    ]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as Error).message;
    expect(message).toContain("carries 'preimageSource'");
    // The JSON path names the DEPTH, which is the whole point of the recursive
    // scan: Zod `.strict()` is not recursive and would have stripped it.
    expect(message).toContain('<root>.rules[0].positiveFixtures[0].preimageSource');
    expect(message).toMatch(/rules\/<slug>\.rule\.yaml/);
    expect((thrown as { code?: string }).code).toBe('CONFIG_INVALID');
  });

  it('rejects, never STRIPS — a migrated key does not silently vanish into a successful run', () => {
    writeYaml([decidableRule({ dslSource: 'console\\.log' })]);
    expect(() => run()).toThrow();
    // Nothing was authored: the reject happens before pass 1 constructs anything.
    expect(readAuthoringLedger(totemDir)).toHaveLength(0);
  });
});

// ── Prop 310 § Design 1 — the `record:` reference's own shape rules ───────────

describe('runRuleAuthor — record reference resolution', () => {
  it('rejects a reference that does not end in .rule.yaml', () => {
    fs.writeFileSync(path.join(rulesDir, 'thing.yaml'), yamlStringify(recordBody()), 'utf-8');
    writeYaml([decidableRule({ record: '.totem/rules/thing.yaml' })]);
    expect(() => run()).toThrow(/does not end in '\.rule\.yaml'/);
  });

  it('rejects a reference containing a `..` segment', () => {
    writeYaml([decidableRule({ record: '.totem/rules/../rules/no-console-log.rule.yaml' })]);
    expect(() => run()).toThrow(/contains a '\.\.' segment/);
  });

  it('rejects a reference resolving OUTSIDE <totemDir>/rules/', () => {
    fs.writeFileSync(path.join(totemDir, 'stray.rule.yaml'), yamlStringify(recordBody()), 'utf-8');
    writeYaml([decidableRule({ record: '.totem/stray.rule.yaml' })]);
    expect(() => run()).toThrow(/does not resolve inside/);
  });

  it('CONFIG_MISSING (not CONFIG_INVALID) when the referenced record does not exist', () => {
    writeYaml([decidableRule({ record: recordRef('never-written') })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string }).code).toBe('CONFIG_MISSING');
    expect((thrown as Error).message).toMatch(/rule record not found/);
    expect((thrown as Error).message).toContain('never-written.rule.yaml');
  });

  it('propagates a RuleRecordParseError UNWRAPPED — file + key path intact, never a generic reject', () => {
    writeRecord('broken', recordBody({ severity: 'critical' }));
    writeYaml([decidableRule({ record: recordRef('broken') })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RuleRecordParseError);
    expect((thrown as RuleRecordParseError).filePath).toBe(recordRef('broken'));
    expect((thrown as RuleRecordParseError).keyPath).toBe('severity');
  });

  it('propagates the § Design 2 no-silent-skip subclass unwrapped too (unknown schemaVersion)', () => {
    writeRecord('v2', recordBody({ schemaVersion: 2 }));
    writeYaml([decidableRule({ record: recordRef('v2') })]);
    expect(() => run()).toThrow(RuleRecordNoSilentSkipError);
  });
});

// ── Prop 310 § Design 10 — the derived preimage envelope ─────────────────────

describe('runRuleAuthor — examples ⇄ fixture derivation', () => {
  it('derives preimageSource from `examples[ordinal]` under the (ruleId, ordinal) key', () => {
    writeYaml([decidableRule()]);
    const res = run();
    const record = res.records[0]!;
    const src = record.provenance.positiveFixtures[0]!.preimageSource;
    expect(src.kind).toBe('record');
    if (src.kind !== 'record') throw new Error('unreachable');
    expect(src.ruleId).toBe(record.ruleId);
    expect(src.ordinal).toBe(0);
    expect(src.badExample).toBe('console.log("dbg")');
    expect(src.goodExample).toBe('logger.debug("dbg")');
    expect(src.pairHash).toBe(record.record.parsed.examplePairHashes[0]!.hash);
    // The join key carries the REAL minted id, not a placeholder — the derivation
    // runs after the mint for exactly this reason.
    expect(src.ruleId).toMatch(/^[0-9a-f]{16}(?:-[1-9]\d*)?$/);
  });

  it('resolves ordinal 1 to EXACTLY examples[1], never a re-pair', () => {
    writeRecord(
      'two-pairs',
      recordBody({
        examples: [
          { bad: 'console.log("a")', good: 'logger.debug("a")' },
          { bad: 'console.log("b")', good: 'logger.debug("b")' },
        ],
      }),
    );
    writeYaml([
      decidableRule({
        record: recordRef('two-pairs'),
        positiveFixtures: [fixture(101, 1), fixture(102, 0)],
      }),
    ]);
    const sources = run().records[0]!.provenance.positiveFixtures.map((f) => f.preimageSource);
    expect(sources.map((s) => (s.kind === 'record' ? [s.ordinal, s.badExample] : null))).toEqual([
      [1, 'console.log("b")'],
      [0, 'console.log("a")'],
    ]);
  });

  it('fails loud on a DANGLING ordinal, naming the rule, the ordinal, and the count', () => {
    writeYaml([decidableRule({ positiveFixtures: [fixture(101, 3)] })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as Error).message;
    expect((thrown as { code?: string }).code).toBe('CONFIG_INVALID');
    expect(message).toContain('example ordinal 3');
    expect(message).toContain('1 example pair(s)');
    expect(message).toContain('alice');
    expect(message).toContain('forbidden console.log in prod');
    expect(message).toContain('DANGLING');
  });

  it('fails loud on a DUPLICATE ordinal across two fixtures of one entry (OQ-2 reject)', () => {
    writeYaml([decidableRule({ positiveFixtures: [fixture(101, 0), fixture(102, 0)] })]);
    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }
    const message = (thrown as Error).message;
    expect((thrown as { code?: string }).code).toBe('CONFIG_INVALID');
    expect(message).toContain('SAME example ordinal 0');
    expect(message).toContain('alice');
    expect(message).toContain('forbidden console.log in prod');
  });

  it('accepts two fixtures naming DISTINCT ordinals — the reject is duplication, not multiplicity', () => {
    writeRecord(
      'two-pairs',
      recordBody({
        examples: [
          { bad: 'console.log("a")', good: 'logger.debug("a")' },
          { bad: 'console.log("b")', good: 'logger.debug("b")' },
        ],
      }),
    );
    writeYaml([
      decidableRule({
        record: recordRef('two-pairs'),
        positiveFixtures: [fixture(101, 0), fixture(102, 1)],
      }),
    ]);
    expect(run().records[0]!.provenance.positiveFixtures).toHaveLength(2);
  });

  it('drops the envelope-side `example` reference from the DERIVED fixture (one home for the ordinal)', () => {
    writeYaml([decidableRule()]);
    const derived = run().records[0]!.provenance.positiveFixtures[0]!;
    expect('example' in derived).toBe(false);
    // …while the ADR-112 §6 corpus anchor rides through untouched.
    expect(derived.pr).toBe(101);
    expect(derived.filePath).toBe('src/x.ts');
    expect(derived.matchedSpan).toBe('L1-L2');
    expect(derived.contentHash).toBe('h'.repeat(8));
  });
});

// ── Prop 310 § Design 1/§ Design 3 — the derived engine + record binding ──────

describe('runRuleAuthor — the engine is derived, the record is content-addressed', () => {
  it('derives declaredEngine from the record’s target.type, never from the envelope', () => {
    writeYaml([decidableRule()]);
    const res = run();
    expect(res.records[0]?.declaredEngine).toBe('regex');
    expect(res.records[0]?.record.parsed.derivedEngine).toBe('regex');
    expect(readAuthoringLedger(totemDir)[0]?.declaredEngine).toBe('regex');
  });

  it('judges the whitelist on the DERIVED engine — an ast-grep record fails the regex-only class', () => {
    // `(regex, forbidden-literal-token)` is whitelisted; `(ast-grep, …)` is not.
    // The author cannot state the engine, so the record's own `target.type` decides.
    writeRecord(
      'ast-grep-rule',
      recordBody({
        target: {
          type: 'ast-grep',
          language: 'typescript',
          pattern: 'console.log($MSG)',
          scope: { fileGlobs: ['src/**/*.ts'] },
        },
      }),
    );
    writeYaml([decidableRule({ record: recordRef('ast-grep-rule') })]);
    const res = run();
    expect(res.records).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.declaredEngine).toBe('ast-grep');
    expect(res.rejected[0]?.reason).toContain('(ast-grep, forbidden-literal-token)');
  });

  it('an ast-grep record IS decided when its class is whitelisted for that engine', () => {
    writeRecord(
      'ast-grep-rule',
      recordBody({
        target: {
          type: 'ast-grep',
          language: 'typescript',
          pattern: 'console.log($MSG)',
          scope: { fileGlobs: ['src/**/*.ts'] },
        },
      }),
    );
    writeYaml([
      decidableRule({ record: recordRef('ast-grep-rule'), structuralClass: 'node-shape-presence' }),
    ]);
    const res = run();
    expect(res.rejected).toHaveLength(0);
    expect(res.records[0]?.declaredEngine).toBe('ast-grep');
    expect(res.records[0]?.structuralEligibility.basis).toBe('whitelist:node-shape-presence');
  });

  it('binds the ledger entry to the exact ingested BYTES (sha256 of the LF image)', () => {
    writeYaml([decidableRule()]);
    run();
    const entry = readAuthoringLedger(totemDir)[0]!;
    const bytes = fs.readFileSync(path.join(rulesDir, `${DEFAULT_RECORD_SLUG}.rule.yaml`), 'utf-8');
    const expected = createHash('sha256').update(bytes.replace(/\r\n/g, '\n')).digest('hex');
    expect(entry.record?.contentHash).toBe(expected);
    expect(entry.record?.path).toBe(recordRef(DEFAULT_RECORD_SLUG));
  });

  it('CRLF twin: identical preimage bytes, identical pairHash, identical ledger contentHash', () => {
    // The NOQ-1 P3 `serialization-admit` class: the LF admit hop is what everything
    // downstream sees, so a Windows-authored record is byte-for-byte the same rule.
    writeYaml([decidableRule()]);
    const lfRun = run();
    const lfEntry = readAuthoringLedger(totemDir)[0]!;

    writeRecord(DEFAULT_RECORD_SLUG, recordBody(), { crlf: true });
    const crlfRun = run();
    const crlfSrc = crlfRun.records[0]!.provenance.positiveFixtures[0]!.preimageSource;
    const lfSrc = lfRun.records[0]!.provenance.positiveFixtures[0]!.preimageSource;
    expect(crlfSrc).toEqual(lfSrc);
    expect(crlfRun.records[0]!.record.contentHash).toBe(lfRun.records[0]!.record.contentHash);
    // …so the ledger reads UNCHANGED and appends no spurious revision row.
    expect(crlfRun.unchanged).toBe(1);
    expect(crlfRun.revised).toBe(0);
    expect(readAuthoringLedger(totemDir)).toEqual([lfEntry]);
  });

  it('RENAME twin: identical contentHash (path is not material) but a different recorded path', () => {
    writeYaml([decidableRule()]);
    const first = run();
    const firstEntry = readAuthoringLedger(totemDir)[0]!;

    // Same bytes at a different path. § Design 1: renaming a record changes no
    // identity, so the material hash must not move — only the informational path.
    writeRecord('renamed');
    writeYaml([decidableRule({ record: recordRef('renamed') })]);
    const second = run();
    expect(second.records[0]!.record.contentHash).toBe(first.records[0]!.record.contentHash);
    expect(second.records[0]!.record.path).toBe(recordRef('renamed'));
    expect(second.records[0]!.ruleId).toBe(first.records[0]!.ruleId);
    // The material excludes the path ⇒ no revision row is appended for the rename.
    expect(second.unchanged).toBe(1);
    expect(second.revised).toBe(0);
    expect(readAuthoringLedger(totemDir)).toEqual([firstEntry]);
  });

  it('an EXAMPLES edit flips the ledger contentHash → `revised` (the § Design 10 drift sensor)', () => {
    writeYaml([decidableRule()]);
    run();
    const before = readAuthoringLedger(totemDir)[0]!.contentHash;
    writeRecord(
      DEFAULT_RECORD_SLUG,
      recordBody({ examples: [{ bad: 'console.log("EDITED")', good: 'logger.debug("dbg")' }] }),
    );
    const res = run();
    expect(res.revised).toBe(1);
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]!.contentHash).not.toBe(before);
    expect(ledger[1]!.ruleId).toBe(ledger[0]!.ruleId);
  });

  it('the cert path’s verifyOnly REFUSES a record edited since its ledger entry', () => {
    writeYaml([decidableRule()]);
    run();
    writeRecord(
      DEFAULT_RECORD_SLUG,
      recordBody({ examples: [{ bad: 'console.log("EDITED")', good: 'logger.debug("dbg")' }] }),
    );
    expect(() =>
      runRuleAuthor(totemDir, { judgedBy: 'static-whitelist@test', verifyOnly: true }),
    ).toThrow(/\(revised\)/);
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
    writeYaml([decidableRule({ structuralClass: 'behavioral-smell' })]);
    const res = run();
    expect(res.records).toHaveLength(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.structuralClass).toBe('behavioral-smell');
  });
  it('an engine/class mismatch (class whitelisted for a different engine) is rejected', () => {
    // The record derives `regex`; `node-shape-presence` is whitelisted for ast-grep only.
    writeYaml([decidableRule({ structuralClass: 'node-shape-presence' })]);
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
  it('a matcher edit IN THE RECORD keeps the ruleId + appends a revision', () => {
    writeYaml([decidableRule()]);
    const id = run().records[0]?.ruleId;
    writeRecord(
      DEFAULT_RECORD_SLUG,
      recordBody({
        target: {
          type: 'regex',
          pattern: 'console\\.error',
          scope: { fileGlobs: ['src/**/*.ts'] },
        },
      }),
    );
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
    writeRecord('other');
    writeYaml([decidableRule(), decidableRule({ record: recordRef('other') })]);
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
  it('authors a RECORD-derived positive fixture end-to-end (§4 cert-#1 path, Prop 310 § Design 10)', () => {
    // Was a hand-written lesson-anchored fixture; Amendment 1 makes the record's
    // `examples` block the editable home, so the envelope side is derived instead.
    writeYaml([decidableRule()]);
    const res = run();
    expect(res.minted).toBe(1);
    const src = res.records[0]?.provenance.positiveFixtures[0]?.preimageSource;
    expect(src?.kind).toBe('record');
    if (src?.kind === 'record') expect(src.ruleId).toBe(res.records[0]?.ruleId);
  });
  it('a revision appends a row carrying the NEW contentHash under the SAME ruleId (agy)', () => {
    writeYaml([decidableRule()]);
    run();
    const before = readAuthoringLedger(totemDir)[0]?.contentHash;
    writeRecord(
      DEFAULT_RECORD_SLUG,
      recordBody({
        target: {
          type: 'regex',
          pattern: 'console\\.error',
          scope: { fileGlobs: ['src/**/*.ts'] },
        },
      }),
    );
    run();
    const ledger = readAuthoringLedger(totemDir);
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.contentHash).not.toBe(before);
    expect(ledger[1]?.ruleId).toBe(ledger[0]?.ruleId);
  });
  it('two distinct decidable rules in one file → 2 records, 2 rows, distinct ids', () => {
    writeYaml([decidableRule(), decidableRule({ targetDefect: 'another defect' })]);
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

  it('a would-REVISE rule (record edited since authoring) fails loud identically to mint; ledger unmutated (Q2 revised)', () => {
    writeYaml([decidableRule()]);
    run(); // author the original
    const before = snapshot();
    // The RECORD diverged from the bytes the recorded entry attested.
    writeRecord(
      DEFAULT_RECORD_SLUG,
      recordBody({
        target: {
          type: 'regex',
          pattern: 'console\\.error',
          scope: { fileGlobs: ['src/**/*.ts'] },
        },
      }),
    );
    expect(verify).toThrow(/\(revised\)/); // revise is forbidden identically to mint (Q2)
    expect(snapshot()).toBe(before); // no revision row appended (read-only)
  });

  it('a mixed run (one unchanged + one new) fails loud on the new rule and writes NOTHING (no partial append)', () => {
    writeYaml([decidableRule()]);
    run(); // author rule #1
    const before = snapshot();
    writeYaml([decidableRule(), decidableRule({ targetDefect: 'another defect' })]);
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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendAuthoringLedgerEntry,
  AUTHORING_LEDGER_DIR,
  AUTHORING_LEDGER_FILE,
  authoringContentHash,
  type AuthoringLedgerEntry,
  buildAuthoredIdentityIndex,
  identityKey,
  readAuthoringLedger,
} from './authoring-ledger.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-authledger-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const baseEntry = (over: Partial<AuthoringLedgerEntry> = {}): AuthoringLedgerEntry => ({
  ruleId: 'a'.repeat(16),
  author: 'alice',
  targetDefect: 'off by one in pagination',
  authoredAt: '2026-06-27',
  declaredEngine: 'regex',
  splitRef: 'split-2026-06-27',
  authoredAfterSplit: true,
  heldOutNonInspectionAttestation: true,
  structuralEligibility: {
    decidable: true,
    basis: 'whitelist:forbidden-literal-token',
    judgedBy: 'static-whitelist@cert-1',
  },
  origin: { kind: 'from-scratch' },
  positiveFixturePrs: [101],
  contentHash: 'deadbeef',
  ...over,
});

describe('identityKey (ADR-112 §8 — injective, matches the mint seed; strategy seam finding)', () => {
  it('does NOT alias distinct identities when a free-text field contains a space', () => {
    // The #2259 aliasing class: a `${author} ${targetDefect}` join would collapse these
    // two genuinely-distinct identities onto one key. JSON.stringify keeps them distinct.
    expect(identityKey('alice', 'off by one')).not.toBe(identityKey('alice off', 'by one'));
    expect(identityKey('a', 'b c')).not.toBe(identityKey('a b', 'c'));
  });
  it('is stable for identical inputs', () => {
    expect(identityKey('alice', 'x')).toBe(identityKey('alice', 'x'));
  });
});

describe('buildAuthoredIdentityIndex', () => {
  it('does NOT falsely throw when space-aliasing identities own distinct ruleIds', () => {
    const entries = [
      baseEntry({ author: 'alice', targetDefect: 'off by one', ruleId: 'a'.repeat(16) }),
      baseEntry({ author: 'alice off', targetDefect: 'by one', ruleId: 'b'.repeat(16) }),
    ];
    const { byIdentity, allRuleIds } = buildAuthoredIdentityIndex(entries);
    expect(byIdentity.size).toBe(2);
    expect(allRuleIds.size).toBe(2);
  });
  it('keeps the LATEST revision per identity (append order wins)', () => {
    const entries = [baseEntry({ contentHash: 'v1' }), baseEntry({ contentHash: 'v2' })];
    const { byIdentity } = buildAuthoredIdentityIndex(entries);
    expect(byIdentity.get(identityKey('alice', 'off by one in pagination'))?.contentHash).toBe(
      'v2',
    );
  });
  it('fail-loud when one identity maps to two ruleIds (ledger corruption)', () => {
    const entries = [baseEntry({ ruleId: 'a'.repeat(16) }), baseEntry({ ruleId: 'c'.repeat(16) })];
    expect(() => buildAuthoredIdentityIndex(entries)).toThrow(/two ruleIds/i);
  });
  it('fail-loud when one ruleId maps to two distinct identities (the reverse — codex diff-review)', () => {
    const entries = [
      baseEntry({ author: 'alice', targetDefect: 'defect-x', ruleId: 'a'.repeat(16) }),
      baseEntry({ author: 'bob', targetDefect: 'defect-y', ruleId: 'a'.repeat(16) }),
    ];
    expect(() => buildAuthoredIdentityIndex(entries)).toThrow(/two distinct identities/i);
  });
});

describe('authoring-ledger fail-loud round-trip (FM(e))', () => {
  it('appends + reads back an entry verbatim', () => {
    appendAuthoringLedgerEntry(dir, baseEntry());
    const back = readAuthoringLedger(dir);
    expect(back).toHaveLength(1);
    expect(back[0]?.ruleId).toBe('a'.repeat(16));
  });
  it('READS a legacy row carrying negativeFixturePrs (pre-#770) without throwing — tolerated, never written (greptile-P1/CR)', () => {
    // `totem rule author` <=1.81.1 persisted negativeFixturePrs on every row; runRuleAuthor
    // re-reads the full ledger before writing, so the strict reader must parse those rows on
    // upgrade rather than throw. The field is read-tolerated (optional), never re-written.
    const file = path.join(dir, AUTHORING_LEDGER_DIR, AUTHORING_LEDGER_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const legacyRow = { ...baseEntry(), negativeFixturePrs: [202] };
    fs.writeFileSync(file, JSON.stringify(legacyRow) + '\n', 'utf-8');
    const back = readAuthoringLedger(dir);
    expect(back).toHaveLength(1);
    expect(back[0]?.ruleId).toBe('a'.repeat(16));
    expect(back[0]?.negativeFixturePrs).toEqual([202]);
  });
  it('returns [] when the ledger does not exist yet', () => {
    expect(readAuthoringLedger(dir)).toEqual([]);
  });
  it('fail-loud on a malformed ledger line (never silently skipped)', () => {
    const file = path.join(dir, AUTHORING_LEDGER_DIR, AUTHORING_LEDGER_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not valid json\n', 'utf-8');
    expect(() => readAuthoringLedger(dir)).toThrow();
  });
  it('fail-loud (schema) on an incomplete entry — never reaches disk silently', () => {
    expect(() =>
      appendAuthoringLedgerEntry(dir, { ruleId: 'x' } as unknown as AuthoringLedgerEntry),
    ).toThrow();
  });
});

describe('authoringContentHash (§8 revision detection — material-only)', () => {
  const material = {
    declaredEngine: 'regex',
    structuralClass: 'forbidden-literal-token',
    dslSource: 'TODO',
    positiveFixtures: [{ pr: 1 }],
    origin: { kind: 'from-scratch' as const },
    splitRef: 'split-2026-06-27',
    authoredAfterSplit: true as const,
    heldOutNonInspectionAttestation: true as const,
    structuralEligibility: {
      decidable: true,
      basis: 'whitelist:forbidden-literal-token',
      judgedBy: 'static-whitelist@cert-1',
    },
  };
  it('is deterministic for identical material', () => {
    expect(authoringContentHash(material)).toBe(authoringContentHash({ ...material }));
  });
  it('changes when the matcher changes (a revision)', () => {
    expect(authoringContentHash(material)).not.toBe(
      authoringContentHash({ ...material, dslSource: 'FIXME' }),
    );
  });
  it('changes when an attestation changes (splitRef) — greptile-P1/CR diff-review', () => {
    expect(authoringContentHash(material)).not.toBe(
      authoringContentHash({ ...material, splitRef: 'split-other' }),
    );
  });
  it('changes when the producer verdict changes (judgedBy) — CR outside-diff', () => {
    expect(authoringContentHash(material)).not.toBe(
      authoringContentHash({
        ...material,
        structuralEligibility: { ...material.structuralEligibility, judgedBy: 'other-check' },
      }),
    );
  });
  it('R1: an ABSENT freezeCommitment hashes byte-identically to the pre-R1 material (additive)', () => {
    expect(authoringContentHash({ ...material, freezeCommitment: undefined })).toBe(
      authoringContentHash(material),
    );
  });
  it('R1: the freezeCommitment is INSIDE the material — a re-freeze flips the hash (codex fold-2)', () => {
    const withCommitment = authoringContentHash({ ...material, freezeCommitment: 'a'.repeat(64) });
    expect(withCommitment).not.toBe(authoringContentHash(material));
    expect(withCommitment).not.toBe(
      authoringContentHash({ ...material, freezeCommitment: 'b'.repeat(64) }),
    );
  });
  it('is CRLF-invariant — self-normalizes newlines regardless of the caller (Tenet-20 single-home)', () => {
    // a CRLF-authored multi-line matcher and its LF twin must hash identically even if the
    // CALLER never normalized — the determinism lives in the hash, not the reader (gemini).
    expect(authoringContentHash({ ...material, dslSource: 'line-a\r\nline-b' })).toBe(
      authoringContentHash({ ...material, dslSource: 'line-a\nline-b' }),
    );
    // and a nested fixture string (not just dslSource) is normalized too.
    expect(
      authoringContentHash({ ...material, positiveFixtures: [{ pr: 1, matchedSpan: 'a\r\nb' }] }),
    ).toBe(
      authoringContentHash({ ...material, positiveFixtures: [{ pr: 1, matchedSpan: 'a\nb' }] }),
    );
    // and a string nested INSIDE the §4 preimageSource union (deeper than matchedSpan) is
    // normalized too — the deep-normalize must reach the new union depth, not just the fixture top.
    const lessonFix = (badExample: string) => [
      {
        pr: 1,
        preimageSource: {
          kind: 'lesson',
          lessonRef: 'a1b2c3d4e5f60718',
          badExample,
          goodExample: 'ok',
        },
      },
    ];
    expect(
      authoringContentHash({ ...material, positiveFixtures: lessonFix('bad-a\r\nbad-b') }),
    ).toBe(authoringContentHash({ ...material, positiveFixtures: lessonFix('bad-a\nbad-b') }));
  });
});

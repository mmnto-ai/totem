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
  fixturePrs: [101],
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
});

describe('authoring-ledger fail-loud round-trip (FM(e))', () => {
  it('appends + reads back an entry verbatim', () => {
    appendAuthoringLedgerEntry(dir, baseEntry());
    const back = readAuthoringLedger(dir);
    expect(back).toHaveLength(1);
    expect(back[0]?.ruleId).toBe('a'.repeat(16));
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
  };
  it('is deterministic for identical material', () => {
    expect(authoringContentHash(material)).toBe(authoringContentHash({ ...material }));
  });
  it('changes when the matcher changes (a revision)', () => {
    expect(authoringContentHash(material)).not.toBe(
      authoringContentHash({ ...material, dslSource: 'FIXME' }),
    );
  });
});

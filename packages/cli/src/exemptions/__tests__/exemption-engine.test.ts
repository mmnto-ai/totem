import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ShieldFinding } from '../../commands/shield-templates.js';
import {
  addManualSuppression,
  computePatternId,
  filterExemptedFindings,
  promoteToShared,
  recordFalsePositive,
} from '../exemption-engine.js';
import type { ExemptionLocal, ExemptionShared } from '../exemption-schema.js';
import { EMPTY_LOCAL, EMPTY_SHARED, PROMOTION_THRESHOLD } from '../exemption-schema.js';
import {
  readLocalExemptions,
  readSharedExemptions,
  writeLocalExemptions,
  writeSharedExemptions,
} from '../exemption-store.js';

// ─── Helpers ───────────────────────────────────────────

const makeFinding = (
  message: string,
  severity: 'CRITICAL' | 'WARN' | 'INFO' = 'CRITICAL',
): ShieldFinding => ({
  severity,
  confidence: 0.9,
  message,
});

// ─── computePatternId ──────────────────────────────────

describe('computePatternId', () => {
  it('produces stable hash for same message', () => {
    const a = computePatternId('missing error handler in async route');
    const b = computePatternId('missing error handler in async route');
    expect(a).toBe(b);
  });

  it('produces same hash regardless of word order (keywords are sorted)', () => {
    const a = computePatternId('handler missing async');
    const b = computePatternId('async missing handler');
    expect(a).toBe(b);
  });

  it('survives minor rephrasing (stopwords stripped, punctuation removed)', () => {
    const a = computePatternId('the handler is missing in async route');
    const b = computePatternId('handler missing, async route!');
    expect(a).toBe(b);
  });

  it('different messages produce different hashes', () => {
    const a = computePatternId('missing error handler in async route');
    const b = computePatternId('unused variable declared in module');
    expect(a).not.toBe(b);
  });

  it('prefixed with shield:', () => {
    const id = computePatternId('something went wrong');
    expect(id).toMatch(/^shield:[a-f0-9]{64}$/);
  });
});

// ─── recordFalsePositive ───────────────────────────────

describe('recordFalsePositive', () => {
  const pid = computePatternId('missing error handler');
  const msg = 'missing error handler in route';

  it('increments count on first call', () => {
    const { updatedLocal } = recordFalsePositive({ ...EMPTY_LOCAL }, pid, 'shield', msg);
    expect(updatedLocal.patterns[pid]?.count).toBe(1);
  });

  it('increments count on subsequent calls', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    expect(local.patterns[pid]?.count).toBe(2);
  });

  it('promoted=false for counts 1 and 2', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    let promoted: boolean;
    ({ updatedLocal: local, promoted } = recordFalsePositive(local, pid, 'shield', msg));
    expect(promoted).toBe(false);
    ({ updatedLocal: local, promoted } = recordFalsePositive(local, pid, 'shield', msg));
    expect(promoted).toBe(false);
  });

  it('promoted=true exactly on count 3 (PROMOTION_THRESHOLD)', () => {
    expect(PROMOTION_THRESHOLD).toBe(3);
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    const { promoted } = recordFalsePositive(local, pid, 'shield', msg);
    expect(promoted).toBe(true);
  });

  it('promoted=false for count 4+ (only triggers once)', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    for (let i = 0; i < 3; i++) {
      ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    }
    const { updatedLocal, promoted } = recordFalsePositive(local, pid, 'shield', msg);
    expect(updatedLocal.patterns[pid]?.count).toBe(4);
    expect(promoted).toBe(false);
  });

  it('tracks unique sources (no duplicates)', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    ({ updatedLocal: local } = recordFalsePositive(local, pid, 'bot', msg));
    const sources = local.patterns[pid]?.sources;
    expect(sources).toEqual(['shield', 'bot']);
  });

  it('caps sampleMessages at 3', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    for (let i = 0; i < 5; i++) {
      ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', `msg-${i}`));
    }
    expect(local.patterns[pid]?.sampleMessages).toHaveLength(3);
    expect(local.patterns[pid]?.sampleMessages).toEqual(['msg-0', 'msg-1', 'msg-2']);
  });

  it('deduplicates identical sampleMessages', () => {
    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    const msg = 'identical error message';
    for (let i = 0; i < 5; i++) {
      ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    }
    expect(local.patterns[pid]?.sampleMessages).toHaveLength(1);
    expect(local.patterns[pid]?.sampleMessages).toEqual([msg]);
  });
});

// ─── promoteToShared ───────────────────────────────────

describe('promoteToShared', () => {
  const pid = computePatternId('missing error handler');

  const makeLocalPattern = () => ({
    count: 3,
    sources: ['shield' as const],
    lastSeenAt: new Date().toISOString(),
    sampleMessages: ['missing error handler in route'],
  });

  it('adds entry to empty shared exemptions', () => {
    const shared = promoteToShared({ ...EMPTY_SHARED }, pid, makeLocalPattern());
    expect(shared.exemptions).toHaveLength(1);
    expect(shared.exemptions[0]?.patternId).toBe(pid);
  });

  it('skips duplicate patternId (idempotent)', () => {
    let shared = promoteToShared({ ...EMPTY_SHARED }, pid, makeLocalPattern());
    shared = promoteToShared(shared, pid, makeLocalPattern());
    expect(shared.exemptions).toHaveLength(1);
  });

  it('auto-generates label from keywords', () => {
    const shared = promoteToShared({ ...EMPTY_SHARED }, pid, makeLocalPattern());
    const label = shared.exemptions[0]?.label ?? '';
    // label should contain keywords from the sample message
    expect(label.length).toBeGreaterThan(0);
    // keywords are extracted from 'missing error handler in route'
    // "in" is a stopword, so expect something like "error handler missing route"
    expect(label).toContain('handler');
    expect(label).toContain('missing');
    expect(label).toContain('route');
  });

  it("sets promotedBy to 'auto'", () => {
    const shared = promoteToShared({ ...EMPTY_SHARED }, pid, makeLocalPattern());
    expect(shared.exemptions[0]?.promotedBy).toBe('auto');
  });
});

// ─── filterExemptedFindings ────────────────────────────

describe('filterExemptedFindings', () => {
  it('passes through non-matching findings unchanged', () => {
    const findings = [makeFinding('something unique and rare')];
    const shared: ExemptionShared = { ...EMPTY_SHARED };
    const { filtered, exempted } = filterExemptedFindings(findings, shared);
    expect(filtered).toHaveLength(1);
    expect(exempted).toHaveLength(0);
    expect(filtered[0]?.severity).toBe('CRITICAL');
  });

  it('downgrades matching findings to INFO severity', () => {
    const msg = 'missing error handler in route';
    const pid = computePatternId(msg);

    const shared: ExemptionShared = {
      version: 1,
      exemptions: [
        {
          patternId: pid,
          label: 'error handler missing route',
          reason: 'Auto-promoted',
          promotedAt: new Date().toISOString(),
          promotedBy: 'auto',
          sampleMessages: [msg],
        },
      ],
    };

    const findings = [makeFinding(msg)];
    const { filtered, exempted } = filterExemptedFindings(findings, shared);
    expect(filtered).toHaveLength(0);
    expect(exempted).toHaveLength(1);
    expect(exempted[0]?.severity).toBe('INFO');
  });

  it('returns exempted findings separately', () => {
    const exemptMsg = 'missing error handler in route';
    const pid = computePatternId(exemptMsg);

    const shared: ExemptionShared = {
      version: 1,
      exemptions: [
        {
          patternId: pid,
          label: 'test',
          reason: 'test',
          promotedAt: new Date().toISOString(),
          promotedBy: 'auto',
          sampleMessages: [],
        },
      ],
    };

    const findings = [makeFinding(exemptMsg), makeFinding('totally different finding')];
    const { filtered, exempted } = filterExemptedFindings(findings, shared);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.message).toBe('totally different finding');
    expect(exempted).toHaveLength(1);
    expect(exempted[0]?.message).toBe(exemptMsg);
  });

  it('handles empty exemptions (no filtering)', () => {
    const findings = [makeFinding('finding one'), makeFinding('finding two')];
    const { filtered, exempted } = filterExemptedFindings(findings, {
      ...EMPTY_SHARED,
    });
    expect(filtered).toHaveLength(2);
    expect(exempted).toHaveLength(0);
  });

  it('matches auto-generated pattern IDs', () => {
    // Simulate the full flow: record 3 FPs, promote, then filter
    const msg = 'unused import detected in module';
    const pid = computePatternId(msg);

    let local: ExemptionLocal = { ...EMPTY_LOCAL };
    for (let i = 0; i < 3; i++) {
      ({ updatedLocal: local } = recordFalsePositive(local, pid, 'shield', msg));
    }

    const shared = promoteToShared({ ...EMPTY_SHARED }, pid, local.patterns[pid]!);

    const findings = [makeFinding(msg)];
    const { filtered, exempted } = filterExemptedFindings(findings, shared);
    expect(filtered).toHaveLength(0);
    expect(exempted).toHaveLength(1);
  });

  it('matches manual suppression labels (substring match in message)', () => {
    const shared = addManualSuppression({ ...EMPTY_SHARED }, 'unused import', 'team convention');

    const findings = [makeFinding('There is an unused import detected in the module')];
    const { filtered, exempted } = filterExemptedFindings(findings, shared);
    expect(filtered).toHaveLength(0);
    expect(exempted).toHaveLength(1);
    expect(exempted[0]?.severity).toBe('INFO');
  });
});

// ─── addManualSuppression ──────────────────────────────

describe('addManualSuppression', () => {
  it("adds entry with 'manual:' prefix patternId", () => {
    const shared = addManualSuppression({ ...EMPTY_SHARED }, 'test-label', 'some reason');
    expect(shared.exemptions).toHaveLength(1);
    expect(shared.exemptions[0]?.patternId).toBe('manual:test-label');
  });

  it('skips duplicate labels (idempotent)', () => {
    let shared = addManualSuppression({ ...EMPTY_SHARED }, 'dup-label', 'reason 1');
    shared = addManualSuppression(shared, 'dup-label', 'reason 2');
    expect(shared.exemptions).toHaveLength(1);
  });

  it("sets promotedBy to 'manual'", () => {
    const shared = addManualSuppression({ ...EMPTY_SHARED }, 'my-label', 'reason');
    expect(shared.exemptions[0]?.promotedBy).toBe('manual');
  });
});

// ─── exemption-store ───────────────────────────────────

describe('exemption-store', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-exemption-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── readLocalExemptions / writeLocalExemptions ──

  describe('readLocalExemptions / writeLocalExemptions', () => {
    it('round-trips valid data', () => {
      const data: ExemptionLocal = {
        patterns: {
          'shield:abc123': {
            count: 2,
            sources: ['shield'],
            lastSeenAt: new Date().toISOString(),
            sampleMessages: ['msg one'],
          },
        },
      };
      writeLocalExemptions(tmpDir, data);
      const loaded = readLocalExemptions(tmpDir);
      expect(loaded).toEqual(data);
    });

    it('returns EMPTY_LOCAL for missing file', () => {
      const result = readLocalExemptions(tmpDir);
      expect(result).toEqual(EMPTY_LOCAL);
    });

    it('returns EMPTY_LOCAL for corrupt JSON (calls onWarn)', () => {
      const filePath = path.join(tmpDir, 'exemption-local.json');
      fs.writeFileSync(filePath, '{ not valid json!!!', 'utf-8');
      const warns: string[] = [];
      const result = readLocalExemptions(tmpDir, (msg) => warns.push(msg));
      expect(result).toEqual(EMPTY_LOCAL);
      expect(warns.length).toBeGreaterThan(0);
    });

    it('returns EMPTY_LOCAL for invalid schema', () => {
      const filePath = path.join(tmpDir, 'exemption-local.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({ patterns: { foo: { count: 'not-a-number' } } }),
        'utf-8',
      );
      const warns: string[] = [];
      const result = readLocalExemptions(tmpDir, (msg) => warns.push(msg));
      expect(result).toEqual(EMPTY_LOCAL);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain('Corrupt');
    });
  });

  // ── readSharedExemptions / writeSharedExemptions ──

  describe('readSharedExemptions / writeSharedExemptions', () => {
    it('round-trips valid data', () => {
      const data: ExemptionShared = {
        version: 1,
        exemptions: [
          {
            patternId: 'shield:abc',
            label: 'test label',
            reason: 'test reason',
            promotedAt: new Date().toISOString(),
            promotedBy: 'auto',
            sampleMessages: ['msg one'],
          },
        ],
      };
      writeSharedExemptions(tmpDir, data);
      const loaded = readSharedExemptions(tmpDir);
      expect(loaded).toEqual(data);
    });

    it('returns EMPTY_SHARED for missing file', () => {
      const result = readSharedExemptions(tmpDir);
      expect(result).toEqual(EMPTY_SHARED);
    });

    it('returns EMPTY_SHARED for corrupt JSON (calls onWarn)', () => {
      const filePath = path.join(tmpDir, 'exemptions.json');
      fs.writeFileSync(filePath, '<<<not json>>>', 'utf-8');
      const warns: string[] = [];
      const result = readSharedExemptions(tmpDir, (msg) => warns.push(msg));
      expect(result).toEqual(EMPTY_SHARED);
      expect(warns.length).toBeGreaterThan(0);
    });
  });
});

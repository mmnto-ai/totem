import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import type { RuleBypassStats } from './ledger-analyzer.js';
import { analyzeLedger, readLedgerBypassCounts } from './ledger-analyzer.js';

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ledger-analyzer-'));
}

function makeLedgerEvent(ruleId: string, type: 'suppress' | 'override' = 'suppress'): string {
  return JSON.stringify({
    timestamp: '2026-03-25T12:00:00.000Z',
    type,
    ruleId,
    file: 'src/index.ts',
    justification: type === 'override' ? 'Legacy code' : '',
    source: 'lint',
  });
}

function writeLedger(totemDir: string, lines: string[]): void {
  const ledgerDir = path.join(totemDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'events.ndjson'), lines.join('\n') + '\n', 'utf-8');
}

function writeMetrics(
  totemDir: string,
  rules: Record<string, { triggerCount: number; suppressCount: number }>,
): void {
  const cacheDir = path.join(totemDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const metricsData = {
    version: 1,
    rules: Object.fromEntries(
      Object.entries(rules).map(([id, counts]) => [
        id,
        {
          triggerCount: counts.triggerCount,
          suppressCount: counts.suppressCount,
          lastTriggeredAt: '2026-03-25T12:00:00.000Z',
          lastSuppressedAt: null,
        },
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(cacheDir, 'rule-metrics.json'),
    JSON.stringify(metricsData, null, 2) + '\n',
    'utf-8',
  );
}

// ─── readLedgerBypassCounts ─────────────────────────────

describe('readLedgerBypassCounts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty map when ledger does not exist', async () => {
    const counts = await readLedgerBypassCounts(tmpDir);
    expect(counts.size).toBe(0);
  });

  it('counts bypass events per ruleId', async () => {
    writeLedger(tmpDir, [
      makeLedgerEvent('rule-a'),
      makeLedgerEvent('rule-b'),
      makeLedgerEvent('rule-a'),
      makeLedgerEvent('rule-a', 'override'),
    ]);

    const counts = await readLedgerBypassCounts(tmpDir);
    expect(counts.get('rule-a')).toBe(3);
    expect(counts.get('rule-b')).toBe(1);
  });

  it('skips malformed lines and warns', async () => {
    const onWarn = vi.fn();
    writeLedger(tmpDir, [makeLedgerEvent('rule-a'), '{{{invalid json', makeLedgerEvent('rule-b')]);

    const counts = await readLedgerBypassCounts(tmpDir, onWarn);
    expect(counts.get('rule-a')).toBe(1);
    expect(counts.get('rule-b')).toBe(1);
    expect(onWarn).toHaveBeenCalledWith('Skipping malformed ledger line');
  });

  it('skips events that fail schema validation', async () => {
    writeLedger(tmpDir, [
      makeLedgerEvent('rule-a'),
      JSON.stringify({ type: 'suppress' }), // missing required fields
    ]);

    const counts = await readLedgerBypassCounts(tmpDir);
    expect(counts.get('rule-a')).toBe(1);
    expect(counts.size).toBe(1);
  });

  it('skips blank lines', async () => {
    const ledgerDir = path.join(tmpDir, 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, 'events.ndjson'),
      makeLedgerEvent('rule-a') + '\n\n\n' + makeLedgerEvent('rule-b') + '\n',
      'utf-8',
    );

    const counts = await readLedgerBypassCounts(tmpDir);
    expect(counts.get('rule-a')).toBe(1);
    expect(counts.get('rule-b')).toBe(1);
  });
});

// ─── analyzeLedger ──────────────────────────────────────

describe('analyzeLedger', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty map when no ledger or metrics exist', async () => {
    const stats = await analyzeLedger(tmpDir);
    expect(stats.size).toBe(0);
  });

  it('counts bypass events from ledger', async () => {
    writeLedger(tmpDir, [
      makeLedgerEvent('rule-a'),
      makeLedgerEvent('rule-a'),
      makeLedgerEvent('rule-b'),
    ]);

    const stats = await analyzeLedger(tmpDir);
    expect(stats.get('rule-a')?.bypassCount).toBe(2);
    expect(stats.get('rule-b')?.bypassCount).toBe(1);
  });

  it('merges trigger counts from rule-metrics', async () => {
    writeLedger(tmpDir, [makeLedgerEvent('rule-a')]);
    writeMetrics(tmpDir, {
      'rule-a': { triggerCount: 10, suppressCount: 1 },
      'rule-c': { triggerCount: 5, suppressCount: 0 },
    });

    const stats = await analyzeLedger(tmpDir);

    // rule-a: 10 triggers + 1 bypass from ledger
    expect(stats.get('rule-a')?.triggerCount).toBe(10);
    expect(stats.get('rule-a')?.bypassCount).toBe(1);
    expect(stats.get('rule-a')?.totalEvents).toBe(11);

    // rule-c: 5 triggers, 0 bypasses (not in ledger)
    expect(stats.get('rule-c')?.triggerCount).toBe(5);
    expect(stats.get('rule-c')?.bypassCount).toBe(0);
    expect(stats.get('rule-c')?.totalEvents).toBe(5);
  });

  it('calculates correct bypass rate', async () => {
    writeLedger(tmpDir, [makeLedgerEvent('rule-a'), makeLedgerEvent('rule-a')]);
    writeMetrics(tmpDir, {
      'rule-a': { triggerCount: 8, suppressCount: 2 },
    });

    const stats = await analyzeLedger(tmpDir);
    const ruleA = stats.get('rule-a') as RuleBypassStats;

    // 2 bypasses / (8 triggers + 2 bypasses) = 0.2
    expect(ruleA.bypassRate).toBeCloseTo(0.2);
    expect(ruleA.totalEvents).toBe(10);
  });

  it('handles div-by-zero: 0 events yields 0% rate', async () => {
    // Rule exists in metrics with 0 triggers and 0 suppressions
    writeMetrics(tmpDir, {
      'rule-empty': { triggerCount: 0, suppressCount: 0 },
    });

    const stats = await analyzeLedger(tmpDir);
    const ruleEmpty = stats.get('rule-empty') as RuleBypassStats;

    expect(ruleEmpty.bypassRate).toBe(0);
    expect(ruleEmpty.totalEvents).toBe(0);
  });

  it('handles missing ledger file gracefully', async () => {
    writeMetrics(tmpDir, {
      'rule-a': { triggerCount: 3, suppressCount: 0 },
    });

    const stats = await analyzeLedger(tmpDir);
    const ruleA = stats.get('rule-a') as RuleBypassStats;

    expect(ruleA.triggerCount).toBe(3);
    expect(ruleA.bypassCount).toBe(0);
    expect(ruleA.bypassRate).toBe(0);
  });
});

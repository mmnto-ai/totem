import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuleMetricsFile } from './rule-metrics.js';
import {
  loadRuleMetrics,
  recordSuppression,
  recordTrigger,
  saveRuleMetrics,
} from './rule-metrics.js';
import { cleanTmpDir } from './test-utils.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-metrics-'));
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

function emptyMetrics(): RuleMetricsFile {
  return { version: 1, rules: {} };
}

// ─── loadRuleMetrics ────────────────────────────────────

describe('loadRuleMetrics', () => {
  it('returns empty metrics when file does not exist', () => {
    const metrics = loadRuleMetrics(tmpDir);
    expect(metrics).toEqual({ version: 1, rules: {} });
  });

  it('loads valid metrics from disk', () => {
    const data: RuleMetricsFile = {
      version: 1,
      rules: {
        abc123: {
          triggerCount: 5,
          suppressCount: 2,
          lastTriggeredAt: '2026-01-01T00:00:00.000Z',
          lastSuppressedAt: '2026-01-02T00:00:00.000Z',
        },
      },
    };
    const dir = path.join(tmpDir, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rule-metrics.json'), JSON.stringify(data));

    const metrics = loadRuleMetrics(tmpDir);
    expect(metrics).toEqual(data);
  });

  it('roundtrips through save and load', () => {
    const data: RuleMetricsFile = {
      version: 1,
      rules: {
        hash1: {
          triggerCount: 3,
          suppressCount: 1,
          lastTriggeredAt: '2026-03-01T00:00:00.000Z',
          lastSuppressedAt: null,
        },
        hash2: {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
        },
      },
    };
    saveRuleMetrics(tmpDir, data);
    const loaded = loadRuleMetrics(tmpDir);
    expect(loaded).toEqual(data);
  });

  it('returns empty metrics and warns on corrupt JSON', () => {
    const dir = path.join(tmpDir, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rule-metrics.json'), '{{{invalid json');

    const onWarn = vi.fn();
    const metrics = loadRuleMetrics(tmpDir, onWarn);
    expect(metrics).toEqual({ version: 1, rules: {} });
    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn.mock.calls[0]![0]).toContain('Could not load rule metrics');
  });

  it('returns empty metrics and warns on schema-invalid data', () => {
    const dir = path.join(tmpDir, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    // Valid JSON but wrong schema (version: 2 instead of 1)
    fs.writeFileSync(
      path.join(dir, 'rule-metrics.json'),
      JSON.stringify({ version: 2, rules: {} }),
    );

    const onWarn = vi.fn();
    const metrics = loadRuleMetrics(tmpDir, onWarn);
    expect(metrics).toEqual({ version: 1, rules: {} });
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('returns empty metrics silently when file is missing (no warn callback)', () => {
    // No onWarn provided — should not throw
    const metrics = loadRuleMetrics(path.join(tmpDir, 'nonexistent'));
    expect(metrics).toEqual({ version: 1, rules: {} });
  });
});

// ─── saveRuleMetrics ────────────────────────────────────

describe('saveRuleMetrics', () => {
  it('creates the cache directory if missing', () => {
    const data = emptyMetrics();
    saveRuleMetrics(tmpDir, data);

    const filePath = path.join(tmpDir, 'cache', 'rule-metrics.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('writes valid JSON with trailing newline', () => {
    const data: RuleMetricsFile = {
      version: 1,
      rules: {
        abc: {
          triggerCount: 1,
          suppressCount: 0,
          lastTriggeredAt: '2026-01-01T00:00:00.000Z',
          lastSuppressedAt: null,
        },
      },
    };
    saveRuleMetrics(tmpDir, data);

    const filePath = path.join(tmpDir, 'cache', 'rule-metrics.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(data);
  });

  it('overwrites existing file', () => {
    const data1: RuleMetricsFile = {
      version: 1,
      rules: {
        a: { triggerCount: 1, suppressCount: 0, lastTriggeredAt: null, lastSuppressedAt: null },
      },
    };
    const data2: RuleMetricsFile = {
      version: 1,
      rules: {
        b: { triggerCount: 2, suppressCount: 1, lastTriggeredAt: null, lastSuppressedAt: null },
      },
    };

    saveRuleMetrics(tmpDir, data1);
    saveRuleMetrics(tmpDir, data2);

    const loaded = loadRuleMetrics(tmpDir);
    expect(loaded).toEqual(data2);
    expect(loaded.rules['a']).toBeUndefined();
  });
});

// ─── recordTrigger ──────────────────────────────────────

describe('recordTrigger', () => {
  it('creates a new entry and increments triggerCount', () => {
    const metrics = emptyMetrics();
    recordTrigger(metrics, 'hash1');

    expect(metrics.rules['hash1']).toBeDefined();
    expect(metrics.rules['hash1']!.triggerCount).toBe(1);
    expect(metrics.rules['hash1']!.suppressCount).toBe(0);
    expect(metrics.rules['hash1']!.lastTriggeredAt).toBeTruthy();
    expect(metrics.rules['hash1']!.lastSuppressedAt).toBeNull();
  });

  it('increments existing entry', () => {
    const metrics = emptyMetrics();
    recordTrigger(metrics, 'hash1');
    recordTrigger(metrics, 'hash1');
    recordTrigger(metrics, 'hash1');

    expect(metrics.rules['hash1']!.triggerCount).toBe(3);
  });

  it('sets lastTriggeredAt to a valid ISO timestamp', () => {
    const metrics = emptyMetrics();
    const before = new Date().toISOString();
    recordTrigger(metrics, 'hash1');
    const after = new Date().toISOString();

    const ts = metrics.rules['hash1']!.lastTriggeredAt!;
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  it('does not affect other hashes', () => {
    const metrics = emptyMetrics();
    recordTrigger(metrics, 'hash1');
    recordTrigger(metrics, 'hash2');

    expect(metrics.rules['hash1']!.triggerCount).toBe(1);
    expect(metrics.rules['hash2']!.triggerCount).toBe(1);
  });
});

// ─── recordSuppression ──────────────────────────────────

describe('recordSuppression', () => {
  it('creates a new entry and increments suppressCount', () => {
    const metrics = emptyMetrics();
    recordSuppression(metrics, 'hash1');

    expect(metrics.rules['hash1']).toBeDefined();
    expect(metrics.rules['hash1']!.suppressCount).toBe(1);
    expect(metrics.rules['hash1']!.triggerCount).toBe(0);
    expect(metrics.rules['hash1']!.lastSuppressedAt).toBeTruthy();
    expect(metrics.rules['hash1']!.lastTriggeredAt).toBeNull();
  });

  it('increments existing entry', () => {
    const metrics = emptyMetrics();
    recordSuppression(metrics, 'hash1');
    recordSuppression(metrics, 'hash1');

    expect(metrics.rules['hash1']!.suppressCount).toBe(2);
  });

  it('sets lastSuppressedAt to a valid ISO timestamp', () => {
    const metrics = emptyMetrics();
    const before = new Date().toISOString();
    recordSuppression(metrics, 'hash1');
    const after = new Date().toISOString();

    const ts = metrics.rules['hash1']!.lastSuppressedAt!;
    expect(ts >= before).toBe(true);
    expect(ts <= after).toBe(true);
  });

  it('works independently from recordTrigger on the same hash', () => {
    const metrics = emptyMetrics();
    recordTrigger(metrics, 'hash1');
    recordTrigger(metrics, 'hash1');
    recordSuppression(metrics, 'hash1');

    expect(metrics.rules['hash1']!.triggerCount).toBe(2);
    expect(metrics.rules['hash1']!.suppressCount).toBe(1);
  });
});

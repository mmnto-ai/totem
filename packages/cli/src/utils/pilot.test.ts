import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import {
  isPilotExpired,
  readPilotState,
  resolvePilotConfig,
  withPilotMode,
  writePilotState,
} from './pilot.js';

// ─── Helpers ────────────────────────────────────────────

function makeConfig(pilot?: TotemConfig['pilot']): TotemConfig {
  return {
    targets: [{ glob: '**/*.md', type: 'lesson', strategy: 'markdown-heading' }],
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    shieldIgnorePatterns: [],
    contextWarningThreshold: 40_000,
    shieldAutoLearn: false,
    pilot,
  } as TotemConfig;
}

const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;

// ─── resolvePilotConfig ─────────────────────────────────

describe('resolvePilotConfig', () => {
  it('returns null when pilot not set', () => {
    expect(resolvePilotConfig(makeConfig())).toBeNull();
    expect(resolvePilotConfig(makeConfig(undefined))).toBeNull();
  });

  it('returns null when pilot is false', () => {
    expect(resolvePilotConfig(makeConfig(false))).toBeNull();
  });

  it('returns defaults for pilot: true', () => {
    const result = resolvePilotConfig(makeConfig(true));
    expect(result).toEqual({ maxDays: 14, maxPushes: 50 });
  });

  it('uses custom values from object form', () => {
    const result = resolvePilotConfig(makeConfig({ maxDays: 7, maxPushes: 20 }));
    expect(result).toEqual({ maxDays: 7, maxPushes: 20 });
  });
});

// ─── readPilotState / writePilotState ───────────────────

describe('readPilotState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-pilot-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, RM_OPTS);
  });

  it('initializes missing state file', () => {
    const state = readPilotState(tmpDir);
    expect(state.pushCount).toBe(0);
    expect(state.violations).toEqual([]);
    expect(typeof state.startedAt).toBe('string');
    // File should now exist on disk
    const fp = path.join(tmpDir, 'pilot-state.json');
    expect(fs.existsSync(fp)).toBe(true);
  });

  it('reads existing state file', () => {
    const existing = {
      startedAt: '2026-01-01T00:00:00.000Z',
      pushCount: 5,
      violations: [{ timestamp: '2026-01-02T00:00:00.000Z', hook: 'pre-push', detail: 'fail' }],
    };
    fs.writeFileSync(path.join(tmpDir, 'pilot-state.json'), JSON.stringify(existing), 'utf-8');
    const state = readPilotState(tmpDir);
    expect(state).toEqual(existing);
  });

  it('re-initializes when state file is invalid JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'pilot-state.json'), 'not json', 'utf-8');
    const state = readPilotState(tmpDir);
    expect(state.pushCount).toBe(0);
    expect(state.violations).toEqual([]);
  });

  it('re-initializes when state file has wrong shape', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'pilot-state.json'),
      JSON.stringify({ startedAt: 123 }),
      'utf-8',
    );
    const state = readPilotState(tmpDir);
    expect(state.pushCount).toBe(0);
  });
});

describe('writePilotState', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-pilot-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, RM_OPTS);
  });

  it('writes state atomically', () => {
    const state = {
      startedAt: '2026-01-01T00:00:00.000Z',
      pushCount: 10,
      violations: [],
    };
    writePilotState(tmpDir, state);
    const raw = fs.readFileSync(path.join(tmpDir, 'pilot-state.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual(state);
    // Temp file should not remain
    expect(fs.existsSync(path.join(tmpDir, 'pilot-state.json.tmp'))).toBe(false);
  });
});

// ─── isPilotExpired ─────────────────────────────────────

describe('isPilotExpired', () => {
  it('returns expired when days exceeded', () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const result = isPilotExpired(
      { startedAt: fifteenDaysAgo, pushCount: 0, violations: [] },
      { maxDays: 14, maxPushes: 50 },
    );
    expect(result.expired).toBe(true);
    expect(result.reason).toMatch(/days elapsed/);
  });

  it('returns expired when pushes exceeded', () => {
    const result = isPilotExpired(
      { startedAt: new Date().toISOString(), pushCount: 50, violations: [] },
      { maxDays: 14, maxPushes: 50 },
    );
    expect(result.expired).toBe(true);
    expect(result.reason).toMatch(/pushes reached/);
  });

  it('returns not expired within bounds', () => {
    const result = isPilotExpired(
      { startedAt: new Date().toISOString(), pushCount: 10, violations: [] },
      { maxDays: 14, maxPushes: 50 },
    );
    expect(result.expired).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

// ─── withPilotMode ──────────────────────────────────────

describe('withPilotMode', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-pilot-'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, RM_OPTS);
  });

  it('returns 0 and logs violation when fn fails', async () => {
    const config = { maxDays: 14, maxPushes: 50 };
    const exitCode = await withPilotMode('pre-push', tmpDir, config, async () => 1);
    expect(exitCode).toBe(0);

    // State should have a violation logged
    const state = readPilotState(tmpDir);
    expect(state.violations).toHaveLength(1);
    expect(state.violations[0]!.hook).toBe('pre-push');
    expect(state.violations[0]!.detail).toContain('exit');

    // Warning should have been printed
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
  });

  it('increments pushCount when fn succeeds', async () => {
    const config = { maxDays: 14, maxPushes: 50 };
    const exitCode = await withPilotMode('pre-push', tmpDir, config, async () => 0);
    expect(exitCode).toBe(0);

    const state = readPilotState(tmpDir);
    expect(state.pushCount).toBe(1);
    expect(state.violations).toHaveLength(0);
  });

  it('returns 1 when pilot period expired', async () => {
    // Seed an expired state (push count at limit)
    writePilotState(tmpDir, {
      startedAt: new Date().toISOString(),
      pushCount: 50,
      violations: [],
    });

    const config = { maxDays: 14, maxPushes: 50 };
    const fn = vi.fn(async () => 0);
    const exitCode = await withPilotMode('pre-push', tmpDir, config, fn);

    expect(exitCode).toBe(1);
    // fn should NOT have been called
    expect(fn).not.toHaveBeenCalled();

    // Error message should mention expiry
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
  });
});

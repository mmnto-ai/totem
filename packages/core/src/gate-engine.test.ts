import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemConfigError } from './errors.js';
import { evaluateGate, knownGateEvents } from './gate-engine.js';

let tmpRoot: string;
let totemDir: string;

function writeFreeze(content: string): void {
  fs.writeFileSync(path.join(totemDir, 'freeze.json'), content);
}

const FROZEN = JSON.stringify({
  _note: 'test fixture',
  frozen: [
    { subsystem: 'rule-compilation', since: '2026-05-17', reason: 'paused', tracking: '#1' },
  ],
});

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gate-'));
  totemDir = path.join(tmpRoot, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
});

afterEach(() => {
  // maxRetries/retryDelay rides out transient Windows ENOTEMPTY/EBUSY without
  // an empty catch swallowing real teardown failures (repo test-cleanup idiom).
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('evaluateGate — freeze-check', () => {
  it('denies when the subsystem matches a frozen entry', () => {
    writeFreeze(FROZEN);
    const v = evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir);
    expect(v.disposition).toBe('deny');
    expect(v.provenance.matched).toBe('rule-compilation');
    expect(v.provenance.source).toBe('.totem/freeze.json');
    expect(v.reason).toMatch(/frozen/i);
  });

  it('allows when the subsystem does not match any frozen entry', () => {
    writeFreeze(FROZEN);
    const v = evaluateGate('freeze-check', { subsystem: 'something-else' }, totemDir);
    expect(v.disposition).toBe('allow');
    expect(v.provenance.matched).toBeNull();
  });

  it('allows with no-freeze-file provenance when freeze.json is absent', () => {
    const v = evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir);
    expect(v.disposition).toBe('allow');
    expect(v.provenance.ref).toBe('no-freeze-file');
    expect(v.reason).toMatch(/nothing is frozen/i);
  });

  it('fails loud (TotemConfigError) on malformed freeze.json — never silent-allow', () => {
    writeFreeze('{ not valid json');
    expect(() => evaluateGate('freeze-check', { subsystem: 'x' }, totemDir)).toThrow(
      TotemConfigError,
    );
  });

  it('fails loud (TotemConfigError) on schema-invalid freeze.json', () => {
    writeFreeze(JSON.stringify({ frozen: [{ since: '2026-05-17' }] })); // missing `subsystem`
    expect(() => evaluateGate('freeze-check', { subsystem: 'x' }, totemDir)).toThrow(
      TotemConfigError,
    );
  });

  it('throws on a payload without a subsystem string — never default-allow', () => {
    writeFreeze(FROZEN);
    expect(() => evaluateGate('freeze-check', {}, totemDir)).toThrow(/subsystem/i);
  });

  it('is side-effect-free — never writes or mutates state', () => {
    writeFreeze(FROZEN);
    const fp = path.join(totemDir, 'freeze.json');
    const before = fs.readFileSync(fp, 'utf-8');
    const entriesBefore = fs.readdirSync(totemDir).sort();

    evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir);

    expect(fs.readFileSync(fp, 'utf-8')).toBe(before);
    expect(fs.readdirSync(totemDir).sort()).toEqual(entriesBefore); // no cache stamp, no ledger write
  });

  it('always carries provenance with an ISO checkedAt', () => {
    writeFreeze(FROZEN);
    const v = evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir);
    expect(v.provenance.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('evaluateGate — dispatch', () => {
  it('throws on an unknown gate event — never default-allow', () => {
    expect(() => evaluateGate('made-up-gate', {}, totemDir)).toThrow(/unknown gate event/i);
  });

  it('exposes the known gate events', () => {
    expect(knownGateEvents()).toContain('freeze-check');
  });
});

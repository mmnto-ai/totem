import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemConfigError } from './errors.js';
import { evaluateGate, gateMatcher, knownGateEvents } from './gate-engine.js';
import type { GhRunner } from './gate-types.js';

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

  it('throws on an empty or whitespace-only subsystem payload — never default-allow', () => {
    writeFreeze(FROZEN);
    expect(() => evaluateGate('freeze-check', { subsystem: '' }, totemDir)).toThrow(/subsystem/i);
    expect(() => evaluateGate('freeze-check', { subsystem: '   ' }, totemDir)).toThrow(
      /subsystem/i,
    );
  });

  it('denies a padded subsystem that matches a frozen entry (no whitespace bypass)', () => {
    writeFreeze(FROZEN);
    const v = evaluateGate('freeze-check', { subsystem: '  rule-compilation  ' }, totemDir);
    expect(v.disposition).toBe('deny');
    expect(v.provenance.matched).toBe('rule-compilation');
    expect(v.provenance.ref).toBe('rule-compilation'); // normalized, not the padded input
  });

  it('fails loud on a freeze entry with an empty subsystem', () => {
    writeFreeze(JSON.stringify({ frozen: [{ subsystem: '' }] }));
    expect(() => evaluateGate('freeze-check', { subsystem: 'x' }, totemDir)).toThrow(
      TotemConfigError,
    );
  });

  it('reflects a custom totemDir name in provenance.source', () => {
    const customDir = path.join(tmpRoot, '.totem-custom');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'freeze.json'), FROZEN);
    const v = evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, customDir);
    expect(v.provenance.source).toBe('.totem-custom/freeze.json');
    expect(v.disposition).toBe('deny');
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

// ─── merge-ready through the registry (mmnto-ai/totem#2800) ──────────────
//
// The evaluator's own predicate matrix lives in merge-ready.test.ts; what is
// locked HERE is what the registry owes: the event is dispatchable under its own
// matcher, the gh seam and the tier ride in on the context, and the ADR-109
// side-effect fixture extends to this event (a verdict that mutates on-disk
// state falsifies the ADR).

/** A runner that answers `gh --version` and then one canned, minimal PR page. */
function ghRunnerStub(mergeStateStatus: string): GhRunner {
  const pr = {
    number: 4242,
    isDraft: false,
    mergeStateStatus,
    headRefOid: 'a'.repeat(40),
    headRefName: 'feat/x',
    baseRefName: 'main',
    commits: {
      nodes: [
        {
          commit: {
            oid: 'a'.repeat(40),
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                totalCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    __typename: 'CheckRun',
                    name: 'CI',
                    status: 'COMPLETED',
                    conclusion: 'SUCCESS',
                  },
                ],
              },
            },
          },
        },
      ],
    },
    reviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  };
  return (args) =>
    args[0] === '--version'
      ? { stdout: 'gh version 2.99.0 (2026-09-01)', exitCode: 0 }
      : { stdout: JSON.stringify({ data: { repository: { pullRequest: pr } } }), exitCode: 0 };
}

const MERGE_READY_PAYLOAD = { repo: 'mmnto-ai/totem', pr: 4242 };

describe('evaluateGate — merge-ready', () => {
  it('is a known gate under the Bash|PowerShell matcher', () => {
    expect(knownGateEvents()).toContain('merge-ready');
    expect(gateMatcher('merge-ready')).toBe('Bash|PowerShell');
  });

  it('dispatches with the injected gh runner and returns an ADR-109 verdict', () => {
    const v = evaluateGate('merge-ready', MERGE_READY_PAYLOAD, totemDir, {
      ghRunner: ghRunnerStub('CLEAN'),
      env: {},
      writeStderr: () => {},
    });
    expect(v.disposition).toBe('allow');
    expect(v.reason).toMatch(/merge-ready floor/i);
    expect(v.provenance.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reads the tier from the context for its own UNEVALUABLE class only', () => {
    const strict = evaluateGate('merge-ready', MERGE_READY_PAYLOAD, totemDir, {
      ghRunner: ghRunnerStub('UNKNOWN'),
      env: {},
      writeStderr: () => {},
    });
    expect(strict.disposition).toBe('deny');

    const pilot = evaluateGate('merge-ready', MERGE_READY_PAYLOAD, totemDir, {
      tier: 'pilot',
      ghRunner: ghRunnerStub('UNKNOWN'),
      env: {},
      writeStderr: () => {},
    });
    expect(pilot.disposition).toBe('warn');
  });

  it('leaves freeze-check failing closed at EVERY tier (the tier is per gate)', () => {
    writeFreeze('{ not valid json');
    expect(() =>
      evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir, {
        tier: 'pilot',
      }),
    ).toThrow(TotemConfigError);

    writeFreeze(FROZEN);
    const denied = evaluateGate('freeze-check', { subsystem: 'rule-compilation' }, totemDir, {
      tier: 'pilot',
    });
    expect(denied.disposition).toBe('deny'); // never downgraded to `warn`
  });

  it('throws on a malformed payload — never default-allow', () => {
    expect(() =>
      evaluateGate('merge-ready', { repo: '', pr: null }, totemDir, {
        ghRunner: ghRunnerStub('CLEAN'),
        env: {},
        writeStderr: () => {},
      }),
    ).toThrow(/merge-ready payload is invalid/);
  });

  it('is side-effect-free — never writes or mutates state (ADR-109 fixture, extended)', () => {
    writeFreeze(FROZEN);
    const before = fs.readFileSync(path.join(totemDir, 'freeze.json'), 'utf-8');
    const entriesBefore = fs.readdirSync(totemDir).sort();
    const rootBefore = fs.readdirSync(tmpRoot).sort();

    evaluateGate('merge-ready', MERGE_READY_PAYLOAD, totemDir, {
      ghRunner: ghRunnerStub('CLEAN'),
      env: {},
      writeStderr: () => {},
    });

    expect(fs.readFileSync(path.join(totemDir, 'freeze.json'), 'utf-8')).toBe(before);
    expect(fs.readdirSync(totemDir).sort()).toEqual(entriesBefore);
    expect(fs.readdirSync(tmpRoot).sort()).toEqual(rootBefore); // no cache, no ledger, no stamp
  });
});

/**
 * Writer tests for the query-before-derive sensor (mmnto-ai/totem#2510).
 *
 * The induced-failure blocks follow the ADR-115 § 2 three-pack convention used
 * by `mail-degraded-e4.test.ts`:
 *   1. per-item accounting fires — the specific failing item is NAMED in the
 *      warnings channel;
 *   2. the loud backstop throws — for this MUTATING path that is a literal
 *      throw from `recordDeriveAction`, and the ledger is left in prior-good
 *      state (the derive row present, simply uncorrelated) rather than
 *      "presenting as success while partial";
 *   3. a recovery / control assertion — with the fault removed the same call
 *      returns to green, and a healthy control never warns.
 *
 * Failures are induced with real errnos (a file where a directory belongs) or
 * real on-disk state (a hand-written pointer), never by mocking the module under
 * test.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so spyOn works in ESM — same pattern as session-id.test.ts.
// Spreads the real module, so every unmocked call is the genuine one.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { TotemError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import { mintQbdCorrelationId, QBD_CORRELATION_WINDOW_MS } from './correlation-id.js';
import {
  recordCorpusQuery,
  recordDeriveAction,
  resolveQbdAgentSource,
  senseCorpusQuery,
  senseDeriveAction,
} from './record.js';

const T0 = Date.parse('2026-07-28T12:00:00.000Z');

const SESSION_A = '550e8400-e29b-41d4-a716-446655440000';
const SESSION_B = '550e8400-e29b-41d4-a716-446655440001';

/**
 * Correlation is fail-closed: it requires a session id on BOTH sides and a
 * matching seat. So the ordinary "a query grounded this derive" fixture must
 * supply both, exactly as a real instrumented session does.
 */
function env(sessionId: string = SESSION_A, agent = 'seat-a'): NodeJS.ProcessEnv {
  return { TOTEM_SESSION_ID: sessionId, TOTEM_SELF_AGENT: agent };
}

let totemDir: string;

beforeEach(() => {
  totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-'));
});

afterEach(() => {
  cleanTmpDir(totemDir);
});

function ledgerLines(): Array<Record<string, unknown>> {
  const file = path.join(totemDir, 'ledger', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function pointerFile(): string {
  return path.join(totemDir, 'ledger', '.qbd-correlation');
}

/**
 * Park a hand-written pointer. Session + seat MATCH the fixture env on purpose:
 * correlation is fail-closed, so a mismatched pointer would be ignored before
 * the contract check ever runs and the induced failure would never fire.
 */
function writeForgedPointer(id: string, mintedAtMs: number): void {
  fs.mkdirSync(path.join(totemDir, 'ledger'), { recursive: true });
  fs.writeFileSync(
    pointerFile(),
    JSON.stringify({ id, mintedAtMs, sessionId: SESSION_A, agentSource: 'seat-a' }),
    'utf-8',
  );
}

describe('recordCorpusQuery', () => {
  it('writes a corpus_query row whose ID is minted at the row instant', () => {
    const result = recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });

    expect(result.written).toBe(true);
    expect(result.warnings).toEqual([]);

    const rows = ledgerLines();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('corpus_query');
    expect(rows[0]!.activity_name).toBe('totem_search');
    expect(rows[0]!.timestamp).toBe(new Date(T0).toISOString());
    expect(rows[0]!.qbd_correlation_id).toBe(result.correlationId);
  });

  it('parks the minted ID for the derives that follow', () => {
    const result = recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });
    const pointer = JSON.parse(fs.readFileSync(pointerFile(), 'utf-8')) as Record<string, unknown>;
    expect(pointer.id).toBe(result.correlationId);
    expect(pointer.mintedAtMs).toBe(T0);
  });

  it('stamps the seat from TOTEM_SELF_AGENT', () => {
    recordCorpusQuery({
      totemDir,
      source: 'bot',
      surface: 'search_knowledge',
      nowMs: T0,
      env: { TOTEM_SELF_AGENT: 'totem-claude' },
    });
    expect(ledgerLines()[0]!.agent_source).toBe('totem-claude');
  });
});

describe('recordDeriveAction', () => {
  it('correlates to a query fired inside the window', () => {
    const query = recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 60_000,
      env: env(),
    });

    expect(derive.correlationId).toBe(query.correlationId);
    const rows = ledgerLines();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.type).toBe('derive_action');
    expect(rows[1]!.qbd_correlation_id).toBe(query.correlationId);
  });

  it('records an UNcorrelated derive when no query preceded it', () => {
    // Falsifier 1: this row is the whole point of the metric. It must exist.
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'orient',
      nowMs: T0,
      env: env(),
    });

    expect(derive.written).toBe(true);
    expect(derive.correlationId).toBeUndefined();
    const rows = ledgerLines();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('derive_action');
    expect(rows[0]!.qbd_correlation_id).toBeUndefined();
  });

  it('does not correlate to a query older than the window', () => {
    recordCorpusQuery({ totemDir, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'review',
      nowMs: T0 + QBD_CORRELATION_WINDOW_MS + 1000,
      env: env(),
    });

    expect(derive.correlationId).toBeUndefined();
    expect(derive.warnings).toEqual([]);
    expect(ledgerLines()[1]!.qbd_correlation_id).toBeUndefined();
  });

  it('does not correlate across sessions', () => {
    recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(SESSION_A),
    });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 60_000,
      env: env(SESSION_B),
    });
    expect(derive.correlationId).toBeUndefined();
  });

  it('does not correlate across SEATS sharing one working tree', () => {
    // Cohort seats share one tree per repo, so seat B can reach the pointer
    // seat A parked. `agent_source` was recorded but never consulted.
    recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(SESSION_A, 'seat-a'),
    });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 60_000,
      env: env(SESSION_A, 'seat-b'),
    });
    expect(derive.correlationId).toBeUndefined();
    expect(ledgerLines()[1]!.agent_source).toBe('seat-b');
  });

  it('is fail-CLOSED when either side carries no session id', () => {
    // A hookless run must not inherit whatever pointer is lying around.
    recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: { TOTEM_SELF_AGENT: 'seat-a' },
    });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 1000,
      env: { TOTEM_SELF_AGENT: 'seat-a' },
    });
    expect(derive.correlationId).toBeUndefined();
  });
});

describe('consume-on-use — one query grounds ONE derive', () => {
  it('does not let a single query credit an unbounded run of derives', () => {
    const query = recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });

    const first = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 1000,
      env: env(),
    });
    expect(first.correlationId).toBe(query.correlationId);

    // Every subsequent derive is uncorrelated — the query was already spent.
    for (let i = 2; i <= 5; i++) {
      const next = recordDeriveAction({
        totemDir,
        source: 'lint',
        surface: 'spec',
        nowMs: T0 + i * 1000,
        env: env(),
      });
      expect(next.correlationId).toBeUndefined();
    }

    const derives = ledgerLines().filter((r) => r.type === 'derive_action');
    expect(derives).toHaveLength(5);
    expect(derives.filter((r) => r.qbd_correlation_id !== undefined)).toHaveLength(1);
  });

  it('re-arms after a fresh query', () => {
    recordCorpusQuery({ totemDir, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() });
    recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 1000,
      env: env(),
    });
    const second = recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0 + 2000,
      env: env(),
    });
    const derive = recordDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 3000,
      env: env(),
    });
    expect(derive.correlationId).toBe(second.correlationId);
  });
});

describe('induced failure — forged correlation pointer (ADR-115 § 2)', () => {
  it('throws the loud backstop, still records the derive, and recovers', () => {
    // ── Control: a healthy run correlates cleanly and warns about nothing.
    recordCorpusQuery({ totemDir, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() });
    const healthy = senseDeriveAction({
      totemDir,
      source: 'lint',
      surface: 'spec',
      nowMs: T0 + 1000,
      env: env(),
    });
    expect(healthy.correlationId).toBeDefined();
    expect(healthy.warnings).toEqual([]);

    // ── Induce: park an ID minted AFTER the derive that will claim it. This is
    // the post-hoc correlation shape — an ID that did not exist when the derive
    // ran cannot have grounded it.
    const forged = mintQbdCorrelationId(T0 + 3_600_000);
    writeForgedPointer(forged, T0 + 3_600_000);

    // Pack 2 — the loud backstop THROWS on the mutating path.
    let thrown: unknown;
    try {
      recordDeriveAction({
        totemDir,
        source: 'lint',
        surface: 'spec',
        nowMs: T0 + 2000,
        env: env(),
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TotemError);
    expect((thrown as TotemError).code).toBe('QBD_CORRELATION_CONTRACT');
    expect((thrown as TotemError).message).toContain('derive-id-minted-after-derive');

    // Prior-good state preserved: the derive row IS on disk, uncorrelated — the
    // denominator never shrinks because someone tampered with the sensor, and
    // the forged ID was never persisted.
    const afterThrow = ledgerLines();
    const lastRow = afterThrow[afterThrow.length - 1]!;
    expect(lastRow.type).toBe('derive_action');
    expect(lastRow.qbd_correlation_id).toBeUndefined();
    expect(afterThrow.some((r) => r.qbd_correlation_id === forged)).toBe(false);

    // Pack 1 — per-item accounting fires on the sensor path, naming the item,
    // and the instrumented command is NOT broken (no throw).
    const warnings: string[] = [];
    const sensed = senseDeriveAction(
      { totemDir, source: 'lint', surface: 'spec', nowMs: T0 + 3000, env: env() },
      (msg) => warnings.push(msg),
    );
    expect(sensed.written).toBe(true);
    expect(sensed.correlationId).toBeUndefined();
    expect(warnings.some((w) => w.includes('derive-id-minted-after-derive'))).toBe(true);

    // Pack 3 — recovery: remove the fault, and the same call returns to green.
    fs.rmSync(pointerFile());
    recordCorpusQuery({
      totemDir,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0 + 4000,
      env: env(),
    });
    const recoveredWarnings: string[] = [];
    const recovered = senseDeriveAction(
      { totemDir, source: 'lint', surface: 'spec', nowMs: T0 + 5000, env: env() },
      (msg) => recoveredWarnings.push(msg),
    );
    expect(recovered.correlationId).toBeDefined();
    expect(recoveredWarnings).toEqual([]);
  });

  it('names a malformed pointer without breaking the command', () => {
    fs.mkdirSync(path.join(totemDir, 'ledger'), { recursive: true });
    fs.writeFileSync(pointerFile(), '{not json', 'utf-8');

    const warnings: string[] = [];
    const result = senseDeriveAction(
      { totemDir, source: 'lint', surface: 'orient', nowMs: T0, env: env() },
      (msg) => warnings.push(msg),
    );

    expect(result.written).toBe(true);
    expect(warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
    expect(ledgerLines()).toHaveLength(1);
  });
});

describe('not an instrumented project', () => {
  it('records nothing and warns about nothing when there is no .totem directory', () => {
    // The derive-class commands run from anywhere. A sensor that materialised a
    // stray `.totem/ledger/` in an unrelated directory would be a side effect,
    // not a measurement. Absent totemDir is a NORMAL state, so: silent skip.
    const absent = path.join(totemDir, 'no-such-project');

    const warnings: string[] = [];
    const result = senseDeriveAction(
      { totemDir: absent, source: 'lint', surface: 'orient', nowMs: T0, env: env() },
      (msg) => warnings.push(msg),
    );

    expect(result.written).toBe(false);
    expect(result.skipped).toBe(true);
    expect(warnings).toEqual([]);
    expect(fs.existsSync(absent)).toBe(false);
  });

  it('does not treat a FILE at the totemDir path as a project', () => {
    const asFile = path.join(totemDir, 'dot-totem-is-a-file');
    fs.writeFileSync(asFile, 'not a directory', 'utf-8');

    const result = senseCorpusQuery({
      totemDir: asFile,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });
    expect(result.skipped).toBe(true);
  });
});

describe('induced failure — unwritable ledger (ADR-115 § 2)', () => {
  /**
   * Induce a REAL errno inside a genuine project: totemDir exists as a
   * directory, but the `ledger` path it must create is occupied by a FILE, so
   * `mkdirSync` fails. This is a degradation (unlike an absent project) and
   * must therefore be reported, not skipped.
   */
  function blockedProject(): string {
    const root = path.join(totemDir, 'blocked-project');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'ledger'), 'not a directory', 'utf-8');
    return root;
  }

  it('reports the write failure per-item and never breaks the instrumented command', () => {
    const blocked = blockedProject();

    const warnings: string[] = [];
    const result = senseCorpusQuery(
      { totemDir: blocked, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() },
      (msg) => warnings.push(msg),
    );

    // Pack 1 — accounting fires and names the failing subsystem AND the real
    // underlying errno. Asserting only the unconditional `query-before-derive:`
    // prefix would pass even if the message carried no diagnosis at all, so pin
    // the errno the OS actually raised (ENOTDIR on POSIX, EEXIST on Windows).
    expect(result.written).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('query-before-derive');
    expect(warnings[0]).toMatch(/ENOTDIR|EEXIST|ENOENT/);

    // Pack 2 — for this sensor the "backstop" contract is that the failure is
    // LOUD (surfaced above) while the instrumented command survives: sensor
    // failure is not command failure (Tenet 13). No throw escaped.
    expect(() =>
      senseCorpusQuery({
        totemDir: blocked,
        source: 'lint',
        surface: 'totem_search',
        nowMs: T0,
        env: env(),
      }),
    ).not.toThrow();

    // Pack 3 — recovery: a writable totemDir records cleanly again.
    const recoveredWarnings: string[] = [];
    const recovered = senseCorpusQuery(
      { totemDir, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() },
      (msg) => recoveredWarnings.push(msg),
    );
    expect(recovered.written).toBe(true);
    expect(recoveredWarnings).toEqual([]);
  });

  it('reports the derive write failure ONCE, on every platform', () => {
    // Cross-platform pin. Probing `<blocked>/ledger/.qbd-correlation` when
    // `ledger` is a file raises ENOTDIR on POSIX and ENOENT on Windows. Both
    // mean "no pointer here", so the pointer read must stay silent on both and
    // the ONLY warning is the ledger write failure. Counting warnings (rather
    // than matching one) is what makes a platform-specific extra warning fail.
    const blocked = blockedProject();

    const warnings: string[] = [];
    const result = senseDeriveAction(
      { totemDir: blocked, source: 'lint', surface: 'spec', nowMs: T0, env: env() },
      (msg) => warnings.push(msg),
    );

    expect(result.written).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('query-before-derive');
    expect(warnings[0]).not.toContain('pointer unreadable');
    // And never the session-id layer throwing before the write path is reached.
    expect(warnings[0]).not.toContain('Unexpected error reading session ID');
  });

  it('survives a POSIX-style ENOTDIR from the session-id probe (CI reproduction)', () => {
    // This IS the ubuntu/macos CI failure, reproduced on any platform.
    //
    // With `ledger` occupied by a file, POSIX raises ENOTDIR when statting
    // `<blocked>/ledger/.session-id`. `session-id.ts` did not list ENOTDIR as a
    // benign errno, so it threw "Unexpected error reading session ID" from the
    // session-id layer BEFORE the ledger write path — and its errno-bearing
    // accounting — ever ran. Windows raises ENOENT for the identical state, so
    // the whole suite passed locally and failed on two other platforms.
    //
    // Only the `.session-id` probe is faked: `isInstrumentedProject` also uses
    // statSync, and faking that too would make the writer skip and prove
    // nothing.
    const blocked = blockedProject();
    const realStatSync = fs.statSync.bind(fs);
    const spy = vi.spyOn(fs, 'statSync').mockImplementation(((target: fs.PathLike) => {
      if (String(target).endsWith('.session-id')) {
        const err = new Error('not a directory') as NodeJS.ErrnoException;
        err.code = 'ENOTDIR';
        throw err;
      }
      return realStatSync(target);
    }) as typeof fs.statSync);

    try {
      const warnings: string[] = [];
      const result = senseCorpusQuery(
        { totemDir: blocked, source: 'lint', surface: 'totem_search', nowMs: T0, env: env() },
        (msg) => warnings.push(msg),
      );

      expect(result.written).toBe(false);
      expect(warnings).toHaveLength(1);
      // The ledger write's real errno, NOT the session-id layer throwing.
      expect(warnings[0]).toMatch(/ENOTDIR|EEXIST|ENOENT/);
      expect(warnings[0]).not.toContain('Unexpected error reading session ID');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not park a correlation pointer when the query row failed to write', () => {
    // Otherwise a later derive would cite a query row that does not exist —
    // manufacturing an orphan correlation out of a write failure.
    const blocked = blockedProject();

    senseCorpusQuery({
      totemDir: blocked,
      source: 'lint',
      surface: 'totem_search',
      nowMs: T0,
      env: env(),
    });
    expect(fs.existsSync(path.join(blocked, 'ledger', '.qbd-correlation'))).toBe(false);
  });
});

describe('resolveQbdAgentSource', () => {
  it('takes the first non-empty comma-separated seat', () => {
    expect(resolveQbdAgentSource({ TOTEM_SELF_AGENT: ' , totem-gemini , extra' })).toBe(
      'totem-gemini',
    );
  });

  it('is undefined when unset or blank', () => {
    expect(resolveQbdAgentSource({})).toBeUndefined();
    expect(resolveQbdAgentSource({ TOTEM_SELF_AGENT: '   ' })).toBeUndefined();
  });
});

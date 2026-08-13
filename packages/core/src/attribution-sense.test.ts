/**
 * Tests for the agent-attribution provenance sense (mmnto-ai/totem#2629).
 *
 * The invariants under test come verbatim from the design doc
 * (.totem/specs/2629.md § Invariants):
 *
 *  - provenance biconditional: `'env'` iff `agent_source` is non-null;
 *  - the fail-closed rule fires ONLY on positive disagreement (env seat and
 *    minting seat both present, different) — and then withholds attribution,
 *    names both candidates, and never throws into the caller;
 *  - missing counter-evidence (no pointer, no mint row, unseated mint row,
 *    absent ledger) never strips the env stamp;
 *  - a failed probe keeps the env stamp and NAMES itself (never silent,
 *    never counter-evidence);
 *  - derivation is per call — a conflict introduced between two calls is
 *    caught on the second (no cache at any layer);
 *  - the minting-seat lookup takes the newest matching `session_start`, skips
 *    malformed lines, and treats an absent ledger as not-found.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so spyOn works in ESM — same pattern as session-id.test.ts.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { readSessionMintingSeat, senseAgentAttribution } from './attribution-sense.js';
import { TotemError } from './errors.js';
import { cleanTmpDir } from './test-utils.js';

const SESSION_A = '550e8400-e29b-41d4-a716-446655440000';
const SESSION_B = '550e8400-e29b-41d4-a716-446655440009';

let totemDir: string;

function ledgerDir(): string {
  return path.join(totemDir, 'ledger');
}

function writePointer(id: string): void {
  fs.mkdirSync(ledgerDir(), { recursive: true });
  fs.writeFileSync(path.join(ledgerDir(), '.session-id'), id, 'utf-8');
}

function eventsPath(): string {
  return path.join(ledgerDir(), 'events.ndjson');
}

function writeEvents(lines: Array<Record<string, unknown> | string>): void {
  fs.mkdirSync(ledgerDir(), { recursive: true });
  const content = lines
    .map((l) => (typeof l === 'string' ? l : JSON.stringify(l)))
    .join('\n')
    .concat('\n');
  fs.writeFileSync(eventsPath(), content, 'utf-8');
}

function sessionStartRow(sessionId: string, seat?: string): Record<string, unknown> {
  return {
    timestamp: '2026-08-12T03:03:00.000Z',
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    justification: '',
    session_id: sessionId,
    ...(seat !== undefined && { agent_source: seat }),
  };
}

beforeEach(() => {
  totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attr-sense-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanTmpDir(totemDir);
});

// ─── readSessionMintingSeat ─────────────────────────────

describe('readSessionMintingSeat', () => {
  it('finds the mint row and returns its seat', () => {
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({
      found: true,
      seat: 'totem-claude',
    });
  });

  it('an unseated mint row is found with seat null (stamped absence, not a fabricated seat)', () => {
    writeEvents([sessionStartRow(SESSION_A)]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: true, seat: null });
  });

  it('a whitespace-only agent_source on the mint row reads as seat null', () => {
    writeEvents([sessionStartRow(SESSION_A, '   ')]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: true, seat: null });
  });

  it('returns not-found when the events file is absent (the honest not-instrumented state)', () => {
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: false });
  });

  it('returns not-found when no session_start matches the id', () => {
    writeEvents([sessionStartRow(SESSION_B, 'totem-claude')]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: false });
  });

  it('a non-session_start row carrying the same session id is not a mint row', () => {
    writeEvents([
      {
        timestamp: '2026-08-12T03:04:00.000Z',
        type: 'mcp_call',
        activity_name: 'search_knowledge — "session_start"',
        source: 'bot',
        justification: '',
        session_id: SESSION_A,
      },
    ]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: false });
  });

  it('the NEWEST matching session_start wins', () => {
    writeEvents([sessionStartRow(SESSION_A, 'seat-old'), sessionStartRow(SESSION_A, 'seat-new')]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: true, seat: 'seat-new' });
  });

  it('skips torn/malformed lines — a torn mint row reads as not-found, an earlier valid one still resolves', () => {
    // The torn line contains both prefilter literals, so it reaches JSON.parse.
    writeEvents([
      sessionStartRow(SESSION_A, 'totem-claude'),
      `{"type":"session_start","session_id":"${SESSION_A}","agent_source":"torn-`,
    ]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({
      found: true,
      seat: 'totem-claude',
    });

    writeEvents([`{"type":"session_start","session_id":"${SESSION_A}","agent_source":"torn-`]);
    expect(readSessionMintingSeat(totemDir, SESSION_A)).toEqual({ found: false });
  });

  it('throws a TotemError on a non-benign read failure (EACCES is a probe failure, not absence)', () => {
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    try {
      readSessionMintingSeat(totemDir, SESSION_A);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemError);
      expect((err as TotemError).code).toBe('ATTRIBUTION_SENSE_LEDGER_READ_FAILED');
    }
  });
});

// ─── senseAgentAttribution ──────────────────────────────

describe('senseAgentAttribution', () => {
  it('absent env → stamped absence, even over a foreign-minted pointer (one candidate is not a conflict)', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    const sense = senseAgentAttribution({ totemDir, env: {} });
    expect(sense).toEqual({ agent_source: null, agent_source_provenance: 'absent' });
  });

  it('env-only call (no totemDir) stamps env with provenance and touches no fs', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    const statSpy = vi.spyOn(fs, 'statSync');
    const sense = senseAgentAttribution({ env: { TOTEM_SELF_AGENT: 'totem-claude' } });
    expect(sense).toEqual({ agent_source: 'totem-claude', agent_source_provenance: 'env' });
    expect(readSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
  });

  it('takes the first non-empty seat from a comma-separated TOTEM_SELF_AGENT', () => {
    const sense = senseAgentAttribution({ env: { TOTEM_SELF_AGENT: ' , totem-gemini , extra' } });
    expect(sense.agent_source).toBe('totem-gemini');
    expect(sense.agent_source_provenance).toBe('env');
  });

  it('no pointer → no counter-candidate — env stamp stands', () => {
    const sense = senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-gemini' } });
    expect(sense).toEqual({ agent_source: 'totem-gemini', agent_source_provenance: 'env' });
  });

  it('pointer minted by the SAME seat → agreement, env stamp, no conflict', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    const sense = senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-claude' } });
    expect(sense).toEqual({ agent_source: 'totem-claude', agent_source_provenance: 'env' });
  });

  it('mint row without a seat → no counter-evidence — env stamp stands (the ACTUAL b8d7aa9b specimen shape)', () => {
    // Honest coverage note (leg finding on this PR): the live specimen's mint
    // row carries NO agent_source (minted 03:03Z; the ledger proves only that
    // the minting process's env lacked the var, not why), so in the
    // contamination window this sensor would have stamped the ambient seat
    // with provenance 'env' and NO conflict — ruled item 2 fires only on
    // disagreement between two PRESENT candidates. The ambient-scope class
    // where every mint agrees with the env is sensed by doctor arm (d) + the
    // launch-shell protocol, not by this predicate.
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A)]);
    const sense = senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-gemini' } });
    expect(sense).toEqual({ agent_source: 'totem-gemini', agent_source_provenance: 'env' });
  });

  it('FAIL-CLOSED: env seat ≠ minting seat → stamp neither, name both (a seated foreign-pointer join)', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    const sense = senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-gemini' } });
    expect(sense).toEqual({
      agent_source: null,
      agent_source_provenance: 'absent',
      attribution_conflict: {
        env_seat: 'totem-gemini',
        minting_seat: 'totem-claude',
        pointer_session_id: SESSION_A,
      },
    });
  });

  it('a handed pointerSessionId is probed instead of the pointer file (no rotation race)', () => {
    // Pointer file says SESSION_A (minted by the env seat — agreement); the
    // caller hands SESSION_B (minted by a different seat). The probe must
    // check the handed id — the session the caller's row actually joins.
    writePointer(SESSION_A);
    writeEvents([
      sessionStartRow(SESSION_A, 'totem-gemini'),
      sessionStartRow(SESSION_B, 'totem-claude'),
    ]);
    const sense = senseAgentAttribution({
      totemDir,
      env: { TOTEM_SELF_AGENT: 'totem-gemini' },
      pointerSessionId: SESSION_B,
    });
    expect(sense.attribution_conflict).toEqual({
      env_seat: 'totem-gemini',
      minting_seat: 'totem-claude',
      pointer_session_id: SESSION_B,
    });
  });

  it('NEVER REMEMBERED: a conflict introduced between two calls is caught on the second', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-gemini')]);
    const env = { TOTEM_SELF_AGENT: 'totem-gemini' };
    const first = senseAgentAttribution({ totemDir, env });
    expect(first.agent_source).toBe('totem-gemini');
    expect(first.attribution_conflict).toBeUndefined();

    // A foreign seat's SessionStart rotates the shared pointer mid-session.
    writePointer(SESSION_B);
    writeEvents([
      sessionStartRow(SESSION_A, 'totem-gemini'),
      sessionStartRow(SESSION_B, 'totem-claude'),
    ]);
    const second = senseAgentAttribution({ totemDir, env });
    expect(second.agent_source).toBeNull();
    expect(second.attribution_conflict).toEqual({
      env_seat: 'totem-gemini',
      minting_seat: 'totem-claude',
      pointer_session_id: SESSION_B,
    });
  });

  it('a failed probe keeps the env stamp and NAMES itself — never silent, never counter-evidence, never a throw', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    // Only the events.ndjson read is faked; the pointer read stays real (the
    // qbd/record.test.ts selective-fake pattern).
    const realRead = fs.readFileSync.bind(fs);
    vi.spyOn(fs, 'readFileSync').mockImplementation(((target: unknown, ...rest: unknown[]) => {
      if (String(target).endsWith('events.ndjson')) {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return (realRead as (...args: unknown[]) => unknown)(target, ...rest);
    }) as never);

    const sense = senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-gemini' } });
    expect(sense.agent_source).toBe('totem-gemini');
    expect(sense.agent_source_provenance).toBe('env');
    expect(sense.attribution_conflict).toBeUndefined();
    expect(sense.attribution_probe_error).toContain('EACCES');
  });

  it('provenance biconditional holds across every arm above', () => {
    writePointer(SESSION_A);
    writeEvents([sessionStartRow(SESSION_A, 'totem-claude')]);
    const cases = [
      senseAgentAttribution({ env: {} }),
      senseAgentAttribution({ env: { TOTEM_SELF_AGENT: 'totem-claude' } }),
      senseAgentAttribution({ totemDir, env: {} }),
      senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-claude' } }),
      senseAgentAttribution({ totemDir, env: { TOTEM_SELF_AGENT: 'totem-gemini' } }),
    ];
    for (const sense of cases) {
      expect(sense.agent_source_provenance === 'env').toBe(sense.agent_source !== null);
    }
  });
});

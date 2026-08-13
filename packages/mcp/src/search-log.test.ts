import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveSearchLogAttribution,
  logSearch,
  type SearchLogEntry,
  setLogDir,
} from './search-log.js';

const SESSION_A = '550e8400-e29b-41d4-a716-446655440000';

/** Windows-safe teardown options — retries ride out transient ENOTEMPTY. */
const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;

/** Pointer at SESSION_A minted by `mintSeat` — the #2629 contamination fixture. */
function contaminatedTotemDir(mintSeat: string): string {
  const totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-log-attr-'));
  const ledgerDir = path.join(totemDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, '.session-id'), SESSION_A, 'utf-8');
  fs.writeFileSync(
    path.join(ledgerDir, 'events.ndjson'),
    JSON.stringify({
      timestamp: '2026-08-12T03:03:00.000Z',
      type: 'session_start',
      activity_name: 'SessionStart',
      source: 'bot',
      justification: '',
      session_id: SESSION_A,
      agent_source: mintSeat,
    }) + '\n',
    'utf-8',
  );
  return totemDir;
}

// ─── deriveSearchLogAttribution (env-only calls stay pure) ───

describe('deriveSearchLogAttribution', () => {
  it('stamps all fields from the environment when present, with env provenance', () => {
    const attribution = deriveSearchLogAttribution({
      TOTEM_SELF_AGENT: 'totem-claude',
      TOTEM_SESSION_ID: 'sess-123',
      TOTEM_CORRELATION_ID: 'corr-abc',
    });
    expect(attribution).toEqual({
      agent_source: 'totem-claude',
      agent_source_provenance: 'env',
      session_id: 'sess-123',
      correlation_id: 'corr-abc',
    });
  });

  it('stamps null + absent provenance when the env is absent (Tenet 4 — never guess)', () => {
    expect(deriveSearchLogAttribution({})).toEqual({
      agent_source: null,
      agent_source_provenance: 'absent',
      session_id: null,
      correlation_id: null,
    });
  });

  it('stamps null per-field independently (partial env)', () => {
    const attribution = deriveSearchLogAttribution({ TOTEM_SESSION_ID: 'only-session' });
    expect(attribution.agent_source).toBeNull();
    expect(attribution.agent_source_provenance).toBe('absent');
    expect(attribution.session_id).toBe('only-session');
    expect(attribution.correlation_id).toBeNull();
  });

  it('treats whitespace-only env values as absent → null', () => {
    const attribution = deriveSearchLogAttribution({
      TOTEM_SELF_AGENT: '   ',
      TOTEM_SESSION_ID: '\t',
      TOTEM_CORRELATION_ID: '',
    });
    expect(attribution).toEqual({
      agent_source: null,
      agent_source_provenance: 'absent',
      session_id: null,
      correlation_id: null,
    });
  });

  it('takes the first non-empty seat from a comma-separated TOTEM_SELF_AGENT', () => {
    // Mirrors resolveSelfAgents' comma parsing — the MCP server runs under a
    // single seat, so the first entry is that seat.
    expect(
      deriveSearchLogAttribution({ TOTEM_SELF_AGENT: ' , totem-gemini , extra' }).agent_source,
    ).toBe('totem-gemini');
  });
});

// ─── #2629 fail-closed conflict (totemDir-armed calls) ───

describe('deriveSearchLogAttribution conflict sense (#2629)', () => {
  let totemDir: string;

  afterEach(() => {
    fs.rmSync(totemDir, RM_OPTS);
  });

  it('FAIL-CLOSED: env seat ≠ pointer minting seat → stamp neither, name both', () => {
    totemDir = contaminatedTotemDir('totem-claude');
    const attribution = deriveSearchLogAttribution({ TOTEM_SELF_AGENT: 'totem-gemini' }, totemDir);
    expect(attribution.agent_source).toBeNull();
    expect(attribution.agent_source_provenance).toBe('absent');
    expect(attribution.attribution_conflict).toEqual({
      env_seat: 'totem-gemini',
      minting_seat: 'totem-claude',
      pointer_session_id: SESSION_A,
    });
  });

  it('agreement keeps the env stamp — no conflict fabricated', () => {
    totemDir = contaminatedTotemDir('totem-claude');
    const attribution = deriveSearchLogAttribution({ TOTEM_SELF_AGENT: 'totem-claude' }, totemDir);
    expect(attribution.agent_source).toBe('totem-claude');
    expect(attribution.agent_source_provenance).toBe('env');
    expect(attribution.attribution_conflict).toBeUndefined();
  });
});

// ─── logSearch stamping (no setLogDir → in-memory only, no fs) ───

describe('logSearch attribution stamp', () => {
  const ENV_KEYS = ['TOTEM_SELF_AGENT', 'TOTEM_SESSION_ID', 'TOTEM_CORRELATION_ID'] as const;
  const saved: Record<string, string | undefined> = {};

  const baseEntry: SearchLogEntry = {
    timestamp: '2026-07-15T00:00:00.000Z',
    query: 'q',
    resultCount: 0,
    durationMs: 1,
    topScore: null,
  };

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('stamps the trio + env provenance from process.env onto the returned entry', () => {
    process.env.TOTEM_SELF_AGENT = 'totem-claude';
    process.env.TOTEM_SESSION_ID = 'sess-9';
    process.env.TOTEM_CORRELATION_ID = 'corr-9';
    const stamped = logSearch({ ...baseEntry });
    expect(stamped.agent_source).toBe('totem-claude');
    expect(stamped.agent_source_provenance).toBe('env');
    expect(stamped.session_id).toBe('sess-9');
    expect(stamped.correlation_id).toBe('corr-9');
  });

  it('stamps explicit null + absent provenance on every field when the env is absent', () => {
    const stamped = logSearch({ ...baseEntry });
    expect(stamped.agent_source).toBeNull();
    expect(stamped.agent_source_provenance).toBe('absent');
    expect(stamped.session_id).toBeNull();
    expect(stamped.correlation_id).toBeNull();
  });

  it('a caller-supplied conflict/provenance never displaces the stamp — absence from the sense is authoritative too', () => {
    process.env.TOTEM_SELF_AGENT = 'totem-claude';
    const stamped = logSearch({
      ...baseEntry,
      agent_source: 'forged-seat',
      agent_source_provenance: 'absent',
      attribution_conflict: {
        env_seat: 'forged-a',
        minting_seat: 'forged-b',
        pointer_session_id: SESSION_A,
      },
      attribution_probe_error: 'forged failure',
    });
    expect(stamped.agent_source).toBe('totem-claude');
    expect(stamped.agent_source_provenance).toBe('env');
    // Clean sense → explicit undefined displaces the forged values, and
    // JSON.stringify (the persistence shape) drops the keys entirely.
    expect(stamped.attribution_conflict).toBeUndefined();
    expect(stamped.attribution_probe_error).toBeUndefined();
    expect(JSON.parse(JSON.stringify(stamped))).not.toHaveProperty('attribution_conflict');
  });

  // The setLogDir tests sit LAST in this file deliberately: setLogDir sets
  // module-level state the earlier no-fs describes rely on being unset.
  it('SEAM-LEVEL invariant 10: with every probe failing (events.ndjson is a directory), logSearch still records, stamps env, and names the failure', () => {
    const totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-log-probe-'));
    try {
      const ledgerDir = path.join(totemDir, 'ledger');
      // A DIRECTORY where the events file should be — EISDIR on read, the
      // non-benign probe-failure class (not the honest-absence ENOENT set).
      fs.mkdirSync(path.join(ledgerDir, 'events.ndjson'), { recursive: true });
      fs.writeFileSync(path.join(ledgerDir, '.session-id'), SESSION_A, 'utf-8');
      process.env.TOTEM_SELF_AGENT = 'totem-claude';
      setLogDir(totemDir);
      const stamped = logSearch({ ...baseEntry });
      expect(stamped.agent_source).toBe('totem-claude');
      expect(stamped.agent_source_provenance).toBe('env');
      expect(stamped.attribution_conflict).toBeUndefined();
      expect(stamped.attribution_probe_error).toContain('events.ndjson');
    } finally {
      fs.rmSync(totemDir, RM_OPTS);
    }
  });

  it('with setLogDir armed, a contaminated ledger produces a conflict row and the call still succeeds', () => {
    const totemDir = contaminatedTotemDir('totem-claude');
    try {
      process.env.TOTEM_SELF_AGENT = 'totem-gemini';
      setLogDir(totemDir);
      const stamped = logSearch({ ...baseEntry });
      expect(stamped.agent_source).toBeNull();
      expect(stamped.agent_source_provenance).toBe('absent');
      expect(stamped.attribution_conflict).toEqual({
        env_seat: 'totem-gemini',
        minting_seat: 'totem-claude',
        pointer_session_id: SESSION_A,
      });
    } finally {
      fs.rmSync(totemDir, RM_OPTS);
    }
  });
});

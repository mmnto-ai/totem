import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveSearchLogAttribution, logSearch, type SearchLogEntry } from './search-log.js';

// ─── deriveSearchLogAttribution (pure — env in, trio out) ───

describe('deriveSearchLogAttribution', () => {
  it('stamps all three fields from the environment when present', () => {
    const attribution = deriveSearchLogAttribution({
      TOTEM_SELF_AGENT: 'totem-claude',
      TOTEM_SESSION_ID: 'sess-123',
      TOTEM_CORRELATION_ID: 'corr-abc',
    });
    expect(attribution).toEqual({
      agent_source: 'totem-claude',
      session_id: 'sess-123',
      correlation_id: 'corr-abc',
    });
  });

  it('stamps null for every field when the env is absent (Tenet 4 — never guess)', () => {
    expect(deriveSearchLogAttribution({})).toEqual({
      agent_source: null,
      session_id: null,
      correlation_id: null,
    });
  });

  it('stamps null per-field independently (partial env)', () => {
    const attribution = deriveSearchLogAttribution({ TOTEM_SESSION_ID: 'only-session' });
    expect(attribution.agent_source).toBeNull();
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

  it('stamps the trio from process.env onto the returned entry', () => {
    process.env.TOTEM_SELF_AGENT = 'totem-claude';
    process.env.TOTEM_SESSION_ID = 'sess-9';
    process.env.TOTEM_CORRELATION_ID = 'corr-9';
    const stamped = logSearch({ ...baseEntry });
    expect(stamped.agent_source).toBe('totem-claude');
    expect(stamped.session_id).toBe('sess-9');
    expect(stamped.correlation_id).toBe('corr-9');
  });

  it('stamps explicit null on every field when the env is absent', () => {
    const stamped = logSearch({ ...baseEntry });
    expect(stamped.agent_source).toBeNull();
    expect(stamped.session_id).toBeNull();
    expect(stamped.correlation_id).toBeNull();
  });
});

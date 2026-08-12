/**
 * Tests for the declared seat-lifecycle markers (mmnto-ai/totem#2511).
 *
 * Filesystem-driven against real temp trees, mirroring
 * `orchestration-resolver.test.ts` so the two seat-surface suites stay
 * symmetric. The load-bearing invariants here are the fail-open read (a
 * corrupt marker degrades to `active` and says so, naming the file) and the
 * structural exclusion of session-state vocabulary from the marker schema.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemError } from './errors.js';
import {
  deriveSeatStatuses,
  readSeatLifecycle,
  SEAT_LIFECYCLE_FILENAME,
  SEAT_LIFECYCLE_SCHEMA_VERSION,
  type SeatLifecycleMarker,
  SeatLifecycleMarkerSchema,
  writeSeatLifecycle,
} from './seat-lifecycle.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;
let repoRoot: string;

const SINCE = '2026-08-11T04:00:00Z';

function markerPath(seat: string): string {
  return path.join(repoRoot, '.totem', 'orchestration', seat, SEAT_LIFECYCLE_FILENAME);
}

/** Create the seat dir (the registration) without writing any marker. */
function mkSeat(seat: string): void {
  fs.mkdirSync(path.join(repoRoot, '.totem', 'orchestration', seat), { recursive: true });
}

/** Plant raw bytes as a seat's marker — the corrupt-file fixture. */
function plantRawMarker(seat: string, contents: string): void {
  mkSeat(seat);
  fs.writeFileSync(markerPath(seat), contents, 'utf-8');
}

function marker(overrides: Partial<SeatLifecycleMarker> = {}): SeatLifecycleMarker {
  return {
    schemaVersion: SEAT_LIFECYCLE_SCHEMA_VERSION,
    state: 'active',
    since: SINCE,
    ...overrides,
  };
}

beforeEach(() => {
  // totem-context: test fixture only; agents do not consume this temp dir.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-seat-'));
  repoRoot = path.join(tmpRoot, 'r');
  fs.mkdirSync(repoRoot, { recursive: true });
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// ─── Absent marker ─────────────────────────────────────────────────────────

describe('readSeatLifecycle — absent marker', () => {
  it('reports active/default-active with NO warning when the seat has no marker', () => {
    mkSeat('a-seat');
    const result = readSeatLifecycle(repoRoot, 'a-seat');
    expect(result.state).toBe('active');
    expect(result.source).toBe('default-active');
    expect(result.warning).toBeUndefined();
    expect(result.marker).toBeUndefined();
  });

  it('reports active/default-active with no warning when the whole tree is absent', () => {
    const result = readSeatLifecycle(repoRoot, 'never-written');
    expect(result.state).toBe('active');
    expect(result.source).toBe('default-active');
    expect(result.warning).toBeUndefined();
  });
});

// ─── Corrupt marker: fail open, name the file ──────────────────────────────

describe('readSeatLifecycle — unusable marker', () => {
  it('degrades malformed JSON to active with a warning naming the marker path', () => {
    plantRawMarker('a-seat', '{ this is not json');
    const result = readSeatLifecycle(repoRoot, 'a-seat');
    expect(result.state).toBe('active');
    expect(result.source).toBe('default-active');
    expect(result.warning).toContain(markerPath('a-seat'));
    expect(result.warning).toContain('fix or delete the marker');
  });

  it('degrades a schema-invalid marker to active with a warning naming the marker path', () => {
    plantRawMarker('a-seat', JSON.stringify({ schemaVersion: 1, state: 'LIVE', since: SINCE }));
    const result = readSeatLifecycle(repoRoot, 'a-seat');
    expect(result.state).toBe('active');
    expect(result.source).toBe('default-active');
    expect(result.warning).toContain(markerPath('a-seat'));
  });

  it('degrades a corrupt RETIRED marker to active — fails toward obligation-held', () => {
    plantRawMarker('a-seat', '{"schemaVersion":1,"state":"retired"');
    const result = readSeatLifecycle(repoRoot, 'a-seat');
    expect(result.state).toBe('active');
    expect(result.warning).toContain(markerPath('a-seat'));
  });
});

// ─── Schema: the axis ruling, made structural ──────────────────────────────

describe('SeatLifecycleMarkerSchema', () => {
  it.each(['LIVE', 'IDLE', 'FAULTED'])('rejects session-state vocabulary as state: %s', (state) => {
    expect(
      SeatLifecycleMarkerSchema.safeParse({ schemaVersion: 1, state, since: SINCE }).success,
    ).toBe(false);
  });

  it('accepts each declared lifecycle state', () => {
    for (const state of ['active', 'suspended', 'retired'] as const) {
      expect(SeatLifecycleMarkerSchema.safeParse(marker({ state })).success).toBe(true);
    }
  });

  it('rejects unknown keys — no session state smuggled in as a sibling field', () => {
    expect(SeatLifecycleMarkerSchema.safeParse({ ...marker(), sessionState: 'LIVE' }).success).toBe(
      false,
    );
  });

  it('rejects a schemaVersion other than 1', () => {
    expect(SeatLifecycleMarkerSchema.safeParse({ ...marker(), schemaVersion: 2 }).success).toBe(
      false,
    );
  });

  it('rejects an empty or whitespace-only `by`', () => {
    expect(SeatLifecycleMarkerSchema.safeParse({ ...marker(), by: '' }).success).toBe(false);
    expect(SeatLifecycleMarkerSchema.safeParse({ ...marker(), by: '   ' }).success).toBe(false);
  });

  it('rejects a non-ISO-8601 `since`', () => {
    expect(SeatLifecycleMarkerSchema.safeParse({ ...marker(), since: '2026-08-11' }).success).toBe(
      false,
    );
  });
});

// ─── Write → read round-trip ───────────────────────────────────────────────

describe('writeSeatLifecycle', () => {
  it.each(['active', 'suspended', 'retired'] as const)('round-trips state %s', (state) => {
    writeSeatLifecycle(repoRoot, 'a-seat', marker({ state, by: 'totem-claude', reason: 'ruled' }));
    const result = readSeatLifecycle(repoRoot, 'a-seat');
    expect(result.state).toBe(state);
    expect(result.source).toBe('marker');
    expect(result.marker).toEqual({
      schemaVersion: SEAT_LIFECYCLE_SCHEMA_VERSION,
      state,
      since: SINCE,
      by: 'totem-claude',
      reason: 'ruled',
    });
  });

  it('omits `by` entirely when the caller did not resolve one — never fabricated', () => {
    writeSeatLifecycle(repoRoot, 'a-seat', marker({ state: 'suspended' }));
    const raw: unknown = JSON.parse(fs.readFileSync(markerPath('a-seat'), 'utf-8'));
    expect(Object.keys(raw as Record<string, unknown>).sort()).toEqual([
      'schemaVersion',
      'since',
      'state',
    ]);
    // The written bytes round-trip the STRICT schema — no field the reader rejects.
    expect(SeatLifecycleMarkerSchema.safeParse(raw).success).toBe(true);
    expect(readSeatLifecycle(repoRoot, 'a-seat').marker?.by).toBeUndefined();
  });

  it('creates the seat directory when the seat has never written', () => {
    const written = writeSeatLifecycle(repoRoot, 'fresh-seat', marker());
    expect(written).toBe(markerPath('fresh-seat'));
    expect(fs.existsSync(markerPath('fresh-seat'))).toBe(true);
  });

  it('overwrites a corrupt marker — the verbs ARE the recovery path', () => {
    plantRawMarker('a-seat', 'not json at all');
    expect(readSeatLifecycle(repoRoot, 'a-seat').warning).toBeDefined();

    writeSeatLifecycle(repoRoot, 'a-seat', marker({ state: 'suspended' }));

    const healed = readSeatLifecycle(repoRoot, 'a-seat');
    expect(healed.state).toBe('suspended');
    expect(healed.source).toBe('marker');
    expect(healed.warning).toBeUndefined();
  });

  it('throws a TotemError on a schema-invalid marker rather than writing it', () => {
    expect(() =>
      writeSeatLifecycle(repoRoot, 'a-seat', { ...marker(), state: 'LIVE' } as never),
    ).toThrow(TotemError);
    expect(fs.existsSync(markerPath('a-seat'))).toBe(false);
  });
});

// ─── Unsafe seat ids ───────────────────────────────────────────────────────

describe('unsafe seat ids', () => {
  it.each(['../escape', 'a/b', ''])('read degrades to default-active with a warning: %j', (id) => {
    const result = readSeatLifecycle(repoRoot, id);
    expect(result.state).toBe('active');
    expect(result.source).toBe('default-active');
    expect(result.warning).toContain('unsafe seat id');
  });

  it.each(['../escape', 'a/b', ''])('write throws a TotemError: %j', (id) => {
    expect(() => writeSeatLifecycle(repoRoot, id, marker())).toThrow(TotemError);
  });

  it('does not write outside the orchestration tree for a traversal id', () => {
    expect(() => writeSeatLifecycle(repoRoot, '../..', marker())).toThrow(TotemError);
    expect(fs.existsSync(path.join(tmpRoot, SEAT_LIFECYCLE_FILENAME))).toBe(false);
  });
});

// ─── deriveSeatStatuses ────────────────────────────────────────────────────

describe('deriveSeatStatuses', () => {
  it('returns one sorted row per seat dir with read-time state', () => {
    mkSeat('a-seat');
    writeSeatLifecycle(repoRoot, 'b-seat', marker({ state: 'suspended', reason: 'paused' }));
    plantRawMarker('c-seat', '{ corrupt');
    writeSeatLifecycle(repoRoot, 'd-seat', marker({ state: 'retired' }));
    // Routing surfaces are not seats.
    fs.mkdirSync(path.join(repoRoot, '.totem', 'orchestration', '_broadcast'), { recursive: true });

    const statuses = deriveSeatStatuses(repoRoot);

    expect(statuses.map((s) => s.seat)).toEqual(['a-seat', 'b-seat', 'c-seat', 'd-seat']);
    expect(statuses.map((s) => s.state)).toEqual(['active', 'suspended', 'active', 'retired']);
    expect(statuses.map((s) => s.source)).toEqual([
      'default-active',
      'marker',
      'default-active',
      'marker',
    ]);

    expect(statuses[0]?.warning).toBeUndefined();
    expect(statuses[0]?.since).toBeUndefined();
    expect(statuses[1]?.since).toBe(SINCE);
    expect(statuses[1]?.marker?.reason).toBe('paused');
    expect(statuses[2]?.warning).toContain(markerPath('c-seat'));
  });

  it('returns an empty list when no orchestration tree exists', () => {
    expect(deriveSeatStatuses(repoRoot)).toEqual([]);
  });

  it('reflects a transition on the very next read — nothing is cached', () => {
    writeSeatLifecycle(repoRoot, 'a-seat', marker({ state: 'active' }));
    expect(deriveSeatStatuses(repoRoot)[0]?.state).toBe('active');

    writeSeatLifecycle(repoRoot, 'a-seat', marker({ state: 'suspended' }));
    expect(deriveSeatStatuses(repoRoot)[0]?.state).toBe('suspended');
  });
});

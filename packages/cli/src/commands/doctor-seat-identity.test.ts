/**
 * Sense-tier contract for the seat-identity doctor row (mmnto-ai/totem#2511).
 *
 * Real temp trees, because every arm this row senses is literally a filesystem
 * shape (a dir, a marker, a stamped basename). Fixture roots stay SHORT — the
 * orchestration paths nest four levels deep before the dispatch basename, and
 * MAX_PATH bites on win32.
 *
 * The two invariants asserted on EVERY arm: `gateExempt: true` and never
 * `fail`. A sense that could gate is not a sense.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  checkSeatIdentity,
  OUTBOX_SCAN_LIMIT,
  SEAT_IDENTITY_CHECK_NAME,
  SEAT_IDENTITY_HONEST_LIMIT,
} from './doctor-seat-identity.js';

/** No env by default: arm (c) must stay silent unless a test names a seat. */
const NO_ENV: Record<string, string | undefined> = {};

let root: string;

beforeEach(() => {
  // `realpathSync` folds the win32 8.3 short name so path comparisons and the
  // repo-root walk agree; the `ti-` prefix keeps the fixture path short.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ti-')));
  // The repo-root walk anchors on `.totem`; without it the walk would climb out
  // of the fixture and into the developer's home profile.
  fs.mkdirSync(path.join(root, '.totem', 'orchestration'), { recursive: true });
});

afterEach(() => {
  cleanTmpDir(root);
});

function seatDir(seat: string): string {
  const dir = path.join(root, '.totem', 'orchestration', seat);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a dispatch into `seat`'s outbox with an explicit frontmatter `from:`. */
function dispatch(seat: string, basename: string, from: string | null): void {
  const outbox = path.join(seatDir(seat), 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const lines = [
    '---',
    'schema: adr-098-v0.4',
    ...(from === null ? [] : [`from: ${from}`]),
    'to: totem-claude',
    'timestamp: 2026-08-01T00:00:00.000Z',
    'subject: fixture',
    '---',
    '',
    'body',
    '',
  ];
  fs.writeFileSync(path.join(outbox, basename), lines.join('\n'));
}

function marker(seat: string, payload: unknown): void {
  fs.writeFileSync(
    path.join(seatDir(seat), 'lifecycle.json'),
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
  );
}

function validMarker(state: string, since: string): Record<string, unknown> {
  return { schemaVersion: 1, state, since };
}

describe('checkSeatIdentity — verdict shape', () => {
  it('is gateExempt, never fail, and always states the honest limit (clean tree)', async () => {
    seatDir('totem-claude');
    dispatch('totem-claude', '2026-08-01T1200Z-totem-codex-note.md', 'totem-claude');

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.name).toBe(SEAT_IDENTITY_CHECK_NAME);
    expect(result.status).toBe('pass');
    expect(result.gateExempt).toBe(true);
    expect(result.message).toContain('seats sensed: 1');
    expect(result.message).toContain('no identity contradictions sensed');
    expect(result.message).toContain(SEAT_IDENTITY_HONEST_LIMIT);
  });

  it('senses zero seats without failing when no seat has registered', async () => {
    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('pass');
    expect(result.gateExempt).toBe(true);
    expect(result.message).toContain('seats sensed: 0');
  });

  it('does not flag a dispatch that declares no from: (the dir IS the binding)', async () => {
    dispatch('totem-claude', '2026-08-01T1200Z-totem-codex-note.md', null);

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('pass');
    expect(result.message).not.toContain('from-mismatch');
  });
});

describe('checkSeatIdentity — (a) from ≠ owning dir', () => {
  it('flags the mismatch and names the offending filename', async () => {
    dispatch('totem-claude', '2026-08-01T1200Z-totem-codex-ok.md', 'totem-claude');
    dispatch('totem-claude', '2026-08-02T0900Z-totem-codex-forged.md', 'totem-agy');

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('warn');
    expect(result.gateExempt).toBe(true);
    expect(result.message).toContain('totem-claude [from-mismatch]');
    expect(result.message).toContain('2026-08-02T0900Z-totem-codex-forged.md');
    expect(result.message).toContain('declares from: totem-agy');
    // The matching file is evidence of nothing and must not be listed.
    expect(result.message).not.toContain('2026-08-01T1200Z-totem-codex-ok.md');
  });

  it('reads a quoted from: as the same seat (yamlScalar quotes when it must)', async () => {
    dispatch('totem-claude', '2026-08-01T1200Z-totem-codex-quoted.md', '"totem-claude"');

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('pass');
  });

  it('ignores a body line that mimics from: outside the frontmatter', async () => {
    const outbox = path.join(seatDir('totem-claude'), 'outbox');
    fs.mkdirSync(outbox, { recursive: true });
    fs.writeFileSync(
      path.join(outbox, '2026-08-01T1200Z-totem-codex-body.md'),
      ['---', 'to: totem-codex', '---', '', 'from: totem-agy', ''].join('\n'),
    );

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('pass');
  });
});

describe('checkSeatIdentity — (b) writing while excluded', () => {
  it('flags a suspended seat whose outbox carries writes stamped after `since`', async () => {
    dispatch('totem-agy', '2026-07-01T1000Z-totem-claude-before.md', 'totem-agy');
    dispatch('totem-agy', '2026-08-05T1000Z-totem-claude-after.md', 'totem-agy');
    marker('totem-agy', validMarker('suspended', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('warn');
    expect(result.gateExempt).toBe(true);
    expect(result.message).toContain('totem-agy [writing-while-excluded]');
    expect(result.message).toContain('suspended since 2026-08-01T00:00:00.000Z');
    expect(result.message).toContain('2026-08-05T1000Z-totem-claude-after.md');
    expect(result.message).not.toContain('2026-07-01T1000Z-totem-claude-before.md');
  });

  it('flags a retired seat the same way', async () => {
    dispatch('totem-agy', '2026-08-05T1000Z-totem-claude-after.md', 'totem-agy');
    marker('totem-agy', validMarker('retired', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.message).toContain('totem-agy [writing-while-excluded]');
    expect(result.status).not.toBe('fail');
  });

  it('leaves an ACTIVE seat alone however recent its writes', async () => {
    dispatch('totem-agy', '2026-08-05T1000Z-totem-claude-after.md', 'totem-agy');
    marker('totem-agy', validMarker('active', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('pass');
  });

  it('never flags (b) on a CORRUPT marker, but relays the core warning naming it', async () => {
    dispatch('totem-agy', '2026-08-05T1000Z-totem-claude-after.md', 'totem-agy');
    marker('totem-agy', '{ not json');

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.status).toBe('warn');
    expect(result.gateExempt).toBe(true);
    // The blind spot is disclosed...
    expect(result.message).toContain('totem-agy [unreadable-marker]');
    expect(result.message).toContain('lifecycle.json');
    // ...and no finding is built on the unparsed marker.
    expect(result.message).not.toContain('writing-while-excluded');
  });

  it('never flags (b) on a marker carrying session-state vocabulary (strict schema)', async () => {
    dispatch('totem-agy', '2026-08-05T1000Z-totem-claude-after.md', 'totem-agy');
    marker('totem-agy', validMarker('FAULTED', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.message).toContain('totem-agy [unreadable-marker]');
    expect(result.message).not.toContain('writing-while-excluded');
    expect(result.status).not.toBe('fail');
  });
});

describe('checkSeatIdentity — (c) TOTEM_SELF_AGENT vs lifecycle', () => {
  it('flags an env var naming a suspended seat', async () => {
    seatDir('totem-agy');
    marker('totem-agy', validMarker('suspended', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, { env: { TOTEM_SELF_AGENT: 'totem-agy' } });

    expect(result.status).toBe('warn');
    expect(result.gateExempt).toBe(true);
    expect(result.message).toContain('totem-agy [env-names-excluded-seat]');
    expect(result.message).toContain('names a suspended seat');
  });

  it('flags an env var naming no seat directory in this repo', async () => {
    seatDir('totem-claude');

    const result = await checkSeatIdentity(root, { env: { TOTEM_SELF_AGENT: 'totem-ghost' } });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('totem-ghost [env-names-unknown-seat]');
  });

  it('stays silent for an active seat and for an unset / blank env var', async () => {
    seatDir('totem-claude');

    const active = await checkSeatIdentity(root, { env: { TOTEM_SELF_AGENT: 'totem-claude' } });
    const unset = await checkSeatIdentity(root, { env: NO_ENV });
    const blank = await checkSeatIdentity(root, { env: { TOTEM_SELF_AGENT: '   ' } });

    for (const result of [active, unset, blank]) {
      expect(result.status).toBe('pass');
      expect(result.message).not.toContain('env-names');
      expect(result.gateExempt).toBe(true);
    }
  });

  it('splits a comma-separated env value the way resolveSelfAgents does', async () => {
    seatDir('totem-claude');
    marker('totem-agy', validMarker('retired', '2026-08-01T00:00:00.000Z'));

    const result = await checkSeatIdentity(root, {
      env: { TOTEM_SELF_AGENT: 'totem-claude, totem-agy' },
    });

    expect(result.message).toContain('totem-agy [env-names-excluded-seat]');
    expect(result.message).toContain('names a retired seat');
  });

  it('does not flag (c) on a corrupt marker — the seat reads active by core contract', async () => {
    marker('totem-agy', '{ not json');

    const result = await checkSeatIdentity(root, { env: { TOTEM_SELF_AGENT: 'totem-agy' } });

    expect(result.message).toContain('unreadable-marker');
    expect(result.message).not.toContain('env-names-excluded-seat');
  });
});

describe('checkSeatIdentity — scan bound', () => {
  it('discloses truncation instead of scanning silently partial', async () => {
    for (let i = 0; i < 4; i++) {
      dispatch('totem-claude', `2026-08-0${i + 1}T1200Z-totem-codex-n${i}.md`, 'totem-claude');
    }

    const bounded = await checkSeatIdentity(root, { env: NO_ENV, outboxScanLimit: 2 });

    expect(bounded.message).toContain('scan bounded at 2/outbox');
    expect(bounded.message).toContain('totem-claude: newest 2 of 4 outbox file(s) scanned');
    expect(bounded.gateExempt).toBe(true);
    expect(bounded.status).not.toBe('fail');
  });

  it('says nothing about the bound when the whole outbox fits inside it', async () => {
    dispatch('totem-claude', '2026-08-01T1200Z-totem-codex-n0.md', 'totem-claude');

    const result = await checkSeatIdentity(root, { env: NO_ENV });

    expect(result.message).not.toContain('scan bounded');
    expect(OUTBOX_SCAN_LIMIT).toBeGreaterThan(1);
  });

  it('keeps the NEWEST files when the bound bites (lexical tail = newest tail)', async () => {
    dispatch('totem-claude', '2026-07-01T1200Z-totem-codex-old.md', 'totem-agy');
    dispatch('totem-claude', '2026-08-09T1200Z-totem-codex-new.md', 'totem-agy');

    const result = await checkSeatIdentity(root, { env: NO_ENV, outboxScanLimit: 1 });

    expect(result.message).toContain('2026-08-09T1200Z-totem-codex-new.md');
    expect(result.message).not.toContain('2026-07-01T1200Z-totem-codex-old.md');
  });
});

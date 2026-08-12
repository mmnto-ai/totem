/**
 * Behaviour tests for `totem seat add | suspend | remove | list`
 * (mmnto-ai/totem#2511 slice 2).
 *
 * Every test drives the real command functions against a temp repo fixture —
 * the marker file, the seat dirs, and `config.json` are read back from disk
 * rather than asserted through a mock, because the whole contract of these
 * verbs is what they leave on disk and what they REFUSE to leave.
 *
 * Two fixture disciplines:
 *   - a `.totem/` marker is created in every fixture so
 *     `resolveTotemRepoRootSync` anchors at the temp dir instead of walking up
 *     into a real repo (or `~/.totem`);
 *   - `envForTest` is passed EXPLICITLY everywhere, so an ambient
 *     `TOTEM_SELF_AGENT` in the operator's shell can never decide whether the
 *     `by` field appears.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seatAddCommand, seatListCommand, seatRemoveCommand, seatSuspendCommand } from './seat.js';

/** Pinned transition instants, so `since` assertions are exact. */
const NOW = '2026-08-11T09:00:00.000Z';
const LATER = '2026-08-12T09:00:00.000Z';

/** No env at all — the stamped-absence case for `by`. */
const NO_ENV: NodeJS.ProcessEnv = {};

const created: string[] = [];
let chunks: string[] = [];

/** A temp repo with the `.totem/` anchor. Short prefix: Windows MAX_PATH. */
function makeRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seat-')));
  fs.mkdirSync(path.join(dir, '.totem', 'orchestration'), { recursive: true });
  created.push(dir);
  return dir;
}

function seatDir(repo: string, seatId: string): string {
  return path.join(repo, '.totem', 'orchestration', seatId);
}

function markerPath(repo: string, seatId: string): string {
  return path.join(seatDir(repo, seatId), 'lifecycle.json');
}

function readMarker(repo: string, seatId: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(markerPath(repo, seatId), 'utf-8')) as Record<string, unknown>;
}

function configPath(repo: string): string {
  return path.join(repo, '.totem', 'orchestration', 'config.json');
}

function readConfig(repo: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath(repo), 'utf-8')) as Record<string, unknown>;
}

/** Everything the verb wrote to stdout since the last reset. */
function output(): string {
  // Raw stream segments re-assembled verbatim — a write() chunk boundary is
  // not a token boundary, so no delimiter belongs between chunks.
  let joined = '';
  for (const chunk of chunks) joined += chunk;
  return joined;
}

/** The thrown value, so `recoveryHint` (not just the message) is assertable. */
async function rejection(promise: Promise<void>): Promise<{ message: string; hint: string }> {
  const err: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(err).toBeInstanceOf(Error);
  const typed = err as Error & { recoveryHint?: string };
  return { message: typed.message, hint: typed.recoveryHint ?? '' };
}

beforeEach(() => {
  chunks = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ─── add ────────────────────────────────────────────────

describe('seat add', () => {
  it('creates the three subdirs and an active marker; `by` is ABSENT when TOTEM_SELF_AGENT is unset', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });

    for (const sub of ['outbox', 'processed', 'journal']) {
      expect(fs.statSync(path.join(seatDir(repo, 'totem-kimi'), sub)).isDirectory()).toBe(true);
    }
    const marker = readMarker(repo, 'totem-kimi');
    expect(marker).toEqual({ schemaVersion: 1, state: 'active', since: NOW });
    // The stamped absence is the point: no fabricated attribution.
    expect('by' in marker).toBe(false);
    expect(output()).toContain('Seat added: totem-kimi');
    expect(output()).toContain('TOTEM_SELF_AGENT is not set');
  });

  it('records `by` from a SINGLE-seat TOTEM_SELF_AGENT', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: { TOTEM_SELF_AGENT: 'totem-claude' },
      nowForTest: NOW,
    });
    expect(readMarker(repo, 'totem-kimi')['by']).toBe('totem-claude');
  });

  it('a MULTI-seat TOTEM_SELF_AGENT is ambiguous: `by` is omitted and the omission is disclosed (stamped absence, MB-2)', async () => {
    // "The first entry" is no evidence that seat ran the verb — under the
    // stamped-absence rule the honest answer for an ambiguous env is absence
    // plus a note, never a guess (falsification finding 7).
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: { TOTEM_SELF_AGENT: 'totem-claude,totem-gemini' },
      nowForTest: NOW,
    });
    expect(readMarker(repo, 'totem-kimi')['by']).toBeUndefined();
    expect(output()).toContain('by omitted');
    expect(output()).toContain('stamped absence');
  });

  it('--reactivate on a NONEXISTENT seat is a hard error, never a silent birth (the flag must not change meaning)', async () => {
    const repo = makeRepo();
    const { message, hint } = await rejection(
      seatAddCommand('brand-new', {
        cwdForTest: repo,
        envForTest: NO_ENV,
        nowForTest: NOW,
        reactivate: true,
      }),
    );
    expect(message).toContain('nothing to reactivate');
    expect(hint).toContain('without --reactivate');
    // Nothing was created.
    expect(fs.readdirSync(path.join(repo, '.totem', 'orchestration'))).toEqual([]);
  });

  it('refuses an id that is not a safe path segment', async () => {
    const repo = makeRepo();
    const { message } = await rejection(
      seatAddCommand('../escape', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW }),
    );
    expect(message).toContain('invalid seat id');
    // The guard runs before any fs work: nothing was created anywhere.
    expect(fs.readdirSync(path.join(repo, '.totem', 'orchestration'))).toEqual([]);
  });

  it('refuses an existing ACTIVE seat and names its current state', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    const { message } = await rejection(
      seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: LATER }),
    );
    expect(message).toContain('already exists');
    expect(message).toContain('current state: active');
    // The refusal is not a rewrite: the original `since` survives.
    expect(readMarker(repo, 'totem-kimi')['since']).toBe(NOW);
  });

  it('hints --reactivate when the existing seat is suspended', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatSuspendCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    const { message, hint } = await rejection(
      seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: LATER }),
    );
    expect(message).toContain('current state: suspended');
    expect(hint).toContain('--reactivate');
  });

  it('--reactivate transitions suspended → active with a fresh marker', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatSuspendCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
      reason: 'paused',
    });
    chunks = [];
    await seatAddCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: LATER,
      reactivate: true,
    });
    const marker = readMarker(repo, 'totem-kimi');
    expect(marker['state']).toBe('active');
    expect(marker['since']).toBe(LATER);
    // A fresh marker, not a patch: the suspension's reason does not survive.
    expect('reason' in marker).toBe(false);
    expect(output()).toContain('Seat reactivated: totem-kimi (suspended → active)');
  });

  it('--reactivate on an already-active seat is a hard error (transitions ONLY suspended → active)', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    const { message } = await rejection(
      seatAddCommand('totem-kimi', {
        cwdForTest: repo,
        envForTest: NO_ENV,
        nowForTest: LATER,
        reactivate: true,
      }),
    );
    expect(message).toContain('already active');
    expect(readMarker(repo, 'totem-kimi')['since']).toBe(NOW);
  });

  it('--reactivate NEVER resurrects a retired seat — resurrection needs a fresh ruling', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    const { message, hint } = await rejection(
      seatAddCommand('totem-kimi', {
        cwdForTest: repo,
        envForTest: NO_ENV,
        nowForTest: LATER,
        reactivate: true,
      }),
    );
    expect(message).toContain('refusing to resurrect retired seat');
    expect(hint).toContain('retirement was an operator word');
    expect(hint).toContain('fresh ruling');
    // The tombstone is intact.
    expect(readMarker(repo, 'totem-kimi')).toMatchObject({ state: 'retired', since: NOW });
  });

  it('a plain add over a retired seat refuses with the same ruling, never a fresh marker', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    const { message, hint } = await rejection(
      seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: LATER }),
    );
    expect(message).toContain('current state: retired');
    expect(hint).toContain('retirement was an operator word');
    expect(readMarker(repo, 'totem-kimi')).toMatchObject({ state: 'retired', since: NOW });
  });
});

// ─── add: config.json merge ─────────────────────────────

describe('seat add — host_agents merge', () => {
  it('appends the seat, preserving every existing entry AND every passthrough key', async () => {
    const repo = makeRepo();
    fs.writeFileSync(
      configPath(repo),
      JSON.stringify(
        {
          host_agents: ['totem-claude', 'totem-gemini'],
          unknown_key: { nested: [1, 2, 3] },
          another: 'kept',
        },
        null,
        2,
      ) + '\n',
    );

    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });

    const config = readConfig(repo);
    expect(config['host_agents']).toEqual(['totem-claude', 'totem-gemini', 'totem-kimi']);
    expect(config['unknown_key']).toEqual({ nested: [1, 2, 3] });
    expect(config['another']).toBe('kept');
    expect(output()).toContain('appended totem-kimi');
  });

  it('does NOT create a config.json where none exists, and says so', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    expect(fs.existsSync(configPath(repo))).toBe(false);
    expect(output()).toContain('none was created');
  });

  it('leaves a config.json that declares no host_agents untouched (the key REPLACES the roster)', async () => {
    const repo = makeRepo();
    const original = JSON.stringify({ some_other_consumer: true }, null, 2) + '\n';
    fs.writeFileSync(configPath(repo), original);

    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });

    expect(fs.readFileSync(configPath(repo), 'utf-8')).toBe(original);
    expect(output()).toContain('declares no host_agents');
  });

  it('is idempotent on a seat already listed in host_agents', async () => {
    const repo = makeRepo();
    fs.writeFileSync(configPath(repo), JSON.stringify({ host_agents: ['totem-kimi'] }, null, 2));
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    expect(readConfig(repo)['host_agents']).toEqual(['totem-kimi']);
    expect(output()).toContain('already listed');
  });
});

// ─── add: the emitted birth checklist ───────────────────

describe('seat add — birth checklist', () => {
  it('names every residual surface the verb cannot reach, and applies none of them', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    const text = output();

    expect(text).toContain('birth checklist (EMITTED, NOT APPLIED)');
    // Vendor poll wiring — hooked vendors and the ones with no hook surface.
    expect(text).toContain('totem hooks');
    expect(text).toContain('codex / kimi / agy seats: NO hook surface exists at all');
    expect(text).toContain('TOTEM_SELF_AGENT=totem-kimi');
    // The foreign surfaces.
    expect(text).toContain('agentHomeMap');
    expect(text).toContain('eclCohortRepos');
    expect(text).toContain('FROZEN by');
    expect(text).toContain('mmnto-ai/totem-strategy#611');
    expect(text).toContain('EMITTED, NEVER WRITTEN');
    // All four signoff seat-table copies, including the published template.
    expect(text).toContain('.claude/skills/signoff/SKILL.md');
    expect(text).toContain('.agents/skills/signoff/SKILL.md');
    expect(text).toContain('.gemini/skills/signoff.md');
    expect(text).toContain('SIGNOFF_SKILL_CONTENT');
    // The strategy-lane parity row.
    expect(text).toContain('parity-manifest row candidate');
  });
});

// ─── suspend ────────────────────────────────────────────

describe('seat suspend', () => {
  it('writes a suspended marker and prints the denominator + obligations notes', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    chunks = [];

    await seatSuspendCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: { TOTEM_SELF_AGENT: 'totem-claude' },
      nowForTest: LATER,
      reason: 'operator ruling 2026-08-12',
    });

    expect(readMarker(repo, 'totem-kimi')).toEqual({
      schemaVersion: 1,
      state: 'suspended',
      since: LATER,
      by: 'totem-claude',
      reason: 'operator ruling 2026-08-12',
    });
    const text = output();
    expect(text).toContain('REQUIRED-SETS and round denominators');
    expect(text).toContain('NOT discharged');
    expect(text).toContain('mmnto-ai/totem-status#127');
    expect(text).toContain('Directed mail addressed to this seat still surfaces');
  });

  it('prints the reason encouragement EXACTLY when --reason is omitted', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatAddCommand('b-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });

    chunks = [];
    await seatSuspendCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: LATER });
    expect(output()).toContain('no --reason recorded');
    expect(output()).toContain('§6.6');

    chunks = [];
    await seatSuspendCommand('b-seat', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: LATER,
      reason: 'recorded',
    });
    expect(output()).not.toContain('no --reason recorded');
  });

  it('is idempotent: a second suspend reports the ORIGINAL since and rewrites nothing', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatSuspendCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
      reason: 'first',
    });
    const before = fs.readFileSync(markerPath(repo, 'totem-kimi'), 'utf-8');

    chunks = [];
    await seatSuspendCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: LATER,
      reason: 'second',
    });

    expect(fs.readFileSync(markerPath(repo, 'totem-kimi'), 'utf-8')).toBe(before);
    expect(output()).toContain(`already suspended since ${NOW}`);
  });

  it('refuses a retired seat', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    const { message } = await rejection(
      seatSuspendCommand('totem-kimi', {
        cwdForTest: repo,
        envForTest: NO_ENV,
        nowForTest: LATER,
      }),
    );
    expect(message).toContain('is retired');
    expect(readMarker(repo, 'totem-kimi')['state']).toBe('retired');
  });

  it('refuses an unknown seat and LISTS the known ones', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatAddCommand('b-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });

    const { message, hint } = await rejection(
      seatSuspendCommand('ghost-seat', {
        cwdForTest: repo,
        envForTest: NO_ENV,
        nowForTest: LATER,
      }),
    );
    expect(message).toContain('unknown seat "ghost-seat"');
    expect(hint).toContain('a-seat (active)');
    expect(hint).toContain('b-seat (active)');
    expect(fs.existsSync(seatDir(repo, 'ghost-seat'))).toBe(false);
  });
});

// ─── remove ─────────────────────────────────────────────

describe('seat remove', () => {
  it('writes a retired tombstone, deletes nothing, and emits the deregistration checklist', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    const dispatch = path.join(seatDir(repo, 'totem-kimi'), 'outbox', 'keep-me.md');
    fs.writeFileSync(dispatch, 'an undischarged obligation\n');
    chunks = [];

    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: LATER,
      reason: 'stream closed',
    });

    expect(readMarker(repo, 'totem-kimi')).toEqual({
      schemaVersion: 1,
      state: 'retired',
      since: LATER,
      reason: 'stream closed',
    });
    // Retention: nothing under the seat dir was touched.
    expect(fs.readFileSync(dispatch, 'utf-8')).toBe('an undischarged obligation\n');
    for (const sub of ['outbox', 'processed', 'journal']) {
      expect(fs.existsSync(path.join(seatDir(repo, 'totem-kimi'), sub))).toBe(true);
    }

    const text = output();
    expect(text).toContain('Nothing was deleted');
    expect(text).toContain('mmnto-ai/totem#2518');
    expect(text).toContain('NOT discharged');
    expect(text).toContain('mmnto-ai/totem-status#127');
    expect(text).toContain('deregistration checklist (EMITTED, NOT APPLIED)');
    expect(text).toContain('agentHomeMap');
    expect(text).toContain('SIGNOFF_SKILL_CONTENT');
    expect(text).toContain('no config.json in this repo');
  });

  it('names the config.json entry to deregister when the repo carries one', async () => {
    const repo = makeRepo();
    fs.writeFileSync(configPath(repo), JSON.stringify({ host_agents: ['totem-kimi'] }, null, 2));
    fs.mkdirSync(path.join(seatDir(repo, 'totem-kimi'), 'outbox'), { recursive: true });
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    expect(output()).toContain('remove the seat from host_agents');
    // Emitted, not applied: the file is untouched.
    expect(readConfig(repo)['host_agents']).toEqual(['totem-kimi']);
  });

  it('is idempotent: a second remove reports the ORIGINAL since and rewrites nothing', async () => {
    const repo = makeRepo();
    await seatAddCommand('totem-kimi', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: NOW,
    });
    const before = fs.readFileSync(markerPath(repo, 'totem-kimi'), 'utf-8');

    chunks = [];
    await seatRemoveCommand('totem-kimi', {
      cwdForTest: repo,
      envForTest: NO_ENV,
      nowForTest: LATER,
    });
    expect(fs.readFileSync(markerPath(repo, 'totem-kimi'), 'utf-8')).toBe(before);
    expect(output()).toContain(`already retired since ${NOW}`);
  });

  it('refuses an unknown seat and LISTS the known ones', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    const { message, hint } = await rejection(
      seatRemoveCommand('ghost-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW }),
    );
    expect(message).toContain('unknown seat "ghost-seat"');
    expect(hint).toContain('a-seat (active)');
  });
});

// ─── list ───────────────────────────────────────────────

describe('seat list', () => {
  it('renders seat · state · since · source for every registered seat', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    // A markerless legacy seat: dir only, no lifecycle.json.
    fs.mkdirSync(path.join(seatDir(repo, 'z-seat'), 'outbox'), { recursive: true });
    await seatSuspendCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: LATER });
    chunks = [];

    await seatListCommand({ cwdForTest: repo });

    const text = output();
    expect(text).toContain('seat');
    expect(text).toContain('state');
    expect(text).toContain('since');
    expect(text).toContain('source');
    expect(text).toMatch(/a-seat\s+suspended\s+2026-08-12T09:00:00\.000Z\s+marker/);
    // Absent marker ⇒ active, derived, not stored.
    expect(text).toMatch(/z-seat\s+active\s+—\s+default-active/);
    expect(text).toContain('2 seat(s)');
  });

  it('--json prints the full status array and round-trips', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    fs.mkdirSync(path.join(seatDir(repo, 'z-seat'), 'outbox'), { recursive: true });
    chunks = [];

    await seatListCommand({ cwdForTest: repo, json: true });

    const parsed: unknown = JSON.parse(output());
    expect(Array.isArray(parsed)).toBe(true);
    const rows = parsed as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      seat: 'a-seat',
      state: 'active',
      source: 'marker',
      since: NOW,
      marker: { schemaVersion: 1, state: 'active', since: NOW },
    });
    expect(rows[1]).toEqual({ seat: 'z-seat', state: 'active', source: 'default-active' });
  });

  it('reports an empty roster without inventing one', async () => {
    const repo = makeRepo();
    await seatListCommand({ cwdForTest: repo });
    expect(output()).toContain('no seats registered');

    chunks = [];
    await seatListCommand({ cwdForTest: repo, json: true });
    expect(JSON.parse(output())).toEqual([]);
  });

  it('surfaces a corrupt marker as a warning BELOW the table while the seat still reads active', async () => {
    const repo = makeRepo();
    await seatAddCommand('a-seat', { cwdForTest: repo, envForTest: NO_ENV, nowForTest: NOW });
    fs.writeFileSync(markerPath(repo, 'a-seat'), '{ not json');
    chunks = [];

    await seatListCommand({ cwdForTest: repo });

    const text = output();
    expect(text).toMatch(/a-seat\s+active\s+—\s+default-active/);
    expect(text).toContain('warnings (1)');
    expect(text).toContain('fix or delete the marker');
  });
});

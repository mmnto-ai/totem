/**
 * `totem mail --derive-seat` — the signon step-0 identity probe
 * (mmnto-ai/totem#2801, ruled design in `.totem/specs/2801.md`
 * § Implementation Design + § Phase 4 rulings R2).
 *
 * The contract under test, verbatim from the design's data-model delta: the
 * command "short-circuits before any poll: it calls `resolveSelfAgents(repoRoot,
 * env)` and prints exactly one line `seat=<id> source=<env|config|dir>` when the
 * resolution is a single seat that `env` supplied and this repo hosts;
 * otherwise a refusal on stderr naming the supplied value (or "unset") and every
 * seat this repo hosts, exit 2. No fallback to any seat, ever."
 *
 * Every `Invariants to lock in via tests` bullet from that design has at least
 * one executed test here:
 *   - env unset in a two-seat repo → exit 2, both seats on stderr, stdout empty
 *   - env set to a hosted seat → exactly one stdout line, `source=env`, exit 0
 *   - env set to an unhosted seat → exit 2, stderr names the value + the list
 *   - never reads an outbox or a processed dir (the fs spy below)
 *   - `--as` (and `--all-seats`) with `--derive-seat` → contradictory, exit 2
 * plus the design's fourth failure-mode row: a repo hosting no seat at all.
 *
 * Filesystem-driven and hermetic, same fixture idiom as mail.test.ts. The repo
 * basenames are deliberately NON-cohort (`hostrepo`, `barerepo`) so the
 * resolver's hardcoded basename map contributes nothing and the hosted set is
 * exactly the seat dirs this fixture writes.
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so `vi.spyOn(fs, …)` works in ESM — same passthrough pattern as
// mail-degraded-e4.test.ts. Every call behaves identically to real fs until a
// test installs a targeted spy (and restores it in `finally`).
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { cleanTmpDir } from '../test-utils.js';
import { log } from '../ui.js';
import { deriveSeat, deriveSeatCommand } from './mail.js';

let tmpRoot: string;

/** `<tmp>/<repo>/.totem/` with a seat dir (plus outbox/processed) per seat. */
function makeRepo(repo: string, seats: string[]): string {
  const repoRoot = path.join(tmpRoot, repo);
  fs.mkdirSync(path.join(repoRoot, '.totem'), { recursive: true });
  for (const seat of seats) {
    const seatDir = path.join(repoRoot, '.totem', 'orchestration', seat);
    fs.mkdirSync(path.join(seatDir, 'outbox'), { recursive: true });
    fs.mkdirSync(path.join(seatDir, 'processed'), { recursive: true });
    fs.writeFileSync(
      path.join(seatDir, 'outbox', '2026-09-07T1200Z-directed.md'),
      ['---', `from: ${seat}`, 'to: broadcast', 'subject: fixture', '---', '', 'Body.', ''].join(
        '\n',
      ),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(seatDir, 'processed', '2026-09-07T1200Z-directed.md.done'),
      '',
      'utf-8',
    );
  }
  return repoRoot;
}

/**
 * Run the command with stdout and stderr captured. `log.error` is the CLI's
 * stderr channel (ui.ts: every log method writes via console.error), so the
 * refusal stream is captured there; `process.stdout.write` is the success
 * channel the design specifies for scripting.
 */
async function run(
  opts: Parameters<typeof deriveSeatCommand>[0],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    });
  const errSpy = vi.spyOn(log, 'error').mockImplementation((_tag: string, msg: string) => {
    stderr.push(msg);
  });
  try {
    const { exitCode } = await deriveSeatCommand(opts);
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('\n') };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-derive-seat-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanTmpDir(tmpRoot);
});

describe('totem mail --derive-seat (mmnto-ai/totem#2801)', () => {
  it('env set to a hosted seat prints exactly one line `seat=<id> source=env` and exits 0', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
    });
    expect(exitCode).toBe(0);
    // EXACTLY one line — the whole point of the stdout channel is that a
    // caller can read it without parsing a banner.
    expect(stdout).toBe('seat=seat-alpha source=env\n');
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    // Nothing refused.
    expect(stderr).toBe('');
  });

  it('env unset in a two-seat repo exits 2, names BOTH seats on stderr, and writes nothing to stdout', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({ repoRoot, env: {} });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('unset');
    expect(stderr).toContain('seat-alpha');
    expect(stderr).toContain('seat-beta');
    // No fallback to any seat, ever: the refusal must not read as a derivation.
    expect(stdout).not.toContain('seat=');
  });

  it('env naming a seat this repo does not host exits 2 and names the supplied value + the hosted list', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'strategy-claude' },
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('strategy-claude');
    expect(stderr).toContain('seat-alpha');
    expect(stderr).toContain('seat-beta');
  });

  it('a repo hosting no seat refuses with the `totem seat add` cure (exit 2)', async () => {
    const repoRoot = path.join(tmpRoot, 'barerepo');
    fs.mkdirSync(path.join(repoRoot, '.totem'), { recursive: true });
    const { exitCode, stdout, stderr } = await run({ repoRoot, env: {} });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('this repo hosts no seat — `totem seat add`');
  });

  it('an env declaring MULTIPLE seats refuses — a session has one identity (exit 2)', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha,seat-beta' },
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('seat-alpha,seat-beta');
  });

  it('a config/dirs-only resolution is NOT a derivation — a single-seat repo with env unset still refuses', async () => {
    // The design's success gate is "a single seat that ENV supplied": the repo
    // hosting exactly one seat is a repo fact, not this session's declared
    // identity, so it refuses rather than adopting the only seat in sight.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha']);
    const { exitCode, stdout, stderr } = await run({ repoRoot, env: {} });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('seat-alpha');
  });

  it('--derive-seat with --as <seat> is contradictory (exit 2), like --as with --all-seats', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      asSeat: 'seat-beta',
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('--as');
    expect(stderr).toContain('--derive-seat');
  });

  it('--derive-seat with --all-seats is contradictory (exit 2)', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      allSeats: true,
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('--all-seats');
    expect(stderr).toContain('--derive-seat');
  });

  it('never reads an outbox or a processed dir (the poll path stays untouched)', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    // Positive control: the fixture DOES carry the files a poll would read, so
    // "no outbox read" is a statement about the code path, not an empty tree.
    expect(
      fs.existsSync(
        path.join(
          repoRoot,
          '.totem',
          'orchestration',
          'seat-alpha',
          'outbox',
          '2026-09-07T1200Z-directed.md',
        ),
      ),
    ).toBe(true);

    const touched: string[] = [];
    const record = (target: unknown): void => {
      if (typeof target === 'string') touched.push(target);
      else if (Buffer.isBuffer(target)) touched.push(target.toString('utf-8'));
      else if (target instanceof URL) touched.push(target.pathname);
    };
    const realReaddir = fs.readdirSync;
    const realReadFile = fs.readFileSync;
    const readdirSpy = vi.spyOn(fs, 'readdirSync').mockImplementation(((
      target: unknown,
      options: unknown,
    ) => {
      record(target);
      return (realReaddir as (t: unknown, o: unknown) => unknown)(target, options);
    }) as unknown as typeof fs.readdirSync);
    const readFileSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(((
      target: unknown,
      options: unknown,
    ) => {
      record(target);
      return (realReadFile as (t: unknown, o: unknown) => unknown)(target, options);
    }) as unknown as typeof fs.readFileSync);

    // Silence the success line (the suite's stdout stays clean) — the write
    // itself is asserted by the first test in this file.
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const { exitCode } = await deriveSeatCommand({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      });
      expect(exitCode).toBe(0);
    } finally {
      outSpy.mockRestore();
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }

    const poked = touched.filter((p) => /outbox|processed/i.test(p));
    expect(poked, `derive-seat must not touch the poll surfaces: ${poked.join(', ')}`).toEqual([]);
  });

  it('deriveSeat is pure — it returns the verdict without printing (the lib/wrapper split)', () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const ok = deriveSeat({ repoRoot, env: { TOTEM_SELF_AGENT: 'seat-beta' } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.seat).toBe('seat-beta');
      expect(ok.line).toBe('seat=seat-beta source=env');
    }
    const refused = deriveSeat({ repoRoot, env: {} });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.refusal).toContain('seat-alpha');
      expect(refused.refusal).toContain('seat-beta');
    }
  });
});

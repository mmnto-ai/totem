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

import { execFileSync } from 'node:child_process';
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

import { envWithoutGitLocation, resolveSelfAgents } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { log } from '../ui.js';
import { deriveSeat, deriveSeatCommand } from './mail.js';

let tmpRoot: string;

/**
 * Run git against a FIXTURE directory with git's repository-location env
 * scrubbed — the same guard the product read carries (mmnto-ai/totem#2801 F3).
 * Under an exported `GIT_DIR` (the shape every git hook runs in) an inherited
 * environment would point `git init` and `git remote add` at the ambient
 * repository instead of the fixture.
 */
function gitFixture(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', env: envWithoutGitLocation(process.env) });
}

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
): Promise<{ exitCode: number; stdout: string; stderr: string; tags: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  // The tag of every `log.error` call, captured beside the message: the repo
  // styleguide fixes it at `'Totem Error'` for every `log.error`, and a
  // command-specific tag here renders the wrong stderr prefix (PR round 1,
  // gemini-code-assist + CodeRabbit).
  const tags: string[] = [];
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8'));
      return true;
    });
  const errSpy = vi.spyOn(log, 'error').mockImplementation((tag: string, msg: string) => {
    tags.push(tag);
    stderr.push(msg);
  });
  try {
    const { exitCode } = await deriveSeatCommand(opts);
    return { exitCode, stdout: stdout.join(''), stderr: stderr.join('\n'), tags };
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

  // ── the per-agent-worktree shape (mmnto-ai/totem#2801 fold round 2) ──
  //
  // `.totem/orchestration/` is gitignored and a worktree's DIRECTORY basename
  // (`totem-totem-claude-build-2801`) is no COHORT_AGENT_MAP key, so the
  // structural union came back empty there. Round 1 answered that by falling
  // back to the env-declared list, which made the hosted check a tautology —
  // any well-formed id was accepted, so the probe could not refuse an identity,
  // which is the entire point of it. The cure is structural information, not a
  // looser probe: the cohort map is now keyed on the ORIGIN repository name, so
  // this shape resolves the real totem seats and an unhosted seat is refused
  // against them.
  describe('per-agent worktree — cohort map keyed on the git origin (mmnto-ai/totem#2801)', () => {
    /**
     * `.totem/` plus a real git repo with an `origin` remote, in a directory
     * whose basename is NOT a cohort key and with no orchestration tree at all
     * — the exact shape of a per-agent worktree of `mmnto-ai/totem`.
     */
    function makeWorktreeShape(originUrl?: string): string {
      const repoRoot = path.join(tmpRoot, 'totem-totem-claude-build-2801');
      fs.mkdirSync(path.join(repoRoot, '.totem'), { recursive: true });
      gitFixture(repoRoot, ['init', '-q', '-b', 'main']);
      if (originUrl !== undefined) {
        gitFixture(repoRoot, ['remote', 'add', 'origin', originUrl]);
      }
      expect(fs.existsSync(path.join(repoRoot, '.totem', 'orchestration'))).toBe(false);
      return repoRoot;
    }

    it('(a) env naming a seat the ORIGIN repo hosts is accepted', async () => {
      const repoRoot = makeWorktreeShape('https://github.com/mmnto-ai/totem.git');
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'totem-claude' },
      });
      expect(stderr).toBe('');
      expect(stdout).toBe('seat=totem-claude source=env\n');
      expect(exitCode).toBe(0);
    });

    it("(a') env naming a seat the origin repo does NOT host is REFUSED against the cohort list", async () => {
      // The round-1 tautology, inverted: this is the assertion that fails when
      // hosted-ness is whatever the env said.
      const repoRoot = makeWorktreeShape('https://github.com/mmnto-ai/totem.git');
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'lc-claude' },
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toContain('lc-claude');
      expect(stderr).toContain('totem-claude');
      expect(stderr).toContain('totem-gemini');
    });

    it("(a'') matching is case-insensitive and the STRUCTURAL casing is printed", async () => {
      const repoRoot = makeWorktreeShape('git@github.com:mmnto-ai/totem.git');
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'TOTEM-Claude' },
      });
      expect(stderr).toBe('');
      expect(stdout).toBe('seat=totem-claude source=env\n');
      expect(exitCode).toBe(0);
    });

    it('(b) NO origin and no seat dirs is the ruled hosts-no-seat refusal, even with the env set', async () => {
      const repoRoot = makeWorktreeShape();
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'totem-claude' },
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toContain('this repo hosts no seat — `totem seat add`');
    });

    it('(F6) with NO origin, a two-seat env is never echoed back as "this repo hosts"', async () => {
      // The refusal's hosted list must come from the STRUCTURAL set. Here the
      // structural set is empty, so the only honest answer is that the repo
      // hosts no seat — echoing the env's own entries would tell the operator
      // this repo hosts exactly what they typed, which is how the round-1
      // tautology read from the outside.
      const repoRoot = makeWorktreeShape();
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'totem-claude,totem-gemini' },
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toContain('this repo hosts no seat — `totem seat add`');
      expect(stderr).not.toContain('this repo hosts: totem-claude');
      expect(stderr).not.toContain('this repo hosts: totem-claude, totem-gemini');
    });

    it('(F1) the `--as` asymmetry is a PROPERTY, not an accident: the probe refuses where the declaration resolves', async () => {
      // Ruled as a disclosure, not an alignment. `--as <seat>` is the
      // operator's explicit declaration on the command line, and its validator
      // falls back to the env-declared list when the structural union is empty
      // (mail.ts, the `--as` arm) — so the poll serves the seat. `--derive-seat`
      // exists to CORROBORATE an inherited declaration against the repo, and a
      // hosted set the env feeds corroborates nothing, so it refuses. Both
      // behaviours are correct for what each flag is; the disagreement is
      // locked here so a later "consistency" fix cannot quietly re-open the
      // tautology.
      const repoRoot = makeWorktreeShape();
      const env = { TOTEM_SELF_AGENT: 'totem-claude' };

      const { exitCode, stderr } = await run({ repoRoot, env });
      expect(exitCode).toBe(2);
      expect(stderr).toContain('this repo hosts no seat — `totem seat add`');

      // The env-inclusive resolution `--as` validates against — same repo, same
      // env — DOES resolve the seat.
      const asSeatUnion = resolveSelfAgents(repoRoot, env);
      expect(asSeatUnion.source).toBe('env');
      expect(asSeatUnion.agents).toEqual(['totem-claude']);
    });

    it('(c) a comma list of two hosted seats still refuses — a session has one identity', async () => {
      const repoRoot = makeWorktreeShape('https://github.com/mmnto-ai/totem.git');
      const { exitCode, stdout, stderr } = await run({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'totem-claude,totem-gemini' },
      });
      expect(exitCode).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toContain('totem-claude,totem-gemini');
    });
  });

  it('config.json host_agents omitting a PRESENT seat dir refuses by NAMING that cause, not by contradicting itself (fold F2)', async () => {
    // The resolver keeps config's shipped replace semantics and attaches a
    // "the dir is the registration" warning (mmnto-ai/totem#2141). Appending
    // that warning to "is not a seat this repo hosts" told the reader both
    // that the seat is not hosted and that its dir IS its registration. The
    // verdict stays (config replaces the dir set, exactly as `--as` treats
    // it); the refusal now names the cause and both cures.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    fs.writeFileSync(
      path.join(repoRoot, '.totem', 'orchestration', 'config.json'),
      JSON.stringify({ host_agents: ['seat-beta'] }, null, 2),
      'utf-8',
    );
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
    });
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('is a present seat dir that');
    expect(stderr).toContain('host_agents omits');
    expect(stderr).toContain('REPLACES the dir set (mmnto-ai/totem#2141)');
    expect(stderr).toContain('Add the seat to host_agents, or remove its stale seat dir');
    expect(stderr).toContain('this repo hosts: seat-beta');
    // The self-contradiction is gone: the raw resolver warning no longer rides
    // this refusal, and the old "not a seat this repo hosts" verdict prose is
    // replaced rather than supplemented.
    expect(stderr).not.toContain('the dir is the registration');
    expect(stderr).not.toContain('is not a seat this repo hosts');
  });

  it('the config-omits-a-dir branch — the ONLY one that reads seat dirs — still touches no outbox or processed dir (fold round 2)', async () => {
    // The suite's other spy test covers the SUCCESS path. This branch is the
    // one that calls the seat-dir reader (and through it each dir's
    // lifecycle.json), so it is the one place the no-poll-surfaces property
    // could regress unnoticed.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    fs.writeFileSync(
      path.join(repoRoot, '.totem', 'orchestration', 'config.json'),
      JSON.stringify({ host_agents: ['seat-beta'] }, null, 2),
      'utf-8',
    );

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

    const errSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
    try {
      const { exitCode } = await deriveSeatCommand({
        repoRoot,
        env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      });
      // The branch under test really is the one that ran.
      expect(exitCode).toBe(2);
      expect(errSpy.mock.calls.map((c) => String(c[1])).join('\n')).toContain(
        'is a present seat dir that',
      );
    } finally {
      errSpy.mockRestore();
      readdirSpy.mockRestore();
      readFileSpy.mockRestore();
    }

    // Liveness: the reader was exercised over this fixture's tree.
    const orchestration = path.join(repoRoot, '.totem', 'orchestration');
    expect(touched.filter((p) => p.startsWith(orchestration)).length).toBeGreaterThan(0);
    const poked = touched.filter((p) => /outbox|processed/i.test(p));
    expect(
      poked,
      `the config branch must not touch the poll surfaces: ${poked.join(', ')}`,
    ).toEqual([]);
  });

  it('a DUPLICATED env entry is one identity, not two — accepted like the poll accepts it (fold round 2)', async () => {
    // `pollMail` normalizes duplicates out of its own resolution before it
    // counts seats; the probe must apply the same normalization or it refuses
    // an identity the very next command serves.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha,seat-alpha' },
    });
    expect(stderr).toBe('');
    expect(stdout).toBe('seat=seat-alpha source=env\n');
    expect(exitCode).toBe(0);
  });

  it('a CASE-SHIFTED duplicate is one identity too, and the hosted spelling is printed (fold round 3 F6)', async () => {
    // Every seat comparison downstream folds case, so `a,A` names one seat.
    // Refusing it would be the probe disagreeing with the poll again.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha,SEAT-Alpha' },
    });
    expect(stderr).toBe('');
    expect(stdout).toBe('seat=seat-alpha source=env\n');
    expect(exitCode).toBe(0);
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

    // Liveness (fold F5): a spy that observed NOTHING would satisfy the
    // "no outbox" assertion vacuously — a wiring break, a mock that never
    // installed, or a refactor that stopped touching the tree at all would all
    // pass silently. The probe must be seen reading THIS fixture's
    // orchestration tree for the negative below to mean anything.
    const orchestration = path.join(repoRoot, '.totem', 'orchestration');
    const observed = touched.filter((p) => p.startsWith(orchestration));
    expect(
      observed.length,
      `the fs spy observed no read under ${orchestration} — the negative assertion below would be vacuous`,
    ).toBeGreaterThan(0);

    const poked = touched.filter((p) => /outbox|processed/i.test(p));
    expect(poked, `derive-seat must not touch the poll surfaces: ${poked.join(', ')}`).toEqual([]);
  });

  it('matches the hosted seat case-insensitively and prints the resolver’s casing (fold F5)', async () => {
    // Every other seat comparison in mail.ts folds case (`pollMail`'s
    // `selfLower`, the `--as` member lookup), so a case-shifted env must not
    // be refused by a probe whose whole job is to agree with the poll — and
    // the line must carry the dir's own spelling, not the env's.
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const { exitCode, stdout, stderr } = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'SEAT-Alpha' },
    });
    expect(stderr).toBe('');
    expect(stdout).toBe('seat=seat-alpha source=env\n');
    expect(exitCode).toBe(0);
  });

  it("every refusal is logged under the CLI's fixed 'Totem Error' tag, never the command's TAG (PR round 1)", async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);
    const unset = await run({ repoRoot, env: {} });
    expect(unset.exitCode).toBe(2);
    expect(unset.tags).toEqual(['Totem Error']);
    const contradiction = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      asSeat: 'seat-alpha',
    });
    expect(contradiction.exitCode).toBe(2);
    expect(contradiction.tags).toEqual(['Totem Error']);
  });

  it('--json emits ONE stdout object in both arms with the same exit codes, and nothing on stderr (PR round 1, greptile)', async () => {
    const repoRoot = makeRepo('hostrepo', ['seat-alpha', 'seat-beta']);

    const ok = await run({ repoRoot, env: { TOTEM_SELF_AGENT: 'seat-alpha' }, json: true });
    expect(ok.exitCode).toBe(0);
    expect(ok.stderr).toBe('');
    expect(JSON.parse(ok.stdout)).toEqual({
      ok: true,
      seat: 'seat-alpha',
      source: 'env',
      line: 'seat=seat-alpha source=env',
    });

    // The refusal arm: the poll's own --json contract — the object is emitted
    // even on the exit-2 arm, so a consumer parses one object AND reads the
    // exit code (mmnto-ai/totem#2312) — and stderr stays empty.
    const refused = await run({ repoRoot, env: {}, json: true });
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toBe('');
    expect(refused.tags).toEqual([]);
    const parsed = JSON.parse(refused.stdout) as { ok: boolean; refusal: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.refusal).toContain('seat-alpha');
    expect(parsed.refusal).toContain('seat-beta');

    // The contradiction arm under --json is the same object shape.
    const contradiction = await run({
      repoRoot,
      env: { TOTEM_SELF_AGENT: 'seat-alpha' },
      allSeats: true,
      json: true,
    });
    expect(contradiction.exitCode).toBe(2);
    expect(contradiction.stderr).toBe('');
    expect(JSON.parse(contradiction.stdout)).toMatchObject({ ok: false });
    expect((JSON.parse(contradiction.stdout) as { refusal: string }).refusal).toContain(
      '--all-seats',
    );
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

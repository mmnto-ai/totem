/**
 * `totem legs deposit` / `totem legs gate` (mmnto-ai/totem#2698).
 *
 * The writer is driven against a REAL temp git repo, because its whole job is
 * to bind a deposit to a sha this repo can resolve — a mocked `rev-parse`
 * would fixture away the only thing under test. Config loading is mocked (the
 * `shield-covariate.test.ts` precedent) so no jiti / real config is needed.
 *
 * The gate is driven through its derivation seam (`runLegsGate` + `LegsGateDeps`)
 * with an injected git adapter and a temp store: the five states are then
 * exercised without a fixture repo per case, and "not owed never consults the
 * store" can be asserted MECHANICALLY — a corrupt file is planted in the store
 * whose sensor row is impossible to produce without reading it.
 *
 * Control bytes in fixtures are built with `String.fromCharCode` on purpose:
 * this repo has a banked incident where an editing tool decoded a `\u`/`\x`
 * escape in source into a RAW control byte.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LegDeposit,
  legDepositPath,
  type LegGitAdapter,
  legsDir,
  saveLegDeposit,
  type TotemConfig,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { type LegsGateDeps, runLegsGate } from './legs.js';

const TEST_CONFIG = { totemDir: '.totem', ignorePatterns: [] } as unknown as TotemConfig;

// Config load: an in-memory config rooted at the (spied) cwd, so the writer
// resolves its store under the temp repo without a real config file.
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    loadEnv: vi.fn(),
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: vi.fn(async () => TEST_CONFIG),
  };
});

/** ESC — built, never authored as an escape sequence (the banked decode trap). */
const ESC = String.fromCharCode(27);

/** A syntactically valid 40-hex sha that names no object in any real repo. */
const ABSENT_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const HEAD_SHA = 'c'.repeat(40);

function depositFixture(overrides: Partial<LegDeposit> = {}): LegDeposit {
  return {
    schemaVersion: '1.0.0',
    diffSha: HEAD_SHA,
    readAt: '2026-09-01T00:00:00.000Z',
    findings: [
      {
        id: 'f1',
        severity: 'BLOCKING',
        file: 'packages/core/src/artifacts/legs.ts',
        line: 12,
        claim: 'the loader can throw on a corrupt file',
        counterexample: 'loadLegDeposits catches per file',
      },
    ],
    folded: ['f1'],
    verdict: 'one blocking finding, folded',
    ...overrides,
  };
}

// ─── The writer ─────────────────────────────────────────────────────────────

describe('totem legs deposit (mmnto-ai/totem#2698)', () => {
  /**
   * The REAL working directory, captured before any spy.
   *
   * `cross-spawn` (which `safeExec` goes through) resolves a command by
   * chdir-ing into the child's `cwd` and then restoring with `process.cwd()`
   * — so a test that mocks `process.cwd()` leaves the process parked in the
   * temp repo, which on Windows holds the directory open and fails teardown
   * with EPERM. Restoring it explicitly is the `verify-manifest.test.ts`
   * precedent; in production `process.cwd()` is genuine and the restore is
   * correct.
   */
  const realCwd = process.cwd();
  let tmpDir: string;
  let headSha: string;
  let errors: string[];

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-write-')));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: tmpDir, encoding: 'utf-8' });
    git('init', '-q');
    git('config', 'user.email', 'leg@example.test');
    git('config', 'user.name', 'Leg');
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'one\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'one');
    headSha = git('rev-parse', 'HEAD').trim();

    errors = [];
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(realCwd);
    cleanTmpDir(tmpDir);
  });

  /** Write a findings file and return its path. */
  function writeFindings(body: unknown, name = 'findings.json'): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, JSON.stringify(body, null, 2));
    return file;
  }

  const findingsBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    readAt: '2026-09-01T00:00:00.000Z',
    findings: [
      {
        id: 'f1',
        severity: 'BLOCKING',
        file: 'a.txt',
        line: 1,
        claim: 'the writer never validates',
        counterexample: 'saveLegDeposit parses on the way out',
      },
      {
        id: 'f2',
        severity: 'MINOR',
        file: 'a.txt',
        line: 2,
        claim: 'the line is unsanitized',
        counterexample: '',
      },
    ],
    folded: ['f1'],
    verdict: 'one blocking (folded), one minor',
    ...overrides,
  });

  it('refuses a --sha that names no commit, NAMING the ref', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await expect(
      legsDepositCommand({ from: writeFindings(findingsBody()), sha: ABSENT_SHA }),
    ).rejects.toThrow(`--sha ${ABSENT_SHA} does not name a commit in this repository`);
    // A refused write leaves no store behind.
    expect(fs.existsSync(legsDir(path.join(tmpDir, '.totem')))).toBe(false);
  });

  it('refuses a ref that would reach git as a flag', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await expect(
      legsDepositCommand({ from: writeFindings(findingsBody()), sha: '--upload-pack=evil' }),
    ).rejects.toThrow('git-flag injection guard');
  });

  it('refuses a findings file whose diffSha disagrees with --sha, naming BOTH', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await expect(
      legsDepositCommand({ from: writeFindings(findingsBody({ diffSha: OTHER_SHA })) }),
    ).rejects.toThrow(
      `The findings file names diffSha ${OTHER_SHA}, but --sha resolved to ${headSha}`,
    );
  });

  it('surfaces a schema violation with its Zod PATH', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    const body = findingsBody();
    // `folded` naming a finding that does not exist — the superRefine arm.
    body['folded'] = ['nope'];
    await expect(legsDepositCommand({ from: writeFindings(body) })).rejects.toThrow('folded.0');
  });

  it('surfaces a malformed finding with its Zod path', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    const body = findingsBody({ folded: [] });
    (body['findings'] as Array<Record<string, unknown>>)[0]!['severity'] = 'CRITICAL';
    await expect(legsDepositCommand({ from: writeFindings(body) })).rejects.toThrow(
      'findings.0.severity',
    );
  });

  it('refuses a findings file that is not readable JSON', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    const file = path.join(tmpDir, 'broken.json');
    fs.writeFileSync(file, '{ not json');
    await expect(legsDepositCommand({ from: file })).rejects.toThrow(
      "Could not read the leg's findings at",
    );
  });

  it('writes the deposit at the resolved head and prints the path plus the counts', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await legsDepositCommand({ from: writeFindings(findingsBody()) });
    const stored = legDepositPath(path.join(tmpDir, '.totem'), headSha);
    expect(fs.existsSync(stored)).toBe(true);
    const printed = errors.join('\n');
    expect(printed).toContain(stored);
    expect(printed).toContain('blocking=1 material=0 minor=1 folded=1');
    // The deposit names the head the leg read, not the file's own guess.
    const written = JSON.parse(fs.readFileSync(stored, 'utf-8')) as LegDeposit;
    expect(written.diffSha).toBe(headSha);
    expect(written.schemaVersion).toBe('1.0.0');
  });

  it('stamps readAt when neither the file nor --read-at carries one, and SAYS so', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    const body = findingsBody();
    delete body['readAt'];
    await legsDepositCommand({ from: writeFindings(body) });
    const printed = errors.join('\n');
    expect(printed).toContain('readAt defaulted to');
    expect(printed).toContain("pass --read-at for the leg's own instant");
    const written = JSON.parse(
      fs.readFileSync(legDepositPath(path.join(tmpDir, '.totem'), headSha), 'utf-8'),
    ) as LegDeposit;
    expect(Number.isNaN(Date.parse(written.readAt))).toBe(false);
  });

  it('--read-at overrides the file, and prints no defaulted line', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await legsDepositCommand({
      from: writeFindings(findingsBody()),
      readAt: '2026-08-30T12:00:00.000Z',
    });
    const written = JSON.parse(
      fs.readFileSync(legDepositPath(path.join(tmpDir, '.totem'), headSha), 'utf-8'),
    ) as LegDeposit;
    expect(written.readAt).toBe('2026-08-30T12:00:00.000Z');
    expect(errors.join('\n')).not.toContain('readAt defaulted');
  });

  it('refuses an occupied address without --replace, carrying the incumbent readAt', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await legsDepositCommand({ from: writeFindings(findingsBody()) });
    // The refusal is core's typed LegDepositExistsError, propagated untouched:
    // it carries the INCUMBENT's instant and names the one-flag cure.
    const refusal = await legsDepositCommand({
      from: writeFindings(findingsBody({ readAt: '2026-09-02T00:00:00.000Z' }), 'second.json'),
    }).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(refusal).toBeInstanceOf(Error);
    const typed = refusal as Error & { code?: string; recoveryHint?: string };
    expect(typed.code).toBe('LEG_DEPOSIT_EXISTS');
    expect(typed.message).toContain('2026-09-01T00:00:00.000Z');
    expect(typed.recoveryHint).toContain('--replace');
    // The incumbent is untouched by the refused write.
    const kept = JSON.parse(
      fs.readFileSync(legDepositPath(path.join(tmpDir, '.totem'), headSha), 'utf-8'),
    ) as LegDeposit;
    expect(kept.readAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('--replace overwrites and REPORTS the instant it replaced', async () => {
    const { legsDepositCommand } = await import('./legs.js');
    await legsDepositCommand({ from: writeFindings(findingsBody()) });
    errors.length = 0;
    await legsDepositCommand({
      from: writeFindings(findingsBody({ readAt: '2026-09-02T00:00:00.000Z' }), 'second.json'),
      replace: true,
    });
    expect(errors.join('\n')).toContain('replaced the deposit read at 2026-09-01T00:00:00.000Z');
    const written = JSON.parse(
      fs.readFileSync(legDepositPath(path.join(tmpDir, '.totem'), headSha), 'utf-8'),
    ) as LegDeposit;
    expect(written.readAt).toBe('2026-09-02T00:00:00.000Z');
  });
});

// ─── The gate ───────────────────────────────────────────────────────────────

describe('totem legs gate (mmnto-ai/totem#2698)', () => {
  let tmpDir: string;
  let totemDirAbs: string;
  let calls: string[];

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-gate-')));
    totemDirAbs = path.join(tmpDir, '.totem');
    calls = [];
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** A git seam that RECORDS every question asked of it. */
  function fakeGit(answers: {
    isCommit?: (sha: string) => boolean;
    isAncestor?: (base: string, head: string) => boolean;
    distance?: (base: string, head: string) => number;
  }): LegGitAdapter {
    return {
      isCommit(sha) {
        calls.push(`isCommit ${sha}`);
        return answers.isCommit?.(sha) ?? true;
      },
      isAncestor(base, head) {
        calls.push(`isAncestor ${base} ${head}`);
        return answers.isAncestor?.(base, head) ?? true;
      },
      distance(base, head) {
        calls.push(`distance ${base} ${head}`);
        return answers.distance?.(base, head) ?? 0;
      },
    };
  }

  function makeDeps(overrides: Partial<LegsGateDeps> = {}): LegsGateDeps {
    return {
      root: tmpDir,
      totemDirAbs,
      globs: ['docs/wiki/**', '.changeset/**'],
      git: fakeGit({}),
      resolveHead: () => HEAD_SHA,
      changedFiles: async () => ['docs/wiki/enforcement-model.md'],
      ...overrides,
    };
  }

  function storeDeposit(overrides: Partial<LegDeposit> = {}): void {
    saveLegDeposit(totemDirAbs, depositFixture(overrides));
  }

  /** Plant a file that is NOT a deposit — its sensor row proves the store was read. */
  function storeCorrupt(sha: string, body: string): void {
    fs.mkdirSync(legsDir(totemDirAbs), { recursive: true });
    fs.writeFileSync(path.join(legsDir(totemDirAbs), `${sha}.json`), body);
  }

  it('NOT OWED: names the globs it judged, and never consults the store', async () => {
    // A corrupt file sits in the store. Its sensor row is impossible to
    // produce without reading the store — so an empty stderr is the proof.
    storeCorrupt(ABSENT_SHA, 'not json at all');
    const outcome = await runLegsGate(
      {},
      makeDeps({ changedFiles: async () => ['packages/cli/src/index.ts', 'README.md'] }),
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toEqual([
      `[Totem] legs: not owed — no changed path matched hooks.legsOwed.globs (2 globs; head ${HEAD_SHA.slice(0, 8)})`,
    ]);
    expect(outcome.stderr).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('NOT OWED: an empty branch diff is not owed', async () => {
    const outcome = await runLegsGate({}, makeDeps({ changedFiles: async () => [] }));
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('not owed');
  });

  it('OWED, no deposit: exit 3 with the basis pairs and the cure', async () => {
    const outcome = await runLegsGate({}, makeDeps());
    expect(outcome.derived).toBe(3);
    expect(outcome.status).toBe(3);
    expect(outcome.stdout[0]).toContain(
      '[Totem] BLOCKED: this push is legs-owed (docs/wiki/** → docs/wiki/enforcement-model.md) and carries no fresh falsification-leg deposit for head cccccccc',
    );
    expect(outcome.stdout).toContain(
      '[Totem] legs: run the leg, then: totem legs deposit --sha HEAD --from <findings.json>',
    );
  });

  it('OWED: the basis line shows the first 5 pairs and counts the rest', async () => {
    const files = Array.from({ length: 8 }, (_, i) => `docs/wiki/page-${i}.md`);
    const outcome = await runLegsGate({}, makeDeps({ changedFiles: async () => files }));
    expect(outcome.stdout[0]).toContain('docs/wiki/page-0.md');
    expect(outcome.stdout[0]).toContain('docs/wiki/page-4.md');
    expect(outcome.stdout[0]).not.toContain('docs/wiki/page-5.md');
    expect(outcome.stdout[0]).toContain('+3 more');
  });

  it('OWED, stale only: exit 3 naming BOTH stale reasons distinctly', async () => {
    storeDeposit({ diffSha: ABSENT_SHA });
    storeDeposit({ diffSha: OTHER_SHA });
    const outcome = await runLegsGate(
      {},
      makeDeps({
        git: fakeGit({
          isCommit: (sha) => sha !== ABSENT_SHA,
          isAncestor: () => false,
        }),
      }),
    );
    expect(outcome.derived).toBe(3);
    expect(outcome.stdout).toContain(
      `[Totem] legs: stale deposit ${ABSENT_SHA.slice(0, 8)}: unknown to this repo`,
    );
    expect(outcome.stdout).toContain(
      `[Totem] legs: stale deposit ${OTHER_SHA.slice(0, 8)}: not an ancestor of head`,
    );
  });

  it('OWED, exact deposit: exit 0 with the evidence line', async () => {
    storeDeposit();
    const outcome = await runLegsGate({}, makeDeps());
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout).toHaveLength(1);
    const line = outcome.stdout[0]!;
    expect(line).toContain('[Totem] legs evidence: .totem/artifacts/legs/');
    expect(line).toContain('(read 2026-09-01T00:00:00.000Z,');
    expect(line).toContain(`· head ${HEAD_SHA.slice(0, 8)} ·`);
    expect(line).toContain('· exact ·');
    expect(line).toContain('blocking=1 material=0 folded=1');
    // The path is repo-root relative and forward-slashed on every platform.
    expect(line).not.toContain(tmpDir);
  });

  it('OWED, ancestor deposit: exit 0 and the line DISCLOSES the commits since the read', async () => {
    storeDeposit({ diffSha: OTHER_SHA });
    const outcome = await runLegsGate(
      {},
      makeDeps({ git: fakeGit({ isAncestor: () => true, distance: () => 7 }) }),
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('· nearest ancestor, +7 commits since the leg read ·');
  });

  it('OWED, several candidates: the winner is named and the others are DISCLOSED', async () => {
    storeDeposit(); // exact
    storeDeposit({ diffSha: OTHER_SHA, readAt: '2026-08-20T00:00:00.000Z' });
    const outcome = await runLegsGate(
      {},
      makeDeps({ git: fakeGit({ isAncestor: () => true, distance: () => 4 }) }),
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('· exact ·');
    expect(outcome.stdout[1]).toBe(
      `[Totem] legs: 1 superseded candidate(s) for this head: ${OTHER_SHA.slice(0, 8)} (read 2026-08-20T00:00:00.000Z, ancestor +4)`,
    );
  });

  it('a corrupt sibling is disclosed on stderr and never masks the valid deposit', async () => {
    storeDeposit();
    storeCorrupt(ABSENT_SHA, '{"schemaVersion":"1.0.0"}');
    storeCorrupt(OTHER_SHA, 'not json');
    const outcome = await runLegsGate({}, makeDeps());
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('[Totem] legs evidence:');
    expect(outcome.stderr).toHaveLength(2);
    for (const row of outcome.stderr) {
      expect(row).toContain('[Totem] legs: sensor — ignoring corrupt deposit ');
    }
    expect(outcome.stderr.join('\n')).toContain(`${ABSENT_SHA}.json`);
    expect(outcome.stderr.join('\n')).toContain(`${OTHER_SHA}.json`);
  });

  it('a corrupt store with no valid deposit still BLOCKS (the sensor is not evidence)', async () => {
    storeCorrupt(ABSENT_SHA, 'not json');
    const outcome = await runLegsGate({}, makeDeps());
    expect(outcome.derived).toBe(3);
    expect(outcome.stderr).toHaveLength(1);
  });

  it('NOT DERIVED: a thrown diff resolution is exit 2 with the cause', async () => {
    const outcome = await runLegsGate(
      {},
      makeDeps({
        changedFiles: async () => {
          throw new Error('fatal: not a git repository');
        },
      }),
    );
    expect(outcome.derived).toBe(2);
    expect(outcome.status).toBe(2);
    expect(outcome.stdout).toEqual(['[Totem] legs: NOT DERIVED — fatal: not a git repository']);
  });

  it('NOT DERIVED: an unresolvable head is exit 2 before any store read', async () => {
    storeCorrupt(ABSENT_SHA, 'not json');
    const outcome = await runLegsGate(
      {},
      makeDeps({
        resolveHead: () => {
          throw new Error('fatal: ambiguous argument HEAD');
        },
      }),
    );
    expect(outcome.derived).toBe(2);
    expect(outcome.stderr).toEqual([]);
  });

  it('--advisory maps 3 and 2 to 0 with BYTE-IDENTICAL stdout', async () => {
    const owedDeps = makeDeps();
    const strictOwed = await runLegsGate({}, owedDeps);
    const advisoryOwed = await runLegsGate({ advisory: true }, owedDeps);
    expect(strictOwed.derived).toBe(3);
    expect(advisoryOwed.derived).toBe(3);
    expect(advisoryOwed.status).toBe(0);
    expect(advisoryOwed.stdout).toEqual(strictOwed.stdout);

    const brokenDeps = makeDeps({
      changedFiles: async () => {
        throw new Error('fatal: not a git repository');
      },
    });
    const strictBroken = await runLegsGate({}, brokenDeps);
    const advisoryBroken = await runLegsGate({ advisory: true }, brokenDeps);
    expect(strictBroken.derived).toBe(2);
    expect(advisoryBroken.status).toBe(0);
    expect(advisoryBroken.stdout).toEqual(strictBroken.stdout);
  });

  it('every echoed value is control-character sanitized', async () => {
    // A changed path carrying a CSI sequence — built, never authored.
    const hostile = `docs/wiki/${ESC}[31mred.md`;
    const outcome = await runLegsGate({}, makeDeps({ changedFiles: async () => [hostile] }));
    expect(outcome.derived).toBe(3);
    expect(outcome.stdout[0]).toContain('docs/wiki/');
    expect(outcome.stdout[0]).not.toContain(ESC);
  });

  it('the gate judges the globs it was GIVEN, not the default floor', async () => {
    const outcome = await runLegsGate(
      {},
      makeDeps({
        globs: ['packages/core/src/artifacts/**'],
        changedFiles: async () => ['docs/wiki/enforcement-model.md'],
      }),
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('(1 globs;');
  });
});

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
  sanitizeForTerminal,
  saveLegDeposit,
  type TotemConfig,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { type LegsGateDeps, runLegsGate } from './legs.js';

const TEST_CONFIG = { totemDir: '.totem', ignorePatterns: [] } as unknown as TotemConfig;

/**
 * The config every command under test loads. Re-pointed per suite (the fold-1
 * suite needs one whose `ignorePatterns` names the very file it asserts on), so
 * every `beforeEach` states the config it means to run under rather than
 * inheriting whichever the previous suite left behind.
 */
const loadConfigMock = vi.fn(async (): Promise<TotemConfig> => TEST_CONFIG);

// Config load: an in-memory config rooted at the (spied) cwd, so the writer
// resolves its store under the temp repo without a real config file.
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    loadEnv: vi.fn(),
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: loadConfigMock,
  };
});

/** ESC — built, never authored as an escape sequence (the banked decode trap). */
const ESC = String.fromCharCode(27);

/**
 * The base every fake scope resolves against, and the reach every fake
 * candidate has by default: coverage (mmnto-ai/totem#2698 fold 3) is measured
 * as `base...<diffSha>` intersected with the owed paths, so a fixture that
 * declares neither would read as "covers nothing" and turn every pre-coverage
 * case stale. `DEFAULT_REACH` is deliberately broad — the cases that mean to
 * exercise coverage override it.
 */
const BASE = 'main';
const DEFAULT_REACH = [
  'docs/wiki/enforcement-model.md',
  'docs/wiki/cli-reference.md',
  'docs/wiki/page.md',
  'README.md',
  'a.ts',
];

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
    loadConfigMock.mockResolvedValue(TEST_CONFIG);
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
    /** What each candidate's own branch diff contained (fold 3's coverage). */
    changedFiles?: (base: string, head: string) => readonly string[];
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
      changedFiles(base, head) {
        calls.push(`changedFiles ${base} ${head}`);
        // Default: the candidate's diff contained everything the deps declare
        // changed, so the existing cases keep their pre-coverage meaning.
        return answers.changedFiles?.(base, head) ?? DEFAULT_REACH;
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
      changedFiles: async () => ({ files: ['docs/wiki/enforcement-model.md'], base: BASE }),
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
      makeDeps({
        changedFiles: async () => ({
          files: ['packages/cli/src/index.ts', 'README.md'],
          base: BASE,
        }),
      }),
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
    const outcome = await runLegsGate(
      {},
      makeDeps({ changedFiles: async () => ({ files: [], base: BASE }) }),
    );
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
    const outcome = await runLegsGate(
      {},
      makeDeps({ changedFiles: async () => ({ files: files, base: BASE }) }),
    );
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
    const outcome = await runLegsGate(
      {},
      makeDeps({ changedFiles: async () => ({ files: [hostile], base: BASE }) }),
    );
    expect(outcome.derived).toBe(3);
    expect(outcome.stdout[0]).toContain('docs/wiki/');
    expect(outcome.stdout[0]).not.toContain(ESC);
  });

  it('the gate judges the globs it was GIVEN, not the default floor', async () => {
    const outcome = await runLegsGate(
      {},
      makeDeps({
        globs: ['packages/core/src/artifacts/**'],
        changedFiles: async () => ({ files: ['docs/wiki/enforcement-model.md'], base: BASE }),
      }),
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('(1 globs;');
  });
});

// ─── Fold 1: the floor sees the UNFILTERED branch diff ──────────────────────

/**
 * `ignorePatterns` carries INDEX-exclusion semantics that were merged into the
 * review/lint diff filter for back-compat (mmnto-ai/totem#1746 /
 * mmnto-ai/totem#1748). If it also narrowed this predicate, a repo that keeps
 * `README.md` out of its index would silently stop owing a leg for its public
 * copy — a floor that cannot see the surface it names. This drives the REAL
 * seam (`buildLegsGateDeps`) against a real two-branch repo, so the assertion
 * is about what the resolution actually returns, not about a fake.
 */
describe('the legs floor classifies the UNFILTERED branch diff (mmnto-ai/totem#2698 fold 1)', () => {
  const realCwd = process.cwd();
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-filter-')));
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: tmpDir, encoding: 'utf-8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'leg@example.test');
    git('config', 'user.name', 'Leg');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'the public copy\n');
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    // The branch under test: it touches the very file `ignorePatterns` names.
    git('checkout', '-q', '-b', 'feat/public-copy');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'the public copy, revised\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'revise the public copy');

    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The config IGNORES README.md — the pre-fold behavior would drop it here.
    loadConfigMock.mockResolvedValue({
      totemDir: '.totem',
      ignorePatterns: ['README.md'],
      shieldIgnorePatterns: ['README.md'],
      hooks: { legsOwed: { globs: ['README.md', 'docs/wiki/**'] } },
    } as unknown as TotemConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    loadConfigMock.mockResolvedValue(TEST_CONFIG);
    process.chdir(realCwd);
    cleanTmpDir(tmpDir);
  });

  it('an ignorePatterns-named path still reaches the predicate, and still owes a leg', async () => {
    const { buildLegsGateDeps, runLegsGate } = await import('./legs.js');
    const deps = await buildLegsGateDeps();

    // The seam itself: the resolution returns the ignored path.
    const scope = await deps.changedFiles();
    expect(scope.files).toContain('README.md');
    // The base rides back with the files: coverage is measured against it
    // (mmnto-ai/totem#2698 fold 3), and it must be the base HEAD resolved on.
    expect(scope.base).toBe('main');

    // And the verdict names it as the basis.
    const outcome = await runLegsGate({}, deps);
    expect(outcome.derived).toBe(3);
    expect(outcome.stdout[0]).toContain('README.md → README.md');
  });

  it('discloses that the floor judged an unfiltered diff', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    });
    const { buildLegsGateDeps } = await import('./legs.js');
    const deps = await buildLegsGateDeps();
    await deps.changedFiles();
    const narration = lines.join('\n');
    // The stable halves: the base it judged against, and the fact that the
    // ignore config did not apply. The middle now carries the resolved base.
    expect(narration).toContain('Diff source: branch-vs-base (');
    expect(narration).toContain('unfiltered — ignorePatterns do not apply to the floor)');
    expect(narration).toContain('main...HEAD');
    // Exactly ONE `Changed files` line: the suppressed resolver no longer
    // prints its own C-quoted one beside the gate's raw one (fold 5).
    expect(narration.split('Changed files (')).toHaveLength(2);
  });
});

// ─── Fold 2: no echoed value can forge a second line ────────────────────────

describe('every echoed value is line-safe (mmnto-ai/totem#2698 fold 2)', () => {
  /** LF — built, never authored as an escape (the banked decode trap). */
  const LF = String.fromCharCode(10);
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-line-')));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * Every stdout entry is exactly ONE line.
   *
   * The array element IS the unit of the write (`fs.writeSync(1, line + LF)`),
   * so "no element contains a line break" is the whole forge-prevention
   * property — a hostile value that merely repeats the literal text `[Totem]`
   * inside one line is ugly, not a forged line, and the count of markers is
   * therefore not the assertion.
   */
  function expectNoForgedLine(lines: readonly string[]): void {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.includes(LF)).toBe(false);
      expect(line.includes(String.fromCharCode(13))).toBe(false);
    }
  }

  it('a glob AND a changed path carrying a newline cannot forge a second [Totem] line', async () => {
    const { runLegsGate } = await import('./legs.js');
    // A literal glob that MATCHES the hostile path, so BOTH halves of the
    // basis pair carry the newline and both must be flattened.
    const hostile = `docs/wiki/a${LF}b.md`;
    const outcome = await runLegsGate(
      {},
      {
        root: tmpDir,
        totemDirAbs: path.join(tmpDir, '.totem'),
        globs: [hostile],
        git: {
          isCommit: () => true,
          isAncestor: () => false,
          distance: () => 0,
          changedFiles: () => [],
        },
        resolveHead: () => HEAD_SHA,
        changedFiles: async () => ({ files: [hostile], base: BASE }),
      },
    );
    expect(outcome.derived).toBe(3);
    // The basis pair is present — the value was flattened, not dropped.
    expect(outcome.stdout[0]).toContain('docs/wiki/a?b.md → docs/wiki/a?b.md');
    expectNoForgedLine(outcome.stdout);
    // Owed-and-unanswered is exactly two lines: the block and the cure. A forged
    // third would have to come from the payload, and cannot.
    expect(outcome.stdout).toHaveLength(2);
    expect(outcome.stdout.join(LF).split('[Totem]')).toHaveLength(3);
    // sanitizeForTerminal ALONE would have left the LF standing; this is the
    // property the second stage adds.
    expect(sanitizeForTerminal(hostile).includes(LF)).toBe(true);
  });

  it('a corrupt-deposit reason and a NOT DERIVED cause are line-safe too', async () => {
    const { runLegsGate } = await import('./legs.js');
    const notDerived = await runLegsGate(
      {},
      {
        root: tmpDir,
        totemDirAbs: path.join(tmpDir, '.totem'),
        globs: ['**'],
        git: {
          isCommit: () => true,
          isAncestor: () => true,
          distance: () => 0,
          changedFiles: () => [],
        },
        resolveHead: () => {
          throw new Error(`fatal: bad revision${LF}[Totem] legs evidence: forged`);
        },
        changedFiles: async () => ({ files: ['a.ts'], base: BASE }),
      },
    );
    expect(notDerived.derived).toBe(2);
    expectNoForgedLine(notDerived.stdout);
    // NOT DERIVED is ONE line, even though the cause embeds a newline AND the
    // literal `[Totem]` marker — the flattened text stays inside that one line.
    expect(notDerived.stdout).toHaveLength(1);
    expect(notDerived.stdout[0]).toContain('NOT DERIVED — fatal: bad revision?');
    expect(notDerived.stdout[0]).toContain('?[Totem] legs evidence: forged');
  });
});

// ─── Fold 2 (MINOR): a distance is derived or it is not derived ─────────────

describe('the gate never GUESSES a distance (mmnto-ai/totem#2698 fold 2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-dist-')));
    saveLegDeposit(path.join(tmpDir, '.totem'), depositFixture({ diffSha: OTHER_SHA }));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('an adapter whose distance fails yields NOT DERIVED, never a fabricated +0', async () => {
    const { runLegsGate } = await import('./legs.js');
    const outcome = await runLegsGate(
      {},
      {
        root: tmpDir,
        totemDirAbs: path.join(tmpDir, '.totem'),
        globs: ['docs/wiki/**'],
        git: {
          isCommit: () => true,
          isAncestor: () => true,
          distance: () => {
            throw new Error('git rev-list --count returned "" , which is not a commit count.');
          },
          // It COVERS the owed path — so the run reaches the distance probe,
          // which is the failure under test.
          changedFiles: () => ['docs/wiki/page.md'],
        },
        resolveHead: () => HEAD_SHA,
        changedFiles: async () => ({ files: ['docs/wiki/page.md'], base: BASE }),
      },
    );
    // The number is PRINTED as fact on the evidence line, so an underivable
    // one is a failure to derive — not a zero that would render a stale read
    // as an exact one.
    expect(outcome.derived).toBe(2);
    expect(outcome.stdout[0]).toContain('[Totem] legs: NOT DERIVED — git rev-list --count');
    expect(outcome.stdout.join(' ')).not.toContain('legs evidence');
    expect(outcome.stdout.join(' ')).not.toContain('+0 commits');
  });
});

// ─── Fold 3: coverage is a freshness predicate ──────────────────────────────
//
// Ancestry alone let a deposit written against the branch's MERGE BASE pass:
// it is an ancestor, it reports a small distance, and the leg that wrote it saw
// none of the diff the push proposes. The gate now measures what a candidate
// could have READ (mmnto-ai/totem#2698 fold 3, operator-ruled).
describe('the gate measures COVERAGE, not only ancestry (mmnto-ai/totem#2698 fold 3)', () => {
  let tmpDir: string;
  let totemDirAbs: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-cov-')));
    totemDirAbs = path.join(tmpDir, '.totem');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** Deps whose candidate reached exactly `reach`, against one owed glob. */
  function coverageDeps(reach: readonly string[], changed: readonly string[]): LegsGateDeps {
    return {
      root: tmpDir,
      totemDirAbs,
      globs: ['docs/wiki/**'],
      git: {
        isCommit: () => true,
        isAncestor: () => true,
        distance: () => 1,
        changedFiles: () => reach,
      },
      resolveHead: () => HEAD_SHA,
      changedFiles: async () => ({ files: changed, base: BASE }),
    };
  }

  it('a merge-base deposit that covers NO owed path is stale, with its own reason', async () => {
    saveLegDeposit(totemDirAbs, depositFixture({ diffSha: OTHER_SHA }));
    const outcome = await runLegsGate(
      {},
      coverageDeps(['src/unrelated.ts'], ['docs/wiki/enforcement-model.md']),
    );
    expect(outcome.derived).toBe(3);
    expect(outcome.stdout).toContain(
      `[Totem] legs: stale deposit ${OTHER_SHA.slice(0, 8)}: covers none of the owed paths (the deposit predates every owed change)`,
    );
    // It is BLOCKED, not merely disclosed — the exhibit that produced the rule.
    expect(outcome.stdout[0]).toContain('[Totem] BLOCKED: this push is legs-owed');
  });

  it('PARTIAL coverage passes, and the evidence line reports covers K/N', async () => {
    saveLegDeposit(totemDirAbs, depositFixture({ diffSha: OTHER_SHA }));
    const outcome = await runLegsGate(
      {},
      coverageDeps(['docs/wiki/a.md'], ['docs/wiki/a.md', 'docs/wiki/b.md', 'docs/wiki/c.md']),
    );
    expect(outcome.derived).toBe(0);
    // K < N is DISCLOSURE, never a block: the read happened, and the number is
    // what makes the re-arm question legible to the round.
    expect(outcome.stdout[0]).toContain(
      '· nearest ancestor, +1 commits since the leg read · covers 1/3 owed paths · blocking=1',
    );
  });

  it('an EXACT deposit covers everything without a coverage git call', async () => {
    saveLegDeposit(totemDirAbs, depositFixture({ diffSha: HEAD_SHA }));
    const outcome = await runLegsGate(
      {},
      {
        ...coverageDeps([], ['docs/wiki/a.md', 'docs/wiki/b.md']),
        git: {
          isCommit: () => true,
          isAncestor: () => true,
          distance: () => 0,
          changedFiles: () => {
            throw new Error('changedFiles must not be called for an exact match');
          },
        },
      },
    );
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('· exact · covers 2/2 owed paths ·');
  });

  it('a scope with no base is NOT DERIVED — the gate never falls back to ancestry-only', async () => {
    // Falling back would restore exactly the merge-base pass the ruling closed.
    saveLegDeposit(totemDirAbs, depositFixture({ diffSha: OTHER_SHA }));
    const deps = coverageDeps(['docs/wiki/a.md'], ['docs/wiki/a.md']);
    const outcome = await runLegsGate(
      {},
      { ...deps, changedFiles: async () => ({ files: ['docs/wiki/a.md'] }) },
    );
    expect(outcome.derived).toBe(2);
    expect(outcome.stdout[0]).toContain(
      'NOT DERIVED — the branch scope resolved without a base ref, so coverage is not derivable',
    );
  });

  it('coverage is measured against the base the scope resolved, not a guess', async () => {
    saveLegDeposit(totemDirAbs, depositFixture({ diffSha: OTHER_SHA }));
    const seen: string[] = [];
    const deps = coverageDeps(['docs/wiki/a.md'], ['docs/wiki/a.md']);
    await runLegsGate(
      {},
      {
        ...deps,
        changedFiles: async () => ({ files: ['docs/wiki/a.md'], base: 'origin/release' }),
        git: {
          isCommit: () => true,
          isAncestor: () => true,
          distance: () => 1,
          changedFiles: (base, head) => {
            seen.push(`${base}...${head}`);
            return ['docs/wiki/a.md'];
          },
        },
      },
    );
    expect(seen).toEqual([`origin/release...${OTHER_SHA}`]);
  });
});

// ─── Fold 4: the reach probe must not speak git's quoted dialect ────────────
//
// `git diff --name-only` C-QUOTES any path with a non-ASCII byte, a quote or a
// backslash under the default `core.quotePath` — `"docs/caf\303\251.md"` —
// while the owed set comes from `extractChangedFiles`, unquoted. The two then
// never intersect for such a path, and a COVERING ancestor is rejected with the
// false reason "predates every owed change". `-z` never quotes.
//
// This drives the REAL adapter (`buildLegsGateDeps`) against a real repo,
// because the defect lives in the argv, which a fake seam cannot reproduce.
//
// COVERAGE DECLARATION: the two names here — non-ASCII, and ASCII with a space
// — are legal on every platform, so this suite runs everywhere. The two NTFS
// refuses (a double quote, a backslash) are the sibling suite below, POSIX-only.
describe('the coverage reach reads unquoted paths (mmnto-ai/totem#2698 fold 4)', () => {
  const realCwd = process.cwd();
  let tmpDir: string;
  /** `docs/café.md` — built, never authored as an escape (the banked trap). */
  const ACCENTED = `docs/caf${String.fromCharCode(0xe9)}.md`;
  /** The ASCII control: a space is not quoted by `--name-only`, and must stay green. */
  const SPACED = 'docs/a page.md';
  let coveredSha: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-utf8-')));
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    git('init', '-b', 'main');
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export const a = 1;');
    git('add', '.');
    git('commit', '-m', 'base');

    // C1 touches the two owed paths a leg here could have read.
    git('checkout', '-b', 'feat/owed');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ...ACCENTED.split('/')), '# accented');
    fs.writeFileSync(path.join(tmpDir, ...SPACED.split('/')), '# spaced');
    git('add', '-A', 'docs');
    git('commit', '-m', 'the owed pages');
    coveredSha = git('rev-parse', 'HEAD');

    // C2 adds a third owed path the C1 leg could NOT have read.
    fs.writeFileSync(path.join(tmpDir, 'docs', 'later.md'), '# later');
    git('add', 'docs/later.md');
    git('commit', '-m', 'a later page');

    loadConfigMock.mockResolvedValue({
      totemDir: '.totem',
      ignorePatterns: [],
      hooks: { legsOwed: { globs: ['docs/**'] } },
    } as unknown as TotemConfig);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    loadConfigMock.mockResolvedValue(TEST_CONFIG);
    process.chdir(realCwd);
    cleanTmpDir(tmpDir);
  });

  it('a non-ASCII owed path is COVERED, not falsely reported as uncovered', async () => {
    const { buildLegsGateDeps, runLegsGate } = await import('./legs.js');
    saveLegDeposit(path.join(tmpDir, '.totem'), depositFixture({ diffSha: coveredSha }));
    const deps = await buildLegsGateDeps();

    // The owed set itself carries the raw name — this is the side the reach
    // probe has to match.
    const scope = await deps.changedFiles();
    expect(scope.files).toContain(ACCENTED);

    const outcome = await runLegsGate({}, deps);
    // Two of the three owed paths were inside C1's diff; without `-z` the
    // accented one would drop out and this would read `covers 1/3`.
    expect(outcome.derived).toBe(0);
    expect(outcome.stdout[0]).toContain('covers 2/3 owed paths');
  });

  it('the ASCII-with-space control is covered on the same run', async () => {
    const { buildLegsGateDeps } = await import('./legs.js');
    const deps = await buildLegsGateDeps();
    const scope = await deps.changedFiles();
    expect(scope.files).toContain(SPACED);
    // The adapter's own answer, read directly: both names come back raw.
    const reach = deps.git.changedFiles(scope.base ?? 'main', coveredSha);
    expect(reach).toContain(SPACED);
    expect(reach).toContain(ACCENTED);
    // And nothing came back wearing git's quotes.
    expect(reach.some((entry) => entry.startsWith('"'))).toBe(false);
  });
});

// The two names NTFS refuses (mmnto-ai/totem#2698 fold 5). A double quote and a
// backslash are legal on Linux and macOS — where the strict-tier population
// actually runs — and git C-quotes BOTH in `diff --git` headers, exactly as it
// does a non-ASCII byte. The fold-4 decoder handled octal triples only, so these
// two still reached the intersection escaped while the reach read them raw.
// Reading the owed side through the same `-z` helper is what makes them agree,
// and these cases are the ones a decoder could never have covered.
//
// COVERAGE DECLARATION: this suite is POSIX-only by necessity, so it lands on
// the ubuntu and macos CI legs; the non-ASCII and the space cases live in the
// suite above and run everywhere, win32 included.
describe.skipIf(process.platform === 'win32')(
  'the coverage reach reads quote- and backslash-bearing paths (mmnto-ai/totem#2698 fold 5)',
  () => {
    const realCwd = process.cwd();
    let tmpDir: string;
    /** Built, never authored as escapes. */
    const QUOTED = `docs/a${String.fromCharCode(34)}quoted${String.fromCharCode(34)}.md`;
    const BACKSLASHED = `docs/back${String.fromCharCode(92)}slash.md`;
    let coveredSha: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-hostile-')),
      );
      const git = (...args: string[]): string =>
        execFileSync(
          'git',
          ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
          { cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
      git('init', '-b', 'main');
      fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export const a = 1;');
      git('add', '.');
      git('commit', '-m', 'base');

      // C1 — the two hostile names a leg here could have read.
      git('checkout', '-b', 'feat/hostile');
      fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ...QUOTED.split('/')), '# quoted');
      fs.writeFileSync(path.join(tmpDir, ...BACKSLASHED.split('/')), '# backslashed');
      git('add', '-A', 'docs');
      git('commit', '-m', 'the hostile pages');
      coveredSha = git('rev-parse', 'HEAD');

      // C2 — one more owed path, after the read.
      fs.writeFileSync(path.join(tmpDir, 'docs', 'later.md'), '# later');
      git('add', 'docs/later.md');
      git('commit', '-m', 'a later page');

      loadConfigMock.mockResolvedValue({
        totemDir: '.totem',
        ignorePatterns: [],
        hooks: { legsOwed: { globs: ['docs/**'] } },
      } as unknown as TotemConfig);
      vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      loadConfigMock.mockResolvedValue(TEST_CONFIG);
      process.chdir(realCwd);
      cleanTmpDir(tmpDir);
    });

    it('both names reach the owed set RAW, and an ancestor deposit covers them', async () => {
      const { buildLegsGateDeps, runLegsGate } = await import('./legs.js');
      saveLegDeposit(path.join(tmpDir, '.totem'), depositFixture({ diffSha: coveredSha }));
      const deps = await buildLegsGateDeps();

      const scope = await deps.changedFiles();
      // Raw on the OWED side — the half the decoder could not fix.
      expect(scope.files).toContain(QUOTED);
      expect(scope.files).toContain(BACKSLASHED);
      expect(scope.files.some((file) => file.includes(String.fromCharCode(92) + '"'))).toBe(false);

      const outcome = await runLegsGate({}, deps);
      expect(outcome.derived).toBe(0);
      // An ANCESTOR deposit, so the reach probe really ran (an exact match
      // would have been credited without one).
      expect(outcome.stdout[0]).toContain('nearest ancestor, +1 commits since the leg read');
      expect(outcome.stdout[0]).toContain('covers 2/3 owed paths');
    });

    it('the BLOCKED basis spells both names as they are on disk', async () => {
      const { buildLegsGateDeps, runLegsGate } = await import('./legs.js');
      const deps = await buildLegsGateDeps();
      const outcome = await runLegsGate({}, deps);
      expect(outcome.derived).toBe(3);
      expect(outcome.stdout[0]).toContain(`${QUOTED}`);
      expect(outcome.stdout[0]).toContain(`${BACKSLASHED}`);
    });
  },
);

// ─── Bot round on PR mmnto-ai/totem#2745 ───────────────────────────────────

describe('the evidence line names a future-dated readAt (mmnto-ai/totem#2745, CodeRabbit)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-age-')));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function depositAgeDeps(): LegsGateDeps {
    return {
      root: tmpDir,
      totemDirAbs: path.join(tmpDir, '.totem'),
      globs: ['docs/**'],
      git: {
        isCommit: () => true,
        isAncestor: () => true,
        distance: () => 0,
        changedFiles: () => ['docs/a.md'],
      },
      resolveHead: () => HEAD_SHA,
      changedFiles: async () => ({ files: ['docs/a.md'], base: BASE }),
    };
  }

  it('a PAST readAt still reports its age in days', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
    saveLegDeposit(
      path.join(tmpDir, '.totem'),
      depositFixture({ diffSha: HEAD_SHA, readAt: threeDaysAgo }),
    );
    const outcome = await runLegsGate({}, depositAgeDeps());
    expect(outcome.stdout[0]).toContain('3 days old');
  });

  it('a FUTURE readAt is named as such, not reported as `age unknown`', async () => {
    // `age unknown` reads as "unparseable" and hides the one thing worth
    // acting on: the instant is wrong, and ranking breaks ties on it.
    const twoDaysAhead = new Date(Date.now() + 2 * 86_400_000 + 1000).toISOString();
    saveLegDeposit(
      path.join(tmpDir, '.totem'),
      depositFixture({ diffSha: HEAD_SHA, readAt: twoDaysAhead }),
    );
    const outcome = await runLegsGate({}, depositAgeDeps());
    expect(outcome.stdout[0]).toContain(
      'read 2 days in the FUTURE — check the clock or the deposit',
    );
    expect(outcome.stdout[0]).not.toContain('age unknown');
    // Still evidence: a skewed clock is a disclosure, not a block.
    expect(outcome.derived).toBe(0);
  });
});

describe('the gate caps its changed-files disclosure (mmnto-ai/totem#2745, CodeRabbit)', () => {
  const realCwd = process.cwd();
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-cap-')));
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    git('init', '-b', 'main');
    fs.writeFileSync(path.join(tmpDir, 'src.ts'), 'export const a = 1;');
    git('add', '.');
    git('commit', '-m', 'base');
    git('checkout', '-b', 'feat/many');
    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });
    // 20 changed paths — more than the cap, so the line must collapse.
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(tmpDir, 'docs', `page-${i}.md`), `# page ${i}`);
    }
    git('add', '-A', 'docs');
    git('commit', '-m', 'many pages');

    loadConfigMock.mockResolvedValue({
      totemDir: '.totem',
      ignorePatterns: [],
      hooks: { legsOwed: { globs: ['docs/**'] } },
    } as unknown as TotemConfig);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    loadConfigMock.mockResolvedValue(TEST_CONFIG);
    process.chdir(realCwd);
    cleanTmpDir(tmpDir);
  });

  it('names 12 paths, counts the rest, and keeps the TRUE total in the parentheses', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    });
    const { buildLegsGateDeps } = await import('./legs.js');
    const deps = await buildLegsGateDeps();
    await deps.changedFiles();
    const line = lines.find((entry) => entry.includes('Changed files ('));
    expect(line).toBeDefined();
    // The count is the truth; the list is what got shortened.
    expect(line).toContain('Changed files (20):');
    expect(line).toContain('+8 more');
    expect(line).toContain('docs/page-0.md');
    // The 13th name onward is collapsed. Names sort lexically, so `page-9.md`
    // is last of the twenty and certainly past the cap.
    expect(line).not.toContain('docs/page-9.md');
  });
});

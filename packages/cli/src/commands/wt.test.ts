/**
 * `totem wt create|remove|list` tests (mmnto-ai/totem#2580 slice-2).
 *
 * The design's "Invariants to lock in via tests" list is the spine of this
 * file — each `describe` names the invariant it pins, because those are the
 * claims these verbs are allowed to make.
 *
 * Git is injected (a fake that actually mutates the temp filesystem, so the
 * verify-absence contract is exercised against real disk state rather than a
 * mocked answer), and the user-level registry is redirected by pinning
 * HOME/USERPROFILE at a temp home — the fixture shape doctor.test.ts already
 * uses for `readRegistry`.
 *
 * Invariant 3 (residue never follows a link out of the tree) is pinned in
 * `packages/core/src/worktree-residue.test.ts`, against a real junction
 * fixture; here the residue finish is exercised through its seam so the
 * still-present FAILURE arm — which no portable filesystem fixture can force —
 * is reachable.
 */

import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readWorktreeRegistry,
  type ResidueRemovalResult,
  type WorktreeFile,
  worktreeRegistryPath,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { wtCreateCommand, type WtExecFn, wtListCommand, wtRemoveCommand } from './wt.js';

const IS_WIN32 = process.platform === 'win32';
const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const CREATED_AT = '2026-08-05T12:00:00.000Z';

/** Strip ANSI so assertions are colour-independent (doctor-estate.test.ts:29). */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let root: string;
let home: string;
let repo: string;
let container: string;
let lines: string[];
let errSpy: ReturnType<typeof vi.spyOn>;
let prevHome: string | undefined;
let prevProfile: string | undefined;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-wt-')));
  home = path.join(root, 'home');
  // `<root>/ws` is the workspace; the repo lives inside it, so `<root>/ws` is
  // the workspace root a create must refuse.
  repo = path.join(root, 'ws', 'repo');
  container = path.join(root, 'container');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(container, { recursive: true });

  prevHome = process.env['HOME'];
  prevProfile = process.env['USERPROFILE'];
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;

  lines = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
    lines.push(String(msg).replace(ANSI, ''));
  });
});

afterEach(() => {
  errSpy.mockRestore();
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevProfile;
  cleanTmpDir(root);
});

function output(): string {
  return lines.join('\n');
}

function fold(p: string): string {
  return IS_WIN32 ? path.resolve(p).toLowerCase() : path.resolve(p);
}

/** Capture the `--json` artifact written to stdout. */
async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

// ─── The fake git ───────────────────────────────────────

interface FakeGitOptions {
  /** Paths git already lists as linked worktrees. */
  listed?: string[];
  /** `worktree add` behaviour: create the dir, fail like a branch clash, or fail leaving a partial dir. */
  add?: 'create' | 'throw' | 'throw-after-create';
  /** `worktree remove` behaviour: delete it, exit 0 leaving a husk, or fail. */
  remove?: 'delete' | 'husk' | 'throw';
  /** Rows the ECL `status --porcelain --ignored` probe answers with. */
  statusRows?: string[];
  /** Make the ECL probe itself fail (an unlisted husk is not a git worktree). */
  statusThrows?: boolean;
  /** Make `worktree list` fail (an unreadable home repo). */
  listThrows?: boolean;
  /** Answer for `rev-parse --git-common-dir` (default: the primary's `.git`). */
  commonDir?: string;
}

interface FakeGit {
  exec: WtExecFn;
  calls: string[][];
  /** Registry snapshot taken the instant `worktree add` was invoked. */
  registryAtAdd?: WorktreeFile;
}

function fakeGit(options: FakeGitOptions = {}): FakeGit {
  const listed = new Set((options.listed ?? []).map(fold));
  const state: FakeGit = { calls: [], exec: (() => '') as WtExecFn };

  state.exec = ((_command: string, args: string[] = []): string => {
    state.calls.push(args);
    const cwdIdx = args.indexOf('-C');
    const cwd = args[cwdIdx + 1] ?? '';
    const verbs = args.slice(cwdIdx + 2);

    if (verbs[0] === 'rev-parse' && verbs[1] === '--show-toplevel') {
      if (fold(cwd) === fold(repo) || fold(cwd).startsWith(fold(repo) + path.sep)) {
        return repo.split(path.sep).join('/');
      }
      throw new Error('fatal: not a git repository');
    }

    if (verbs[0] === 'rev-parse' && verbs.includes('--git-common-dir')) {
      return (options.commonDir ?? path.join(repo, '.git')).split(path.sep).join('/');
    }

    if (verbs[0] === 'status') {
      if (options.statusThrows === true) throw new Error('fatal: not a git repository');
      return (options.statusRows ?? []).join('\n');
    }

    if (verbs[0] === 'worktree' && verbs[1] === 'list') {
      if (options.listThrows === true) throw new Error('fatal: not a git repository');
      const blocks = [
        `worktree ${repo.split(path.sep).join('/')}`,
        `HEAD ${'a'.repeat(40)}`,
        'branch refs/heads/main',
        '',
      ];
      for (const wt of listed) {
        blocks.push(
          `worktree ${path.resolve(wt).split(path.sep).join('/')}`,
          `HEAD ${'b'.repeat(40)}`,
          'branch refs/heads/wt/x',
          '',
        );
      }
      return blocks.join('\n');
    }

    if (verbs[0] === 'worktree' && verbs[1] === 'add') {
      // Snapshot the registry AS GIT IS INVOKED — invariant 6's evidence.
      state.registryAtAdd = readWorktreeRegistry();
      if (options.add === 'throw') {
        throw new Error("fatal: a branch named 'wt/demo' already exists");
      }
      if (options.add === 'throw-after-create') {
        // Git failed MID-POPULATE: the target directory landed, the checkout
        // did not — the partial-directory arm of the create rollback.
        fs.mkdirSync(args[args.length - 1]!, { recursive: true });
        throw new Error('fatal: disk exploded mid-checkout');
      }
      const target = args[args.length - 1]!;
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'file.txt'), 'work', 'utf-8');
      listed.add(fold(target));
      return '';
    }

    if (verbs[0] === 'worktree' && verbs[1] === 'remove') {
      const target = args[args.length - 1]!;
      if (options.remove === 'throw') throw new Error('fatal: worktree is locked');
      listed.delete(fold(target));
      // `husk`: git exits 0 and the directory survives — the exact fail-open
      // this verb exists to close.
      if (options.remove !== 'husk') {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
      return '';
    }

    if (verbs[0] === 'worktree' && verbs[1] === 'prune') return '';
    return '';
  }) as WtExecFn;

  return state;
}

/** Every `git` invocation whose verb sequence starts with these tokens. */
function callsMatching(git: FakeGit, ...verbs: string[]): string[][] {
  return git.calls.filter((args) => {
    const cwdIdx = args.indexOf('-C');
    const tail = args.slice(cwdIdx + 2);
    return verbs.every((v, i) => tail[i] === v);
  });
}

async function createOne(
  git: FakeGit,
  overrides: Partial<Parameters<typeof wtCreateCommand>[0]> = {},
): Promise<string> {
  await wtCreateCommand({
    slug: 'demo',
    root: container,
    seat: 'totem-claude',
    cwdForTest: repo,
    envForTest: {},
    execForTest: git.exec,
    nowForTest: CREATED_AT,
    ...overrides,
  });
  return path.join(container, 'repo-totem-claude-demo');
}

// ─── create ─────────────────────────────────────────────

describe('wt create', () => {
  it('creates <root>/<repo>-<seat>-<slug> on a NEW branch and records it', async () => {
    const git = fakeGit();
    const target = await createOne(git);

    expect(fs.existsSync(target)).toBe(true);
    const add = callsMatching(git, 'worktree', 'add');
    expect(add).toHaveLength(1);
    // Always `-b`: an existing branch is a hard error in v1 (the ruling).
    expect(add[0]).toContain('-b');
    expect(add[0]).toContain('wt/demo');

    const file = readWorktreeRegistry();
    const entry = file.worktrees[target];
    expect(entry).toMatchObject({
      repo,
      seat: 'totem-claude',
      branch: 'wt/demo',
      createdAt: CREATED_AT,
    });
    expect(file.roots).toEqual([path.resolve(container)]);
  });

  it('names the branch feat/<ticket>-<slug> when a ticket is given', async () => {
    const git = fakeGit();
    await createOne(git, { ticket: '2580' });
    expect(
      readWorktreeRegistry().worktrees[path.join(container, 'repo-totem-claude-demo')],
    ).toMatchObject({ branch: 'feat/2580-demo', ticket: '2580' });
  });

  it('honours an explicit --branch over both defaults', async () => {
    const git = fakeGit();
    await createOne(git, { ticket: '2580', branch: 'chore/custom' });
    expect(callsMatching(git, 'worktree', 'add')[0]).toContain('chore/custom');
  });

  it('resolves the root by precedence: --root > TOTEM_WORKTREE_ROOT > default', async () => {
    const envRoot = path.join(root, 'env-root');
    const git = fakeGit();

    // --root wins over the env var.
    await createOne(git, { envForTest: { TOTEM_WORKTREE_ROOT: envRoot } });
    expect(fs.existsSync(path.join(container, 'repo-totem-claude-demo'))).toBe(true);

    // With no --root, the env var is used.
    await wtCreateCommand({
      slug: 'envy',
      seat: 'totem-claude',
      cwdForTest: repo,
      envForTest: { TOTEM_WORKTREE_ROOT: envRoot },
      execForTest: git.exec,
      nowForTest: CREATED_AT,
    });
    expect(fs.existsSync(path.join(envRoot, 'repo-totem-claude-envy'))).toBe(true);

    // With neither, the default is ~/.totem/worktrees (HOME is the temp home).
    await wtCreateCommand({
      slug: 'defaulted',
      seat: 'totem-claude',
      cwdForTest: repo,
      envForTest: {},
      execForTest: git.exec,
      nowForTest: CREATED_AT,
    });
    expect(
      fs.existsSync(path.join(home, '.totem', 'worktrees', 'repo-totem-claude-defaulted')),
    ).toBe(true);
  });

  it('emits a --json artifact naming the root source', async () => {
    const git = fakeGit();
    const raw = await captureStdout(() => createOne(git, { json: true, ticket: '2580' }));
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      action: 'create',
      seat: 'totem-claude',
      branch: 'feat/2580-demo',
      ticket: '2580',
      'root-source': '--root',
      'created-at': CREATED_AT,
    });
  });

  it('refuses a target directory that already exists', async () => {
    const git = fakeGit();
    fs.mkdirSync(path.join(container, 'repo-totem-claude-demo'), { recursive: true });
    await expect(createOne(git)).rejects.toThrow(/already exists/);
    // Nothing recorded, nothing invoked.
    expect(readWorktreeRegistry().worktrees).toEqual({});
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
  });

  it('rejects a slug that is not a single path segment', async () => {
    const git = fakeGit();
    for (const slug of ['../escape', 'a/b', '.hidden', '']) {
      await expect(createOne(git, { slug })).rejects.toThrow(/invalid slug/);
    }
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
  });

  it('rejects branch names git check-ref-format would bounce AFTER the record', async () => {
    const git = fakeGit();
    for (const branch of ['wt/demo.', 'wt/demo.lock', 'wt/../demo']) {
      await expect(createOne(git, { branch })).rejects.toThrow(/invalid branch name/);
    }
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
    expect(readWorktreeRegistry().worktrees).toEqual({});
  });

  it('refuses to run from inside a linked worktree (primary checkout only)', async () => {
    const git = fakeGit({ commonDir: path.join(root, 'elsewhere', '.git') });
    await expect(createOne(git)).rejects.toThrow(/primary checkout/);
    // Refused BEFORE anything landed: no record, no git mutation.
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
    expect(readWorktreeRegistry().worktrees).toEqual({});
  });

  it('rewords a failed seat resolution to --seat, never the mail verb’s --from', async () => {
    const git = fakeGit();
    // Two orchestration seats and no TOTEM_SELF_AGENT: the resolver's
    // ambiguity arm — the default outcome on a real multi-seat repo.
    fs.mkdirSync(path.join(repo, '.totem', 'orchestration', 'totem-claude'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.totem', 'orchestration', 'totem-codex'), { recursive: true });

    let message = '';
    try {
      await wtCreateCommand({
        slug: 'demo',
        root: container,
        cwdForTest: repo,
        envForTest: {},
        execForTest: git.exec,
        nowForTest: CREATED_AT,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('--seat');
    expect(message).not.toContain('--from');
    // Seat resolution precedes the record-first write: nothing recorded.
    expect(readWorktreeRegistry().worktrees).toEqual({});
  });
});

// ─── Invariant 6 ────────────────────────────────────────

describe('invariant 6: the entry is written BEFORE git runs, and rolls back', () => {
  it('has the entry already recorded at the instant `worktree add` is invoked', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    expect(git.registryAtAdd).toBeDefined();
    // Record-first: a phantom entry fails visibly, an unrecorded worktree does not.
    expect(Object.keys(git.registryAtAdd!.worktrees)).toContain(target);
    expect(git.registryAtAdd!.roots).toEqual([path.resolve(container)]);
  });

  it('rolls the entry back when `git worktree add` fails', async () => {
    const git = fakeGit({ add: 'throw' });
    await expect(createOne(git)).rejects.toThrow(/git worktree add failed/);

    const file = readWorktreeRegistry();
    expect(file.worktrees).toEqual({});
    // The ROOT stays recorded even though the create failed — roots accrete.
    expect(file.roots).toEqual([path.resolve(container)]);
  });

  it('KEEPS the entry when git failed but left a partial directory', async () => {
    const git = fakeGit({ add: 'throw-after-create' });
    await expect(createOne(git)).rejects.toThrow(/registry entry is RETAINED/);

    // Rolling back here would convert a visible phantom into the invisible
    // unrecorded-worktree class — the record must outlive the partial dir.
    const target = path.join(container, 'repo-totem-claude-demo');
    expect(fs.existsSync(target)).toBe(true);
    expect(Object.keys(readWorktreeRegistry().worktrees)).toContain(target);
    expect(output()).not.toContain('PHANTOM ENTRY');
  });

  it('names the phantom entry loudly when the rollback itself fails', async () => {
    const git = fakeGit({ add: 'throw' });
    // Make the registry unreadable AFTER the record-first write, so the
    // rollback's read-modify-write is what fails.
    const originalAdd = git.exec;
    const exec = ((command: string, args: string[] = [], opts?: unknown): string => {
      const cwdIdx = args.indexOf('-C');
      if (args[cwdIdx + 2] === 'worktree' && args[cwdIdx + 3] === 'add') {
        fs.writeFileSync(worktreeRegistryPath(), '{ corrupt', 'utf-8');
      }
      return (originalAdd as (c: string, a?: string[], o?: unknown) => string)(command, args, opts);
    }) as WtExecFn;

    await expect(createOne(git, { execForTest: exec })).rejects.toThrow(/NOT rolled back/);
    expect(output()).toContain('PHANTOM ENTRY');
  });
});

// ─── Invariant 10 ───────────────────────────────────────

describe('invariant 10: the root is never the repo, under the repo, or the workspace root itself', () => {
  const workspace = (): string => path.dirname(repo);

  it('refuses --root pointing at the repo itself', async () => {
    const git = fakeGit();
    await expect(createOne(git, { root: repo })).rejects.toThrow(/inside the repo itself/);
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
  });

  it('refuses --root UNDER the repo — containment, not just equality', async () => {
    const git = fakeGit();
    // `<repo>/.claude/worktrees` is the known in-repo worktree location shape;
    // an equality-only guard would wave it through (falsification finding 3).
    await expect(createOne(git, { root: path.join(repo, '.claude', 'worktrees') })).rejects.toThrow(
      /inside the repo itself/,
    );
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
    expect(readWorktreeRegistry().worktrees).toEqual({});
    // A SIBLING whose name merely extends the repo's is NOT under it.
    await createOne(git, { root: `${repo}-ville` });
    expect(fs.existsSync(path.join(`${repo}-ville`, 'repo-totem-claude-demo'))).toBe(true);
  });

  it('refuses --root pointing at the workspace root', async () => {
    const git = fakeGit();
    await expect(createOne(git, { root: workspace() })).rejects.toThrow(/workspace root/);
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
  });

  it('refuses the same locations via TOTEM_WORKTREE_ROOT', async () => {
    const git = fakeGit();
    await expect(
      wtCreateCommand({
        slug: 'demo',
        seat: 'totem-claude',
        cwdForTest: repo,
        envForTest: { TOTEM_WORKTREE_ROOT: workspace() },
        execForTest: git.exec,
        nowForTest: CREATED_AT,
      }),
    ).rejects.toThrow(/workspace root/);
    expect(callsMatching(git, 'worktree', 'add')).toHaveLength(0);
    expect(readWorktreeRegistry().worktrees).toEqual({});
  });

  it('refuses under every other flag combination too', async () => {
    const git = fakeGit();
    await expect(
      createOne(git, { root: repo, ticket: '2580', branch: 'feat/x', seat: 'other-seat' }),
    ).rejects.toThrow(/inside the repo itself/);
    // Case-folded on win32: a shouted spelling is the same directory there.
    const shouted = IS_WIN32 ? repo.toUpperCase() : repo;
    await expect(createOne(git, { root: shouted })).rejects.toThrow(
      IS_WIN32 ? /inside the repo itself/ : /inside the repo itself/,
    );
  });
});

// ─── remove: check-first (invariant 4) ──────────────────

describe('invariant 4: check-first — only a git-listed path reaches `worktree remove`', () => {
  it('routes a git-listed worktree through `git worktree remove --force`', async () => {
    const git = fakeGit();
    const target = await createOne(git);

    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });

    const removes = callsMatching(git, 'worktree', 'remove');
    expect(removes).toHaveLength(1);
    expect(removes[0]).toContain('--force');
    expect(fs.existsSync(target)).toBe(false);
    expect(callsMatching(git, 'worktree', 'prune')).toHaveLength(1);
  });

  it('never invokes `worktree remove` for a path git does not list, and still verifies absence', async () => {
    // Registry-known but git-unlisted: the estate's deregistered-husk shape.
    const git = fakeGit();
    const target = await createOne(git);
    const unlisted = fakeGit({ listed: [] });

    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: unlisted.exec });

    expect(callsMatching(unlisted, 'worktree', 'remove')).toHaveLength(0);
    expect(fs.existsSync(target)).toBe(false);
    expect(readWorktreeRegistry().worktrees).toEqual({});
  });

  it('refuses a path in NEITHER git’s list nor the registry, touching nothing', async () => {
    const stranger = path.join(root, 'not-a-worktree');
    fs.mkdirSync(stranger, { recursive: true });
    const git = fakeGit();

    await expect(
      wtRemoveCommand({ target: stranger, cwdForTest: repo, execForTest: git.exec }),
    ).rejects.toThrow(/in neither git/);

    expect(fs.existsSync(stranger)).toBe(true);
    expect(callsMatching(git, 'worktree', 'remove')).toHaveLength(0);
  });

  it('fails loud rather than fail-open when the worktree list cannot be read', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    const broken = fakeGit({ listThrows: true });

    await expect(
      wtRemoveCommand({ target, cwdForTest: repo, execForTest: broken.exec }),
    ).rejects.toThrow(/cannot enumerate worktrees/);
    expect(fs.existsSync(target)).toBe(true);
    expect(callsMatching(broken, 'worktree', 'remove')).toHaveLength(0);
  });

  it('recovers idempotently when the home repo is gone and nothing is on disk', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    const broken = fakeGit({ listThrows: true });

    // The ruled recovery (verified-absent + entry present ⇒ delete entry) must
    // not be blocked by an unanswerable list when there is nothing to strand.
    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: broken.exec });

    expect(readWorktreeRegistry().worktrees).toEqual({});
    expect(output()).toContain('already-gone');
    expect(output()).toContain('could not enumerate worktrees');
    expect(callsMatching(broken, 'worktree', 'remove')).toHaveLength(0);
  });
});

// ─── remove: invariants 1 + 2 ───────────────────────────

describe('invariants 1 + 2: exit 0 requires verified absence; the entry survives failure', () => {
  it('finishes the residue when git exits 0 but leaves the directory standing', async () => {
    const git = fakeGit({ remove: 'husk' });
    const target = await createOne(git);

    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });

    // The fail-open git exit code did NOT decide the outcome — the finish did.
    expect(fs.existsSync(target)).toBe(false);
    expect(readWorktreeRegistry().worktrees).toEqual({});
    expect(output()).toContain('residue-removed');
  });

  it('throws (never exits 0) and RETAINS the entry when the directory survives', async () => {
    const git = fakeGit({ remove: 'husk' });
    const target = await createOne(git);
    const stubbornResidue = async (dir: string): Promise<ResidueRemovalResult> =>
      Promise.resolve({
        removed: false,
        strippedLinks: [],
        survivors: [dir, path.join(dir, 'file.txt')],
        lastError: 'EBUSY: resource busy or locked',
        attempts: 3,
      });

    // The failure names the survivors AND renders the finish's last error —
    // the manual-cleanup hint is only actionable with both.
    await expect(
      wtRemoveCommand({
        target,
        cwdForTest: repo,
        execForTest: git.exec,
        residueForTest: stubbornResidue,
      }),
    ).rejects.toThrow(/still exists after the residue finish[\s\S]*EBUSY: resource busy or locked/);

    // Invariant 2: every removal failure retains the entry, so the husk stays
    // visible in `wt list` instead of becoming untracked residue.
    expect(Object.keys(readWorktreeRegistry().worktrees)).toContain(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('names the survivors in the failure so the manual cleanup is possible', async () => {
    const git = fakeGit({ remove: 'husk' });
    const target = await createOne(git);
    await expect(
      wtRemoveCommand({
        target,
        cwdForTest: repo,
        execForTest: git.exec,
        residueForTest: async (dir) =>
          Promise.resolve({
            removed: false,
            strippedLinks: [],
            survivors: [path.join(dir, 'node_modules')],
            attempts: 1,
          }),
      }),
    ).rejects.toThrow(/node_modules/);
  });

  it('throws even when the residue finish LIES about removal', async () => {
    const git = fakeGit({ remove: 'husk' });
    const target = await createOne(git);

    // A reporter claiming success while the directory stands must not buy
    // exit 0 — the re-probe disjunct, not the report, is the authority.
    await expect(
      wtRemoveCommand({
        target,
        cwdForTest: repo,
        execForTest: git.exec,
        residueForTest: async () =>
          Promise.resolve({ removed: true, strippedLinks: [], survivors: [], attempts: 1 }),
      }),
    ).rejects.toThrow(/still exists after the residue finish/);

    expect(fs.existsSync(target)).toBe(true);
    expect(Object.keys(readWorktreeRegistry().worktrees)).toContain(target);
  });

  it('retains the entry when `git worktree remove` itself fails', async () => {
    const git = fakeGit({ remove: 'throw' });
    const target = await createOne(git);
    await expect(
      wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec }),
    ).rejects.toThrow(/git worktree remove failed/);
    expect(Object.keys(readWorktreeRegistry().worktrees)).toContain(target);
  });
});

// ─── remove: already-gone + resolution ──────────────────

describe('wt remove resolution', () => {
  it('treats a recorded path that is already off disk as already-gone', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    // Simulate the husk having been hand-deleted, with git still listing it.
    fs.rmSync(target, { recursive: true, force: true });
    const unlisted = fakeGit({ listed: [] });

    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: unlisted.exec });

    expect(readWorktreeRegistry().worktrees).toEqual({});
    expect(output()).toContain('already-gone');
    expect(callsMatching(unlisted, 'worktree', 'remove')).toHaveLength(0);
  });

  it('resolves a bare basename against the registry', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    await wtRemoveCommand({
      target: 'repo-totem-claude-demo',
      cwdForTest: repo,
      execForTest: git.exec,
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses an AMBIGUOUS basename, listing the candidates', async () => {
    const git = fakeGit();
    const other = path.join(root, 'container-2');
    fs.mkdirSync(other, { recursive: true });
    await createOne(git);
    await createOne(git, { root: other });

    await expect(
      wtRemoveCommand({
        target: 'repo-totem-claude-demo',
        cwdForTest: repo,
        execForTest: git.exec,
      }),
    ).rejects.toThrow(/matches 2 recorded worktrees/);
    // Nothing removed while the ambiguity stands.
    expect(fs.existsSync(path.join(container, 'repo-totem-claude-demo'))).toBe(true);
    expect(fs.existsSync(path.join(other, 'repo-totem-claude-demo'))).toBe(true);
  });

  it('refuses the residue delete for a recorded entry OUTSIDE every recorded root', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    // Hand-edit the registry: an entry pointing outside all recorded roots is
    // exactly the shape that would turn a corrupted worktrees.json into an
    // arbitrary-recursive-delete primitive (falsification finding 14).
    const stray = path.join(root, 'stray-location', 'repo-totem-claude-demo');
    fs.mkdirSync(stray, { recursive: true });
    const raw = JSON.parse(fs.readFileSync(worktreeRegistryPath(), 'utf-8')) as {
      worktrees: Record<string, unknown>;
    };
    raw.worktrees[stray] = raw.worktrees[target]!;
    fs.writeFileSync(worktreeRegistryPath(), JSON.stringify(raw, null, 2), 'utf-8');
    const unlisted = fakeGit({ listed: [] });

    await expect(
      wtRemoveCommand({ target: stray, cwdForTest: repo, execForTest: unlisted.exec }),
    ).rejects.toThrow(/none of the recorded roots/);

    expect(fs.existsSync(stray)).toBe(true);
    expect(callsMatching(unlisted, 'worktree', 'remove')).toHaveLength(0);
  });

  it('accepts a git-listed worktree with NO registry entry (legacy estate)', async () => {
    const legacy = path.join(container, 'legacy-worktree');
    fs.mkdirSync(legacy, { recursive: true });
    const git = fakeGit({ listed: [legacy] });

    await wtRemoveCommand({ target: legacy, cwdForTest: repo, execForTest: git.exec });

    expect(fs.existsSync(legacy)).toBe(false);
    // Registry deletion simply no-ops — it was never recorded.
    expect(output()).toContain('not recorded');
  });

  it('emits a --json artifact for the removal outcome', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    const raw = await captureStdout(() =>
      wtRemoveCommand({ target, json: true, cwdForTest: repo, execForTest: git.exec }),
    );
    expect(JSON.parse(raw)).toMatchObject({
      action: 'remove',
      outcome: 'git-removed',
      'git-listed': true,
      'verified-absent': true,
      'registry-entry-deleted': true,
    });
  });
});

// ─── Invariant 5 ────────────────────────────────────────

describe('invariant 5: untracked ECL content blocks removal', () => {
  it('refuses when `status --porcelain --ignored` reports ANY row', async () => {
    const git = fakeGit({ statusRows: ['?? .totem/orchestration/totem-claude/outbox/x.md'] });
    const target = await createOne(git);

    await expect(
      wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec }),
    ).rejects.toThrow(/refusing/);

    expect(fs.existsSync(target)).toBe(true);
    expect(callsMatching(git, 'worktree', 'remove')).toHaveLength(0);
    expect(Object.keys(readWorktreeRegistry().worktrees)).toContain(target);
  });

  it('blocks on an IGNORED file too — an ignored dispatch is still ECL', async () => {
    const git = fakeGit({ statusRows: ['!! .totem/orchestration/totem-claude/journal/j.md'] });
    const target = await createOne(git);
    await expect(
      wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec }),
    ).rejects.toThrow(/journal/);
  });

  it('does NOT block when the orchestration content is tracked and clean', async () => {
    const git = fakeGit({ statusRows: [] });
    const target = await createOne(git);
    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });
    expect(fs.existsSync(target)).toBe(false);
  });

  it('runs the probe with the ruled pathspec, -uall included', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });
    const status = callsMatching(git, 'status');
    expect(status).toHaveLength(1);
    expect(status[0]).toEqual(
      expect.arrayContaining([
        'status',
        '--porcelain',
        '--ignored',
        '-uall',
        '--',
        '.totem/orchestration',
      ]),
    );
    // `-uall` is load-bearing on its own: without it a shared
    // `status.showUntrackedFiles=no` silences the probe (finding 2).
    expect(status[0]).toContain('-uall');
  });

  it('refuses when the probe cannot run AND orchestration content is on disk', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    fs.mkdirSync(path.join(target, '.totem', 'orchestration'), { recursive: true });
    const blind = fakeGit({ listed: [target], statusThrows: true });

    await expect(
      wtRemoveCommand({ target, cwdForTest: repo, execForTest: blind.exec }),
    ).rejects.toThrow(/ECL probe could not run/);
    expect(fs.existsSync(target)).toBe(true);
  });

  it('proceeds with a disclosed note when the probe cannot run and nothing is there', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    const blind = fakeGit({ listed: [target], statusThrows: true });

    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: blind.exec });

    expect(fs.existsSync(target)).toBe(false);
    expect(output()).toContain('ECL probe could not run');
  });
});

// ─── Invariant 5 against REAL git (finding 2) ───────────

describe('ECL probe against real git', () => {
  it('names the exact untracked file and defeats status.showUntrackedFiles=no', async () => {
    const realRepo = path.join(root, 'real-repo');
    fs.mkdirSync(realRepo, { recursive: true });
    const run = (cmd: string): void => {
      execSync(cmd, { cwd: realRepo, stdio: 'ignore' });
    };
    run('git init');
    run('git config user.email "wt-test@totem.invalid"');
    run('git config user.name "wt-test"');
    fs.writeFileSync(path.join(realRepo, 'a.txt'), 'seed', 'utf-8');
    run('git add a.txt');
    run('git commit -m seed');
    // The bypass shape (finding 2, arm a): the HOME repo's config is shared
    // by every linked worktree, and `showUntrackedFiles=no` silences a
    // default `git status` completely — only `-uall` still answers.
    run('git config status.showUntrackedFiles no');

    const wt = path.join(root, 'real-wt');
    const added = spawnSync('git', ['worktree', 'add', '-b', 'wt/real', wt], {
      cwd: realRepo,
      stdio: 'ignore',
    });
    expect(added.status).toBe(0);

    const dispatch = path.join(wt, '.totem', 'orchestration', 'totem-claude', 'outbox');
    fs.mkdirSync(dispatch, { recursive: true });
    fs.writeFileSync(path.join(dispatch, 'dispatch.md'), 'ecl content', 'utf-8');

    // Real safeExec, real git. The refusal must name the FILE — not one
    // collapsed `?? .totem/orchestration/` row (finding 2, arm b) — and must
    // fire despite the config bypass. Nothing may be deleted.
    let message = '';
    try {
      await wtRemoveCommand({ target: wt, cwdForTest: realRepo });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('refusing');
    expect(message).toContain('dispatch.md');
    expect(fs.existsSync(path.join(dispatch, 'dispatch.md'))).toBe(true);
  }, 30_000);
});

// ─── Invariant 9 ────────────────────────────────────────

describe('invariant 9: path comparisons case-fold on win32 only', () => {
  it('matches a shouted path to its recorded entry on win32, and not on POSIX', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    const shouted = target.toUpperCase();

    if (IS_WIN32) {
      await wtRemoveCommand({ target: shouted, cwdForTest: repo, execForTest: git.exec });
      expect(fs.existsSync(target)).toBe(false);
      expect(readWorktreeRegistry().worktrees).toEqual({});
    } else {
      // POSIX filesystems are case-sensitive: the shouted path is a DIFFERENT
      // path, recorded nowhere, and must be refused rather than deleted.
      await expect(
        wtRemoveCommand({ target: shouted, cwdForTest: repo, execForTest: git.exec }),
      ).rejects.toThrow(/in neither git/);
      expect(fs.existsSync(target)).toBe(true);
    }
  });
});

// ─── Invariant 7 ────────────────────────────────────────

describe('invariant 7: no wt verb ever writes registry.json', () => {
  it('leaves the sync registry byte-identical across create, list, and remove', async () => {
    const registryFile = path.join(home, '.totem', 'registry.json');
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    const original = JSON.stringify(
      {
        [repo]: { path: repo, chunkCount: 7, lastSync: '2026-08-01T00:00:00.000Z', embedder: 'x' },
      },
      null,
      2,
    );
    fs.writeFileSync(registryFile, original, 'utf-8');

    const git = fakeGit();
    const target = await createOne(git);
    await wtListCommand({ nowForTest: NOW });
    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });

    expect(fs.readFileSync(registryFile, 'utf-8')).toBe(original);
    // And the two files really are separate on disk.
    expect(fs.existsSync(worktreeRegistryPath())).toBe(true);
    expect(worktreeRegistryPath()).not.toBe(registryFile);
  });
});

// ─── list ───────────────────────────────────────────────

describe('wt list', () => {
  it('reports recorded entries with disk presence and age, never a classification', async () => {
    const git = fakeGit();
    const present = await createOne(git);
    await createOne(git, { slug: 'ghost' });
    fs.rmSync(path.join(container, 'repo-totem-claude-ghost'), { recursive: true, force: true });

    await wtListCommand({ nowForTest: NOW });

    const text = output();
    expect(text).toContain(present);
    expect(text).toContain('present');
    expect(text).toContain('missing');
    expect(text).toContain('2d old');
    // Classification is the sensor's charge, and the hint says where. No ROW
    // may carry a class — only the hint line is allowed to say the words.
    expect(text).toContain('totem doctor --estate');
    const rows = lines.filter((line) => line.includes(container));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toMatch(/\b(stale|active|indeterminate)\b/);
    }
  });

  it('emits a --json listing with age-days and presence', async () => {
    const git = fakeGit();
    await createOne(git, { ticket: '2580' });
    const raw = await captureStdout(() => wtListCommand({ nowForTest: NOW, json: true }));
    const artifact = JSON.parse(raw) as {
      'registry-status': string;
      roots: string[];
      worktrees: Record<string, unknown>[];
    };
    expect(artifact['registry-status']).toBe('ok');
    expect(artifact.roots).toEqual([path.resolve(container)]);
    expect(artifact.worktrees).toHaveLength(1);
    expect(artifact.worktrees[0]).toMatchObject({
      seat: 'totem-claude',
      branch: 'feat/2580-demo',
      ticket: '2580',
      'age-days': 2,
      present: true,
    });
  });

  it('warns LOUDLY and lists nothing when worktrees.json cannot be read', async () => {
    fs.mkdirSync(path.dirname(worktreeRegistryPath()), { recursive: true });
    fs.writeFileSync(worktreeRegistryPath(), '{ not json', 'utf-8');

    await wtListCommand({ nowForTest: NOW });

    expect(output()).toContain('Cannot read worktree registry');
    expect(output()).toContain('could not be read');
  });

  it('says so plainly when nothing has been recorded yet', async () => {
    await wtListCommand({ nowForTest: NOW });
    expect(output()).toContain('no worktrees recorded');
  });
});

// ─── Invariant 8 (registry half) ────────────────────────

describe('invariant 8: recorded roots survive entry removal', () => {
  it('keeps the container root recorded after the last entry under it is gone', async () => {
    const git = fakeGit();
    const target = await createOne(git);
    await wtRemoveCommand({ target, cwdForTest: repo, execForTest: git.exec });

    const file = readWorktreeRegistry();
    expect(file.worktrees).toEqual({});
    // The `%TEMP%\claude`-class reachability fix: zero live entries, root still
    // recorded, so `doctor --estate` still sweeps the location.
    expect(file.roots).toEqual([path.resolve(container)]);
  });
});

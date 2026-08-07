/**
 * Worktree-registry tests (mmnto-ai/totem#2580 slice-2).
 *
 * The file is resolved through `os.homedir()`, so every test pins
 * HOME/USERPROFILE at a temp directory — the same fixture shape the
 * `readRegistry` tests in doctor.test.ts use. Nothing here mocks the
 * filesystem: the contract being pinned is what actually lands on disk
 * (atomic write, lock, accreting roots) and a mocked fs would assert the mock.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addWorktreeEntry,
  deleteWorktreeEntry,
  existingWorktreeRoots,
  findWorktreeEntry,
  readWorktreeRegistry,
  WORKTREE_REGISTRY_SCHEMA_VERSION,
  type WorktreeEntry,
  WorktreeFileSchema,
  worktreePathExists,
  worktreeRegistryPath,
} from './worktree-registry.js';

const IS_WIN32 = process.platform === 'win32';

let home: string;
let prevHome: string | undefined;
let prevProfile: string | undefined;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-wtreg-')));
  prevHome = process.env['HOME'];
  prevProfile = process.env['USERPROFILE'];
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevProfile;
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function entryFor(overrides: Partial<WorktreeEntry> = {}): WorktreeEntry {
  return {
    repo: path.join(home, 'repo'),
    seat: 'totem-claude',
    branch: 'wt/demo',
    createdAt: '2026-08-07T10:00:00.000Z',
    ...overrides,
  };
}

function writeRaw(contents: string): void {
  fs.mkdirSync(path.join(home, '.totem'), { recursive: true });
  fs.writeFileSync(worktreeRegistryPath(), contents, 'utf-8');
}

// ─── Read path ──────────────────────────────────────────

describe('readWorktreeRegistry', () => {
  it('returns an empty registry when the file has never been written', () => {
    const warnings: string[] = [];
    const file = readWorktreeRegistry((msg) => warnings.push(msg));
    expect(file).toEqual({
      schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
      roots: [],
      worktrees: {},
    });
    // First run is not a degradation — it must not warn.
    expect(warnings).toEqual([]);
  });

  // The `readRegistry` posture: a corrupt file warns LOUDLY and degrades to
  // empty, so a read-only verb still runs and the operator still learns.
  it('warns and degrades to empty on an unparseable file', () => {
    writeRaw('{ not json');
    const warnings: string[] = [];
    const file = readWorktreeRegistry((msg) => warnings.push(msg));
    expect(file.worktrees).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Cannot read worktree registry');
  });

  it('warns on a schema-invalid file rather than trusting the shape', () => {
    writeRaw(JSON.stringify({ schemaVersion: 2, roots: [], worktrees: {} }));
    const warnings: string[] = [];
    readWorktreeRegistry((msg) => warnings.push(msg));
    expect(warnings).toHaveLength(1);
  });

  it('preserves unknown entry fields written by a newer CLI (passthrough)', async () => {
    const target = path.join(home, 'container', 'repo-seat-slug');
    await addWorktreeEntry({
      worktreePath: target,
      entry: { ...entryFor(), futureField: 'kept' } as WorktreeEntry,
      root: path.join(home, 'container'),
    });
    const file = readWorktreeRegistry();
    const found = findWorktreeEntry(file, target);
    expect(found?.entry['futureField']).toBe('kept');
  });
});

// ─── Mutation path ──────────────────────────────────────

describe('addWorktreeEntry', () => {
  it('creates the file with the entry and its root', async () => {
    const root = path.join(home, 'container');
    const target = path.join(root, 'repo-totem-claude-demo');
    await addWorktreeEntry({ worktreePath: target, entry: entryFor(), root });

    const file = readWorktreeRegistry();
    expect(file.schemaVersion).toBe(WORKTREE_REGISTRY_SCHEMA_VERSION);
    expect(file.roots).toEqual([path.resolve(root)]);
    expect(findWorktreeEntry(file, target)?.entry.branch).toBe('wt/demo');
    // The written bytes must satisfy the schema — a reader on another version
    // parses the same file.
    const raw: unknown = JSON.parse(fs.readFileSync(worktreeRegistryPath(), 'utf-8'));
    expect(() => WorktreeFileSchema.parse(raw)).not.toThrow();
  });

  it('accretes roots, deduped case-folded on win32 ONLY', async () => {
    const root = path.join(home, 'container');
    await addWorktreeEntry({
      worktreePath: path.join(root, 'a'),
      entry: entryFor(),
      root,
    });
    await addWorktreeEntry({
      worktreePath: path.join(root, 'b'),
      entry: entryFor(),
      root: root.toUpperCase(),
    });
    const file = readWorktreeRegistry();
    // Invariant 9: win32 folds (one root), POSIX does not (two distinct paths).
    expect(file.roots).toHaveLength(IS_WIN32 ? 1 : 2);
    // The FIRST spelling wins on win32, so the disclosure stays stable.
    expect(file.roots[0]).toBe(path.resolve(root));
  });

  it('refuses to overwrite a file whose schema does not parse', async () => {
    writeRaw(JSON.stringify({ schemaVersion: 99, roots: 'not-an-array' }));
    await expect(
      addWorktreeEntry({
        worktreePath: path.join(home, 'x'),
        entry: entryFor(),
        root: home,
      }),
    ).rejects.toThrow(/refusing to overwrite/);
    // The bytes are untouched — a mutation that cannot read cannot destroy.
    expect(fs.readFileSync(worktreeRegistryPath(), 'utf-8')).toContain('not-an-array');
  });
});

describe('deleteWorktreeEntry', () => {
  it('deletes the entry and RETAINS the root (invariant 8, registry half)', async () => {
    const root = path.join(home, 'container');
    const target = path.join(root, 'repo-totem-claude-demo');
    await addWorktreeEntry({ worktreePath: target, entry: entryFor(), root });

    expect(await deleteWorktreeEntry(target)).toBe(true);
    const file = readWorktreeRegistry();
    expect(file.worktrees).toEqual({});
    // The whole point: a container root outlives every entry under it, so the
    // location stays reachable for the estate sweep with zero live entries.
    expect(file.roots).toEqual([path.resolve(root)]);
  });

  it('is a no-op (false, not an error) for a path with no entry', async () => {
    const root = path.join(home, 'container');
    await addWorktreeEntry({
      worktreePath: path.join(root, 'kept'),
      entry: entryFor(),
      root,
    });
    expect(await deleteWorktreeEntry(path.join(root, 'legacy-worktree'))).toBe(false);
    expect(Object.keys(readWorktreeRegistry().worktrees)).toHaveLength(1);
  });

  it('is a no-op when the file does not exist at all', async () => {
    expect(await deleteWorktreeEntry(path.join(home, 'anything'))).toBe(false);
  });
});

// ─── Path identity (invariant 9) ────────────────────────

describe('findWorktreeEntry', () => {
  it('folds case on win32 only', async () => {
    const root = path.join(home, 'container');
    const target = path.join(root, 'repo-totem-claude-demo');
    await addWorktreeEntry({ worktreePath: target, entry: entryFor(), root });
    const file = readWorktreeRegistry();

    expect(findWorktreeEntry(file, target)).toBeDefined();
    const shouted = findWorktreeEntry(file, target.toUpperCase());
    if (IS_WIN32) expect(shouted).toBeDefined();
    else expect(shouted).toBeUndefined();
  });
});

// ─── Root projection for the doctor coupling ────────────

describe('existingWorktreeRoots', () => {
  it('keeps roots that exist and drops the ones that do not', () => {
    const present = path.join(home, 'present');
    fs.mkdirSync(present, { recursive: true });
    const gone = path.join(home, 'gone');
    const roots = existingWorktreeRoots({
      schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
      // Duplicated deliberately — the sweep must receive each root once.
      roots: [present, present, gone],
      worktrees: {},
    });
    expect(roots).toEqual([path.resolve(present)]);
  });

  it('drops a recorded root that is a FILE, never sweeping it as a directory', () => {
    const file = path.join(home, 'not-a-dir');
    fs.writeFileSync(file, 'x', 'utf-8');
    expect(
      existingWorktreeRoots({
        schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
        roots: [file],
        worktrees: {},
      }),
    ).toEqual([]);
  });
});

describe('worktreePathExists', () => {
  it('is no-follow: a dangling link still reports as PRESENT', () => {
    const target = path.join(home, 'target');
    fs.mkdirSync(target, { recursive: true });
    const link = path.join(home, 'link');
    fs.symlinkSync(target, link, IS_WIN32 ? 'junction' : 'dir');
    fs.rmSync(target, { recursive: true, force: true });
    // `existsSync` follows and would answer false here; the removal verb must
    // not read a dangling junction as "already gone".
    expect(worktreePathExists(link)).toBe(true);
    expect(worktreePathExists(path.join(home, 'never-existed'))).toBe(false);
  });
});

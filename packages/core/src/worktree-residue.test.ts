/**
 * Residue-deletion tests (mmnto-ai/totem#2580 slice-2).
 *
 * Invariant 3 is the reason this module exists as its own file, and it is
 * asserted with a REAL link fixture rather than a mock: a junction inside a
 * fake worktree pointing at a directory OUTSIDE it, whose sentinel file must
 * survive the worktree's deletion. On win32 the link is created as a
 * `'junction'`, which needs no elevation — a `'dir'` symlink would require
 * Developer Mode and turn the invariant into a test that silently skips.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  removeWorktreeResidue,
  residuePathExists,
  stripReparsePoints,
} from './worktree-residue.js';

const IS_WIN32 = process.platform === 'win32';
/** win32: `'junction'` needs no elevation. POSIX: an ordinary dir symlink. */
const DIR_LINK: 'junction' | 'dir' = IS_WIN32 ? 'junction' : 'dir';

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-residue-')));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

/** An outside directory holding a sentinel that must survive every deletion. */
function outsideWithSentinel(name = 'outside'): { dir: string; sentinel: string } {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const sentinel = path.join(dir, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'must survive', 'utf-8');
  return { dir, sentinel };
}

// ─── Invariant 3 ────────────────────────────────────────

describe('invariant 3: residue deletion never follows a link out of the tree', () => {
  it('deletes a junction/symlink inside the worktree and leaves its TARGET intact', async () => {
    const { dir: outside, sentinel } = outsideWithSentinel();
    const wt = path.join(root, 'repo-seat-slug');
    fs.mkdirSync(path.join(wt, 'node_modules', '.pnpm'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'file.txt'), 'inside', 'utf-8');
    const link = path.join(wt, 'node_modules', 'linked-package');
    fs.symlinkSync(outside, link, DIR_LINK);
    // Sanity: the fixture really is a link, or the invariant asserts nothing.
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);

    const result = await removeWorktreeResidue({ dir: wt });

    expect(result.removed).toBe(true);
    expect(result.survivors).toEqual([]);
    expect(result.strippedLinks.map((p) => path.resolve(p))).toContain(path.resolve(link));
    expect(residuePathExists(wt)).toBe(false);
    // The whole point: the link went, the target and its contents did not.
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('must survive');
  });

  it('unlinks a worktree path that is ITSELF a link, without walking into it', () => {
    const { dir: outside, sentinel } = outsideWithSentinel('outside-whole');
    const wt = path.join(root, 'linked-worktree');
    fs.symlinkSync(outside, wt, DIR_LINK);

    const stripped = stripReparsePoints(wt);

    expect(stripped.map((p) => path.resolve(p))).toEqual([path.resolve(wt)]);
    expect(residuePathExists(wt)).toBe(false);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('must survive');
  });

  it('strips nested links at every depth', async () => {
    const { dir: outside, sentinel } = outsideWithSentinel('outside-deep');
    const wt = path.join(root, 'deep-worktree');
    const deep = path.join(wt, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    fs.symlinkSync(outside, path.join(wt, 'top-link'), DIR_LINK);
    fs.symlinkSync(outside, path.join(deep, 'deep-link'), DIR_LINK);

    const result = await removeWorktreeResidue({ dir: wt });

    expect(result.strippedLinks).toHaveLength(2);
    expect(result.removed).toBe(true);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('must survive');
  });

  // A dangling link is the shape `existsSync` gets wrong: it follows, sees
  // nothing, and reports absent. The finish must still remove it.
  it('removes a DANGLING link and reports the directory gone', async () => {
    const wt = path.join(root, 'dangling-worktree');
    fs.mkdirSync(wt, { recursive: true });
    const target = path.join(root, 'transient');
    fs.mkdirSync(target, { recursive: true });
    const link = path.join(wt, 'gone-link');
    fs.symlinkSync(target, link, DIR_LINK);
    fs.rmSync(target, { recursive: true, force: true });

    const result = await removeWorktreeResidue({ dir: wt });
    expect(result.removed).toBe(true);
    expect(residuePathExists(wt)).toBe(false);
  });
});

// ─── Ordinary outcomes ──────────────────────────────────

describe('removeWorktreeResidue', () => {
  it('reports removed for a path that is already gone, in one attempt', async () => {
    const result = await removeWorktreeResidue({ dir: path.join(root, 'never-existed') });
    expect(result.removed).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.strippedLinks).toEqual([]);
  });

  it('deletes an ordinary residue tree', async () => {
    const wt = path.join(root, 'plain');
    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'src', 'a.ts'), 'x', 'utf-8');
    const result = await removeWorktreeResidue({ dir: wt });
    expect(result.removed).toBe(true);
    expect(residuePathExists(wt)).toBe(false);
  });

  // The survivor report is what the CLI's hard error names, so it must list
  // the directory itself plus what is inside it. Forced with a zero attempt
  // budget rather than a permission fixture: making `rm` genuinely fail is
  // platform-specific (an open handle on win32, a chmod'd parent on POSIX that
  // does nothing when the suite runs as root), and a test that only sometimes
  // reaches the arm it names asserts nothing. The arm reached here is the same
  // one a real EBUSY reaches — "attempts exhausted, directory still present".
  it('reports survivors and removed:false when the delete budget is exhausted', async () => {
    const wt = path.join(root, 'survivor');
    fs.mkdirSync(path.join(wt, 'src'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'src', 'a.ts'), 'x', 'utf-8');

    const result = await removeWorktreeResidue({ dir: wt, attempts: 0 });

    expect(result.removed).toBe(false);
    expect(result.survivors[0]).toBe(path.resolve(wt));
    expect(result.survivors.map((p) => path.basename(p))).toContain('a.ts');
    expect(residuePathExists(wt)).toBe(true);
  });

  it('honours the injected attempt budget', async () => {
    const wt = path.join(root, 'budget');
    fs.mkdirSync(wt, { recursive: true });
    const result = await removeWorktreeResidue({ dir: wt, attempts: 1, retryDelayMs: 1 });
    expect(result.attempts).toBe(1);
    expect(result.removed).toBe(true);
  });
});

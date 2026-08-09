import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFileAtomicSync } from './fs-atomic.js';
import { cleanTmpDir } from './test-utils.js';

// Failure-injection + observation seams for the fs calls the helper makes.
// vi.spyOn cannot redefine ESM namespace exports on node builtins, so the
// module is mocked with an `...actual` passthrough (the eject.test.ts
// pattern) driven by this control object: real fs behavior everywhere a test
// doesn't arm a failure, so the byte-exact assertions stay real-fs.
const control: {
  failRenameOnce?: Error;
  failFsyncOnce?: Error;
  openedPaths: string[];
} = { openedPaths: [] };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const openSync = ((p: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) => {
    control.openedPaths.push(String(p));
    return actual.openSync(p, flags, mode);
  }) as typeof actual.openSync;
  const renameSync = ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
    if (control.failRenameOnce) {
      const err = control.failRenameOnce;
      control.failRenameOnce = undefined;
      throw err;
    }
    return actual.renameSync(oldPath, newPath);
  }) as typeof actual.renameSync;
  const fsyncSync = ((fd: number) => {
    if (control.failFsyncOnce) {
      const err = control.failFsyncOnce;
      control.failFsyncOnce = undefined;
      throw err;
    }
    return actual.fsyncSync(fd);
  }) as typeof actual.fsyncSync;
  const mocked = { ...actual, openSync, renameSync, fsyncSync };
  return { ...mocked, default: mocked };
});

/**
 * Windows can create file symlinks only with elevation or Developer Mode, so
 * the symlink-contract tests probe capability instead of assuming platform.
 */
function canSymlink(dir: string): boolean {
  const probeTarget = path.join(dir, 'probe-target');
  const probeLink = path.join(dir, 'probe-link');
  try {
    fs.writeFileSync(probeTarget, 'probe');
    fs.symlinkSync(probeTarget, probeLink);
    return true;
    // totem-context: capability probe — an EPERM here only means "skip the
    // symlink tests on this host", never a swallowed product failure.
  } catch {
    return false;
  } finally {
    fs.rmSync(probeLink, { force: true });
    fs.rmSync(probeTarget, { force: true });
  }
}

describe('writeFileAtomicSync', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-atomic-'));
    control.openedPaths = [];
    control.failRenameOnce = undefined;
    control.failFsyncOnce = undefined;
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  const tmpResidue = (): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

  it('writes string content to the target and leaves no temp residue', () => {
    const target = path.join(dir, 'out.txt');
    writeFileAtomicSync(target, 'hello\n');
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello\n');
    expect(tmpResidue()).toEqual([]);
  });

  it('writes Buffer content byte-exactly', () => {
    const target = path.join(dir, 'out.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80]);
    writeFileAtomicSync(target, bytes);
    expect(fs.readFileSync(target)).toEqual(bytes);
  });

  it('old-or-new: a rename failure leaves the prior bytes intact and no temp residue', () => {
    const target = path.join(dir, 'state.json');
    fs.writeFileSync(target, 'OLD BYTES');
    control.failRenameOnce = Object.assign(new Error('EPERM: injected'), { code: 'EPERM' });

    expect(() => writeFileAtomicSync(target, 'NEW BYTES')).toThrow('EPERM: injected');
    expect(fs.readFileSync(target, 'utf-8')).toBe('OLD BYTES');
    expect(tmpResidue()).toEqual([]);
  });

  it('old-or-new: a temp-write failure leaves the prior bytes intact and no temp residue', () => {
    const target = path.join(dir, 'state.json');
    fs.writeFileSync(target, 'OLD BYTES');
    // Fail INSIDE the temp write (post-open — the truncate-then-write window
    // the corollary's rule 1 names for the plain writeFileSync it replaces).
    control.failFsyncOnce = Object.assign(new Error('EIO: injected'), { code: 'EIO' });

    expect(() => writeFileAtomicSync(target, 'NEW BYTES')).toThrow('EIO: injected');
    expect(fs.readFileSync(target, 'utf-8')).toBe('OLD BYTES');
    expect(tmpResidue()).toEqual([]);
  });

  it('uses a unique same-directory temp path per invocation', () => {
    const target = path.join(dir, 'out.txt');
    writeFileAtomicSync(target, 'one');
    writeFileAtomicSync(target, 'two');

    const tempPaths = control.openedPaths.filter((p) => p.endsWith('.tmp'));
    expect(tempPaths).toHaveLength(2);
    expect(tempPaths[0]).not.toBe(tempPaths[1]);
    for (const p of tempPaths) {
      expect(path.dirname(p)).toBe(dir);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'preserves an existing target mode (0755 stays 0755 through the temp)',
    () => {
      const target = path.join(dir, 'hook');
      fs.writeFileSync(target, '#!/bin/sh\nold\n');
      fs.chmodSync(target, 0o755);

      writeFileAtomicSync(target, '#!/bin/sh\nnew\n');
      expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'explicit opts.mode wins for a new target (recovery artifact carries source mode)',
    () => {
      const target = path.join(dir, 'hook.totem-bak');
      writeFileAtomicSync(target, '#!/bin/sh\nsaved\n', { mode: 0o755 });
      expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'exact bits land under a restrictive umask (chmod is not umask-masked — round 2, F10)',
    () => {
      const prevUmask = process.umask(0o077);
      try {
        const target = path.join(dir, 'hook-umask');
        writeFileAtomicSync(target, '#!/bin/sh\n', { mode: 0o755 });
        expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
      } finally {
        process.umask(prevUmask);
      }
    },
  );

  it('symlink target: link identity survives, content lands through the real path', (ctx) => {
    // A silent `return` here would report PASSED with zero assertions on
    // symlink-incapable hosts (2026-08-09 falsification round 1, finding 8) —
    // skip loudly.
    if (!canSymlink(dir)) ctx.skip();
    const real = path.join(dir, 'real.md');
    const link = path.join(dir, 'link.md');
    fs.writeFileSync(real, 'old');
    fs.symlinkSync(real, link);

    writeFileAtomicSync(link, 'new');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf-8')).toBe('new');
    expect(fs.readFileSync(link, 'utf-8')).toBe('new');
  });

  it('dangling symlink target: throws loud, the link is untouched', (ctx) => {
    if (!canSymlink(dir)) ctx.skip();
    const link = path.join(dir, 'dangling.md');
    fs.symlinkSync(path.join(dir, 'nowhere.md'), link);

    expect(() => writeFileAtomicSync(link, 'new')).toThrow(/ENOENT|ELOOP/);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'nowhere.md'))).toBe(false);
    expect(tmpResidue()).toEqual([]);
  });
});

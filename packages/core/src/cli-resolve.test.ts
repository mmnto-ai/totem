import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliResolveFs } from './cli-resolve.js';
import { resolveGlobalEntry, resolveLocalEntry, resolveTotemCli } from './cli-resolve.js';

function writeWorkspaceTier(root: string, name = '@mmnto/cli'): string {
  fs.mkdirSync(path.join(root, 'packages', 'cli', 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'packages', 'cli', 'package.json'),
    `{"name":"${name}","version":"9.9.9"}`,
  );
  const entry = path.join(root, 'packages', 'cli', 'dist', 'index.js');
  fs.writeFileSync(entry, '');
  return entry;
}

function writePinnedTier(root: string): string {
  const pkgDir = path.join(root, 'node_modules', '@mmnto', 'cli');
  fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@mmnto/cli","version":"8.8.8"}');
  const entry = path.join(pkgDir, 'dist', 'index.js');
  fs.writeFileSync(entry, '');
  return entry;
}

/**
 * An in-memory filesystem seam: `files` maps a path to its text, `links` maps
 * a link path to its realpath target. A link counts as existing. `dirs` exist
 * and are not files; `unreadable` paths exist as files whose read throws.
 */
function fakeFs(
  files: Record<string, string>,
  links: Record<string, string> = {},
  extra: { dirs?: string[]; unreadable?: string[] } = {},
): CliResolveFs {
  const dirs = new Set(extra.dirs ?? []);
  const unreadable = new Set(extra.unreadable ?? []);
  return {
    exists: (p) => p in files || p in links || dirs.has(p) || unreadable.has(p),
    isFile: (p) => p in files || p in links || unreadable.has(p),
    readText: (p) => {
      if (unreadable.has(p)) throw new Error(`EACCES: permission denied, open ${p}`);
      const text = files[p];
      if (text === undefined) throw new Error(`ENOENT: ${p}`);
      return text;
    },
    realpath: (p) => {
      const target = links[p];
      if (target === undefined) throw new Error(`EINVAL: not a link: ${p}`);
      return target;
    },
  };
}

const CLI_PKG = '{"name":"@mmnto/cli","version":"7.7.7"}';
const OTHER_PKG = '{"name":"totem","version":"5.2.0"}';
const FORK_PKG = '{"name":"@acme/cli","version":"2.13.0-acme.1"}';
const NESTED_PKG = '{"name":"someone-else","config":{"name":"@mmnto/cli"},"version":"1.0.0"}';

describe('resolveLocalEntry (moved from the CLI re-exec; mmnto-ai/totem#3008)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-cli-resolve-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('workspace tier: resolves the workspace build, identity-guarded on the package name', () => {
    const entry = writeWorkspaceTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)).toEqual({ entry, version: '9.9.9', tier: 'workspace' });
  });

  it('workspace guard: a packages/cli/package.json naming another package does not match', () => {
    writeWorkspaceTier(tmpRoot, 'someone-elses-cli');
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('workspace tier requires the built entry — package.json alone is not enough', () => {
    writeWorkspaceTier(tmpRoot);
    fs.rmSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'));
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('pinned tier: resolves the pinned @mmnto/cli entry', () => {
    const entry = writePinnedTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)).toEqual({ entry, version: '8.8.8', tier: 'pinned' });
  });

  it('a node_modules/totem/ directory does not match', () => {
    const foreign = path.join(tmpRoot, 'node_modules', 'totem');
    fs.mkdirSync(path.join(foreign, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(foreign, 'package.json'), OTHER_PKG);
    fs.writeFileSync(path.join(foreign, 'dist', 'index.js'), '');
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('the workspace tier beats the pinned tier when both are present', () => {
    const workspaceEntry = writeWorkspaceTier(tmpRoot);
    writePinnedTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)?.entry).toBe(workspaceEntry);
  });

  it('walks up from a nested directory', () => {
    const entry = writePinnedTier(tmpRoot);
    const nested = path.join(tmpRoot, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveLocalEntry(nested)?.entry).toBe(entry);
  });

  it('no local install anywhere → undefined', () => {
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('a read failure mid-walk throws; the caller decides the posture', () => {
    // packages/cli/package.json as a DIRECTORY: exists passes, the read throws EISDIR.
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'), '');
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'package.json'));
    expect(() => resolveLocalEntry(tmpRoot)).toThrow();
  });
});

describe('resolveGlobalEntry (mmnto-ai/totem#3008)', () => {
  const binA = path.join(path.sep, 'bin-a');
  const binB = path.join(path.sep, 'bin-b');
  const pathEnv = [binA, binB].join(path.delimiter);

  it('win32 npm layout: the totem shim beside <dir>/node_modules/@mmnto/cli/dist/index.js', () => {
    const pkgDir = path.join(binB, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs({
      [path.join(binB, 'totem.cmd')]: '',
      [entry]: '',
      [path.join(pkgDir, 'package.json')]: CLI_PKG,
    });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '7.7.7', tier: 'global' },
      unverified: [],
    });
  });

  it('POSIX npm layout: <dir>/totem realpaths to <pkg>/dist/index.js and <pkg>/package.json names @mmnto/cli', () => {
    const pkgDir = path.join(path.sep, 'lib', 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs(
      { [entry]: '', [path.join(pkgDir, 'package.json')]: CLI_PKG },
      { [path.join(binA, 'totem')]: entry },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '7.7.7', tier: 'global' },
      unverified: [],
    });
  });

  it('a global whose package.json names another package is not a hit', () => {
    const pkgDir = path.join(path.sep, 'lib', 'node_modules', 'totem');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const shim = path.join(binA, 'totem');
    const fsx = fakeFs(
      { [entry]: '', [path.join(pkgDir, 'package.json')]: OTHER_PKG },
      { [shim]: entry },
    );
    const probe = resolveGlobalEntry(pathEnv, fsx);
    expect(probe.hit).toBeUndefined();
    expect(probe.unverified).toEqual([shim]);
  });

  it('a directory holding node_modules/@mmnto/cli but no totem shim is not a global install', () => {
    const pkgDir = path.join(binA, 'node_modules', '@mmnto', 'cli');
    const fsx = fakeFs({
      [path.join(pkgDir, 'dist', 'index.js')]: '',
      [path.join(pkgDir, 'package.json')]: CLI_PKG,
    });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [] });
  });

  it('a fork installed globally under the alias is a hit by its path, and its own name is reported', () => {
    const pkgDir = path.join(binA, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs({
      [path.join(binA, 'totem.cmd')]: '',
      [entry]: '',
      [path.join(pkgDir, 'package.json')]: FORK_PKG,
    });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '2.13.0-acme.1', tier: 'global', aliasOf: '@acme/cli' },
      unverified: [],
    });
  });

  it('POSIX: a link that resolves outside node_modules is a hit when the manifest names @mmnto/cli (a linked install)', () => {
    const pkgDir = path.join(path.sep, 'src', 'totem', 'packages', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs(
      { [entry]: '', [path.join(pkgDir, 'package.json')]: CLI_PKG },
      { [path.join(binA, 'totem')]: entry },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '7.7.7', tier: 'global' },
      unverified: [],
    });
  });

  it('POSIX: a manifest that carries @mmnto/cli only as a nested name is not a hit', () => {
    const pkgDir = path.join(path.sep, 'opt', 'someone-else');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const shim = path.join(binA, 'totem');
    const fsx = fakeFs(
      { [entry]: '', [path.join(pkgDir, 'package.json')]: NESTED_PKG },
      { [shim]: entry },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [shim] });
  });

  it('a totem.cmd on PATH with no npm layout lands in unverified', () => {
    const cmd = path.join(binA, 'totem.cmd');
    const fsx = fakeFs({ [cmd]: '@echo off' });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [cmd] });
  });

  it('a totem link that cannot be resolved is not a hit, and nothing throws', () => {
    const shim = path.join(binA, 'totem');
    const fsx = fakeFs({ [shim]: '#!/bin/sh' });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [shim] });
  });

  it('the first hit wins and keeps what was found unverified before it', () => {
    const cmd = path.join(binA, 'totem.cmd');
    const pkgDir = path.join(binB, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs({
      [cmd]: '',
      [path.join(binB, 'totem.cmd')]: '',
      [entry]: '',
      [path.join(pkgDir, 'package.json')]: CLI_PKG,
    });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '7.7.7', tier: 'global' },
      unverified: [cmd],
    });
  });

  it('an unreadable package.json never stops the scan: a shimless directory is skipped and a valid install later on PATH is found', () => {
    const badDir = path.join(binA, 'node_modules', '@mmnto', 'cli');
    const badPkg = path.join(badDir, 'package.json');
    const goodDir = path.join(binB, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(goodDir, 'dist', 'index.js');
    const fsx = fakeFs(
      {
        [path.join(badDir, 'dist', 'index.js')]: '',
        [path.join(binB, 'totem.cmd')]: '',
        [entry]: '',
        [path.join(goodDir, 'package.json')]: CLI_PKG,
      },
      {},
      { unreadable: [badPkg] },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: '7.7.7', tier: 'global' },
      unverified: [],
    });
  });

  it('an unreadable package.json behind a POSIX link: the path still identifies the install, the version is unknown, nothing throws', () => {
    const pkgDir = path.join(path.sep, 'lib', 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const shim = path.join(binA, 'totem');
    const fsx = fakeFs(
      { [entry]: '' },
      { [shim]: entry },
      { unreadable: [path.join(pkgDir, 'package.json')] },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({
      hit: { entry, version: undefined, tier: 'global' },
      unverified: [],
    });
  });

  it('an unreadable package.json behind a POSIX link that resolves outside node_modules is not a hit', () => {
    const pkgDir = path.join(path.sep, 'opt', 'unknown');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const shim = path.join(binA, 'totem');
    const fsx = fakeFs(
      { [entry]: '' },
      { [shim]: entry },
      { unreadable: [path.join(pkgDir, 'package.json')] },
    );
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [shim] });
  });

  it('a directory named totem is not reported as an executable', () => {
    const fsx = fakeFs({}, {}, { dirs: [path.join(binA, 'totem')] });
    expect(resolveGlobalEntry(pathEnv, fsx)).toEqual({ unverified: [] });
  });

  it('an undefined or empty PATH finds nothing', () => {
    expect(resolveGlobalEntry(undefined, fakeFs({}))).toEqual({ unverified: [] });
    expect(resolveGlobalEntry('', fakeFs({}))).toEqual({ unverified: [] });
  });
});

describe('resolveTotemCli (mmnto-ai/totem#3008)', () => {
  // Resolved, because the local walk resolves its start (a drive letter on win32).
  const start = path.resolve(path.sep, 'proj');

  it('prefers a local entry over a global one', () => {
    const local = path.join(start, 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
    const bin = path.join(path.sep, 'bin');
    const globalDir = path.join(bin, 'node_modules', '@mmnto', 'cli');
    const fsx = fakeFs({
      [local]: '',
      [path.join(globalDir, 'dist', 'index.js')]: '',
      [path.join(globalDir, 'package.json')]: CLI_PKG,
    });
    expect(resolveTotemCli(start, { pathEnv: bin, fs: fsx })).toEqual({
      ok: true,
      entry: local,
      version: undefined,
      tier: 'pinned',
    });
  });

  it('falls through to an npm-layout global when nothing local resolves', () => {
    const bin = path.join(path.sep, 'bin');
    const globalDir = path.join(bin, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(globalDir, 'dist', 'index.js');
    const fsx = fakeFs({
      [path.join(bin, 'totem.cmd')]: '',
      [entry]: '',
      [path.join(globalDir, 'package.json')]: CLI_PKG,
    });
    expect(resolveTotemCli(start, { pathEnv: bin, fs: fsx })).toEqual({
      ok: true,
      entry,
      version: '7.7.7',
      tier: 'global',
    });
  });

  it('a pinned fork installed under the alias resolves by its path, and its own name is reported', () => {
    const pkgDir = path.join(start, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(pkgDir, 'dist', 'index.js');
    const fsx = fakeFs({ [entry]: '', [path.join(pkgDir, 'package.json')]: FORK_PKG });
    expect(resolveTotemCli(start, { pathEnv: '', fs: fsx })).toEqual({
      ok: true,
      entry,
      version: '2.13.0-acme.1',
      tier: 'pinned',
      aliasOf: '@acme/cli',
    });
  });

  it('a global hit carries the unverified totem that was skipped before it on PATH', () => {
    const shims = path.join(path.sep, 'shims');
    const bin = path.join(path.sep, 'bin');
    const cmd = path.join(shims, 'totem.cmd');
    const globalDir = path.join(bin, 'node_modules', '@mmnto', 'cli');
    const entry = path.join(globalDir, 'dist', 'index.js');
    const fsx = fakeFs({
      [cmd]: '',
      [path.join(bin, 'totem.cmd')]: '',
      [entry]: '',
      [path.join(globalDir, 'package.json')]: CLI_PKG,
    });
    const pathEnv = [shims, bin].join(path.delimiter);
    expect(resolveTotemCli(start, { pathEnv, fs: fsx })).toEqual({
      ok: true,
      entry,
      version: '7.7.7',
      tier: 'global',
      unverified: [cmd],
    });
  });

  it('returns the three places looked when nothing resolves', () => {
    const bin = path.join(path.sep, 'bin');
    const cmd = path.join(bin, 'totem.cmd');
    const result = resolveTotemCli(start, { pathEnv: bin, fs: fakeFs({ [cmd]: '' }) });
    expect(result).toEqual({
      ok: false,
      looked: [
        `a workspace build at packages/cli/dist/index.js, walking up from ${start}`,
        `a pinned install at node_modules/@mmnto/cli/dist/index.js, walking up from ${start}`,
        'an npm-layout global install of @mmnto/cli on PATH',
      ],
      unverified: [cmd],
    });
  });
});

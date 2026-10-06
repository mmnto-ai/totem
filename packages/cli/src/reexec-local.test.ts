import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FreshnessFs } from './reexec-local.js';
import { maybeReexecLocal, resolveLocalEntry } from './reexec-local.js';
import { cleanTmpDir } from './test-utils.js';

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

// The resolveLocalEntry tier tests moved with the function to core
// (packages/core/src/cli-resolve.test.ts, mmnto-ai/totem#3008); the
// delegation tests below exercise it through this module's re-export.

describe('maybeReexecLocal', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reexec-run-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('TOTEM_NO_REEXEC=1 disables delegation entirely', () => {
    writePinnedTier(tmpRoot);
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: { TOTEM_NO_REEXEC: '1' },
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('already running the local entry → no delegation (identity short-circuit)', () => {
    const entry = writePinnedTier(tmpRoot);
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: entry,
      spawn,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('foreign binary + local install present → delegates with loop guard and returns child status', () => {
    const entry = writePinnedTier(tmpRoot);
    const spawn = vi.fn().mockReturnValue({ status: 3 });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint', '--branch'],
      env: { PATH: 'x' },
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBe(3);
    const [cmd, args, opts] = spawn.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([entry, 'lint', '--branch']);
    expect((opts as { env: Record<string, string> }).env['TOTEM_NO_REEXEC']).toBe('1');
    expect((opts as { stdio: string }).stdio).toBe('inherit');
  });

  it('no local install → runs in place (undefined), no spawn', () => {
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('a probe I/O error falls through to running in place (#2153 round-1)', () => {
    // packages/cli/package.json as a DIRECTORY: existsSync passes, readFileSync
    // throws EISDIR mid-probe — the sandboxed-permissions class.
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'), '');
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'package.json'));
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: [],
      env: {},
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('TOTEM_DEBUG=1 surfaces the probe error instead of swallowing it', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'dist'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'), '');
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'package.json'));
    expect(() =>
      maybeReexecLocal({
        cwd: tmpRoot,
        argv: [],
        env: { TOTEM_DEBUG: '1' },
        selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
        spawn: vi.fn(),
      }),
    ).toThrow();
  });

  it("mirrors cross-spawn's real success shape — error: null must not crash the exit path", () => {
    // Regression: cross-spawn fills `error: null` (not undefined) on success;
    // 1.59.0 crashed every successful delegation here (live, first run).
    writePinnedTier(tmpRoot);
    const spawn = vi.fn().mockReturnValue({ status: 0, signal: null, error: null });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['--version'],
      env: {},
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBe(0);
  });

  it('a spawn-level error is reported on stderr after the announce', () => {
    writePinnedTier(tmpRoot);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const spawn = vi.fn().mockReturnValue({ status: null, error: new Error('boom') });
      const status = maybeReexecLocal({
        cwd: tmpRoot,
        argv: [],
        env: {},
        selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
        spawn,
      });
      expect(status).toBe(1);
      const writes = stderr.mock.calls.map((c) => String(c[0])).join('\n');
      expect(writes).toContain('Delegation failed to start: boom');
    } finally {
      stderr.mockRestore();
    }
  });

  it('a null child status maps to failure, never silent success', () => {
    writePinnedTier(tmpRoot);
    const spawn = vi.fn().mockReturnValue({ status: null });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: [],
      env: {},
      selfPath: path.join(tmpRoot, 'elsewhere', 'index.js'),
      spawn,
    });
    expect(status).toBe(1);
  });
});

// ─── The stale-build sensor (mmnto-ai/totem#2934) ───────────────────────────
// Delegation path only. Mtimes are set explicitly with utimesSync — never
// write order or a sleep.

const BEFORE_BUILD = new Date('2026-01-01T00:00:00.000Z');
const BUILT_AT = new Date('2026-01-02T00:00:00.000Z');
const AFTER_BUILD = new Date('2026-01-03T00:00:00.000Z');

function setMtime(p: string, at: Date): void {
  fs.utimesSync(p, at, at);
}

function writeSource(root: string, pkg: string, rel: string, at: Date): string {
  const file = path.join(root, 'packages', pkg, 'src', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  setMtime(file, at);
  return file;
}

function writeCoreDist(root: string, at: Date): void {
  const entry = path.join(root, 'packages', 'core', 'dist', 'index.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '');
  setMtime(entry, at);
}

/** A workspace tier whose cli dist entry was built at BUILT_AT. */
function writeBuiltWorkspace(root: string): string {
  const entry = writeWorkspaceTier(root);
  setMtime(entry, BUILT_AT);
  return entry;
}

function banner(version: string, entry: string, built?: Date): string {
  const builtLabel = built !== undefined ? ` (built ${built.toISOString()})` : '';
  return `[totem] Delegating to the project-local @mmnto/cli@${version}${builtLabel} at ${entry} (this binary: 1.0.0) — set TOTEM_NO_REEXEC=1 to disable.\n`;
}

/** `root` is the workspace root as the probe resolves it — never the cwd. */
function staleLine(root: string, pkg: string, source: Date, dist: Date): string {
  return `[totem] The project-local build may be stale: a file under packages/${pkg}/src was modified ${source.toISOString()}, after its dist was built ${dist.toISOString()}. If the source changed, run pnpm build --force from the workspace root (${root}); a cached turbo build does not re-stamp dist. Delegating anyway.\n`;
}

/** The real filesystem behind counting spies. */
function countingFs() {
  return {
    exists: vi.fn((p: string) => fs.existsSync(p)),
    stat: vi.fn((p: string) => fs.statSync(p)),
    readdir: vi.fn((p: string) => fs.readdirSync(p, { withFileTypes: true })),
  } satisfies FreshnessFs;
}

const PROBE_FAILURE = 'EACCES: permission denied';

/** Every read throws — the portable "unreadable tree" (chmod is a no-op on Windows). */
function unreadableFs() {
  const deny = (): never => {
    throw new Error(PROBE_FAILURE);
  };
  return {
    exists: vi.fn(deny),
    stat: vi.fn(deny),
    readdir: vi.fn(deny),
  } satisfies FreshnessFs;
}

function seamCalls(seam: ReturnType<typeof countingFs> | ReturnType<typeof unreadableFs>): number {
  return (
    seam.exists.mock.calls.length + seam.stat.mock.calls.length + seam.readdir.mock.calls.length
  );
}

describe('workspace freshness sensor (mmnto-ai/totem#2934)', () => {
  let tmpRoot: string;
  let stderr: MockInstance<typeof process.stderr.write>;
  let foreignSelf: string;

  const writes = (): string[] => stderr.mock.calls.map((c) => String(c[0]));

  /** Delegate from a foreign binary; returns the exit code and the spawn mock. */
  function delegate(extra?: { env?: NodeJS.ProcessEnv; freshnessFs?: FreshnessFs; cwd?: string }) {
    const spawn = vi.fn().mockReturnValue({ status: 7 });
    const status = maybeReexecLocal({
      cwd: extra?.cwd ?? tmpRoot,
      argv: ['lint', '--branch'],
      env: extra?.env ?? { PATH: 'x' },
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
      freshnessFs: extra?.freshnessFs,
    });
    return { status, spawn };
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reexec-fresh-'));
    foreignSelf = path.join(tmpRoot, 'elsewhere', 'index.js');
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    cleanTmpDir(tmpRoot);
  });

  it('resolveLocalEntry keeps its base shape on the workspace tier — no freshness field', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    expect(resolveLocalEntry(tmpRoot)).toEqual({ entry, version: '9.9.9', tier: 'workspace' });
  });

  it('pinned tier: the banner is byte-identical to the pre-sensor string and no freshness read happens', () => {
    const entry = writePinnedTier(tmpRoot);
    // A src tree beside the pinned install, newer than everything: never read.
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const seam = countingFs();
    const { status } = delegate({ env: {}, freshnessFs: seam });
    expect(status).toBe(7);
    expect(writes()).toEqual([
      `[totem] Delegating to the project-local @mmnto/cli@8.8.8 at ${entry} (this binary: 1.0.0) — set TOTEM_NO_REEXEC=1 to disable.\n`,
    ]);
    expect(seamCalls(seam)).toBe(0);
  });

  it('pinned tier under TOTEM_DEBUG=1 with a throwing seam: no throw, zero seam calls', () => {
    const entry = writePinnedTier(tmpRoot);
    const seam = unreadableFs();
    let result: ReturnType<typeof delegate> | undefined;
    expect(() => {
      result = delegate({ env: { TOTEM_DEBUG: '1' }, freshnessFs: seam });
    }).not.toThrow();
    expect(result?.status).toBe(7);
    expect(seamCalls(seam)).toBe(0);
    expect(writes()).toEqual([
      `[totem] Delegating to the project-local @mmnto/cli@8.8.8 at ${entry} (this binary: 1.0.0) — set TOTEM_NO_REEXEC=1 to disable.\n`,
    ]);
  });

  it('workspace tier, fresh: the banner carries the dist entry build instant, no stale line', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    const { status } = delegate();
    expect(status).toBe(7);
    expect(fs.statSync(entry).mtime.toISOString()).toBe(BUILT_AT.toISOString());
    expect(writes()).toEqual([banner('9.9.9', entry, BUILT_AT)]);
  });

  it('a source mtime EQUAL to the dist mtime is fresh — stale means strictly newer', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BUILT_AT);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', BUILT_AT);
    delegate();
    expect(writes()).toEqual([banner('9.9.9', entry, BUILT_AT)]);
  });

  it('workspace tier, cli source newer than cli dist: one stale line, delegation unchanged', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'cli', path.join('commands', 'lint.ts'), AFTER_BUILD);
    const { status, spawn } = delegate();

    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      staleLine(path.resolve(tmpRoot), 'cli', AFTER_BUILD, BUILT_AT),
    ]);
    expect(status).toBe(7);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([entry, 'lint', '--branch']);
    expect(opts).toEqual({ stdio: 'inherit', env: { PATH: 'x', TOTEM_NO_REEXEC: '1' } });
  });

  it('delegating from inside packages/cli: the stale line names the workspace ROOT, not the cwd', () => {
    // From a package directory, `pnpm build --force` hands --force to that
    // package's tsc and fails — the cure must name where it works.
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const packageCwd = path.join(tmpRoot, 'packages', 'cli');
    const { spawn } = delegate({ cwd: packageCwd });
    const root = path.resolve(tmpRoot);
    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      staleLine(root, 'cli', AFTER_BUILD, BUILT_AT),
    ]);
    expect(root).not.toBe(path.resolve(packageCwd));
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('a stale core dist under a fresh cli dist is reported as packages/core/src', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', AFTER_BUILD);
    const { spawn } = delegate();
    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      staleLine(path.resolve(tmpRoot), 'core', AFTER_BUILD, BUILT_AT),
    ]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('a stale cli is reported first when core is stale too', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', AFTER_BUILD);
    delegate();
    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      staleLine(path.resolve(tmpRoot), 'cli', AFTER_BUILD, BUILT_AT),
    ]);
  });

  it('packages/core absent: cli alone is judged, no throw', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    expect(fs.existsSync(path.join(tmpRoot, 'packages', 'core'))).toBe(false);
    expect(() => delegate({ env: { TOTEM_DEBUG: '1' } })).not.toThrow();
    expect(writes()).toEqual([banner('9.9.9', entry, BUILT_AT)]);

    stderr.mockClear();
    writeSource(tmpRoot, 'cli', 'later.ts', AFTER_BUILD);
    delegate();
    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      staleLine(path.resolve(tmpRoot), 'cli', AFTER_BUILD, BUILT_AT),
    ]);
  });

  it('files under a nested node_modules or dist inside src are ignored', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'cli', path.join('node_modules', 'dep', 'index.js'), AFTER_BUILD);
    writeSource(tmpRoot, 'cli', path.join('nested', 'dist', 'out.js'), AFTER_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'core', path.join('dist', 'index.js'), AFTER_BUILD);
    delegate();
    expect(writes()).toEqual([banner('9.9.9', entry, BUILT_AT)]);
  });

  it('already running the workspace dist + stale source: no output, no spawn, no freshness read', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const seam = countingFs();
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: entry,
      selfVersion: '1.0.0',
      spawn,
      freshnessFs: seam,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(seamCalls(seam)).toBe(0);
  });

  it('TOTEM_NO_REEXEC=1: no output at all, even when stale', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const seam = countingFs();
    const spawn = vi.fn();
    for (const selfPath of [foreignSelf, entry]) {
      const status = maybeReexecLocal({
        cwd: tmpRoot,
        argv: ['lint'],
        env: { TOTEM_NO_REEXEC: '1' },
        selfPath,
        spawn,
        freshnessFs: seam,
      });
      expect(status).toBeUndefined();
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(seamCalls(seam)).toBe(0);
  });

  it('a freshness read that throws, without debug: banner without a build instant, no stale line, delegation proceeds', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const { status, spawn } = delegate({ freshnessFs: unreadableFs() });
    expect(status).toBe(7);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([banner('9.9.9', entry)]);
  });

  it('a freshness read that throws under TOTEM_DEBUG=1: one probe-failed line, delegation proceeds, nothing thrown', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    let result: ReturnType<typeof delegate> | undefined;
    expect(() => {
      result = delegate({ env: { TOTEM_DEBUG: '1' }, freshnessFs: unreadableFs() });
    }).not.toThrow();
    expect(result?.status).toBe(7);
    expect(result?.spawn).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([
      `[totem] freshness probe failed: ${PROBE_FAILURE}\n`,
      banner('9.9.9', entry),
    ]);
  });
});

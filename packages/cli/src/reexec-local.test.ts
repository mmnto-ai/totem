import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('resolveLocalEntry (mmnto-ai/totem#2018 L1 — ADR-072 cascade tiers 1+2)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reexec-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('tier 1: resolves the workspace-HEAD build, identity-guarded on the package name', () => {
    const entry = writeWorkspaceTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)?.entry).toBe(entry);
  });

  it('tier 1 guard: a packages/cli that is NOT @mmnto/cli does not match', () => {
    writeWorkspaceTier(tmpRoot, 'someone-elses-cli');
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('tier 1 requires the built entry — package.json alone is not enough', () => {
    writeWorkspaceTier(tmpRoot);
    fs.rmSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'));
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('tier 2: resolves the pinned @mmnto/cli entry', () => {
    const entry = writePinnedTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)?.entry).toBe(entry);
  });

  it('tier 1 beats tier 2 when both are present', () => {
    const workspaceEntry = writeWorkspaceTier(tmpRoot);
    writePinnedTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)?.entry).toBe(workspaceEntry);
  });

  it('walks up from a nested cwd', () => {
    const entry = writePinnedTier(tmpRoot);
    const nested = path.join(tmpRoot, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveLocalEntry(nested)?.entry).toBe(entry);
  });

  it('no local install anywhere → undefined', () => {
    expect(resolveLocalEntry(tmpRoot)).toBeUndefined();
  });

  it('reports the candidate version when readable', () => {
    writePinnedTier(tmpRoot);
    expect(resolveLocalEntry(tmpRoot)?.version).toBe('8.8.8');
  });
});

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
// Mtimes are set explicitly with utimesSync — never write order or a sleep.

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

function delegatedStaleLine(pkg: string, source: Date, dist: Date): string {
  return `[totem] The project-local build is STALE: packages/${pkg}/src changed ${source.toISOString()}, after its dist was built ${dist.toISOString()} — run pnpm build. Delegating anyway.\n`;
}

function directStaleLine(pkg: string, source: Date, dist: Date): string {
  return `[totem] This workspace build is STALE: packages/${pkg}/src changed ${source.toISOString()}, after its dist was built ${dist.toISOString()} — run pnpm build.\n`;
}

describe('workspace freshness sensor (mmnto-ai/totem#2934)', () => {
  let tmpRoot: string;
  let stderr: MockInstance<typeof process.stderr.write>;
  let foreignSelf: string;

  const writes = (): string[] => stderr.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reexec-fresh-'));
    foreignSelf = path.join(tmpRoot, 'elsewhere', 'index.js');
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
    cleanTmpDir(tmpRoot);
  });

  it('pinned tier: the banner is byte-identical to the pre-sensor string, no freshness, no stale line', () => {
    const entry = writePinnedTier(tmpRoot);
    // A src tree beside the pinned install, newer than everything: never read.
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'src', 'x.ts'), '');
    setMtime(path.join(tmpRoot, 'src', 'x.ts'), AFTER_BUILD);
    expect(resolveLocalEntry(tmpRoot)?.freshness).toBeUndefined();

    const spawn = vi.fn().mockReturnValue({ status: 0 });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
    });
    expect(status).toBe(0);
    expect(writes()).toEqual([
      `[totem] Delegating to the project-local @mmnto/cli@8.8.8 at ${entry} (this binary: 1.0.0) — set TOTEM_NO_REEXEC=1 to disable.\n`,
    ]);
  });

  it('workspace tier, fresh: the banner carries the dist entry build instant, no stale line', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
    });
    expect(fs.statSync(entry).mtime.toISOString()).toBe(BUILT_AT.toISOString());
    expect(writes()).toEqual([banner('9.9.9', entry, BUILT_AT)]);
    expect(resolveLocalEntry(tmpRoot)?.freshness).toEqual({ builtAt: BUILT_AT.toISOString() });
  });

  it('workspace tier, cli source newer than cli dist: one stale line, delegation unchanged', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'cli', path.join('commands', 'lint.ts'), AFTER_BUILD);
    const spawn = vi.fn().mockReturnValue({ status: 7 });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint', '--branch'],
      env: { PATH: 'x' },
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
    });

    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      delegatedStaleLine('cli', AFTER_BUILD, BUILT_AT),
    ]);

    expect(status).toBe(7);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawn.mock.calls[0]!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([entry, 'lint', '--branch']);
    expect(opts).toEqual({ stdio: 'inherit', env: { PATH: 'x', TOTEM_NO_REEXEC: '1' } });
  });

  it('a stale core dist under a fresh cli dist is reported as packages/core/src', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', AFTER_BUILD);
    const spawn = vi.fn().mockReturnValue({ status: 0 });
    maybeReexecLocal({
      cwd: tmpRoot,
      argv: [],
      env: {},
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
    });
    expect(writes()).toEqual([
      banner('9.9.9', entry, BUILT_AT),
      delegatedStaleLine('core', AFTER_BUILD, BUILT_AT),
    ]);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('a stale cli is reported first when core is stale too', () => {
    writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', AFTER_BUILD);
    expect(resolveLocalEntry(tmpRoot)?.freshness?.stale?.package).toBe('cli');
  });

  it('packages/core absent: cli alone is judged, no throw', () => {
    writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    expect(fs.existsSync(path.join(tmpRoot, 'packages', 'core'))).toBe(false);
    expect(() => resolveLocalEntry(tmpRoot, { debug: true })).not.toThrow();
    expect(resolveLocalEntry(tmpRoot)?.freshness).toEqual({ builtAt: BUILT_AT.toISOString() });

    writeSource(tmpRoot, 'cli', 'later.ts', AFTER_BUILD);
    expect(resolveLocalEntry(tmpRoot)?.freshness?.stale).toEqual({
      package: 'cli',
      sourceNewestAt: AFTER_BUILD.toISOString(),
      distBuiltAt: BUILT_AT.toISOString(),
    });
  });

  it('files under a nested node_modules or dist inside src are ignored', () => {
    writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'cli', path.join('node_modules', 'dep', 'index.js'), AFTER_BUILD);
    writeSource(tmpRoot, 'cli', path.join('nested', 'dist', 'out.js'), AFTER_BUILD);
    writeCoreDist(tmpRoot, BUILT_AT);
    writeSource(tmpRoot, 'core', 'index.ts', BEFORE_BUILD);
    writeSource(tmpRoot, 'core', path.join('dist', 'index.js'), AFTER_BUILD);
    expect(resolveLocalEntry(tmpRoot)?.freshness).toEqual({ builtAt: BUILT_AT.toISOString() });
  });

  it('already running the workspace dist + stale: one "This workspace build" line, runs in place', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const spawn = vi.fn();
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: entry,
      selfVersion: '1.0.0',
      spawn,
    });
    expect(status).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(writes()).toEqual([directStaleLine('cli', AFTER_BUILD, BUILT_AT)]);
  });

  it('already running the workspace dist + fresh: no output', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', BEFORE_BUILD);
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
    expect(writes()).toEqual([]);
  });

  it('TOTEM_NO_REEXEC=1: no output at all, even when stale', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const spawn = vi.fn();
    for (const selfPath of [foreignSelf, entry]) {
      const status = maybeReexecLocal({
        cwd: tmpRoot,
        argv: ['lint'],
        env: { TOTEM_NO_REEXEC: '1' },
        selfPath,
        spawn,
      });
      expect(status).toBeUndefined();
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('a freshness read that throws: banner without a build instant, no stale line, delegation proceeds', () => {
    const entry = writeBuiltWorkspace(tmpRoot);
    writeSource(tmpRoot, 'cli', 'index.ts', AFTER_BUILD);
    const unreadable = {
      stat: (): never => {
        throw new Error('EACCES: permission denied');
      },
      readdir: (): never => {
        throw new Error('EACCES: permission denied');
      },
    };
    expect(resolveLocalEntry(tmpRoot, { freshnessFs: unreadable })).toEqual({
      entry,
      version: '9.9.9',
      tier: 'workspace',
    });

    const spawn = vi.fn().mockReturnValue({ status: 5 });
    const status = maybeReexecLocal({
      cwd: tmpRoot,
      argv: ['lint'],
      env: {},
      selfPath: foreignSelf,
      selfVersion: '1.0.0',
      spawn,
      freshnessFs: unreadable,
    });
    expect(status).toBe(5);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([banner('9.9.9', entry)]);

    expect(() =>
      maybeReexecLocal({
        cwd: tmpRoot,
        argv: ['lint'],
        env: { TOTEM_DEBUG: '1' },
        selfPath: foreignSelf,
        spawn: vi.fn(),
        freshnessFs: unreadable,
      }),
    ).toThrow('EACCES: permission denied');
  });
});

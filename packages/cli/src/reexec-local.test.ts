import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { maybeReexecLocal, resolveLocalEntry } from './reexec-local.js';

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

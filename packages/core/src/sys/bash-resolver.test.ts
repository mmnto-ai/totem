/**
 * Tests for `resolveBash` (mmnto-ai/totem#2159).
 *
 * Fully mocked at the three seams (`node:os` platform, `node:fs` existsSync,
 * `./exec.js` safeExec) so every resolution branch — POSIX fast-path,
 * exec-path derivation, conventional fallback, hard failure — is exercised
 * deterministically on any host. The module memo is reset per test via the
 * exported testing hook.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemError } from '../errors.js';
import { _clearBashResolverCacheForTesting, bashSpawnEnv, resolveBash } from './bash-resolver.js';
import { safeExec } from './exec.js';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: vi.fn(actual.platform) };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});
vi.mock('./exec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exec.js')>();
  return { ...actual, safeExec: vi.fn(actual.safeExec) };
});

const GIT_ROOT = path.resolve('D:/Git');
const USR_BASH = path.join(GIT_ROOT, 'usr', 'bin', 'bash.exe');
const BIN_BASH = path.join(GIT_ROOT, 'bin', 'bash.exe');
const CONVENTIONAL_USR_BASH = path.join('C:\\Program Files\\Git', 'usr', 'bin', 'bash.exe');

beforeEach(() => {
  _clearBashResolverCacheForTesting();
  vi.mocked(os.platform).mockReset();
  vi.mocked(fs.existsSync).mockReset();
  vi.mocked(safeExec).mockReset();
});

describe('resolveBash — POSIX fast-path', () => {
  it("returns 'bash' on non-win32 without spawning any subprocess", () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    expect(resolveBash()).toBe('bash');
    expect(resolveBash()).toBe('bash');
    expect(safeExec).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });
});

describe('resolveBash — exec-path derivation (win32)', () => {
  it('derives Git root from `git --exec-path` and prefers usr/bin/bash.exe over bin/bash.exe', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    // Forward slashes on purpose — Git on Windows emits mixed separators;
    // path.resolve must normalize before probing.
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === USR_BASH);

    const resolved = resolveBash();
    expect(resolved).toBe(USR_BASH);
    expect(resolved).not.toBe('bash');
    // usr/bin probed before bin (the real MSYS bash before the wrapper).
    expect(vi.mocked(fs.existsSync).mock.calls[0]?.[0]).toBe(USR_BASH);
  });

  it('falls back to bin/bash.exe when usr/bin is absent under the derived root', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === BIN_BASH);
    expect(resolveBash()).toBe(BIN_BASH);
  });

  it('memoizes: `git --exec-path` is invoked at most once per process', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === USR_BASH);
    expect(resolveBash()).toBe(USR_BASH);
    expect(resolveBash()).toBe(USR_BASH);
    expect(resolveBash()).toBe(USR_BASH);
    expect(safeExec).toHaveBeenCalledTimes(1);
  });
});

describe('resolveBash — conventional fallback (win32)', () => {
  it('probes the conventional install root when git itself is unavailable', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });
    vi.mocked(fs.existsSync).mockImplementation((p) => p === CONVENTIONAL_USR_BASH);
    expect(resolveBash()).toBe(CONVENTIONAL_USR_BASH);
  });

  it('probes the conventional root when the derived root holds no bash', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === CONVENTIONAL_USR_BASH);
    expect(resolveBash()).toBe(CONVENTIONAL_USR_BASH);
  });
});

describe('resolveBash — hard failure (win32, the no-bare-bash contract)', () => {
  it('throws BASH_RESOLUTION_FAILED naming every probed path — never the literal bash', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockReturnValue(false);

    let thrown: unknown;
    try {
      resolveBash();
      // totem-context: test asserts the throw below; reaching here is the failure.
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TotemError);
    const totemErr = thrown as TotemError;
    expect(totemErr.code).toBe('BASH_RESOLUTION_FAILED');
    // Every probed path is named: both derived-root candidates and both
    // conventional-root candidates (actionable per Tenet 4).
    expect(totemErr.message).toContain(USR_BASH);
    expect(totemErr.message).toContain(BIN_BASH);
    expect(totemErr.message).toContain(CONVENTIONAL_USR_BASH);
    expect(totemErr.recoveryHint).toContain('Git for Windows');
  });

  it('does not memoize a failure: a later successful probe resolves', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(() => resolveBash()).toThrowError(TotemError);

    vi.mocked(fs.existsSync).mockImplementation((p) => p === CONVENTIONAL_USR_BASH);
    expect(resolveBash()).toBe(CONVENTIONAL_USR_BASH);
  });
});

describe('bashSpawnEnv — child PATH for the spawned bash (#2159 second layer)', () => {
  it('returns base unchanged on POSIX', () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    const base = { PATH: '/usr/bin:/bin', HOME: '/home/x' };
    expect(bashSpawnEnv(base)).toBe(base);
  });

  it("prepends the resolved root's usr/bin and bin so the script's coreutils resolve", () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === USR_BASH);

    const env = bashSpawnEnv({ PATH: 'C:\\Windows\\system32' });
    const expected = [
      path.join(GIT_ROOT, 'usr', 'bin'),
      path.join(GIT_ROOT, 'bin'),
      'C:\\Windows\\system32',
    ].join(path.delimiter);
    expect(env['PATH']).toBe(expected);
  });

  it("preserves the inherited PATH key's casing (no second spelling introduced)", () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === USR_BASH);

    const env = bashSpawnEnv({ Path: 'C:\\Windows\\system32', FOO: 'bar' });
    expect(env['Path']).toContain(path.join(GIT_ROOT, 'usr', 'bin'));
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(env['FOO']).toBe('bar');
  });

  it('handles an absent PATH in the base env (prefix only, no dangling delimiter)', () => {
    vi.mocked(os.platform).mockReturnValue('win32');
    vi.mocked(safeExec).mockReturnValue('D:/Git/mingw64/libexec/git-core');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === USR_BASH);

    const env = bashSpawnEnv({});
    expect(env['PATH']).toBe(
      [path.join(GIT_ROOT, 'usr', 'bin'), path.join(GIT_ROOT, 'bin')].join(path.delimiter),
    );
  });
});

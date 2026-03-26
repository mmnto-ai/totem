import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so rmSync is spyable in ESM
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { cleanTmpDir } from './test-utils.js';

describe('cleanTmpDir', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  it('removes a directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'test');
    cleanTmpDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  it('no-ops on undefined', () => {
    expect(() => cleanTmpDir(undefined)).not.toThrow();
  });

  it('no-ops on empty string', () => {
    expect(() => cleanTmpDir('')).not.toThrow();
  });

  it('does not throw on nonexistent path', () => {
    expect(() => cleanTmpDir('/tmp/nonexistent-totem-test-12345')).not.toThrow();
  });

  it('passes maxRetries and retryDelay to fs.rmSync', () => {
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation(() => {});
    cleanTmpDir('/fake/path');
    expect(spy).toHaveBeenCalledWith('/fake/path', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });
});

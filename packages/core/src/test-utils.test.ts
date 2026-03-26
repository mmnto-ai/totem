import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from './test-utils.js';

describe('cleanTmpDir', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
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
});

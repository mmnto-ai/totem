import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from './context.js';

describe('loadEnv', () => {
  let tmpDir: string;
  const injectedKeys: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-env-'));
  });

  afterEach(() => {
    // Clean up any keys we injected into process.env
    for (const key of injectedKeys) {
      delete process.env[key];
    }
    injectedKeys.length = 0;

    // Remove temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEnv(content: string): void {
    fs.writeFileSync(path.join(tmpDir, '.env'), content, 'utf-8');
  }

  function trackKey(key: string): void {
    injectedKeys.push(key);
  }

  it('parses a basic key=value pair', () => {
    const key = 'TOTEM_TEST_BASIC';
    trackKey(key);
    writeEnv(`${key}=value`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('value');
  });

  it('strips inline comments', () => {
    const key = 'TOTEM_TEST_WITH_COMMENT';
    trackKey(key);
    writeEnv(`${key}=secret # expires tomorrow`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('secret');
  });

  it('preserves hash inside double-quoted values', () => {
    const key = 'TOTEM_TEST_QUOTED_HASH';
    trackKey(key);
    writeEnv(`${key}="my#secret" # actual comment`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('my#secret');
  });

  it('handles empty values', () => {
    const key = 'TOTEM_TEST_EMPTY_VAL';
    trackKey(key);
    writeEnv(`${key}=`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('');
  });

  it('completes silently when .env file does not exist', () => {
    const nonExistent = path.join(tmpDir, 'no-such-dir');

    // Should not throw
    expect(() => loadEnv(nonExistent)).not.toThrow();
  });

  it('does not overwrite existing process.env keys', () => {
    const key = 'TOTEM_TEST_NO_OVERWRITE';
    trackKey(key);
    process.env[key] = 'original';
    writeEnv(`${key}=overwritten`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('original');
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import { readJsonSafe } from './fs.js';

describe('readJsonSafe', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-fs-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('reads and parses valid JSON without schema', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, '{"key": "value"}');
    const result = readJsonSafe(filePath);
    expect(result).toEqual({ key: 'value' });
  });

  it('reads and validates with Zod schema', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, '{"name": "totem", "version": 1}');
    const schema = z.object({ name: z.string(), version: z.number() });
    const result = readJsonSafe(filePath, schema);
    expect(result).toEqual({ name: 'totem', version: 1 });
  });

  it('throws TotemParseError on ENOENT', () => {
    expect(() => readJsonSafe(path.join(tmpDir, 'missing.json'))).toThrow(TotemParseError);
    try {
      readJsonSafe(path.join(tmpDir, 'missing.json'));
    } catch (err) {
      expect((err as TotemParseError).message).toContain('File not found');
      expect((err as TotemParseError).cause).toBeDefined();
    }
  });

  it('throws TotemParseError on invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{invalid json!!!}');
    expect(() => readJsonSafe(filePath)).toThrow(TotemParseError);
    try {
      readJsonSafe(filePath);
    } catch (err) {
      expect((err as TotemParseError).message).toContain('Invalid JSON');
      expect((err as TotemParseError).cause).toBeDefined();
    }
  });

  it('throws TotemParseError on empty file', () => {
    const filePath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(filePath, '');
    expect(() => readJsonSafe(filePath)).toThrow(TotemParseError);
  });

  it('throws TotemParseError with detailed paths on schema mismatch', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, '{"name": 123}');
    const schema = z.object({ name: z.string() });
    try {
      readJsonSafe(filePath, schema);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemParseError);
      expect((err as TotemParseError).message).toContain('Schema validation failed');
      expect((err as TotemParseError).message).toContain('name');
    }
  });
});

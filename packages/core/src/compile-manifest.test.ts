import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileManifest } from './compile-manifest.js';
import {
  generateInputHash,
  generateOutputHash,
  readCompileManifest,
  writeCompileManifest,
} from './compile-manifest.js';
import { TotemParseError } from './errors.js';
import { cleanTmpDir } from './test-utils.js';

describe('generateInputHash', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-input-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('is deterministic across CRLF and LF', () => {
    const dirLF = path.join(tmpDir, 'lf');
    const dirCRLF = path.join(tmpDir, 'crlf');
    fs.mkdirSync(dirLF, { recursive: true });
    fs.mkdirSync(dirCRLF, { recursive: true });

    const contentLF = 'line one\nline two\nline three\n';
    const contentCRLF = 'line one\r\nline two\r\nline three\r\n';

    fs.writeFileSync(path.join(dirLF, 'lesson.md'), contentLF);
    fs.writeFileSync(path.join(dirCRLF, 'lesson.md'), contentCRLF);

    expect(generateInputHash(dirLF)).toBe(generateInputHash(dirCRLF));
  });

  it('is deterministic regardless of readdir order', () => {
    // Create files with names that might sort differently in different OS locales
    fs.writeFileSync(path.join(tmpDir, 'b-lesson.md'), 'content B\n');
    fs.writeFileSync(path.join(tmpDir, 'a-lesson.md'), 'content A\n');
    fs.writeFileSync(path.join(tmpDir, 'c-lesson.md'), 'content C\n');

    const hash1 = generateInputHash(tmpDir);
    const hash2 = generateInputHash(tmpDir);
    expect(hash1).toBe(hash2);
    // Verify it's a valid hex SHA-256 (64 hex chars)
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('generateOutputHash', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-output-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('normalizes line endings', () => {
    const pathLF = path.join(tmpDir, 'rules-lf.json');
    const pathCRLF = path.join(tmpDir, 'rules-crlf.json');

    fs.writeFileSync(pathLF, '{"rules": []}\n');
    fs.writeFileSync(pathCRLF, '{"rules": []}\r\n');

    expect(generateOutputHash(pathLF)).toBe(generateOutputHash(pathCRLF));
  });
});

describe('writeCompileManifest + readCompileManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-rw-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('roundtrips a valid manifest', () => {
    const manifestPath = path.join(tmpDir, 'compile-manifest.json');
    const manifest: CompileManifest = {
      compiled_at: '2026-03-22T12:00:00Z',
      model: 'gemini-3-flash-preview',
      input_hash: 'a'.repeat(64),
      output_hash: 'b'.repeat(64),
      rule_count: 42,
    };

    writeCompileManifest(manifestPath, manifest);
    const loaded = readCompileManifest(manifestPath);

    expect(loaded).toEqual(manifest);
  });
});

describe('readCompileManifest error handling', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-err-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('throws TotemParseError on missing file', () => {
    const missing = path.join(tmpDir, 'does-not-exist.json');
    expect(() => readCompileManifest(missing)).toThrow(TotemParseError);
    expect(() => readCompileManifest(missing)).toThrow(/not found/);
  });

  it('throws TotemParseError on invalid JSON', () => {
    const badPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(badPath, '{ not valid json !!!');
    expect(() => readCompileManifest(badPath)).toThrow(TotemParseError);
    expect(() => readCompileManifest(badPath)).toThrow(/Invalid JSON/);
  });

  it('throws TotemParseError on invalid schema', () => {
    const badSchema = path.join(tmpDir, 'bad-schema.json');
    fs.writeFileSync(badSchema, JSON.stringify({ compiled_at: 123 }));
    expect(() => readCompileManifest(badSchema)).toThrow(TotemParseError);
    expect(() => readCompileManifest(badSchema)).toThrow(/Invalid compile manifest schema/);
  });
});

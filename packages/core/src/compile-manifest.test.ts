import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileManifest } from './compile-manifest.js';
import {
  canonicalizeKeys,
  canonicalStringify,
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

  it('manifest hash generates identical hashes for astGrepYamlRule objects with differently ordered keys', () => {
    const pathA = path.join(tmpDir, 'rules-a.json');
    const pathB = path.join(tmpDir, 'rules-b.json');

    const ruleA = {
      lessonHash: 'abc',
      lessonHeading: 'Test',
      pattern: '',
      message: 'm',
      engine: 'ast-grep',
      compiledAt: '2026-04-13T00:00:00Z',
      astGrepYamlRule: {
        rule: {
          all: [{ pattern: 'foo($A)' }, { inside: { kind: 'function_declaration' } }],
        },
      },
    };
    // Same semantic rule, scrambled keys at every level.
    const ruleB = {
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          all: [{ pattern: 'foo($A)' }, { inside: { kind: 'function_declaration' } }],
        },
      },
      pattern: '',
      compiledAt: '2026-04-13T00:00:00Z',
      lessonHash: 'abc',
      message: 'm',
      lessonHeading: 'Test',
    };

    fs.writeFileSync(pathA, JSON.stringify({ version: 1, rules: [ruleA] }, null, 2) + '\n');
    fs.writeFileSync(pathB, JSON.stringify({ version: 1, rules: [ruleB] }, null, 2) + '\n');

    expect(generateOutputHash(pathA)).toBe(generateOutputHash(pathB));
  });

  it('does not switch to canonical path when the literal string appears only in a lesson message', () => {
    // Regression for the substring false-positive flagged on #1412:
    // a rule whose message body contains the bytes `"astGrepYamlRule"`
    // (e.g., a lesson about when to use the new field) must NOT flip
    // the hash computation path. Pre-#1407 CLIs would hash the raw
    // byte stream; a false canonical path produces different bytes.
    const pathByteStream = path.join(tmpDir, 'rules-bytes.json');
    const pathWithStringInMessage = path.join(tmpDir, 'rules-msg.json');

    const plainRule = {
      lessonHash: 'plain',
      lessonHeading: 'regex rule',
      pattern: 'foo',
      message: 'use foo instead of bar',
      engine: 'regex',
      compiledAt: '2026-04-13T00:00:00Z',
    };
    const trickyRule = {
      lessonHash: 'tricky',
      lessonHeading: 'mention the field',
      pattern: 'foo',
      // Literal bytes `"astGrepYamlRule"` inside a message (wrapping
      // the name in single quotes in prose would still JSON-encode to
      // a version that does NOT contain the double-quoted token —
      // this test uses the token explicitly to force the worst case).
      message: 'prefer astGrepPattern over "astGrepYamlRule" for flat patterns',
      engine: 'regex',
      compiledAt: '2026-04-13T00:00:00Z',
    };

    const plainJson = JSON.stringify({ version: 1, rules: [plainRule] }, null, 2) + '\n';
    const trickyJson = JSON.stringify({ version: 1, rules: [trickyRule] }, null, 2) + '\n';

    fs.writeFileSync(pathByteStream, plainJson);
    fs.writeFileSync(pathWithStringInMessage, trickyJson);

    // Hashes differ (different messages), but the tricky rule must
    // have been hashed via the raw-byte-stream path, not canonical.
    // Proof: the canonical path on tricky would produce a different
    // hash than crypto over the raw bytes. Compare against the raw
    // sha256 of the file contents.
    const expectedTrickyHash = crypto
      .createHash('sha256')
      .update(trickyJson.replace(/\r\n/g, '\n'))
      .digest('hex');
    expect(generateOutputHash(pathWithStringInMessage)).toBe(expectedTrickyHash);
  });
});

describe('canonicalStringify', () => {
  it('sorts top-level object keys', () => {
    expect(canonicalStringify({ b: 2, a: 1 })).toBe(canonicalStringify({ a: 1, b: 2 }));
  });

  it('sorts keys at every nesting depth', () => {
    const a = { z: { y: { x: 1, w: 2 } }, a: 0 };
    const b = { a: 0, z: { y: { w: 2, x: 1 } } };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array element order (arrays are ordered by contract)', () => {
    expect(canonicalStringify([2, 1, 3])).not.toBe(canonicalStringify([1, 2, 3]));
  });

  it('handles nested arrays of objects with scrambled keys', () => {
    const a = {
      rule: {
        all: [{ pattern: 'foo', kind: 'call' }, { inside: { stopBy: 'end', kind: 'function' } }],
      },
    };
    const b = {
      rule: {
        all: [{ kind: 'call', pattern: 'foo' }, { inside: { kind: 'function', stopBy: 'end' } }],
      },
    };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('is stable for primitives', () => {
    expect(canonicalStringify('hello')).toBe('"hello"');
    expect(canonicalStringify(42)).toBe('42');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(null)).toBe('null');
  });

  it('handles undefined by omitting the key (JSON.stringify parity)', () => {
    const a = { a: 1, b: undefined };
    const b = { a: 1 };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('throws on a bare undefined input (contract violation)', () => {
    // Undefined in record values is filtered out upstream; a bare
    // undefined here means a caller bug, not malformed data on disk.
    // Fail loud rather than silently produce the string "undefined"
    // that would then hash to something no other input produces.
    expect(() => canonicalStringify(undefined)).toThrow(/undefined is not a JSON value/);
  });

  it('produces pretty-printed output when given an indent argument', () => {
    // The optional indent param routes through JSON.stringify so committable
    // artefacts (verification-outcomes.json, etc.) stay diff-friendly while
    // still using the canonical key order that minified hash payloads use.
    const out = canonicalStringify({ b: 2, a: 1 }, 2);
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('agrees with the minified form when indent is omitted', () => {
    const v = { z: 1, a: { c: 3, b: 2 } };
    expect(canonicalStringify(v)).toBe('{"a":{"b":2,"c":3},"z":1}');
  });
});

describe('canonicalizeKeys', () => {
  it('sorts object keys recursively without serializing', () => {
    const out = canonicalizeKeys({ z: { y: 1, x: 2 }, a: 0 }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['a', 'z']);
    expect(Object.keys(out.z as object)).toEqual(['x', 'y']);
  });

  it('preserves array order while sorting nested object keys', () => {
    const out = canonicalizeKeys([{ b: 1, a: 2 }, 3, { d: 4, c: 5 }]) as Array<unknown>;
    expect(out).toHaveLength(3);
    expect(Object.keys(out[0] as object)).toEqual(['a', 'b']);
    expect(out[1]).toBe(3);
    expect(Object.keys(out[2] as object)).toEqual(['c', 'd']);
  });

  it('returns primitives unchanged', () => {
    expect(canonicalizeKeys('s')).toBe('s');
    expect(canonicalizeKeys(7)).toBe(7);
    expect(canonicalizeKeys(null)).toBe(null);
    expect(canonicalizeKeys(true)).toBe(true);
  });

  it('drops undefined-valued properties (JSON.stringify parity)', () => {
    const out = canonicalizeKeys({ a: 1, b: undefined, c: 3 }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['a', 'c']);
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

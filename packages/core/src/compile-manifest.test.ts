import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompileManifest } from './compile-manifest.js';
import {
  attestRecordsHash,
  canonicalizeKeys,
  canonicalStringify,
  EMPTY_RECORDS_HASH,
  generateInputHash,
  generateOutputHash,
  generateRecordsHash,
  isRecordsAttestationFresh,
  listRecordFiles,
  listRecordFilesUnder,
  readCompileManifest,
  RECORDS_DIR_REL,
  writeCompileManifest,
} from './compile-manifest.js';
import { TotemParseError } from './errors.js';
import { safeExec } from './sys/exec.js';
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

  it('hashes git-tracked lessons only when repoCwd is inside a git repo', () => {
    // Regression for the partial-freeze push-gate (mmnto-ai/totem#2051 /
    // mmnto-ai/totem#2055): an untracked MCP scratch lesson must not diverge
    // the input hash.
    const repoDir = path.join(tmpDir, 'repo');
    const lessonsDir = path.join(repoDir, '.totem', 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    safeExec('git', ['init', '-q'], { cwd: repoDir });

    fs.writeFileSync(path.join(lessonsDir, 'lesson-aaa.md'), 'tracked lesson\n');
    fs.writeFileSync(path.join(lessonsDir, 'lesson-bbb.md'), 'untracked scratch\n');
    // A nested tracked lesson exercises the cross-platform separator path:
    // collectMdFiles + the tracked set must agree on '/' regardless of OS.
    fs.mkdirSync(path.join(lessonsDir, 'cat'), { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, 'cat', 'lesson-ccc.md'), 'nested tracked\n');
    // Staging the index is enough for the tracked-file query — no commit needed.
    safeExec('git', ['add', '.totem/lessons/lesson-aaa.md', '.totem/lessons/cat/lesson-ccc.md'], {
      cwd: repoDir,
    });

    // Reference dir holding ONLY the tracked lessons at the same relative paths.
    const refDir = path.join(tmpDir, 'ref');
    fs.mkdirSync(path.join(refDir, 'cat'), { recursive: true });
    fs.writeFileSync(path.join(refDir, 'lesson-aaa.md'), 'tracked lesson\n');
    fs.writeFileSync(path.join(refDir, 'cat', 'lesson-ccc.md'), 'nested tracked\n');

    const trackedOnly = generateInputHash(lessonsDir, repoDir);
    const allFiles = generateInputHash(lessonsDir);

    // tracked-only excludes the untracked scratch → equals the tracked-only reference
    expect(trackedOnly).toBe(generateInputHash(refDir));
    // legacy no-cwd form still sees both files, so it differs
    expect(allFiles).not.toBe(trackedOnly);
  });

  it('falls back to hashing all .md when repoCwd is not a git repo', () => {
    // tmpDir lives under os.tmpdir() — not a git repo, so findRepoRootSync → null
    // and the function degrades to the legacy fs-walk (every .md hashed).
    fs.writeFileSync(path.join(tmpDir, 'lesson-aaa.md'), 'a\n');
    fs.writeFileSync(path.join(tmpDir, 'lesson-bbb.md'), 'b\n');
    expect(generateInputHash(tmpDir, tmpDir)).toBe(generateInputHash(tmpDir));
  });
});

// ─── Prop 310 § Design 1 — the record file class attestation (slice 3) ───────

describe('generateRecordsHash / attestRecordsHash', () => {
  let tmpDir: string;
  let totemDir: string;
  let rulesDir: string;

  const RECORD = [
    'schemaVersion: 1',
    'severity: warning',
    'message: no console.log',
    'target:',
    '  type: regex',
    "  pattern: 'console\\.log'",
    '  scope:',
    "    fileGlobs: ['**/*.ts']",
    'examples:',
    "  - bad: 'console.log(1)'",
    "    good: 'logger.info(1)'",
    '',
  ].join('\n');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-manifest-records-'));
    totemDir = path.join(tmpDir, '.totem');
    rulesDir = path.join(totemDir, RECORDS_DIR_REL);
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  const write = (rel: string, content = RECORD) => {
    const target = path.join(rulesDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf-8');
  };

  it('returns the EMPTY-SET constant when the records directory is absent (OQ-3 “no records”)', () => {
    expect(generateRecordsHash(rulesDir)).toBe(EMPTY_RECORDS_HASH);
    expect(listRecordFiles(rulesDir)).toEqual([]);
  });

  it('returns the EMPTY-SET constant for an existing but record-free directory', () => {
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'README.md'), 'not a record\n');
    fs.writeFileSync(path.join(rulesDir, 'config.yaml'), 'not a record\n');
    expect(generateRecordsHash(rulesDir)).toBe(EMPTY_RECORDS_HASH);
    expect(listRecordFiles(rulesDir)).toEqual([]);
  });

  it('the empty-set constant is sha256-over-nothing — stable, not a platform artifact', () => {
    // Computed the same way the production constant is, from an independent
    // `crypto` call: a transcribed literal is the mirror this pins against.
    expect(EMPTY_RECORDS_HASH).toBe(crypto.createHash('sha256').digest('hex'));
    expect(EMPTY_RECORDS_HASH).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes on ONE edited byte', () => {
    write('a.rule.yaml');
    const before = generateRecordsHash(rulesDir);
    write('a.rule.yaml', RECORD.replace('warning', 'error'));
    expect(generateRecordsHash(rulesDir)).not.toBe(before);
  });

  it('changes when a record is ADDED and again when it is REMOVED', () => {
    write('a.rule.yaml');
    const one = generateRecordsHash(rulesDir);
    write('b.rule.yaml');
    const two = generateRecordsHash(rulesDir);
    expect(two).not.toBe(one);
    fs.rmSync(path.join(rulesDir, 'b.rule.yaml'));
    expect(generateRecordsHash(rulesDir)).toBe(one);
  });

  it('changes on a RENAME even with byte-identical content (path is hash material)', () => {
    write('a.rule.yaml');
    const before = generateRecordsHash(rulesDir);
    fs.renameSync(path.join(rulesDir, 'a.rule.yaml'), path.join(rulesDir, 'b.rule.yaml'));
    expect(generateRecordsHash(rulesDir)).not.toBe(before);
  });

  it('is CRLF-blind — a Windows-authored record hashes identically to its LF twin', () => {
    write('a.rule.yaml');
    const lf = generateRecordsHash(rulesDir);
    write('a.rule.yaml', RECORD.replace(/\n/g, '\r\n'));
    expect(generateRecordsHash(rulesDir)).toBe(lf);
  });

  it('is deterministic regardless of readdir order, and walks nested directories', () => {
    write('z.rule.yaml');
    write('a.rule.yaml');
    write(path.join('nested', 'm.rule.yaml'));
    expect(listRecordFiles(rulesDir)).toEqual(['a.rule.yaml', 'nested/m.rule.yaml', 'z.rule.yaml']);
    expect(generateRecordsHash(rulesDir)).toBe(generateRecordsHash(rulesDir));
    expect(generateRecordsHash(rulesDir)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ignores a non-record `.yaml` sibling — the double extension is the file class', () => {
    write('a.rule.yaml');
    const before = generateRecordsHash(rulesDir);
    fs.writeFileSync(path.join(rulesDir, 'a.yaml'), RECORD, 'utf-8');
    expect(generateRecordsHash(rulesDir)).toBe(before);
  });

  it('hashes git-tracked records only when repoCwd is inside a git repo', () => {
    // Producer/consumer symmetry with `generateInputHash`: an untracked draft
    // record must not diverge the attestation and block an unrelated push.
    safeExec('git', ['init', '-q'], { cwd: tmpDir });
    write('tracked.rule.yaml');
    write('untracked.rule.yaml');
    safeExec('git', ['add', '.totem/rules/tracked.rule.yaml'], { cwd: tmpDir });

    const trackedOnly = generateRecordsHash(rulesDir, tmpDir);
    expect(listRecordFiles(rulesDir, tmpDir)).toEqual(['tracked.rule.yaml']);
    expect(trackedOnly).not.toBe(generateRecordsHash(rulesDir));

    fs.rmSync(path.join(rulesDir, 'untracked.rule.yaml'));
    expect(generateRecordsHash(rulesDir)).toBe(trackedOnly);
  });

  it('listRecordFilesUnder is the READ-side twin of attestRecordsHash over the same tracked set', () => {
    // MIN-1/N-4: the verifier's COUNT and the writer's HASH must describe one set.
    // Exercised in a REAL git repo, because outside one `restrictToTracked`
    // short-circuits and the tracked/untracked distinction never runs at all.
    safeExec('git', ['init', '-q'], { cwd: tmpDir });
    write('tracked.rule.yaml');
    write('untracked.rule.yaml');
    safeExec('git', ['add', '.totem/rules/tracked.rule.yaml'], { cwd: tmpDir });

    // Same directory, same restriction, reached through the `<totemDir>` helpers.
    expect(listRecordFilesUnder(totemDir, tmpDir)).toEqual(['tracked.rule.yaml']);
    expect(listRecordFilesUnder(totemDir, tmpDir)).toEqual(listRecordFiles(rulesDir, tmpDir));
    expect(attestRecordsHash(totemDir, tmpDir)).toBe(generateRecordsHash(rulesDir, tmpDir));

    // …and the tracked answer genuinely DIFFERS from the plain fs walk, so the
    // equality above is not two names for the same unrestricted result.
    expect(attestRecordsHash(totemDir, tmpDir)).not.toBe(attestRecordsHash(totemDir));
    expect(listRecordFilesUnder(totemDir)).toEqual(['tracked.rule.yaml', 'untracked.rule.yaml']);
  });

  it('counts an UNTRACKED record as absent — it is neither attested nor counted', () => {
    // The `records: none` claim rests on this: a working-tree draft must not make
    // the verifier demand an attestation the writer would not have produced.
    safeExec('git', ['init', '-q'], { cwd: tmpDir });
    write('draft.rule.yaml'); // never `git add`ed

    expect(listRecordFilesUnder(totemDir, tmpDir)).toEqual([]);
    expect(attestRecordsHash(totemDir, tmpDir)).toBe(EMPTY_RECORDS_HASH);
  });

  it('isRecordsAttestationFresh answers the OQ-3 question the same way the verifier does', () => {
    // The predicate three writers/readers share (bot round 1, B-1). All four
    // arms, in a REAL repo so the tracked restriction runs.
    safeExec('git', ['init', '-q'], { cwd: tmpDir });

    // absent + ZERO tracked records ⇒ fresh (the pre-Prop-310 state).
    expect(isRecordsAttestationFresh(undefined, totemDir, tmpDir)).toBe(true);

    // …an UNTRACKED draft does not change that: it is not counted.
    write('draft.rule.yaml');
    expect(isRecordsAttestationFresh(undefined, totemDir, tmpDir)).toBe(true);

    // absent + N tracked records ⇒ STALE ("unattested file class").
    write('tracked.rule.yaml');
    safeExec('git', ['add', '.totem/rules/tracked.rule.yaml'], { cwd: tmpDir });
    expect(isRecordsAttestationFresh(undefined, totemDir, tmpDir)).toBe(false);

    // present + EQUAL ⇒ fresh.
    const current = attestRecordsHash(totemDir, tmpDir);
    expect(isRecordsAttestationFresh(current, totemDir, tmpDir)).toBe(true);

    // present + DIFFERENT ⇒ stale ("records hash mismatch").
    expect(isRecordsAttestationFresh('f'.repeat(64), totemDir, tmpDir)).toBe(false);
    // …including the empty-set value once records exist, which is the shape a
    // manifest written before the record landed would carry.
    expect(isRecordsAttestationFresh(EMPTY_RECORDS_HASH, totemDir, tmpDir)).toBe(false);
  });

  it('attestRecordsHash resolves `<totemDir>/rules` — the one writer-side entry point', () => {
    write('a.rule.yaml');
    expect(attestRecordsHash(totemDir)).toBe(generateRecordsHash(rulesDir));
    expect(RECORDS_DIR_REL).toBe('rules');
  });

  it('leaves generateInputHash untouched — the lesson class is hashed exactly as before', () => {
    // The collector was generalised by a suffix parameter; the lesson hash must be
    // byte-identical, which a fixed expected digest over fixed content pins.
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, 'l.md'), 'body\n', 'utf-8');
    const expected = crypto.createHash('sha256').update('l.md\nbody\n\n').digest('hex');
    expect(generateInputHash(lessonsDir)).toBe(expected);
  });

  it('still throws when the LESSONS directory is absent — records-absence tolerance is records-only', () => {
    expect(() => generateInputHash(path.join(totemDir, 'lessons'))).toThrow(TotemParseError);
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

  // Pre-#1937 manifests pre-date the compile_worker_fingerprint field. The
  // schema must accept them as-is so an old manifest on disk continues to
  // parse after the consumer upgrades the CLI. Migration is additive — the
  // next `totem compile` writes the field; until then, drift surveillance
  // no-ops gracefully.
  it('accepts a pre-#1937 manifest without compile_worker_fingerprint', () => {
    const manifestPath = path.join(tmpDir, 'compile-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        compiled_at: '2026-03-22T12:00:00Z',
        model: 'claude-sonnet-4-6',
        input_hash: 'c'.repeat(64),
        output_hash: 'd'.repeat(64),
        rule_count: 7,
      }) + '\n',
    );

    const loaded = readCompileManifest(manifestPath);
    expect(loaded.compile_worker_fingerprint).toBeUndefined();
    expect(loaded.rule_count).toBe(7);
  });

  it('roundtrips a manifest with compile_worker_fingerprint', () => {
    const manifestPath = path.join(tmpDir, 'compile-manifest.json');
    const manifest: CompileManifest = {
      compiled_at: '2026-03-22T12:00:00Z',
      model: 'claude-sonnet-4-6',
      input_hash: 'e'.repeat(64),
      output_hash: 'f'.repeat(64),
      rule_count: 99,
      compile_worker_fingerprint: '0'.repeat(64),
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

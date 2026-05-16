import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeCompileWorkerFingerprint,
  modelStripsTemperature,
  readPromptTemplateContentHash,
} from './compile-worker-fingerprint.js';
import { TotemParseError } from './errors.js';

describe('computeCompileWorkerFingerprint', () => {
  const baseHash = 'a'.repeat(64);

  it('is deterministic for identical inputs', () => {
    const a = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    const b = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    expect(a).toBe(b);
  });

  it('differs when model differs', () => {
    const a = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    const b = computeCompileWorkerFingerprint({
      model: 'claude-opus-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    expect(a).not.toBe(b);
  });

  it('differs when temperature differs', () => {
    const a = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    const b = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0.5,
      promptTemplateContentHash: baseHash,
    });
    expect(a).not.toBe(b);
  });

  // "Record absence, not placeholder" — Proposal 278 § missing-slot
  // tolerance. The canonicalStringify path drops undefined keys, so an
  // omitted temperature produces a structurally smaller payload than any
  // numeric placeholder (including 0). The two fingerprints must diverge.
  it('records temperature absence distinctly from temperature: 0', () => {
    const withTemp = computeCompileWorkerFingerprint({
      model: 'claude-opus-4-7',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    const withoutTemp = computeCompileWorkerFingerprint({
      model: 'claude-opus-4-7',
      promptTemplateContentHash: baseHash,
    });
    expect(withTemp).not.toBe(withoutTemp);
  });

  it('differs when prompt template content hash differs', () => {
    const a = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: 'a'.repeat(64),
    });
    const b = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: 'b'.repeat(64),
    });
    expect(a).not.toBe(b);
  });

  it('returns a 64-character sha256 hex string', () => {
    const fp = computeCompileWorkerFingerprint({
      model: 'claude-sonnet-4-6',
      temperature: 0,
      promptTemplateContentHash: baseHash,
    });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('readPromptTemplateContentHash', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-prompt-hash-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hashes file contents with normalized line endings', () => {
    const lf = path.join(tmpDir, 'lf.txt');
    const crlf = path.join(tmpDir, 'crlf.txt');
    fs.writeFileSync(lf, 'line1\nline2\n', 'utf-8');
    fs.writeFileSync(crlf, 'line1\r\nline2\r\n', 'utf-8');

    // Both files should produce the same hash after normalization — sha256 of "line1\nline2\n"
    const expected = crypto.createHash('sha256').update('line1\nline2\n').digest('hex');
    expect(readPromptTemplateContentHash(lf)).toBe(expected);
    expect(readPromptTemplateContentHash(crlf)).toBe(expected);
  });

  it('throws TotemParseError with recovery hint when file is missing', () => {
    const missing = path.join(tmpDir, 'does-not-exist.ts');
    expect(() => readPromptTemplateContentHash(missing)).toThrow(TotemParseError);
  });
});

describe('modelStripsTemperature', () => {
  it.each([
    ['claude-opus-4-7', true],
    ['claude-opus-4-7-1', true],
    ['claude-opus-4-8', true],
    ['claude-opus-5-0', true],
    ['claude-opus-9-0', true],
    ['claude-opus-4-6', false],
    ['claude-opus-4-5', false],
    ['claude-sonnet-4-6', false],
    ['claude-sonnet-4-7', false], // Sonnet 4-7 doesn't strip per Phase 1 doc
    ['claude-haiku-4-5', false],
    ['gpt-4o', false],
    ['gemini-2.5-pro', false],
  ])('%s → %s', (model, expected) => {
    expect(modelStripsTemperature(model)).toBe(expected);
  });
});

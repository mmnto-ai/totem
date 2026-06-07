import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import type { RunArtifact } from './schema.js';
import { RUN_ARTIFACT_SCHEMA_VERSION } from './schema.js';
import {
  computeRunArtifactContentHash,
  loadRunArtifact,
  runsDir,
  saveRunArtifact,
} from './storage.js';

function artifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'prompt after DLP' },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only' },
    backend: {
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      qualifiedModel: 'gemini:gemini-3.1-pro-preview',
      admissionClass: 'completion_only',
      taskProfile: 'Spec',
    },
    output: { content: 'response', metrics: { durationMs: 1200 } },
    createdAt: '2026-06-07T03:00:00.000Z',
    ...overrides,
  };
}

describe('run-artifact storage', () => {
  let totemDir: string;

  beforeEach(() => {
    totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-artifacts-'));
  });

  afterEach(() => {
    cleanTmpDir(totemDir);
  });

  it('saves a valid artifact at its content-address and loads it back', () => {
    const saved = saveRunArtifact(totemDir, artifact());
    expect(saved.existed).toBe(false);
    expect(saved.path).toBe(path.join(runsDir(totemDir), `${saved.hash}.json`));
    expect(fs.existsSync(saved.path)).toBe(true);
    expect(loadRunArtifact(totemDir, saved.hash)).toEqual(artifact());
  });

  it('content-address excludes createdAt — identical runs dedup across time', () => {
    const early = artifact({ createdAt: '2026-06-07T03:00:00.000Z' });
    const late = artifact({ createdAt: '2026-06-08T09:30:00.000Z' });
    expect(computeRunArtifactContentHash(early)).toBe(computeRunArtifactContentHash(late));
  });

  it('append-only: re-saving the same logical run never rewrites the existing file', () => {
    const first = saveRunArtifact(totemDir, artifact({ createdAt: '2026-06-07T03:00:00.000Z' }));
    const second = saveRunArtifact(totemDir, artifact({ createdAt: '2026-06-08T09:30:00.000Z' }));
    expect(second.hash).toBe(first.hash);
    expect(second.existed).toBe(true);
    // The ORIGINAL record survives byte-identical — including its createdAt.
    expect(loadRunArtifact(totemDir, first.hash).createdAt).toBe('2026-06-07T03:00:00.000Z');
  });

  it('different logical runs get different content addresses', () => {
    const a = saveRunArtifact(totemDir, artifact());
    const b = saveRunArtifact(
      totemDir,
      artifact({ output: { content: 'different response', metrics: { durationMs: 900 } } }),
    );
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects loading corrupted or invalid schema artifacts', () => {
    const dir = runsDir(totemDir);
    fs.mkdirSync(dir, { recursive: true });
    const corrupted = 'c'.repeat(64);
    fs.writeFileSync(path.join(dir, `${corrupted}.json`), '{not json at all');
    expect(() => loadRunArtifact(totemDir, corrupted)).toThrow(TotemParseError);

    const wrongMajor = 'd'.repeat(64);
    fs.writeFileSync(
      path.join(dir, `${wrongMajor}.json`),
      JSON.stringify({ ...artifact(), schemaVersion: '2.0.0' }),
    );
    expect(() => loadRunArtifact(totemDir, wrongMajor)).toThrow(/2\.0\.0/);
  });

  it('loading a missing hash throws with the path named', () => {
    expect(() => loadRunArtifact(totemDir, 'e'.repeat(64))).toThrow(TotemParseError);
  });

  it('rejects a non-hash id before touching the filesystem (path-traversal guard)', () => {
    expect(() => loadRunArtifact(totemDir, '../../secrets')).toThrow(/sha256/i);
  });
});

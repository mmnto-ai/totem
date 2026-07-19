import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import type { BoundedTextEvidence, InvocationFailureArtifact, RunArtifact } from './schema.js';
import {
  INVOCATION_FAILURE_ARTIFACT_SCHEMA_VERSION,
  INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES,
  RUN_ARTIFACT_SCHEMA_VERSION,
} from './schema.js';
import {
  computeInvocationFailureArtifactContentHash,
  computeRunArtifactContentHash,
  failureRunsDir,
  loadInvocationFailureArtifact,
  loadRunArtifact,
  runsDir,
  saveInvocationFailureArtifact,
  saveRunArtifact,
} from './storage.js';

function textEvidence(text: string, limitBytes = 64 * 1024): BoundedTextEvidence {
  const bytes = Buffer.byteLength(text, 'utf-8');
  return {
    encoding: 'utf-8',
    head: text,
    observedBytes: bytes,
    retainedBytes: bytes,
    limitBytes,
    truncated: false,
    dlp: 'masked',
  };
}

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

function failureArtifact(
  overrides: Partial<InvocationFailureArtifact> = {},
): InvocationFailureArtifact {
  return {
    schemaVersion: INVOCATION_FAILURE_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'prompt after DLP' },
    inputHash: 'c'.repeat(64),
    grounding: { hash: 'd'.repeat(64), provenanceSummary: 'similarity-only' },
    requestedBackend: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      qualifiedModel: 'anthropic:claude-sonnet-5',
      admissionClass: 'completion_only',
      taskProfile: 'Review',
    },
    attempts: [
      {
        sequence: 1,
        route: 'cli-fallback',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        status: 'failed',
        durationMs: 900,
        failureKind: 'process-exit',
        process: {
          exitCode: 1,
          signal: null,
          timedOut: false,
          stdout: textEvidence('partial'),
          stderr: textEvidence('rejected'),
        },
      },
    ],
    terminal: {
      kind: 'process-exit',
      attempt: 1,
      message: textEvidence('Claude CLI exited with code 1', INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES),
    },
    createdAt: '2026-07-19T12:00:00.000Z',
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
    // Explicit segments, not runsDir() — asserting against the helper under
    // test would mask a path-layout regression (CR review on #2114).
    expect(saved.path).toBe(path.join(totemDir, 'artifacts', 'runs', `${saved.hash}.json`));
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

describe('invocation-failure artifact storage', () => {
  let totemDir: string;

  beforeEach(() => {
    totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-invoke-failures-'));
  });

  afterEach(() => {
    cleanTmpDir(totemDir);
  });

  it('stores under runs/failures, mode 0600, and loads the artifact back', () => {
    const failure = failureArtifact();
    const saved = saveInvocationFailureArtifact(totemDir, failure);

    expect(saved.existed).toBe(false);
    expect(saved.path).toBe(
      path.join(totemDir, 'artifacts', 'runs', 'failures', `${saved.hash}.json`),
    );
    expect(loadInvocationFailureArtifact(totemDir, saved.hash)).toEqual(failure);
    if (process.platform !== 'win32') {
      expect(fs.statSync(saved.path).mode & 0o777).toBe(0o600);
    }
  });

  it('excludes createdAt from identity and preserves the first write', () => {
    const early = failureArtifact({ createdAt: '2026-07-19T12:00:00.000Z' });
    const late = failureArtifact({ createdAt: '2026-07-20T12:00:00.000Z' });
    expect(computeInvocationFailureArtifactContentHash(early)).toBe(
      computeInvocationFailureArtifactContentHash(late),
    );

    const first = saveInvocationFailureArtifact(totemDir, early);
    const second = saveInvocationFailureArtifact(totemDir, late);
    expect(second).toEqual({ ...first, existed: true });
    expect(loadInvocationFailureArtifact(totemDir, first.hash).createdAt).toBe(early.createdAt);
  });

  it('changes identity when persisted diagnostic evidence changes', () => {
    const original = failureArtifact();
    const changed = failureArtifact({
      terminal: {
        ...original.terminal,
        message: textEvidence('different bounded message', INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES),
      },
    });
    expect(computeInvocationFailureArtifactContentHash(original)).not.toBe(
      computeInvocationFailureArtifactContentHash(changed),
    );
  });

  it('rejects invalid ids before reading the failure directory', () => {
    expect(failureRunsDir(totemDir)).toBe(path.join(totemDir, 'artifacts', 'runs', 'failures'));
    expect(() => loadInvocationFailureArtifact(totemDir, '../../secrets')).toThrow(/sha256/i);
  });
});

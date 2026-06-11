import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunArtifact, TotemConfig } from '@mmnto/totem';
import { RUN_ARTIFACT_SCHEMA_VERSION, saveRunArtifact } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';

// Partial-mock utils so rerunArtifact's delegation is observable without a
// live backend. Everything else in utils stays real.
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return { ...actual, runOrchestrator: vi.fn() };
});

import { runOrchestrator } from '../utils.js';
import { compareRunArtifacts, rerunArtifact } from './run-artifacts.js';

const mockedRunOrchestrator = vi.mocked(runOrchestrator);

const NEW_HASH = 'f'.repeat(64);

function artifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'stored prompt', maskedSystemPrompt: 'stored system' },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only' },
    backend: {
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      qualifiedModel: 'gemini:gemini-3.1-pro-preview',
      admissionClass: 'completion_only',
      taskProfile: 'Spec',
      temperature: 0,
    },
    output: { content: 'stored response', metrics: { durationMs: 1200, inputTokens: 80 } },
    createdAt: '2026-06-07T03:00:00.000Z',
    ...overrides,
  };
}

function config(overrides?: Partial<TotemConfig>): TotemConfig {
  return {
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    orchestrator: { provider: 'gemini', defaultModel: 'gemini-3-flash-preview' },
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    contextWarningThreshold: 40_000,
    ...overrides,
  } as TotemConfig;
}

describe('rerunArtifact', () => {
  let tmpDir: string;
  let sourceHash: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rerun-'));
    sourceHash = saveRunArtifact(path.join(tmpDir, '.totem'), artifact()).hash;
    mockedRunOrchestrator.mockImplementation(async (opts) => {
      // Simulate the emission seam: a real run records a NEW artifact.
      opts.artifact?.onEmitted?.(NEW_HASH, `/runs/${NEW_HASH}.json`);
      return 'rerun content';
    });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('re-invokes with the stored bundle verbatim — no retrieval, no response cache', async () => {
    const result = await rerunArtifact({ hash: sourceHash, config: config(), cwd: tmpDir });

    expect(mockedRunOrchestrator).toHaveBeenCalledTimes(1);
    const call = mockedRunOrchestrator.mock.calls[0]![0];
    expect(call.prompt).toBe('stored prompt'); // the EXACT stored bundle
    expect(call.systemPrompt).toBe('stored system');
    expect(call.options.fresh).toBe(true); // response cache bypassed — a cached replay is not a rerun
    expect(call.options.model).toBe('gemini:gemini-3.1-pro-preview'); // resolved backend, not config default
    expect(call.temperature).toBe(0);
    expect(call.tag).toBe('Spec');
    // Grounding identity carried verbatim — the rerun makes no new grounding claim.
    expect(call.artifact).toMatchObject({
      groundingHash: 'b'.repeat(64),
      provenanceSummary: 'similarity-only',
    });

    expect(result.sourceHash).toBe(sourceHash);
    expect(result.hash).toBe(NEW_HASH); // append-only: the rerun is a NEW record
    expect(result.content).toBe('rerun content');
  });

  it('carries the grounding bundle verbatim on rerun — no new grounding claim (mmnto-ai/totem#2101)', async () => {
    const bundle = {
      items: [
        {
          provenance: 'similarity-only',
          contentHash: 'c'.repeat(64),
          sourceType: 'code',
          filePath: 'src/x.ts',
        },
      ],
    };
    const bundledHash = saveRunArtifact(
      path.join(tmpDir, '.totem'),
      artifact({
        inputBundle: { maskedPrompt: 'bundled prompt' },
        grounding: { hash: 'd'.repeat(64), provenanceSummary: 'similarity-only:1', bundle },
      }),
    ).hash;

    await rerunArtifact({ hash: bundledHash, config: config(), cwd: tmpDir });

    const call = mockedRunOrchestrator.mock.calls[0]![0];
    expect(call.artifact).toMatchObject({
      groundingHash: 'd'.repeat(64),
      provenanceSummary: 'similarity-only:1',
      bundle,
    });
  });

  it('throws on a missing source hash without invoking anything', async () => {
    await expect(
      rerunArtifact({ hash: 'e'.repeat(64), config: config(), cwd: tmpDir }),
    ).rejects.toThrow();
    expect(mockedRunOrchestrator).not.toHaveBeenCalled();
  });

  // ─── Admission replay (mmnto-ai/totem#2102) ──

  it('replays a recorded admission group + elevated class verbatim — no silent downgrade (invariant 7)', async () => {
    const admission = {
      outputContract: { citationsRequired: true, verifyFallback: true },
      contextPolicy: { budget: 16_000 },
      runMetadata: { caller: 'spec', command: 'spec' },
    };
    const elevatedHash = saveRunArtifact(
      path.join(tmpDir, '.totem'),
      artifact({
        backend: {
          provider: 'gemini',
          model: 'gemini-3.1-pro-preview',
          qualifiedModel: 'gemini:gemini-3.1-pro-preview',
          admissionClass: 'self_grounding_agent',
          taskProfile: 'Spec',
        },
        admission,
      }),
    ).hash;

    await rerunArtifact({ hash: elevatedHash, config: config(), cwd: tmpDir });

    const call = mockedRunOrchestrator.mock.calls[0]![0];
    expect(call.backendAdmissionClass).toBe('self_grounding_agent');
    expect(call.outputContract).toEqual(admission.outputContract);
    expect(call.contextPolicy).toEqual(admission.contextPolicy);
    expect(call.runMetadata).toEqual(admission.runMetadata);
  });

  it('rerunning an artifact without an admission group stays byte-identical to today (invariant 7)', async () => {
    await rerunArtifact({ hash: sourceHash, config: config(), cwd: tmpDir });

    const call = mockedRunOrchestrator.mock.calls[0]![0] as Record<string, unknown>;
    // None of the #2102 keys appear — a slice-1 rerun is today's call shape.
    for (const key of [
      'task',
      'groundingBundle',
      'backendAdmissionClass',
      'contextPolicy',
      'outputContract',
      'runMetadata',
    ]) {
      expect(call).not.toHaveProperty(key);
    }
  });
});

describe('compareRunArtifacts', () => {
  it('reports identical artifacts as identical with zero metric deltas', () => {
    const cmp = compareRunArtifacts(artifact(), artifact());
    expect(cmp.sameInput).toBe(true);
    expect(cmp.sameGrounding).toBe(true);
    expect(cmp.sameBackend).toBe(true);
    expect(cmp.sameOutput).toBe(true);
    expect(cmp.backendDelta).toEqual([]);
    expect(cmp.metricsDelta.durationMs).toBe(0);
  });

  it('reports output divergence with content hashes, never similarity scores (F3)', () => {
    const b = artifact({
      output: { content: 'different response', metrics: { durationMs: 900, inputTokens: 90 } },
    });
    const cmp = compareRunArtifacts(artifact(), b);
    expect(cmp.sameInput).toBe(true);
    expect(cmp.sameOutput).toBe(false);
    expect(cmp.outputDelta.contentHashA).toMatch(/^[0-9a-f]{64}$/);
    expect(cmp.outputDelta.contentHashB).toMatch(/^[0-9a-f]{64}$/);
    expect(cmp.outputDelta.contentHashA).not.toBe(cmp.outputDelta.contentHashB);
    expect(cmp.metricsDelta.durationMs).toBe(-300); // b minus a
    expect(cmp.metricsDelta.inputTokens).toBe(10);
    // Deterministic-substrate discipline: no scorer fields of any kind.
    expect(JSON.stringify(cmp)).not.toMatch(/similarity|score/i);
  });

  it('names every differing backend field', () => {
    const b = artifact({
      backend: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        qualifiedModel: 'anthropic:claude-opus-4-8',
        admissionClass: 'completion_only',
        taskProfile: 'Spec',
        temperature: 0.7,
      },
    });
    const cmp = compareRunArtifacts(artifact(), b);
    expect(cmp.sameBackend).toBe(false);
    expect(cmp.backendDelta).toEqual(
      expect.arrayContaining(['provider', 'model', 'qualifiedModel', 'temperature']),
    );
    expect(cmp.backendDelta).not.toContain('taskProfile');
  });

  it('null token metrics yield null deltas (honest-absent, never NaN)', () => {
    const a = artifact({
      output: { content: 'x', metrics: { durationMs: 100, inputTokens: null } },
    });
    const b = artifact({
      output: { content: 'x', metrics: { durationMs: 150, inputTokens: 80 } },
    });
    const cmp = compareRunArtifacts(a, b);
    expect(cmp.metricsDelta.inputTokens).toBeNull();
    expect(cmp.metricsDelta.durationMs).toBe(50);
  });

  it('is a pure function — same inputs, deep-equal output', () => {
    const a = artifact();
    const b = artifact({ output: { content: 'y', metrics: { durationMs: 1 } } });
    expect(compareRunArtifacts(a, b)).toEqual(compareRunArtifacts(a, b));
  });

  // ─── Admission comparison (mmnto-ai/totem#2102) ──

  it('two slice-1 artifacts (no admission group) compare as sameAdmission with an empty delta (invariant 6)', () => {
    const cmp = compareRunArtifacts(artifact(), artifact());
    expect(cmp.sameAdmission).toBe(true);
    expect(cmp.admissionDelta).toEqual([]);
  });

  it('artifacts differing only in the admission group compare sameAdmission: false with a named delta (invariant 8)', () => {
    const a = artifact({
      admission: { contextPolicy: { budget: 8000 }, runMetadata: { caller: 'spec' } },
    });
    const b = artifact({
      admission: { contextPolicy: { budget: 16_000 }, runMetadata: { caller: 'spec' } },
    });
    const cmp = compareRunArtifacts(a, b);
    expect(cmp.sameAdmission).toBe(false);
    expect(cmp.admissionDelta).toEqual(['contextPolicy']);
    // Everything else is untouched — the delta is admission-only and NAMED.
    expect(cmp.sameInput).toBe(true);
    expect(cmp.sameGrounding).toBe(true);
    expect(cmp.sameBackend).toBe(true);
    expect(cmp.sameOutput).toBe(true);
  });

  it('admission-group presence vs absence names every present member in the delta', () => {
    const withGroup = artifact({
      admission: {
        outputContract: { citationsRequired: true },
        runMetadata: { caller: 'spec' },
      },
    });
    const cmp = compareRunArtifacts(withGroup, artifact());
    expect(cmp.sameAdmission).toBe(false);
    expect(cmp.admissionDelta).toEqual(expect.arrayContaining(['outputContract', 'runMetadata']));
    expect(cmp.admissionDelta).not.toContain('contextPolicy');
  });

  it('identical admission groups compare sameAdmission: true', () => {
    const admission = {
      outputContract: { citationsRequired: true, verifyFallback: false },
      contextPolicy: { budget: 4096 },
    };
    const cmp = compareRunArtifacts(artifact({ admission }), artifact({ admission }));
    expect(cmp.sameAdmission).toBe(true);
    expect(cmp.admissionDelta).toEqual([]);
  });
});

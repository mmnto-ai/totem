import { describe, expect, it } from 'vitest';

import type { RunArtifact } from './schema.js';
import { RUN_ARTIFACT_SCHEMA_VERSION, RunArtifactSchema } from './schema.js';

/** A minimal valid artifact for mutation in each case. */
function validArtifact(): RunArtifact {
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
  };
}

describe('RunArtifactSchema', () => {
  it('accepts a minimal valid 1.0.0 artifact', () => {
    expect(RunArtifactSchema.parse(validArtifact())).toEqual(validArtifact());
  });

  it('accepts a future 1.x minor (corpus survives minor bumps — F1)', () => {
    const future = { ...validArtifact(), schemaVersion: '1.4.2' };
    expect(RunArtifactSchema.parse(future).schemaVersion).toBe('1.4.2');
  });

  it('rejects an unknown major, naming the version in the error', () => {
    const v2 = { ...validArtifact(), schemaVersion: '2.0.0' };
    const result = RunArtifactSchema.safeParse(v2);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join('\n')).toContain('2.0.0');
    }
  });

  it('rejects a missing required field (maskedPrompt)', () => {
    const artifact = validArtifact();
    const { maskedPrompt: _dropped, ...bundleWithout } = artifact.inputBundle;
    expect(RunArtifactSchema.safeParse({ ...artifact, inputBundle: bundleWithout }).success).toBe(
      false,
    );
  });

  it('rejects an unknown admissionClass', () => {
    const artifact = validArtifact();
    const broken = {
      ...artifact,
      backend: { ...artifact.backend, admissionClass: 'agentic_swarm' },
    };
    expect(RunArtifactSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts null token metrics (provider did not report)', () => {
    const artifact = validArtifact();
    artifact.output.metrics.inputTokens = null;
    artifact.output.metrics.outputTokens = null;
    expect(RunArtifactSchema.safeParse(artifact).success).toBe(true);
  });
});

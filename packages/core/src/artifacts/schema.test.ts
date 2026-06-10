import { describe, expect, it } from 'vitest';

import type { BackendAdmissionClass, RunArtifact } from './schema.js';
import {
  ADMISSION_COMPLETION_ONLY,
  ADMISSION_SELF_GROUNDING_AGENT,
  ContextPolicySchema,
  OutputContractSchema,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RunArtifactSchema,
  RunMetadataSchema,
} from './schema.js';

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

// ─── Admission contract (mmnto-ai/totem#2102, strategy#474 slice 3) ──

describe('admission contract schemas (#2102)', () => {
  it('exports both admission-class constants matching the BackendSchema enum', () => {
    expect(ADMISSION_COMPLETION_ONLY).toBe('completion_only');
    expect(ADMISSION_SELF_GROUNDING_AGENT).toBe('self_grounding_agent');
    // Compile-time lock: BackendAdmissionClass is inferred from the enum, so
    // both constants must be assignable to it.
    const classes: BackendAdmissionClass[] = [
      ADMISSION_COMPLETION_ONLY,
      ADMISSION_SELF_GROUNDING_AGENT,
    ];
    expect(classes).toHaveLength(2);
  });

  it('accepts self_grounding_agent as a backend admissionClass', () => {
    const artifact = validArtifact();
    artifact.backend.admissionClass = ADMISSION_SELF_GROUNDING_AGENT;
    expect(RunArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it('a slice-1 artifact (no admission group) still parses (invariant 6 — additive 1.x)', () => {
    const parsed = RunArtifactSchema.parse(validArtifact());
    expect(parsed.admission).toBeUndefined();
  });

  it('accepts a fully hydrated top-level admission group and roundtrips it verbatim', () => {
    const artifact: RunArtifact = {
      ...validArtifact(),
      admission: {
        outputContract: {
          citationsRequired: true,
          verifyFallback: true,
          schema: { type: 'object', properties: { verdict: { type: 'string' } } },
        },
        contextPolicy: { budget: 32_000 },
        runMetadata: { caller: 'spec', command: 'spec' },
      },
    };
    expect(RunArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it('the admission group lives at the top level, never inside inputBundle (inputHash identity)', () => {
    const artifact = validArtifact();
    const polluted = {
      ...artifact,
      inputBundle: { ...artifact.inputBundle, admission: { contextPolicy: { budget: 1 } } },
    };
    // Zod strips unknown keys: the polluted member never lands in the bundle.
    const parsed = RunArtifactSchema.parse(polluted);
    expect(parsed.inputBundle).toEqual(artifact.inputBundle);
  });

  it('ContextPolicy budget must be a positive integer (input tokens — declared ≠ nonsense)', () => {
    expect(ContextPolicySchema.safeParse({ budget: 8000 }).success).toBe(true);
    expect(ContextPolicySchema.safeParse({}).success).toBe(true);
    expect(ContextPolicySchema.safeParse({ budget: 0 }).success).toBe(false);
    expect(ContextPolicySchema.safeParse({ budget: -100 }).success).toBe(false);
    expect(ContextPolicySchema.safeParse({ budget: 1.5 }).success).toBe(false);
  });

  it('rejects an artifact whose admission carries an invalid budget', () => {
    const broken = {
      ...validArtifact(),
      admission: { contextPolicy: { budget: -1 } },
    };
    expect(RunArtifactSchema.safeParse(broken).success).toBe(false);
  });

  it('OutputContract is a closed object — unknown keys are stripped, never key soup', () => {
    const parsed = OutputContractSchema.parse({
      citationsRequired: false,
      arbitraryExtension: 'smuggled',
    });
    expect(parsed).toEqual({ citationsRequired: false });
  });

  it('RunMetadata rejects empty caller/command strings', () => {
    expect(RunMetadataSchema.safeParse({ caller: 'spec' }).success).toBe(true);
    expect(RunMetadataSchema.safeParse({ caller: '' }).success).toBe(false);
    expect(RunMetadataSchema.safeParse({ command: '' }).success).toBe(false);
  });
});

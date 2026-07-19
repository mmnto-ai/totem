import { describe, expect, it } from 'vitest';

import type {
  BackendAdmissionClass,
  BoundedTextEvidence,
  InvocationFailureArtifact,
  InvokeAttemptEvidence,
  RunArtifact,
} from './schema.js';
import {
  ADMISSION_COMPLETION_ONLY,
  ADMISSION_SELF_GROUNDING_AGENT,
  ContextPolicySchema,
  INVOCATION_FAILURE_ARTIFACT_SCHEMA_VERSION,
  InvocationFailureArtifactSchema,
  INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES,
  InvokeAttemptEvidenceSchema,
  InvokeProcessEvidenceSchema,
  OutputContractSchema,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RunArtifactSchema,
  RunMetadataSchema,
} from './schema.js';

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

function attempt(overrides: Partial<InvokeAttemptEvidence> = {}): InvokeAttemptEvidence {
  return {
    sequence: 1,
    route: 'configured-shell',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'failed',
    durationMs: 900,
    failureKind: 'process-exit',
    process: {
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: textEvidence('partial stdout'),
      stderr: textEvidence('provider rejected request'),
    },
    ...overrides,
  };
}

function failureArtifact(): InvocationFailureArtifact {
  return {
    schemaVersion: INVOCATION_FAILURE_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'prompt after DLP' },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only' },
    requestedBackend: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      qualifiedModel: 'anthropic:claude-sonnet-5',
      admissionClass: 'completion_only',
      taskProfile: 'Review',
    },
    attempts: [attempt()],
    terminal: {
      kind: 'process-exit',
      attempt: 1,
      message: textEvidence('Claude CLI exited with code 1', INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES),
    },
    createdAt: '2026-07-19T12:00:00.000Z',
  };
}

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
  it.each(['1.0.0', '1.1.0'])('accepts a historical %s artifact unchanged', (schemaVersion) => {
    const historical = { ...validArtifact(), schemaVersion };
    expect(RunArtifactSchema.parse(historical)).toEqual(historical);
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

  it('roundtrips additive 1.2.0 fallback execution evidence', () => {
    const artifact = validArtifact();
    artifact.output.execution = {
      attempts: [
        attempt({
          route: 'sdk',
          process: undefined,
          failureKind: 'auth',
        }),
        attempt({
          sequence: 2,
          route: 'cli-fallback',
          status: 'succeeded',
          failureKind: undefined,
          durationMs: 1_200,
          process: {
            exitCode: 0,
            signal: null,
            timedOut: false,
            stdout: textEvidence('valid response'),
            stderr: textEvidence(''),
          },
        }),
      ],
    };

    expect(RunArtifactSchema.parse(artifact)).toEqual(artifact);
  });
});

describe('invocation evidence schemas (#2452 slice B)', () => {
  it('roundtrips a terminal failure artifact and cannot parse it as a successful run', () => {
    const failure = failureArtifact();
    expect(InvocationFailureArtifactSchema.parse(failure)).toEqual(failure);
    expect(RunArtifactSchema.safeParse(failure).success).toBe(false);
  });

  it('requires ordered attempts and terminal agreement with the final failed attempt', () => {
    const failure = failureArtifact();
    failure.attempts[0] = attempt({ sequence: 2 });
    expect(InvocationFailureArtifactSchema.safeParse(failure).success).toBe(false);

    const mismatched = failureArtifact();
    mismatched.terminal.kind = 'timeout';
    expect(InvocationFailureArtifactSchema.safeParse(mismatched).success).toBe(false);
  });

  it('requires failed attempts to carry a kind and successful attempts not to', () => {
    expect(InvokeAttemptEvidenceSchema.safeParse(attempt({ failureKind: undefined })).success).toBe(
      false,
    );
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ status: 'succeeded', failureKind: 'unknown' }),
      ).success,
    ).toBe(false);
  });

  it('accepts only bounded machine-token provider codes', () => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(attempt({ providerCode: 'rate_limit:429' })).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(attempt({ providerCode: `secret ${'x'.repeat(200)}` }))
        .success,
    ).toBe(false);
  });

  it('requires timeoutMs if and only if process timedOut is true', () => {
    expect(
      InvokeProcessEvidenceSchema.safeParse({
        exitCode: null,
        signal: null,
        timedOut: false,
      }).success,
    ).toBe(true);
    expect(
      InvokeProcessEvidenceSchema.safeParse({
        exitCode: null,
        signal: null,
        timedOut: true,
        timeoutMs: 180_000,
      }).success,
    ).toBe(true);
    expect(
      InvokeProcessEvidenceSchema.safeParse({
        exitCode: null,
        signal: null,
        timedOut: true,
      }).success,
    ).toBe(false);
    expect(
      InvokeProcessEvidenceSchema.safeParse({
        exitCode: null,
        signal: null,
        timedOut: false,
        timeoutMs: 180_000,
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      label: 'timeout',
      process: { exitCode: null, signal: null, timedOut: true, timeoutMs: 180_000 },
    },
    {
      label: 'signal',
      process: { exitCode: null, signal: 'SIGTERM', timedOut: false },
    },
    {
      label: 'nonzero exit',
      process: { exitCode: 1, signal: null, timedOut: false },
    },
  ])('rejects a succeeded attempt that reports $label', ({ process }) => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ status: 'succeeded', failureKind: undefined, process }),
      ).success,
    ).toBe(false);
  });

  it('accepts coherent SDK and configured-shell success facts', () => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          route: 'sdk',
          status: 'succeeded',
          failureKind: undefined,
          process: undefined,
        }),
      ).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          status: 'succeeded',
          failureKind: undefined,
          process: { exitCode: 0, signal: null, timedOut: false },
        }),
      ).success,
    ).toBe(true);
  });

  it('requires timeout failure kind and process timeout facts to agree in both directions', () => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'timeout',
          process: { exitCode: null, signal: null, timedOut: true, timeoutMs: 180_000 },
        }),
      ).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(attempt({ failureKind: 'timeout', process: undefined }))
        .success,
    ).toBe(false);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'timeout',
          process: { exitCode: null, signal: null, timedOut: false },
        }),
      ).success,
    ).toBe(false);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'quota',
          process: { exitCode: null, signal: null, timedOut: true, timeoutMs: 180_000 },
        }),
      ).success,
    ).toBe(false);
  });

  it('requires process-exit failures to record an abnormal exit or signal', () => {
    expect(InvokeAttemptEvidenceSchema.safeParse(attempt()).success).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ process: { exitCode: null, signal: 'SIGTERM', timedOut: false } }),
      ).success,
    ).toBe(true);
    expect(InvokeAttemptEvidenceSchema.safeParse(attempt({ process: undefined })).success).toBe(
      false,
    );
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ process: { exitCode: 0, signal: null, timedOut: false } }),
      ).success,
    ).toBe(false);
  });

  it('allows pre-spawn evidence without a process, but rejects impossible spawn completion facts', () => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ route: 'cli-fallback', failureKind: 'process-spawn', process: undefined }),
      ).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ route: 'sdk', failureKind: 'process-spawn', process: undefined }),
      ).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'process-spawn',
          process: { exitCode: null, signal: null, timedOut: false },
        }),
      ).success,
    ).toBe(true);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'process-spawn',
          process: { exitCode: 1, signal: null, timedOut: false },
        }),
      ).success,
    ).toBe(false);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({
          failureKind: 'process-spawn',
          process: { exitCode: null, signal: 'SIGTERM', timedOut: false },
        }),
      ).success,
    ).toBe(false);
  });

  it('keeps process evidence consistent with sdk and configured-shell routes', () => {
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ route: 'sdk', failureKind: 'auth', process: undefined }),
      ).success,
    ).toBe(true);
    expect(InvokeAttemptEvidenceSchema.safeParse(attempt({ route: 'sdk' })).success).toBe(false);
    expect(
      InvokeAttemptEvidenceSchema.safeParse(
        attempt({ route: 'configured-shell', failureKind: 'auth', process: undefined }),
      ).success,
    ).toBe(false);
  });

  it('rejects byte-accounting drift and any text retained after a DLP mask failure', () => {
    const badCount = failureArtifact();
    badCount.terminal.message.retainedBytes += 1;
    expect(InvocationFailureArtifactSchema.safeParse(badCount).success).toBe(false);

    const dlpFailure = failureArtifact();
    dlpFailure.terminal.message = {
      encoding: 'utf-8',
      head: 'must not persist',
      observedBytes: 16,
      retainedBytes: 16,
      limitBytes: INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES,
      truncated: false,
      dlp: 'omitted-on-mask-failure',
    };
    expect(InvocationFailureArtifactSchema.safeParse(dlpFailure).success).toBe(false);
  });

  it('allows DLP replacement to change retained byte length independently of raw observation', () => {
    const expanded = textEvidence('[MASKED:LONGER-THAN-RAW]', INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES);
    expanded.observedBytes = 3;
    expect(
      InvocationFailureArtifactSchema.safeParse({
        ...failureArtifact(),
        terminal: { ...failureArtifact().terminal, message: expanded },
      }).success,
    ).toBe(true);

    const shortened = textEvidence('[MASKED]', INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES);
    shortened.observedBytes = 10_000;
    shortened.truncated = false;
    expect(
      InvocationFailureArtifactSchema.safeParse({
        ...failureArtifact(),
        terminal: { ...failureArtifact().terminal, message: shortened },
      }).success,
    ).toBe(true);
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

  it('RunMetadata accepts an optional codeBlind flag (mmnto-ai/totem#2106)', () => {
    expect(RunMetadataSchema.safeParse({ caller: 'spec', codeBlind: true }).success).toBe(true);
    expect(RunMetadataSchema.safeParse({ caller: 'review', codeBlind: false }).success).toBe(true);
    // Optional: absent stays undefined, not defaulted.
    expect(RunMetadataSchema.parse({ caller: 'spec' }).codeBlind).toBeUndefined();
    // Wrong type is rejected.
    expect(RunMetadataSchema.safeParse({ caller: 'spec', codeBlind: 'yes' }).success).toBe(false);
  });
});

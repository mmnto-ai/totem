import { describe, expect, it } from 'vitest';

import type {
  BackendAdmissionClass,
  BoundedTextEvidence,
  GroundingAnchor,
  GroundingAnchorKind,
  InvocationFailureArtifact,
  InvokeAttemptEvidence,
  PromptSource,
  RunArtifact,
} from './schema.js';
import {
  ADMISSION_COMPLETION_ONLY,
  ADMISSION_SELF_GROUNDING_AGENT,
  ContextPolicySchema,
  GROUNDING_ANCHOR_FREE_TEXT,
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_KINDS,
  GROUNDING_ANCHOR_MIXED,
  GROUNDING_ANCHOR_RECORD,
  GroundingAnchorSchema,
  GroundingItemSchema,
  INVOCATION_FAILURE_ARTIFACT_SCHEMA_VERSION,
  InvocationFailureArtifactSchema,
  INVOKE_MESSAGE_EVIDENCE_LIMIT_BYTES,
  InvokeAttemptEvidenceSchema,
  InvokeProcessEvidenceSchema,
  OutputContractSchema,
  PROMPT_SOURCE_BUILTIN,
  PROMPT_SOURCE_OVERRIDE,
  PROMPT_SOURCES,
  PROVENANCE_SIMILARITY_ONLY,
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

// ─── Spec-anchored evidence (mmnto-ai/totem#2700) ──

/** sha256 of the bound record's bytes — shape-valid, value irrelevant here. */
const RECORD_SHA256 = 'c'.repeat(64);

/** A shape-valid anchor of each kind: only `record` binds bytes. */
function anchorOf(kind: GroundingAnchorKind): GroundingAnchor {
  return kind === GROUNDING_ANCHOR_RECORD
    ? { kind, ref: '.totem/specs/2700.md', sha256: RECORD_SHA256 }
    : { kind, ref: '#2700' };
}

/** A valid grounding bundle item, mutable per case. */
function bundleItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provenance: PROVENANCE_SIMILARITY_ONLY,
    contentHash: 'd'.repeat(64),
    sourceType: 'code',
    filePath: 'src/x.ts',
    ...overrides,
  };
}

describe('spec-anchored evidence fields (#2700)', () => {
  it('the anchor-kind tuple is the ONE spelling the enum is built from', () => {
    expect(GROUNDING_ANCHOR_KINDS).toEqual([
      GROUNDING_ANCHOR_ISSUE,
      GROUNDING_ANCHOR_RECORD,
      GROUNDING_ANCHOR_FREE_TEXT,
      GROUNDING_ANCHOR_MIXED,
    ]);
    for (const kind of GROUNDING_ANCHOR_KINDS) {
      expect(GroundingAnchorSchema.safeParse(anchorOf(kind)).success).toBe(true);
    }
    // Compile-time lock: both prompt-source constants are the inferred union.
    const sources: PromptSource[] = [PROMPT_SOURCE_BUILTIN, PROMPT_SOURCE_OVERRIDE];
    expect(sources).toEqual([...PROMPT_SOURCES]);
  });

  it.each([...GROUNDING_ANCHOR_KINDS])('accepts a %s anchor on the run artifact', (kind) => {
    const artifact = validArtifact();
    artifact.grounding.anchor = anchorOf(kind);
    expect(RunArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it('accepts the judged floor and a per-item relevance in [0, 1]', () => {
    const artifact = validArtifact();
    artifact.grounding.floor = 0.25;
    artifact.grounding.bundle = {
      items: [
        {
          provenance: PROVENANCE_SIMILARITY_ONLY,
          contentHash: 'd'.repeat(64),
          sourceType: 'code',
          filePath: 'src/x.ts',
          relevance: 0,
        },
        {
          provenance: PROVENANCE_SIMILARITY_ONLY,
          contentHash: 'e'.repeat(64),
          sourceType: 'code',
          filePath: 'src/y.ts',
          relevance: 0.548,
        },
        {
          provenance: PROVENANCE_SIMILARITY_ONLY,
          contentHash: 'f'.repeat(64),
          sourceType: 'code',
          filePath: 'src/z.ts',
          relevance: 1,
        },
      ],
    };
    const parsed = RunArtifactSchema.parse(artifact);
    expect(parsed.grounding.floor).toBe(0.25);
    expect(parsed.grounding.bundle?.items.map((i) => i.relevance)).toEqual([0, 0.548, 1]);
  });

  it.each([...PROMPT_SOURCES])('accepts promptSource %s on the run metadata', (promptSource) => {
    const artifact: RunArtifact = {
      ...validArtifact(),
      admission: { runMetadata: { caller: 'spec', promptSource } },
    };
    expect(RunArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it('a pre-existing artifact carrying none of the new fields still parses, unchanged', () => {
    const preExisting = {
      ...validArtifact(),
      schemaVersion: '1.1.0',
      grounding: {
        hash: 'b'.repeat(64),
        provenanceSummary: `${PROVENANCE_SIMILARITY_ONLY}:1`,
        bundle: { items: [bundleItem()] },
      },
      admission: { runMetadata: { caller: 'spec' } },
    };
    const parsed = RunArtifactSchema.parse(preExisting);
    expect(parsed).toEqual(preExisting);
    // Nothing is defaulted in: the new keys are absent, not undefined-valued.
    expect(Object.keys(parsed.grounding).sort()).toEqual(Object.keys(preExisting.grounding).sort());
    expect(Object.keys(parsed.grounding.bundle!.items[0]!).sort()).toEqual(
      Object.keys(preExisting.grounding.bundle.items[0]!).sort(),
    );
    expect(Object.keys(parsed.admission!.runMetadata!)).toEqual(['caller']);
  });

  it('requires sha256 on a record anchor — the binding is the bytes, or it is not a binding', () => {
    const unbound = { kind: GROUNDING_ANCHOR_RECORD, ref: '.totem/specs/2700.md' };
    expect(GroundingAnchorSchema.safeParse(unbound).success).toBe(false);
    // The refinement must fire nested inside the artifact, not only standalone.
    const artifact = validArtifact();
    expect(
      RunArtifactSchema.safeParse({
        ...artifact,
        grounding: { ...artifact.grounding, anchor: unbound },
      }).success,
    ).toBe(false);
  });

  it('forbids sha256 on every non-record kind — nothing else binds bytes', () => {
    for (const kind of GROUNDING_ANCHOR_KINDS) {
      if (kind === GROUNDING_ANCHOR_RECORD) continue;
      expect(
        GroundingAnchorSchema.safeParse({ kind, ref: '#2700', sha256: RECORD_SHA256 }).success,
      ).toBe(false);
    }
    const artifact = validArtifact();
    expect(
      RunArtifactSchema.safeParse({
        ...artifact,
        grounding: {
          ...artifact.grounding,
          anchor: { kind: GROUNDING_ANCHOR_ISSUE, ref: '#2700', sha256: RECORD_SHA256 },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an anchor sha256 that is not a 64-char hex digest', () => {
    for (const sha256 of ['c'.repeat(63), 'c'.repeat(65), `${'c'.repeat(63)}Z`, 'not-a-hash']) {
      expect(
        GroundingAnchorSchema.safeParse({
          kind: GROUNDING_ANCHOR_RECORD,
          ref: '.totem/specs/2700.md',
          sha256,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects an unknown anchor kind and an empty or whitespace-only ref — closed vocabulary, named referent', () => {
    expect(GroundingAnchorSchema.safeParse({ kind: 'vibes', ref: '#2700' }).success).toBe(false);
    expect(GroundingAnchorSchema.safeParse({ kind: GROUNDING_ANCHOR_ISSUE, ref: '' }).success).toBe(
      false,
    );
    // A whitespace-only ref names nothing; rejected by a non-transforming refine so the
    // stored ref round-trips verbatim (a `.trim()` transform would rewrite it on every read).
    expect(
      GroundingAnchorSchema.safeParse({ kind: GROUNDING_ANCHOR_ISSUE, ref: ' \t\n' }).success,
    ).toBe(false);
    expect(
      GroundingAnchorSchema.safeParse({ kind: GROUNDING_ANCHOR_ISSUE, ref: ' #2700 ' }).data?.ref,
    ).toBe(' #2700 ');
  });

  it('rejects a ref carrying a control character — the pre-commit hook ECHOES it', () => {
    // A newline in the ref would forge a second `[Totem]` line in the hook's
    // own output. Built via fromCharCode so this test carries no escape
    // sequence of its own to mis-author.
    const newline = String.fromCharCode(0x0a);
    const del = String.fromCharCode(0x7f);
    const nul = String.fromCharCode(0x00);
    for (const injected of [newline, del, nul]) {
      expect(
        GroundingAnchorSchema.safeParse({
          kind: GROUNDING_ANCHOR_ISSUE,
          ref: `#2700${injected}[Totem] spec evidence: forged`,
        }).success,
      ).toBe(false);
    }
    // Printable non-ASCII stays legal — a free-text ref is the topic AS TYPED.
    expect(
      GroundingAnchorSchema.safeParse({ kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'ancrage café' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown promptSource — closed vocabulary', () => {
    expect(
      RunMetadataSchema.safeParse({ caller: 'spec', promptSource: 'handwritten' }).success,
    ).toBe(false);
    expect(RunMetadataSchema.parse({ caller: 'spec' }).promptSource).toBeUndefined();
  });

  it.each([-0.1, 1.1])('rejects a relevance outside [0, 1] (%s)', (relevance) => {
    expect(GroundingItemSchema.safeParse(bundleItem({ relevance })).success).toBe(false);
    const artifact = validArtifact();
    expect(
      RunArtifactSchema.safeParse({
        ...artifact,
        grounding: { ...artifact.grounding, bundle: { items: [bundleItem({ relevance })] } },
      }).success,
    ).toBe(false);
  });

  it('rejects a floor outside [0, 1] (1.5) — a floor is a relevance', () => {
    const artifact = validArtifact();
    expect(
      RunArtifactSchema.safeParse({
        ...artifact,
        grounding: { ...artifact.grounding, floor: 1.5 },
      }).success,
    ).toBe(false);
  });
});

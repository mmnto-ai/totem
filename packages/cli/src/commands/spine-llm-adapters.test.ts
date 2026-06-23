import { afterEach, describe, expect, it, vi } from 'vitest';

// Type-only from the barrel (erased). The canonical `wrapUntrustedXml` VALUE is
// imported below for the parity test — tests are off the CLI-startup path, so a
// barrel value import here is fine (unlike the production module).
import type { ExtractStageResult, ReviewThread, ReviewThreadContent } from '@mmnto/totem';
import { wrapUntrustedXml } from '@mmnto/totem';

import type { InvokeOrchestrator } from '../orchestrators/orchestrator.js';
import {
  assertLiveLlmAllowed,
  assertPipelineProductive,
  buildClassifyUserPrompt,
  buildExtractUserPrompt,
  buildReplayProvenance,
  LiveDraftClassifier,
  LiveDraftExtractor,
  LiveLlmInCiError,
  LlmAdapterConfigError,
  MINER_CLASSIFY_SYSTEM_PROMPT,
  MINER_EXTRACT_SYSTEM_PROMPT,
  parseClassifierOutput,
  parseExtractorOutput,
  SystemicPipelineError,
  verifyLlmAdapterConfig,
  wrapUntrusted,
} from './spine-llm-adapters.js';
import {
  ClassifierResultLocalSchema,
  computeArtifactHash,
  RecordingDraftClassifier,
  RecordingDraftExtractor,
  ReplayArtifactSchema,
  ReplayDraftClassifier,
  ReplayDraftExtractor,
  ReplayProvenanceSchema,
  ReplayRecordSink,
} from './spine-llm-replay.js';

type DraftCandidate = ExtractStageResult['drafts'][number];

const MERGE_SHA = 'a'.repeat(40);

// ─── Stub LLM seam (deterministic; NO network, NO real LLM) ──────────────────

function stubInvoke(content: string): InvokeOrchestrator {
  return () => Promise.resolve({ content, inputTokens: null, outputTokens: null, durationMs: 0 });
}

/** A seam that throws — models a dead provider / network failure on every call. */
function throwingInvoke(): InvokeOrchestrator {
  return () => Promise.reject(new Error('boom: provider unreachable'));
}

/** A seam whose output depends on the prompt — lets one stub serve many inputs. */
function routedInvoke(route: (prompt: string) => string): InvokeOrchestrator {
  return (opts) =>
    Promise.resolve({
      content: route(opts.prompt),
      inputTokens: null,
      outputTokens: null,
      durationMs: 0,
    });
}

// Construct live adapters with a NON-CI env by default so the fold-H guard does
// not trip when this very suite runs under CI.
const NO_CI: NodeJS.ProcessEnv = {};

function makeExtractor(
  invoke: InvokeOrchestrator,
  env: NodeJS.ProcessEnv = NO_CI,
): LiveDraftExtractor {
  return new LiveDraftExtractor({
    invoke,
    model: 'test-model',
    cwd: '/tmp',
    totemDir: '.totem',
    provider: 'anthropic',
    credentialPresent: true,
    env,
  });
}
function makeClassifier(
  invoke: InvokeOrchestrator,
  env: NodeJS.ProcessEnv = NO_CI,
): LiveDraftClassifier {
  return new LiveDraftClassifier({
    invoke,
    model: 'test-model',
    cwd: '/tmp',
    totemDir: '.totem',
    provider: 'anthropic',
    credentialPresent: true,
    env,
  });
}

function content(opts?: { pr?: number; threads?: ReviewThread[] }): ReviewThreadContent {
  return {
    pr: opts?.pr ?? 100,
    mergeCommitSha: MERGE_SHA,
    threads: opts?.threads ?? [
      {
        path: 'a.ts',
        isResolved: false,
        isOutdated: false,
        comments: [{ author: 'jane', body: 'no exec' }],
      },
    ],
  };
}

function draft(dslSource = '**Pattern:** no-foo'): DraftCandidate {
  return {
    provenance: { mergedPr: 100, reviewThread: 'pulls/100/comments', commitSha: MERGE_SHA },
    dslSource,
  };
}

// ─── 1. Extractor output parse ────────────────────────

describe('parseExtractorOutput → DraftResult (NoDraftCause taxonomy)', () => {
  it('parses a JSON array of DSL bodies (drafts, no cause)', () => {
    expect(parseExtractorOutput('["**Pattern:** a", "**Pattern:** b"]')).toEqual({
      drafts: ['**Pattern:** a', '**Pattern:** b'],
    });
  });

  it('strips a markdown code fence and parses the inner JSON', () => {
    expect(parseExtractorOutput('```json\n["**Pattern:** x"]\n```')).toEqual({
      drafts: ['**Pattern:** x'],
    });
  });

  it('filters non-string / empty / whitespace elements and trims (≥1 survivor → no cause)', () => {
    // A filtered-out sibling element does NOT tag the result — the cause is a
    // no-draft diagnostic, not a partial-quality ledger (codex).
    expect(parseExtractorOutput('["**Pattern:** a", 7, "", "   ", "  **Pattern:** b  "]')).toEqual({
      drafts: ['**Pattern:** a', '**Pattern:** b'],
    });
  });

  // One branch per NoDraftCause — the pinned-order, mutually-exclusive partition
  // (codex/agy panel; the order is the disjointness contract).
  it('empty raw output → empty-output', () => {
    expect(parseExtractorOutput('')).toEqual({ drafts: [], noDraftCause: 'empty-output' });
    expect(parseExtractorOutput('   ')).toEqual({ drafts: [], noDraftCause: 'empty-output' });
  });

  it('the NONE sentinel (any case) → none-sentinel', () => {
    expect(parseExtractorOutput('NONE')).toEqual({ drafts: [], noDraftCause: 'none-sentinel' });
    expect(parseExtractorOutput('  none  ')).toEqual({ drafts: [], noDraftCause: 'none-sentinel' });
  });

  it('malformed JSON (SyntaxError) → unparseable-shape (fail-soft, never throws)', () => {
    expect(parseExtractorOutput('here are some lessons:')).toEqual({
      drafts: [],
      noDraftCause: 'unparseable-shape',
    });
    expect(parseExtractorOutput('[unterminated')).toEqual({
      drafts: [],
      noDraftCause: 'unparseable-shape',
    });
  });

  it('valid JSON but not an array → non-array', () => {
    expect(parseExtractorOutput('{"disposition":"structural"}')).toEqual({
      drafts: [],
      noDraftCause: 'non-array',
    });
    expect(parseExtractorOutput('42')).toEqual({ drafts: [], noDraftCause: 'non-array' });
  });

  it('an array that filters to empty → all-filtered (NOT empty-output — panel adjudication)', () => {
    // [""] / arrays-of-blanks parse to an array then filter to [] → all-filtered;
    // empty-output is reserved for raw-text-empty BEFORE the parse (codex; corrects
    // the agy panel-reply expectation).
    expect(parseExtractorOutput('[]')).toEqual({ drafts: [], noDraftCause: 'all-filtered' });
    expect(parseExtractorOutput('[""]')).toEqual({ drafts: [], noDraftCause: 'all-filtered' });
    expect(parseExtractorOutput('["   ", 7]')).toEqual({
      drafts: [],
      noDraftCause: 'all-filtered',
    });
  });
});

describe('legacy-unknown is replay-migration-only (never emitted by the live path)', () => {
  // greptile #2240: the "REPLAY-MIGRATION ONLY" invariant on `legacy-unknown` is
  // doc-only at the shared runExtractStage boundary (which MUST accept it, since the
  // ReplayDraftExtractor legitimately produces it for a legacy bare-string[] row).
  // Lock the invariant where it IS enforceable — the LIVE parse/adapter, which mint
  // it nowhere by construction.
  it('parseExtractorOutput never returns legacy-unknown for any input class', () => {
    const inputs = [
      '',
      '   ',
      'NONE',
      'prose not json',
      '[unterminated',
      '{"disposition":"structural"}',
      '42',
      '[]',
      '[""]',
      '["**Pattern:** a"]',
    ];
    for (const raw of inputs) {
      expect(parseExtractorOutput(raw).noDraftCause).not.toBe('legacy-unknown');
    }
  });

  it('LiveDraftExtractor never tags legacy-unknown (invoke-error / decline / drafted)', async () => {
    for (const inv of [throwingInvoke(), stubInvoke('NONE'), stubInvoke('["**Pattern:** a"]')]) {
      const ext = makeExtractor(inv);
      expect((await ext.draft(content())).noDraftCause).not.toBe('legacy-unknown');
    }
  });
});

// ─── 2. Classifier output parse (fold G — closed set) ─

describe('parseClassifierOutput (fold G)', () => {
  it('returns classified for a single unambiguous structural/behavioral label', () => {
    expect(parseClassifierOutput('{"disposition":"structural"}')).toEqual({
      disposition: 'structural',
      dispositionSource: 'classified',
    });
    expect(parseClassifierOutput('```json\n{"disposition":"behavioral"}\n```')).toEqual({
      disposition: 'behavioral',
      dispositionSource: 'classified',
    });
  });

  it('safe-defaults on refusal / invalid JSON / prose', () => {
    expect(parseClassifierOutput('I cannot classify this.')).toEqual({
      disposition: 'behavioral',
      dispositionSource: 'error-default',
    });
    expect(parseClassifierOutput('')).toEqual({
      disposition: 'behavioral',
      dispositionSource: 'error-default',
    });
  });

  it('safe-defaults on missing / out-of-set / wrong-typed / multi-valued label', () => {
    const sd = { disposition: 'behavioral', dispositionSource: 'error-default' };
    expect(parseClassifierOutput('{"foo":"bar"}')).toEqual(sd); // missing label
    expect(parseClassifierOutput('{"disposition":"maybe"}')).toEqual(sd); // out of set
    expect(parseClassifierOutput('{"disposition":["structural","behavioral"]}')).toEqual(sd); // multi
    expect(parseClassifierOutput('["structural"]')).toEqual(sd); // array, not object
    expect(parseClassifierOutput('null')).toEqual(sd);
  });

  it('never mints the illegal {structural, error-default} pair (the local schema rejects it)', () => {
    expect(() =>
      ClassifierResultLocalSchema.parse({
        disposition: 'structural',
        dispositionSource: 'error-default',
      }),
    ).toThrow();
  });
});

// ─── 2b. Fail-loud on UNEXPECTED parse errors (Tenet 4) ──────────────────────

describe('fail-loud on unexpected (non-SyntaxError) parse errors', () => {
  afterEach(() => vi.restoreAllMocks());

  it('parseExtractorOutput rethrows a non-SyntaxError (a real bug fails loud, not fail-soft)', () => {
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new TypeError('unexpected non-syntax failure');
    });
    expect(() => parseExtractorOutput('["**Pattern:** a"]')).toThrow(TypeError);
  });

  it('parseClassifierOutput rethrows a non-SyntaxError', () => {
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new TypeError('unexpected non-syntax failure');
    });
    expect(() => parseClassifierOutput('{"disposition":"structural"}')).toThrow(TypeError);
  });

  it('an unexpected parser error propagates out of draft (fail-loud on a bug; the per-PR catch covers the INVOKE only)', async () => {
    const ext = makeExtractor(stubInvoke('["**Pattern:** a"]'));
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw new TypeError('unexpected non-syntax failure');
    });
    await expect(ext.draft(content())).rejects.toThrow(TypeError);
    // the invoke SUCCEEDED — it is not miscounted as a dead-provider failure.
    expect(ext.succeeded).toBe(1);
  });
});

// ─── 3. Live extractor (stubbed seam) ─────────────────

describe('LiveDraftExtractor', () => {
  it('drafts parsed DSL bodies from the LLM and counts a success', async () => {
    const ext = makeExtractor(stubInvoke('["**Pattern:** no-exec"]'));
    await expect(ext.draft(content())).resolves.toEqual({ drafts: ['**Pattern:** no-exec'] });
    expect(ext.attempts).toBe(1);
    expect(ext.succeeded).toBe(1);
  });

  it('tags invoke-error and counts a failure when the live invoke throws (per-PR fail-soft)', async () => {
    const ext = makeExtractor(throwingInvoke());
    await expect(ext.draft(content())).resolves.toEqual({
      drafts: [],
      noDraftCause: 'invoke-error',
    });
    expect(ext.attempts).toBe(1);
    expect(ext.succeeded).toBe(0);
  });

  it('a successful-but-empty (NONE) call counts as succeeded + tags none-sentinel (sparsity ≠ failure)', async () => {
    const ext = makeExtractor(stubInvoke('NONE'));
    await expect(ext.draft(content())).resolves.toEqual({
      drafts: [],
      noDraftCause: 'none-sentinel',
    });
    // A genuine model decline is a SUCCESS (the invoke returned) — only invoke-error
    // increments the failure counter, so the dead-provider floor stays a true signal.
    expect(ext.succeeded).toBe(1);
  });

  it('isolates a per-item failure — other items still succeed, no throw', async () => {
    const ext = makeExtractor(
      routedInvoke((p) =>
        p.includes('666')
          ? (() => {
              throw new Error('x');
            })()
          : '["**Pattern:** ok"]',
      ),
    );
    await expect(ext.draft(content({ pr: 1 }))).resolves.toEqual({ drafts: ['**Pattern:** ok'] });
    await expect(ext.draft(content({ pr: 666 }))).resolves.toEqual({
      drafts: [],
      noDraftCause: 'invoke-error',
    });
    expect(ext.attempts).toBe(2);
    expect(ext.succeeded).toBe(1);
  });
});

// ─── 4. Live classifier (stubbed seam) ────────────────

describe('LiveDraftClassifier', () => {
  it('classifies from the LLM and counts a success', async () => {
    const clf = makeClassifier(stubInvoke('{"disposition":"structural"}'));
    await expect(clf.classify(draft())).resolves.toEqual({
      disposition: 'structural',
      dispositionSource: 'classified',
    });
    expect(clf.succeeded).toBe(1);
  });

  it('safe-defaults and counts a failure when the invoke throws', async () => {
    const clf = makeClassifier(throwingInvoke());
    await expect(clf.classify(draft())).resolves.toEqual({
      disposition: 'behavioral',
      dispositionSource: 'error-default',
    });
    expect(clf.attempts).toBe(1);
    expect(clf.succeeded).toBe(0);
  });
});

// ─── 5. Fold H — no live LLM in CI ────────────────────

describe('assertLiveLlmAllowed (fold H)', () => {
  it('throws under CI without the explicit override', () => {
    expect(() => assertLiveLlmAllowed({ CI: 'true' })).toThrow(LiveLlmInCiError);
  });
  it('allows CI with ALLOW_LIVE_LLM_IN_CI, and any non-CI env', () => {
    expect(() => assertLiveLlmAllowed({ CI: 'true', ALLOW_LIVE_LLM_IN_CI: '1' })).not.toThrow();
    expect(() => assertLiveLlmAllowed({})).not.toThrow();
  });
  it('a live adapter refuses to construct under CI (the guard runs at construction)', () => {
    expect(() => makeExtractor(stubInvoke('NONE'), { CI: 'true' })).toThrow(LiveLlmInCiError);
    expect(() => makeClassifier(stubInvoke('NONE'), { CI: 'true' })).toThrow(LiveLlmInCiError);
  });
});

// ─── 6. Fold C — construction-time config + end-of-run floor ──────────────────

describe('verifyLlmAdapterConfig (fold C, construction-time)', () => {
  const ok = { provider: 'anthropic', model: 'm', credentialPresent: true, systemPrompt: 'sp' };

  it('passes when all preconditions are present', () => {
    expect(() => verifyLlmAdapterConfig(ok)).not.toThrow();
  });

  it('throws naming every missing precondition (no live call)', () => {
    try {
      verifyLlmAdapterConfig({
        provider: '',
        model: '',
        credentialPresent: false,
        systemPrompt: '',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmAdapterConfigError);
      expect((err as LlmAdapterConfigError).problems).toHaveLength(4);
    }
  });

  it('throws on a missing credential alone (the dead-provider precursor)', () => {
    expect(() => verifyLlmAdapterConfig({ ...ok, credentialPresent: false })).toThrow(
      LlmAdapterConfigError,
    );
  });

  it('the live adapter constructor enforces the FULL check (greptile #2211) — credential-absent throws AT construction', () => {
    const deps = {
      invoke: stubInvoke('NONE'),
      model: 'm',
      cwd: '/tmp',
      totemDir: '.totem',
      provider: 'anthropic',
      credentialPresent: false,
      env: NO_CI,
    };
    expect(() => new LiveDraftExtractor(deps)).toThrow(LlmAdapterConfigError);
    expect(() => new LiveDraftClassifier(deps)).toThrow(LlmAdapterConfigError);
  });
});

describe('assertPipelineProductive (fold C, end-of-run floor)', () => {
  it('throws when ≥1 attempted and 0 succeeded (dead provider)', () => {
    expect(() => assertPipelineProductive({ attempted: 5, succeeded: 0 })).toThrow(
      SystemicPipelineError,
    );
  });
  it('does NOT throw on genuine sparsity (calls succeeded, just empty)', () => {
    expect(() => assertPipelineProductive({ attempted: 5, succeeded: 5 })).not.toThrow();
    expect(() => assertPipelineProductive({ attempted: 5, succeeded: 1 })).not.toThrow();
  });
  it('does NOT throw when nothing was attempted', () => {
    expect(() => assertPipelineProductive({ attempted: 0, succeeded: 0 })).not.toThrow();
  });

  it('integrates: an all-failing extractor trips the floor; an all-empty one does not', async () => {
    const dead = makeExtractor(throwingInvoke());
    for (const pr of [1, 2, 3]) await dead.draft(content({ pr }));
    expect(() =>
      assertPipelineProductive({ attempted: dead.attempts, succeeded: dead.succeeded }),
    ).toThrow(SystemicPipelineError);

    const sparse = makeExtractor(stubInvoke('NONE'));
    for (const pr of [1, 2, 3]) await sparse.draft(content({ pr }));
    expect(() =>
      assertPipelineProductive({ attempted: sparse.attempts, succeeded: sparse.succeeded }),
    ).not.toThrow();
  });
});

// ─── 7. Fold F — provenance + integrity coupling ──────

describe('buildReplayProvenance (fold F)', () => {
  const input = {
    extractSystemPrompt: MINER_EXTRACT_SYSTEM_PROMPT,
    classifySystemPrompt: MINER_CLASSIFY_SYSTEM_PROMPT,
    provider: 'anthropic',
    model: 'claude-x',
    temperature: 0,
    orchestratorVersion: 'orch-1',
    totemVersion: '1.69.0',
  };

  it('is deterministic and schema-valid', () => {
    const a = buildReplayProvenance(input);
    const b = buildReplayProvenance(input);
    expect(a).toEqual(b);
    expect(() => ReplayProvenanceSchema.parse(a)).not.toThrow();
    expect(a.provider).toBe('anthropic');
    expect(a.adapterKind).toBe('extractor+classifier');
  });

  it('a prompt edit flips both prompt hashes (forces a re-record)', () => {
    const base = buildReplayProvenance(input);
    const edited = buildReplayProvenance({
      ...input,
      extractSystemPrompt: MINER_EXTRACT_SYSTEM_PROMPT + ' edit',
    });
    expect(edited.promptTemplateHash).not.toBe(base.promptTemplateHash);
    expect(edited.systemPromptHash).not.toBe(base.systemPromptHash);
  });

  it('a provenance edit flips the whole-artifact integrity hash (fold F gate)', () => {
    const sink = new ReplayRecordSink();
    const base = computeArtifactHash(sink.freeze(buildReplayProvenance(input)));
    const edited = computeArtifactHash(
      sink.freeze(buildReplayProvenance({ ...input, model: 'claude-y' })),
    );
    expect(edited).not.toBe(base);
  });
});

// ─── 8. End-to-end: live adapter composes with the 5b-i record/replay scaffold ─

describe('live adapter ∘ 5b-i record/replay', () => {
  it('records a live draft then replays it byte-identically, zero further LLM calls', async () => {
    const sink = new ReplayRecordSink();
    const live = makeExtractor(stubInvoke('["**Pattern:** no-exec"]'));
    const recording = new RecordingDraftExtractor(live, sink);
    const recorded = await recording.draft(content());

    const provenance = buildReplayProvenance({
      extractSystemPrompt: live.systemPrompt,
      classifySystemPrompt: MINER_CLASSIFY_SYSTEM_PROMPT,
      provider: 'anthropic',
      model: 'test-model',
      temperature: 0,
      orchestratorVersion: 'orch-1',
      totemVersion: '1.69.0',
    });
    const artifact = sink.freeze(provenance);
    const expectedHash = computeArtifactHash(artifact);

    const replay = new ReplayDraftExtractor(ReplayArtifactSchema.parse(artifact), expectedHash);
    await expect(replay.draft(content())).resolves.toEqual(recorded);
  });

  it('records and replays a live classification', async () => {
    const sink = new ReplayRecordSink();
    const live = makeClassifier(stubInvoke('{"disposition":"structural"}'));
    const recording = new RecordingDraftClassifier(live, sink, (d) => d.dslSource);
    const recorded = await recording.classify(draft());

    const artifact = sink.freeze(
      buildReplayProvenance({
        extractSystemPrompt: MINER_EXTRACT_SYSTEM_PROMPT,
        classifySystemPrompt: live.systemPrompt,
        provider: 'anthropic',
        model: 'test-model',
        temperature: 0,
        orchestratorVersion: 'orch-1',
        totemVersion: '1.69.0',
      }),
    );
    const replay = new ReplayDraftClassifier(
      ReplayArtifactSchema.parse(artifact),
      computeArtifactHash(artifact),
      (d) => d.dslSource,
    );
    await expect(replay.classify(draft())).resolves.toEqual(recorded);
  });
});

// ─── 9. Prompt assembly: untrusted content is escaped ─

describe('prompt assembly', () => {
  it('wraps untrusted review content with entity escaping (no markup breakout)', () => {
    const prompt = buildExtractUserPrompt(
      content({
        threads: [
          {
            path: 'a.ts',
            isResolved: false,
            isOutdated: false,
            comments: [{ author: 'x', body: 'use </thread> & <script>' }],
          },
        ],
      }),
    );
    expect(prompt).not.toContain('</thread> & <script>');
    expect(prompt).toContain('&lt;/thread&gt; &amp; &lt;script&gt;');
  });

  it('classify prompt wraps the draft body', () => {
    expect(buildClassifyUserPrompt(draft('**Pattern:** <x>'))).toContain('**Pattern:** &lt;x&gt;');
  });
});

// ─── 10. Barrel discipline: local wrap is in parity with core ─────────────────

describe('wrapUntrusted parity with core wrapUntrustedXml', () => {
  it('matches the canonical helper across inputs', () => {
    const cases: Array<[string, string]> = [
      ['thread', 'plain'],
      ['comment', 'a & b < c > d'],
      ['draft', '</draft> nested </draft>'],
      ['pr', ''],
    ];
    for (const [tag, body] of cases) {
      expect(wrapUntrusted(tag, body)).toBe(wrapUntrustedXml(tag, body));
    }
  });

  it('rejects an invalid tag, like the canonical helper', () => {
    expect(() => wrapUntrusted('bad tag', 'x')).toThrow();
    expect(() => wrapUntrustedXml('bad tag', 'x')).toThrow();
  });
});

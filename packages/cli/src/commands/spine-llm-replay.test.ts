import { describe, expect, it } from 'vitest';

import {
  type ClassifierResult,
  classifyAuthorKind,
  type DraftResult,
  DraftResultSchema,
  type ExtractStageResult,
  normalizeReviewChrome,
  type ReviewThread,
  type ReviewThreadComment,
  type ReviewThreadContent,
} from '@mmnto/totem';

import {
  classifierInputKey,
  ClassifierResultLocalSchema,
  computeArtifactHash,
  DraftResultLocalSchema,
  DuplicateRecordError,
  extractorInputKey,
  FixtureIntegrityError,
  RecordingDraftClassifier,
  RecordingDraftExtractor,
  REPLAY_ARTIFACT_KIND,
  type ReplayArtifact,
  ReplayArtifactSchema,
  ReplayDraftClassifier,
  ReplayDraftExtractor,
  ReplayMissError,
  type ReplayProvenance,
  ReplayRecordSink,
  serializeReplayArtifact,
} from './spine-llm-replay.js';

// `DraftCandidate` is the transient Extract→Classify intermediate (not on the
// core barrel); reach it structurally via `ExtractStageResult` (matches the impl).
type DraftCandidate = ExtractStageResult['drafts'][number];

// ─── Stub ports (in-memory, deterministic — NO network, NO LLM) ──────────────

/** A canned `DraftExtractor`: returns a fixed `DraftResult` keyed by PR (default to a 1-elem draft). */
class StubExtractor {
  constructor(private readonly byPr: Map<number, string[]>) {}
  draft(content: ReviewThreadContent): Promise<DraftResult> {
    const drafts = this.byPr.get(content.pr) ?? [`draft for PR ${content.pr}`];
    return Promise.resolve(
      drafts.length === 0 ? { drafts, noDraftCause: 'all-filtered' } : { drafts },
    );
  }
}

/** A canned `DraftClassifier`: returns a fixed result keyed by dslSource (default structural). */
class StubClassifier {
  constructor(private readonly byBody: Map<string, ClassifierResult>) {}
  classify(draft: DraftCandidate): Promise<ClassifierResult> {
    return Promise.resolve(
      this.byBody.get(draft.dslSource) ?? {
        disposition: 'structural',
        dispositionSource: 'classified',
      },
    );
  }
}

// ─── Fixture builders ────────────────────────────────

const MERGE_SHA_A = 'a'.repeat(40);
const MERGE_SHA_B = 'b'.repeat(40);

function comment(author: string, body: string): ReviewThreadComment {
  const authorKind = classifyAuthorKind(author);
  return {
    author,
    body,
    authorKind,
    normalizedBody: authorKind === 'bot' ? normalizeReviewChrome(body) : body,
  };
}

function thread(opts?: Partial<ReviewThread>): ReviewThread {
  return {
    path: opts?.path ?? 'packages/core/src/x.ts',
    isResolved: opts?.isResolved ?? false,
    isOutdated: opts?.isOutdated ?? false,
    comments: opts?.comments ?? [comment('jane', 'a structural note')],
  };
}

function content(opts?: {
  pr?: number;
  mergeCommitSha?: string;
  threads?: ReviewThread[];
}): ReviewThreadContent {
  return {
    pr: opts?.pr ?? 100,
    mergeCommitSha: opts?.mergeCommitSha ?? MERGE_SHA_A,
    threads: opts?.threads ?? [thread()],
  };
}

function draft(opts?: { pr?: number; commitSha?: string; dslSource?: string }): DraftCandidate {
  return {
    provenance: {
      mergedPr: opts?.pr ?? 100,
      reviewThread: `pulls/${opts?.pr ?? 100}/comments`,
      commitSha: opts?.commitSha ?? MERGE_SHA_A,
    },
    dslSource: opts?.dslSource ?? '**Pattern:** no-foo',
    sourceKind: 'human',
  };
}

const STUB_PROVENANCE: ReplayProvenance = {
  promptTemplateHash: 'p'.repeat(64),
  systemPromptHash: 's'.repeat(64),
  provider: 'anthropic',
  model: 'stub-model-1',
  temperature: 0,
  orchestratorVersion: 'stub-orchestrator-0',
  adapterKind: 'extractor+classifier',
  keyVersion: 'v1',
  totemVersion: '0.0.0-test',
};

/** Per-draft ref resolver: a stable (pr, dslSource) ordinal-free ref for tests. */
function draftRefOf(d: DraftCandidate): string {
  return `cand-${d.provenance.mergedPr}-${d.dslSource}`;
}

// ─── 1. Record → replay determinism (FM-a) ───────────

describe('record → replay determinism (FM-a)', () => {
  it('replays byte-identical extractor + classifier outputs recorded from a stub', async () => {
    const sink = new ReplayRecordSink();
    const recExtractor = new RecordingDraftExtractor(
      new StubExtractor(new Map([[100, ['draft-A', 'draft-B']]])),
      sink,
    );
    const recClassifier = new RecordingDraftClassifier(
      new StubClassifier(
        new Map([['draft-A', { disposition: 'behavioral', dispositionSource: 'classified' }]]),
      ),
      sink,
      draftRefOf,
    );

    const c = content({ pr: 100 });
    const recordedDrafts = await recExtractor.draft(c);
    const d = draft({ pr: 100, dslSource: 'draft-A' });
    const recordedClass = await recClassifier.classify(d);

    const artifact = sink.freeze(STUB_PROVENANCE);
    const expectedHash = computeArtifactHash(artifact);

    // Round-trip through serialization to prove the on-disk form replays too.
    const reloaded = ReplayArtifactSchema.parse(JSON.parse(serializeReplayArtifact(artifact)));

    const replayExtractor = new ReplayDraftExtractor(reloaded, expectedHash);
    const replayClassifier = new ReplayDraftClassifier(reloaded, expectedHash, draftRefOf);

    expect(await replayExtractor.draft(c)).toEqual(recordedDrafts);
    expect(await replayClassifier.classify(d)).toEqual(recordedClass);
    // And the recorded values are exactly what the stub produced.
    expect(recordedDrafts).toEqual({ drafts: ['draft-A', 'draft-B'] });
    expect(recordedClass).toEqual({ disposition: 'behavioral', dispositionSource: 'classified' });
  });

  it('serializes deterministically regardless of record insertion order', async () => {
    const buildSink = async (prs: number[]): Promise<ReplayArtifact> => {
      const sink = new ReplayRecordSink();
      const rec = new RecordingDraftExtractor(
        new StubExtractor(new Map(prs.map((p) => [p, [`d-${p}`]]))),
        sink,
      );
      for (const p of prs) await rec.draft(content({ pr: p }));
      return sink.freeze(STUB_PROVENANCE);
    };
    const forward = serializeReplayArtifact(await buildSink([100, 200, 300]));
    const reversed = serializeReplayArtifact(await buildSink([300, 200, 100]));
    expect(forward).toBe(reversed);
  });
});

// ─── 2. Drift / mutation red craft → FixtureIntegrityError ───────────────────

describe('drift / mutation red craft (fold B integrity)', () => {
  it('throws FixtureIntegrityError when a recorded entry is mutated without updating the expected hash', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(
      new StubExtractor(new Map([[100, ['original']]])),
      sink,
    );
    await rec.draft(content({ pr: 100 }));

    const artifact = sink.freeze(STUB_PROVENANCE);
    const expectedHash = computeArtifactHash(artifact); // frozen at record time

    // Tamper with ONE recorded raw entry, leaving the injected expected hash stale.
    const key = extractorInputKey(content({ pr: 100 }));
    const tampered: ReplayArtifact = {
      ...artifact,
      records: {
        ...artifact.records,
        extractor: { ...artifact.records.extractor, [key]: ['TAMPERED'] },
      },
    };

    expect(() => new ReplayDraftExtractor(tampered, expectedHash)).toThrow(FixtureIntegrityError);
    expect(() => new ReplayDraftExtractor(tampered, expectedHash)).toThrow(/expected .* got /);
    // The classifier replay shares the same gate.
    expect(() => new ReplayDraftClassifier(tampered, expectedHash, draftRefOf)).toThrow(
      FixtureIntegrityError,
    );
  });

  it('constructs cleanly when the expected hash matches the (untampered) records', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(new StubExtractor(new Map([[100, ['ok']]])), sink);
    await rec.draft(content({ pr: 100 }));
    const artifact = sink.freeze(STUB_PROVENANCE);
    expect(() => new ReplayDraftExtractor(artifact, computeArtifactHash(artifact))).not.toThrow();
  });

  it('throws FixtureIntegrityError when a PROVENANCE field is mutated (fold F — prompt-hash covered by the gate)', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(new StubExtractor(new Map([[100, ['ok']]])), sink);
    await rec.draft(content({ pr: 100 }));
    const artifact = sink.freeze(STUB_PROVENANCE);
    const expectedHash = computeArtifactHash(artifact); // frozen at record time

    // Edit a PROVENANCE field (the prompt-template hash) WITHOUT re-recording or
    // updating the expected hash. The integrity gate covers the whole artifact, so
    // a prompt change must force a re-record — it can NEVER silently serve the same
    // recorded outputs under a changed prompt (fold F). The records are untouched,
    // so a records-only hash would MISS this; the whole-artifact hash catches it.
    const tampered: ReplayArtifact = {
      ...artifact,
      provenance: { ...artifact.provenance, promptTemplateHash: 'q'.repeat(64) },
    };
    expect(() => new ReplayDraftExtractor(tampered, expectedHash)).toThrow(FixtureIntegrityError);
    expect(() => new ReplayDraftClassifier(tampered, expectedHash, draftRefOf)).toThrow(
      FixtureIntegrityError,
    );
  });
});

// ─── 3. Replay miss red craft → ReplayMissError (not a safe-default) ─────────

describe('replay miss red craft', () => {
  it('throws ReplayMissError on an absent extractor inputKey — NOT a []', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(
      new StubExtractor(new Map([[100, ['recorded']]])),
      sink,
    );
    await rec.draft(content({ pr: 100 }));
    const artifact = sink.freeze(STUB_PROVENANCE);
    const replay = new ReplayDraftExtractor(artifact, computeArtifactHash(artifact));

    // PR 999 was never recorded → MISS. It REJECTS with ReplayMissError; it must
    // NOT resolve to a safe-default [] (the whole point of the no-fallback rule).
    const missContent = content({ pr: 999 });
    await expect(replay.draft(missContent)).rejects.toBeInstanceOf(ReplayMissError);
    let resolvedTo: DraftResult | undefined;
    await replay.draft(missContent).then(
      (v) => {
        resolvedTo = v;
      },
      () => {
        /* expected rejection */
      },
    );
    expect(resolvedTo).toBeUndefined();
  });

  it('throws ReplayMissError on an absent classifier inputKey — NOT a {behavioral, error-default}', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftClassifier(new StubClassifier(new Map()), sink, draftRefOf);
    await rec.classify(draft({ pr: 100, dslSource: 'recorded-body' }));
    const artifact = sink.freeze(STUB_PROVENANCE);
    const replay = new ReplayDraftClassifier(artifact, computeArtifactHash(artifact), draftRefOf);

    await expect(
      replay.classify(draft({ pr: 100, dslSource: 'never-recorded' })),
    ).rejects.toBeInstanceOf(ReplayMissError);
  });
});

// ─── 4. Recorded-empty vs miss ───────────────────────

describe('recorded-empty vs miss (real rows, distinguishable from absence)', () => {
  it('replays a recorded empty DraftResult as that exact value (a real row, not a miss)', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(new StubExtractor(new Map([[100, []]])), sink);
    const recorded = await rec.draft(content({ pr: 100 }));
    expect(recorded).toEqual({ drafts: [], noDraftCause: 'all-filtered' });

    const artifact = sink.freeze(STUB_PROVENANCE);
    const replay = new ReplayDraftExtractor(artifact, computeArtifactHash(artifact));
    // HIT on a recorded empty result — returns the cause-tagged DraftResult, does
    // NOT throw ReplayMissError.
    await expect(replay.draft(content({ pr: 100 }))).resolves.toEqual({
      drafts: [],
      noDraftCause: 'all-filtered',
    });
  });

  it('replays a recorded {behavioral, error-default} (classifier) as that exact value', async () => {
    const errorDefault: ClassifierResult = {
      disposition: 'behavioral',
      dispositionSource: 'error-default',
    };
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftClassifier(
      new StubClassifier(new Map([['err-body', errorDefault]])),
      sink,
      draftRefOf,
    );
    const recorded = await rec.classify(draft({ pr: 100, dslSource: 'err-body' }));
    expect(recorded).toEqual(errorDefault);

    const artifact = sink.freeze(STUB_PROVENANCE);
    const replay = new ReplayDraftClassifier(artifact, computeArtifactHash(artifact), draftRefOf);
    await expect(replay.classify(draft({ pr: 100, dslSource: 'err-body' }))).resolves.toEqual(
      errorDefault,
    );
  });
});

// ─── 5. Duplicate key → throws ───────────────────────

describe('duplicate (adapterKind, inputKey) → DuplicateRecordError', () => {
  it('throws when the same extractor input is recorded twice (never last-write-wins)', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(new StubExtractor(new Map([[100, ['x']]])), sink);
    await rec.draft(content({ pr: 100 }));
    await expect(rec.draft(content({ pr: 100 }))).rejects.toBeInstanceOf(DuplicateRecordError);
  });

  it('throws when the same classifier input (same draftRef) is recorded twice', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftClassifier(new StubClassifier(new Map()), sink, draftRefOf);
    await rec.classify(draft({ pr: 100, dslSource: 'dup' }));
    await expect(rec.classify(draft({ pr: 100, dslSource: 'dup' }))).rejects.toBeInstanceOf(
      DuplicateRecordError,
    );
  });

  it('does NOT collide two different sections sharing a coincidental key value', () => {
    // extractor + classifier maps are independent; the same string in both is fine.
    const sink = new ReplayRecordSink();
    sink.recordExtractor('shared-key', { drafts: ['e'] });
    expect(() =>
      sink.recordClassifier('shared-key', {
        disposition: 'structural',
        dispositionSource: 'classified',
      }),
    ).not.toThrow();
  });
});

// ─── 6. inputKey semantics (fold D) ──────────────────

describe('extractorInputKey (fold D)', () => {
  it('is stable for identical eligible content + same mergeCommitSha', () => {
    const a = extractorInputKey(content({ pr: 100, mergeCommitSha: MERGE_SHA_A }));
    const b = extractorInputKey(content({ pr: 100, mergeCommitSha: MERGE_SHA_A }));
    expect(a).toBe(b);
  });

  it('differs when mergeCommitSha differs (provenance identity)', () => {
    const a = extractorInputKey(content({ pr: 100, mergeCommitSha: MERGE_SHA_A }));
    const b = extractorInputKey(content({ pr: 100, mergeCommitSha: MERGE_SHA_B }));
    expect(a).not.toBe(b);
  });

  it('is INVARIANT to thread + comment reordering (normalization holds)', () => {
    const t1 = thread({
      path: 'a.ts',
      comments: [comment('al', 'first'), comment('bo', 'second')],
    });
    const t2 = thread({ path: 'b.ts', comments: [comment('cy', 'third')] });
    const forward = extractorInputKey(content({ threads: [t1, t2] }));
    // Reverse the threads AND reverse t1's comments.
    const t1rev = thread({
      path: 'a.ts',
      comments: [comment('bo', 'second'), comment('al', 'first')],
    });
    const reversed = extractorInputKey(content({ threads: [t2, t1rev] }));
    expect(forward).toBe(reversed);
  });

  it('is INVARIANT to reordering threads on the SAME path that differ in later comments', () => {
    // The bug greptile P1 + CR caught: two threads on ONE path sharing a first
    // comment but differing LATER compared equal under the old (path, first-comment)
    // sort → provider order leaked into the key. The full-canonical-JSON total order
    // fixes it. (comments normalize by (body, author): 'shared' sorts before 'tail-*'.)
    const t1 = thread({
      path: 'same.ts',
      comments: [comment('al', 'shared'), comment('al', 'tail-1')],
    });
    const t2 = thread({
      path: 'same.ts',
      comments: [comment('al', 'shared'), comment('al', 'tail-2')],
    });
    const forward = extractorInputKey(content({ threads: [t1, t2] }));
    const reversed = extractorInputKey(content({ threads: [t2, t1] }));
    expect(forward).toBe(reversed);
  });

  it('excludes only OUTDATED threads from the key; RESOLVED now affects it (slice γ)', () => {
    const eligible = thread({ path: 'a.ts', comments: [comment('al', 'keep')] });
    // γ: an OUTDATED thread is still excluded from the eligible set → no key effect.
    const outdated = thread({ path: 'z.ts', isOutdated: true, comments: [comment('zo', 'drop')] });
    const withOutdated = extractorInputKey(content({ threads: [eligible, outdated] }));
    const withoutOutdated = extractorInputKey(content({ threads: [eligible] }));
    expect(withOutdated).toBe(withoutOutdated);

    // γ: a RESOLVED thread is now ADMITTED → it IS part of the eligible set the
    // extractor sees, so it MUST change the key (the slice-5a exclusion is reversed).
    const resolved = thread({ path: 'z.ts', isResolved: true, comments: [comment('zo', 'keep2')] });
    const withResolved = extractorInputKey(content({ threads: [eligible, resolved] }));
    expect(withResolved).not.toBe(withoutOutdated);
  });

  it('digests the DE-CHROMED normalizedBody, not the raw body (slice β)', () => {
    // Two bot comments with DIFFERENT chrome but the SAME de-chromed body must key
    // identically (the LLM saw the same normalizedBody); a human comment whose raw
    // body equals that normalized text keys identically too (author aside).
    const chromeA = thread({
      path: 'a.ts',
      comments: [comment('coderabbitai[bot]', '![high](https://x/a.svg)\nguard the divisor')],
    });
    const chromeB = thread({
      path: 'a.ts',
      comments: [comment('coderabbitai[bot]', '<!-- id:1 -->guard the divisor')],
    });
    expect(extractorInputKey(content({ threads: [chromeA] }))).toBe(
      extractorInputKey(content({ threads: [chromeB] })),
    );
  });
});

describe('ClassifierResultLocalSchema parity with core (GCA #2209, option a)', () => {
  it('accepts / rejects EXACTLY what core ClassifierResultSchema does', async () => {
    // The local CLI-side schema avoids a static runtime import of core's barrel
    // (CLI-startup styleguide). This test is the guard against drift: a test MAY
    // static-import core (the rule is about command-file startup, not tests).
    const { ClassifierResultSchema } = await import('@mmnto/totem');
    const cases: unknown[] = [
      { disposition: 'structural', dispositionSource: 'classified' }, // valid
      { disposition: 'behavioral', dispositionSource: 'classified' }, // valid
      { disposition: 'behavioral', dispositionSource: 'error-default' }, // valid (safe-default)
      { disposition: 'structural', dispositionSource: 'error-default' }, // refine → invalid
      { disposition: 'nope', dispositionSource: 'classified' }, // enum → invalid
      { disposition: 'structural' }, // missing field → invalid
    ];
    for (const c of cases) {
      expect(ClassifierResultLocalSchema.safeParse(c).success).toBe(
        ClassifierResultSchema.safeParse(c).success,
      );
    }
  });
});

describe('DraftResultLocalSchema parity with core (α cause-tags; GCA #2209)', () => {
  it('accepts / rejects EXACTLY what core DraftResultSchema does', () => {
    const cases: unknown[] = [
      { drafts: ['a', 'b'] }, // valid (drafts, no cause)
      { drafts: [] }, // invalid — empty WITHOUT a cause (cause-iff-empty refine)
      { drafts: [], noDraftCause: 'invoke-error' }, // valid
      { drafts: [], noDraftCause: 'all-filtered' }, // valid
      { drafts: [], noDraftCause: 'legacy-unknown' }, // valid (replay-migration cause)
      { drafts: ['a'], noDraftCause: 'none-sentinel' }, // invalid — cause WITH drafts
      { drafts: [], noDraftCause: 'bogus' }, // enum → invalid
      { noDraftCause: 'empty-output' }, // missing drafts → invalid
    ];
    for (const c of cases) {
      expect(DraftResultLocalSchema.safeParse(c).success).toBe(
        DraftResultSchema.safeParse(c).success,
      );
    }
  });
});

describe('ReplayDraftExtractor backward-compat (α legacy string[] migration)', () => {
  // The committed cert-#1 fixture stored BARE string[] extractor rows (pre-cause-tag).
  // The union schema must still load them (so the fixture parses + hashes identically)
  // and the replay must normalize them to a DraftResult on read.
  function legacyArtifact(rows: Record<string, string[]>): ReplayArtifact {
    return ReplayArtifactSchema.parse({
      kind: REPLAY_ARTIFACT_KIND,
      provenance: STUB_PROVENANCE,
      records: { extractor: rows, classifier: {} },
    });
  }

  it('normalizes a legacy non-empty string[] row → { drafts } (no fabricated cause)', async () => {
    const c = content({ pr: 100 });
    const artifact = legacyArtifact({ [extractorInputKey(c)]: ['legacy-draft'] });
    const replay = new ReplayDraftExtractor(artifact, computeArtifactHash(artifact));
    await expect(replay.draft(c)).resolves.toEqual({ drafts: ['legacy-draft'] });
  });

  it('normalizes a legacy EMPTY string[] row → legacy-unknown (never a fabricated real cause)', async () => {
    const c = content({ pr: 100 });
    const artifact = legacyArtifact({ [extractorInputKey(c)]: [] });
    const replay = new ReplayDraftExtractor(artifact, computeArtifactHash(artifact));
    await expect(replay.draft(c)).resolves.toEqual({ drafts: [], noDraftCause: 'legacy-unknown' });
  });

  it('a legacy bare-array fixture parses + hashes (the union keeps the cert-#1 fixture loadable)', () => {
    const c = content({ pr: 100 });
    const artifact = legacyArtifact({ [extractorInputKey(c)]: ['x'] });
    expect(() => computeArtifactHash(artifact)).not.toThrow();
  });
});

describe('classifierInputKey (fold D)', () => {
  it('is stable for the same provenance + dslSource + draftRef', () => {
    const d = draft({ pr: 100, dslSource: 'body' });
    expect(classifierInputKey(d, 'ref-0')).toBe(classifierInputKey(d, 'ref-0'));
  });

  it('two drafts from the SAME provenance with different draftRef do NOT collide', () => {
    const d = draft({ pr: 100, dslSource: 'identical-body' });
    // The classifier does not dedupe — two drafts (same provenance, same body)
    // must key distinctly via draftRef.
    expect(classifierInputKey(d, 'ref-0')).not.toBe(classifierInputKey(d, 'ref-1'));
  });

  it('differs when dslSource differs', () => {
    const a = classifierInputKey(draft({ pr: 100, dslSource: 'body-a' }), 'ref-0');
    const b = classifierInputKey(draft({ pr: 100, dslSource: 'body-b' }), 'ref-0');
    expect(a).not.toBe(b);
  });
});

// ─── 7. Serialization hygiene ────────────────────────

describe('serialization hygiene', () => {
  it('serializes record keys SORTED (clean git diffs)', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(
      new StubExtractor(
        new Map([
          [300, ['c']],
          [100, ['a']],
          [200, ['b']],
        ]),
      ),
      sink,
    );
    // Record out of key order.
    await rec.draft(content({ pr: 300 }));
    await rec.draft(content({ pr: 100 }));
    await rec.draft(content({ pr: 200 }));
    const serialized = serializeReplayArtifact(sink.freeze(STUB_PROVENANCE));

    const parsed = JSON.parse(serialized) as { records: { extractor: Record<string, unknown> } };
    const keys = Object.keys(parsed.records.extractor);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toHaveLength(3);
  });

  it('NEVER leaks durationMs / recordedAt / metadata into a record value', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(
      new StubExtractor(new Map([[100, ['only-the-output']]])),
      sink,
    );
    await rec.draft(content({ pr: 100 }));
    const recC = new RecordingDraftClassifier(new StubClassifier(new Map()), sink, draftRefOf);
    await recC.classify(draft({ pr: 100, dslSource: 'b' }));

    const serialized = serializeReplayArtifact(sink.freeze(STUB_PROVENANCE));
    // No non-deterministic / identifying metadata anywhere in the records block.
    expect(serialized).not.toMatch(/durationMs|recordedAt|runId|run-id|localUser|userId/i);

    const parsed = JSON.parse(serialized) as ReplayArtifact;
    // Each record VALUE is strictly the port's output shape — nothing else.
    const extractorVal = Object.values(parsed.records.extractor)[0];
    expect(extractorVal).toEqual({ drafts: ['only-the-output'] });
    const classifierVal = Object.values(parsed.records.classifier)[0];
    expect(Object.keys(classifierVal as object).sort()).toEqual([
      'disposition',
      'dispositionSource',
    ]);
  });

  it('carries the artifact kind tag + provenance block OUTSIDE the records map', async () => {
    const sink = new ReplayRecordSink();
    const rec = new RecordingDraftExtractor(new StubExtractor(new Map([[100, ['x']]])), sink);
    await rec.draft(content({ pr: 100 }));
    const artifact = sink.freeze(STUB_PROVENANCE);
    expect(artifact.kind).toBe(REPLAY_ARTIFACT_KIND);
    expect(artifact.provenance).toEqual(STUB_PROVENANCE);
    // Provenance is not inside records.
    expect(JSON.stringify(artifact.records)).not.toContain('anthropic');
  });
});

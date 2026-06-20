/**
 * ADR-111 miner slice 5b-i — the deterministic LLM record/replay SCAFFOLD.
 *
 * The certifying run (slice 5) introduces the miner's first NON-deterministic,
 * LLM-backed components (the live `DraftExtractor` / `DraftClassifier` adapters,
 * slice 5b-ii). The cohort panel's central answer (consolidated fold A, 4/4) is
 * that those live outputs must be FROZEN into a recorded replay artifact so the
 * scorer + falsification harness can re-run the certifying experiment ZERO-LLM,
 * byte-deterministically, and auditably — "arguably contract-MANDATED" by §6
 * (fail-loud, no degrade) + §8 (every decision ledgered) + Tenet-15.
 *
 * THIS file is the deterministic record/replay scaffold proven in isolation with
 * a STUB orchestrator: NO live LLM, NO network, NO prompts (those are slice
 * 5b-ii, which populates the provenance block from the real adapter). It defines:
 *
 *   - the `llm-replay.v1` Zod artifact (two typed record sections + a provenance
 *     block), CLI-side — the replay artifact is a CLI-layer concern; core stays
 *     unaware of it;
 *   - the deterministic `inputKey` digests for the extractor + classifier ports
 *     (mirroring core's `deriveClaimId` — `sha256("<prefix>" + canonicalJson(...))`
 *     over IDENTITY fields only);
 *   - record/replay decorators (generic over the port) that wrap the core ports;
 *   - the EXTERNAL-expected-hash integrity gate (fold B — a self-hash the artifact
 *     validates against itself is circular; a content+hash co-rewrite would pass).
 *
 * Determinism discipline: this module is `new Date()` / `Math.random()` -free. A
 * recorded `[]` (extractor) or `{behavioral, error-default}` (classifier) is a
 * REAL row — present in the map, distinguishable from a missing key (a replay
 * MISS is a corpus-integrity failure, never a safe-default).
 *
 * Reuse (Tenet-21): the canonical key-sorted serializer (`canonicalStringify`),
 * the full-digest hash (`calculateDeterministicHash` shape), the `deriveClaimId`
 * identity-fields-only pattern, and the wind-tunnel's external-expected-hash
 * integrity discipline (`verifyControlIntegrity`) are all reused, not reinvented.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  type ClassifierResult,
  ClassifierResultSchema,
  type ExtractStageResult,
  type ReviewThread,
  type ReviewThreadComment,
  type ReviewThreadContent,
} from '@mmnto/totem';

// `DraftCandidate` is intentionally NOT on the core public barrel (it is the
// transient Extract→Classify intermediate). It stays structurally reachable via
// `ExtractStageResult['drafts'][number]`, so we derive the type here rather than
// reach for a deep import or ask core to widen its public surface (greptile
// #2202 kept it off the barrel deliberately).
type DraftCandidate = ExtractStageResult['drafts'][number];

// ─── Named constants ─────────────────────────────────

/**
 * inputKey version prefixes (mirrors core's `CLAIM_ID_VERSION` discipline). The
 * version is folded INTO the canonical identity payload (`keyVersion` field) AND
 * prepended to the digest input, so the key space is partitioned by both port
 * kind and schema version — a future identity-shape change re-keys cleanly
 * instead of silently colliding with v1 keys.
 */
const EXTRACTOR_KEY_VERSION = 'extractor:v1';
const CLASSIFIER_KEY_VERSION = 'classifier:v1';

/** Discriminates the two record sections for the duplicate-key guard. */
export type AdapterKind = 'extractor' | 'classifier';

// ─── Errors (CLI-layer; loud-by-construction) ────────

/**
 * A replay query hit an `inputKey` absent from the frozen records. This is a
 * CORPUS-INTEGRITY failure, never a recoverable per-PR condition: the frozen
 * experiment's premise is that every input the certifying run will ask for was
 * recorded. A miss means the corpus drifted out from under the replay (a new
 * input appeared, or a recorded one was dropped). Falling back to `[]` /
 * `{behavioral, error-default}` would absorb that drift silently and let the
 * certifying verdict diverge from the frozen one undetected — so we throw.
 */
export class ReplayMissError extends Error {
  readonly adapterKind: AdapterKind;
  readonly inputKey: string;

  constructor(adapterKind: AdapterKind, inputKey: string) {
    super(
      `[Totem Replay] ${adapterKind} replay MISS: inputKey ${inputKey} is absent from the frozen records. ` +
        `A miss is a corpus-integrity failure (the frozen-experiment premise is broken), never a safe-default — ` +
        `re-record the replay fixture from the live adapter so it covers this input.`,
    );
    this.name = 'ReplayMissError';
    this.adapterKind = adapterKind;
    this.inputKey = inputKey;
  }
}

/**
 * The loaded replay fixture's content-hash does not match the EXTERNAL expected
 * hash injected at construction (fold B). The expected hash is supplied by the
 * caller (5c sources it from a committed lock), NOT embedded in the artifact —
 * an embedded self-hash would be circular (a content+hash co-rewrite passes its
 * own check). A mismatch means the fixture was tampered with or drifted; the
 * replay must NOT proceed, so we throw AT CONSTRUCTION (before any query).
 */
export class FixtureIntegrityError extends Error {
  readonly expectedHash: string;
  readonly actualHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super(
      `[Totem Replay] replay fixture integrity check failed — expected ${expectedHash} got ${actualHash}. ` +
        `The frozen LLM record/replay artifact was altered (tampered or drifted). Revert the change or ` +
        `re-freeze the lock with the updated content-hash.`,
    );
    this.name = 'FixtureIntegrityError';
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

/**
 * Recording the same `(adapterKind, inputKey)` twice with (potentially)
 * different outputs. The record sink is APPEND-ONCE: a duplicate is never
 * last-write-wins (that would silently launder a non-deterministic adapter's
 * second answer over its first). The recording run must be deterministic, so a
 * duplicate key is a producer bug → throw.
 */
export class DuplicateRecordError extends Error {
  readonly adapterKind: AdapterKind;
  readonly inputKey: string;

  constructor(adapterKind: AdapterKind, inputKey: string) {
    super(
      `[Totem Replay] duplicate record for ${adapterKind} inputKey ${inputKey} — the record sink is append-once ` +
        `(never last-write-wins). A second output for the same input is a non-determinism leak in the recording run.`,
    );
    this.name = 'DuplicateRecordError';
    this.adapterKind = adapterKind;
    this.inputKey = inputKey;
  }
}

// ─── Canonical serialization (reused, not reinvented) ─

/**
 * Recursively rebuild a value with object keys in SORTED order so the subsequent
 * stringify is canonical (mirrors core's `canonicalize` in `artifacts/hash.ts`).
 * Arrays keep element order (a reordered array is a different payload). Used for
 * BOTH the inputKey digest payloads and the records-block content-hash, so the
 * pure replay path has no git / IO dependency.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Canonical (recursively key-sorted) minified JSON serialization of `payload`. */
function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

/** Full sha256 hex (64 chars) — the digest IS an identity, never a truncation. */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf-8').digest('hex');
}

// ─── inputKey derivation (fold D — the `deriveClaimId` pattern) ───────────────

/**
 * Normalize a single review thread to its STABLE identity: sort comments by
 * (body, author) and carry only the resolution flags + path. Provider/array
 * order must not change the key, so comments are sorted by a stable tuple before
 * hashing. Resolved/outdated flags ARE part of the identity (the eligible-thread
 * set the extractor was actually handed depends on them).
 */
function normalizeThread(thread: ReviewThread): {
  path: string;
  isResolved: boolean;
  isOutdated: boolean;
  comments: ReviewThreadComment[];
} {
  const comments = [...thread.comments].sort((a, b) =>
    a.body !== b.body
      ? a.body < b.body
        ? -1
        : 1
      : a.author < b.author
        ? -1
        : a.author > b.author
          ? 1
          : 0,
  );
  return {
    path: thread.path,
    isResolved: thread.isResolved,
    isOutdated: thread.isOutdated,
    comments,
  };
}

/**
 * Normalize the eligible thread set: sort threads by (path, first-comment-body,
 * first-comment-author) AFTER per-thread comment normalization, so neither
 * thread order nor comment order from the provider can shift the key. Stripped
 * of any non-deterministic field — `ReviewThread` carries only `path`,
 * resolution flags, and `{author, body}` comments, all stable.
 */
function normalizeThreads(threads: readonly ReviewThread[]): ReturnType<typeof normalizeThread>[] {
  const normalized = threads.map(normalizeThread);
  return normalized.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    const ab = a.comments[0]?.body ?? '';
    const bb = b.comments[0]?.body ?? '';
    if (ab !== bb) return ab < bb ? -1 : 1;
    const aa = a.comments[0]?.author ?? '';
    const ba = b.comments[0]?.author ?? '';
    return aa < ba ? -1 : aa > ba ? 1 : 0;
  });
}

/**
 * Filter to the EXACT eligible set the extractor is handed: non-resolved,
 * non-outdated threads (mirrors core's `eligibleThreads`). The inputKey is a
 * function of what the port ACTUALLY saw, so eligibility must be applied before
 * normalizing — two contents that differ only in resolved/outdated threads
 * (which the extractor never sees) still key identically.
 */
function eligibleThreads(threads: readonly ReviewThread[]): ReviewThread[] {
  return threads.filter((t) => !t.isResolved && !t.isOutdated);
}

/**
 * Deterministic extractor inputKey (fold D). `sha256(canonicalJson({ keyVersion,
 * pr, mergeCommitSha, threads: <normalized eligible threads> }))`. MUST include
 * `mergeCommitSha` (provenance identity). The eligible set is normalized so
 * provider thread/comment order can't change the key; resolved/outdated threads
 * are excluded (the port never sees them). Mirrors `deriveClaimId`: the version
 * is BOTH a payload field and a digest-input prefix.
 */
export function extractorInputKey(content: ReviewThreadContent): string {
  const payload = {
    keyVersion: EXTRACTOR_KEY_VERSION,
    pr: content.pr,
    mergeCommitSha: content.mergeCommitSha,
    threads: normalizeThreads(eligibleThreads(content.threads)),
  };
  return sha256Hex(`${EXTRACTOR_KEY_VERSION}${canonicalJson(payload)}`);
}

/**
 * Deterministic classifier inputKey (fold D). `sha256(canonicalJson({
 * keyVersion, provenance, dslSource, draftRef }))`. The classifier does NOT
 * dedupe drafts — TWO drafts from the SAME provenance must not collide to one
 * key — so `draftRef` (a stable ordinal/ref the caller supplies, e.g. the slice-3
 * per-(pr, ordinal) candidate ref) disambiguates them. Without it, N drafts with
 * an identical body from one PR would map to one record and lose N-1 outputs.
 */
export function classifierInputKey(draft: DraftCandidate, draftRef: string): string {
  const payload = {
    keyVersion: CLASSIFIER_KEY_VERSION,
    provenance: draft.provenance,
    dslSource: draft.dslSource,
    draftRef,
  };
  return sha256Hex(`${CLASSIFIER_KEY_VERSION}${canonicalJson(payload)}`);
}

// ─── The `llm-replay.v1` artifact (Zod, CLI-side) ─────

/**
 * Run-level provenance block. In 5b-i these fields are populated by the (stub)
 * caller — the SCHEMA and the integrity gate covering them are what this slice
 * builds; 5b-ii populates them from the live adapter. They pin the exact frozen
 * experiment (prompt + model + adapter + key version + tool version) so a replay
 * is reproducible and a provenance drift is detectable. Provenance lives OUTSIDE
 * the records map (the records block is strictly `inputKey → output`).
 */
export const ReplayProvenanceSchema = z.object({
  /** sha256 of the frozen draft/classify prompt TEMPLATE (the decaying-prompt pin). */
  promptTemplateHash: z.string(),
  /** sha256 of the frozen system prompt. */
  systemPromptHash: z.string(),
  /** LLM provider id (e.g. `anthropic` / `gemini` / `openai`). */
  provider: z.string(),
  /** Model id (e.g. a pinned model snapshot). */
  model: z.string(),
  /** Decode temperature the frozen outputs were produced at. */
  temperature: z.number(),
  /** The orchestrator build the live adapter ran under. */
  orchestratorVersion: z.string(),
  /** Which port adapter produced these records (`extractor` / `classifier` / a combined run). */
  adapterKind: z.string(),
  /** The inputKey schema version (so a key-shape change is recorded, not silent). */
  keyVersion: z.string(),
  /** The totem/CLI version that froze the artifact. */
  totemVersion: z.string(),
});
export type ReplayProvenance = z.infer<typeof ReplayProvenanceSchema>;

/**
 * The records block: STRICTLY `inputKey → the port's raw return value`. A
 * recorded `[]` (extractor) / `{behavioral, error-default}` (classifier) is a
 * REAL row, distinct from a missing key. NEVER write `durationMs` / `recordedAt`
 * / local-user / run-id into a record — those are non-deterministic / identifying
 * metadata that would corrupt the content-hash and break the frozen-experiment
 * premise. The maps are plain `Record<inputKey, output>`; record keys are
 * written SORTED by the canonical serializer (clean git diffs).
 */
export const ReplayRecordsSchema = z.object({
  /** `inputKey → DraftExtractor.draft()` return (a `string[]`; `[]` is a real row). */
  extractor: z.record(z.array(z.string())),
  /** `inputKey → DraftClassifier.classify()` return (a `ClassifierResult`). */
  classifier: z.record(ClassifierResultSchema),
});
export type ReplayRecords = z.infer<typeof ReplayRecordsSchema>;

/** Stable artifact-format tag — bumped if the envelope shape changes. */
export const REPLAY_ARTIFACT_KIND = 'llm-replay.v1';

/** The full `llm-replay.v1` artifact: format tag + provenance + the two record sections. */
export const ReplayArtifactSchema = z.object({
  kind: z.literal(REPLAY_ARTIFACT_KIND),
  provenance: ReplayProvenanceSchema,
  records: ReplayRecordsSchema,
});
export type ReplayArtifact = z.infer<typeof ReplayArtifactSchema>;

/**
 * Serialize an artifact to canonical, key-SORTED JSON (pretty-printed for a
 * committable artifact + clean diffs). Record keys land sorted because the
 * canonicalizer recursively sorts object keys — so re-freezing in a different
 * insertion order is a no-op diff. This is the ONE serializer used for both the
 * on-disk artifact and the content-hash input, so they can never drift.
 */
export function serializeReplayArtifact(artifact: ReplayArtifact): string {
  return JSON.stringify(canonicalize(ReplayArtifactSchema.parse(artifact)), null, 2);
}

/**
 * The artifact CONTENT-HASH (fold B + fold F): sha256 over the canonically-
 * serialized WHOLE artifact (kind + provenance + records). Deterministic +
 * git-independent (the pure replay path has no git dependency — contrast the
 * wind-tunnel's `git hash-object`, which 5c may switch to for wind-tunnel
 * consistency, out of scope here). Hashing the WHOLE artifact (not records-only)
 * means the integrity gate ALSO COVERS the provenance block — so a prompt / model
 * / key-version edit (e.g. `promptTemplateHash`) WITHOUT a re-record trips the
 * gate (fold F: a prompt change must force a re-record, never silently serve
 * stale outputs under a changed prompt). The expected hash is EXTERNAL (caller-
 * injected; 5c sources it from a committed lock) — never embedded (a self-hash
 * the artifact validates against itself is circular: a content+hash co-rewrite
 * would pass its own check).
 */
export function computeArtifactHash(artifact: ReplayArtifact): string {
  return sha256Hex(canonicalJson(ReplayArtifactSchema.parse(artifact)));
}

// ─── Record sink ─────────────────────────────────────

/**
 * The append-once record sink the `Recording*` decorators write into. Holds the
 * in-progress records map; `freeze()` produces the immutable artifact. A
 * duplicate `(adapterKind, inputKey)` throws `DuplicateRecordError` — never
 * last-write-wins (a second output for the same input is a non-determinism leak
 * the recording run must surface, not absorb).
 */
export class ReplayRecordSink {
  private readonly extractor = new Map<string, string[]>();
  private readonly classifier = new Map<string, ClassifierResult>();

  recordExtractor(inputKey: string, output: string[]): void {
    if (this.extractor.has(inputKey)) throw new DuplicateRecordError('extractor', inputKey);
    this.extractor.set(inputKey, output);
  }

  recordClassifier(inputKey: string, output: ClassifierResult): void {
    if (this.classifier.has(inputKey)) throw new DuplicateRecordError('classifier', inputKey);
    this.classifier.set(inputKey, output);
  }

  /** Snapshot the records as a plain (Zod-validated) object — keys land sorted on serialize. */
  records(): ReplayRecords {
    return ReplayRecordsSchema.parse({
      extractor: Object.fromEntries(this.extractor),
      classifier: Object.fromEntries(this.classifier),
    });
  }

  /** Assemble the full `llm-replay.v1` artifact from the recorded sink + a provenance block. */
  freeze(provenance: ReplayProvenance): ReplayArtifact {
    return ReplayArtifactSchema.parse({
      kind: REPLAY_ARTIFACT_KIND,
      provenance,
      records: this.records(),
    });
  }
}

// ─── Recording decorators (generic over the port) ─────

/**
 * Records every `DraftExtractor.draft()` call's inputKey → raw `string[]` output
 * into the sink, then passes the value THROUGH unchanged. The recorded value is
 * the PORT's return (pre-core-funnel) — a recorded `[]` is a real row. A
 * duplicate inputKey throws (via the sink).
 */
export class RecordingDraftExtractor {
  constructor(
    private readonly wrapped: { draft(content: ReviewThreadContent): Promise<string[]> },
    private readonly sink: ReplayRecordSink,
  ) {}

  async draft(content: ReviewThreadContent): Promise<string[]> {
    const output = await this.wrapped.draft(content);
    this.sink.recordExtractor(extractorInputKey(content), output);
    return output;
  }
}

/**
 * Records every `DraftClassifier.classify()` call's inputKey → raw
 * `ClassifierResult` output into the sink, then passes it through unchanged. The
 * caller supplies a `draftRef` (the disambiguator for multiple drafts from one
 * provenance — fold D). A duplicate inputKey throws (via the sink).
 *
 * `classify` does not take a `draftRef` in the core port signature, so the
 * decorator binds it via a per-draft ref RESOLVER the caller supplies (e.g. the
 * slice-3 per-(pr, ordinal) candidate ref). The resolver is pure + deterministic.
 */
export class RecordingDraftClassifier {
  constructor(
    private readonly wrapped: { classify(draft: DraftCandidate): Promise<ClassifierResult> },
    private readonly sink: ReplayRecordSink,
    private readonly draftRef: (draft: DraftCandidate) => string,
  ) {}

  async classify(draft: DraftCandidate): Promise<ClassifierResult> {
    const output = await this.wrapped.classify(draft);
    this.sink.recordClassifier(classifierInputKey(draft, this.draftRef(draft)), output);
    return output;
  }
}

// ─── Replay decorators (PURE — zero live calls) ───────

/**
 * Validate the loaded fixture's whole-artifact content-hash against the EXTERNAL
 * expected hash (fold B + fold F — provenance is covered, so a prompt-hash edit
 * trips the gate). Throws `FixtureIntegrityError` on mismatch. Shared by both
 * replay decorators so the gate runs exactly once per construction with one
 * implementation.
 */
function assertFixtureIntegrity(artifact: ReplayArtifact, expectedHash: string): void {
  const actualHash = computeArtifactHash(artifact);
  if (actualHash !== expectedHash) throw new FixtureIntegrityError(expectedHash, actualHash);
}

/**
 * PURE replay of `DraftExtractor` — zero live LLM / network calls. Computes the
 * inputKey for the requested content, looks it up in the frozen records:
 *   - HIT  → return the recorded `string[]` (including a recorded `[]` — a real row);
 *   - MISS → throw `ReplayMissError` (NEVER fall back to `[]`).
 *
 * Integrity (fold B + F): the constructor takes the EXTERNAL expected content-
 * hash, computes the actual WHOLE-ARTIFACT hash (records + provenance), and throws
 * `FixtureIntegrityError` AT CONSTRUCTION on mismatch — so a tampered/drifted
 * fixture (records OR a prompt-provenance edit) can never serve a single replay.
 */
export class ReplayDraftExtractor {
  private readonly records: ReplayRecords['extractor'];

  constructor(fixture: ReplayArtifact, expectedHash: string) {
    const parsed = ReplayArtifactSchema.parse(fixture);
    assertFixtureIntegrity(parsed, expectedHash);
    this.records = parsed.records.extractor;
  }

  // `async` so a MISS surfaces as a REJECTED promise (the port contract is
  // `Promise<string[]>`; a consumer awaits it). A synchronous `throw` would
  // escape an `await`-less caller's `.catch`, so the rejection path is uniform.
  async draft(content: ReviewThreadContent): Promise<string[]> {
    const inputKey = extractorInputKey(content);
    // `Object.prototype.hasOwnProperty`-style presence check, NOT truthiness: a
    // recorded `[]` is a real HIT (falsy-but-present), distinct from an absent
    // key (a MISS).
    if (!Object.prototype.hasOwnProperty.call(this.records, inputKey)) {
      throw new ReplayMissError('extractor', inputKey);
    }
    return this.records[inputKey];
  }
}

/**
 * PURE replay of `DraftClassifier` — zero live calls. Computes the inputKey
 * (using the caller's `draftRef` resolver), looks it up:
 *   - HIT  → return the recorded `ClassifierResult` (including a recorded
 *            `{behavioral, error-default}` — a real row);
 *   - MISS → throw `ReplayMissError` (NEVER fall back to the safe-default).
 *
 * Same external-expected-hash integrity gate at construction (fold B).
 */
export class ReplayDraftClassifier {
  private readonly records: ReplayRecords['classifier'];
  private readonly draftRef: (draft: DraftCandidate) => string;

  constructor(
    fixture: ReplayArtifact,
    expectedHash: string,
    draftRef: (draft: DraftCandidate) => string,
  ) {
    const parsed = ReplayArtifactSchema.parse(fixture);
    assertFixtureIntegrity(parsed, expectedHash);
    this.records = parsed.records.classifier;
    this.draftRef = draftRef;
  }

  // `async` so a MISS surfaces as a REJECTED promise (uniform with the port
  // contract `Promise<ClassifierResult>`), as in `ReplayDraftExtractor.draft`.
  async classify(draft: DraftCandidate): Promise<ClassifierResult> {
    const inputKey = classifierInputKey(draft, this.draftRef(draft));
    if (!Object.prototype.hasOwnProperty.call(this.records, inputKey)) {
      throw new ReplayMissError('classifier', inputKey);
    }
    return this.records[inputKey];
  }
}

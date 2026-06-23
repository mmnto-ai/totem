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

// Type-only imports from '@mmnto/totem' (erased at compile — no runtime cost). A
// commands/ module must NOT statically import a runtime VALUE from the heavy core
// barrel (LanceDB / apache-arrow) — the CLI dynamic-import styleguide (GCA #2209).
// The classifier-result VALIDATION is therefore defined locally below (the replay
// artifact schema is a CLI-layer concern — cohort panel, gemini), kept in parity
// with core's `ClassifierResult` by a test, rather than statically importing core's
// runtime `ClassifierResultSchema`.
import type {
  ClassifierResult,
  DraftResult,
  ExtractStageResult,
  ReviewThread,
  ReviewThreadComment,
  ReviewThreadContent,
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
      `${adapterKind} replay MISS: inputKey ${inputKey} is absent from the frozen records. ` +
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
      `replay fixture integrity check failed — expected ${expectedHash} got ${actualHash}. ` +
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
      `duplicate record for ${adapterKind} inputKey ${inputKey} — the record sink is append-once ` +
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
 * Normalize the eligible thread set: per-thread comment-normalize, then sort by the
 * FULL canonical JSON of each normalized thread. Sorting by `(path, first-comment)`
 * was NOT a total order — two threads on the SAME path sharing a first comment but
 * differing in LATER comments compared equal, so their provider array order leaked
 * into the canonical payload and the same logical input keyed differently (greptile
 * P1 + CR, #2209; a PR commonly has multiple threads on one file). Sorting by the
 * whole canonical thread IS a total order: two threads compare equal only when
 * byte-identical, so neither thread nor comment order from the provider can shift
 * the key. Stripped of any non-deterministic field — `ReviewThread` carries only
 * `path`, resolution flags, and `{author, body}` comments, all stable.
 */
function normalizeThreads(threads: readonly ReviewThread[]): ReturnType<typeof normalizeThread>[] {
  return threads.map(normalizeThread).sort((a, b) => {
    const ka = canonicalJson(a);
    const kb = canonicalJson(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
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
/**
 * CLI-side validation of a recorded `ClassifierResult` (GCA #2209 + the cohort
 * panel's "replay artifact schema is a CLI-layer concern", gemini): a LOCAL Zod
 * schema rather than a static runtime import of core's `ClassifierResultSchema`
 * (which would pull the heavy `@mmnto/totem` barrel onto the CLI-startup path).
 * Mirrors core's shape AND its refinement (`error-default` ⟹ `behavioral`, the
 * low-privilege safe-default) so a recorded `{structural, error-default}` is
 * rejected. A test asserts parity with core, so this duplication can't silently
 * drift if core's `ClassifierResult` changes.
 */
export const ClassifierResultLocalSchema = z
  .object({
    disposition: z.enum(['structural', 'behavioral']),
    dispositionSource: z.enum(['classified', 'error-default']),
  })
  .refine((v) => v.dispositionSource !== 'error-default' || v.disposition === 'behavioral', {
    message: "dispositionSource 'error-default' requires disposition 'behavioral'",
  });

/**
 * CLI-side validation of a recorded `DraftResult` (GCA #2209 + the panel's "replay
 * artifact schema is a CLI-layer concern"): a LOCAL Zod schema rather than a static
 * runtime import of core's `DraftResultSchema` (which would pull the heavy
 * `@mmnto/totem` barrel onto the CLI-startup path). Mirrors core's shape AND its
 * "cause iff empty" refinement (the `NoDraftCauseSchema` enum, including the
 * replay-migration-only `legacy-unknown`); a test asserts parity with core so this
 * duplication can't silently drift if core's `DraftResult` changes.
 */
export const DraftResultLocalSchema = z
  .object({
    drafts: z.array(z.string()),
    noDraftCause: z
      .enum([
        'invoke-error',
        'empty-output',
        'none-sentinel',
        'unparseable-shape',
        'non-array',
        'all-filtered',
        'legacy-unknown',
      ])
      .optional(),
  })
  .refine((r) => (r.drafts.length === 0) === (r.noDraftCause !== undefined), {
    message: 'noDraftCause must be present iff drafts is empty',
  });

export const ReplayRecordsSchema = z.object({
  /**
   * `inputKey → DraftExtractor.draft()` return — a `DraftResult` (`{drafts, noDraftCause?}`);
   * a recorded `{drafts:[], noDraftCause}` is a real row. BACKWARD-COMPAT (the α
   * cause-tag migration): a legacy fixture stored a bare `string[]` (pre-cause-tag),
   * accepted via the union so the committed cert-#1 fixture still parses + hashes
   * IDENTICALLY (the bare-array branch returns it unchanged). `ReplayDraftExtractor`
   * normalizes a legacy row to a `DraftResult` on read (empty → `legacy-unknown`);
   * fresh recordings always write the object form.
   */
  extractor: z.record(z.union([z.array(z.string()), DraftResultLocalSchema])),
  /** `inputKey → DraftClassifier.classify()` return (a `ClassifierResult`). */
  classifier: z.record(ClassifierResultLocalSchema),
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
 * Serialize an artifact to canonical, key-SORTED JSON, PRETTY-printed for a
 * committable artifact + clean diffs. Record keys land sorted because the
 * canonicalizer recursively sorts object keys — so re-freezing in a different
 * insertion order is a no-op diff.
 *
 * NOTE (greptile/CR #2209): the content-hash (`computeArtifactHash`) is computed
 * over the MINIFIED canonical form (`canonicalJson`), NOT these pretty-printed
 * bytes. Both run through the same `canonicalize` (so they never drift on key
 * order), but they are NOT byte-identical — to verify integrity always call
 * `computeArtifactHash(loadedArtifact)`; never `sha256` the raw file bytes.
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
  return hashParsedArtifact(ReplayArtifactSchema.parse(artifact));
}

/**
 * Hash an ALREADY-parsed artifact — no redundant re-parse (CR #2209). The Replay
 * constructors parse the fixture once, then the integrity gate hashes that parsed
 * value directly via this helper; `computeArtifactHash` (public) parses first for
 * untrusted input. Both produce the same digest for a valid artifact.
 */
function hashParsedArtifact(parsed: ReplayArtifact): string {
  return sha256Hex(canonicalJson(parsed));
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
  private readonly extractor = new Map<string, DraftResult>();
  private readonly classifier = new Map<string, ClassifierResult>();

  recordExtractor(inputKey: string, output: DraftResult): void {
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
 * Records every `DraftExtractor.draft()` call's inputKey → raw `DraftResult` output
 * into the sink, then passes the value THROUGH unchanged. The recorded value is the
 * PORT's return (pre-core-funnel) — a recorded `{drafts:[], noDraftCause}` is a real
 * row that freezes the NO-DRAFT cause for the replay. A duplicate inputKey throws
 * (via the sink).
 */
export class RecordingDraftExtractor {
  constructor(
    private readonly wrapped: { draft(content: ReviewThreadContent): Promise<DraftResult> },
    private readonly sink: ReplayRecordSink,
  ) {}

  async draft(content: ReviewThreadContent): Promise<DraftResult> {
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
  // `artifact` is already Zod-parsed by the Replay constructor — hash it directly,
  // no redundant re-parse (CR #2209; matters for high-volume 5c runs).
  const actualHash = hashParsedArtifact(artifact);
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
  // `Promise<DraftResult>`; a consumer awaits it). A synchronous `throw` would
  // escape an `await`-less caller's `.catch`, so the rejection path is uniform.
  async draft(content: ReviewThreadContent): Promise<DraftResult> {
    const inputKey = extractorInputKey(content);
    // Presence check, NOT truthiness: a recorded empty result is a real HIT,
    // distinct from an absent key (a MISS).
    if (!Object.prototype.hasOwnProperty.call(this.records, inputKey)) {
      throw new ReplayMissError('extractor', inputKey);
    }
    const rec = this.records[inputKey];
    // Backward-compat (α migration): a legacy fixture row is a bare `string[]`
    // (pre-cause-tag) → normalize to a `DraftResult`. An EMPTY legacy row gets
    // `legacy-unknown` — NOT a fabricated real cause; it honestly signals "this
    // fixture predates cause-tags, re-record before cause-rate reporting." A
    // non-empty legacy row carries its drafts and no cause. A fresh row is already
    // a `DraftResult` and passes through unchanged.
    if (Array.isArray(rec)) {
      return rec.length === 0 ? { drafts: rec, noDraftCause: 'legacy-unknown' } : { drafts: rec };
    }
    return rec;
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

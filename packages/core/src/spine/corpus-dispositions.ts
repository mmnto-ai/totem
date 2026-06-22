// ─── #709 ground-truth deriver — slice 5d-ii: the held-out disposition source ─
//
// The frozen `corpus-dispositions.json` fixture: the held-out CORPUS PRs' review
// threads, captured WITH span anchoring (the comment `diffHunk` + the thread
// line) so slice 5d-iii can bind a `RuleFiring`'s matched line to a disposition
// by CONTENT/invariant (not raw line — #709 contract addition #3). This is the
// data the deriver classifies (via `classifyDisposition`, 5d-i) into TP/FP.
//
// Why a SEPARATE source from `review-content.json` (codex panel, BLOCKING-2):
//  - `review-content.json` is the TRAIN slice (mining fetches train PRs only —
//    FM-h, extract.ts), so it does not contain the held-out PRs' dispositions at
//    all; and its `ReviewThread` shape carries no `line`/`diffHunk`, so it cannot
//    bind a firing to a span. The answer key labels HELD-OUT firings, so it needs
//    the HELD-OUT PRs' threads, span-anchored.
//  - The disposition source is the evaluation corpus, DISJOINT from the rule's
//    train provenance (ADR-111 §5; strategy-claude RULED #1, label-only: these
//    threads NEVER feed mining/provenance).
//
// This module is the PROVENANCE shape only — RAW fetched threads. The taxonomy
// class + the TP/FP label + the firing evidence-ref are DERIVED downstream
// (5d-iii) and live in `ground-truth-labels.json`, NOT here — so
// `corpusDispositionsSha` stays a clean provenance digest over the deriver's
// INPUT (strategy-claude RULED #3: corpusDispositionsSha = provenance, the
// Prop-285 §6.6 crystallized-hallucination guard), never over its own output.
//
// Resolution flags are SURFACED, never filtered (the #2201 "surface, don't
// filter" discipline): unlike the train extractor's resolved-thread gate, a
// resolved/outdated held-out thread is disposition EVIDENCE (an "accepted fix" or
// a "superseded" signal), so it is captured and the taxonomy/span-bind decides
// (codex WARNING-5). `isResolved` alone is never a label.

import { z } from 'zod';

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

/** One review-thread comment — the audit-anchored provenance the taxonomy reads. */
export const CorpusDispositionCommentSchema = z.object({
  /** GitHub review-comment databaseId — the evidence-ref anchor (5d-iii links labels back to it). */
  commentId: z.number().int().nonnegative().optional(),
  /** Comment author login; '' for a deleted/ghost account (coerced at the adapter, never dropped). */
  author: z.string(),
  body: z.string(),
});

/**
 * One held-out review thread, span-anchored. `diffHunk` (the root comment's
 * unified-diff hunk) is the CONTENT span source the firing binds to; `line` /
 * `originalLine` are locator HINTS only (#709 #3 — never physical-line equality).
 */
export const CorpusDispositionThreadSchema = z.object({
  /** GitHub review-thread node id — the audit anchor. Optional (older payloads). */
  threadId: z.string().optional(),
  path: z.string(),
  /** Post-image anchored line — a locator HINT (binding keys on diffHunk content). `null` when GitHub has none. */
  line: z.number().int().positive().nullable().optional(),
  /** Base-image anchored line — a locator HINT. */
  originalLine: z.number().int().positive().nullable().optional(),
  /** The root comment's unified diff hunk — the content/invariant span the firing binds to. */
  diffHunk: z.string(),
  /** GitHub `reviewThreads.isResolved` — surfaced as disposition evidence, NOT a filter. */
  isResolved: z.boolean(),
  /** GitHub `reviewThreads.isOutdated` — surfaced; an outdated hunk must still bind by content (5d-iii). */
  isOutdated: z.boolean(),
  comments: z.array(CorpusDispositionCommentSchema),
});

/** One held-out CORPUS PR's dispositions (provenance for the answer key). */
export const CorpusDispositionSchema = z.object({
  pr: z.number().int().positive(),
  /** Lowercase 40-hex merge-commit SHA (lc is squash-merge). */
  mergeCommitSha: z.string().regex(COMMIT_SHA_RE, 'mergeCommitSha must be a 40-hex SHA'),
  threads: z.array(CorpusDispositionThreadSchema),
});

/** The frozen `corpus-dispositions.json` payload — one entry per held-out corpus PR. */
export const CorpusDispositionsSchema = z.array(CorpusDispositionSchema);

export type CorpusDispositionComment = z.infer<typeof CorpusDispositionCommentSchema>;
export type CorpusDispositionThread = z.infer<typeof CorpusDispositionThreadSchema>;
export type CorpusDisposition = z.infer<typeof CorpusDispositionSchema>;

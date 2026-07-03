// ─── ADR-112 §5.1/§8 R1 — the FROZEN SPLIT artifact (pre-authoring freeze) ────
//
// The real-set slice R1 (strategy 0102Z contract, Option A mechanism-first): the
// tamper-evident, TRACKED-PUBLIC artifact a `totem spine freeze-split` run writes
// BEFORE any rule is authored. It is the single home (Tenet-20) for the split
// facts an authored cert run consumes — membership, `frozenAt`, the derivation
// pins — superseding the D5 shape where materialize resolved the split from seed
// params (that resolution is demoted to a verification ASSERT, spine-authored-
// materialize fold-5).
//
// Tamper-evidence is (a)+(b) COMPOSED (the ruled construction):
//  (a) commit-anchored — the artifact is committed to shared history BEFORE
//      authoring; the proof is TOPOLOGY (introducing commit on origin/main
//      ancestry, ledger entries strictly later by ancestry), never a timestamp —
//      `GIT_COMMITTER_DATE` is settable, ancestry rewrites are observable
//      (codex fold-1; the git plumbing lives cli-side in spine-freeze-proof.ts).
//  (b) hash-commitment — `freezeCommitment = sha256(splitRef · frozenAt ·
//      corpusIntegrity)`; every subsequent authoring-ledger entry carries it
//      INSIDE its `authoringContentHash` material, so a re-freeze flips every
//      downstream entry to would-revise, never "unchanged" (codex fold-2).
//
// `splitRef` is the CONTENT ADDRESS of the canonical artifact payload —
// `split:<sha256>` over every field EXCEPT `splitRef` / `freezeCommitment` /
// `label` (the commitment cannot be inside its own preimage; the label is a
// human handle, never load-bearing — codex fold-3). This module is PURE
// (schema + derivations); IO and git live in the cli layer.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { canonicalStringify } from '../compile-manifest.js';
import { type SplitArtifact, SplitArtifactSchema } from './split.js';

const nonBlank = (label: string) =>
  z.string().refine((s) => s.trim().length > 0, { message: `${label} must be non-empty` });

/** Lowercase 40-hex git commit SHA (canonical git form). */
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
/** Full sha256 hex — the commitment / integrity stamp width. */
const SHA256_RE = /^[0-9a-f]{64}$/;
/** The content-addressed frozen-split reference form (codex fold-3). */
export const SPLIT_REF_RE = /^split:[0-9a-f]{64}$/;

/** Filename of the frozen split artifact inside its gate dir (the tracked-public home). */
export const FROZEN_SPLIT_FILE = 'frozen-split.json';

/**
 * The selection-rule derivation PINS — the exact inputs the freeze derived the
 * corpus from, recorded so materialize can RE-DERIVE the split and assert byte
 * equality (detect-never-repair; re-derivation is a detector, never a source).
 */
export const SelectionPinsSchema = z
  .object({
    predicate: nonBlank('selectionPins.predicate'),
    window: z.discriminatedUnion('type', [
      z.object({ type: z.literal('all') }),
      z.object({ type: z.literal('bounded'), n: z.number().int().positive() }),
    ]),
    codePathClassifier: z.object({
      includeGlobs: z.array(z.string()),
      excludeGlobs: z.array(z.string()),
    }),
    excludeRevertPairs: z.boolean(),
    excludeBotPrs: z.boolean(),
  })
  .strict();
export type SelectionPins = z.infer<typeof SelectionPinsSchema>;

/**
 * The `totem spine freeze-split` INPUT (the curated freeze decisions). Everything
 * else — `asOfCommit` (lc HEAD at freeze, Q3 derived-at-freeze), the corpus, the
 * split membership, `frozenAt`, the stamps — is DERIVED at freeze and pinned in
 * the artifact. `cutIndex` is the recorded build-choice under the held-out ≥ 0.5
 * floor (#804).
 */
export const FreezeSplitParamsSchema = z
  .object({
    gate: nonBlank('gate').refine((s) => /^[a-z0-9-]+$/.test(s), {
      message: 'gate must be a kebab slug — it names the tracked freeze home directory',
    }),
    repo: nonBlank('repo'),
    selectionRule: SelectionPinsSchema,
    split: z.object({
      cutIndex: z.number().int().nonnegative(),
      excludedPrs: z.array(z.number().int().positive()).default([]),
    }),
    label: z.string().optional(),
  })
  .strict();
export type FreezeSplitParams = z.infer<typeof FreezeSplitParamsSchema>;

/**
 * The frozen split artifact. `.strict()` — an unknown field is tamper/corruption,
 * never silently carried. `split.frozenAt` is REQUIRED here (the freeze IS the
 * event that mints it) even though `SplitArtifactSchema` keeps it optional for
 * the mined/legacy shape.
 */
export const FrozenSplitArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    gate: nonBlank('gate'),
    repo: nonBlank('repo'),
    selectionPins: SelectionPinsSchema,
    /** The resolved split (single home for membership + `frozenAt`; `asOfCommit` lives inside). */
    split: SplitArtifactSchema,
    /**
     * The LAST train PR's merge commit — the §5.4 author-sandbox root derives
     * from THIS (an lc worktree at the cut boundary), never from an
     * author-supplied knob (the judgedBy≠author independence axiom applied to
     * config — codex sandbox note).
     */
    cutBoundarySha: z.string().regex(COMMIT_SHA_RE),
    /** sha256 over the canonical corpus enumeration (PRs + merge commits) — the (b) commitment leg. */
    corpusIntegrity: z.string().regex(SHA256_RE),
    /** Content address of the canonical payload (all fields except splitRef/freezeCommitment/label). */
    splitRef: z.string().regex(SPLIT_REF_RE),
    /** `sha256(splitRef · frozenAt · corpusIntegrity)` — chained into every ledger entry's material. */
    freezeCommitment: z.string().regex(SHA256_RE),
    /** Optional human handle — NEVER load-bearing (resolution goes by `splitRef`). */
    label: z.string().optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.split.frozenAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a frozen split artifact must carry split.frozenAt (the freeze mints the instant)',
        path: ['split', 'frozenAt'],
      });
    }
  });
export type FrozenSplitArtifact = z.infer<typeof FrozenSplitArtifactSchema>;

/** The freeze-time inputs `assembleFrozenSplitArtifact` derives the stamps from. */
export interface FrozenSplitAssembly {
  gate: string;
  repo: string;
  selectionPins: SelectionPins;
  split: SplitArtifact;
  cutBoundarySha: string;
  corpusIntegrity: string;
  label?: string;
}

/**
 * sha256 over the canonical corpus enumeration: the sorted PR list + each PR's
 * merge commit. Deterministic from the pinned inputs; a post-freeze change to
 * either (t7 content injection) breaks the commitment chain loudly.
 */
export function computeCorpusIntegrity(
  corpus: readonly number[],
  mergeCommitByPr: ReadonlyMap<number, string>,
): string {
  const rows = [...corpus]
    .sort((a, b) => a - b)
    .map((pr) => ({ pr, mergeCommit: mergeCommitByPr.get(pr) ?? null }));
  return createHash('sha256').update(canonicalStringify(rows)).digest('hex');
}

/** The content-address preimage: every artifact field EXCEPT splitRef / freezeCommitment / label. */
function refPayload(a: FrozenSplitAssembly): unknown {
  return {
    schemaVersion: 1,
    gate: a.gate,
    repo: a.repo,
    selectionPins: a.selectionPins,
    split: a.split,
    cutBoundarySha: a.cutBoundarySha,
    corpusIntegrity: a.corpusIntegrity,
  };
}

/** `split:<sha256(canonical payload)>` — codex fold-3: the ref is the artifact's content address. */
export function computeFrozenSplitRef(a: FrozenSplitAssembly): string {
  return `split:${createHash('sha256')
    .update(canonicalStringify(refPayload(a)))
    .digest('hex')}`;
}

/** The (b) hash-commitment: `sha256(splitRef · frozenAt · corpusIntegrity)` over the canonical tuple. */
export function computeFreezeCommitment(
  splitRef: string,
  frozenAt: string,
  corpusIntegrity: string,
): string {
  return createHash('sha256').update(`${splitRef}\n${frozenAt}\n${corpusIntegrity}`).digest('hex');
}

/**
 * Derive splitRef + freezeCommitment from the freeze-time inputs and return the
 * validated artifact. Throws (Zod) if the assembly is malformed — a malformed
 * freeze never produces an artifact (Tenet 4).
 */
export function assembleFrozenSplitArtifact(a: FrozenSplitAssembly): FrozenSplitArtifact {
  if (a.split.frozenAt === undefined) {
    // Pre-empt the schema superRefine with the operative message: the freeze
    // mints the instant; an assembly without one is a caller contract violation.
    throw new Error(
      '[Totem Error] assembleFrozenSplitArtifact: split.frozenAt is absent — the freeze mints the instant; assemble AFTER stamping it',
    );
  }
  const splitRef = computeFrozenSplitRef(a);
  const freezeCommitment = computeFreezeCommitment(splitRef, a.split.frozenAt, a.corpusIntegrity);
  return FrozenSplitArtifactSchema.parse({
    schemaVersion: 1,
    gate: a.gate,
    repo: a.repo,
    selectionPins: a.selectionPins,
    split: a.split,
    cutBoundarySha: a.cutBoundarySha,
    corpusIntegrity: a.corpusIntegrity,
    splitRef,
    freezeCommitment,
    ...(a.label !== undefined ? { label: a.label } : {}),
  });
}

/** Result of recomputing an artifact's content address + commitment from its own fields. */
export interface FreezeIntegrityCheck {
  ok: boolean;
  expectedSplitRef: string;
  expectedCommitment: string;
}

/**
 * Recompute splitRef + freezeCommitment from the artifact's own payload and
 * compare — the pure half of tamper detection (any in-place edit to a pinned
 * field breaks one or both). Consumers throw a distinct fail-loud row on `!ok`;
 * this stays a sensor (Tenet 13).
 */
export function verifyFreezeIntegrity(artifact: FrozenSplitArtifact): FreezeIntegrityCheck {
  const assembly: FrozenSplitAssembly = {
    gate: artifact.gate,
    repo: artifact.repo,
    selectionPins: artifact.selectionPins,
    split: artifact.split,
    cutBoundarySha: artifact.cutBoundarySha,
    corpusIntegrity: artifact.corpusIntegrity,
  };
  const expectedSplitRef = computeFrozenSplitRef(assembly);
  // `frozenAt` presence is schema-enforced (superRefine); the fallback keeps the
  // recompute total rather than throwing inside a sensor.
  const expectedCommitment = computeFreezeCommitment(
    artifact.splitRef,
    artifact.split.frozenAt ?? '',
    artifact.corpusIntegrity,
  );
  return {
    ok: expectedSplitRef === artifact.splitRef && expectedCommitment === artifact.freezeCommitment,
    expectedSplitRef,
    expectedCommitment,
  };
}

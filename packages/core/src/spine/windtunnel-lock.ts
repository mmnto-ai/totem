import { createHash } from 'node:crypto';

import { z } from 'zod';

// ─── Named constants ─────────────────────────────────

const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;
// llm-replay fixture hash is a sha256 digest (64-hex) from computeArtifactHash
// over the whole replay artifact (incl. provenance), distinct from the 40-hex
// git hash-object fixtureSha used for the control dirs.
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const MIN_ACTIVE_RULES_FLOOR = 2;

// ─── Sub-schemas ─────────────────────────────────────

const ResolvedPrSchema = z.object({
  pr: z.number().int().positive(),
  mergeCommit: z.string().regex(COMMIT_SHA_REGEX, 'mergeCommit must be a 40-hex SHA'),
  baseSha: z.string().regex(COMMIT_SHA_REGEX, 'baseSha must be a 40-hex SHA'),
  headSha: z.string().regex(COMMIT_SHA_REGEX, 'headSha must be a 40-hex SHA'),
  diffSha: z.string().regex(COMMIT_SHA_REGEX, 'diffSha must be a 40-hex SHA').optional(),
});

// ─── Main schema ─────────────────────────────────────

export const WindtunnelLockSchema = z
  .object({
    schema: z.literal('windtunnel.lock.v1'),
    canonicalPath: z.string(),
    gate: z.string(),
    // frozenAt.commit is NOT trusted as a freeze proof (C3 — proof is git-derived at run time).
    frozenAt: z
      .object({
        timestamp: z.string().optional(),
        commit: z.string().optional(),
      })
      .optional(),
    phase: z.enum(['harness', 'certifying']),
    corpus: z.object({
      repo: z.string(),
      selectionRule: z.object({
        state: z.string(),
        predicate: z.string(),
        window: z.discriminatedUnion('type', [
          z.object({ type: z.literal('all') }),
          z.object({ type: z.literal('bounded'), n: z.number().int().positive() }),
        ]),
        asOfCommit: z.string().regex(COMMIT_SHA_REGEX, 'asOfCommit must be a 40-hex SHA'),
        // S4 (#2189 item 2): the frozen code-path classifier + exclusion flags the
        // resolver re-derives against. Additive-optional so existing harness locks
        // parse unchanged; `codePathClassifier` is required at CERTIFYING resolve
        // (the resolver hard-errors if absent — no safe code-default for "what is
        // code"). Flags default to the strategy-claude-ratified lean (exclude).
        codePathClassifier: z
          .object({
            // includeGlobs must list ≥1 glob — an empty set makes EVERY file
            // non-code, so the certifying gate would false-fail "Extra: [all PRs]"
            // (greptile P2). excludeGlobs may be empty (no exclusions).
            includeGlobs: z
              .array(z.string().min(1))
              .min(1, 'includeGlobs must list at least one glob'),
            excludeGlobs: z.array(z.string().min(1)),
          })
          .optional(),
        excludeRevertPairs: z.boolean().default(true),
        excludeBotPrs: z.boolean().default(true),
      }),
      resolvedPrs: z.array(ResolvedPrSchema).min(1, 'resolvedPrs must be non-empty'),
    }),
    fpDefinition: z.object({
      rubricRef: z.string(),
      groundTruthRef: z.string(),
      adjudicator: z.string(),
      precisionFloor: z.literal(1.0),
    }),
    controls: z.object({
      positiveRef: z.string(),
      negativeRef: z.string(),
      integrity: z.object({
        mechanism: z.string(),
        // fixtureSha is a git hash-object digest (40-hex) that feeds the
        // hard-error integrity gate — validate its format here so a malformed
        // value fails at parse, not cryptically at run (greptile P2).
        fixtureSha: z.string().regex(COMMIT_SHA_REGEX, 'fixtureSha must be a 40-hex SHA'),
        // L2 (5c-ii): the EXTERNAL expected-hash for the frozen `llm-replay.v1`
        // fixture — a sha256 (64-hex) from `computeArtifactHash` over the whole
        // replay artifact (incl. prompt/provider provenance). Single-homed here
        // beside fixtureSha (Tenet 20: one freeze-manifest per cert run). The
        // `run` path sources it and passes it to `assertFixtureIntegrity`, so a
        // tampered/stale fixture fails loud. Additive-optional: harness locks
        // (no LLM stage) parse unchanged; the certifying record/replay wiring
        // requires it (the run hard-errors if absent — no safe default for an
        // integrity hash).
        llmReplaySha: z
          .string()
          .regex(SHA256_REGEX, 'llmReplaySha must be a 64-hex sha256')
          .optional(),
        // #709 fold-2 (codex panel): an integrity digest over the SCORING source
        // `pr-diffs.json`, which `loadCertRunFixtures` reads independently of the
        // control dirs. `fixtureSha` hashes only the control dirs, so a tampered
        // `corpus`-kind (or any) row in pr-diffs.json would pass every runtime check.
        // ENCODING (pin — greptile panel): this sha256 (64-hex) is taken over the
        // EXACT on-disk `pr-diffs.json` bytes (canonical 2-space JSON + trailing
        // newline, as the producer writes them), so a freeze/run enforcer can
        // `sha256` the file directly — NOT over the compact `canonicalStringify`.
        // STAMPED by the producer; the certifying run/freeze re-derive + assertion
        // that makes it runtime-authoritative is a follow-up slice (#2225) — NOT yet
        // wired here, so the hole is not closed until it lands. Additive-optional:
        // harness locks (no scoring corpus) parse unchanged; once the enforcement
        // lands the certifying path will hard-error if absent (no safe default for
        // an integrity hash).
        prDiffsSha: z.string().regex(SHA256_REGEX, 'prDiffsSha must be a 64-hex sha256').optional(),
      }),
    }),
    cullRateThreshold: z
      .number()
      .min(0, 'cullRateThreshold must be >= 0')
      .lt(1, 'cullRateThreshold must be < 1'),
    exposureDenominator: z.object({
      activeRulesEvaluated: z.object({
        floor: z
          .number()
          .int()
          .min(
            MIN_ACTIVE_RULES_FLOOR,
            `activeRulesEvaluated.floor must be >= ${MIN_ACTIVE_RULES_FLOOR}`,
          ),
      }),
      filesTouchedInWindow: z.object({
        floor: z.number().int().nonnegative(),
      }),
      positiveControlsExercised: z.object({
        floor: z.number().int().nonnegative(),
      }),
    }),
  })
  .superRefine((data, ctx) => {
    const prs = data.corpus.resolvedPrs;
    const prNums = prs.map((p) => p.pr);

    // C4: unique pr numbers
    const uniquePrs = new Set(prNums);
    if (uniquePrs.size !== prNums.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'resolvedPrs must have unique pr numbers',
        path: ['corpus', 'resolvedPrs'],
      });
    }

    // C4: sorted ascending by pr number
    const sortedPrNums = [...prNums].sort((a, b) => a - b);
    for (let i = 0; i < prNums.length; i++) {
      if (prNums[i] !== sortedPrNums[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'resolvedPrs must be sorted ascending by pr number',
          path: ['corpus', 'resolvedPrs'],
        });
        break;
      }
    }
  });

export type WindtunnelLock = z.infer<typeof WindtunnelLockSchema>;

// ─── Utilities ───────────────────────────────────────

/**
 * Compute a content-based per-firing label id (A2).
 * Keyed on hash(ruleId + pr + filePath + normalizedMatchedLineText) to survive
 * line-drift without raw line-number anchoring.
 */
export function firingLabelId(
  ruleId: string,
  pr: number,
  filePath: string,
  normalizedMatchedLineText: string,
): string {
  // A3: normalize path to forward-slash (Windows cross-platform)
  const normalizedPath = filePath.replace(/\\/g, '/');
  return createHash('sha256')
    .update(`${ruleId}\x00${pr}\x00${normalizedPath}\x00${normalizedMatchedLineText}`)
    .digest('hex');
}

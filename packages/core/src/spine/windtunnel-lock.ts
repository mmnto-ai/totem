import { createHash } from 'node:crypto';

import { z } from 'zod';

// ─── Named constants ─────────────────────────────────

const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;
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
        fixtureSha: z.string(),
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

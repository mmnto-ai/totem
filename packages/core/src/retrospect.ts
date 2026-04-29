/**
 * Retrospect schemas + pure helpers for `totem retrospect <pr>`
 * (mmnto-ai/totem#1713).
 *
 * Substrate of the bot-tax cluster — the deterministic circuit-breaker
 * that fires when a PR has accumulated enough bot-review rounds to
 * suggest the loop has stalled. Reuses `recurrence-stats.ts` primitives
 * (`computeSignature`, `normalizeFindingBody`, `toSeverityBucket`) so
 * the bot-tax cluster (#1715 / #1714 / #1713) has a single severity +
 * signature vocabulary.
 *
 * Everything in this file is pure: Zod schemas + deterministic helpers.
 * No I/O, no command logic. No LLM. No GitHub API writes.
 */

import { z } from 'zod';

import { computeSignature, normalizeFindingBody } from './recurrence-stats.js';
import { RecurrenceSeverityBucketSchema } from './recurrence-stats.js';

// ─── Zod schemas ────────────────────────────────────

/** A push-grouped review round on the target PR. */
export const RetrospectRoundSchema = z.object({
  /** 1-based, monotonically increasing in submission order. */
  roundNumber: z.number().int().min(1),
  /** ISO 8601 timestamp of the earliest review submission for this round. */
  submittedAt: z.string(),
  /** PR head SHA at review time; absent when the upstream review record lacks `commit_id`. */
  headSha: z.string().optional(),
  /** Number of bot findings tied to this round. */
  findingCount: z.number().int().min(0),
});

export type RetrospectRound = z.infer<typeof RetrospectRoundSchema>;

/**
 * Classification verdict for a single bot finding.
 *
 * - `route-out` — finding is better tracked as a follow-up issue than blocking the current PR.
 * - `in-pr-fix` — finding should be addressed before merge.
 * - `undetermined` — no heuristic signal fired; contributor judgment.
 */
export const RetrospectClassificationSchema = z.enum(['route-out', 'in-pr-fix', 'undetermined']);

export type RetrospectClassification = z.infer<typeof RetrospectClassificationSchema>;

/** Source classification of a finding (mirror of `RecurrenceTool` minus `'mixed'`). */
const RetrospectFindingToolSchema = z.enum(['coderabbit', 'gca', 'sarif', 'override', 'unknown']);

/** A single bot finding enriched with substrate signals + classification. */
export const RetrospectFindingSchema = z.object({
  /** Stable signature hash (16-char) — matches the recurrence-stats vocabulary. */
  signature: z.string().min(1),
  /** Source bot/tool. */
  tool: RetrospectFindingToolSchema,
  /** Normalized severity bucket. */
  severityBucket: RecurrenceSeverityBucketSchema,
  /** First 280 chars of the raw body (for human triage). */
  bodyExcerpt: z.string(),
  /** File path attached to the finding (`(review body)` for CR outside-diff/nits). */
  file: z.string(),
  /** Best-effort line number. */
  line: z.number().int().positive().optional(),
  /** Round number assigned by `groupFindingsByRound`. */
  roundNumber: z.number().int().min(1),
  /** Count of OTHER PRs sharing this signature (target PR excluded). */
  crossPrRecurrence: z.number().int().min(0),
  /** True if the signature heuristically maps to an existing compiled rule (Jaccard ≥ 0.6). */
  coveredByRule: z.boolean(),
  /** Deterministic classification verdict. */
  classification: RetrospectClassificationSchema,
  /** Reason string from a fixed catalog when classification is `route-out`. */
  routeOutReason: z.string().optional(),
});

export type RetrospectFinding = z.infer<typeof RetrospectFindingSchema>;

const RetrospectFindingDistributionSchema = z.object({
  byTool: z.record(z.string(), z.number().int().min(0)),
  bySeverity: z.record(z.string(), z.number().int().min(0)),
  byClassification: z.record(z.string(), z.number().int().min(0)),
});

/** Top-level shape emitted by `runRetrospect` and optionally written via `--out`. */
export const RetrospectReportSchema = z.object({
  /** Schema version for forward-compat. */
  version: z.literal(1),
  /** Target PR number (string for parity with recurrence-stats prsScanned). */
  prNumber: z.string(),
  /** Open / closed / merged at fetch time. */
  prState: z.string(),
  /** ISO 8601 generation timestamp. */
  generatedAt: z.string(),
  /** Resolved threshold (after option clamping). */
  threshold: z.number().int().min(1),
  /** True iff `.totem/recurrence-stats.json` was loaded successfully. */
  substrateAvailable: z.boolean(),
  /** True iff `compiled-rules.json` was loaded successfully. */
  compiledRulesAvailable: z.boolean(),
  /** Push-grouped rounds (ordered by earliest submittedAt per head_sha). */
  rounds: z.array(RetrospectRoundSchema),
  /** Total bot findings (inline + review-body). */
  totalFindings: z.number().int().min(0),
  /** `1 - uniqueSignatures/totalFindings`, clamped to [0,1]; 0 when totalFindings == 0. */
  dedupRate: z.number().min(0).max(1),
  /** Distribution counts. */
  findingDistribution: RetrospectFindingDistributionSchema,
  /** Findings classified as `route-out`. */
  routeOutCandidates: z.array(RetrospectFindingSchema),
  /** Findings classified as `in-pr-fix`. */
  inPrFixes: z.array(RetrospectFindingSchema),
  /** Findings classified as `undetermined`. */
  undetermined: z.array(RetrospectFindingSchema),
  /** Deterministic stop-condition templates (no prose generation). */
  stopConditions: z.array(z.string()),
  /** Trap-ledger override events read for this PR (read-only count). */
  overrideEventsObserved: z.number().int().min(0),
});

export type RetrospectReport = z.infer<typeof RetrospectReportSchema>;

// ─── Round grouping ─────────────────────────────────

/** Minimal review-submission shape (subset of GitHub's `pulls/N/reviews`). */
export interface RetrospectReviewSubmission {
  id: number;
  /** PR head SHA at review submission time; may be absent for some review states. */
  commit_id?: string | null;
  /** ISO 8601 timestamp. */
  submitted_at?: string | null;
  /** Bot login. */
  user_login: string;
}

/** Minimal review-comment shape (subset of `StandardReviewComment`). */
export interface RetrospectReviewComment {
  id: number;
  author: string;
  createdAt?: string;
}

/**
 * Group bot review submissions by `commit_id` (head SHA).
 *
 * - Two reviews on the same `commit_id` → same round.
 * - Reviews missing `commit_id` are bucketed into a single synthetic
 *   round (head SHA `undefined`) so they don't double-count as N rounds.
 * - Round ordering is by EARLIEST `submitted_at` within each SHA bucket.
 * - Round numbers are 1-based.
 *
 * `findingCount` requires `groupFindingsByRound` to receive the corresponding
 * inline-comment list keyed by SHA via `findingShaBySubmissionId`. The mapping
 * is computed by the caller because `pulls/N/comments` and `pulls/N/reviews`
 * are separate GH endpoints and the join is push-based, not in-memory native.
 *
 * To keep the helper pure, this function returns the round index ONLY.
 * Callers walk findings + assign each to a round by submission timestamp.
 */
export function groupFindingsByRound(
  reviewSubmissions: ReadonlyArray<RetrospectReviewSubmission>,
  findingsPerRoundCount: ReadonlyMap<string, number>,
): RetrospectRound[] {
  // Bucket submissions by commit_id (treating null/undefined as the same key).
  const bySha = new Map<string, RetrospectReviewSubmission[]>();
  for (const sub of reviewSubmissions) {
    const key = typeof sub.commit_id === 'string' && sub.commit_id.length > 0 ? sub.commit_id : '';
    let bucket = bySha.get(key);
    if (!bucket) {
      bucket = [];
      bySha.set(key, bucket);
    }
    bucket.push(sub);
  }

  // Compute earliest timestamp per SHA + retain bucket order.
  interface Bucket {
    sha: string;
    earliest: string;
  }
  const buckets: Bucket[] = [];
  for (const [sha, subs] of bySha) {
    let earliest = '';
    for (const s of subs) {
      const t = typeof s.submitted_at === 'string' ? s.submitted_at : '';
      if (t.length === 0) continue;
      if (earliest.length === 0 || t < earliest) earliest = t;
    }
    buckets.push({ sha, earliest });
  }

  // Stable sort by earliest timestamp ascending; missing timestamp sinks last.
  buckets.sort((a, b) => {
    if (a.earliest === '' && b.earliest !== '') return 1;
    if (a.earliest !== '' && b.earliest === '') return -1;
    if (a.earliest < b.earliest) return -1;
    if (a.earliest > b.earliest) return 1;
    return 0;
  });

  const rounds: RetrospectRound[] = [];
  let roundNumber = 1;
  for (const bucket of buckets) {
    rounds.push({
      roundNumber,
      submittedAt: bucket.earliest,
      headSha: bucket.sha.length > 0 ? bucket.sha : undefined,
      findingCount: findingsPerRoundCount.get(bucket.sha) ?? 0,
    });
    roundNumber += 1;
  }
  return rounds;
}

// ─── Classifier table ───────────────────────────────

/**
 * Coarse round-position bucket. The exact thresholds are a v0.1 heuristic
 * documented in `.totem/specs/1713.md` — early ≤ 3, mid 4-9, late ≥ 10.
 */
export type RetrospectRoundPosition = 'early' | 'mid' | 'late';

export function toRoundPosition(roundNumber: number): RetrospectRoundPosition {
  if (roundNumber <= 3) return 'early';
  if (roundNumber <= 9) return 'mid';
  return 'late';
}

/** Coarse cross-PR recurrence bucket. */
export type RetrospectCrossPrBucket = 'none' | 'some' | 'frequent';

export function toCrossPrBucket(crossPrRecurrence: number): RetrospectCrossPrBucket {
  if (crossPrRecurrence <= 0) return 'none';
  if (crossPrRecurrence <= 2) return 'some';
  return 'frequent';
}

/**
 * Fixed catalog of route-out reasons. Keep deterministic — every reason
 * a classifier emits MUST come from this catalog so the report doesn't
 * accumulate a long-tail of one-off prose strings.
 */
export const RETROSPECT_ROUTE_OUT_REASONS = {
  COVERED_BY_RULE: 'covered by existing compiled rule',
  RULE_COVERED_LATE: 'rule-covered class flagged late — retroactive shouldn’t block ship',
  FREQUENT_CROSS_PR: 'frequent across other PRs — file follow-up to compile into a rule',
  LOW_NIT_LATE: 'low/nit severity flagged late in the bot-review loop',
} as const;

export type RetrospectRouteOutReason =
  (typeof RETROSPECT_ROUTE_OUT_REASONS)[keyof typeof RETROSPECT_ROUTE_OUT_REASONS];

/** Input to the deterministic classifier. */
export interface ClassifyFindingInput {
  severityBucket: 'critical' | 'high' | 'medium' | 'low' | 'nit';
  roundNumber: number;
  crossPrRecurrence: number;
  coveredByRule: boolean;
}

/**
 * Deterministic, table-driven classifier. Same inputs → same outputs across
 * invocations. Reason strings are drawn exclusively from
 * `RETROSPECT_ROUTE_OUT_REASONS` so consumers can treat them as a closed set.
 *
 * Heuristic intent (v0.1):
 * - `critical` or `high` at any round → `in-pr-fix` (regardless of recurrence/coverage)
 * - `low`/`nit` late + (`coveredByRule` OR `crossPrRecurrence frequent`) → `route-out`
 * - `medium` late + `coveredByRule` → `route-out`
 * - `medium` early/mid → `in-pr-fix`
 * - `nit` early/mid → `in-pr-fix`
 * - else → `undetermined`
 */
export function classifyFinding(input: ClassifyFindingInput): {
  classification: RetrospectClassification;
  routeOutReason?: RetrospectRouteOutReason;
} {
  const { severityBucket, coveredByRule } = input;
  const position = toRoundPosition(input.roundNumber);
  const recurrence = toCrossPrBucket(input.crossPrRecurrence);

  // Critical / high — always block the PR.
  if (severityBucket === 'critical' || severityBucket === 'high') {
    return { classification: 'in-pr-fix' };
  }

  // Late-round low/nit — route out when covered or frequent.
  if (severityBucket === 'low' || severityBucket === 'nit') {
    if (position === 'late') {
      if (coveredByRule) {
        return {
          classification: 'route-out',
          routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.COVERED_BY_RULE,
        };
      }
      if (recurrence === 'frequent') {
        return {
          classification: 'route-out',
          routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.FREQUENT_CROSS_PR,
        };
      }
      return {
        classification: 'route-out',
        routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.LOW_NIT_LATE,
      };
    }
    // Cheap to fix inline early/mid.
    if (severityBucket === 'nit') return { classification: 'in-pr-fix' };
    // low at early/mid: default to in-pr-fix unless rule-covered (then route-out).
    if (coveredByRule) {
      return {
        classification: 'route-out',
        routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.COVERED_BY_RULE,
      };
    }
    return { classification: 'in-pr-fix' };
  }

  // Medium severity.
  if (severityBucket === 'medium') {
    if (position === 'late' && coveredByRule) {
      return {
        classification: 'route-out',
        routeOutReason: RETROSPECT_ROUTE_OUT_REASONS.RULE_COVERED_LATE,
      };
    }
    return { classification: 'in-pr-fix' };
  }

  // Should be unreachable given the enum, but kept for total-function hygiene.
  return { classification: 'undetermined' };
}

// ─── Stop-conditions ────────────────────────────────

/**
 * Deterministic stop-condition templates keyed off the report shape. No
 * prose generation; only integer substitution. Returns the catalog
 * filtered to entries whose triggering condition fires for the given
 * report.
 */
export function buildStopConditions(
  report: Pick<
    RetrospectReport,
    'rounds' | 'routeOutCandidates' | 'inPrFixes' | 'dedupRate' | 'findingDistribution'
  >,
): string[] {
  const out: string[] = [];

  const lastRound = report.rounds[report.rounds.length - 1];
  const roundCount = report.rounds.length;

  // 1. Route-out candidates exist → "ship + file N follow-up issue(s)".
  if (report.routeOutCandidates.length > 0) {
    const n = report.routeOutCandidates.length;
    out.push(
      `If next round contains only nit-severity findings, ship + file ${n} follow-up issue(s) for the route-out candidates above.`,
    );
  }

  // 2. ≥ 50% of LAST round's findings are rule-covered → consider shipping.
  if (lastRound && lastRound.findingCount > 0) {
    const lastRoundFindings = report.routeOutCandidates
      .concat(report.inPrFixes)
      .filter((f) => f.roundNumber === lastRound.roundNumber);
    const ruleCovered = lastRoundFindings.filter((f) => f.coveredByRule).length;
    const ratio = ruleCovered / Math.max(1, lastRoundFindings.length);
    if (ratio >= 0.5) {
      const pct = Math.round(ratio * 100);
      out.push(
        `Round count ${roundCount} exceeds threshold; ${pct}% of round-${lastRound.roundNumber} findings are already covered by compiled rules — consider shipping.`,
      );
    }
  }

  // 3. Frequent-recurrence route-out subset is non-empty.
  const frequentRouteOuts = report.routeOutCandidates.filter(
    (f) => toCrossPrBucket(f.crossPrRecurrence) === 'frequent',
  );
  if (frequentRouteOuts.length > 0) {
    out.push(
      `${frequentRouteOuts.length} finding(s) recur across other PRs; if not addressed inline, file follow-up issues to add them to the compiled-rules manifest.`,
    );
  }

  // 4. High dedup rate → comment-drift suspicion.
  if (report.dedupRate >= 0.4) {
    const uniquePct = Math.round((1 - report.dedupRate) * 100);
    out.push(
      `PR has ${roundCount} round(s) with ${uniquePct}% unique signatures; high dedup rate suggests comment-drift — consider squashing finding-fix commits before re-pushing to reduce bot re-review surface area.`,
    );
  }

  return out;
}

// ─── Dedup math ─────────────────────────────────────

/**
 * Compute `1 - uniqueSignatures / totalFindings`, clamped to [0, 1].
 *
 * - 0 findings → 0 (no findings, no dedup pressure).
 * - All unique → 0.
 * - All duplicates of one signature → close to 1 (`1 - 1/N`).
 */
export function computeDedupRate(findings: ReadonlyArray<{ signature: string }>): number {
  if (findings.length === 0) return 0;
  const seen = new Set<string>();
  for (const f of findings) seen.add(f.signature);
  const rate = 1 - seen.size / findings.length;
  if (rate < 0) return 0;
  if (rate > 1) return 1;
  return rate;
}

// ─── Convenience signature helper ───────────────────

/**
 * Compute a stable signature for a finding body using the
 * recurrence-stats normalization pipeline. Re-exported here so callers
 * outside the cli package don't need to call `normalizeFindingBody +
 * computeSignature` separately.
 */
export function signatureOfBody(body: string): string {
  return computeSignature(normalizeFindingBody(body));
}

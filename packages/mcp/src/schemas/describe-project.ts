/**
 * Zod schemas for the describe_project MCP tool.
 *
 * The legacy slim payload (project, tier, rules, lessons, targets, partitions,
 * hooks) is preserved byte-identical when `includeRichState` is false or
 * omitted. Rich state is opt-in via the input parameter and attaches as an
 * optional `richState` field on the output.
 *
 * Implements ADR-090 Deferred Decision #2 (describe_project as substrate:
 * reports state, self-routing remains the agent's decision).
 */

import { z } from 'zod';

/**
 * Cap the uncommitted-files list to protect the MCP stdio pipe and the
 * consuming agent's context window. A dirty tree with thousands of staged
 * files should still produce a useful briefing payload.
 */
export const UNCOMMITTED_FILES_CAP = 50;

/**
 * Number of recent merged PRs returned in the briefing. Keep small so the
 * payload stays fast and the agent sees the most relevant history.
 */
export const RECENT_PRS_COUNT = 5;

// ─── Input ─────────────────────────────────────────────────────────────────

/**
 * `.default(false)` keeps legacy callers (empty input object) byte-identical
 * to today's output. Opt-in is the only path that extends the response shape.
 */
export const DescribeProjectInputSchema = z.object({
  includeRichState: z.boolean().optional().default(false),
});

export type DescribeProjectInput = z.infer<typeof DescribeProjectInputSchema>;

// ─── Rich state sub-schemas ────────────────────────────────────────────────

/**
 * Strategy-pointer payload (mmnto-ai/totem#1710).
 *
 * Discriminated union on the `resolved` flag so consumers can pattern-match
 * without inferring intent from null fields. The `resolved: false` branch
 * surfaces the resolver's `reason` string so an agent reading the rich-state
 * payload can render an actionable message instead of an empty pointer.
 *
 * Pre-1710 callers received `{ sha, latestJournal }` directly. The new shape
 * is a breaking change to the MCP `describe_project` rich-state output;
 * documented in CHANGELOG.
 */
export const StrategyPointerSchema = z.discriminatedUnion('resolved', [
  z.object({
    resolved: z.literal(true),
    /** Short-form 7-char SHA of the resolved strategy HEAD. Null when git rev-parse fails inside the strategy dir. */
    sha: z.string().nullable(),
    /** Filename of the most recent `<strategyRoot>/.journal/*.md` entry, no path. Null when `.journal/` is missing or empty. */
    latestJournal: z.string().nullable(),
  }),
  z.object({
    resolved: z.literal(false),
    /** Human-readable reason from the strategy-root resolver. */
    reason: z.string(),
  }),
]);
export type StrategyPointer = z.infer<typeof StrategyPointerSchema>;

export const GitStateSchema = z.object({
  /** Current branch name. Null when running outside a git repo or in detached HEAD. */
  branch: z.string().nullable(),
  /** Uncommitted files (staged + unstaged). Capped at UNCOMMITTED_FILES_CAP. */
  uncommittedFiles: z.array(z.string()),
  /** True when the real uncommitted count exceeded UNCOMMITTED_FILES_CAP. */
  truncated: z.boolean(),
});
export type GitState = z.infer<typeof GitStateSchema>;

export const RecentPrSchema = z.object({
  /** Squash-merge commit title including the `(#NNNN)` PR suffix. */
  title: z.string(),
  /** ISO-8601 commit date. */
  date: z.string(),
  /** Short-form 7-char commit SHA. */
  squashSha: z.string(),
});
export type RecentPr = z.infer<typeof RecentPrSchema>;

export const RuleCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  nonCompilable: z.number().int().nonnegative(),
});
export type RuleCounts = z.infer<typeof RuleCountsSchema>;

export const MilestoneStateSchema = z.object({
  /** Milestone name (e.g. "1.15.0"). Null when not parseable from active_work.md. */
  name: z.string().nullable(),
  /** List of ticket references carrying the active gate label (e.g. pre-1.15-review). */
  gateTickets: z.array(z.string()),
  /**
   * Marks this payload as parsed best-effort from `docs/active_work.md` and
   * not a cryptographic truth. Agents should treat it as a hint, not a
   * ground-truth source.
   */
  bestEffort: z.literal(true),
});
export type MilestoneState = z.infer<typeof MilestoneStateSchema>;

export const RichProjectStateSchema = z.object({
  strategyPointer: StrategyPointerSchema,
  gitState: GitStateSchema,
  /** Fixed-group package versions (e.g. `@mmnto/cli`). Entries omit when extraction fails for that package. */
  packageVersions: z.record(z.string()),
  ruleCounts: RuleCountsSchema,
  /** Count of `.totem/lessons/*.md` files. Zero if the directory is missing. */
  lessonCount: z.number().int().nonnegative(),
  /**
   * Test count from stored metadata. Null in v1 — no artifact is stamped
   * today. Follow-up ticket wires postmerge to produce `.totem/store/test-stats.json`.
   */
  testCount: z.number().int().nonnegative().nullable(),
  milestone: MilestoneStateSchema,
  recentPrs: z.array(RecentPrSchema),
});

export type RichProjectState = z.infer<typeof RichProjectStateSchema>;

// ─── Output ────────────────────────────────────────────────────────────────

/**
 * Legacy `ProjectDescription` shape as returned by core `describeProject()`.
 * Kept in this file for schema co-location; the source of truth is the
 * `ProjectDescription` interface in `@mmnto/totem`.
 */
export const LegacyProjectDescriptionSchema = z.object({
  project: z.string(),
  description: z.string().optional(),
  tier: z.enum(['lite', 'standard', 'full']),
  rules: z.number(),
  lessons: z.number(),
  targets: z.array(z.string()),
  partitions: z.record(z.array(z.string())),
  hooks: z.array(z.string()),
});

/**
 * Output schema: legacy shape + optional rich state. Callers that omit
 * `includeRichState` (or pass false) get a payload without the `richState`
 * field at all — the JSON output is byte-identical to today's.
 */
export const DescribeProjectOutputSchema = LegacyProjectDescriptionSchema.extend({
  richState: RichProjectStateSchema.optional(),
});

export type DescribeProjectOutput = z.infer<typeof DescribeProjectOutputSchema>;

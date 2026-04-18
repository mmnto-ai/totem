import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// ─── Schema ─────────────────────────────────────────

const ContextCountsSchema = z.object({
  code: z.number().int().nonnegative(),
  string: z.number().int().nonnegative(),
  comment: z.number().int().nonnegative(),
  regex: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export type ContextCounts = z.infer<typeof ContextCountsSchema>;

const RuleMetricSchema = z.object({
  /**
   * Number of times this rule's pattern matched an added line. Includes matches
   * in non-code contexts (strings, comments) that are recorded as telemetry but
   * do NOT produce violations. Use `contextCounts.code` for violation count.
   */
  triggerCount: z.number().int().nonnegative(),
  /** Number of times this rule was suppressed via totem-ignore */
  suppressCount: z.number().int().nonnegative(),
  /** ISO timestamp of last trigger */
  lastTriggeredAt: z.string().nullable(),
  /** ISO timestamp of last suppression */
  lastSuppressedAt: z.string().nullable(),
  /** Tracks where regex rules fire: code, string, comment, regex, or unknown context */
  contextCounts: ContextCountsSchema.optional(),
  /**
   * Number of lint runs that loaded and evaluated this rule (mmnto-ai/totem#1483).
   * Incremented once per rule per `totem lint` / `totem review` invocation
   * regardless of how many matches fire, so `totem doctor` can distinguish a
   * rule that never ran from a rule that ran many times with zero matches.
   * Defaults to 0 for pre-#1483 rule-metrics.json files; grows monotonically
   * and never resets. ADR-088 Phase 1 Layer 4 substrate for stale-rule
   * detection.
   */
  evaluationCount: z.number().int().nonnegative().default(0),
});

export type RuleMetric = z.infer<typeof RuleMetricSchema>;

const RuleMetricsFileSchema = z.object({
  version: z.literal(1),
  /** Map of lessonHash → metrics */
  rules: z.record(RuleMetricSchema),
});

export type RuleMetricsFile = z.infer<typeof RuleMetricsFileSchema>;

// ─── File I/O ───────────────────────────────────────

const METRICS_FILE = 'cache/rule-metrics.json';

function metricsPath(totemDir: string): string {
  return path.join(totemDir, METRICS_FILE);
}

/** Load rule metrics from disk. Returns empty metrics if file is missing or invalid. */
export function loadRuleMetrics(totemDir: string, onWarn?: (msg: string) => void): RuleMetricsFile {
  const filePath = metricsPath(totemDir);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return RuleMetricsFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    // ENOENT is expected on first run — silently return empty metrics
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, rules: {} };
    }
    // Other errors (permissions, corrupt JSON) — warn but don't crash
    onWarn?.(`Could not load rule metrics: ${err instanceof Error ? err.message : String(err)}`);
    return { version: 1, rules: {} };
  }
}

/** Save rule metrics to disk. Creates the directory if needed. */
export function saveRuleMetrics(totemDir: string, metrics: RuleMetricsFile): void {
  const filePath = metricsPath(totemDir);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(metrics, null, 2) + '\n', 'utf-8');
}

// ─── Recording ──────────────────────────────────────

/** Record a rule trigger (violation detected). */
export function recordTrigger(metrics: RuleMetricsFile, lessonHash: string): void {
  const entry = getOrCreate(metrics, lessonHash);
  entry.triggerCount++;
  entry.lastTriggeredAt = new Date().toISOString();
}

/** Record a rule suppression (totem-ignore matched). */
export function recordSuppression(metrics: RuleMetricsFile, lessonHash: string): void {
  const entry = getOrCreate(metrics, lessonHash);
  entry.suppressCount++;
  entry.lastSuppressedAt = new Date().toISOString();
}

/**
 * Record that a lint run loaded and evaluated this rule (mmnto-ai/totem#1483).
 * Must fire exactly once per rule per lint run — NOT once per match. The
 * `runCompiledRules` caller loops over every active rule at the end of each
 * run and calls this helper; multiple triggers on the same rule within one
 * run still produce only one increment here.
 *
 * The caller (`runCompiledRules`) owns loop-once discipline. This helper is
 * dumb on purpose: it takes a hash and adds one. Downstream consumers
 * (`totem doctor` stale-rule check) rely on the invariant that
 * `evaluationCount >= triggerCount / contextCounts.*` never holds in a way
 * that contradicts "one run = one eval".
 */
export function recordEvaluation(metrics: RuleMetricsFile, lessonHash: string): void {
  const entry = getOrCreate(metrics, lessonHash);
  entry.evaluationCount++;
}

/** Record the AST context where a rule fired. */
export function recordContextHit(
  metrics: RuleMetricsFile,
  lessonHash: string,
  context: 'code' | 'string' | 'comment' | 'regex' | undefined,
): void {
  const entry = getOrCreate(metrics, lessonHash);
  if (!entry.contextCounts) {
    // Seed unknown with historical triggers (exclude the current one, which will be counted below)
    const historical = Math.max(0, entry.triggerCount - 1);
    entry.contextCounts = { code: 0, string: 0, comment: 0, regex: 0, unknown: historical };
  }
  entry.contextCounts[context ?? 'unknown']++;
}

function getOrCreate(metrics: RuleMetricsFile, lessonHash: string): RuleMetric {
  let entry = metrics.rules[lessonHash];
  if (!entry) {
    entry = {
      triggerCount: 0,
      suppressCount: 0,
      lastTriggeredAt: null,
      lastSuppressedAt: null,
      evaluationCount: 0,
    };
    metrics.rules[lessonHash] = entry;
  }
  return entry;
}

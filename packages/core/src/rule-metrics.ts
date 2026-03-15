import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// ─── Schema ─────────────────────────────────────────

const RuleMetricSchema = z.object({
  /** Number of times this rule triggered a violation */
  triggerCount: z.number().int().nonnegative(),
  /** Number of times this rule was suppressed via totem-ignore */
  suppressCount: z.number().int().nonnegative(),
  /** ISO timestamp of last trigger */
  lastTriggeredAt: z.string().nullable(),
  /** ISO timestamp of last suppression */
  lastSuppressedAt: z.string().nullable(),
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
export function loadRuleMetrics(totemDir: string): RuleMetricsFile {
  const filePath = metricsPath(totemDir);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return RuleMetricsFileSchema.parse(JSON.parse(raw));
  } catch {
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

function getOrCreate(metrics: RuleMetricsFile, lessonHash: string): RuleMetric {
  let entry = metrics.rules[lessonHash];
  if (!entry) {
    entry = {
      triggerCount: 0,
      suppressCount: 0,
      lastTriggeredAt: null,
      lastSuppressedAt: null,
    };
    metrics.rules[lessonHash] = entry;
  }
  return entry;
}

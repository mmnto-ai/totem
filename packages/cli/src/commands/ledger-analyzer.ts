import * as fs from 'node:fs';
import * as readline from 'node:readline';

import { LedgerEventSchema } from '@mmnto/totem';

// ─── Types ─────────────────────────────────────────

export interface RuleBypassStats {
  ruleId: string;
  /** Number of rule triggers (from rule-metrics.json) */
  triggerCount: number;
  /** Number of bypass events — suppress + override (from ledger) */
  bypassCount: number;
  /** bypassCount / (triggerCount + bypassCount), 0 when no events */
  bypassRate: number;
  /** triggerCount + bypassCount */
  totalEvents: number;
}

// ─── Public API ────────────────────────────────────

/**
 * Analyze the Trap Ledger to compute bypass rates per rule.
 *
 * Reads bypass events from the ledger (source of truth for exceptions)
 * and trigger counts from rule-metrics (only source for trigger data).
 */
export async function analyzeLedger(
  totemDir: string,
  onWarn?: (msg: string) => void,
): Promise<Map<string, RuleBypassStats>> {
  // 1. Read bypass counts from ledger (streaming)
  const bypassCounts = await readLedgerBypassCounts(totemDir, onWarn);

  // 2. Read trigger counts from rule-metrics
  const { loadRuleMetrics } = await import('@mmnto/totem');
  const metrics = loadRuleMetrics(totemDir, onWarn);

  // 3. Merge into stats
  const stats = new Map<string, RuleBypassStats>();

  const allRuleIds = new Set([...bypassCounts.keys(), ...Object.keys(metrics.rules)]);

  for (const ruleId of allRuleIds) {
    const bypasses = bypassCounts.get(ruleId) ?? 0;
    const triggers = metrics.rules[ruleId]?.triggerCount ?? 0;
    const total = triggers + bypasses;

    stats.set(ruleId, {
      ruleId,
      triggerCount: triggers,
      bypassCount: bypasses,
      bypassRate: total === 0 ? 0 : bypasses / total,
      totalEvents: total,
    });
  }

  return stats;
}

// ─── Internal ──────────────────────────────────────

/**
 * Stream the ledger NDJSON file and count bypass events per ruleId.
 * Uses readline for memory-efficient parsing of large ledgers.
 */
export async function readLedgerBypassCounts(
  totemDir: string,
  onWarn?: (msg: string) => void,
): Promise<Map<string, number>> {
  const path = await import('node:path');
  const ledgerPath = path.join(totemDir, 'ledger', 'events.ndjson');
  const counts = new Map<string, number>();

  if (!fs.existsSync(ledgerPath)) return counts;

  const stream = fs.createReadStream(ledgerPath, 'utf-8');
  const rl = readline.createInterface({ input: stream });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const result = LedgerEventSchema.safeParse(parsed);
      if (!result.success) continue;
      const event = result.data;
      if (event.type === 'exemption') continue;
      counts.set(event.ruleId, (counts.get(event.ruleId) ?? 0) + 1);
    } catch {
      onWarn?.('Skipping malformed ledger line');
    }
  }

  return counts;
}

import type { GarbageCollectionConfig } from '@mmnto/totem';

export interface RuleGcInput {
  lessonHash: string;
  createdAt?: string; // ISO timestamp — survives recompilation
  compiledAt: string; // ISO timestamp — reset on each compile
  category?: string;
  status?: string;
}

export interface RuleMetrics {
  triggerCount: number;
  suppressCount: number;
}

/**
 * Determine if a compiled rule should be archived based on age and activity.
 * Returns an archive reason string if the rule should be archived, or null if it should stay active.
 */
export function shouldArchiveRule(
  rule: RuleGcInput,
  metrics: RuleMetrics | undefined,
  gcConfig: GarbageCollectionConfig,
  now?: Date,
): string | null {
  // Already archived — skip
  if (rule.status === 'archived') return null;

  // Exempt categories (e.g., security) are never GC'd
  if (rule.category && (gcConfig.exemptCategories as string[]).includes(rule.category)) return null;

  // Rule must be old enough — prefer createdAt (survives recompilation) over compiledAt
  const compiledAt = new Date(rule.createdAt ?? rule.compiledAt);
  const currentDate = now ?? new Date();
  const ageDays = (currentDate.getTime() - compiledAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < gcConfig.minAgeDays) return null;

  // If no metrics exist, the rule has never been evaluated — GC candidate
  if (!metrics) {
    return `No activity after ${Math.floor(ageDays)} days`;
  }

  // If trigger count AND suppress count are both 0 — rule is dead
  if (metrics.triggerCount === 0 && metrics.suppressCount === 0) {
    return `Zero triggers after ${Math.floor(ageDays)} days`;
  }

  return null;
}

import type { NormalizedBotFinding } from './bot-review-parser.js';

/** Triage categories ordered by blast radius */
export type TriageCategory = 'security' | 'architecture' | 'convention' | 'nit';

/** A finding with heuristic category assignment and dedup info */
export interface CategorizedFinding extends NormalizedBotFinding {
  triageCategory: TriageCategory;
  /** Unique ID for dedup grouping */
  dedupKey: string;
  /** Other findings merged into this one during dedup */
  mergedWith?: NormalizedBotFinding[];
}

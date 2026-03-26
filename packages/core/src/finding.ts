import type { CompiledRule, Violation } from './compiler-schema.js';

// ─── Finding types ──────────────────────────────────

export type FindingSeverity = 'error' | 'warning' | 'info';
export type FindingSource = 'lint' | 'shield';
export type FindingCategory = 'security' | 'architecture' | 'style' | 'performance';

/**
 * Unified finding model — canonical output shape for both lint and shield.
 * Consumed by SARIF, PR comments, and CLI output formatters.
 * ADR-071: Unified Findings Model.
 */
export interface TotemFinding {
  /** Unique finding ID — lessonHash for lint, generated for shield */
  id: string;
  /** Which system produced this finding */
  source: FindingSource;
  /** Severity level — unified across lint and shield */
  severity: FindingSeverity;
  /** Human-readable description */
  message: string;
  /** File path (relative to project root) */
  file?: string;
  /** 1-based line number */
  line?: number;
  /** Matched source line content (lint only) */
  matchedLine?: string;
  /** Rule/lesson heading (lint) or category label (shield) */
  ruleHeading?: string;
  /** Confidence score 0-1 (shield only, always 1.0 for lint) */
  confidence: number;
  /** Category tag */
  category?: FindingCategory;
}

// ─── Converters ─────────────────────────────────────

/** Convert a lint Violation into a unified TotemFinding. */
export function violationToFinding(v: Violation): TotemFinding {
  return {
    id: v.rule.lessonHash,
    source: 'lint',
    severity: v.rule.severity ?? 'error',
    message: v.rule.message,
    file: v.file,
    line: v.lineNumber,
    matchedLine: v.line,
    ruleHeading: v.rule.lessonHeading,
    confidence: 1.0,
    category: v.rule.category as FindingCategory | undefined,
  };
}

/** Reconstruct the CompiledRule + Violation from a lint-sourced TotemFinding (for SARIF compat). */
export function findingToViolation(
  f: TotemFinding,
  ruleMap: Map<string, CompiledRule>,
): Violation | null {
  const rule = ruleMap.get(f.id);
  if (!rule) return null;
  return {
    rule,
    file: f.file ?? '',
    line: f.matchedLine ?? '',
    lineNumber: f.line ?? 0,
  };
}

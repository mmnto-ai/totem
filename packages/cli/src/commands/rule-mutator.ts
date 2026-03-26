import * as fs from 'node:fs';

// ─── Types ─────────────────────────────────────────

export interface DowngradeResult {
  /** Whether the downgrade was applied */
  downgraded: boolean;
  /** Previous severity before the change (undefined if rule not found) */
  previousSeverity?: string;
  /** Human-readable rule heading (undefined if rule not found) */
  ruleHeading?: string;
}

// ─── Public API ────────────────────────────────────

/**
 * Downgrade a rule from error to warning in compiled-rules.json.
 *
 * Returns whether the downgrade was applied.
 * Idempotent — skips rules already at warning severity.
 * Never deletes rules (ADR-027).
 */
export function downgradeRuleToWarning(rulesPath: string, ruleId: string): DowngradeResult {
  const content = fs.readFileSync(rulesPath, 'utf-8');
  const data = JSON.parse(content);

  const rule = data.rules?.find((r: { lessonHash: string }) => r.lessonHash === ruleId);
  if (!rule) return { downgraded: false };

  const currentSeverity: string = rule.severity ?? 'error';
  if (currentSeverity !== 'error') {
    return {
      downgraded: false,
      previousSeverity: currentSeverity,
      ruleHeading: rule.lessonHeading,
    };
  }

  rule.severity = 'warning';
  // Preserve 2-space indent formatting
  fs.writeFileSync(rulesPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  return {
    downgraded: true,
    previousSeverity: 'error',
    ruleHeading: rule.lessonHeading,
  };
}

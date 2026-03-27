/**
 * Extract manual pattern fields from a lesson body.
 * Pipeline 1 (Proposal 186 / ADR-058): zero-LLM compilation.
 *
 * Supported fields (case-insensitive, bold or plain):
 *   **Pattern:** <regex or ast-grep pattern>
 *   **Engine:** regex | ast | ast-grep
 *   **Scope:** glob, glob, !negated-glob
 *   **Severity:** error | warning
 */

export interface ManualPattern {
  pattern: string;
  engine: 'regex' | 'ast' | 'ast-grep';
  fileGlobs?: string[];
  severity: 'error' | 'warning';
}

export function extractField(body: string, field: string): string | undefined {
  // Match: **Field:** value, **Field**: value, Field: value
  // Colon is mandatory to avoid matching prose like "Pattern is important..."
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:\\*{2})?${safeField}:(?:\\*{2})?\\s+(.+)$`, 'im');
  const match = body.match(re);
  return match?.[1]?.trim();
}

/**
 * Try to extract manual pattern fields from a lesson body.
 * Returns null if the lesson doesn't contain a Pattern: field.
 */
export function extractManualPattern(body: string): ManualPattern | null {
  const pattern = extractField(body, 'Pattern');
  if (!pattern) return null;

  const engineRaw = extractField(body, 'Engine')?.toLowerCase();
  const engine: ManualPattern['engine'] =
    engineRaw === 'ast' ? 'ast' : engineRaw === 'ast-grep' ? 'ast-grep' : 'regex';

  const scopeRaw = extractField(body, 'Scope');
  const fileGlobs = scopeRaw
    ? scopeRaw
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
    : undefined;

  const severityRaw = extractField(body, 'Severity')?.toLowerCase();
  const severity: ManualPattern['severity'] = severityRaw === 'error' ? 'error' : 'warning';

  return { pattern, engine, fileGlobs, severity };
}

/**
 * Extract ALL values for a repeated field from a lesson body.
 * Unlike extractField (first match only), this returns every match.
 */
export function extractAllFields(body: string, field: string): string[] {
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:\\*{2})?${safeField}:(?:\\*{2})?\\s+(.+)$`, 'gim');
  return Array.from(body.matchAll(re), (m) => m[1]!.trim());
}

/** Strip surrounding backticks from an inline code value. */
export function stripInlineCode(value: string): string {
  return value.replace(/^`(.*)`$/, '$1');
}

export interface RuleExamples {
  hits: string[];
  misses: string[];
}

/**
 * Extract Example Hit/Miss lines from a lesson body.
 * Returns null if no examples are present (backward compatible).
 */
export function extractRuleExamples(body: string): RuleExamples | null {
  const hits = extractAllFields(body, 'Example Hit').map(stripInlineCode);
  const misses = extractAllFields(body, 'Example Miss').map(stripInlineCode);
  if (hits.length === 0 && misses.length === 0) return null;
  return { hits, misses };
}

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

function extractField(body: string, field: string): string | undefined {
  // Match: **Field:** value, **Field**: value, Field: value
  const re = new RegExp(`^(?:\\*{2})?${field}:?(?:\\*{2})?:?\\s+(.+)$`, 'im');
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

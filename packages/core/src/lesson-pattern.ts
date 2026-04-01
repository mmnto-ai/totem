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
  const re = new RegExp(`^(?:\\*{2})?${safeField}:(?:\\*{2})?[ \\t]*(.*)$`, 'gim');
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

// ─── Pipeline 3: Bad/Good snippet extraction ─────────

export interface BadGoodSnippets {
  bad: string[]; // lines from the Bad snippet
  good: string[]; // lines from the Good snippet
}

/**
 * Extract a code block (fenced or inline) following a **Field:** marker.
 * Used internally by extractBadGoodSnippets.
 */
function extractCodeBlock(body: string, field: string): string[] | null {
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Try fenced code block after **Field:** (with optional language tag)
  const fencedRe = new RegExp(
    `(?:^|\\n)\\*{0,2}${safeField}:?\\*{0,2}[^\\n]*\\n\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\``,
    'i',
  );
  const fencedMatch = body.match(fencedRe);
  if (fencedMatch) {
    return fencedMatch[1]!.split('\n').filter((l) => l.trim().length > 0);
  }
  // Fallback: inline value after **Field:**
  const inline = extractField(body, field);
  if (inline) {
    return [stripInlineCode(inline)];
  }
  return null;
}

/**
 * Extract Bad/Good code snippets from a lesson body (Pipeline 3).
 * Supports both fenced code blocks and inline text after the field.
 */
export function extractBadGoodSnippets(body: string): BadGoodSnippets | null {
  const bad = extractCodeBlock(body, 'Bad');
  const good = extractCodeBlock(body, 'Good');
  if (!bad || !good) return null;
  return { bad, good };
}

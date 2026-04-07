/**
 * Extract manual pattern fields from a lesson body.
 * Pipeline 1 (Proposal 186 / ADR-058): zero-LLM compilation.
 *
 * Supported fields (case-insensitive, bold or plain):
 *   **Pattern:** <regex or ast-grep pattern>
 *   **Engine:** regex | ast | ast-grep
 *   **Scope:** glob, glob, !negated-glob
 *   **Severity:** error | warning
 *   **Message:** <single-line OR multi-line remediation message>  (#1265)
 */

export interface ManualPattern {
  pattern: string;
  engine: 'regex' | 'ast' | 'ast-grep';
  fileGlobs?: string[];
  severity: 'error' | 'warning';
  /** Optional rich message for the compiled rule. Falls back to lesson heading if absent. */
  message?: string;
}

export function extractField(body: string, field: string): string | undefined {
  // Match all common bold/colon variants (#1282 — caught by Shield AI as a
  // partial-fix consequence of extending extractMultilineField):
  //   **Field:**  ← canonical totem (asterisks both sides of colon)
  //   **Field**:  ← alternative markdown convention (asterisks before colon)
  //   **Field:    ← bold-open only
  //   Field:      ← plain
  // Pre-fix, only the canonical form was supported despite the docstring
  // claiming **Field**: was supported. extractMultilineField needed the alt
  // form to terminate Message captures correctly, so we extend the shared
  // helper to keep all field-extraction call sites consistent — otherwise
  // a user writing **Pattern**: foo would have extractManualPattern fail
  // entirely because Pattern wouldn't be found.
  // Colon is mandatory to avoid matching prose like "Pattern is important..."
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?\\s+(.+)$`, 'im');
  const match = body.match(re);
  return match?.[1]?.trim();
}

/**
 * Extract a multi-line field value from a lesson body (#1265).
 *
 * Unlike `extractField` which captures only the first line, this captures from
 * the field marker line through subsequent continuation lines, stopping at
 * either the next BOLD `**Field:**` marker or EOF. Used for the `**Message:**`
 * field where remediation guidance often spans multiple paragraphs.
 *
 * Bare-colon prose (e.g. "Note: see above", "Fix: do X") is treated as
 * continuation, NOT a new field. Only `**bold**:` markers terminate the capture
 * — this matches markdown convention where structured fields are bolded and
 * unstructured prose is not.
 *
 * Returns the trimmed value, or `undefined` if the field is absent.
 */
export function extractMultilineField(body: string, field: string): string | undefined {
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the field's first line. Supports four common forms:
  //   **Field:**  ← canonical totem (asterisks both sides of colon)
  //   **Field**:  ← alternative markdown convention (asterisks before colon)
  //   **Field:    ← bold-open only
  //   Field:      ← plain
  // Caught by gemini-code-assist on PR #1282: pre-fix, the regex only accepted
  // the canonical form, so a user writing **Pattern**: would have it incorrectly
  // swallowed into the Message capture instead of terminating it.
  const startRe = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?\\s*(.*)$`, 'i');
  // Field-marker terminator: BOLD `**Word:**` OR `**Word**:` lines stop the capture.
  // Bare-colon prose (Note:, Fix:) still stays as continuation.
  const fieldMarkerRe = /^\*{2}[A-Za-z][\w\s]*(?::\*{2}|\*{2}:)/;

  // Split on both LF and CRLF — Windows-authored lessons would otherwise leave a
  // trailing `\r` on each line, and the `(.*)$` capture (no /m flag) would fail
  // because `$` requires end-of-string and `.` doesn't match `\r`. Caught by Shield AI.
  const lines = body.split(/\r?\n/);
  let startIdx = -1;
  let firstLineValue = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(startRe);
    if (m) {
      startIdx = i;
      firstLineValue = m[1] ?? '';
      break;
    }
  }
  if (startIdx === -1) return undefined;

  const valueLines: string[] = [firstLineValue];
  for (let j = startIdx + 1; j < lines.length; j++) {
    if (fieldMarkerRe.test(lines[j]!)) break;
    valueLines.push(lines[j]!);
  }
  // Treat an empty trimmed result as absent so the caller's `?? heading` fallback fires.
  // Without this, `**Message:**` with no body would set `message: ""` on the compiled
  // rule instead of falling back to lesson.heading.
  const trimmed = valueLines.join('\n').trim();
  return trimmed || undefined;
}

/**
 * Try to extract manual pattern fields from a lesson body.
 * Returns null if the lesson doesn't contain a Pattern: field.
 */
export function extractManualPattern(body: string): ManualPattern | null {
  const rawPattern = extractField(body, 'Pattern');
  if (!rawPattern) return null;
  const pattern = stripInlineCode(rawPattern);

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

  // #1265: rich message field with multi-line support. Backward compatible — undefined
  // when absent, and `buildManualRule` falls back to `lesson.heading` in that case.
  const message = extractMultilineField(body, 'Message');

  return { pattern, engine, fileGlobs, severity, message };
}

/**
 * Extract ALL values for a repeated field from a lesson body.
 * Unlike extractField (first match only), this returns every match.
 *
 * Supports the same four forms as extractField (#1282): `**Field:**`,
 * `**Field**:`, `**Field:`, and plain `Field:`.
 */
export function extractAllFields(body: string, field: string): string[] {
  const safeField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?[ \\t]*(.*)$`, 'gim');
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
  // Try fenced code block after **Field:** or **Field**: (colon required, inside or outside bold)
  const fencedRe = new RegExp(
    `(?:^|\\n)\\*{0,2}${safeField}\\*{0,2}\\s*:[^\\n]*\\n(?:\\s*\\n)*\`\`\`[^\\n]*\\n([\\s\\S]*?)\`\`\``,
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

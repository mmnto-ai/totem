/**
 * Extract manual pattern fields from a lesson body.
 * Pipeline 1 (Proposal 186 / ADR-058): zero-LLM compilation.
 *
 * Supported fields (case-insensitive, bold or plain):
 *   **Pattern:** <regex or flat ast-grep pattern>  OR  fenced ```yaml block below the marker (compound ast-grep)
 *   **Engine:** regex | ast | ast-grep
 *   **Scope:** glob, glob, !negated-glob
 *   **Severity:** error | warning
 *   **Message:** <single-line OR multi-line remediation message>  (#1265)
 */

import YAML from 'yaml';

import { TotemParseError } from './errors.js';
import { escapeRegex } from './regex-utils.js';

export interface ManualPattern {
  /**
   * Flat pattern text. Empty string when the lesson provides a compound
   * `astGrepYamlRule` instead. The two fields are mutually exclusive at the
   * consumer level (buildManualRule picks whichever is set).
   */
  pattern: string;
  engine: 'regex' | 'ast' | 'ast-grep';
  fileGlobs?: string[];
  severity: 'error' | 'warning';
  /** Optional rich message for the compiled rule. Falls back to lesson heading if absent. */
  message?: string;
  /**
   * Optional code snippet parsed from a `### Bad Example` markdown section in
   * the lesson body. Used by the compile-time smoke gate (ADR-087 / mmnto/totem#1408)
   * to verify the rule fires against its own bad example before landing in
   * compiled-rules.json. Empty blocks are treated as absent. The gate is not
   * required for Pipeline 1 rules in #1408 - a dry-run sweep precedes the flip.
   */
  badExample?: string;
  /**
   * Compound ast-grep rule (NapiConfig shape) parsed from a fenced ```yaml
   * block immediately following the `**Pattern:**` marker. Mutually exclusive
   * with the flat `pattern` string. Only valid when `engine === 'ast-grep'`.
   *
   * Parsing contract: the fence must be tagged `yaml` (not bare ```). The
   * scan stops at the next bold-field marker or EOF so that downstream
   * sections (Message, Bad Example, narrative) can live freely below.
   */
  astGrepYamlRule?: Record<string, unknown>;
}

/**
 * Parse the declared severity from a lesson body's `**Severity:** error` /
 * `Severity: warning` prose convention (mmnto-ai/totem#1656). Returns the
 * normalized `'error' | 'warning'` value if declared, otherwise `undefined`.
 *
 * Reuses `extractField` for the prose-extraction rules (markdown-bold
 * tolerance, mandatory colon, case-insensitive match, line-anchored). Then
 * strips trailing markdown boundary markers and sentence punctuation so
 * common shapes like `**Severity: error.**` (full-line bold with period),
 * `**Severity:** error.` (trailing period on the value), and
 * `**Severity:** \`error\`` (backtick-wrapped value) all normalize to the
 * same token. Strict equality follows the strip so out-of-vocabulary tokens
 * (`info`, `critical`) still return `undefined` and preserve the
 * compile-pipeline's default fallback to `'warning'`.
 *
 * Added as a shared helper so the compile pipeline's declared-severity
 * override (in `compile-lesson.ts::compileLesson`) and the CLI's cloud-path
 * override (in `compile.ts`) normalize from a single source of truth.
 */
export function parseDeclaredSeverity(body: string): 'error' | 'warning' | undefined {
  const raw = extractField(body, 'Severity');
  if (!raw) return undefined;
  // Strip markdown boundary markers (`*`, `_`) and trailing sentence
  // punctuation (`.`, `,`, `;`, `:`, `!`, `?`) FIRST, then strip backtick
  // wrappers. Order is load-bearing: `stripInlineCode` only matches when
  // backticks are at the absolute string edges, so running it first leaves
  // backticks in place on shapes like `**\`error\`**` (bold-wrapped
  // backticks) or `` `error`. `` (backticks followed by punctuation). The
  // outer strip pass isolates the core value; stripInlineCode then removes
  // the backticks around it. GCA round-3 finding on mmnto-ai/totem#1658.
  const stripped = raw
    .trim()
    .replace(/^[*_]+|[*_.,;:!?]+$/g, '')
    .trim();
  const normalized = stripInlineCode(stripped).toLowerCase();
  return normalized === 'error' || normalized === 'warning' ? normalized : undefined;
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
  // Whitespace after the closing bold is OPTIONAL ([ \t]*, not \s+) and the value
  // capture is OPTIONAL ((.*), not (.+)) for sibling-helper consistency: pre-fix,
  // extractField was stricter than extractAllFields and extractMultilineField,
  // silently rejecting `**Pattern:**foo` (no space) and `**Pattern:**` (empty value).
  // Caught by gemini-code-assist on PR #1282 as another instance of the
  // cross-helper-consistency cascade pattern documented in lesson-400fed87.
  const safeField = escapeRegex(field);
  const re = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?[ \\t]*(.*)$`, 'im');
  const match = body.match(re);
  // Trim and treat empty as "no value" so callers' `if (!value)` checks fire correctly.
  const value = match?.[1]?.trim();
  return value || undefined;
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
  const safeField = escapeRegex(field);
  // Match the field's first line. Supports four common forms:
  //   **Field:**  ← canonical totem (asterisks both sides of colon)
  //   **Field**:  ← alternative markdown convention (asterisks before colon)
  //   **Field:    ← bold-open only
  //   Field:      ← plain
  // Caught by gemini-code-assist on PR #1282: pre-fix, the regex only accepted
  // the canonical form, so a user writing **Pattern**: would have it incorrectly
  // swallowed into the Message capture instead of terminating it.
  const startRe = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?\\s*(.*)$`, 'i');
  // Field-marker terminator: any BOLD `**Word:**`, `**Word**:`, or bold-open `**Word:`
  // line stops the capture. Bare-colon prose (`Note:`, `Fix:` without `**` prefix) still
  // stays as continuation. Hyphens are allowed in field names (e.g. `**Compile-Time:**`).
  // CR caught the missing `**Word:` form on PR #1282 — without it, a lesson written with
  // bold-open-only fields could have Message capture run past the next intended field
  // because the terminator wouldn't match.
  const fieldMarkerRe = /^\*{2}[A-Za-z][\w\s-]*(?::\*{2}|\*{2}:|:)/;

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
 * Extract the contents of a fenced code block that follows a `### Bad Example`
 * heading in a lesson body. Used by the compile-time smoke gate
 * (mmnto/totem#1408) to verify Pipeline 1 rules against their own bad
 * example. Mirrors `extractBadGoodSnippets` for Pipeline 3 but targets a
 * markdown heading rather than a bold field marker because Pipeline 1
 * lessons conventionally use headings for worked examples.
 *
 * Returns `undefined` when:
 *   - No `### Bad Example` heading is present
 *   - The heading is present but no fenced code block follows before the
 *     next heading or EOF
 *   - The code block is empty
 *
 * Both ``` and ~~~ fence styles are accepted to stay aligned with
 * `extractCodeBlock`.
 */
export function extractBadExample(body: string): string | undefined {
  // Match `### Bad Example` through the first fenced block that follows.
  // The heading-stop lookahead keeps the capture from sliding into a
  // Good Example block when the Bad block is missing its fence.
  const re = /(?:^|\n)#{2,6}\s*Bad\s+Example\s*\n([\s\S]*?)(?=\n#{2,6}\s|\n---\s*\n|$)/i;
  const section = body.match(re);
  if (!section) return undefined;

  const slice = section[1] ?? '';
  const fence = slice.match(/(?:^|\n)(```|~~~)[^\n]*\n([\s\S]*?)\n?\1/);
  if (!fence) return undefined;

  const content = (fence[2] ?? '').trim();
  return content.length > 0 ? content : undefined;
}

/**
 * Extract the contents of a fenced code block that follows a `### Good Example`
 * heading in a lesson body. Symmetric counterpart of `extractBadExample`, used
 * by the mmnto-ai/totem#1580 over-matching check: the compile-time smoke gate
 * runs the compiled rule against `goodExample` and rejects it if the pattern
 * fires.
 *
 * Returns `undefined` under the same conditions as `extractBadExample` (no
 * heading, no fence, empty block). Both fence styles (``` and ~~~) are
 * accepted for parity with `extractCodeBlock`.
 */
export function extractGoodExample(body: string): string | undefined {
  const re = /(?:^|\n)#{2,6}\s*Good\s+Example\s*\n([\s\S]*?)(?=\n#{2,6}\s|\n---\s*\n|$)/i;
  const section = body.match(re);
  if (!section) return undefined;

  const slice = section[1] ?? '';
  const fence = slice.match(/(?:^|\n)(```|~~~)[^\n]*\n([\s\S]*?)\n?\1/);
  if (!fence) return undefined;

  const content = (fence[2] ?? '').trim();
  return content.length > 0 ? content : undefined;
}

/**
 * Extract a yaml-tagged fenced code block following a `**Field:**` marker.
 *
 * Scan starts on the line after the field marker and stops at the first
 * subsequent bold-field marker (same terminator used by extractMultilineField)
 * or EOF. Only yaml-tagged fences (```yaml or ~~~yaml, case-insensitive) are
 * accepted — a bare ``` fence is ignored so lessons can still include prose
 * code blocks below the pattern without accidentally being parsed as a rule.
 *
 * Returns the parsed object on success. Returns null when:
 *   - The field marker is absent
 *   - No yaml fence appears before the next field marker or EOF
 *   - The fence content fails to parse as YAML
 *   - The parsed value is not a plain object (string / array / null rejected)
 *
 * Motivation: Pipeline 1 (manual) authoring for compound ast-grep rules
 * (`astGrepYamlRule` on CompiledRule). The flat string pattern captured by
 * extractField cannot carry nested `inside:` / `has:` / `not:` combinators;
 * a yaml fence can. Pack authors need a zero-LLM path to author compound
 * rules ahead of the 1.15.0 Pack Distribution milestone.
 */
export function extractYamlRuleAfterField(
  body: string,
  field: string,
): Record<string, unknown> | null {
  const safeField = escapeRegex(field);
  const startRe = new RegExp(`^(?:\\*{2})?${safeField}(?:\\*{2})?:(?:\\*{2})?.*$`, 'i');
  // Section terminator — any bold field marker OR any markdown heading stops
  // the YAML scan. CR catch on mmnto/totem#1454: without the heading guard,
  // a lesson that omits **Message:** and lands on `### Bad Example` with a
  // yaml fence below would have the unrelated block parsed as the rule.
  const sectionEndRe = /^(?:\*{2}[A-Za-z][\w\s-]*(?::\*{2}|\*{2}:|:)|#{2,6}\s)/;
  const fenceStartRe = /^\s*(```|~~~)yaml\s*$/i;

  // Split on both LF and CRLF so Windows-authored lessons don't leave trailing
  // \r characters that break line-anchored regexes. Same reasoning as
  // extractMultilineField.
  const lines = body.split(/\r?\n/);
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i]!)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;

  let fenceStartIdx = -1;
  let fenceChar = '';
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (sectionEndRe.test(line)) return null;
    const m = line.match(fenceStartRe);
    if (m) {
      fenceStartIdx = i;
      fenceChar = m[1]!;
      break;
    }
  }
  if (fenceStartIdx === -1) return null;

  const fenceEndRe = new RegExp(`^\\s*${fenceChar}\\s*$`);
  const yamlLines: string[] = [];
  let fenceClosed = false;
  for (let i = fenceStartIdx + 1; i < lines.length; i++) {
    if (fenceEndRe.test(lines[i]!)) {
      fenceClosed = true;
      break;
    }
    yamlLines.push(lines[i]!);
  }
  if (!fenceClosed) return null;

  const yamlSrc = yamlLines.join('\n').trim();
  if (yamlSrc.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlSrc);
    // totem-context: malformed YAML is a soft failure for an optional compound rule — caller treats null as "no compound rule present" (GCA #1454)
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * Parse the lesson body's `**Scope:**` prose declaration into a glob list.
 *
 * Splits on TOP-LEVEL commas only — commas nested inside `{...}` brace groups
 * are preserved as part of a single glob token, so brace-expanded patterns
 * like `**\/*.{ts,tsx}` and `!**\/*.{test,spec}.{ts,tsx}` survive intact for
 * `sanitizeFileGlobs` to expand downstream. Returns `undefined` when the field
 * is absent OR the value is empty / whitespace-only. Returns a non-empty
 * `string[]` otherwise; order is preserved as authored, `!`-prefixed
 * exclusion entries are kept verbatim.
 *
 * Used by both Pipeline 1 (`extractManualPattern`) and Pipeline 2/3
 * (`buildCompiledRule` override path for mmnto-ai/totem#1665).
 */
export function parseDeclaredScope(body: string): string[] | undefined {
  const scopeRaw = extractField(body, 'Scope');
  if (!scopeRaw) return undefined;
  const globs: string[] = [];
  let current = '';
  let braceDepth = 0;
  for (const ch of scopeRaw) {
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (ch === ',' && braceDepth === 0) {
      const value = current.trim();
      if (value) globs.push(value);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) globs.push(tail);
  return globs.length > 0 ? globs : undefined;
}

/**
 * Set-of-strings equality on glob arrays. Order-insensitive,
 * duplicate-insensitive. Sign characters (`!` exclusion prefix) are part of
 * the string and matter for equality — `'!**\/*.test.*'` does not equal
 * `'**\/*.test.*'`. Used by mmnto-ai/totem#1665 divergence detection.
 */
export function isGlobSetEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const entry of setA) {
    if (!setB.has(entry)) return false;
  }
  return true;
}

/**
 * Try to extract manual pattern fields from a lesson body.
 * Returns null if the lesson doesn't contain a Pattern: field.
 */
export function extractManualPattern(body: string): ManualPattern | null {
  const engineRaw = extractField(body, 'Engine')?.toLowerCase();
  const engine: ManualPattern['engine'] =
    engineRaw === 'ast' ? 'ast' : engineRaw === 'ast-grep' ? 'ast-grep' : 'regex';

  const fileGlobs = parseDeclaredScope(body);

  const severityRaw = extractField(body, 'Severity')?.toLowerCase();
  const severity: ManualPattern['severity'] = severityRaw === 'error' ? 'error' : 'warning';

  // #1265: rich message field with multi-line support. Backward compatible — undefined
  // when absent, and `buildManualRule` falls back to `lesson.heading` in that case.
  const message = extractMultilineField(body, 'Message');

  // mmnto/totem#1408: optional Bad Example block for the compile-time smoke gate.
  const badExample = extractBadExample(body);

  // Compound path: a yaml-tagged fenced block immediately below **Pattern:**.
  // Only valid for engine: ast-grep — a compound YAML rule has no meaning for
  // regex or tree-sitter-query engines. Authoring error (yaml fence + wrong
  // engine) fails loud instead of silently falling through to Pipeline 2/3,
  // because a lesson that went to the trouble of writing yaml clearly
  // intended manual compound compilation (CR catch on mmnto/totem#1454).
  const yamlRule = extractYamlRuleAfterField(body, 'Pattern');
  if (yamlRule) {
    if (engine !== 'ast-grep') {
      throw new TotemParseError(
        `Lesson authoring error: yaml-tagged \`**Pattern:**\` fence found but \`**Engine:**\` is \`${engine}\`. Compound yaml rules only compile under \`ast-grep\`.`,
        'Set `**Engine:** ast-grep` on the lesson, or replace the yaml fence with a flat one-line pattern matching the chosen engine.',
      );
    }
    return {
      pattern: '',
      engine: 'ast-grep',
      fileGlobs,
      severity,
      message,
      badExample,
      astGrepYamlRule: yamlRule,
    };
  }

  // Flat path (existing behavior).
  const rawPattern = extractField(body, 'Pattern');
  if (!rawPattern) return null;
  const pattern = stripInlineCode(rawPattern);

  return { pattern, engine, fileGlobs, severity, message, badExample };
}

/**
 * Extract ALL values for a repeated field from a lesson body.
 * Unlike extractField (first match only), this returns every match.
 *
 * Supports the same four forms as extractField (#1282): `**Field:**`,
 * `**Field**:`, `**Field:`, and plain `Field:`.
 */
export function extractAllFields(body: string, field: string): string[] {
  const safeField = escapeRegex(field);
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
  const safeField = escapeRegex(field);
  // Try fenced code block after **Field:** or **Field**: (colon required, inside or outside bold)
  const fencedRe = new RegExp(
    `(?:^|\\n)\\*{0,2}${safeField}\\*{0,2}\\s*:[^\\n]*\\n(?:\\s*\\n)*(\`\`\`|~~~)[^\\n]*\\n([\\s\\S]*?)\\1`,
    'i',
  );
  const fencedMatch = body.match(fencedRe);
  if (fencedMatch) {
    return fencedMatch[2]!.split('\n').filter((l) => l.trim().length > 0);
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

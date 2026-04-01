/**
 * Centralized regex utilities for safe pattern construction.
 *
 * Replaces the scattered `string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
 * pattern found across the codebase with a single, tested function.
 */

/**
 * Escape all regex special characters in a string so it can be used
 * as a literal match inside a `RegExp`.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a literal code snippet into a permissive regex pattern for
 * Pipeline 5 observation rules.
 *
 * Steps:
 *  1. Trim leading/trailing blank lines
 *  2. Escape regex metacharacters
 *  3. Replace whitespace runs with `\s+` to tolerate reformatting
 *
 * Returns `''` for empty / whitespace-only input.
 */
export function codeToPattern(code: string): string {
  // Strip leading and trailing blank lines
  const trimmed = code
    .replace(/^[\t ]*\n/, '')
    .replace(/\n[\t ]*$/, '')
    .trim();

  if (trimmed.length === 0) {
    return '';
  }

  const escaped = escapeRegex(trimmed);

  // Replace any run of whitespace (including escaped newlines) with \s+
  const pattern = escaped.replace(/\s+/g, '\\s+');

  return pattern;
}

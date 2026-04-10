import {
  BASE64_BLOB_RE,
  INSTRUCTIONAL_LEAKAGE_RE,
  UNICODE_ESCAPE_RE,
  XML_TAG_LEAKAGE_RE,
} from './sanitize.js';

// ─── Types ──────────────────────────────────────────────

export interface ExtractedLesson {
  heading?: string;
  tags: string[];
  text: string;
  scope?: string;
  suspiciousFlags?: string[];
}

// ─── Constants ──────────────────────────────────────────

export const MAX_SUSPICIOUS_HEADING_LENGTH = 60;

/** Defensive keywords suggesting instructional/security discussion context. */
export const DEFENSIVE_KEYWORD_RE =
  /\b(?:detect|prevent|harden|defense|defensive|strip|flag|mitigat|sanitiz|block|neutraliz|scrub|filter|reject|validat|protect|guard|secur)\w*\b/i;

/** Characters of context to check around a match for defensive keywords. */
export const DEFENSIVE_PROXIMITY_WINDOW = 100;

// ─── Helpers ────────────────────────────────────────────

/**
 * Collect all [start, end] ranges of code-fenced regions in the text.
 * Uses inline regexes via matchAll to avoid module-level global state mutation.
 */
// totem-ignore-next-line
export function collectCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  // Fenced blocks first (higher priority — consume triple backticks before singles)
  for (const match of text.matchAll(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g)) {
    ranges.push([match.index, match.index + match[0].length]);
  }

  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    const start = match.index;
    const end = start + match[0].length;
    // Skip if this range overlaps with a fenced block
    const overlaps = ranges.some(([rs, re]) => start >= rs && end <= re);
    if (!overlaps) {
      ranges.push([start, end]);
    }
  }

  return ranges;
}

/**
 * Check if ALL matches of a pattern in text occur in instructional context
 * (inside backticks/code blocks AND near defensive keywords).
 * Both conditions must be met for EVERY match to suppress a flag.
 * If any single match is outside instructional context, returns false (fail closed).
 */
export function isInstructionalContext(
  text: string, // totem-ignore
  pattern: RegExp,
  codeRanges?: Array<[number, number]>,
): boolean {
  // Create global copy to iterate all matches — guard against duplicate 'g' flag
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const globalPattern = new RegExp(pattern.source, flags);
  const ranges = codeRanges ?? collectCodeRanges(text);
  let foundAny = false;

  for (const match of text.matchAll(globalPattern)) {
    foundAny = true;
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Condition 1: Match must fall within a code-fenced region
    const inCode = ranges.some(([rs, re]) => matchStart >= rs && matchEnd <= re);
    if (!inCode) return false;

    // Condition 2: Defensive keywords must be nearby (outside the match itself)
    // Space delimiter prevents cross-boundary keyword synthesis
    const windowStart = Math.max(0, matchStart - DEFENSIVE_PROXIMITY_WINDOW);
    const windowEnd = Math.min(text.length, matchEnd + DEFENSIVE_PROXIMITY_WINDOW);
    const surroundingText =
      text.slice(windowStart, matchStart) + ' ' + text.slice(matchEnd, windowEnd);

    if (!DEFENSIVE_KEYWORD_RE.test(surroundingText)) return false;
  }

  return foundAny;
}

// ─── Main detection ─────────────────────────────────────

/**
 * Scans extracted lessons for heuristic indicators of prompt injection or
 * LLM constraint violations. Returns a new array with `suspiciousFlags`
 * populated on any lesson that triggers one or more checks.
 *
 * For XML tag and instructional leakage patterns, a context-aware heuristic
 * suppresses false positives: if the match is inside backticks/code fences
 * AND defensive keywords are nearby, it's treated as instructional discussion.
 */
export function flagSuspiciousLessons(lessons: ExtractedLesson[]): ExtractedLesson[] {
  return lessons.map((lesson) => {
    const flags: string[] = [];
    const heading = lesson.heading ?? '';
    const combined = `${heading} ${lesson.text}`;

    if (heading.length > MAX_SUSPICIOUS_HEADING_LENGTH) {
      flags.push('Heading exceeds 60 characters');
    }

    // Compute code ranges once per lesson for both context-aware checks
    const codeRanges = collectCodeRanges(combined);

    if (
      INSTRUCTIONAL_LEAKAGE_RE.test(combined) &&
      !isInstructionalContext(combined, INSTRUCTIONAL_LEAKAGE_RE, codeRanges)
    ) {
      flags.push('Contains potential instructional leakage');
    }

    if (
      XML_TAG_LEAKAGE_RE.test(combined) &&
      !isInstructionalContext(combined, XML_TAG_LEAKAGE_RE, codeRanges)
    ) {
      flags.push('Contains system XML tags');
    }

    if (BASE64_BLOB_RE.test(combined)) {
      flags.push('Contains potential Base64 payload');
    }

    if (UNICODE_ESCAPE_RE.test(combined)) {
      flags.push('Contains excessive unicode escapes');
    }

    return flags.length > 0 ? { ...lesson, suspiciousFlags: flags } : lesson;
  });
}

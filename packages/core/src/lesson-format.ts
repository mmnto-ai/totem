export const HEADING_MAX_CHARS = 60;
const MIN_WORD_BREAK = 20;

/**
 * Words that leave a heading feeling incomplete when they appear at the end.
 * Trimming past these produces cleaner, self-contained phrases.
 */
const DANGLING_TAIL_RE =
  /\s+(?:the|a|an|of|for|in|on|at|to|by|with|from|into|via|and|or|but|is|are|was|were|that|this|its|their|your|against|between|within|about|after|before|during|through|across|can|must|should|when|if|as|than|like|e\.g\.?)$/i;

/**
 * Truncate a heading string to HEADING_MAX_CHARS at a word boundary.
 * Strips trailing ellipsis/periods added by LLMs before enforcing the limit.
 * Also trims dangling prepositions/articles/conjunctions that leave the
 * heading feeling incomplete (e.g. "must be tested against the" → "must be tested").
 */
export function truncateHeading(heading: string): string {
  // Strip trailing ellipsis (…) or triple-dot (...) that LLMs love to add
  let text = heading
    .replace(/[…]+$/, '')
    .replace(/\.{3,}$/, '')
    .trim();

  if (text.length <= HEADING_MAX_CHARS) {
    // Even short headings can have dangling tails from LLM ellipsis stripping
    let cleaned = text;
    let prev = cleaned;
    while (DANGLING_TAIL_RE.test(cleaned)) {
      cleaned = cleaned.replace(DANGLING_TAIL_RE, '').trimEnd();
      if (cleaned === prev || cleaned.length < MIN_WORD_BREAK) return prev;
      prev = cleaned;
    }
    return cleaned || text;
  }

  const truncated = text.slice(0, HEADING_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  text = (lastSpace > MIN_WORD_BREAK ? truncated.slice(0, lastSpace) : truncated).trimEnd();

  // Trim dangling tail words (may need multiple passes for chains like "for the")
  let prev = text;
  while (DANGLING_TAIL_RE.test(text)) {
    text = text.replace(DANGLING_TAIL_RE, '').trimEnd();
    if (text === prev || text.length < MIN_WORD_BREAK) {
      text = prev;
      break;
    }
    prev = text;
  }

  return text;
}

/**
 * Generate a descriptive lesson heading from the lesson body.
 * Strips markdown formatting, extracts the first sentence or line,
 * and truncates to HEADING_MAX_CHARS.
 */
export function generateLessonHeading(body: string): string {
  // Strip markdown formatting: bold, italic, headings, blockquotes, code fences
  let text = body
    .replace(/^(?:```|~~~)[\s\S]*?(?:```|~~~)/gm, '') // code blocks
    .replace(/^#+\s*/gm, '') // headings
    .replace(/^>\s*/gm, '') // blockquotes
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^\s*[-*]\s+/gm, '') // list markers
    .trim();

  // If structured (Context/Symptom/Fix), prefer the Fix/Rule line
  const fixMatch = text.match(/(?:Fix\/)?Rule:\s*(.+)/i);
  if (fixMatch) {
    text = fixMatch[1]!.trim();
  } else {
    // Take the first non-empty line
    const firstLine = text.split('\n').find((l) => l.trim());
    text = firstLine?.trim() ?? '';
  }

  if (!text) return 'Lesson';

  // Truncate at sentence boundary or max chars
  const sentenceEnd = text.search(/[.!?]\s/);
  if (sentenceEnd > 0 && sentenceEnd < HEADING_MAX_CHARS) {
    text = text.slice(0, sentenceEnd + 1);
  } else if (text.length > HEADING_MAX_CHARS) {
    // Delegate to truncateHeading which handles dangling tails
    text = truncateHeading(text);
  }

  return text;
}

/**
 * Rewrite a lessons.md file content, cleaning up truncated headings.
 * Applies `truncateHeading()` to every `## Lesson — ...` heading,
 * trimming dangling prepositions/articles/conjunctions.
 * Returns the number of headings that were modified.
 */
export function rewriteLessonHeadings(content: string): { output: string; rewritten: number } {
  let rewritten = 0;
  const output = content.replace(
    /^(## Lesson — )(.+)$/gm,
    (_match, prefix: string, heading: string) => {
      const cleaned = truncateHeading(heading);
      if (cleaned !== heading) rewritten++;
      return `${prefix}${cleaned}`;
    },
  );
  return { output, rewritten };
}

export const HEADING_MAX_CHARS = 60;
const MIN_WORD_BREAK = 20;

/**
 * Words that leave a heading feeling incomplete when they appear at the end.
 * Trimming past these produces cleaner, self-contained phrases.
 */
const DANGLING_TAIL_RE =
  /\s+(?:the|a|an|of|for|in|on|at|to|by|with|from|into|via|and|or|but|is|are|was|were|that|this|its|their|your|against|between|within|about|after|before|during|through|across|can|must|should|when|if|as|than|like|e\.g\.?)$/i;

/**
 * Prepositions that, when they immediately precede an expectant-tail run,
 * signal a mid-clause cut. The prep must be the IMMEDIATE anchor of the
 * run — an article like "the" between the prep and the trailing word
 * (as in "Pass the props to the component") stops the run at the noun and
 * leaves the heading kept.
 */
const ANCHOR_PREPS = new Set([
  'to',
  'for',
  'by',
  'with',
  'from',
  'into',
  'via',
  'against',
  'between',
  'within',
  'about',
  'after',
  'before',
  'during',
  'through',
  'across',
  'of',
  'on',
  'at',
  'in',
]);

/**
 * Suffixes that strongly signal a trailing word is a verb or attributive
 * adjective expecting a noun complement. Used to detect "expectant runs"
 * — consecutive trailing words like "enable auditable" — that signal an
 * incomplete clause when anchored to a preposition.
 *
 * Note: many common English nouns (component, client, state, environment,
 * string) also match these suffixes. The walk-backwards-collect logic
 * relies on the IMMEDIATE-anchor check (must be a preposition with no
 * intervening article/noun) to avoid over-stripping those.
 */
const EXPECTANT_SUFFIX_RE = /(?:ate|ize|ise|ify|able|ible|ing|ent|ant)$/i;

function isExpectantWord(word: string): boolean {
  // Hyphenated words (fixed-size, real-time, multi-tenant) are almost
  // always attributive adjectives — treat as expectant.
  if (word.includes('-')) return true;
  return EXPECTANT_SUFFIX_RE.test(word);
}

/**
 * Strip a trailing run of expectant words (one or more verb/adjective-shaped
 * words at the end of the heading) when the run is IMMEDIATELY anchored to
 * a preposition. Examples (mmnto-ai/totem#1872 regression evidence):
 *
 *   "Validate ... to prevent"          → strip "prevent" (anchored to "to")
 *   "RON tuple ... for fixed-size"     → strip "fixed-size" (anchored to "for")
 *   "Snapshot ... to isolate"          → strip "isolate" (anchored to "to")
 *   "Document ... to enable auditable" → strip "enable auditable" (anchored to "to")
 *
 * The run is collected by walking backwards from the end as long as each
 * word is "expectant" (verb/adjective-shaped or hyphenated). The anchor is
 * the word immediately before the run. If the anchor is in ANCHOR_PREPS,
 * strip the run; the existing dangling-tail check then strips the preposition.
 *
 * False positives are avoided by the immediate-adjacency check: in "Pass
 * the props to the component", the anchor before "component" is "the"
 * (not a preposition), so the heading is kept.
 */
function trimIncompleteClause(text: string): string {
  const words = text.split(/\s+/);
  if (words.length < 2) return text;

  let runStart = words.length;
  while (runStart > 0 && isExpectantWord(words[runStart - 1]!)) {
    runStart--;
  }
  if (runStart === words.length) return text; // no trailing expectant run
  if (runStart === 0) return text; // entire heading is expectant — no anchor

  const anchor = words[runStart - 1]!;
  if (!ANCHOR_PREPS.has(anchor.toLowerCase())) return text;

  const trimmed = words.slice(0, runStart).join(' ').trimEnd();
  if (trimmed.length < MIN_WORD_BREAK) return text;
  return trimmed;
}

/**
 * Iteratively trim trailing fragments that leave a heading mid-clause.
 * Chains the existing dangling-tail strip with the clause-incomplete strip
 * so multi-word tails ("to enable auditable") collapse cleanly.
 */
function trimTrailingFragments(text: string): string {
  let prev = text;
  for (;;) {
    let next = prev;
    if (DANGLING_TAIL_RE.test(next)) {
      next = next.replace(DANGLING_TAIL_RE, '').trimEnd();
    }
    next = trimIncompleteClause(next);
    if (next === prev || next.length < MIN_WORD_BREAK)
      return next.length < MIN_WORD_BREAK ? prev : next;
    prev = next;
  }
}

/**
 * Truncate a heading string to HEADING_MAX_CHARS at a word boundary.
 * Strips trailing ellipsis/periods added by LLMs before enforcing the limit.
 * Also trims dangling prepositions/articles/conjunctions that leave the
 * heading feeling incomplete (e.g. "must be tested against the" → "must be tested"),
 * and clause-internal-cut tails where a verb/adjective follows a preposition
 * (e.g. "to prevent" → drop both, per mmnto-ai/totem#1872).
 */
export function truncateHeading(heading: string): string {
  // Strip trailing ellipsis (…) or triple-dot (...) that LLMs love to add
  let text = heading
    .replace(/[…]+$/, '')
    .replace(/\.{3,}$/, '')
    .trim();

  if (text.length <= HEADING_MAX_CHARS) {
    return trimTrailingFragments(text) || text;
  }

  const truncated = text.slice(0, HEADING_MAX_CHARS);
  const lastSpace = truncated.lastIndexOf(' ');
  text = (lastSpace > MIN_WORD_BREAK ? truncated.slice(0, lastSpace) : truncated).trimEnd();

  return trimTrailingFragments(text);
}

/**
 * Generate a descriptive lesson heading from the lesson body.
 * Strips markdown formatting, extracts the first sentence or line,
 * and truncates to HEADING_MAX_CHARS.
 */
export function generateLessonHeading(body: string): string {
  // Strip markdown formatting: bold, italic, headings, blockquotes, code fences
  let text = body
    .replace(/^(```|~~~)[\s\S]*?\1/gm, '') // code blocks
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

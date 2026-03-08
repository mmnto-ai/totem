const HEADING_MAX_CHARS = 60;
const MIN_WORD_BREAK = 20;

/**
 * Generate a descriptive lesson heading from the lesson body.
 * Strips markdown formatting, extracts the first sentence or line,
 * and truncates to HEADING_MAX_CHARS.
 */
export function generateLessonHeading(body: string): string {
  // Strip markdown formatting: bold, italic, headings, blockquotes, code fences
  let text = body
    .replace(/^```[\s\S]*?```/gm, '') // code blocks
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
    // Break at last word boundary before limit
    const truncated = text.slice(0, HEADING_MAX_CHARS);
    const lastSpace = truncated.lastIndexOf(' ');
    text = (lastSpace > MIN_WORD_BREAK ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return text;
}

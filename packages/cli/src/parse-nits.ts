/**
 * Extract nit content from CodeRabbit review bodies.
 * Parses <details><summary>... Nitpick ...</summary>...</details> blocks
 * and returns the inner content as clean text.
 */

/**
 * Given a position right after a `<details>...<summary>...</summary>`,
 * find the matching `</details>` accounting for nesting, and return
 * the inner content between the end of the summary and the closing tag.
 */
function extractNestedBlock(body: string, startPos: number): string | null {
  let depth = 1;
  let pos = startPos;

  while (depth > 0 && pos < body.length) {
    // Create fresh regexes each iteration to avoid global state corruption
    const openRe = /<details>/gi;
    const closeRe = /<\/details>/gi;
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;

    const openMatch = openRe.exec(body);
    const closeMatch = closeRe.exec(body);

    if (!closeMatch) {
      // No closing tag found — malformed HTML, bail out
      return null;
    }

    if (openMatch && openMatch.index < closeMatch.index) {
      // Found a nested <details> before the next </details>
      depth++;
      pos = openMatch.index + openMatch[0].length;
    } else {
      // Found a </details>
      depth--;
      if (depth === 0) {
        return body.slice(startPos, closeMatch.index);
      }
      pos = closeMatch.index + closeMatch[0].length;
    }
  }

  return null;
}

/** Strip wrapper HTML tags (<details>, <summary>, <blockquote>) but keep inner content. */
function stripWrapperTags(html: string): string {
  return html
    .replace(/<\/?details>/gi, '')
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?blockquote>/gi, '')
    .trim();
}

/**
 * Extract nit content from CodeRabbit review bodies.
 * Finds all `<details>` blocks whose `<summary>` contains "Nitpick", "nitpick", or the broom emoji.
 * Returns an array of cleaned nit text strings.
 */
export function parseCodeRabbitNits(body: string): string[] {
  // Strip fenced code blocks to avoid extracting fake nits from examples
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const nits: string[] = [];
  const nitpickRe = /<details>\s*<summary>[^<]*(?:Nitpick|nitpick|🧹)[^<]*<\/summary>/g;
  let match: RegExpExecArray | null;

  while ((match = nitpickRe.exec(stripped)) !== null) {
    const afterSummary = match.index + match[0].length;
    const innerContent = extractNestedBlock(stripped, afterSummary);
    if (innerContent) {
      const cleaned = stripWrapperTags(innerContent);
      if (cleaned) {
        nits.push(cleaned);
      }
    }
  }

  return nits;
}

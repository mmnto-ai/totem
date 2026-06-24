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
  if (!body) return [];
  // Strip fenced code blocks to avoid extracting fake nits from examples
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const nits: string[] = [];
  const nitpickRe = /<details>\s*<summary>[^<]*(?:nitpick|🧹)[^<]*<\/summary>/gi;
  let match: RegExpExecArray | null;

  while ((match = nitpickRe.exec(stripped)) !== null) {
    const afterSummary = match.index + match[0].length;
    const innerContent = extractNestedBlock(stripped, afterSummary);
    if (innerContent) {
      const cleaned = stripWrapperTags(innerContent);
      if (cleaned) {
        // CodeRabbit separates multiple nits with `---` dividers.
        // Split on them to extract each nit individually.
        // CodeRabbit separates multiple nits with `---` dividers.
        // Always split — works for 1 or N nits.
        const parts = cleaned
          .split(/\r?\n---\r?\n/)
          .map((p) => p.trim())
          .filter(Boolean);
        nits.push(...parts);
      }
    }
  }

  return nits;
}

/**
 * Extract "outside diff range" content from CodeRabbit review bodies.
 * Finds all `<details>` blocks whose `<summary>` contains "outside the diff"
 * or "Outside diff range" (case-insensitive).
 * Returns an array of cleaned text strings.
 */
export function parseCodeRabbitOutsideDiff(body: string): string[] {
  if (!body) return [];
  // Strip fenced code blocks to avoid extracting fake matches from examples
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const results: string[] = [];
  const outsideDiffRe =
    /<details>\s*<summary>[^<]*(?:outside\s+the\s+diff|outside\s+diff\s+range)[^<]*<\/summary>/gi;
  let match: RegExpExecArray | null;

  while ((match = outsideDiffRe.exec(stripped)) !== null) {
    const afterSummary = match.index + match[0].length;
    const innerContent = extractNestedBlock(stripped, afterSummary);
    if (innerContent) {
      const cleaned = stripWrapperTags(innerContent);
      if (cleaned) {
        const parts = cleaned
          .split(/\r?\n---\r?\n/)
          .map((p) => p.trim())
          .filter(Boolean);
        results.push(...parts);
      }
    }
  }

  return results;
}

/** The HTML-comment marker greptile emits to anchor its out-of-diff section. */
const GREPTILE_OUTSIDE_DIFF_MARKER = '<!-- greptile_other_comments_section -->';

/**
 * Extract greptile's "Comments Outside Diff" findings from its SUMMARY comment.
 *
 * Greptile renders out-of-diff findings in the standing summary comment, BELOW
 * the flowchart, anchored by the HTML-comment marker
 * `<!-- greptile_other_comments_section -->` and trailed by a `<sub>Reviews (N):
 * …</sub>` footer (mmnto-ai/totem-strategy#690; the canonical anchor). We key on
 * the MARKER — not a sampled `<details>`/header shape — because greptile EDITS
 * this comment in place: a merged/closed PR shows the marker with the content
 * already removed post-resolution, so the live findings-state cannot be
 * reverse-engineered from a closed PR (GitHub `userContentEdits` exposes edit
 * metadata, not prior bodies). The exact rendering of findings UNDER the marker
 * is validated against a live out-of-diff sample; until then we surface the whole
 * block (anti-glance: over-surface beats silently dropping — the failure class
 * this fixes). Returns [] when the section is absent or empty (resolved/none).
 */
export function parseGreptileOutsideDiff(body: string): string[] {
  if (!body) return [];
  const markerIdx = body.indexOf(GREPTILE_OUTSIDE_DIFF_MARKER);
  if (markerIdx === -1) return [];

  let section = body.slice(markerIdx + GREPTILE_OUTSIDE_DIFF_MARKER.length);
  // Drop the trailing "<sub>Reviews (N): … | Re-trigger Greptile</sub>" footer.
  const footerIdx = section.search(/<sub\b/i);
  if (footerIdx !== -1) section = section.slice(0, footerIdx);

  // Strip fenced code blocks to avoid splitting on `---` inside examples, then
  // unwrap the known HTML wrappers.
  const cleaned = stripWrapperTags(section.replace(/```[\s\S]*?```/g, '')).trim();
  if (!cleaned) return [];

  // Greptile may render multiple out-of-diff findings; split on `---` rules when
  // present, else surface the whole block as one (refine on a live sample).
  const parts = cleaned
    .split(/\r?\n---\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
}

/**
 * Combined parser for greptile SUMMARY-comment findings — the marker-anchored
 * "Comments Outside Diff" section (greptile's per-line findings post inline and
 * are handled by the thread path). See {@link parseGreptileOutsideDiff}.
 */
export function parseGreptileReviewFindings(
  body: string,
): Array<{ type: 'outside-diff'; content: string }> {
  return parseGreptileOutsideDiff(body).map((content) => ({ type: 'outside-diff', content }));
}

/**
 * Combined parser that extracts both nitpick and outside-diff findings
 * from a CodeRabbit review body, returning typed results.
 */
export function parseCodeRabbitReviewFindings(
  body: string,
): Array<{ type: 'nitpick' | 'outside-diff'; content: string }> {
  const findings: Array<{ type: 'nitpick' | 'outside-diff'; content: string }> = [];

  for (const content of parseCodeRabbitNits(body)) {
    findings.push({ type: 'nitpick', content });
  }

  for (const content of parseCodeRabbitOutsideDiff(body)) {
    findings.push({ type: 'outside-diff', content });
  }

  return findings;
}

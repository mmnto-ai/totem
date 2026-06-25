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
 * The documented greptile summary footer ("Reviews (N): … | Re-trigger
 * Greptile"). Anchor footer removal to THIS shape, not the first `<sub>`
 * anywhere — a greptile finding may legitimately contain an HTML subscript, and
 * truncating at it would drop the rest of the finding (CR review on #2246).
 */
const GREPTILE_REVIEWS_FOOTER = /<sub\b[^>]*>\s*Reviews\b/i;

/**
 * The cleaned content of greptile's out-of-diff section — everything between the
 * `greptile_other_comments_section` marker and the Reviews footer, HTML wrappers
 * stripped. Returns '' when the marker is absent or the section is empty
 * (resolved/clean). Shared by {@link parseGreptileOutsideDiff} and
 * {@link greptileOutsideDiffSectionHasContent}.
 */
function greptileOutsideDiffSection(body: string): string {
  if (!body) return '';
  const markerIdx = body.indexOf(GREPTILE_OUTSIDE_DIFF_MARKER);
  if (markerIdx === -1) return '';
  let section = body.slice(markerIdx + GREPTILE_OUTSIDE_DIFF_MARKER.length);
  const footerIdx = section.search(GREPTILE_REVIEWS_FOOTER);
  if (footerIdx !== -1) section = section.slice(0, footerIdx);
  return stripWrapperTags(section).trim();
}

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
 * metadata, not prior bodies). Returns [] when the section is absent or empty
 * (resolved/none).
 */
export function parseGreptileOutsideDiff(body: string): string[] {
  const cleaned = greptileOutsideDiffSection(body);
  if (!cleaned) return [];

  // Greptile may render multiple out-of-diff findings separated by `---` rules.
  // Split on `---` ONLY outside fenced code blocks: greptile findings embed code
  // examples/suggestions, and stripping or splitting through fences deletes that
  // content from the surfaced finding (gemini review on #2246). Toggle on ```.
  const FENCE = '```';
  const groups: string[][] = [[]];
  let inFence = false;
  for (const line of cleaned.split(/\r?\n/)) {
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence;
    if (!inFence && line.trim() === '---') {
      groups.push([]);
    } else {
      groups[groups.length - 1]!.push(line);
    }
  }
  const parts = groups.map((g) => g.join('\n').trim()).filter(Boolean);
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
 * Whether greptile's out-of-diff section has actual content the parser should
 * have extracted. The marker is a PERMANENT structural element on every greptile
 * summary (present even on a clean 5/5), so "a bot summary is present but we
 * parsed 0 findings" cried wolf on every clean PR (greptile P1 on #2246). This
 * narrows a genuine parser gap to: the section has content yet extraction yielded
 * nothing — a real regression, never the routine empty/clean case.
 */
export function greptileOutsideDiffSectionHasContent(body: string): boolean {
  return greptileOutsideDiffSection(body).length > 0;
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

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
 * CodeRabbit renders the whole "Review details" region as a markdown
 * BLOCKQUOTE — every line carries a `> ` prefix, so `<details>` and its
 * `<summary>` are separated by `\n> ` and the `\s*`-joined section regexes
 * below never match. That is the mmnto-ai/totem#2414 live-miss shape (two
 * same-day specimens): the sections were present, the parser saw none of
 * them. Strip leading blockquote markers per line (nested `> > ` included)
 * before any section parsing; non-blockquoted legacy bodies pass through
 * unchanged.
 */
function stripBlockquotePrefixes(body: string): string {
  return body.replace(/^(?:>[ \t]?)+/gm, '');
}

/**
 * Extract nit content from CodeRabbit review bodies.
 * Finds all `<details>` blocks whose `<summary>` contains "Nitpick", "nitpick", or the broom emoji.
 * Returns an array of cleaned nit text strings.
 */
export function parseCodeRabbitNits(body: string): string[] {
  if (!body) return [];
  // Strip fenced code blocks to avoid extracting fake nits from examples
  const stripped = stripBlockquotePrefixes(body).replace(/```[\s\S]*?```/g, '');
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
  const stripped = stripBlockquotePrefixes(body).replace(/```[\s\S]*?```/g, '');
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

// ─── File-attributed CR section extraction (mmnto-ai/totem#2414) ───

/** One entry from a CR review-body section, with the per-file attribution the
 * nested `<summary>path/to/file.ts (N)</summary>` block carries when present. */
export interface CrSectionEntry {
  content: string;
  file?: string;
}

/** Split a stripped block into individual entries on CR's `---` dividers. */
function splitEntries(block: string): string[] {
  const cleaned = stripWrapperTags(block);
  if (!cleaned) return [];
  return cleaned
    .split(/\r?\n---\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Split a section's inner content into per-file entry lists. CR nests one
 * `<details><summary>path/to/file.ts (N)</summary>` block per file inside the
 * section; the path in that summary is the ONLY file attribution a body
 * finding carries (stripWrapperTags used to delete it, leaving dispositions to
 * hand-attribute line ranges — the #2422 round-2 exhibit). A summary must look
 * path-like (`/` or `.`) to count as a file block; when the section carries no
 * file blocks at all, the whole content is split flat (legacy shape).
 */
function splitFileBlocks(sectionInner: string): CrSectionEntry[] {
  const fileBlockRe = /<details>\s*<summary>([^<]+?)\s*\((\d+)\)<\/summary>/gi;
  const entries: CrSectionEntry[] = [];
  let m: RegExpExecArray | null;
  let sawFileBlock = false;
  while ((m = fileBlockRe.exec(sectionInner)) !== null) {
    const file = m[1]!.trim();
    if (!/[/.]/.test(file)) continue;
    const inner = extractNestedBlock(sectionInner, m.index + m[0].length);
    if (inner === null) continue;
    sawFileBlock = true;
    for (const content of splitEntries(inner)) entries.push({ content, file });
    // Resume the scan PAST the extracted block, not inside its content — a
    // path-like <details> nested within a finding's body must never be
    // re-matched as an independent sibling file block (greptile #2427 round).
    fileBlockRe.lastIndex = m.index + m[0].length + inner.length;
  }
  if (!sawFileBlock) {
    for (const content of splitEntries(sectionInner)) entries.push({ content });
  }
  return entries;
}

/**
 * Extract file-attributed entries from every CR section whose `<summary>`
 * matches `summaryPattern`. Blockquote-normalized and fence-stripped like the
 * flat parsers above.
 */
function extractCrSectionEntries(body: string, summaryPattern: RegExp): CrSectionEntry[] {
  if (!body) return [];
  const stripped = stripBlockquotePrefixes(body).replace(/```[\s\S]*?```/g, '');
  const sectionRe = new RegExp(
    `<details>\\s*<summary>[^<]*(?:${summaryPattern.source})[^<]*</summary>`,
    'gi',
  );
  const entries: CrSectionEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(stripped)) !== null) {
    const inner = extractNestedBlock(stripped, match.index + match[0].length);
    if (inner === null) continue;
    entries.push(...splitFileBlocks(inner));
  }
  return entries;
}

/**
 * CR's finding template carries an italic severity tag (`_🟠 Major_`-style).
 * Its presence is what separates an actionable body-only finding from the
 * verification notes / LGTM lines that fill the rest of the section. Anchored
 * to the concrete template shape — severity emoji + the severity word as the
 * WHOLE italic span — so italic prose that merely contains the word
 * (`_major version verified_`, `✅ Fixed the _minor_ nit`) never qualifies
 * (#2427 review round, CR + greptile convergent).
 */
const CR_SEVERITY_TAG_RE = /_(?:🔴|🟠|🟡)\s*(?:critical|major|minor)_/iu;

/**
 * Extract ACTIONABLE entries from CodeRabbit's "Additional comments"
 * review-body section (mmnto-ai/totem#2414 specimen 2: an actionable body-only
 * finding that never becomes an inline thread — #2413's lazy-import finding).
 * The section is mostly verification notes, so an entry qualifies only when it
 * carries the finding template's severity tag; bare LGTMs never surface.
 */
export function parseCodeRabbitAdditionalComments(body: string): CrSectionEntry[] {
  return extractCrSectionEntries(body, /additional\s+comments/).filter((e) =>
    CR_SEVERITY_TAG_RE.test(e.content),
  );
}

/**
 * Combined parser that extracts nitpick, outside-diff, and actionable
 * body-only ("Additional comments") findings from a CodeRabbit review body,
 * returning typed results with per-file attribution where the section nests it
 * (mmnto-ai/totem#2414).
 */
export function parseCodeRabbitReviewFindings(
  body: string,
): Array<{ type: 'nitpick' | 'outside-diff' | 'body-only'; content: string; file?: string }> {
  const findings: Array<{
    type: 'nitpick' | 'outside-diff' | 'body-only';
    content: string;
    file?: string;
  }> = [];

  for (const content of parseCodeRabbitNits(body)) {
    findings.push({ type: 'nitpick', content });
  }

  // File-attributed extraction (not the flat legacy string[] surface) so a
  // disposition can cite `file (outside-diff)` instead of `(review body)`.
  for (const entry of extractCrSectionEntries(
    body,
    /outside\s+the\s+diff|outside\s+diff\s+range/,
  )) {
    findings.push({ type: 'outside-diff', content: entry.content, file: entry.file });
  }

  for (const entry of parseCodeRabbitAdditionalComments(body)) {
    findings.push({ type: 'body-only', content: entry.content, file: entry.file });
  }

  return findings;
}

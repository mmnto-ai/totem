import type { NormalizedBotFinding } from './bot-review-parser.js';
import { mapToTriageCategory } from './triage-severity-mapper.js';
import type { CategorizedFinding } from './triage-types.js';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'and',
  'but',
  'or',
  'not',
  'no',
]);

/**
 * Extract significant words from text (strip stopwords, lowercase).
 *
 * Retained as a public helper for downstream tooling (e.g., the deferred
 * `--no-dedup` debug flag, ad-hoc analysis scripts) even though
 * `deduplicateFindings` no longer uses it after mmnto-ai/totem#1666.
 */
export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Jaccard similarity between two keyword sets.
 *
 * Retained alongside `extractKeywords` for the same reason — see that
 * function's note.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * Deduplicate bot findings using deterministic comment-id identity
 * (mmnto-ai/totem#1666; strategy upstream-feedback item 024).
 *
 * Two findings with different `rootCommentId` are ALWAYS distinct, even
 * when their bodies are byte-identical and they anchor at the same
 * `(file, line)`. This forecloses the LC#80 R3 failure mode where six
 * GCA findings on `compiled-rules.json:598` (each anchored at the rule-
 * section start line) collapsed into one entry under the prior
 * proximity + Jaccard fuzzy-merge semantics.
 *
 * Cross-bot independence is now a feature, not a bug: when CR and GCA
 * independently flag the same `(file, line)`, both findings surface so
 * the consumer can read the cross-bot agreement as elevated-confidence
 * signal (per the strategy bot-nuance pattern). Today's previous
 * cross-bot merge silently masked exactly that signal.
 *
 * Synthesized review-body findings (`file === '(review body)'`, no
 * `rootCommentId`) fall back to a `(file, body)` Map key. Body-hash
 * collisions are negligible at this scale: the input space is per-
 * review-body line items only, and identical-body findings on that
 * pseudo-path are themselves duplicates.
 *
 * The `mergedWith` field on the output is left undefined under strict-
 * by-id semantics. Keeping the field on the schema (rather than
 * removing it) avoids forcing downstream display consumers into a
 * coordinated update; readers naturally skip the empty/undefined
 * surface.
 */
export function deduplicateFindings(findings: NormalizedBotFinding[]): CategorizedFinding[] {
  const result: CategorizedFinding[] = [];
  const seenIds = new Set<number>();
  const seenBodyKeys = new Set<string>();

  for (const finding of findings) {
    let dedupKey: string;
    if (finding.rootCommentId !== undefined) {
      // Strict-by-id path: GitHub-assigned comment IDs are unique per
      // inline review comment. Two findings with different IDs are always
      // distinct, regardless of file/line/body similarity or which bot
      // emitted them.
      if (seenIds.has(finding.rootCommentId)) continue;
      seenIds.add(finding.rootCommentId);
      dedupKey = `id:${finding.rootCommentId}`;
    } else {
      // Body-hash fallback for synthesized findings without an upstream
      // comment ID (today: extractReviewBodyFindings produces these with
      // `file: '(review body)'`). Map key is the body string itself —
      // bounded length, no crypto cost, V8 handles long string keys
      // natively.
      const key = `${finding.file}|${finding.body}`;
      if (seenBodyKeys.has(key)) continue;
      seenBodyKeys.add(key);
      dedupKey = `body:${finding.file}|${finding.body}`;
    }

    result.push({
      ...finding,
      triageCategory: mapToTriageCategory(finding),
      dedupKey,
    });
  }

  return result;
}

import type { NormalizedBotFinding } from './bot-review-parser.js';
import type { CategorizedFinding } from './triage-types.js';
import { mapToTriageCategory } from './triage-severity-mapper.js';

const PROXIMITY_THRESHOLD = 3; // lines
const KEYWORD_OVERLAP_THRESHOLD = 0.3; // 30% Jaccard similarity

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

/** Extract significant words from text (strip stopwords, lowercase) */
export function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity between two keyword sets */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export function deduplicateFindings(findings: NormalizedBotFinding[]): CategorizedFinding[] {
  // First, categorize all findings
  const categorized: CategorizedFinding[] = findings.map((f, i) => ({
    ...f,
    triageCategory: mapToTriageCategory(f),
    dedupKey: `${f.file}:${f.line ?? 'file'}:${i}`,
  }));

  const merged: CategorizedFinding[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < categorized.length; i++) {
    if (consumed.has(i)) continue;

    const primary = categorized[i]!;
    const primaryKw = extractKeywords(primary.body);
    const group: NormalizedBotFinding[] = [];

    for (let j = i + 1; j < categorized.length; j++) {
      if (consumed.has(j)) continue;
      const candidate = categorized[j]!;

      // Must be same category
      if (candidate.triageCategory !== primary.triageCategory) continue;

      // Must be same file
      if (candidate.file !== primary.file) continue;

      // Check line proximity (or both file-level)
      if (primary.line != null && candidate.line != null) {
        if (Math.abs(primary.line - candidate.line) > PROXIMITY_THRESHOLD) continue;
      } else if (primary.line != null || candidate.line != null) {
        // One has a line, one doesn't — only merge if body is very similar
        const sim = jaccardSimilarity(primaryKw, extractKeywords(candidate.body));
        if (sim < 0.8) continue;
      }

      // Check keyword overlap
      const candidateKw = extractKeywords(candidate.body);
      const similarity = jaccardSimilarity(primaryKw, candidateKw);
      if (similarity < KEYWORD_OVERLAP_THRESHOLD) continue;

      // Merge
      group.push(candidate);
      consumed.add(j);
    }

    if (group.length > 0) {
      primary.mergedWith = group;
      // Update dedupKey to reflect the merge
      primary.dedupKey = `merged:${primary.file}:${primary.line ?? 'file'}:${primary.triageCategory}`;
    }

    merged.push(primary);
  }

  return merged;
}

/**
 * Auto-close keyword matcher — the ONE shared evaluator for the GitHub
 * auto-close enforcement seam (mmnto-ai/totem#1762).
 *
 * GitHub auto-closes a linked issue when a **PR description** or a **commit
 * message** (including the squash merge-commit body) contains a close-keyword
 * immediately adjacent to an issue reference. That parser is quirk-ridden: it
 * fires under negation (`Does not close #2466` closed #2466 — the confirmed
 * #2471→#2466 incident), under emphasis, and inside block quotes. Rather than
 * model those quirks, this matcher enforces a **presence invariant with zero
 * semantic judgment**: ANY close-keyword-adjacent issue reference is an anomaly,
 * genuine or negated. Intended closures ride `closingIssuesReferences` (GitHub's
 * own linked-issue channel) or an explicit `gh issue close` — never implicit
 * prose. See `receipt.ts` for the declared-intent reconciliation.
 *
 * SINGLE-SOURCE SEAM: this module is the sole owner of the auto-close pattern.
 * Consumers must import {@link AUTO_CLOSE_REGEX_SOURCE} / {@link findAutoCloseRefs}
 * from here — never copy the regex. Current consumers: D1 (PR-time required
 * check) + D2 (post-merge reconciliation) workflow scripts, and C's rendered
 * PreWriteShield / BeforeTool hook templates (which inline
 * `JSON.stringify(AUTO_CLOSE_REGEX_SOURCE)` the way `BARE_REF_REGEX_SOURCE` is
 * inlined). The gated A+B layer (Bash-matcher interlock + `totem pr merge`
 * wrapper, mmnto-ai/totem-strategy#951) MUST also consume this same evaluator
 * via thin per-host adapters — no per-lane regex.
 *
 * Provenance honesty: 1 CONFIRMED instance (#2471→#2466) + 4 asserted-prior
 * (undocumented vectors). Do not claim 5 confirmed.
 */

/**
 * The GitHub closing-keyword universe (case-insensitive). Ordered longest-first
 * inside {@link AUTO_CLOSE_REGEX_SOURCE} so the alternation prefers the full
 * inflection before a shorter prefix.
 */
export const AUTO_CLOSE_KEYWORDS = [
  'close',
  'closes',
  'closed',
  'fix',
  'fixes',
  'fixed',
  'resolve',
  'resolves',
  'resolved',
] as const;

/**
 * Canonical auto-close pattern source (apply flags `gi` when compiling).
 *
 *   - `\b(?:closed|closes|close|…)\b` — word-boundaried keyword, so `prefix`,
 *     `affixes`, and `fixup` never match (substring-safe both ends).
 *   - `\s*(?::\s*|\s+)` — separator is a colon (optionally spaced) OR ≥1
 *     whitespace: matches GitHub's `keyword #N` and `keyword: #N`; declines
 *     `closed#88` (no separator), exactly as GitHub declines it.
 *   - `(?:([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#|#)(\d+)` — optional `owner/repo`
 *     qualifier (qualified refs still auto-close — group 1) then the captured
 *     issue number (group 2).
 *
 * Linear-time (no nested quantifier over overlapping classes) — safe against
 * catastrophic backtracking.
 */
export const AUTO_CLOSE_REGEX_SOURCE =
  '\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b\\s*(?::\\s*|\\s+)(?:([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#|#)(\\d+)';

/** One close-keyword-adjacent issue reference found in a text surface. */
export interface AutoCloseMatch {
  /** The matched keyword, verbatim (original casing). */
  keyword: string;
  /** The `owner/repo` qualifier when the ref was qualified, else undefined. */
  qualifier?: string;
  /** The referenced issue number. */
  issue: number;
  /**
   * Normalized comparison key: `owner/repo#N` (lowercased) when qualified, else
   * `#N`. Use {@link autoCloseKeyForms} to expand same-repo equivalences.
   */
  ref: string;
  /** Byte offset of the match start within the scanned text. */
  index: number;
}

/** Fresh, correctly-flagged regex per call (the `g` flag makes it stateful). */
function compile(): RegExp {
  return new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
}

/** Normalize a `(qualifier, issue)` pair to its canonical comparison key. */
function normalizeRef(qualifier: string | undefined, issue: number): string {
  return qualifier ? `${qualifier.toLowerCase()}#${issue}` : `#${issue}`;
}

/**
 * All comparison keys a reference is equivalent to, so a same-repo bare `#N` and
 * a self-qualified `owner/repo#N` reconcile against each other.
 *
 *   - qualified `owner/repo#N` → `owner/repo#N`; plus bare `#N` when
 *     `owner/repo` IS `repo`.
 *   - bare `#N` → `#N`; plus `repo#N` when `repo` is known.
 */
export function autoCloseKeyForms(
  ref: { qualifier?: string; issue: number },
  repo?: string,
): string[] {
  const forms = new Set<string>();
  const repoLc = repo?.toLowerCase();
  if (ref.qualifier) {
    const q = ref.qualifier.toLowerCase();
    forms.add(`${q}#${ref.issue}`);
    if (repoLc !== undefined && q === repoLc) forms.add(`#${ref.issue}`);
  } else {
    forms.add(`#${ref.issue}`);
    if (repoLc !== undefined) forms.add(`${repoLc}#${ref.issue}`);
  }
  return [...forms];
}

/**
 * Scan `text` for every close-keyword-adjacent issue reference. Zero semantics —
 * negated / quoted / emphasized refs are returned identically to genuine ones.
 *
 * Callers must NOT pass issue/PR comment bodies: comments never auto-close, so
 * scanning them is pure false-positive surface (the matcher itself is
 * text-in / matches-out; the no-comments rule lives at each call site).
 */
export function findAutoCloseRefs(text: string): AutoCloseMatch[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out: AutoCloseMatch[] = [];
  for (const m of text.matchAll(compile())) {
    const qualifier = m[1];
    const issue = Number(m[2]);
    if (!Number.isFinite(issue)) continue;
    out.push({
      keyword: m[0].match(/[A-Za-z]+/)?.[0] ?? '',
      ...(qualifier ? { qualifier } : {}),
      issue,
      ref: normalizeRef(qualifier, issue),
      index: m.index ?? 0,
    });
  }
  return out;
}

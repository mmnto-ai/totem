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
 * genuine or negated. Intended closures ride the provenance-distinct `totem-close`
 * marker (see `receipt.ts`) — NOT implicit prose, and NOT GitHub's own
 * `closingIssuesReferences` (which GitHub DERIVES from body keywords, so it would
 * let a body keyword self-whitelist — the circularity codex flagged).
 *
 * Reference forms matched (all normalized to the same `owner/repo#N` / `#N`
 * comparison key so receipts reconcile regardless of surface form):
 *   - bare `#N` and qualified `owner/repo#N` — the two DOCUMENTED closing forms
 *     (docs.github.com/.../linking-a-pull-request-to-an-issue).
 *   - the issue/PR **URL** form `https://github.com/owner/repo/(issues|pull)/N`
 *     (tolerant of a trailing `#issuecomment-…` permalink fragment). This form is
 *     UNDOCUMENTED for closing but EMPIRICALLY closes — isaacs/github#1731 (the
 *     comment-permalink over-fire) and real-world reliance (SAP/spartacus
 *     CONTRIBUTING instructs `Fixes https://github.com/SAP/spartacus/issues/<n>`).
 *     Matched presence-invariantly so it cannot slip past D1/D2 (kimi BLOCKING-1).
 *
 * DELIBERATE current behavior (pinned by fixtures; empirical questions routed to
 * the arming-phase sandbox matrix — see spec §arming):
 *   - emphasis/backtick wrapping ONLY the keyword (`**closes** #N`) → MISS
 *     (the `**`/`` ` `` severs keyword→ref adjacency in the raw text).
 *   - the `GH-N` autolink form (`fix GH-123`) → MISS (undocumented for closing).
 *   - a cross-paragraph span (`closes\n\n#N`) → MATCH (over-fires; a paragraph
 *     break likely severs adjacency in GitHub, but the invariant prefers a
 *     receipt demand over a silent miss).
 *   - a fenced code block (```` ```\ncloses #N\n``` ````) → MATCH (over-fires;
 *     the `totem-context` directive is the author escape for a quoted example).
 *
 * SINGLE-SOURCE SEAM: this module is the sole owner of the auto-close pattern.
 * Consumers must import {@link AUTO_CLOSE_REGEX_SOURCE} / {@link findAutoCloseRefs}
 * from here — never copy the regex. Current consumers: D1 (PR-time required
 * check) + D2 (post-merge reconciliation) workflow scripts, and C's rendered
 * PreWriteShield / BeforeTool hook templates (which inline
 * `JSON.stringify(AUTO_CLOSE_REGEX_SOURCE)` — a local mirror drift-locked by a
 * parity test, the same shape as `BARE_REF_REGEX_SOURCE`). The gated A+B layer
 * (Bash-matcher interlock + `totem pr merge` wrapper, mmnto-ai/totem-strategy#951)
 * MUST also consume this same evaluator via thin per-host adapters — no per-lane
 * regex.
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
 *   - `(?:\s*:\s*|\s+)` — separator is a colon (optionally spaced) OR ≥1
 *     whitespace: matches GitHub's `keyword #N` and `keyword: #N`; declines
 *     `closed#88` (no separator), exactly as GitHub declines it. The two
 *     alternatives are DISJOINT (no shared `\s*` prefix), so a pathological
 *     whitespace run backtracks linearly — NOT the O(n²) the previous
 *     `\s*(?::\s*|\s+)` shape measured (kimi NON-BLOCKING-1). Overall cost is
 *     bounded by GitHub's ~64KB body limit.
 *   - ref alternation, tried URL-first: the issue/PR URL form (groups 1+2), the
 *     qualified `owner/repo#N` form (groups 3+4), then the bare `#N` form
 *     (group 5). See {@link findAutoCloseRefs} for the group→ref mapping.
 */
export const AUTO_CLOSE_REGEX_SOURCE =
  '\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b' +
  '(?:\\s*:\\s*|\\s+)' +
  '(?:https?://github\\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/(\\d+)' +
  '|([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#(\\d+)' +
  '|#(\\d+))';

/** One close-keyword-adjacent issue reference found in a text surface. */
export interface AutoCloseMatch {
  /** The matched keyword, verbatim (original casing). */
  keyword: string;
  /** The `owner/repo` qualifier when the ref was qualified/URL, else undefined. */
  qualifier?: string;
  /** The referenced issue number. */
  issue: number;
  /**
   * Normalized comparison key: `owner/repo#N` (lowercased) when qualified/URL,
   * else `#N`. Use {@link autoCloseKeyForms} to expand same-repo equivalences.
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
 * a self-qualified `owner/repo#N` (or its URL form) reconcile against each other.
 * `repo` is REQUIRED (kimi observation): omitting it silently degrades
 * bare↔qualified reconciliation, and every real caller has the target repo.
 *
 *   - qualified `owner/repo#N` → `owner/repo#N`; plus bare `#N` when
 *     `owner/repo` IS `repo`.
 *   - bare `#N` → `#N`; plus `repo#N`.
 */
export function autoCloseKeyForms(
  ref: { qualifier?: string; issue: number },
  repo: string,
): string[] {
  const forms = new Set<string>();
  const repoLc = repo.toLowerCase();
  if (ref.qualifier) {
    const q = ref.qualifier.toLowerCase();
    forms.add(`${q}#${ref.issue}`);
    if (q === repoLc) forms.add(`#${ref.issue}`);
  } else {
    forms.add(`#${ref.issue}`);
    forms.add(`${repoLc}#${ref.issue}`);
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
    // Group layout: 1+2 = URL owner/repo + number; 3+4 = qualified owner/repo +
    // number; 5 = bare number.
    let qualifier: string | undefined;
    let issueStr: string | undefined;
    if (m[1] !== undefined) {
      qualifier = m[1];
      issueStr = m[2];
    } else if (m[3] !== undefined) {
      qualifier = m[3];
      issueStr = m[4];
    } else {
      issueStr = m[5];
    }
    const issue = Number(issueStr);
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

// ─── S4 corpus selectionRule predicate (ADR-110 §6) ─────────────────────────
//
// Pure, deterministic re-derivation of the wind-tunnel corpus from offline git
// metadata — NO GitHub-API fields (the §4 offline-derivation invariant). Given
// the same `asOfCommit` + the same frozen config, `resolveSelectionRule` yields
// a byte-identical PR-number set on every run; that determinism is what turns
// the §6 check `resolvedPrs ≡ selectionRule(asOfCommit)` from a tautology into a
// real gate. IO (git enumeration → PrMeta) lives in the cli layer; this module
// is the pure mathematical predicate over PrMeta.

// ─── Types ──────────────────────────────────────────

/**
 * Frozen code-path classifier. A changed file is code-touching iff it matches
 * ≥1 `includeGlobs` AND no `excludeGlobs` — exclude wins at the FILE level.
 */
export interface CodePathClassifier {
  includeGlobs: string[];
  excludeGlobs: string[];
}

/** Frozen selectionRule config, read from `lock.corpus.selectionRule`. */
export interface SelectionRuleConfig {
  /** Required at certifying resolve (caller hard-errors if absent). */
  codePathClassifier: CodePathClassifier;
  /** Exclude a revert PR AND its reverted target. Manifest flag, default true. */
  excludeRevertPairs: boolean;
  /** Exclude `[bot]`-authored PRs. Manifest flag, default true. */
  excludeBotPrs: boolean;
  /**
   * Corpus window. `all` = every qualifying PR reachable from `asOfCommit`;
   * `bounded` = the `n` MOST-RECENT qualifying PRs (newest-first by merge order).
   */
  window: { type: 'all' } | { type: 'bounded'; n: number };
}

/** Git-derived facts about one merged (squash) PR reachable from `asOfCommit`. */
export interface PrMeta {
  pr: number;
  /** The squash-merge commit SHA (lowercase 40-hex). */
  mergeCommit: string;
  /** Author identity (name/email) used for bot detection. */
  author: string;
  /** True iff `author` ends with `[bot]` (case-insensitive). */
  isBotAuthor: boolean;
  /** If this PR is a revert, the target SHA from `This reverts commit <sha>`. */
  revertsSha?: string;
  /** Changed file paths, forward-slash normalized. */
  changedFiles: string[];
}

/** Symmetric difference between the expected (git) and actual (manifest) PR sets. */
export interface PrSetDiff {
  /** In git, absent from the manifest. */
  missing: number[];
  /** In the manifest, absent from git. */
  extra: number[];
}

/** Thrown when a merge subject carries a TRAILING `(#…)` that is not a valid PR ref. */
export class SelectionRuleParseError extends Error {
  constructor(public readonly subject: string) {
    super(
      `Malformed PR ref in merge subject (trailing parenthesized ref is not a positive integer): ${subject}`,
    );
    this.name = 'SelectionRuleParseError';
  }
}

// ─── Glob matching (self-contained; frozen narrow classifier) ────────────────

function escapeRegexChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

/**
 * Translate a path glob to an anchored RegExp. Supports:
 *   `**​/`     → zero or more path segments
 *   `**`      → any characters including `/`
 *   `*`       → any characters except `/`
 *   `?`       → a single character except `/`
 *   `{a,b,c}` → brace alternation (e.g. `**​/*.{ts,tsx}`)
 * Sufficient for the frozen code-path classifier; avoids a glob dependency and
 * keeps matching deterministic/offline.
 */
function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, '/');
  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:[^/]+/)*'; // '**/' → zero or more segments (matches the empty case)
          i += 3;
        } else {
          re += '.*'; // '**' (e.g. trailing) → any chars incl. '/'
          i += 2;
        }
      } else {
        re += '[^/]*'; // '*' → any chars within a segment
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end > i) {
        const alts = g
          .slice(i + 1, end)
          .split(',')
          .map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // alternatives are literals
        re += `(?:${alts.join('|')})`; // '{ts,tsx}' → '(?:ts|tsx)'
        i = end + 1;
      } else {
        re += escapeRegexChar(c); // unmatched '{' → literal
        i += 1;
      }
    } else {
      re += escapeRegexChar(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

const globCache = new Map<string, RegExp>();
function matchGlob(filePath: string, glob: string): boolean {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(filePath);
}

/**
 * A PR is code-touching iff at least one changed file matches ≥1 includeGlob and
 * no excludeGlob. Exclude wins at the FILE level (not the PR level), so a PR
 * with a mix of code + doc files is still code-touching, while a docs/config/
 * generated-only PR is excluded because no file survives the classifier.
 */
export function isCodeTouching(changedFiles: string[], classifier: CodePathClassifier): boolean {
  return changedFiles.some((raw) => {
    const file = raw.replace(/\\/g, '/');
    const included = classifier.includeGlobs.some((g) => matchGlob(file, g));
    if (!included) return false;
    const excluded = classifier.excludeGlobs.some((g) => matchGlob(file, g));
    return !excluded;
  });
}

// ─── Git-convention detectors (offline, §4) ──────────────────────────────────

/**
 * Bot iff the author identity is a GitHub bot. `author` is git's `%an <%ae>` —
 * e.g. `dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>` — so
 * checking the whole string's suffix would fail (it ends with `>`). Strip the
 * trailing ` <email>` and test the display NAME's `[bot]` suffix, and also match
 * a `[bot]@` noreply email; robust to the name-only or name+email forms.
 */
export function isBotIdentity(author: string): boolean {
  const a = author.replace(/\r/g, '').trim().toLowerCase();
  const name = a.replace(/\s*<[^>]*>\s*$/, '');
  return name.endsWith('[bot]') || /\[bot\]@/.test(a);
}

const REVERT_BODY_REGEX = /^This reverts commit ([0-9a-f]{7,40})\b/im;

/** Extract the reverted target SHA from a `This reverts commit <sha>` body line. */
export function parseRevertSha(commitBody: string): string | undefined {
  const m = REVERT_BODY_REGEX.exec(commitBody.replace(/\r/g, ''));
  return m ? m[1]!.toLowerCase() : undefined;
}

// ─── PR-number extraction (lc squash convention) ─────────────────────────────

const TRAILING_PR_REGEX = /\(#(\d+)\)\s*$/;
const TRAILING_PAREN_REF_REGEX = /\(#[^)]*\)\s*$/;

/**
 * Extract the PR number from a squash-merge subject's TRAILING `(#N)`.
 * - No trailing `(#…)` at all → `null` (a direct-to-main non-PR commit; skip).
 * - Trailing `(#N)` with a positive integer → that number. Anchored to the END,
 *   so `…spec (#533) (#534)` → 534 and `…(closes #522) (#524)` → 524 (earlier
 *   refs are issue refs, not the PR).
 * - Trailing parenthesized ref that is NOT a positive integer (`(#abc)`, `(#)`,
 *   `(#0)`, `(#-1)`) → throws `SelectionRuleParseError` (malformed, never silent).
 */
export function parsePrNumber(subject: string): number | null {
  const s = subject.replace(/\r/g, '');
  const m = TRAILING_PR_REGEX.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) return n;
    throw new SelectionRuleParseError(subject); // e.g. "(#0)"
  }
  if (TRAILING_PAREN_REF_REGEX.test(s)) {
    throw new SelectionRuleParseError(subject); // e.g. "(#abc)", "(#)", "(#-1)"
  }
  return null;
}

// ─── The predicate + two-pass resolver ───────────────────────────────────────

/**
 * Per-PR predicate (pure, single-PrMeta): code-touching AND (not bot, when
 * excluded) AND (not itself a revert, when excluded). The reverted-TARGET
 * exclusion is NOT here — it needs cross-candidate context and lives in the
 * second pass of `resolveSelectionRule`.
 */
export function selectionRulePredicate(meta: PrMeta, config: SelectionRuleConfig): boolean {
  if (!isCodeTouching(meta.changedFiles, config.codePathClassifier)) return false;
  if (config.excludeBotPrs && meta.isBotAuthor) return false;
  if (config.excludeRevertPairs && meta.revertsSha !== undefined) return false;
  return true;
}

/**
 * Resolve the corpus PR set from enumerated PrMetas (already filtered to
 * ancestors of `asOfCommit` by the caller). Two-pass when excluding revert
 * pairs: (1) collect reverted-target SHAs; (2) apply the per-PR predicate, then
 * drop any candidate whose `mergeCommit` is a reverted target. Fail-safe: a
 * target SHA that maps to no in-window candidate (direct-to-main / out-of-
 * ancestry) drops nothing — only the revert PR itself is excluded (by the
 * predicate). Returns sorted unique PR numbers.
 */
export function resolveSelectionRule(metas: PrMeta[], config: SelectionRuleConfig): number[] {
  const revertedTargetShas: string[] = [];
  if (config.excludeRevertPairs) {
    for (const m of metas) {
      if (m.revertsSha) revertedTargetShas.push(m.revertsSha);
    }
  }
  const isRevertedTarget = (mergeCommit: string): boolean =>
    revertedTargetShas.some((t) => mergeCommit.toLowerCase().startsWith(t));

  // Qualifying PRs in INPUT order — the caller passes them in git-log order
  // (newest-first), so a bounded window's "most recent N" is the first N here.
  const qualifying: number[] = [];
  const seen = new Set<number>();
  for (const m of metas) {
    if (!selectionRulePredicate(m, config)) continue;
    if (isRevertedTarget(m.mergeCommit)) continue;
    if (seen.has(m.pr)) continue;
    seen.add(m.pr);
    qualifying.push(m.pr);
  }
  const windowed =
    config.window.type === 'bounded' ? qualifying.slice(0, config.window.n) : qualifying;
  return [...windowed].sort((a, b) => a - b);
}

// ─── Deep set-equality (§6) ───────────────────────────────────────────────────

/** Symmetric difference; both sides normalized to unique sets, order-invariant. */
export function diffPrSets(expected: number[], actual: number[]): PrSetDiff {
  const e = new Set(expected);
  const a = new Set(actual);
  const missing = [...e].filter((x) => !a.has(x)).sort((x, y) => x - y);
  const extra = [...a].filter((x) => !e.has(x)).sort((x, y) => x - y);
  return { missing, extra };
}

/** Membership + count equality (NOT reference/order). */
export function prSetsEqual(expected: number[], actual: number[]): boolean {
  const d = diffPrSets(expected, actual);
  return d.missing.length === 0 && d.extra.length === 0;
}

// ─── ADR-111 Stage-1 Extract (slice β): review-bot chrome normalization ───────
//
// strategy#709 yield-fix β. The Gate-1 cert corpus is a BOT-REVIEWED repo: its
// highest-signal review comments come from `gemini-code-assist` / `coderabbitai`,
// whose bodies are wrapped in heavy presentational MARKDOWN CHROME — severity
// image badges, `<details>` "analysis chain" collapsibles, AI-agent-prompt
// footers — that dilutes the extractor's signal (the mechanically-checkable
// invariant the reviewer asserted) with noise the LLM must wade through.
//
// `normalizeReviewChrome` is a DETERMINISTIC, AUDIT-PRESERVING strip of that
// chrome. AUDIT-PRESERVING: the caller KEEPS the raw `body` and ADDS a
// `normalizedBody` (extract.ts) — the raw text is never destroyed, so a frozen
// corpus stays fully re-derivable. DETERMINISTIC: pure string→string, no IO / no
// `Date` / no locale; identical input → identical output, and IDEMPOTENT
// (`normalize(normalize(x)) === normalize(x)`) so a double-application can never
// drift the extractorInputKey.
//
// PROVENANCE (Tenet-15): `REVIEW_CHROME_NORMALIZER_VERSION` is folded into the
// replay provenance block (the CLI `buildReplayProvenance`), so a normalizer
// change flips the whole-artifact integrity hash AND the extractorInputKey
// (the key digests `normalizedBody`, not the raw body) — EITHER path forces a
// re-record; a changed normalizer can never silently serve stale frozen outputs.
//
// SCOPE (panel OQ-β3 — normalization lives in CORE, not the adapter): the LOGIC
// + VERSION are single-homed here so the CLI adapter (which only INVOKES this at
// the mapping boundary) cannot drift the inputKey from the provenance. The strip
// is intentionally CONSERVATIVE — it removes presentational wrappers (badges,
// collapsibles, HTML comments) but never code fences or the reviewer's prose, so
// the asserted invariant survives for the extractor.

/**
 * Normalizer schema version (mirrors `PROMPT_BUILDER_VERSION`). Bump on ANY change
 * to the strip rules below → the replay provenance hash flips → a re-record is
 * forced (Tenet-15). The version is BOTH a human-readable pin and an integrity
 * lever; never edit a rule without bumping it.
 */
export const REVIEW_CHROME_NORMALIZER_VERSION = 'review-chrome-normalizer:v1';

// Presentational-chrome patterns, applied in order. Each is a GLOBAL replace, so
// after one pass no match remains → a second pass is a no-op (idempotence). None
// of these can match a fenced code body's interior in a way that re-triggers, so
// the pass order is irrelevant to the fixed point.

/** Markdown image (severity badge): `![alt](url)` — gemini/CR render severity as an SVG badge. */
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
/** HTML `<img …>` badge (the non-markdown severity-image form). */
const HTML_IMG_RE = /<img\b[^>]*>/gi;
/** `<details>…</details>` collapsible (analysis-chain / AI-prompt / tool-dump chrome). Non-greedy. */
const DETAILS_RE = /<details\b[\s\S]*?<\/details>/gi;
/** HTML comment `<!-- … -->` (tracking / tool chrome). */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
/** 3+ consecutive blank lines → collapsed to a single blank line (stable whitespace). */
const EXCESS_BLANKS_RE = /\n{3,}/g;
/**
 * A triple-backtick fenced code block (non-greedy). Used to PARTITION the body so
 * the chrome strips run ONLY on the prose BETWEEN fences — a fence body may
 * legitimately contain chrome-looking tokens (`<!-- -->`, `![…](…)`, `<img>`,
 * `<details>`) that are the very invariant the extractor mines, so they must
 * survive verbatim (CR #2242 — the "never touch fenced code blocks" contract).
 */
const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;

/** Apply every chrome strip to ONE prose segment (never a fenced-code segment). */
function stripChrome(segment: string): string {
  return segment
    .replace(DETAILS_RE, '')
    .replace(HTML_COMMENT_RE, '')
    .replace(MD_IMAGE_RE, '')
    .replace(HTML_IMG_RE, '');
}

/**
 * Strip presentational review-bot chrome from a comment body, returning the
 * de-chromed text. DETERMINISTIC + IDEMPOTENT + AUDIT-PRESERVING (the caller
 * retains the raw body). Removes severity badges (markdown + HTML images),
 * `<details>` collapsibles, and HTML comments, then normalizes line endings and
 * collapses runaway blank runs.
 *
 * FENCED CODE BLOCKS ARE PRESERVED VERBATIM (CR #2242): the body is partitioned on
 * triple-backtick fences and the strips run ONLY on the prose between them, so a
 * chrome-looking token INSIDE a code fence (the reviewer's literal example) is
 * never deleted. It also does not touch the reviewer's prose words — over-stripping
 * would drop the very invariant the extractor mines. A body with no chrome (e.g. a
 * human comment) is returned unchanged apart from CRLF→LF + trim.
 */
export function normalizeReviewChrome(body: string): string {
  const lf = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let out = '';
  let cursor = 0;
  // Strip chrome from each prose run; copy each fenced block through untouched.
  for (const match of lf.matchAll(FENCED_CODE_BLOCK_RE)) {
    const start = match.index ?? 0;
    out += stripChrome(lf.slice(cursor, start));
    out += match[0];
    cursor = start + match[0].length;
  }
  out += stripChrome(lf.slice(cursor));
  return out.replace(EXCESS_BLANKS_RE, '\n\n').trim();
}

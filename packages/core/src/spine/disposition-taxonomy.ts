// ─── #709 ground-truth deriver — slice 5d-i: the closed disposition taxonomy ──
//
// The deterministic, LLM-FREE classifier that turns a held-out review thread's
// human dispositions into a closed taxonomy class, then into a cert-run
// ground-truth label (TP / FP / UNLABELED). It is the answer-key's labeling
// primitive: slice 5d-iii enumerates the real `RuleFiring`s (via replay) and
// joins each to a held-out disposition by span; THIS module decides what that
// disposition MEANS.
//
// Contract (strategy#709 c.4762840182 + c.4764980503, RULED): the label SOURCE is
// the disposition-derived DRAFT under a CLOSED taxonomy —
//   accepted-fix                 ⟹ TP
//   declined-as-false-positive   ⟹ FP
//   scope · defer · superseded · style · ambiguous ⟹ UNLABELED (omit)
// inheriting ADR-110/111 unchanged. Zero LLM-judge (that is #710 Phase-2); this
// is a heuristic over the review text + the binary disposition vocabulary.
//
// Why a NEW classifier and not the binary `bot-review-parser` primitive
// (codex panel, BLOCKING-3): that primitive intentionally over-matches the WHOLE
// decline vocabulary to `declined` ("a lost lesson, never a laundered one",
// mmnto-ai/totem#2124) — SAFE for keeping bad lessons out of mining, UNSAFE as a
// cert FALSE-POSITIVE label. A "declined, tracked for later / too broad for this
// PR" (a scope/defer decline) is NOT evidence the code is clean; mapping it to FP
// would FAIL a sound rule. So this classifier PARTITIONS that vocabulary: only an
// unambiguous correctness rebuttal ("false positive / by design / works as
// intended") becomes FP; scope/defer/superseded/style declines stay UNLABELED.
//
// Conservative-by-construction (codex/gemini/agy/strategy-claude converged): only
// an UNAMBIGUOUS accepted-fix → TP and an UNAMBIGUOUS declined-as-false-positive →
// FP; every conflict, soft signal, or absent human disposition → UNLABELED. Under-
// labeling routes to the scorer's `needsAdjudication` → HONEST-NEGATIVE (Tenet 4
// fail-soft for the answer key), never a guessed PASS. The resolution flags
// (`isResolved`/`isOutdated`) are disposition EVIDENCE, not determinative, and are
// the span-join's concern (5d-iii) — this taxonomy is text-driven only, so a bare
// `isResolved` thread never becomes TP on the flag alone (codex WARNING-5).

import { isBotIdentity } from './selection-rule.js';
import type { GroundTruthLabel } from './windtunnel-scorer.js';

// ── The closed taxonomy ──────────────────────────────────────────────────────

/**
 * The closed disposition taxonomy (strategy#709 RULED). `accepted-fix` and
 * `declined-as-false-positive` are the only LABEL-BEARING classes; the rest are
 * deliberately UNLABELED outcomes — a valid-but-not-actioned decline is NOT
 * evidence the code is clean, so it never labels a firing.
 */
export type DispositionClass =
  | 'accepted-fix' // → TP
  | 'declined-as-false-positive' // → FP
  | 'scope' // → UNLABELED — valid finding, out of this PR's scope
  | 'defer' // → UNLABELED — valid finding, deferred (later / tracked / won't-fix)
  | 'superseded' // → UNLABELED — the flagged code was refactored/removed away
  | 'style' // → UNLABELED — a stylistic nit / subjective preference
  | 'ambiguous'; // → UNLABELED — no clear human disposition, or conflicting signals

/** A single review-thread comment (the provider-neutral subset the taxonomy reads). */
export interface DispositionComment {
  author: string;
  body: string;
}

// ── Pattern banks (the partition of the decline vocabulary) ──────────────────

/**
 * accepted-fix signal: a human confirmed the finding was actioned. A commit-SHA
 * or `tracked-in-#` reference alone is NOT here — a tracked reference is a DEFER
 * (the fix is future), and a bare SHA is too noisy to credit as acceptance.
 */
const FIX_PATTERNS: readonly RegExp[] = [
  /\bfixed\b/i,
  // Confirmed-PAST construction only. The bare `addressed`/`applied`/`done` words —
  // and the praise words `good catch`/`nice catch` (CR #2230 round-2) — were
  // negation-blind ("this has not been addressed", "not a good catch …") and, in the
  // praise case, not even a fix CONFIRMATION (acknowledging a real finding ≠ acting
  // on it). All minted false TPs. The canonical bare accept `fixed` is kept; the TP
  // signal "good catch, fixed!" is still covered by `fixed`. Finer negation handling
  // is the 5d-ii real-corpus measure-first task (strategy-claude RULED #4 run-first).
  /\b(?:has|have|now)\s+been\s+(?:fixed|addressed|applied)\b/i,
];

/**
 * declined-as-false-positive signal: a CORRECTNESS rebuttal — the human asserts
 * the code is correct and the finding is WRONG. This is the ONLY decline class
 * that becomes an FP label, so the bank is kept tight to genuine correctness
 * claims (not the broad pushback vocabulary the binary primitive matches).
 */
const FALSE_POSITIVE_PATTERNS: readonly RegExp[] = [
  /\bfalse\s+positive\b/i,
  /\bnot\s+a\s+(?:bug|problem|issue|real)\b/i,
  /\b(?:works|working|behaves)\s+as\s+(?:intended|designed|expected)\b/i,
  /\bby\s+design\b/i,
  // Anchored to the AFFIRMATIVE copula. Bare `intentional(ly)` was negation- and
  // future-blind: "this behavior is not intentional" (greptile #2230 :91) and
  // "intentionally structured it, will fix the edge case" (strategy-claude note)
  // both minted a false FP. `is intentional` keeps the genuine rebuttal.
  /\bis\s+intentional\b/i,
  // `correct` REMOVED from both `not …` and `this is …` (GCA #2230 :95). In review,
  // "this is not correct" / "this is correct, I'll fix it" AGREE with the finding
  // (a True Positive) — matching `correct` here inverted the label to FP.
  /\bnot\s+(?:applicable|relevant|an\s+issue)\b/i,
  /\bthis\s+is\s+(?:fine|intended|safe)\b/i,
  /\bincorrect\s+(?:finding|flag|warning|suggestion)\b/i,
];

/** scope decline (UNLABELED): valid finding, not this PR. */
const SCOPE_PATTERNS: readonly RegExp[] = [
  /\bout\s+of\s+scope\b/i,
  /\btoo\s+broad\b/i,
  /\b(?:separate|different|another|its\s+own)\s+PR\b/i,
  /\bnot\s+(?:in\s+)?this\s+PR\b/i,
  /\bunrelated\b/i,
];

/** defer decline (UNLABELED): valid finding, postponed. `won't fix` lands here (conservative — not an FP). */
const DEFER_PATTERNS: readonly RegExp[] = [
  /\bfollow[\s-]?up\b/i,
  /\btracked\s+in\s+#?\d+/i,
  /\bwon'?t\s+fix\b/i,
  /\b(?:later|future|subsequent|backlog)\b/i,
  /\bTODO\b/i, // /i for parity with every other bank (greptile #2230 :112 — "todo: track this")
];

/** superseded decline (UNLABELED): the flagged code is gone. */
const SUPERSEDED_PATTERNS: readonly RegExp[] = [
  /\b(?:refactored|rewritten|removed|deleted|moved)\b/i,
  /\bno\s+longer\s+(?:applies|exists|relevant|present)\b/i,
  /\bobsolete\b/i,
];

/** style decline (UNLABELED): subjective / cosmetic. */
const STYLE_PATTERNS: readonly RegExp[] = [
  /\bnit(?:pick)?\b/i,
  /\b(?:just\s+a\s+)?preference\b/i,
  /\bsubjective\b/i,
  /\bstylistic\b/i,
  /\bcosmetic\b/i,
];

const matchesAny = (text: string, bank: readonly RegExp[]): boolean =>
  bank.some((p) => p.test(text));

// ── The classifier ───────────────────────────────────────────────────────────

/**
 * Classify a held-out review thread's disposition under the closed taxonomy.
 *
 * Reads the HUMAN (non-bot) comments only — the human is the one who disposes; a
 * bot's own follow-up is not a disposition (and `isResolved` alone is never TP,
 * codex WARNING-5). Conservative precedence:
 *   1. No human disposition comment              → ambiguous (UNLABELED)
 *   2. accepted-fix AND false-positive present   → ambiguous (conflicting signals)
 *   3. accepted-fix, no decline of any kind      → accepted-fix (TP)
 *   4. false-positive, no fix and no soft decline → declined-as-false-positive (FP)
 *   5. otherwise a soft decline present          → scope | defer | superseded | style (UNLABELED)
 *   6. no recognizable signal                    → ambiguous (UNLABELED)
 *
 * Steps 3/4 require a CLEAN signal: a fix that is also scoped/deferred, or an FP
 * rebuttal that is also a scope/defer decline, collapses to ambiguous — the
 * answer key must not credit a contradictory disposition. This defeats codex's
 * falsifying case ("declined, too broad / tracked for later" never becomes FP).
 */
export function classifyDisposition(comments: ReadonlyArray<DispositionComment>): DispositionClass {
  const humanText = comments
    .filter((c) => !isBotIdentity(c.author) && c.body.trim().length > 0)
    .map((c) => c.body);

  if (humanText.length === 0) return 'ambiguous';

  const joined = humanText.join('\n');
  const fix = matchesAny(joined, FIX_PATTERNS);
  const fp = matchesAny(joined, FALSE_POSITIVE_PATTERNS);
  const scope = matchesAny(joined, SCOPE_PATTERNS);
  const defer = matchesAny(joined, DEFER_PATTERNS);
  const superseded = matchesAny(joined, SUPERSEDED_PATTERNS);
  const style = matchesAny(joined, STYLE_PATTERNS);
  const softDecline = scope || defer || superseded || style;

  // 2. Conflicting label-bearing signals → never credit one over the other.
  if (fix && fp) return 'ambiguous';

  // 3. Clean accepted-fix: a fix that is ALSO scoped/deferred is contradictory.
  if (fix && !softDecline) return 'accepted-fix';

  // 4. Clean correctness rebuttal: an FP that is ALSO a soft decline is impure.
  if (fp && !softDecline) return 'declined-as-false-positive';

  // A label-bearing signal that reached here is IMPURE (it co-occurs with a soft
  // decline — "fixed the related part; the rest is out of scope", "arguably a
  // false positive, but tracked in #99"). We cannot attribute the fix/rebuttal to
  // THIS firing's span, so it credits neither a label nor a soft-decline class.
  if (fix || fp) return 'ambiguous';

  // 5. A pure soft decline (no label-bearing signal) → its specific UNLABELED
  // class (precedence: the most label-protective first — a scope/superseded claim
  // is a stronger "do not label" than a style nit).
  if (scope) return 'scope';
  if (superseded) return 'superseded';
  if (defer) return 'defer';
  if (style) return 'style';

  // 6. Reached only when fix=false AND fp=false AND no soft-decline matched — the
  // human spoke but carried no recognizable disposition. (Impure label-bearing
  // cases are already caught by the `fix || fp` guard above, never here.)
  return 'ambiguous';
}

/**
 * Project a taxonomy class onto a cert-run ground-truth label. The two
 * label-bearing classes map to TP/FP; every UNLABELED class returns `null` — the
 * deriver OMITS the firing's labelId from `ground-truth-labels.json`, and the
 * scorer routes the un-keyed firing to `needsAdjudication` → HONEST-NEGATIVE.
 */
export function dispositionToLabel(cls: DispositionClass): GroundTruthLabel | null {
  switch (cls) {
    case 'accepted-fix':
      return 'TP';
    case 'declined-as-false-positive':
      return 'FP';
    case 'scope':
    case 'defer':
    case 'superseded':
    case 'style':
    case 'ambiguous':
      return null;
  }
}

/**
 * ADR-112 §4/§6 — the preimage-differential materializer (slice C1: the inert primitive).
 *
 * An authored rule is only a legitimate positive control if its matcher **fires
 * on the defect preimage** and is **silent on the fixed postimage** (§4). A
 * matcher that fires on the *fixed* form is "fix-shaped" — the exact failure
 * mode the miner's honest-negative is made of — and must never be admitted as a
 * legitimate control (Falsifying Metric §1(i)).
 *
 * This module evaluates that differential against a fixture's declared
 * `preimageSource` (lesson-anchored PRIMARY / commit-pair FALLBACK) and reports
 * the raw evidence + a differential-level classification. It is deliberately
 * INERT: it wires nothing into the cert path, mints no §5 run verdict, and emits
 * no controls. Slice C2 consumes this to gate control emission; slice D maps the
 * differential to the ADR-110 §5 terminal vocabulary (PASS / FAIL /
 * HONEST-NEGATIVE). The boundary is load-bearing — `over-match` / `vacuous` here
 * are DIFFERENTIAL outcomes, NOT run verdicts (the scorer owns that).
 *
 * Seam (Tenet-21 reuse): firing goes through `runSmokeGate`, the same
 * role-agnostic engine entry point the compiler's #1408 under-match / #1580
 * over-match checks use — regex and ast-grep, in-memory, no temp file, no diff
 * fabrication, no `firingLabelId` minted here. The lesson source evaluates
 * against the in-record `badExample`/`goodExample` exemplars (contract §5.4), so
 * the lesson path is pure and hermetic — no clock, no network, no filesystem.
 */

import { runSmokeGate } from '../compile-smoke-gate.js';
import type { AuthoredFixture, CompiledRule, PreimageSource } from '../compiler-schema.js';

// ─── Types ──────────────────────────────────────────

/**
 * Differential-level classification of a single fixture's preimage/postimage
 * evaluation. NOT an ADR-110 §5 run verdict (PASS/FAIL/HONEST-NEGATIVE) — the
 * scorer (slice D) maps these to that vocabulary. Keep the boundary explicit.
 */
export type PreimageDifferentialOutcome =
  /** Fires on the preimage, silent on the postimage — the legitimate positive control (§4). */
  | 'differential-holds'
  /**
   * Fires on the postimage (the fixed form) and NOT on the preimage — fix-shaped,
   * the literal Falsifying Metric §1(i). Never a charitable pass.
   */
  | 'fix-shaped'
  /**
   * Fires on BOTH the preimage and the postimage. The matcher establishes no
   * differential. This is the cert-critical escape the scorer cannot catch on a
   * synthetic exemplar (its positive-control check is fire-on-preimage only, and
   * a single-occurrence defect's fixed form never appears in the real window) —
   * so the silent-on-postimage leg here is the ONLY signal that surfaces it
   * (contract review, ADR-112 §4/§5.3). C2 must gate on it.
   */
  | 'over-match'
  /** Fires on NEITHER side — the matcher catches nothing (a vacuous control). */
  | 'vacuous-silent'
  /**
   * The engine refused to execute on at least one side (invalid regex, ast-grep
   * runtime throw, an unparseable exemplar, or an engine the smoke gate does not
   * cover) — the differential could not be established. Fail-loud, distinct from
   * a clean no-match; routes to operator adjudication, never a silent pass.
   */
  | 'needs-adjudication'
  /**
   * The fixture declares a `commit`-pair preimage source — deferred to slice C2
   * (the land-then-fix fallback; lc cert-#1 is lesson-anchored). A typed
   * non-pass that keeps the union total; never treated as a passing control.
   */
  | 'unsupported-source';

export interface PreimageDifferentialResult {
  /** The differential-level classification (see `PreimageDifferentialOutcome`). */
  outcome: PreimageDifferentialOutcome;
  /** The fixture's declared preimage-source kind. */
  sourceKind: PreimageSource['kind'];
  /**
   * The matcher fired on the defect preimage. `null` when the preimage could not
   * be evaluated (engine refusal, or an unsupported `commit` source).
   */
  firesOnPreimage: boolean | null;
  /**
   * The matcher stayed silent on the fixed postimage. `null` when the postimage
   * could not be evaluated (engine refusal, or an unsupported `commit` source).
   */
  silentOnPostimage: boolean | null;
  /** Engine match count on the preimage exemplar (evidence). `null` when not evaluated. */
  preimageMatchCount: number | null;
  /** Engine match count on the postimage exemplar (evidence). `null` when not evaluated. */
  postimageMatchCount: number | null;
  /** First-line engine/defer reason — present for `needs-adjudication` / `unsupported-source`. */
  reason?: string;
}

/**
 * Injection port for the COMMIT-pair preimage source (slice C2). The lesson
 * source (C1) needs none of this — it evaluates against in-record exemplars and
 * stays I/O-free. Declared here so C2's git-tree reads inject through an explicit
 * port (mirroring the cert corpus builder's `Stage4VerifierDeps`) and core never
 * does filesystem/git directly. `evaluatePreimageDifferential` is already async
 * so wiring this in C2 is a non-breaking, additive change.
 */
export interface PreimageDifferentialDeps {
  /** Read a file's content as of a given commit SHA (the pre-fix / post-fix tree). */
  readFileAtCommit(commitSha: string, filePath: string): Promise<string>;
}

// ─── Classification ─────────────────────────────────

function classifyDifferential(
  firesOnPreimage: boolean,
  silentOnPostimage: boolean,
): PreimageDifferentialOutcome {
  if (firesOnPreimage && silentOnPostimage) return 'differential-holds';
  if (firesOnPreimage && !silentOnPostimage) return 'over-match';
  if (!firesOnPreimage && silentOnPostimage) return 'vacuous-silent';
  return 'fix-shaped';
}

// ─── Lesson-anchored differential (C1) ──────────────

function evaluateLessonDifferential(
  rule: CompiledRule,
  source: Extract<PreimageSource, { kind: 'lesson' }>,
): PreimageDifferentialResult {
  const pre = runSmokeGate(rule, source.badExample);
  const post = runSmokeGate(rule, source.goodExample);

  // An exemplar with no evaluable code cannot establish a differential. Two
  // ways that happens: (1) the engine REFUSES to run — invalid regex, ast-grep
  // throw, uncovered engine — which `runSmokeGate` reports via `reason`; (2) the
  // exemplar is empty/whitespace-only, which `runSmokeGate` instead reports as a
  // CLEAN no-match (no `reason`) — and that would vacuously read as
  // silent-on-postimage / fires-on-neither, masking that one side had nothing to
  // evaluate (an empty postimage falsely reading as `differential-holds` is the
  // dishonest control this primitive exists to catch). The schema enforces
  // non-empty exemplars, but this is a public primitive reachable by direct
  // (unparsed) construction, so it defends its own contract: either condition on
  // either side → `needs-adjudication`, fail-loud, never a silent clean result.
  const preUnevaluable = source.badExample.trim().length === 0 || pre.reason !== undefined;
  const postUnevaluable = source.goodExample.trim().length === 0 || post.reason !== undefined;
  if (preUnevaluable || postUnevaluable) {
    const reason =
      (source.badExample.trim().length === 0
        ? 'badExample (the defect preimage) is empty or whitespace-only — no evaluable code to establish the differential'
        : pre.reason) ??
      (source.goodExample.trim().length === 0
        ? 'goodExample (the fixed postimage) is empty or whitespace-only — no evaluable code to establish the differential'
        : post.reason);
    return {
      outcome: 'needs-adjudication',
      sourceKind: 'lesson',
      firesOnPreimage: preUnevaluable ? null : pre.matched,
      silentOnPostimage: postUnevaluable ? null : !post.matched,
      preimageMatchCount: preUnevaluable ? null : pre.matchCount,
      postimageMatchCount: postUnevaluable ? null : post.matchCount,
      reason,
    };
  }

  const firesOnPreimage = pre.matched;
  const silentOnPostimage = !post.matched;
  return {
    outcome: classifyDifferential(firesOnPreimage, silentOnPostimage),
    sourceKind: 'lesson',
    firesOnPreimage,
    silentOnPostimage,
    preimageMatchCount: pre.matchCount,
    postimageMatchCount: post.matchCount,
  };
}

function deferredCommitResult(): PreimageDifferentialResult {
  return {
    outcome: 'unsupported-source',
    sourceKind: 'commit',
    firesOnPreimage: null,
    silentOnPostimage: null,
    preimageMatchCount: null,
    postimageMatchCount: null,
    reason:
      'commit-pair preimage source is deferred to slice C2 (land-then-fix fallback); lc cert-#1 is lesson-anchored',
  };
}

// ─── Public API ─────────────────────────────────────

/**
 * Evaluate the ADR-112 §4 preimage-differential for one authored fixture against
 * a compiled rule, switching on the fixture's declared `preimageSource.kind`.
 *
 * Returns the raw evidence (`firesOnPreimage`, `silentOnPostimage`, match counts)
 * plus a differential-level `outcome`. It does NOT mint a §5 run verdict and does
 * NOT emit controls — those are slice C2/D. The `commit` source is a typed
 * non-pass (`unsupported-source`) deferred to C2; the union stays total.
 *
 * Async-from-the-start so C2 can inject `PreimageDifferentialDeps` for git-tree
 * reads without a breaking signature change; the C1 lesson path resolves
 * synchronously under the hood (pure, hermetic).
 */
export async function evaluatePreimageDifferential(
  rule: CompiledRule,
  fixture: AuthoredFixture,
): Promise<PreimageDifferentialResult> {
  const source = fixture.preimageSource;
  switch (source.kind) {
    case 'lesson':
      return evaluateLessonDifferential(rule, source);
    case 'commit':
      return deferredCommitResult();
    default: {
      // Exhaustiveness backstop: a future `PreimageSource` kind must be handled
      // explicitly, never silently admitted as a passing control.
      const _exhaustive: never = source;
      throw new Error(
        `[Totem Error] evaluatePreimageDifferential: unknown preimageSource kind '${String((_exhaustive as PreimageSource).kind)}'`,
      );
    }
  }
}

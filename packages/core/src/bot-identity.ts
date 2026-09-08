/**
 * The ONE definition of the review-bot identities the cohort reads
 * (mmnto-ai/totem#2800, errata item 1).
 *
 * Before this module the same three logins were declared twice — a loose
 * substring/shape match in `packages/cli/src/parsers/bot-review-parser.ts` and
 * an exact-login actor map in `packages/core/src/capability/review-catch.ts` —
 * so a login that drifted (or a fourth bot) had to be found in two places and
 * a stale copy read as "no bot here", the silent direction. Both consumers now
 * import this array; `bot-identity-parity.test.ts` fails if either declares a
 * list of its own.
 *
 * TWO SURFACES, TWO PATTERNS — the trap this module exists to hold:
 * GitHub's REST author is `gemini-code-assist[bot]`, its GraphQL
 * `author.login` for the SAME actor is `gemini-code-assist` (no `[bot]`
 * suffix). Observed 2026-09-07 on mmnto-ai/totem#2834 (REST
 * `repos/mmnto-ai/totem/pulls/2834/reviews` → `coderabbitai[bot]`,
 * `gemini-code-assist[bot]`, `greptile-apps[bot]`) and on
 * mmnto-ai/liquid-city#363 (GraphQL `reviewThreads.comments.author.login` →
 * `gemini-code-assist`). So each identity carries BOTH:
 *   - `loginPattern` — the loose, substring-style read of a REST-shaped login
 *     (triage's surface: recognize every finding, `[bot]` suffix required for
 *     the shape-matched bots so a human `alice-greptile` is never a bot); and
 *   - `loginExact` — an ANCHORED read of a WHOLE login, so the suffix-less
 *     GraphQL spelling matches without the loose pattern having to drop the
 *     `[bot]` anchor (dropping it would misclassify `alice-greptile`).
 * A gate that reads GraphQL (merge-ready) uses `loginExact`; triage keeps
 * `loginPattern`.
 *
 * The GREPTILE login is fixed BY OBSERVATION, not by either stale copy: the
 * runs above show `greptile-apps[bot]` on every totem PR greptile reviewed in
 * the 2026-09 window (#2821, #2827, #2831, #2834). The variant arm
 * (`greptile-<something>`) stays so a renamed/tiered app is still surfaced,
 * and `loginExact` is anchored so it never widens to a human account.
 */

/** Triage's compact tool id (the `BotTool` members that are bots). */
export type BotReviewerTool = 'coderabbit' | 'gca' | 'greptile' | 'ghcq';

export interface BotReviewerIdentity {
  /** Triage's compact display id for this reviewer. */
  tool: BotReviewerTool;
  /**
   * Loose recognition over a REST-shaped author login (`name[bot]`). Substring
   * for the two bots whose login is stable; bot-login SHAPE (with the `[bot]`
   * suffix required) for the two matched by shape.
   */
  loginPattern: RegExp;
  /**
   * Anchored recognition over a WHOLE login — matches the GraphQL spelling,
   * where `[bot]` is absent, without widening the loose pattern.
   */
  loginExact: RegExp;
  /**
   * The stable Layer-B actor id for hit-rate attribution
   * (`capability/review-catch.ts`), when this reviewer has one. `ghcq` has
   * none: it is not one of the three paid review bots the ledger attributes to,
   * and minting one here would silently change `resolveActorId`.
   */
  actorId?: string;
  /**
   * The EXACT lowercase logins that resolve to `actorId`. EXACT, not a prefix:
   * a future variant like `greptile-enterprise[bot]` must not be silently
   * collapsed into `greptile` and mixed into its hit-rate.
   */
  actorLogins: readonly string[];
}

/**
 * The review bots, in triage's detection order (first match wins, so a login
 * that could satisfy two patterns resolves the same way it did before this
 * array existed).
 */
export const BOT_REVIEWER_IDENTITIES: readonly BotReviewerIdentity[] = Object.freeze([
  {
    tool: 'coderabbit',
    loginPattern: /coderabbit/i,
    loginExact: /^coderabbitai(?:\[bot\])?$/i,
    actorId: 'coderabbit',
    actorLogins: ['coderabbitai[bot]'],
  },
  {
    tool: 'gca',
    loginPattern: /gemini-code-assist/i,
    loginExact: /^gemini-code-assist(?:\[bot\])?$/i,
    // The Layer-B actor id deliberately diverges from triage's compact `gca`:
    // the ledger keys hit-rate on the full name.
    actorId: 'gemini-code-assist',
    actorLogins: ['gemini-code-assist[bot]'],
  },
  {
    tool: 'greptile',
    // The reviewer's suggested trailing `\b` fails right after the closing `]`
    // (a non-word char at end-of-string), so it is deliberately absent.
    loginPattern: /\bgreptile(?:-[^[]+)?\[bot\]/i,
    loginExact: /^greptile(?:-[a-z0-9._-]+)?(?:\[bot\])?$/i,
    actorId: 'greptile',
    // Observed 2026-09-07 on mmnto-ai/totem#2821, #2827, #2831 and #2834.
    actorLogins: ['greptile-apps[bot]'],
  },
  {
    // GitHub's own `github-code-quality[bot]` (mmnto-ai/totem#2626): an
    // inline-comment-only surface with no @-listener. Recognized by triage,
    // deliberately WITHOUT an actorId (see `actorId` above).
    tool: 'ghcq',
    loginPattern: /\bgithub-code-quality(?:-[^[]+)?\[bot\]/i,
    loginExact: /^github-code-quality(?:-[a-z0-9._-]+)?(?:\[bot\])?$/i,
    actorLogins: [],
  },
]);

/** Is this REST-shaped author login one of the known review bots? */
export function isBotReviewerLogin(author: string): boolean {
  return BOT_REVIEWER_IDENTITIES.some((id) => id.loginPattern.test(author));
}

/** Triage's tool id for a REST-shaped author login, or null when it is not a known bot. */
export function detectBotReviewer(author: string): BotReviewerTool | null {
  return BOT_REVIEWER_IDENTITIES.find((id) => id.loginPattern.test(author))?.tool ?? null;
}

/**
 * Is this a known review bot on a surface that spells the login WHOLE — the
 * GraphQL `author.login`, where the `[bot]` suffix is absent? Anchored, so a
 * human account that merely contains a bot's name is not a bot.
 */
export function isBotReviewerLoginExact(author: string): boolean {
  const trimmed = author.trim();
  if (trimmed.length === 0) return false;
  return BOT_REVIEWER_IDENTITIES.some((id) => id.loginExact.test(trimmed));
}

/**
 * The exact-login → Layer-B actor-id map, built from the identities that carry
 * an `actorId`. Keys are lowercase EXACT logins (see `actorLogins`).
 */
export function botReviewerActorIds(): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const id of BOT_REVIEWER_IDENTITIES) {
    if (id.actorId === undefined) continue;
    for (const login of id.actorLogins) {
      map[login.toLowerCase()] = id.actorId;
    }
  }
  return map;
}

/**
 * The ONE definition of the review-bot identities the cohort reads
 * (mmnto-ai/totem#2800, errata item 1).
 *
 * Before this module the same three logins were declared twice — a loose
 * substring/shape match in `packages/cli/src/parsers/bot-review-parser.ts` and
 * an exact-login actor map in `packages/core/src/capability/review-catch.ts` —
 * so a login that drifted (or a fourth bot) had to be found in two places and
 * a stale copy read as "no bot here", the silent direction. Every consumer now
 * imports this module — those two, `packages/core/src/merge-ready.ts` (the
 * gate's predicate reads) and `packages/cli/src/commands/resolve-threads.ts`
 * (the human-reply test, which takes the App-suffix rule below) — and
 * `bot-identity-parity.test.ts` scans all four: a list, a pattern or an
 * escaped `\[bot\]` suffix declared in any of them fails the build.
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
 *   - `exactLogins` — the CLOSED list of logins actually OBSERVED, each in
 *     both spellings (with and without `[bot]`). It is a membership test, not a
 *     pattern: a wildcard variant arm (`greptile-<anything>`) admitted human
 *     accounts like `greptile-fan`, which would let a human comment gate a
 *     merge (mmnto-ai/totem#2800 fold F5). A new bot variant is added HERE, by
 *     observation, the same way the first ones were.
 * A gate that reads GraphQL (merge-ready) uses `exactLogins`; triage keeps
 * `loginPattern`.
 *
 * The GREPTILE login is fixed BY OBSERVATION, not by either stale copy: the
 * runs above show `greptile-apps[bot]` on every totem PR greptile reviewed in
 * the 2026-09 window (#2821, #2827, #2831, #2834). The loose `loginPattern`
 * keeps its variant arm (a renamed app is still SURFACED to triage, and the
 * required `[bot]` suffix keeps a human out); the anchored `exactLogins` list
 * carries only what has been observed, so nothing a human could register
 * satisfies the gate's read.
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
   * The closed list of logins observed for this reviewer, lowercase, in BOTH
   * spellings: the REST one (`name[bot]`) and the GraphQL one (no suffix).
   * Membership, never a pattern — see the module header.
   */
  exactLogins: readonly string[];
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
    exactLogins: ['coderabbitai', 'coderabbitai[bot]'],
    actorId: 'coderabbit',
    actorLogins: ['coderabbitai[bot]'],
  },
  {
    tool: 'gca',
    loginPattern: /gemini-code-assist/i,
    exactLogins: ['gemini-code-assist', 'gemini-code-assist[bot]'],
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
    exactLogins: ['greptile-apps', 'greptile-apps[bot]'],
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
    exactLogins: ['github-code-quality', 'github-code-quality[bot]'],
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
 * GraphQL `author.login`, where the `[bot]` suffix is absent? A CLOSED-list
 * membership test: a login not on the observed list is not a bot, so no human
 * account can satisfy it (mmnto-ai/totem#2800 fold F5).
 */
export function isBotReviewerLoginExact(author: string): boolean {
  const trimmed = author.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  return BOT_REVIEWER_IDENTITIES.some((id) => id.exactLogins.includes(trimmed));
}

/**
 * The GitHub App login suffix, `name[bot]` — how REST spells every App's login
 * (and how a GraphQL `author.login` never does; see the header). It is a third
 * bot test beside the two list tests above: `resolve-threads` needs it so a
 * `github-actions[bot]` or Copilot reply is never read as the human answer that
 * resolves a thread. It lives HERE so the suffix has one home the parity
 * sensor can hold every consumer to — that sensor's literal scan never saw the
 * escaped spelling a regex source carries (`\[bot\]`), which is how the verb's
 * own copy lived unscanned; the fold that moved it also gave the sensor that
 * arm (mmnto-ai/totem#2841, the deferred fold; the pilot-install leg's F1).
 */
const BOT_APP_LOGIN_SUFFIX = /\[bot\]$/i;

/** Does this login carry the GitHub App suffix (`name[bot]`), on whichever surface spelled it? */
export function hasBotAppLoginSuffix(login: string): boolean {
  return BOT_APP_LOGIN_SUFFIX.test(login);
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

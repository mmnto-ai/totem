/**
 * The identity module's own predicates, asserted where they live (the parity
 * sensor in the CLI package scans the CONSUMERS; this file pins the PRODUCER).
 * `hasBotAppLoginSuffix` entered with the mmnto-ai/totem#2841 fold and had no
 * direct assertion in this package until the pilot-install leg named the gap.
 */
import { describe, expect, it } from 'vitest';

import {
  BOT_REVIEWER_IDENTITIES,
  hasBotAppLoginSuffix,
  isBotReviewerLogin,
  isBotReviewerLoginExact,
} from './bot-identity.js';

describe('hasBotAppLoginSuffix — the GitHub App login suffix', () => {
  it('reads the REST spelling of any App login, review bot or not', () => {
    expect(hasBotAppLoginSuffix('github-actions[bot]')).toBe(true);
    expect(hasBotAppLoginSuffix('copilot-pull-request-reviewer[bot]')).toBe(true);
    expect(hasBotAppLoginSuffix('coderabbitai[bot]')).toBe(true);
  });

  it('is case-insensitive on the suffix, as GitHub renders it', () => {
    expect(hasBotAppLoginSuffix('CodeRabbitAI[Bot]')).toBe(true);
    expect(hasBotAppLoginSuffix('GREPTILE-APPS[BOT]')).toBe(true);
  });

  it("never reads the GraphQL spelling (no suffix) as an App — that is the exact list's job", () => {
    expect(hasBotAppLoginSuffix('greptile-apps')).toBe(false);
    expect(hasBotAppLoginSuffix('gemini-code-assist')).toBe(false);
    expect(hasBotAppLoginSuffix('')).toBe(false);
  });

  it('requires the suffix to END the login — a human login that merely contains it is not an App', () => {
    expect(hasBotAppLoginSuffix('alice[bot]fan')).toBe(false);
    expect(hasBotAppLoginSuffix('[bot]')).toBe(true);
  });

  it('agrees with the two list tests on every observed identity', () => {
    for (const id of BOT_REVIEWER_IDENTITIES) {
      for (const login of id.exactLogins) {
        // Every observed spelling is on the exact list by construction.
        expect(isBotReviewerLoginExact(login)).toBe(true);
        // The suffix test is exactly "ends with [bot]", whichever spelling the list carries…
        expect(hasBotAppLoginSuffix(login)).toBe(login.toLowerCase().endsWith('[bot]'));
        // …and every suffixed observed spelling also satisfies the loose REST pattern.
        if (hasBotAppLoginSuffix(login)) expect(isBotReviewerLogin(login)).toBe(true);
      }
    }
  });
});

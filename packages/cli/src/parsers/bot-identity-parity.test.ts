/**
 * Parity sensor for the ONE bot-reviewer identity definition
 * (mmnto-ai/totem#2800): `@mmnto/totem`'s `bot-identity.ts`.
 *
 * This test FAILS if either consumer grows a list of its own —
 * `packages/cli/src/parsers/bot-review-parser.ts` (triage's loose recognition)
 * or `packages/core/src/capability/review-catch.ts` (the Layer-B actor-id map).
 * A second copy is exactly the failure the module removes: the two lists drift,
 * the stale one reads a real bot as "not a bot", and a finding disappears
 * silently.
 *
 * It lives in the CLI package because that is the layer that can read BOTH
 * sources (cli depends on core, never the reverse).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BOT_REVIEWER_IDENTITIES, isBotReviewerLoginExact, resolveActorId } from '@mmnto/totem';

import { detectBot, isBotComment } from './bot-review-parser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PARSER_SRC = path.join(HERE, 'bot-review-parser.ts');
const REVIEW_CATCH_SRC = path.resolve(HERE, '../../../core/src/capability/review-catch.ts');
const IDENTITY_SRC = path.resolve(HERE, '../../../core/src/bot-identity.ts');

/**
 * Strip line and block comments so the scan reads CODE only — every consumer is
 * free to NAME a bot in prose (and both do, explaining where the list went).
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The login spellings that only a re-declared list would need to name in code. */
const LOGIN_SPELLINGS = [
  'coderabbitai',
  'gemini-code-assist',
  'greptile-apps',
  'github-code-quality',
  '[bot]',
];

describe('bot identity — exactly one definition', () => {
  it('the single source declares the three review bots the charter names', () => {
    const tools = BOT_REVIEWER_IDENTITIES.map((i) => i.tool);
    expect(tools).toContain('coderabbit');
    expect(tools).toContain('gca');
    expect(tools).toContain('greptile');
    // No duplicate tool ids — a duplicate would make `detectBot` order-dependent.
    expect(new Set(tools).size).toBe(tools.length);
  });

  for (const [label, file] of [
    ['bot-review-parser.ts', PARSER_SRC],
    ['review-catch.ts', REVIEW_CATCH_SRC],
  ] as Array<[string, string]>) {
    it(`${label} declares NO bot-login list of its own`, () => {
      const code = codeOnly(fs.readFileSync(file, 'utf-8'));
      for (const spelling of LOGIN_SPELLINGS) {
        expect(
          code.includes(spelling),
          `${label} names the login spelling "${spelling}" in code — the identity list lives in bot-identity.ts`,
        ).toBe(false);
      }
      // No local regex over a bot name, and no local substring test either.
      expect(code).not.toMatch(
        /\/[^\n/]*(?:greptile|coderabbit|gemini|github-code-quality)[^\n]*\/[gimsuy]*/i,
      );
      expect(code).not.toMatch(
        /includes\(\s*['"](?:coderabbit|greptile|gemini|github-code-quality)/i,
      );
    });
  }

  it('both consumers import the identity module', () => {
    const parser = fs.readFileSync(PARSER_SRC, 'utf-8');
    expect(parser).toMatch(/import\s*{[^}]*detectBotReviewer[^}]*}\s*from\s*'@mmnto\/totem'/s);
    expect(parser).toMatch(/isBotReviewerLogin/);

    const reviewCatch = fs.readFileSync(REVIEW_CATCH_SRC, 'utf-8');
    expect(reviewCatch).toMatch(/from '\.\.\/bot-identity\.js'/);
    expect(reviewCatch).toMatch(/botReviewerActorIds\(\)/);
  });

  it('the greptile login is recorded WITH its observation, not guessed', () => {
    const identity = fs.readFileSync(IDENTITY_SRC, 'utf-8');
    // The observed login string and the PRs it was read from (2026-09-07).
    expect(identity).toContain('greptile-apps[bot]');
    expect(identity).toMatch(/Observed 2026-09-07/);
    expect(identity).toMatch(/mmnto-ai\/totem#2834/);
  });
});

describe('bot identity — behaviour the consumers had before the move', () => {
  it('isBotComment / detectBot classify the REST-shaped logins unchanged', () => {
    expect(isBotComment('coderabbitai[bot]')).toBe(true);
    expect(isBotComment('gemini-code-assist[bot]')).toBe(true);
    expect(isBotComment('greptile-apps[bot]')).toBe(true);
    expect(isBotComment('github-code-quality[bot]')).toBe(true);
    // A human account that merely CONTAINS a bot name is not a bot — the
    // regression that hid human replies (CR Major on mmnto-ai/totem#2244).
    expect(isBotComment('alice-greptile')).toBe(false);
    expect(isBotComment('alice-github-code-quality')).toBe(false);
    expect(isBotComment('satur8d')).toBe(false);

    expect(detectBot('coderabbitai[bot]')).toBe('coderabbit');
    expect(detectBot('gemini-code-assist[bot]')).toBe('gca');
    expect(detectBot('greptile-apps[bot]')).toBe('greptile');
    expect(detectBot('github-code-quality[bot]')).toBe('ghcq');
    expect(detectBot('satur8d')).toBe('unknown');
  });

  it('resolveActorId keeps EXACT-login attribution, ghcq included (no new actor id)', () => {
    expect(resolveActorId('coderabbitai[bot]')).toBe('coderabbit');
    expect(resolveActorId('gemini-code-assist[bot]')).toBe('gemini-code-assist');
    expect(resolveActorId('greptile-apps[bot]')).toBe('greptile');
    // Not one of the three paid bots the ledger attributes to: it stays itself.
    expect(resolveActorId('github-code-quality[bot]')).toBe('github-code-quality[bot]');
    // A variant is NOT collapsed into the parent's hit-rate.
    expect(resolveActorId('greptile-enterprise[bot]')).toBe('greptile-enterprise[bot]');
    expect(resolveActorId('totem-claude')).toBe('totem-claude');
  });

  it('the GraphQL spelling (no [bot] suffix) is a bot on the anchored read only', () => {
    expect(isBotReviewerLoginExact('gemini-code-assist')).toBe(true);
    expect(isBotReviewerLoginExact('greptile-apps')).toBe(true);
    expect(isBotReviewerLoginExact('coderabbitai')).toBe(true);
    expect(isBotReviewerLoginExact('alice-greptile')).toBe(false);
    expect(isBotReviewerLoginExact('satur8d')).toBe(false);
    expect(isBotReviewerLoginExact('')).toBe(false);
  });
});

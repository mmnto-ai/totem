/**
 * Parity sensor for the ONE bot-reviewer identity definition
 * (mmnto-ai/totem#2800): `@mmnto/totem`'s `bot-identity.ts`.
 *
 * This test FAILS if any consumer grows a list of its own —
 * `packages/cli/src/parsers/bot-review-parser.ts` (triage's loose recognition),
 * `packages/core/src/capability/review-catch.ts` (the Layer-B actor-id map),
 * `packages/core/src/merge-ready.ts` (the gate's predicate reads) or
 * `packages/cli/src/commands/resolve-threads.ts` (the human-reply test) — four
 * consumers; the last two joined the scan with the mmnto-ai/totem#2841 fold,
 * which also moved the App-suffix rule into the identity module and gave this
 * sensor the arm that reads an ESCAPED suffix (`\[bot\]` in a regex or string
 * source — the spelling the literal scan never saw). A second copy is exactly
 * the failure the module removes: the lists drift, the stale one reads a real
 * bot as "not a bot", and a finding disappears silently.
 *
 * It lives in the CLI package because that is the layer that can read every
 * source (cli depends on core, never the reverse).
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
const RESOLVE_THREADS_SRC = path.resolve(HERE, '../commands/resolve-threads.ts');
const MERGE_READY_SRC = path.resolve(HERE, '../../../core/src/merge-ready.ts');
const IDENTITY_SRC = path.resolve(HERE, '../../../core/src/bot-identity.ts');

/**
 * Strip line and block comments so the scan reads CODE only — every consumer is
 * free to NAME a bot in prose (and both do, explaining where the list went).
 */
function codeOnly(source: string): string {
  // Lowercased: the regex arms below are case-insensitive, so a case-SENSITIVE
  // literal scan beside them let a display-cased re-declaration
  // (`new Set(['CodeRabbitAI[bot]'])`) through — the sensor's own asymmetry
  // (mmnto-ai/totem#2800 round 2, F9).
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .toLowerCase();
}

/** The login spellings that only a re-declared list would need to name in code. */
const LOGIN_SPELLINGS = [
  'coderabbitai',
  'gemini-code-assist',
  'greptile-apps',
  'github-code-quality',
  '[bot]',
];

/** A local regex over a bot name — the first re-declaration shape. */
const LOCAL_BOT_REGEX =
  /\/[^\n/]*(?:greptile|coderabbit|gemini|github-code-quality)[^\n]*\/[gimsuy]*/i;

/**
 * A local SUBSTRING test over a bot name — the second shape. `includes` was the
 * only member until fold F8: `indexOf`, `startsWith` and a bare comparison
 * against a concatenated name are the same re-declaration wearing another
 * method, and the sensor missed all three (mmnto-ai/totem#2800).
 */
const LOCAL_BOT_SUBSTRING =
  /(?:includes|indexOf|startsWith|endsWith|search|match)\(\s*['"`](?:coderabbit|greptile|gemini|github-code-quality)/i;

/** A bot name assembled from pieces to dodge a literal scan — the third shape. */
const LOCAL_BOT_CONCAT =
  /['"`](?:coderabbit|greptile|gemini|github-code-quality)[^'"`\n]*['"`]\s*\+/i;

/**
 * The App suffix spelled ESCAPED — `\[bot\]` inside a regex literal or a
 * RegExp source string — the fourth shape, and the one the arms above never
 * caught: the literal scan looks for `[bot]`, while a regex source spells the
 * brackets escaped, so `const BOT_LOGIN_SUFFIX = /\[bot\]$/i;` passed this
 * sensor for as long as resolve-threads carried it (the pilot-install leg's
 * F1 on the mmnto-ai/totem#2841 fold). The suffix rule has one home,
 * `hasBotAppLoginSuffix` in bot-identity.ts.
 */
const LOCAL_BOT_SUFFIX = /\\+\[bot\\+\]/i; // one backslash in a regex literal, two in a RegExp source string

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
    ['merge-ready.ts', MERGE_READY_SRC],
    ['resolve-threads.ts', RESOLVE_THREADS_SRC],
  ] as Array<[string, string]>) {
    it(`${label} declares NO bot-login list of its own`, () => {
      const code = codeOnly(fs.readFileSync(file, 'utf-8'));
      for (const spelling of LOGIN_SPELLINGS) {
        expect(
          code.includes(spelling),
          `${label} names the login spelling "${spelling}" in code — the identity list lives in bot-identity.ts`,
        ).toBe(false);
      }
      // No local regex over a bot name, no local substring test in ANY of the
      // methods that spell one, no name assembled by concatenation, and no
      // escaped App suffix of its own.
      expect(code).not.toMatch(LOCAL_BOT_REGEX);
      expect(code).not.toMatch(LOCAL_BOT_SUBSTRING);
      expect(code).not.toMatch(LOCAL_BOT_CONCAT);
      expect(code).not.toMatch(LOCAL_BOT_SUFFIX);
    });
  }

  it('the sensor catches every re-declaration shape it claims to (mutant rows)', () => {
    // The sensor is only worth its line if it FAILS on a re-declaration. Each
    // mutant below is a plausible way a consumer could grow its own list back;
    // a sensor that misses one would pass this file while the drift is real.
    const mutants: Array<[string, string]> = [
      ['a local regex', 'const GREPTILE = /\\bgreptile(?:-[^[]+)?\\[bot\\]/i;'],
      ['includes()', "if (lower.includes('coderabbit')) return 'coderabbit';"],
      ['indexOf()', "if (lower.indexOf('greptile') !== -1) return 'greptile';"],
      ['startsWith()', "if (lower.startsWith('gemini-code-assist')) return 'gca';"],
      ['concatenation', "const login = 'greptile' + '-apps' + '[bot]';"],
      // Display-cased, `[Bot]` INCLUDED: the earlier version of this row spelled
      // `[bot]` in lowercase, so the pre-fold sensor already caught it on that
      // spelling alone and the row proved nothing (round 3, F3). Every letter a
      // consumer could case differently is cased here.
      ['a display-cased Set', "const BOTS = new Set(['CodeRabbitAI[Bot]', 'GREPTILE-APPS[BOT]']);"],
      // The escaped-suffix spellings — a regex literal and a RegExp source
      // string. The verbatim line resolve-threads carried until the
      // mmnto-ai/totem#2841 fold; the pre-fold sensor passed it.
      ['an escaped-suffix regex', 'const BOT_LOGIN_SUFFIX = /\\[bot\\]$/i;'],
      ['an escaped-suffix RegExp string', "const SUFFIX = new RegExp('\\\\[bot\\\\]$', 'i');"],
    ];
    for (const [label, mutant] of mutants) {
      const scanned = codeOnly(mutant);
      const caught =
        LOCAL_BOT_REGEX.test(scanned) ||
        LOCAL_BOT_SUBSTRING.test(scanned) ||
        LOCAL_BOT_CONCAT.test(scanned) ||
        LOCAL_BOT_SUFFIX.test(scanned) ||
        LOGIN_SPELLINGS.some((s) => scanned.includes(s));
      expect(caught, `the parity sensor missed the ${label} re-declaration`).toBe(true);
    }
  });

  it('the escaped-suffix arm is what catches the escaped spellings (the literal scan alone does not)', () => {
    // Pins the arm's reason to exist: without it, the two escaped mutants pass
    // every other arm — which is how the removed declaration lived unscanned.
    for (const mutant of [
      'const BOT_LOGIN_SUFFIX = /\\[bot\\]$/i;',
      "const SUFFIX = new RegExp('\\\\[bot\\\\]$', 'i');",
    ]) {
      const scanned = codeOnly(mutant);
      expect(LOGIN_SPELLINGS.some((s) => scanned.includes(s))).toBe(false);
      expect(scanned).not.toMatch(LOCAL_BOT_REGEX);
      expect(scanned).toMatch(LOCAL_BOT_SUFFIX);
    }
  });

  it('every consumer imports the identity module', () => {
    const parser = fs.readFileSync(PARSER_SRC, 'utf-8');
    expect(parser).toMatch(/import\s*{[^}]*detectBotReviewer[^}]*}\s*from\s*'@mmnto\/totem'/s);
    expect(parser).toMatch(/isBotReviewerLogin/);

    const reviewCatch = fs.readFileSync(REVIEW_CATCH_SRC, 'utf-8');
    expect(reviewCatch).toMatch(/from '\.\.\/bot-identity\.js'/);
    expect(reviewCatch).toMatch(/botReviewerActorIds\(\)/);

    // The gate reads the exact list straight from the module.
    const mergeReady = fs.readFileSync(MERGE_READY_SRC, 'utf-8');
    expect(mergeReady).toMatch(/import\s*{[^}]*isBotReviewerLoginExact[^}]*}\s*from\s*'\.\/bot-identity\.js'/s);

    // The fourth consumer loads the barrel lazily inside the command
    // (mmnto-ai/totem#2339) and injects all three predicates — the exact list,
    // the loose pattern and the App suffix — into its pure selector. Each
    // symbol is asserted on its own, so the destructure's order is free.
    const resolveThreads = fs.readFileSync(RESOLVE_THREADS_SRC, 'utf-8');
    // The file lazy-loads the barrel more than once (safeExec rides its own
    // import); the identity import is the one that carries all three symbols.
    const lazyImports = Array.from(
      resolveThreads.matchAll(/const\s*{([^}]*)}\s*=\s*await import\('@mmnto\/totem'\)/gs),
      (m) => m[1]!,
    );
    const symbols = ['hasBotAppLoginSuffix', 'isBotReviewerLogin', 'isBotReviewerLoginExact'];
    expect(
      lazyImports.some((names) => symbols.every((s) => names.includes(s))),
      `one lazy import of @mmnto/totem carries ${symbols.join(', ')}; saw ${JSON.stringify(lazyImports)}`,
    ).toBe(true);
    expect(resolveThreads).toMatch(/hasAppSuffix:\s*hasBotAppLoginSuffix/);
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

  it('the GraphQL spelling (no [bot] suffix) is a bot on the exact-login read only', () => {
    expect(isBotReviewerLoginExact('gemini-code-assist')).toBe(true);
    expect(isBotReviewerLoginExact('greptile-apps')).toBe(true);
    expect(isBotReviewerLoginExact('greptile-apps[bot]')).toBe(true);
    expect(isBotReviewerLoginExact('coderabbitai')).toBe(true);
    expect(isBotReviewerLoginExact('alice-greptile')).toBe(false);
    expect(isBotReviewerLoginExact('satur8d')).toBe(false);
    expect(isBotReviewerLoginExact('')).toBe(false);
  });

  it('a HUMAN login that merely shares a bot prefix is not a bot (fold F5)', () => {
    // The pre-fold wildcard arm (`greptile-<anything>`) admitted every one of
    // these, which would let a human comment gate a merge.
    for (const human of [
      'greptile-fan',
      'greptile-fan[bot]',
      'greptile',
      'github-code-quality-fan',
      'coderabbitai-mirror',
      'gemini-code-assist-community',
    ]) {
      expect(isBotReviewerLoginExact(human), `${human} must not read as a bot`).toBe(false);
    }
  });
});

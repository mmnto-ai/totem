import { describe, expect, it } from 'vitest';

import type { CodePathClassifier, PrMeta, SelectionRuleConfig } from './selection-rule.js';
import {
  diffPrSets,
  isBotIdentity,
  isCodeTouching,
  parsePrNumber,
  parseRevertSha,
  prSetsEqual,
  resolveSelectionRule,
  SelectionRuleParseError,
  selectionRulePredicate,
} from './selection-rule.js';

// ─── Helpers ─────────────────────────────────────────

const CLASSIFIER: CodePathClassifier = {
  includeGlobs: ['packages/**/*.ts', 'src/**', '**/*.rs'],
  excludeGlobs: ['**/*.md', 'docs/**', '**/*.json'],
};

function cfg(overrides?: Partial<SelectionRuleConfig>): SelectionRuleConfig {
  return {
    codePathClassifier: CLASSIFIER,
    excludeRevertPairs: true,
    excludeBotPrs: true,
    window: { type: 'all' },
    ...overrides,
  };
}

function meta(pr: number, overrides?: Partial<PrMeta>): PrMeta {
  const author = overrides?.author ?? 'Jane Doe <jane@example.com>';
  return {
    pr,
    mergeCommit: overrides?.mergeCommit ?? `${pr}`.padStart(40, '0'),
    author,
    isBotAuthor: overrides?.isBotAuthor ?? isBotIdentity(author),
    revertsSha: overrides?.revertsSha,
    changedFiles: overrides?.changedFiles ?? ['packages/core/src/x.ts'],
  };
}

// ─── isCodeTouching / glob precedence ────────────────

describe('isCodeTouching — exclude wins at the file level', () => {
  it('includes a PR touching any code file', () => {
    expect(isCodeTouching(['packages/core/src/x.ts'], CLASSIFIER)).toBe(true);
    expect(isCodeTouching(['src/engine/run.ts'], CLASSIFIER)).toBe(true);
    expect(isCodeTouching(['crates/foo/lib.rs'], CLASSIFIER)).toBe(true);
  });

  it('excludes a docs/config-only PR (no file survives the classifier)', () => {
    expect(isCodeTouching(['packages/core/README.md'], CLASSIFIER)).toBe(false);
    expect(isCodeTouching(['docs/guide/intro.md'], CLASSIFIER)).toBe(false);
    expect(isCodeTouching(['package.json'], CLASSIFIER)).toBe(false);
  });

  it('includes a MIXED PR (code + doc) — file-level exclude does not exclude the PR', () => {
    expect(
      isCodeTouching(['packages/core/README.md', 'packages/core/src/index.ts'], CLASSIFIER),
    ).toBe(true);
  });

  it('exclude wins over include at the file level (a .json under packages is not code)', () => {
    // packages/core/tsconfig.json matches includeGlob packages/**/*.ts? no (.json). matches **/*.json exclude.
    expect(isCodeTouching(['packages/core/data.json'], CLASSIFIER)).toBe(false);
  });

  it('normalizes backslash paths before matching', () => {
    expect(isCodeTouching(['packages\\core\\src\\x.ts'], CLASSIFIER)).toBe(true);
  });

  it('**/*.md matches a root-level file (the **​/ zero-segment case)', () => {
    expect(isCodeTouching(['README.md'], { includeGlobs: ['**/*.md'], excludeGlobs: [] })).toBe(
      true,
    );
  });
});

// ─── isBotIdentity ───────────────────────────────────

describe('isBotIdentity — [bot] suffix only', () => {
  it('matches GitHub bot accounts in git %an <%ae> form (case-insensitive)', () => {
    expect(isBotIdentity('dependabot[bot]')).toBe(true); // name-only
    // The real git author string — display name + noreply email. The whole
    // string ends with ">", so a naive .endsWith('[bot]') would miss it.
    expect(
      isBotIdentity('dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>'),
    ).toBe(true);
    expect(isBotIdentity('Renovate[bot] <bot@renovate.com>')).toBe(true);
    expect(isBotIdentity('renovate[BOT]')).toBe(true);
  });

  it('does NOT match a human handle merely containing "bot"', () => {
    expect(isBotIdentity('revertbot')).toBe(false);
    expect(isBotIdentity('Robotnik')).toBe(false);
    expect(isBotIdentity('Jane Doe')).toBe(false);
    expect(isBotIdentity('Jane Doe <jane@example.com>')).toBe(false);
  });

  it('tolerates trailing CR/whitespace', () => {
    expect(isBotIdentity('dependabot[bot]\r')).toBe(true);
    expect(isBotIdentity('  dependabot[bot]  ')).toBe(true);
  });
});

// ─── parseRevertSha ──────────────────────────────────

describe('parseRevertSha', () => {
  it('extracts the target sha from a revert body', () => {
    expect(parseRevertSha('This reverts commit abcdef1234567890abcdef1234567890abcdef12.')).toBe(
      'abcdef1234567890abcdef1234567890abcdef12',
    );
  });

  it('returns undefined when there is no revert line', () => {
    expect(parseRevertSha('feat: a normal commit body')).toBeUndefined();
  });

  it('tolerates CRLF bodies', () => {
    expect(parseRevertSha('This reverts commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\r\n')).toBe(
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
  });
});

// ─── parsePrNumber — trailing (#N), skip-no-ref, malformed ───

describe('parsePrNumber', () => {
  it('extracts the TRAILING (#N), not an earlier issue ref', () => {
    expect(parsePrNumber('on-foot interior breach spec (#533) (#534)')).toBe(534);
    expect(parsePrNumber('first-drive feedback (closes #522) (#524)')).toBe(524);
    expect(parsePrNumber('feat: simple change (#12)')).toBe(12);
  });

  it('returns null for a direct-to-main commit with no (#N) (a non-PR, skip)', () => {
    expect(parsePrNumber('chore(deps): bump @mmnto/* to 1.66.0')).toBeNull();
    expect(parsePrNumber('hotfix straight to main')).toBeNull();
  });

  it('throws on a malformed trailing ref (never silent)', () => {
    expect(() => parsePrNumber('bad ref (#abc)')).toThrow(SelectionRuleParseError);
    expect(() => parsePrNumber('empty ref (#)')).toThrow(SelectionRuleParseError);
    expect(() => parsePrNumber('zero ref (#0)')).toThrow(SelectionRuleParseError);
    expect(() => parsePrNumber('negative ref (#-1)')).toThrow(SelectionRuleParseError);
  });

  it('tolerates a trailing CR', () => {
    expect(parsePrNumber('feat: change (#42)\r')).toBe(42);
  });
});

// ─── selectionRulePredicate (per-PR) ─────────────────

describe('selectionRulePredicate', () => {
  it('passes a code-touching, human, non-revert PR', () => {
    expect(selectionRulePredicate(meta(1), cfg())).toBe(true);
  });

  it('excludes a non-code-touching PR', () => {
    expect(selectionRulePredicate(meta(1, { changedFiles: ['README.md'] }), cfg())).toBe(false);
  });

  it('excludes a bot PR when excludeBotPrs is on; keeps it when off', () => {
    const botPr = meta(1, { author: 'dependabot[bot]' });
    expect(selectionRulePredicate(botPr, cfg({ excludeBotPrs: true }))).toBe(false);
    expect(selectionRulePredicate(botPr, cfg({ excludeBotPrs: false }))).toBe(true);
  });

  it('excludes a revert PR itself when excludeRevertPairs is on; keeps it when off', () => {
    const revertPr = meta(1, { revertsSha: 'a'.repeat(40) });
    expect(selectionRulePredicate(revertPr, cfg({ excludeRevertPairs: true }))).toBe(false);
    expect(selectionRulePredicate(revertPr, cfg({ excludeRevertPairs: false }))).toBe(true);
  });
});

// ─── resolveSelectionRule — two-pass revert + fail-safe ───

describe('resolveSelectionRule', () => {
  it('returns sorted unique PR numbers', () => {
    expect(resolveSelectionRule([meta(13), meta(11), meta(12), meta(11)], cfg())).toEqual([
      11, 12, 13,
    ]);
  });

  it('drops BOTH the revert PR and its in-window target (two-pass)', () => {
    const target = meta(20, { mergeCommit: 'f'.repeat(40) });
    const revert = meta(21, { revertsSha: 'f'.repeat(40) });
    const other = meta(22);
    expect(
      resolveSelectionRule([target, revert, other], cfg({ excludeRevertPairs: true })),
    ).toEqual([22]);
  });

  it('fail-safe: a reverted target outside the window drops nothing but the revert itself', () => {
    // The revert points at a sha that is not any in-window candidate's mergeCommit.
    const revert = meta(21, { revertsSha: 'deadbeef'.padEnd(40, '0') });
    const other = meta(22);
    expect(resolveSelectionRule([revert, other], cfg({ excludeRevertPairs: true }))).toEqual([22]);
  });

  it('keeps both revert and target when excludeRevertPairs is false', () => {
    const target = meta(20, { mergeCommit: 'f'.repeat(40) });
    const revert = meta(21, { revertsSha: 'f'.repeat(40) });
    expect(resolveSelectionRule([target, revert], cfg({ excludeRevertPairs: false }))).toEqual([
      20, 21,
    ]);
  });

  it('excludes bot PRs and non-code PRs from the set', () => {
    const human = meta(1);
    const bot = meta(2, { author: 'renovate[bot]' });
    const docOnly = meta(3, { changedFiles: ['docs/x.md'] });
    expect(resolveSelectionRule([human, bot, docOnly], cfg())).toEqual([1]);
  });

  it('matches an abbreviated revert sha against the full target mergeCommit (prefix)', () => {
    const target = meta(20, { mergeCommit: 'abc123def456'.padEnd(40, '0') });
    const revert = meta(21, { revertsSha: 'abc123d' });
    expect(resolveSelectionRule([target, revert], cfg())).toEqual([]);
  });

  it('bounded window keeps the N MOST-RECENT qualifying PRs (input is newest-first)', () => {
    // metas in git-log order (newest first): 50, 49, 48, 47.
    const metas = [meta(50), meta(49), meta(48), meta(47)];
    expect(resolveSelectionRule(metas, cfg({ window: { type: 'bounded', n: 2 } }))).toEqual([
      49, 50,
    ]);
    // 'all' keeps everything.
    expect(resolveSelectionRule(metas, cfg({ window: { type: 'all' } }))).toEqual([47, 48, 49, 50]);
  });

  it('bounded window counts only QUALIFYING PRs toward N (skips non-code before the slice)', () => {
    // newest-first: 50 (doc), 49 (code), 48 (code) → N=2 → [48, 49], not [49, 50].
    const metas = [meta(50, { changedFiles: ['README.md'] }), meta(49), meta(48)];
    expect(resolveSelectionRule(metas, cfg({ window: { type: 'bounded', n: 2 } }))).toEqual([
      48, 49,
    ]);
  });
});

// ─── diffPrSets / prSetsEqual ────────────────────────

describe('deep set-equality (§6)', () => {
  it('is order- and duplicate-invariant', () => {
    expect(prSetsEqual([12, 13], [13, 12])).toBe(true);
    expect(prSetsEqual([12, 13, 13], [13, 12])).toBe(true);
  });

  it('reports missing (in git, not manifest) and extra (in manifest, not git) separately', () => {
    const d = diffPrSets([534, 535, 536], [536, 611]);
    expect(d.missing).toEqual([534, 535]);
    expect(d.extra).toEqual([611]);
    expect(prSetsEqual([534, 535, 536], [536, 611])).toBe(false);
  });

  it('equal sets yield empty diff', () => {
    expect(diffPrSets([1, 2, 3], [3, 2, 1])).toEqual({ missing: [], extra: [] });
  });
});

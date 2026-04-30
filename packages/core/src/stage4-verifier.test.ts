import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler-schema.js';
import {
  DEFAULT_BASELINE_GLOBS,
  getDefaultBaseline,
  parseStage4BaselineDirectives,
  resolveStage4Baseline,
  STAGE4_MANIFEST_EXCLUSIONS,
  type Stage4Baseline,
  type Stage4VerifierDeps,
  verifyAgainstCodebase,
} from './stage4-verifier.js';
import { cleanTmpDir } from './test-utils.js';

// ─── Helpers ────────────────────────────────────────

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'h1',
    lessonHeading: 'No console log',
    pattern: 'console\\.log',
    message: 'no console.log',
    engine: 'regex' as const,
    compiledAt: new Date().toISOString(),
    badExample: "console.log('debug')",
    goodExample: '// noop',
    fileGlobs: ['packages/cli/src/**/*.ts'],
    ...overrides,
  };
}

function makeDeps(files: Map<string, string>): Stage4VerifierDeps {
  return {
    listFiles: async () => [...files.keys()],
    readFile: async (file: string) => {
      const content = files.get(file);
      if (content === undefined) {
        throw new Error(`stub readFile: ${file} not in fixture map`);
      }
      return content;
    },
  };
}

// ─── getDefaultBaseline ────────────────────────────

describe('getDefaultBaseline', () => {
  it('returns the canonical test/fixture exclusion globs', () => {
    const baseline = getDefaultBaseline();
    expect(baseline.excludeFileGlobs).toEqual(DEFAULT_BASELINE_GLOBS);
    expect(baseline.excludeFileGlobs).toContain('**/*.test.*');
    expect(baseline.excludeFileGlobs).toContain('**/*.spec.*');
    expect(baseline.excludeFileGlobs).toContain('**/__tests__/**');
    expect(baseline.excludeFileGlobs).toContain('**/tests/**');
    expect(baseline.excludeFileGlobs).toContain('**/__fixtures__/**');
    expect(baseline.excludeFileGlobs).toContain('**/fixtures/**');
  });
});

// ─── parseStage4BaselineDirectives (mmnto-ai/totem#1683) ──

describe('parseStage4BaselineDirectives', () => {
  it('parses stage4-baseline comments with variable whitespace', () => {
    const content = [
      '#stage4-baseline:src/temp/**',
      '# stage4-baseline: e2e/**',
      '#  stage4-baseline:  build/**  ',
      '# regular comment',
      'tests/**',
      '',
    ].join('\n');
    expect(parseStage4BaselineDirectives(content)).toEqual(['src/temp/**', 'e2e/**', 'build/**']);
  });

  it('returns empty array when content has no stage4-baseline directives', () => {
    const content = '# Regular ignore file\nsrc/temp/**\n# stage4-other: foo';
    expect(parseStage4BaselineDirectives(content)).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(parseStage4BaselineDirectives('')).toEqual([]);
  });

  it('skips empty or whitespace-only directive bodies without throwing', () => {
    const content = [
      '# stage4-baseline:',
      '# stage4-baseline:    ',
      '# stage4-baseline: real/**',
    ].join('\n');
    expect(parseStage4BaselineDirectives(content)).toEqual(['real/**']);
  });

  it('is case-sensitive on the directive name', () => {
    const content = '# Stage4-Baseline: foo/**\n# STAGE4-BASELINE: bar/**';
    expect(parseStage4BaselineDirectives(content)).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const content = '# stage4-baseline: a/**\r\n# stage4-baseline: b/**\r\n';
    expect(parseStage4BaselineDirectives(content)).toEqual(['a/**', 'b/**']);
  });
});

// ─── resolveStage4Baseline (mmnto-ai/totem#1683) ──────

describe('resolveStage4Baseline', () => {
  it('returns DEFAULT_BASELINE_GLOBS when no overrides provided', () => {
    const baseline = resolveStage4Baseline({});
    expect(baseline.excludeFileGlobs).toEqual([...DEFAULT_BASELINE_GLOBS]);
    expect(baseline.extendedFromIgnoreFile).toEqual([]);
    expect(baseline.extendedFromConfig).toEqual([]);
    expect(baseline.excludedFromConfig).toEqual([]);
  });

  it('appends config.extend to default baseline', () => {
    const baseline = resolveStage4Baseline({
      configExtend: ['**/legacy/**', 'tools/scripts/**'],
    });
    expect(baseline.excludeFileGlobs).toContain('**/legacy/**');
    expect(baseline.excludeFileGlobs).toContain('tools/scripts/**');
    expect(baseline.extendedFromConfig).toEqual(['**/legacy/**', 'tools/scripts/**']);
    for (const def of DEFAULT_BASELINE_GLOBS) {
      expect(baseline.excludeFileGlobs).toContain(def);
    }
  });

  it('appends ignore-file directives to baseline', () => {
    const baseline = resolveStage4Baseline({
      ignoreDirectives: ['build/**', 'dist/**'],
    });
    expect(baseline.excludeFileGlobs).toContain('build/**');
    expect(baseline.excludeFileGlobs).toContain('dist/**');
    expect(baseline.extendedFromIgnoreFile).toEqual(['build/**', 'dist/**']);
  });

  it('removes config.exclude entries from default baseline', () => {
    const baseline = resolveStage4Baseline({
      configExclude: ['**/tests/**'],
    });
    expect(baseline.excludeFileGlobs).not.toContain('**/tests/**');
    expect(baseline.excludedFromConfig).toEqual(['**/tests/**']);
    expect(baseline.excludeFileGlobs).toContain('**/*.test.*');
  });

  it('exclude wins over extend (set-difference is last)', () => {
    const baseline = resolveStage4Baseline({
      configExtend: ['**/sandbox/**'],
      configExclude: ['**/sandbox/**'],
    });
    expect(baseline.excludeFileGlobs).not.toContain('**/sandbox/**');
  });

  it('composes ignore + config.extend ∖ config.exclude in the right order', () => {
    const baseline = resolveStage4Baseline({
      ignoreDirectives: ['build/**'],
      configExtend: ['**/legacy/**'],
      configExclude: ['**/fixtures/**'],
    });
    expect(baseline.excludeFileGlobs).toContain('build/**');
    expect(baseline.excludeFileGlobs).toContain('**/legacy/**');
    expect(baseline.excludeFileGlobs).not.toContain('**/fixtures/**');
    expect(baseline.excludeFileGlobs).toContain('**/*.test.*');
  });

  it('preserves debug provenance fields independently of excludeFileGlobs', () => {
    const baseline = resolveStage4Baseline({
      ignoreDirectives: ['ignored/**'],
      configExtend: ['extended/**'],
      configExclude: ['**/tests/**'],
    });
    expect(baseline.extendedFromIgnoreFile).toEqual(['ignored/**']);
    expect(baseline.extendedFromConfig).toEqual(['extended/**']);
    expect(baseline.excludedFromConfig).toEqual(['**/tests/**']);
  });

  it('produces an empty excludeFileGlobs when consumer excludes every default (mmnto-ai/totem#1683 R1 Sonnet catch)', () => {
    const baseline = resolveStage4Baseline({
      configExclude: [...DEFAULT_BASELINE_GLOBS],
    });
    expect(baseline.excludeFileGlobs).toEqual([]);
  });
});

// ─── classifyFile empty-baseline guard (R1 Sonnet) ──

describe('verifyAgainstCodebase with consumer excluding every default baseline glob', () => {
  it('keeps in-scope hits as in-scope when excludeFileGlobs is empty (no false-baseline classification)', async () => {
    // A consumer that `exclude`-s every default baseline glob produces an
    // empty `excludeFileGlobs`. Without the empty-array guard in
    // `classifyFile`, `fileMatchesGlobs(_, [])` returns `true` (default-
    // allow semantics) and every file is misclassified as baseline.
    const baseline = resolveStage4Baseline({
      configExclude: [...DEFAULT_BASELINE_GLOBS],
    });
    expect(baseline.excludeFileGlobs).toEqual([]);

    const files = new Map<string, string>([['packages/cli/src/server.ts', "console.log('hit')\n"]]);
    const result = await verifyAgainstCodebase(makeRule(), baseline, makeDeps(files));
    // Without the guard: outcome would have been 'no-matches' (all
    // violations partition to baseline + the out-of-scope short-circuit
    // returns no-matches when violations.length is non-zero but baseline
    // dominates — actually no, would return 'out-of-scope' with the file
    // as a baseline match). With the guard: the in-scope hit is preserved
    // and routes via badExample shape comparison.
    expect(result.outcome).not.toBe('out-of-scope');
    expect(result.baselineMatches).toEqual([]);
  });

  it('keeps in-scope hits when excludeFileGlobs has only !-prefixed entries (GCA mmnto-ai/totem#1766 R1)', async () => {
    // Negative-only baseline: positive set is empty, but the array is
    // non-empty. The original `length > 0` guard would have fired
    // `fileMatchesGlobs` which returns true for every file not matching
    // the negative — silently classifying everything as baseline.
    const baseline: Stage4Baseline = {
      excludeFileGlobs: ['!**/never-matches/**'],
      extendedFromIgnoreFile: [],
      extendedFromConfig: ['!**/never-matches/**'],
      excludedFromConfig: [...DEFAULT_BASELINE_GLOBS],
    };
    const files = new Map<string, string>([['packages/cli/src/server.ts', "console.log('hit')\n"]]);
    const result = await verifyAgainstCodebase(makeRule(), baseline, makeDeps(files));
    expect(result.outcome).not.toBe('out-of-scope');
    expect(result.baselineMatches).toEqual([]);
    expect(result.inScopeMatches).toContain('packages/cli/src/server.ts');
  });
});

// ─── STAGE4_MANIFEST_EXCLUSIONS (mmnto-ai/totem#1765) ─

describe('STAGE4_MANIFEST_EXCLUSIONS', () => {
  it('contains .totem/compiled-rules.json (the demonstrated self-match case)', () => {
    expect(STAGE4_MANIFEST_EXCLUSIONS).toContain('.totem/compiled-rules.json');
  });

  it('is exported as a readonly array', () => {
    expect(Array.isArray(STAGE4_MANIFEST_EXCLUSIONS)).toBe(true);
    expect(STAGE4_MANIFEST_EXCLUSIONS.length).toBeGreaterThan(0);
  });
});

// ─── verifyAgainstCodebase: four-outcome contract ─

describe('verifyAgainstCodebase outcome: no-matches', () => {
  it('returns no-matches when codebase walk is empty', async () => {
    const deps = makeDeps(new Map());
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), deps);
    expect(result.outcome).toBe('no-matches');
    expect(result.baselineMatches).toEqual([]);
    expect(result.inScopeMatches).toEqual([]);
  });

  it('returns no-matches when no file in the codebase matches the pattern', async () => {
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "const x = 1;\nconst y = 'hello';\n"],
      ['packages/cli/src/bar.ts', 'function noop() { return null; }\n'],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('no-matches');
  });
});

describe('verifyAgainstCodebase outcome: out-of-scope', () => {
  it('archives the rule when the pattern fires on a baseline test file', async () => {
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "console.log('debug');\n"],
      // Pattern fires on a test file — over-broad evidence even though
      // the production-side hit looks legitimate.
      ['packages/cli/src/foo.test.ts', "console.log('test stub');\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/cli/src/foo.test.ts']);
  });

  it('archives the rule when the pattern fires outside fileGlobs scope', async () => {
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "console.log('debug');\n"],
      // packages/core is OUTSIDE the rule's fileGlobs of packages/cli/src/**.
      // Any match here is out-of-scope evidence regardless of whether the
      // baseline globs apply.
      ['packages/core/src/bar.ts', "console.log('out of scope');\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/core/src/bar.ts']);
  });

  it('archives the rule when fired only on /__tests__/ directory shape', async () => {
    const files = new Map<string, string>([
      ['packages/cli/src/__tests__/spec.ts', "console.log('test setup');\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/cli/src/__tests__/spec.ts']);
  });

  it('out-of-scope wins precedence over in-scope outcomes', async () => {
    // Pattern fires on both an in-scope file AND a baseline file. Even
    // though the in-scope match is structurally equivalent to the
    // badExample, the baseline hit forces an archive — ADR-091 §Stage 4
    // is explicit on the ordering.
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "console.log('debug');\n"],
      ['packages/cli/src/foo.test.ts', "console.log('test');\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/cli/src/foo.test.ts']);
    expect(result.inScopeMatches).toEqual(['packages/cli/src/foo.ts']);
  });
});

describe('verifyAgainstCodebase outcome: in-scope-bad-example', () => {
  it('promotes the rule when only in-scope matches and they all match badExample', async () => {
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "console.log('debug')\n"],
      ['packages/cli/src/bar.ts', "  console.log('debug')\n"], // leading whitespace ok
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('in-scope-bad-example');
    expect(result.baselineMatches).toEqual([]);
    expect(result.inScopeMatches).toEqual(['packages/cli/src/bar.ts', 'packages/cli/src/foo.ts']);
    expect(result.candidateDebtLines).toEqual([]);
  });
});

describe('verifyAgainstCodebase outcome: candidate-debt', () => {
  it('flags candidate debt when in-scope matches differ from badExample shape', async () => {
    // Pattern fires on multiple in-scope files but only ONE matches the
    // exact badExample shape. The other one is a candidate-debt site —
    // the rule may be legit, may be a false positive; human review needed.
    const files = new Map<string, string>([
      ['packages/cli/src/foo.ts', "console.log('debug')\n"],
      ['packages/cli/src/bar.ts', 'console.log(`${process.env.DEBUG}`)\n'],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('candidate-debt');
    expect(result.baselineMatches).toEqual([]);
    expect(result.inScopeMatches).toEqual(['packages/cli/src/bar.ts', 'packages/cli/src/foo.ts']);
    expect(result.candidateDebtLines).toEqual(['console.log(`${process.env.DEBUG}`)']);
  });

  it('returns candidate-debt when no badExample is present (all hits are debt)', async () => {
    const ruleNoExample = makeRule({ badExample: undefined });
    const files = new Map<string, string>([['packages/cli/src/foo.ts', "console.log('debug')\n"]]);
    const result = await verifyAgainstCodebase(
      ruleNoExample,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('candidate-debt');
    expect(result.candidateDebtLines).toEqual(["console.log('debug')"]);
  });
});

// ─── #1526 regression class ────────────────────────

describe('verifyAgainstCodebase regression: #1526 class (over-broad new net.Socket pattern)', () => {
  it('structurally rejects an over-broad pattern that fires on every new net.Socket()', async () => {
    // The class of failure ADR-091 §"Stage 4" cites: a compile worker
    // emitted `new net\.Socket\(\)` on a lesson about "secure socket
    // initialization". The pattern fires on every legitimate net.Socket
    // construction in the consumer codebase. Stage 4 catches it before
    // the rule reaches active.
    const overBroadRule = makeRule({
      lessonHash: 'overbroad1',
      lessonHeading: 'Secure socket initialization',
      pattern: 'new net\\.Socket\\(\\)',
      message: 'Use the secure socket factory',
      badExample: 'const s = new net.Socket();',
      fileGlobs: ['packages/cli/src/**/*.ts'],
    });
    const files = new Map<string, string>([
      // In-scope hit — looks legitimate, would alone yield in-scope-bad-example
      // outcome.
      ['packages/cli/src/server.ts', 'const s = new net.Socket();\n'],
      // OUT-OF-SCOPE hit — proves the pattern is over-broad. This is the
      // signal Stage 4 surfaces that Layer 3 does not catch.
      ['packages/core/src/transport.ts', 'const s = new net.Socket();\n'],
    ]);
    const result = await verifyAgainstCodebase(
      overBroadRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/core/src/transport.ts']);
  });
});

// ─── Suppression interaction ───────────────────────

describe('verifyAgainstCodebase suppression handling', () => {
  it('treats suppressed lines as no-fire (consumer opt-out is not over-broad evidence)', async () => {
    // A line with `// totem-ignore` is an explicit consumer allow-list. Stage 4
    // should not flag it as out-of-scope evidence — the consumer has said
    // "yes, the rule fires here, and yes, that's intended."
    const files = new Map<string, string>([
      ['packages/cli/src/foo.test.ts', "// totem-ignore-next-line\nconsole.log('test stub')\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    // Suppressed lines don't yield violations, so the codebase walk produces
    // zero hits → no-matches outcome. The fact that this matches the
    // baseline test-file glob is moot because the rule never fired there.
    expect(result.outcome).toBe('no-matches');
  });
});

// ─── fileGlobs + baseline interaction ──────────────

describe('verifyAgainstCodebase rule without fileGlobs', () => {
  it('treats every non-baseline file as in-scope when rule has no fileGlobs', async () => {
    const ruleNoScope = makeRule({ fileGlobs: undefined });
    const files = new Map<string, string>([['anywhere/in/the/repo.ts', "console.log('debug')\n"]]);
    const result = await verifyAgainstCodebase(ruleNoScope, getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('in-scope-bad-example');
    expect(result.inScopeMatches).toEqual(['anywhere/in/the/repo.ts']);
  });

  it('still applies the default baseline when rule has no fileGlobs', async () => {
    const ruleNoScope = makeRule({ fileGlobs: undefined });
    const files = new Map<string, string>([
      ['packages/__tests__/foo.ts', "console.log('debug')\n"],
    ]);
    const result = await verifyAgainstCodebase(ruleNoScope, getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/__tests__/foo.ts']);
  });
});

describe('verifyAgainstCodebase test-contract rule scope vs baseline (CR mmnto-ai/totem#1766 R3)', () => {
  it('keeps test-scoped rule hits as in-scope when fileGlobs literally claims a baseline glob', async () => {
    // A test-contract rule legitimately scopes itself to test files. Without
    // R3 baseline-subtraction, classifyFile matched the rule scope first
    // (file matches `**/*.test.*`) then re-classified the same file as
    // baseline (because `**/*.test.*` is in `DEFAULT_BASELINE_GLOBS`),
    // routing the rule to `out-of-scope` on its own intended corpus.
    const testContractRule = makeRule({
      fileGlobs: ['**/*.test.*'],
      pattern: 'fdescribe',
      badExample: 'fdescribe("focused", () => {})',
    });
    const files = new Map<string, string>([
      ['packages/cli/src/foo.test.ts', 'fdescribe("focused", () => {})\n'],
    ]);
    const result = await verifyAgainstCodebase(
      testContractRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('in-scope-bad-example');
    expect(result.inScopeMatches).toEqual(['packages/cli/src/foo.test.ts']);
    expect(result.baselineMatches).toEqual([]);
  });

  it('keeps fixtures-scoped rule hits as in-scope when fileGlobs literally claims **/__fixtures__/**', async () => {
    const fixtureRule = makeRule({
      fileGlobs: ['**/__fixtures__/**'],
      pattern: 'TODO',
      badExample: '// TODO: replace fixture',
    });
    const files = new Map<string, string>([
      ['packages/cli/src/__fixtures__/sample.ts', '// TODO: replace fixture\n'],
    ]);
    const result = await verifyAgainstCodebase(fixtureRule, getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('in-scope-bad-example');
    expect(result.inScopeMatches).toEqual(['packages/cli/src/__fixtures__/sample.ts']);
  });

  it('still classifies non-claimed baseline files as baseline (no over-subtraction)', async () => {
    // Rule scopes to `**/*.test.*` only — this claims that one baseline glob.
    // A file at `packages/__tests__/foo.test.ts` matches BOTH `**/*.test.*`
    // (rule scope, claimed) AND `**/__tests__/**` (baseline, NOT claimed).
    // After subtraction the baseline still contains `**/__tests__/**`, so the
    // file must classify as baseline. This locks in that subtraction is
    // surgical (byte-equal on the entry the rule claimed) rather than a
    // wholesale baseline disable.
    const testContractRule = makeRule({
      fileGlobs: ['**/*.test.*'],
      pattern: 'console\\.log',
    });
    const files = new Map<string, string>([
      ['packages/__tests__/foo.test.ts', "console.log('debug')\n"],
    ]);
    const result = await verifyAgainstCodebase(
      testContractRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/__tests__/foo.test.ts']);
  });
});

// ─── Failure modes ────────────────────────────────

describe('verifyAgainstCodebase failure modes', () => {
  it('throws when readFile rejects (Tenet 4: fail loud)', async () => {
    const deps: Stage4VerifierDeps = {
      listFiles: async () => ['packages/cli/src/missing.ts'],
      readFile: async () => {
        throw new Error('ENOENT: no such file');
      },
    };
    await expect(verifyAgainstCodebase(makeRule(), getDefaultBaseline(), deps)).rejects.toThrow(
      /Stage 4 verifier could not read packages\/cli\/src\/missing\.ts/,
    );
  });

  it('throws when an ast-grep rule is verified without a workingDirectory (CR mmnto-ai/totem#1757 R1)', async () => {
    // Earlier code returned `[]` from `runRuleAgainstAllFiles` when
    // `workingDirectory` was absent on AST/ast-grep rules, which silently
    // misclassified the run as `'no-matches'`. Fail loud instead so the
    // missing-input case cannot masquerade as a clean codebase result.
    const files = new Map<string, string>([['packages/cli/src/foo.ts', 'console.log("x")']]);
    const deps: Stage4VerifierDeps = {
      listFiles: async () => [...files.keys()],
      readFile: async (file) => files.get(file) ?? '',
      // workingDirectory intentionally omitted.
    };
    const astRule = makeRule({ engine: 'ast-grep', pattern: 'console.log($X)' });
    await expect(verifyAgainstCodebase(astRule, getDefaultBaseline(), deps)).rejects.toThrow(
      /Stage 4 verifier requires deps\.workingDirectory for ast-grep rules/,
    );
  });
});

// ─── Custom baseline ──────────────────────────────

describe('verifyAgainstCodebase custom baseline overrides', () => {
  it('honors a custom baseline that excludes additional patterns', async () => {
    const customBaseline: Stage4Baseline = resolveStage4Baseline({
      configExtend: ['**/migrations/**'],
    });
    const files = new Map<string, string>([
      // Pattern fires on a migration file. Default baseline would treat
      // this as in-scope (since `migrations/` isn't in DEFAULT_BASELINE_GLOBS).
      // Custom baseline extension flips it to out-of-scope.
      ['packages/cli/src/migrations/001-init.ts', "console.log('migrating')\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), customBaseline, makeDeps(files));
    expect(result.outcome).toBe('out-of-scope');
    expect(result.baselineMatches).toEqual(['packages/cli/src/migrations/001-init.ts']);
  });
});

// ─── fileToAdditions trailing-blank handling ──────

describe("verifyAgainstCodebase fileToAdditions doesn't synthesize trailing blank line (CR mmnto-ai/totem#1757 R3)", () => {
  it('does not match a `^$` blank-line pattern against a newline-terminated single-line file', async () => {
    // Pre-fix: `split(/\r?\n/)` on `'foo\n'` produced `['foo', '']`,
    // and the empty trailing element would fire any rule with
    // pattern `^$`. The fix drops the trailing empty when content
    // was newline-terminated, so the only addition is line 1: `foo`.
    const blankLineRule = makeRule({
      pattern: '^$',
      message: 'no blank lines',
      badExample: '',
    });
    const files = new Map<string, string>([
      // Newline-terminated single-line file. Pre-fix: would fire on
      // synthetic blank line 2; post-fix: no fire.
      ['packages/cli/src/foo.ts', 'foo\n'],
    ]);
    const result = await verifyAgainstCodebase(
      blankLineRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('no-matches');
  });

  it('handles empty file content without producing a synthetic addition', async () => {
    const blankLineRule = makeRule({ pattern: '^$', message: 'no blank lines', badExample: '' });
    const files = new Map<string, string>([['packages/cli/src/empty.ts', '']]);
    const result = await verifyAgainstCodebase(
      blankLineRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('no-matches');
  });

  it('still detects real blank lines inside the file body', async () => {
    // Real blank line on line 2 must still fire — the fix only strips
    // the synthetic terminator, not legitimate interior blank lines.
    const blankLineRule = makeRule({
      pattern: '^$',
      message: 'no blank lines',
      badExample: '',
      fileGlobs: undefined,
    });
    const files = new Map<string, string>([['packages/cli/src/foo.ts', 'first\n\nthird\n']]);
    const result = await verifyAgainstCodebase(
      blankLineRule,
      getDefaultBaseline(),
      makeDeps(files),
    );
    // The interior blank line fires the pattern. Whether the outcome
    // is 'in-scope-bad-example' or 'candidate-debt' depends on the
    // bad-example match logic, but the file MUST appear in
    // `inScopeMatches` either way — proof the rule fired and the fix
    // didn't suppress real blank-line detection.
    expect(['in-scope-bad-example', 'candidate-debt']).toContain(result.outcome);
    expect(result.inScopeMatches).toEqual(['packages/cli/src/foo.ts']);
  });
});

// ─── ast-grep engine path ──────────────────────────

describe('verifyAgainstCodebase ast-grep engine (CR mmnto-ai/totem#1757 R2)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-stage4-astgrep-'));
    fs.mkdirSync(path.join(tmpDir, 'packages', 'cli', 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('routes ast-grep rules through the AST matcher and reports in-scope-bad-example', async () => {
    // The four-outcome contract above only exercises the regex engine.
    // ast-grep rules go through `applyAstRulesToAdditions`, which reads
    // file content from disk via `workingDirectory`, so the test stages
    // a real tmpDir alongside the synthetic readFile callback used to
    // build additions. Confirms the engine dispatch in
    // `runRuleAgainstAllFiles` does not silently fall back to regex.
    const filePath = 'packages/cli/src/foo.ts';
    const fileContent = "console.log('debug')\n";
    fs.writeFileSync(path.join(tmpDir, filePath), fileContent);

    const astRule: CompiledRule = {
      lessonHash: 'h-ast',
      lessonHeading: 'No console.log',
      pattern: 'console.log($X)',
      astGrepPattern: 'console.log($X)',
      message: 'no console.log',
      engine: 'ast-grep',
      compiledAt: new Date().toISOString(),
      badExample: "console.log('debug')",
      goodExample: '// noop',
      fileGlobs: ['packages/cli/src/**/*.ts'],
    };

    const deps: Stage4VerifierDeps = {
      listFiles: async () => [filePath],
      readFile: async (file) => {
        if (file === filePath) return fileContent;
        throw new Error(`stub readFile: ${file} not in fixture map`);
      },
      workingDirectory: tmpDir,
    };

    const result = await verifyAgainstCodebase(astRule, getDefaultBaseline(), deps);
    expect(result.outcome).toBe('in-scope-bad-example');
    expect(result.inScopeMatches).toEqual([filePath]);
    expect(result.baselineMatches).toEqual([]);
  });
});

// ─── badExample structural equivalence ────────────

describe('verifyAgainstCodebase badExample matching', () => {
  it('matches multi-line badExample any-line-equal semantics', async () => {
    // Pipeline 3 reuses the Bad snippet block as badExample. Multi-line
    // bodies should match if ANY component line equals the violation line.
    const ruleMultiLine = makeRule({
      badExample: "// helper\nconsole.log('debug')\nreturn null;",
    });
    const files = new Map<string, string>([
      // The middle line of the multi-line badExample matches the violation.
      ['packages/cli/src/foo.ts', "console.log('debug')\n"],
    ]);
    const result = await verifyAgainstCodebase(
      ruleMultiLine,
      getDefaultBaseline(),
      makeDeps(files),
    );
    expect(result.outcome).toBe('in-scope-bad-example');
  });

  it('treats trimmed-equal lines as bad-example matches (whitespace-insensitive)', async () => {
    const files = new Map<string, string>([
      // Tab-indented match — should still equal the badExample after trim.
      ['packages/cli/src/foo.ts', "\t\tconsole.log('debug')\n"],
    ]);
    const result = await verifyAgainstCodebase(makeRule(), getDefaultBaseline(), makeDeps(files));
    expect(result.outcome).toBe('in-scope-bad-example');
  });
});

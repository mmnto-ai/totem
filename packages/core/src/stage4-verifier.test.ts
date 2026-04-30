import { describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler-schema.js';
import {
  DEFAULT_BASELINE_GLOBS,
  getDefaultBaseline,
  type Stage4Baseline,
  type Stage4VerifierDeps,
  verifyAgainstCodebase,
} from './stage4-verifier.js';

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
});

// ─── Custom baseline ──────────────────────────────

describe('verifyAgainstCodebase custom baseline overrides', () => {
  it('honors a custom baseline that excludes additional patterns', async () => {
    const customBaseline: Stage4Baseline = {
      excludeFileGlobs: [...DEFAULT_BASELINE_GLOBS, '**/migrations/**'],
    };
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

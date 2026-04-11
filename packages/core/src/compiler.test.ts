import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRules,
  type CompiledRule,
  engineFields,
  extractAddedLines,
  hashLesson,
  loadCompiledRules,
  loadCompiledRulesFile,
  parseCompilerResponse,
  sanitizeFileGlobs,
  saveCompiledRules,
  saveCompiledRulesFile,
  validateRegex,
} from './compiler.js';
import { CompiledRuleSchema } from './compiler-schema.js';
import { cleanTmpDir } from './test-utils.js';

// ─── hashLesson ──────────────────────────────────────

describe('hashLesson', () => {
  it('returns a 16-char hex string', () => {
    const hash = hashLesson('heading', 'body');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns different hashes for different inputs', () => {
    const h1 = hashLesson('heading1', 'body');
    const h2 = hashLesson('heading2', 'body');
    expect(h1).not.toBe(h2);
  });

  it('returns stable hashes for the same input', () => {
    const h1 = hashLesson('heading', 'body');
    const h2 = hashLesson('heading', 'body');
    expect(h1).toBe(h2);
  });
});

// ─── validateRegex ───────────────────────────────────

describe('validateRegex', () => {
  it('accepts a valid regex', () => {
    expect(validateRegex('\\bfoo\\b')).toEqual({ valid: true });
  });

  it('accepts a simple string pattern', () => {
    expect(validateRegex('console.log')).toEqual({ valid: true });
  });

  it('accepts a complex but safe pattern', () => {
    // Anchored API key format — complex but not vulnerable
    expect(validateRegex('^[A-Za-z0-9]{32,}$')).toEqual({ valid: true });
  });

  it('rejects an invalid regex', () => {
    const result = validateRegex('[invalid');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid syntax');
  });

  it('rejects unbalanced parentheses', () => {
    const result = validateRegex('(unclosed');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid syntax');
  });

  it('rejects ReDoS pattern: nested quantifiers (a+)+', () => {
    const result = validateRegex('(a+)+$');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ReDoS vulnerability detected');
  });

  it('rejects ReDoS pattern: nested character class quantifiers ([a-zA-Z]+)*', () => {
    const result = validateRegex('([a-zA-Z]+)*');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ReDoS vulnerability detected');
  });

  it('rejects ReDoS pattern: nested repetition (.*a){10}', () => {
    const result = validateRegex('(.*a){10}');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('ReDoS vulnerability detected');
  });
});

// ─── extractAddedLines ──────────────────────────────

describe('extractAddedLines', () => {
  it('extracts added lines from a unified diff', () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

    const additions = extractAddedLines(diff);
    expect(additions).toHaveLength(2);
    expect(additions[0]).toMatchObject({ file: 'src/foo.ts', line: 'const b = 3;', lineNumber: 2 });
    expect(additions[1]).toMatchObject({ file: 'src/foo.ts', line: 'const c = 4;', lineNumber: 3 });
  });

  it('handles multiple files', () => {
    const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 line1
+added in a
 line2
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 line1
+added in b
 line2
`;

    const additions = extractAddedLines(diff);
    expect(additions).toHaveLength(2);
    expect(additions[0]!.file).toBe('a.ts');
    expect(additions[1]!.file).toBe('b.ts');
  });

  it('returns empty array for empty diff', () => {
    expect(extractAddedLines('')).toEqual([]);
  });

  it('handles quoted filenames with spaces', () => {
    const diff = `diff --git "a/path with spaces/file.ts" "b/path with spaces/file.ts"
--- "a/path with spaces/file.ts"
+++ "b/path with spaces/file.ts"
@@ -1,2 +1,3 @@
 line1
+added line
 line2
`;

    const additions = extractAddedLines(diff);
    expect(additions).toHaveLength(1);
    expect(additions[0]!.file).toBe('path with spaces/file.ts');
  });

  it('returns empty array for deletion-only diff', () => {
    const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,2 @@
 line1
-removed
 line2
`;
    expect(extractAddedLines(diff)).toEqual([]);
  });

  it('does not treat +++ inside a hunk as a file header', () => {
    // When a test file contains template literal diffs with "+++ b/file.ts",
    // git shows that added line as "++++ b/file.ts" in the outer diff.
    // The parser must NOT interpret this as a new file header.
    const diff = [
      'diff --git a/src/test.ts b/src/test.ts',
      '--- a/src/test.ts',
      '+++ b/src/test.ts',
      '@@ -1,3 +1,8 @@',
      ' const fixture = `',
      '+--- a/src/api.ts',
      '++++ b/src/api.ts',
      '+@@ -1,3 +1,5 @@',
      '+ export async function fetchData() {',
      '+  debugger;',
      ' `;',
    ].join('\n');

    const additions = extractAddedLines(diff);
    // All 5 added lines should belong to src/test.ts, not "src/api.ts"
    expect(additions).toHaveLength(5);
    for (const a of additions) {
      expect(a.file).toBe('src/test.ts');
    }
  });
});

// ─── applyRules ──────────────────────────────────────

describe('applyRules', () => {
  const makeRule = (pattern: string, message: string): CompiledRule => ({
    lessonHash: 'abc123',
    lessonHeading: 'Test rule',
    pattern,
    message,
    engine: 'regex',
    compiledAt: new Date().toISOString(),
  });

  const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,5 @@
 import { foo } from './foo';
+import { error } from './errors';
+const result = npm.install('package');
 export default foo;
`;

  it('detects a simple pattern violation', () => {
    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, diff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule.message).toBe('Do not call npm.install directly');
    expect(violations[0]!.file).toBe('src/app.ts');
  });

  it('returns no violations when patterns do not match', () => {
    const rules = [makeRule('\\byarn\\b', 'Do not use yarn')];
    const violations = applyRules(rules, diff);
    expect(violations).toHaveLength(0);
  });

  it('applies multiple rules', () => {
    const rules = [
      makeRule('\\bnpm\\b', 'Do not use npm'),
      makeRule('\\berror\\b', 'Use err, not error'),
    ];
    const violations = applyRules(rules, diff);
    expect(violations).toHaveLength(2);
  });

  it('skips rules with invalid patterns', () => {
    const rules = [makeRule('[invalid', 'Bad pattern')];
    const violations = applyRules(rules, diff);
    expect(violations).toHaveLength(0);
  });

  it('returns empty for empty diff', () => {
    const rules = [makeRule('anything', 'test')];
    expect(applyRules(rules, '')).toEqual([]);
  });

  it('returns empty for empty rules', () => {
    expect(applyRules([], diff)).toEqual([]);
  });

  it('excludes files listed in excludeFiles', () => {
    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, diff, ['src/app.ts']);
    expect(violations).toHaveLength(0);
  });

  it('still detects violations in non-excluded files', () => {
    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, diff, ['other-file.ts']);
    expect(violations).toHaveLength(1);
  });

  // ─── fileGlobs scoping ─────────────────────────────

  // Build test data from array join to avoid embedded diff headers
  // (+++, ---) being parsed as real file boundaries by the shield.
  const multiFileDiff = [
    'diff --git a/deploy.sh b/deploy.sh',
    '--- a/deploy.sh',
    '+++ b/deploy.sh',
    '@@ -1,2 +1,3 @@',
    ' #!/bin/bash',
    '+echo $UNQUOTED_VAR',
    ' exit 0',
    'diff --git a/src/utils.ts b/src/utils.ts',
    '--- a/src/utils.ts',
    '+++ b/src/utils.ts',
    '@@ -1,2 +1,3 @@',
    ' const x = 1;',
    "+const msg = $name + ' hello';",
    ' export default x;',
  ].join('\n');

  it('applies rule to all files when fileGlobs is absent', () => {
    const rules = [makeRule('\\$\\w+', 'Found a dollar-sign variable')];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(2); // matches in both .sh and .ts
  });

  it('restricts rule to matching file types via fileGlobs', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('\\$\\w+', 'Quote shell variables'),
        fileGlobs: ['*.sh', '*.bash'],
      },
    ];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('deploy.sh');
  });

  it('skips rule entirely when no files match fileGlobs', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('\\$\\w+', 'Quote shell variables'),
        fileGlobs: ['*.py'],
      },
    ];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(0);
  });

  it('handles **/*.ext glob pattern', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('\\$\\w+', 'Found dollar variable'),
        fileGlobs: ['**/*.ts'],
      },
    ];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('src/utils.ts');
  });

  it('applies rule when fileGlobs is empty array (treated as no restriction)', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('\\$\\w+', 'Found dollar variable'),
        fileGlobs: [],
      },
    ];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(2);
  });

  it('excludes files matching negated glob patterns', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('\\$\\w+', 'Found dollar variable'),
        fileGlobs: ['*.sh', '*.ts', '!*.sh'],
      },
    ];
    const violations = applyRules(rules, multiFileDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('src/utils.ts');
  });

  // ─── Directory-prefixed glob patterns ──────────────

  const monorepoMultiFileDiff = [
    'diff --git a/packages/mcp/src/server.ts b/packages/mcp/src/server.ts',
    '--- a/packages/mcp/src/server.ts',
    '+++ b/packages/mcp/src/server.ts',
    '@@ -1,2 +1,3 @@',
    ' const x = 1;',
    '+text: rawResult',
    ' export default x;',
    'diff --git a/packages/core/src/validator.ts b/packages/core/src/validator.ts',
    '--- a/packages/core/src/validator.ts',
    '+++ b/packages/core/src/validator.ts',
    '@@ -1,2 +1,3 @@',
    ' const y = 2;',
    '+text: someValue',
    ' export default y;',
    'diff --git a/packages/mcp/src/tools.test.ts b/packages/mcp/src/tools.test.ts',
    '--- a/packages/mcp/src/tools.test.ts',
    '+++ b/packages/mcp/src/tools.test.ts',
    '@@ -1,2 +1,3 @@',
    " it('works', () => {",
    '+text: testFixture',
    ' });',
  ].join('\n');

  it('matches directory-prefixed glob (packages/mcp/**/*.ts)', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('text:\\s*\\w+', 'MCP rule'),
        fileGlobs: ['packages/mcp/**/*.ts'],
      },
    ];
    const violations = applyRules(rules, monorepoMultiFileDiff);
    expect(violations).toHaveLength(2); // server.ts + tools.test.ts
    expect(violations.every((v) => v.file!.startsWith('packages/mcp/'))).toBe(true);
  });

  it('combines directory-prefix with test exclusion', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('text:\\s*\\w+', 'MCP rule'),
        fileGlobs: ['packages/mcp/**/*.ts', '!**/*.test.ts'],
      },
    ];
    const violations = applyRules(rules, monorepoMultiFileDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('packages/mcp/src/server.ts');
  });

  it('does not match files outside directory prefix', () => {
    const rules: CompiledRule[] = [
      {
        ...makeRule('text:\\s*\\w+', 'CLI rule'),
        fileGlobs: ['packages/cli/**/*.ts'],
      },
    ];
    const violations = applyRules(rules, monorepoMultiFileDiff);
    expect(violations).toHaveLength(0);
  });

  // ─── Inline suppression (totem-ignore) ─────────────

  it('suppresses same-line violation with totem-ignore', () => {
    const suppressedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const result = npm.install("pkg"); // totem-ignore',
      ' export default x;',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('suppresses next-line violation with totem-ignore-next-line (both added)', () => {
    const suppressedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,4 @@',
      ' const x = 1;',
      '+// totem-ignore-next-line',
      '+const result = npm.install("pkg");',
      ' export default x;',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('suppresses next-line violation when directive is a context line', () => {
    // The totem-ignore-next-line comment already existed (context line ' ')
    // and the user adds a new violating line below it
    const suppressedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      ' // totem-ignore-next-line',
      '+const result = npm.install("pkg");',
      ' export default x;',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('does not suppress when there is no directive', () => {
    const plainDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const result = npm.install("pkg");',
      ' export default x;',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install directly')];
    const violations = applyRules(rules, plainDiff);
    expect(violations).toHaveLength(1);
  });

  it('supports hash-style comment suppression', () => {
    const suppressedDiff = [
      'diff --git a/deploy.sh b/deploy.sh',
      '--- a/deploy.sh',
      '+++ b/deploy.sh',
      '@@ -1,2 +1,4 @@',
      ' #!/bin/bash',
      '+# totem-ignore-next-line',
      '+echo $UNQUOTED_VAR',
      ' exit 0',
    ].join('\n');

    const rules = [makeRule('\\$[A-Z_]+', 'Quote shell variables')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('supports HTML comment suppression', () => {
    const suppressedDiff = [
      'diff --git a/docs/index.md b/docs/index.md',
      '--- a/docs/index.md',
      '+++ b/docs/index.md',
      '@@ -1,2 +1,3 @@',
      ' # Title',
      '+<!-- totem-ignore --> Use npm.install for setup',
      ' More text',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('suppresses all rule violations on a single ignored line', () => {
    const suppressedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const error = npm.install("pkg"); // totem-ignore',
      ' export default x;',
    ].join('\n');

    const rules = [
      makeRule('\\bnpm\\.install\\b', 'Do not call npm.install'),
      makeRule('\\berror\\b', 'Use err, not error'),
    ];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('handles suppression at first line of hunk (no preceding line)', () => {
    const suppressedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,2 +1,3 @@',
      '+const result = npm.install("pkg"); // totem-ignore',
      ' const x = 1;',
      ' export default x;',
    ].join('\n');

    const rules = [makeRule('\\bnpm\\.install\\b', 'Do not call npm.install')];
    const violations = applyRules(rules, suppressedDiff);
    expect(violations).toHaveLength(0);
  });

  it('excludes test files with negated glob while matching source files', () => {
    const testFileDiff = [
      'diff --git a/src/utils.ts b/src/utils.ts',
      '--- a/src/utils.ts',
      '+++ b/src/utils.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const tmp = os.tmpdir();',
      ' export default x;',
      'diff --git a/src/utils.test.ts b/src/utils.test.ts',
      '--- a/src/utils.test.ts',
      '+++ b/src/utils.test.ts',
      '@@ -1,2 +1,3 @@',
      " import { describe } from 'vitest';",
      '+const tmp = os.tmpdir();',
      ' describe(x);',
    ].join('\n');

    const rules: CompiledRule[] = [
      {
        ...makeRule('\\bos\\.tmpdir\\(\\)', 'Use workspace-local paths'),
        fileGlobs: ['*.ts', '!*.test.ts', '!*.spec.ts'],
      },
    ];
    const violations = applyRules(rules, testFileDiff);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe('src/utils.ts');
  });
});

// ─── loadCompiledRules / saveCompiledRules ───────────

describe('compiled rules file I/O', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compiler-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('round-trips rules through save and load', () => {
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    const rules: CompiledRule[] = [
      {
        lessonHash: 'abc123def456',
        lessonHeading: 'Use err not error',
        pattern: '\\berror\\b',
        message: 'Use err instead of error in catch blocks',
        engine: 'regex',
        compiledAt: '2026-03-08T12:00:00Z',
      },
    ];

    saveCompiledRules(rulesPath, rules);
    const loaded = loadCompiledRules(rulesPath);
    expect(loaded).toEqual(rules);
  });

  it('returns empty array for missing file', () => {
    const loaded = loadCompiledRules(path.join(tmpDir, 'nonexistent.json'));
    expect(loaded).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    const rulesPath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(rulesPath, 'not valid json');
    expect(loadCompiledRules(rulesPath)).toEqual([]);
  });

  it('throws TotemParseError for wrong schema', () => {
    const rulesPath = path.join(tmpDir, 'wrong.json');
    fs.writeFileSync(rulesPath, JSON.stringify({ version: 99, rules: [] }));
    expect(() => loadCompiledRules(rulesPath)).toThrow('Invalid compiled-rules.json');
  });

  // Archived rule filtering — #1336 "The Archive Lie".
  //
  // Prior to #1336, `loadCompiledRules` returned every rule in the manifest
  // regardless of `status`. The schema has the field, `totem doctor --pr`
  // mutates rules to `status: 'archived'` with an `archivedReason`, and the
  // schema doc comment says "active rules are enforced, archived rules are
  // skipped". But nothing in the lint execution path filtered them out,
  // making the self-healing loop a placebo.
  //
  // Invariants locked in below:
  //   1. `loadCompiledRules` omits rules with `status === 'archived'`
  //   2. Legacy rules without a `status` field stay enabled (use `!== 'archived'`
  //      not `=== 'active'` so undefined behaves as active)
  //   3. `loadCompiledRulesFile` returns the full unfiltered manifest so admin
  //      tools (doctor, compile) can still read archived rules for lifecycle
  //      management (Tenet 4: Fail Loud — admin writes never silently drop state)
  describe('archived filtering (#1336)', () => {
    const activeRule: CompiledRule = {
      lessonHash: 'aaaaaaaaaaaaaaaa',
      lessonHeading: 'Active rule',
      pattern: '\\bactive\\b',
      message: 'active',
      engine: 'regex',
      status: 'active',
      compiledAt: '2026-04-11T00:00:00Z',
    };

    const legacyRule: CompiledRule = {
      lessonHash: 'bbbbbbbbbbbbbbbb',
      lessonHeading: 'Legacy rule without status field',
      pattern: '\\blegacy\\b',
      message: 'legacy',
      engine: 'regex',
      compiledAt: '2026-04-11T00:00:00Z',
    };

    const archivedRule: CompiledRule = {
      lessonHash: 'cccccccccccccccc',
      lessonHeading: 'Archived rule',
      pattern: '\\barchived\\b',
      message: 'archived',
      engine: 'regex',
      status: 'archived',
      archivedReason: 'Stale for 90+ days with zero triggers',
      compiledAt: '2026-04-11T00:00:00Z',
    };

    it('loadCompiledRules filters out archived rules but retains active and undefined-status rules', () => {
      const rulesPath = path.join(tmpDir, 'compiled-rules.json');
      saveCompiledRulesFile(rulesPath, {
        version: 1,
        rules: [activeRule, legacyRule, archivedRule],
        nonCompilable: [],
      });

      const loaded = loadCompiledRules(rulesPath);
      expect(loaded).toHaveLength(2);
      expect(loaded.map((r) => r.lessonHash)).toEqual([
        activeRule.lessonHash,
        legacyRule.lessonHash,
      ]);
      expect(loaded.some((r) => r.status === 'archived')).toBe(false);

      // The full manifest is still intact on disk — archiving is not deletion.
      const manifest = loadCompiledRulesFile(rulesPath);
      expect(manifest.rules).toHaveLength(3);
      expect(manifest.rules.some((r) => r.lessonHash === archivedRule.lessonHash)).toBe(true);
    });

    it('loadCompiledRulesFile returns the full unfiltered manifest including archived rules', () => {
      const rulesPath = path.join(tmpDir, 'compiled-rules.json');
      saveCompiledRulesFile(rulesPath, {
        version: 1,
        rules: [activeRule, archivedRule],
        nonCompilable: [],
      });

      const manifest = loadCompiledRulesFile(rulesPath);
      expect(manifest.rules).toHaveLength(2);
      const archived = manifest.rules.find((r) => r.lessonHash === archivedRule.lessonHash);
      expect(archived?.status).toBe('archived');
      expect(archived?.archivedReason).toBe('Stale for 90+ days with zero triggers');
    });

    it('returns an empty array when every rule is archived', () => {
      const rulesPath = path.join(tmpDir, 'compiled-rules.json');
      saveCompiledRulesFile(rulesPath, {
        version: 1,
        rules: [archivedRule],
        nonCompilable: [],
      });

      expect(loadCompiledRules(rulesPath)).toEqual([]);
    });

    it('archived rules do not fire while a sibling active rule still triggers on the same diff', () => {
      // Integration proof: an active rule matching one added line and an
      // archived rule matching a second added line must resolve to exactly
      // one violation (from the active rule). This exercises the full
      // loader → applyRules pipeline and rules out a "trivially empty"
      // failure mode where the filter might over-match.
      const rulesPath = path.join(tmpDir, 'compiled-rules.json');
      saveCompiledRulesFile(rulesPath, {
        version: 1,
        rules: [activeRule, archivedRule],
        nonCompilable: [],
      });

      const rules = loadCompiledRules(rulesPath);
      expect(rules).toHaveLength(1);
      expect(rules[0]!.lessonHash).toBe(activeRule.lessonHash);

      // Build the diff header tokens dynamically so this test file does not
      // contain literal diff-header substrings that trip over-broad lint rules.
      const plus3 = '+'.repeat(3);
      const minus3 = '-'.repeat(3);
      const samplePath = 'src/sample.ts';
      const diff = [
        `diff --git a/${samplePath} b/${samplePath}`,
        'index 0000000..1111111 100644',
        `${minus3} a/${samplePath}`,
        `${plus3} b/${samplePath}`,
        '@@ -0,0 +1,2 @@',
        '+const first = "the active rule must fire here";',
        '+const second = "the archived rule must not fire here";',
      ].join('\n');

      const violations = applyRules(rules, diff);
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule.lessonHash).toBe(activeRule.lessonHash);
      expect(violations.some((v) => v.rule.lessonHash === archivedRule.lessonHash)).toBe(false);
    });
  });
});

describe('nonCompilable tuple schema (#1280)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-noncompilable-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('loads legacy string-only nonCompilable arrays without errors', async () => {
    // Pre-#1280: nonCompilable was Array<string>. Existing 1.13.0 compiled-rules.json
    // files in the wild have this shape. The schema must keep accepting them.
    const { loadCompiledRulesFile } = await import('./compiler.js');
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        version: 1,
        rules: [],
        nonCompilable: ['legacy-hash-aaa', 'legacy-hash-bbb'],
      }),
    );
    const loaded = loadCompiledRulesFile(rulesPath);
    // Loader normalizes legacy strings to {hash, title} tuples for downstream uniformity.
    expect(loaded.nonCompilable).toEqual([
      { hash: 'legacy-hash-aaa', title: '(legacy entry)' },
      { hash: 'legacy-hash-bbb', title: '(legacy entry)' },
    ]);
  });

  it('loads new tuple-form nonCompilable arrays', async () => {
    const { loadCompiledRulesFile } = await import('./compiler.js');
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        version: 1,
        rules: [],
        nonCompilable: [
          { hash: 'newer-hash-1', title: 'Async error handling without context' },
          { hash: 'newer-hash-2', title: 'SSR hydration mismatch logging' },
        ],
      }),
    );
    const loaded = loadCompiledRulesFile(rulesPath);
    expect(loaded.nonCompilable).toEqual([
      { hash: 'newer-hash-1', title: 'Async error handling without context' },
      { hash: 'newer-hash-2', title: 'SSR hydration mismatch logging' },
    ]);
  });

  it('loads mixed legacy + tuple arrays', async () => {
    // Migration scenario: a project with stale legacy entries plus new tuple entries
    // (e.g., someone upgraded mid-cycle). Loader normalizes both to tuples.
    const { loadCompiledRulesFile } = await import('./compiler.js');
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        version: 1,
        rules: [],
        nonCompilable: [
          'legacy-hash',
          { hash: 'tuple-hash', title: 'Has a real title' },
          'another-legacy',
        ],
      }),
    );
    const loaded = loadCompiledRulesFile(rulesPath);
    expect(loaded.nonCompilable).toEqual([
      { hash: 'legacy-hash', title: '(legacy entry)' },
      { hash: 'tuple-hash', title: 'Has a real title' },
      { hash: 'another-legacy', title: '(legacy entry)' },
    ]);
  });

  it('round-trips tuple entries through save and load', async () => {
    const { loadCompiledRulesFile, saveCompiledRulesFile } = await import('./compiler.js');
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    saveCompiledRulesFile(rulesPath, {
      version: 1,
      rules: [],
      nonCompilable: [
        { hash: 'roundtrip-1', title: 'First entry' },
        { hash: 'roundtrip-2', title: 'Second entry' },
      ],
    });
    const loaded = loadCompiledRulesFile(rulesPath);
    expect(loaded.nonCompilable).toEqual([
      { hash: 'roundtrip-1', title: 'First entry' },
      { hash: 'roundtrip-2', title: 'Second entry' },
    ]);
  });

  it('save normalizes legacy strings to tuples on the next round-trip', async () => {
    // The loader normalizes on read, so when the same data flows back through save,
    // the disk file gets the canonical tuple form. Legacy strings are a one-way
    // migration: once loaded, they're tuples; once saved, they stay tuples.
    const { loadCompiledRulesFile, saveCompiledRulesFile } = await import('./compiler.js');
    const rulesPath = path.join(tmpDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        version: 1,
        rules: [],
        nonCompilable: ['legacy-only'],
      }),
    );
    const firstLoad = loadCompiledRulesFile(rulesPath);
    saveCompiledRulesFile(rulesPath, firstLoad);
    const onDisk = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as {
      nonCompilable: Array<{ hash: string; title: string } | string>;
    };
    expect(onDisk.nonCompilable).toEqual([{ hash: 'legacy-only', title: '(legacy entry)' }]);
  });
});

// ─── CompiledRuleSchema: status / archivedReason ────

describe('CompiledRuleSchema status field', () => {
  const baseRule = {
    lessonHash: 'abc123def456',
    lessonHeading: 'Test rule',
    pattern: '\\berror\\b',
    message: 'Use err instead of error',
    engine: 'regex' as const,
    compiledAt: '2026-03-08T12:00:00Z',
  };

  it('compiled rule without status is valid (undefined = active)', () => {
    const parsed = CompiledRuleSchema.parse(baseRule);
    expect(parsed.status).toBeUndefined();
  });

  it('accepts archived status with reason', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      status: 'archived',
      archivedReason: 'Zero triggers after 90 days',
    });
    expect(parsed.status).toBe('archived');
    expect(parsed.archivedReason).toBe('Zero triggers after 90 days');
  });

  it('rejects invalid status value', () => {
    expect(() => CompiledRuleSchema.parse({ ...baseRule, status: 'deleted' })).toThrow();
  });

  it('existing rules without status field remain valid', () => {
    const parsed = CompiledRuleSchema.parse(baseRule);
    expect(parsed.status).toBeUndefined();
    expect(parsed.archivedReason).toBeUndefined();
  });
});

// ─── parseCompilerResponse ──────────────────────────

describe('parseCompilerResponse', () => {
  it('parses a valid compilable response', () => {
    const response = JSON.stringify({
      compilable: true,
      pattern: '\\bnpm\\b',
      message: 'Use pnpm instead of npm',
    });

    const result = parseCompilerResponse(response);
    expect(result).toEqual({
      compilable: true,
      pattern: '\\bnpm\\b',
      message: 'Use pnpm instead of npm',
    });
  });

  it('parses a non-compilable response', () => {
    const response = JSON.stringify({ compilable: false });
    const result = parseCompilerResponse(response);
    expect(result).toEqual({ compilable: false });
  });

  it('extracts JSON from a code fence', () => {
    const response = `Here is the compiled rule:
\`\`\`json
{"compilable": true, "pattern": "console\\\\.log", "message": "Remove debug logging"}
\`\`\``;

    const result = parseCompilerResponse(response);
    expect(result).not.toBeNull();
    expect(result!.compilable).toBe(true);
    expect(result!.pattern).toBe('console\\.log');
  });

  it('extracts JSON from a tilde-fenced code block (#1319)', () => {
    const response = `Here is the compiled rule:
~~~json
{"compilable": true, "pattern": "console\\\\.log", "message": "Remove debug logging"}
~~~`;

    const result = parseCompilerResponse(response);
    expect(result).not.toBeNull();
    expect(result!.compilable).toBe(true);
    expect(result!.pattern).toBe('console\\.log');
  });

  it('returns null for completely invalid output', () => {
    expect(parseCompilerResponse('I cannot compile this lesson.')).toBeNull();
  });

  it('returns null for JSON with wrong schema', () => {
    const response = JSON.stringify({ foo: 'bar' });
    expect(parseCompilerResponse(response)).toBeNull();
  });

  it('parses a non-compilable response with reason', () => {
    const response = JSON.stringify({
      compilable: false,
      reason:
        'Lesson describes a conceptual architectural principle, not a detectable code pattern',
    });
    const result = parseCompilerResponse(response);
    expect(result).toEqual({
      compilable: false,
      reason:
        'Lesson describes a conceptual architectural principle, not a detectable code pattern',
    });
  });

  it('parses a non-compilable response without reason (backward compat)', () => {
    const response = JSON.stringify({ compilable: false });
    const result = parseCompilerResponse(response);
    expect(result).toEqual({ compilable: false });
    expect(result!.reason).toBeUndefined();
  });

  it('parses a response with fileGlobs', () => {
    const response = JSON.stringify({
      compilable: true,
      pattern: '\\$[a-zA-Z_]+',
      message: 'Quote shell variables',
      fileGlobs: ['*.sh', '*.bash', '*.yml'],
    });

    const result = parseCompilerResponse(response);
    expect(result).toEqual({
      compilable: true,
      pattern: '\\$[a-zA-Z_]+',
      message: 'Quote shell variables',
      fileGlobs: ['*.sh', '*.bash', '*.yml'],
    });
  });

  it('strips single backtick wrappers from pattern fields', () => {
    const response = JSON.stringify({
      compilable: true,
      engine: 'ast-grep',
      astGrepPattern: '`spawn($CMD, [$$$ARGS], { shell: true })`',
      pattern: '',
      message: 'Do not use shell:true with array args',
    });
    const result = parseCompilerResponse(response);
    expect(result!.astGrepPattern).toBe('spawn($CMD, [$$$ARGS], { shell: true })');
  });

  it('strips single backtick wrappers from regex pattern', () => {
    const response = JSON.stringify({
      compilable: true,
      pattern: '`\\bconsole\\.log\\b`',
      message: 'No console.log',
    });
    const result = parseCompilerResponse(response);
    expect(result!.pattern).toBe('\\bconsole\\.log\\b');
  });

  it('leaves patterns without backtick wrappers unchanged', () => {
    const response = JSON.stringify({
      compilable: true,
      engine: 'ast-grep',
      astGrepPattern: '$OBJ.replace(process.cwd(), $R)',
      pattern: '',
      message: 'Use path.relative',
    });
    const result = parseCompilerResponse(response);
    expect(result!.astGrepPattern).toBe('$OBJ.replace(process.cwd(), $R)');
  });
});

// ─── sanitizeFileGlobs ─────────────────────────────

describe('sanitizeFileGlobs', () => {
  it('normalizes shallow globs and preserves already-recursive ones', () => {
    expect(sanitizeFileGlobs(['**/*.ts', '*.js'])).toEqual(['**/*.ts', '**/*.js']);
  });

  it('expands brace patterns', () => {
    expect(sanitizeFileGlobs(['**/*.{ts,js}'])).toEqual(['**/*.ts', '**/*.js']);
  });

  it('handles mixed array of simple and brace globs', () => {
    expect(sanitizeFileGlobs(['src/**/*.py', '**/*.{ts,js}', '*.md'])).toEqual([
      'src/**/*.py',
      '**/*.ts',
      '**/*.js',
      '**/*.md',
    ]);
  });

  it('handles empty array', () => {
    expect(sanitizeFileGlobs([])).toEqual([]);
  });

  it('handles negation patterns', () => {
    expect(sanitizeFileGlobs(['!*.test.ts', '!**/*.spec.{ts,js}'])).toEqual([
      '!**/*.test.ts',
      '!**/*.spec.ts',
      '!**/*.spec.js',
    ]);
  });

  it('expands multiple brace groups in a single glob', () => {
    expect(sanitizeFileGlobs(['src/{cli,core}/**/*.{ts,js}'])).toEqual([
      'src/cli/**/*.ts',
      'src/cli/**/*.js',
      'src/core/**/*.ts',
      'src/core/**/*.js',
    ]);
  });

  // ─── Shallow glob normalization (#941) ─────────────

  it('normalizes shallow fileGlobs to recursive patterns', () => {
    expect(sanitizeFileGlobs(['*.ts', '*.md'])).toEqual(['**/*.ts', '**/*.md']);
  });

  it('preserves directory-scoped globs', () => {
    expect(sanitizeFileGlobs(['src/*.ts'])).toEqual(['src/*.ts']);
  });

  it('preserves already-recursive globs', () => {
    expect(sanitizeFileGlobs(['**/*.ts'])).toEqual(['**/*.ts']);
  });

  it('normalizes bare wildcard', () => {
    expect(sanitizeFileGlobs(['*'])).toEqual(['**/*']);
  });

  it('normalizes negated shallow globs', () => {
    expect(sanitizeFileGlobs(['!*.test.ts'])).toEqual(['!**/*.test.ts']);
  });

  it('skips non-string entries', () => {
    expect(sanitizeFileGlobs([42, null, undefined, '*.ts'] as unknown[])).toEqual(['**/*.ts']);
  });

  it('skips empty strings and bare negation', () => {
    expect(sanitizeFileGlobs(['', '  ', '!', '*.ts'])).toEqual(['**/*.ts']);
  });
});

// ─── engineFields ──────────────────────────────────

describe('engineFields', () => {
  it('returns { pattern } for regex engine', () => {
    expect(engineFields('regex', '\\bconsole\\.log\\b')).toEqual({
      pattern: '\\bconsole\\.log\\b',
    });
  });

  it('returns { pattern: "", astGrepPattern } for ast-grep engine', () => {
    expect(engineFields('ast-grep', 'console.log($$$ARGS)')).toEqual({
      pattern: '',
      astGrepPattern: 'console.log($$$ARGS)',
    });
  });

  it('returns { pattern: "", astQuery } for ast engine', () => {
    expect(engineFields('ast', '(call_expression function: (identifier) @fn)')).toEqual({
      pattern: '',
      astQuery: '(call_expression function: (identifier) @fn)',
    });
  });
});

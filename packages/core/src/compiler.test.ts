import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRules,
  type CompiledRule,
  extractAddedLines,
  hashLesson,
  loadCompiledRules,
  parseCompilerResponse,
  saveCompiledRules,
  validateRegex,
} from './compiler.js';

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
    expect(additions[0]).toEqual({ file: 'src/foo.ts', line: 'const b = 3;', lineNumber: 2 });
    expect(additions[1]).toEqual({ file: 'src/foo.ts', line: 'const c = 4;', lineNumber: 3 });
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
});

// ─── loadCompiledRules / saveCompiledRules ───────────

describe('compiled rules file I/O', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compiler-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('returns empty array for wrong schema', () => {
    const rulesPath = path.join(tmpDir, 'wrong.json');
    fs.writeFileSync(rulesPath, JSON.stringify({ version: 99, rules: [] }));
    expect(loadCompiledRules(rulesPath)).toEqual([]);
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

  it('returns null for completely invalid output', () => {
    expect(parseCompilerResponse('I cannot compile this lesson.')).toBeNull();
  });

  it('returns null for JSON with wrong schema', () => {
    const response = JSON.stringify({ foo: 'bar' });
    expect(parseCompilerResponse(response)).toBeNull();
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
});

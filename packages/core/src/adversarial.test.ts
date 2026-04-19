import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyRules,
  applyRulesToAdditions,
  type CompiledRule,
  type DiffAddition,
  type RuleEngineContext,
} from './compiler.js';
import { makeRuleEngineCtx } from './test-utils.js';

let ctx: RuleEngineContext;
beforeEach(() => {
  ctx = makeRuleEngineCtx();
});

// ─── Adversarial Evaluation Harness ─────────────────
//
// Tests that compiled Totem rules catch planted bugs in realistic diffs.
// This is the deterministic subset of #196 — no LLM calls, pure regex.
// Each test simulates a developer making a known-bad change and verifies
// the compiled rules catch it before it reaches production.

const makeRule = (pattern: string, message: string, heading: string): CompiledRule => ({
  lessonHash: 'adversarial',
  lessonHeading: heading,
  pattern,
  message,
  engine: 'regex',
  compiledAt: new Date().toISOString(),
});

// ─── Rule set: common project traps ──────────────────

const ADVERSARIAL_RULES: CompiledRule[] = [
  makeRule(
    'catch\\s*\\(\\s*error\\s*[\\):]',
    'Use err, not error, in catch blocks (project convention)',
    'Use err not error',
  ),
  makeRule(
    '\\bnpm\\s+(install|run|exec|ci)\\b',
    'Use pnpm instead of npm (monorepo convention)',
    'Never use npm',
  ),
  makeRule(
    '\\bdebugger\\b',
    'Remove debugger statements before commit',
    'No debugger in production',
  ),
  makeRule(
    'process\\.exit\\(0\\)',
    'Do not call process.exit(0) — let the process end naturally',
    'Avoid process.exit(0)',
  ),
  makeRule(
    '\\.catch\\(\\(\\)\\s*=>\\s*\\{\\s*\\}\\)',
    'Empty catch blocks swallow errors silently',
    'No empty catch blocks',
  ),
  makeRule(
    'TODO|FIXME|HACK|XXX',
    'Resolve TODO/FIXME comments before merging',
    'No TODO in production',
  ),
  makeRule(
    'password\\s*[:=]\\s*["\'][^"\']+["\']',
    'Hardcoded passwords detected — use environment variables',
    'No hardcoded secrets',
  ),
  makeRule('\\bany\\b', 'Avoid TypeScript any — use unknown or proper types', 'No any types'),
];

// ─── Adversarial diffs: planted bugs ─────────────────

describe('adversarial evaluation harness', () => {
  it('catches npm usage in a CI script change', () => {
    const diff = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -10,3 +10,4 @@ jobs:
       - uses: actions/setup-node@v6
       - run: pnpm install
+      - run: npm run test
       - run: pnpm build
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations.length).toBeGreaterThan(0); // totem-ignore
    expect(violations.some((v) => v.rule.lessonHeading === 'Never use npm')).toBe(true);
  });

  it('catches error instead of err in catch block', () => {
    const diff = `diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -5,3 +5,5 @@ export function handler() {
   try {
     doWork();
+  } catch (error) {
+    console.error(error);
   }
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations.some((v) => v.rule.lessonHeading === 'Use err not error')).toBe(true);
  });

  it('catches debugger statements left in production code', () => {
    const diff = `diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,5 @@
 export async function fetchData() {
+  debugger;
   const res = await fetch('/api/data');
+  debugger;
   return res.json();
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    const debugViolations = violations.filter(
      (v) => v.rule.lessonHeading === 'No debugger in production',
    );
    expect(debugViolations).toHaveLength(2);
  });

  it('catches empty catch block', () => {
    const diff = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,4 @@
 export function tryParse(json: string) {
-  return JSON.parse(json);
+  return fetchData().catch(() => {})
 }
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations.some((v) => v.rule.lessonHeading === 'No empty catch blocks')).toBe(true);
  });

  it('catches TODO comments in new code', () => {
    const diff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,5 @@
 export function authenticate(token: string) {
+  // TODO: add rate limiting
+  // FIXME: this is a temporary hack
   return validateToken(token);
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    const todoViolations = violations.filter(
      (v) => v.rule.lessonHeading === 'No TODO in production',
    );
    expect(todoViolations).toHaveLength(2);
  });

  it('catches hardcoded password', () => {
    const diff = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,3 +1,4 @@
 export const config = {
   host: 'localhost',
+  password: 'hunter2',
 };
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations.some((v) => v.rule.lessonHeading === 'No hardcoded secrets')).toBe(true);
  });

  it('catches TypeScript any type', () => {
    const diff = `diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -1,3 +1,4 @@
 export interface Config {
   host: string;
+  metadata: any;
 }
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations.some((v) => v.rule.lessonHeading === 'No any types')).toBe(true);
  });

  it('passes a clean diff with no violations', () => {
    const diff = `diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,3 +1,5 @@
 export function greet(name: string): string {
-  return 'hello';
+  return \`Hello, \${name}!\`;
 }
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    expect(violations).toHaveLength(0);
  });

  it('respects inline suppression (totem-ignore)', () => {
    const diff = `diff --git a/src/cli.ts b/src/cli.ts
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,3 +1,4 @@
 export function main() {
+  debugger; // totem-ignore
   run();
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    const debugViolations = violations.filter(
      (v) => v.rule.lessonHeading === 'No debugger in production',
    );
    expect(debugViolations).toHaveLength(0);
  });

  it('catches multiple violations in a single diff', () => {
    const diff = `diff --git a/src/bad.ts b/src/bad.ts
--- a/src/bad.ts
+++ b/src/bad.ts
@@ -1,5 +1,10 @@
 export function bad() {
+  debugger;
+  // TODO: remove this
   try {
     doWork();
+  } catch (error) {
+    // swallow
   }
+  const data: any = fetch('/api');
 }
`;
    const violations = applyRules(ctx, ADVERSARIAL_RULES, diff);
    // Should catch: debugger, TODO, error (not err), any
    expect(violations.length).toBeGreaterThanOrEqual(4); // totem-ignore

    const headings = new Set(violations.map((v) => v.rule.lessonHeading));
    expect(headings.has('No debugger in production')).toBe(true);
    expect(headings.has('No TODO in production')).toBe(true);
    expect(headings.has('Use err not error')).toBe(true);
    expect(headings.has('No any types')).toBe(true);
  });
});

// ─── AST gating: false-positive suppression ─────────

describe('AST gating suppresses false positives', () => {
  it('skips violations in string-context additions', () => {
    const rules = ADVERSARIAL_RULES;

    // Simulate additions where AST gate has classified lines as string
    // (e.g., inside a template literal test fixture)
    const additions: DiffAddition[] = [
      {
        file: 'src/test.ts',
        line: '  debugger;',
        lineNumber: 3,
        precedingLine: null,
        astContext: 'string', // inside template literal
      },
      {
        file: 'src/test.ts',
        line: '  // TODO: remove this',
        lineNumber: 4,
        precedingLine: '  debugger;',
        astContext: 'string',
      },
      {
        file: 'src/test.ts',
        line: '  password: "hunter2",',
        lineNumber: 5,
        precedingLine: '  // TODO: remove this',
        astContext: 'string',
      },
    ];

    const violations = applyRulesToAdditions(ctx, rules, additions);
    expect(violations).toHaveLength(0);
  });

  it('skips violations in comment-context additions', () => {
    const rules = ADVERSARIAL_RULES;

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: '// npm install is required for setup',
        lineNumber: 1,
        precedingLine: null,
        astContext: 'comment',
      },
    ];

    const violations = applyRulesToAdditions(ctx, rules, additions);
    expect(violations).toHaveLength(0);
  });

  it('still catches violations in code-context additions', () => {
    const rules = ADVERSARIAL_RULES;

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: '  debugger;',
        lineNumber: 5,
        precedingLine: null,
        astContext: 'code',
      },
    ];

    const violations = applyRulesToAdditions(ctx, rules, additions);
    expect(violations.length).toBeGreaterThan(0); // totem-ignore
    expect(violations.some((v) => v.rule.lessonHeading === 'No debugger in production')).toBe(true);
  });

  it('still catches violations when astContext is undefined (fail-open)', () => {
    const rules = ADVERSARIAL_RULES;

    // No astContext = not classified = treated as code (fail-open)
    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: '  debugger;',
        lineNumber: 5,
        precedingLine: null,
        // astContext is undefined
      },
    ];

    const violations = applyRulesToAdditions(ctx, rules, additions);
    expect(violations.length).toBeGreaterThan(0); // totem-ignore
  });
});

/**
 * Adversarial Evaluation Harness — Model Drift Detection
 *
 * Sets up a real git repository with planted architectural violations
 * and corresponding Totem lessons, then runs `totem shield` to verify
 * that both deterministic and LLM modes catch the planted traps.
 *
 * Deterministic tests run on every CI run (no API keys needed).
 * LLM tests are gated behind CI_INTEGRATION=true (nightly only).
 *
 * Run locally:
 *   pnpm --filter @mmnto/cli vitest run -c vitest.integration.config.ts shield-eval
 *   CI_INTEGRATION=true GEMINI_API_KEY=... pnpm --filter @mmnto/cli vitest run -c vitest.integration.config.ts shield-eval
 *
 * @see https://github.com/mmnto-ai/totem/issues/196
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyRules,
  applyRulesToAdditions,
  type CompiledRule,
  type CompiledRulesFile,
  extractAddedLines,
  hashLesson,
} from '@mmnto/totem';

import { parseVerdict } from './shield.js';

// ─── Adversarial Fixtures ────────────────────────────

/** Planted trap rules that map to specific violations in the bad code. */
const TRAP_RULES: CompiledRule[] = [
  {
    lessonHash: hashLesson('Use fs/promises not fs', 'TRAP-001: Never import fs directly'),
    lessonHeading: 'Use fs/promises not fs',
    pattern: 'import\\s+.*\\bfrom\\s+[\'"]fs[\'"]',
    message: 'TRAP-001: Never import fs directly — use fs/promises for async safety',
    engine: 'regex' as const,
    compiledAt: new Date().toISOString(),
  },
  {
    lessonHash: hashLesson('No console.log in library code', 'TRAP-002'),
    lessonHeading: 'No console.log in library code',
    pattern: 'console\\.log\\(',
    message: 'TRAP-002: Use structured logger, not console.log, in library code',
    engine: 'regex' as const,
    compiledAt: new Date().toISOString(),
  },
  {
    lessonHash: hashLesson('Catch blocks use err not error', 'TRAP-003'),
    lessonHeading: 'Catch blocks use err not error',
    pattern: 'catch\\s*\\(\\s*error\\s*[\\):]',
    message: 'TRAP-003: Use err (not error) in catch blocks — project convention',
    engine: 'regex' as const,
    compiledAt: new Date().toISOString(),
  },
  {
    lessonHash: hashLesson('No sync file reads', 'TRAP-004'),
    lessonHeading: 'No sync file reads',
    pattern: 'readFileSync',
    message: 'TRAP-004: Use async readFile, not readFileSync, in request handlers',
    engine: 'regex' as const,
    compiledAt: new Date().toISOString(),
  },
];

/** Totem lessons that match the trap rules (for LLM mode context). */
const TRAP_LESSONS = `# Lessons

## Lesson — Use fs/promises not fs
TRAP-001: Never import \`fs\` directly in library code. Always use \`fs/promises\`
for async safety. Direct \`fs\` imports lead to blocking I/O in request handlers.

## Lesson — No console.log in library code
TRAP-002: Library modules must use a structured logger (onWarn callback or
similar pattern), never \`console.log()\`. Console output breaks MCP stdio
transport and pollutes test output.

## Lesson — Catch blocks use err not error
TRAP-003: All catch blocks must use \`err\` as the variable name, never \`error\`.
This is a project-wide convention enforced by the style guide.

## Lesson — No sync file reads
TRAP-004: Never use \`readFileSync\` in request handlers or hot paths. Use
\`readFile\` from \`fs/promises\` for non-blocking I/O.
`;

/** Clean code that passes all rules — used as baseline commit. */
const CLEAN_CODE = `import { readFile } from 'fs/promises';

export async function loadConfig(configPath: string): Promise<string> {
  try {
    const content = await readFile(configPath, 'utf-8');
    return content;
  } catch (err) {
    throw new Error(\`Failed to load config: \${(err as Error).message}\`);
  }
}
`;

/** Bad code with 4 planted violations — staged after baseline. */
const BAD_CODE = `import fs from 'fs';

export async function loadConfig(configPath: string): Promise<string> {
  try {
    console.log('Loading config from', configPath);
    const content = fs.readFileSync(configPath, 'utf-8');
    return content;
  } catch (error) {
    throw new Error(\`Failed to load config: \${(error as Error).message}\`);
  }
}
`;

/** The diff that shield will see (pre-computed for deterministic tests). */
const EXPECTED_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,9 +1,10 @@
-import { readFile } from 'fs/promises';
+import fs from 'fs';

 export async function loadConfig(configPath: string): Promise<string> {
   try {
-    const content = await readFile(configPath, 'utf-8');
+    console.log('Loading config from', configPath);
+    const content = fs.readFileSync(configPath, 'utf-8');
     return content;
-  } catch (err) {
-    throw new Error(\`Failed to load config: \${(err as Error).message}\`);
+  } catch (error) {
+    throw new Error(\`Failed to load config: \${(error as Error).message}\`);
   }
 }
`;

// ─── Test helpers ────────────────────────────────────

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf-8',
    timeout: 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

function scaffoldAdversarialRepo(tmpDir: string): void {
  // Initialize git repo
  git('init', tmpDir);
  git('config user.email "eval@totem.dev"', tmpDir);
  git('config user.name "Totem Eval"', tmpDir);

  // Create directory structure
  const srcDir = path.join(tmpDir, 'src');
  const totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(totemDir, { recursive: true });

  // Write clean baseline
  fs.writeFileSync(path.join(srcDir, 'config.ts'), CLEAN_CODE);
  fs.writeFileSync(path.join(totemDir, 'lessons.md'), TRAP_LESSONS);

  // Write compiled rules for deterministic mode
  const rulesFile: CompiledRulesFile = {
    version: 1,
    rules: TRAP_RULES,
  };
  fs.writeFileSync(path.join(totemDir, 'compiled-rules.json'), JSON.stringify(rulesFile, null, 2));

  // Commit baseline
  git('add -A', tmpDir);
  git('commit -m "baseline: clean code"', tmpDir);

  // Stage bad code (this creates the diff shield will see)
  fs.writeFileSync(path.join(srcDir, 'config.ts'), BAD_CODE);
  git('add -A', tmpDir);
}

// ─── Deterministic evaluation (no API keys) ─────────

describe('Adversarial Eval — Deterministic', () => {
  it('catches all 4 planted traps via compiled rules against expected diff', () => {
    const violations = applyRules(TRAP_RULES, EXPECTED_DIFF);

    expect(violations.length).toBeGreaterThanOrEqual(4); // totem-ignore

    const headings = new Set(violations.map((v) => v.rule.lessonHeading));
    expect(headings.has('Use fs/promises not fs')).toBe(true);
    expect(headings.has('No console.log in library code')).toBe(true);
    expect(headings.has('Catch blocks use err not error')).toBe(true);
    expect(headings.has('No sync file reads')).toBe(true);
  });

  it('catches all traps with AST-aware additions pipeline', () => {
    const additions = extractAddedLines(EXPECTED_DIFF);
    const violations = applyRulesToAdditions(TRAP_RULES, additions);

    // extractAddedLines only processes + lines, so we should still catch violations
    const headings = new Set(violations.map((v) => v.rule.lessonHeading));
    expect(headings.has('Use fs/promises not fs')).toBe(true);
    expect(headings.has('No console.log in library code')).toBe(true);
    expect(headings.has('No sync file reads')).toBe(true);
    expect(headings.has('Catch blocks use err not error')).toBe(true);
  });

  it('passes a clean diff with zero violations', () => {
    const cleanDiff = `diff --git a/src/clean.ts b/src/clean.ts
--- a/src/clean.ts
+++ b/src/clean.ts
@@ -1,3 +1,5 @@
 export function greet(name: string): string {
-  return 'hello';
+  return \`Hello, \${name}!\`;
 }
`;
    const violations = applyRules(TRAP_RULES, cleanDiff);
    expect(violations).toHaveLength(0);
  });

  it('sets up a real git repo and produces a valid diff', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eval-'));
    try {
      scaffoldAdversarialRepo(tmpDir);

      // Verify the staged diff contains our planted violations
      const diff = git('diff --staged', tmpDir);
      expect(diff).toContain("import fs from 'fs'");
      expect(diff).toContain('console.log');
      expect(diff).toContain('readFileSync');
      expect(diff).toContain('catch (error)');

      // Run compiled rules against the real diff
      const violations = applyRules(TRAP_RULES, diff);
      expect(violations.length).toBeGreaterThanOrEqual(4); // totem-ignore
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── LLM evaluation (nightly, requires API keys) ────

const EVAL_TIMEOUT_MS = 120_000; // 2 min — LLM can be slow

describe.runIf(process.env['CI_INTEGRATION'] === 'true')(
  'Adversarial Eval — LLM Model Drift',
  () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-eval-llm-'));
      scaffoldAdversarialRepo(tmpDir);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /**
     * Run shield as a subprocess against the adversarial repo.
     * Returns stdout, stderr, and exit code.
     */
    function runShield(
      args: string[],
      env: Record<string, string> = {},
    ): { stdout: string; stderr: string; exitCode: number } {
      const cliEntry = path.resolve('dist/index.js');
      const cmd = `node ${cliEntry} shield ${args.join(' ')}`;

      try {
        const stdout = execSync(cmd, {
          cwd: tmpDir,
          encoding: 'utf-8',
          timeout: EVAL_TIMEOUT_MS,
          env: {
            ...process.env,
            ...env,
            GIT_TERMINAL_PROMPT: '0',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return { stdout, stderr: '', exitCode: 0 };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? '',
          exitCode: e.status ?? 1,
        };
      }
    }

    it(
      'deterministic shield exits 1 and catches planted traps via subprocess',
      () => {
        const { exitCode, stdout, stderr } = runShield(['--deterministic', '--staged']);
        const output = stdout + stderr;

        expect(exitCode).toBe(1);
        expect(output).toContain('TRAP-001');
        expect(output).toContain('TRAP-002');
        expect(output).toContain('TRAP-003');
        expect(output).toContain('TRAP-004');
      },
      EVAL_TIMEOUT_MS,
    );

    // Gemini model drift test
    it.runIf(!!process.env['GEMINI_API_KEY'])(
      'Gemini catches planted traps (FAIL verdict expected)',
      async () => {
        // Write a minimal totem.config.ts for the adversarial repo
        const config = `
          export default {
            targets: [{ glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' }],
            totemDir: '.totem',
            lanceDir: '.lancedb',
            orchestrator: { provider: 'gemini', model: 'gemini-2.5-flash' },
          };
        `;
        fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), config);

        const { exitCode, stdout, stderr } = runShield(['--staged', '--mode=structural'], {
          GEMINI_API_KEY: process.env['GEMINI_API_KEY']!,
        });
        const output = stdout + stderr;

        // The model should detect at least some of the violations and FAIL
        const verdict = parseVerdict(stdout);
        expect(
          exitCode === 1 || (verdict && !verdict.pass),
          `Expected FAIL verdict but got exitCode=${exitCode}, verdict=${JSON.stringify(verdict)}\nOutput:\n${output}`,
        ).toBe(true);
      },
      EVAL_TIMEOUT_MS,
    );

    // Anthropic model drift test
    it.runIf(!!process.env['ANTHROPIC_API_KEY'])(
      'Anthropic catches planted traps (FAIL verdict expected)',
      async () => {
        const config = `
          export default {
            targets: [{ glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' }],
            totemDir: '.totem',
            lanceDir: '.lancedb',
            orchestrator: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
          };
        `;
        fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), config);

        const { exitCode, stdout, stderr } = runShield(['--staged', '--mode=structural'], {
          ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY']!,
        });
        const output = stdout + stderr;

        const verdict = parseVerdict(stdout);
        expect(
          exitCode === 1 || (verdict && !verdict.pass),
          `Expected FAIL verdict but got exitCode=${exitCode}, verdict=${JSON.stringify(verdict)}\nOutput:\n${output}`,
        ).toBe(true);
      },
      EVAL_TIMEOUT_MS,
    );

    // OpenAI model drift test
    it.runIf(!!process.env['OPENAI_API_KEY'])(
      'OpenAI catches planted traps (FAIL verdict expected)',
      async () => {
        const config = `
          export default {
            targets: [{ glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' }],
            totemDir: '.totem',
            lanceDir: '.lancedb',
            orchestrator: { provider: 'openai', model: 'gpt-4o-mini' },
          };
        `;
        fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), config);

        const { exitCode, stdout, stderr } = runShield(['--staged', '--mode=structural'], {
          OPENAI_API_KEY: process.env['OPENAI_API_KEY']!,
        });
        const output = stdout + stderr;

        const verdict = parseVerdict(stdout);
        expect(
          exitCode === 1 || (verdict && !verdict.pass),
          `Expected FAIL verdict but got exitCode=${exitCode}, verdict=${JSON.stringify(verdict)}\nOutput:\n${output}`,
        ).toBe(true);
      },
      EVAL_TIMEOUT_MS,
    );
  },
);

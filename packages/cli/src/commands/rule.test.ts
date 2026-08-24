import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading ───────────

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
  };
});

// ─── Helpers ────────────────────────────────────────────

/** Strip ANSI escape codes for assertion matching. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // totem-context: ANSI regex — not user input
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-'));
}

/** Write a minimal compiled-rules.json with the given rules. */
function writeRules(totemDir: string, rules: Record<string, unknown>[]): void {
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify({ version: 1, rules }), 'utf-8');
}

/** Scaffold a .totem directory with config, lessons dir, and optional rules. */
function scaffold(cwd: string, rules?: Record<string, unknown>[]) {
  const totemDir = path.join(cwd, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};', 'utf-8');

  if (rules) {
    writeRules(totemDir, rules);
  }
  return { totemDir, lessonsDir };
}

/**
 * Compute the hash a rule would get after parseLessonsFile processes it.
 * parseLessonsFile strips the **Tags:** line from the body before hashing,
 * so we replicate that here to get a matching hash.
 */
async function computeLessonHash(heading: string, bodyAfterTags: string): Promise<string> {
  const { hashLesson } = await import('@mmnto/totem');
  return hashLesson(heading, bodyAfterTags);
}

const SAMPLE_RULES = [
  {
    lessonHash: 'abcd1234abcd1234',
    lessonHeading: 'Always use strict equality',
    pattern: '===?\\s',
    message: 'Use === instead of ==',
    engine: 'regex',
    severity: 'error',
    compiledAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2025-12-01T00:00:00.000Z',
    fileGlobs: ['**/*.ts', '**/*.js'],
  },
  {
    lessonHash: 'efgh5678efgh5678',
    lessonHeading: 'Avoid console.log in production code that ships to users',
    pattern: 'console\\.log',
    message: 'Remove console.log statements',
    engine: 'regex',
    severity: 'warning',
    compiledAt: '2026-01-02T00:00:00.000Z',
    fileGlobs: ['**/*.ts'],
  },
  {
    lessonHash: 'abcd9999abcd9999',
    lessonHeading: 'No var declarations',
    pattern: '\\bvar\\b',
    message: 'Use const or let instead of var',
    engine: 'regex',
    severity: 'warning',
    compiledAt: '2026-01-03T00:00:00.000Z',
  },
];

// ─── Tests ──────────────────────────────────────────────

describe('rule list', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('outputs correct count and table format', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleListCommand } = await import('./rule.js');
    await ruleListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('3 rule(s) total');
    expect(output).toContain('abcd1234');
    expect(output).toContain('efgh5678');
    expect(output).toContain('regex');
    expect(output).toContain('error');
    expect(output).toContain('warning');
  });

  it('truncates long headings', async () => {
    scaffold(tmpDir, [
      {
        ...SAMPLE_RULES[0],
        lessonHeading:
          'This is a very long heading that exceeds fifty characters and should be truncated properly',
      },
    ]);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleListCommand } = await import('./rule.js');
    await ruleListCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    // Should be truncated with ellipsis
    expect(output).toContain('\u2026');
    // Should NOT contain the full heading
    expect(output).not.toContain('truncated properly');
  });

  it('shows error when no compiled-rules.json exists', async () => {
    scaffold(tmpDir); // no rules
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleListCommand } = await import('./rule.js');
    await ruleListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No compiled rules found');
    expect(output).toContain('totem compile');
  });
});

describe('rule inspect', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('finds rule by full hash', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleInspectCommand } = await import('./rule.js');
    await ruleInspectCommand('abcd1234abcd1234');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('abcd1234abcd1234');
    expect(output).toContain('Always use strict equality');
    expect(output).toContain('regex');
    expect(output).toContain('error');
    expect(output).toContain('**/*.ts');
  });

  it('finds rule by prefix', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleInspectCommand } = await import('./rule.js');
    await ruleInspectCommand('efgh');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('efgh5678efgh5678');
    expect(output).toContain('console.log');
  });

  it('errors on no match', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleInspectCommand } = await import('./rule.js');
    await ruleInspectCommand('zzzz');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain("No rule found matching 'zzzz'");
  });

  it('reports ambiguous prefix', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 'abcd' matches both abcd1234... and abcd9999...
    const { ruleInspectCommand } = await import('./rule.js');
    await ruleInspectCommand('abcd');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Ambiguous prefix');
    expect(output).toContain('abcd1234abcd1234');
    expect(output).toContain('abcd9999abcd9999');
  });
});

describe('rule test', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('passes when examples match correctly', async () => {
    const heading = 'Catch console log usage';
    // Body as parseLessonsFile would produce it (tags stripped)
    const bodyAfterTags = [
      'Do not use console.log in production.',
      '',
      '**Pattern:** `console\\.log`',
      '**Example Hit:** `console.log("debug")`',
      '**Example Miss:** `logger.info("debug")`',
    ].join('\n');

    const realHash = await computeLessonHash(heading, bodyAfterTags);

    const rule = {
      lessonHash: realHash,
      lessonHeading: heading,
      pattern: 'console\\.log',
      message: 'Remove console.log statements',
      engine: 'regex' as const,
      severity: 'error' as const,
      compiledAt: '2026-01-01T00:00:00.000Z',
    };

    const { lessonsDir } = scaffold(tmpDir, [rule]);

    // Write the lesson file — parseLessonsFile will extract heading and body
    const lessonContent = [
      `## Lesson \u2014 ${heading}`,
      '',
      '**Tags:** best-practice',
      '',
      bodyAfterTags,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(lessonsDir, 'lesson-test.md'), lessonContent, 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleTestCommand } = await import('./rule.js');
    await ruleTestCommand(realHash);

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('PASS');
  });

  it('reports failure when examples do not match', async () => {
    const heading = 'Catch console log';
    const bodyAfterTags = [
      'Remove console.log statements.',
      '',
      '**Pattern:** `console\\.log`',
      '**Example Hit:** `console.log("test")`',
      '**Example Miss:** `logger.info("test")`',
    ].join('\n');

    const realHash = await computeLessonHash(heading, bodyAfterTags);

    // Deliberately wrong pattern so the example hit will NOT match
    const rule = {
      lessonHash: realHash,
      lessonHeading: heading,
      pattern: 'NOMATCH_PATTERN_XYZZY',
      message: 'Remove console.log',
      engine: 'regex' as const,
      severity: 'warning' as const,
      compiledAt: '2026-01-01T00:00:00.000Z',
    };

    const { lessonsDir } = scaffold(tmpDir, [rule]);

    const lessonContent = [
      `## Lesson \u2014 ${heading}`,
      '',
      '**Tags:** lint',
      '',
      bodyAfterTags,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(lessonsDir, 'lesson-test.md'), lessonContent, 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleTestCommand } = await import('./rule.js');
    await ruleTestCommand(realHash);

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('FAIL');
  });

  it('reports when no examples exist in lesson', async () => {
    const heading = 'No examples lesson';
    const bodyAfterTags = 'This lesson has no Example Hit/Miss lines.';

    const realHash = await computeLessonHash(heading, bodyAfterTags);

    const rule = {
      lessonHash: realHash,
      lessonHeading: heading,
      pattern: 'something',
      message: 'Some rule',
      engine: 'regex' as const,
      severity: 'warning' as const,
      compiledAt: '2026-01-01T00:00:00.000Z',
    };

    const { lessonsDir } = scaffold(tmpDir, [rule]);

    const lessonContent = [
      `## Lesson \u2014 ${heading}`,
      '',
      '**Tags:** misc',
      '',
      bodyAfterTags,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(lessonsDir, 'lesson-test.md'), lessonContent, 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleTestCommand } = await import('./rule.js');
    await ruleTestCommand(realHash);

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No Example Hit/Miss');
  });

  it('shows error when no compiled-rules.json exists', async () => {
    scaffold(tmpDir); // no rules
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleTestCommand } = await import('./rule.js');
    await ruleTestCommand('abcd');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No compiled rules found');
  });

  // ── Prop 310 § Design 5/§ Design 10 — the RECORD path (slice 3) ──
  describe('record rules run their own `examples[i]` pairs', () => {
    const RECORD_HASH = '0123456789abcdef';

    // The command signals failure through `process.exitCode`; save + restore so a
    // failing pair here cannot leak a non-zero exit into a sibling suite.
    const savedExitCode = process.exitCode;
    beforeEach(() => {
      process.exitCode = undefined;
    });
    afterEach(() => {
      process.exitCode = savedExitCode;
    });

    /** A record-path compiled rule: `examples` is the § Design 12 discriminator. */
    function recordRule(examples: { bad: string; good: string }[]) {
      return {
        lessonHash: RECORD_HASH,
        lessonHeading: `Prop 310 rule record (${RECORD_HASH})`,
        pattern: 'console\\.log',
        message: 'console.log is banned.',
        engine: 'regex' as const,
        severity: 'warning' as const,
        fileGlobs: ['src/**/*.ts'],
        examples,
        compiledAt: '2026-08-22T00:00:00.000Z',
        createdAt: '2026-08-22T00:00:00.000Z',
      };
    }

    /** RAW captured stderr — every escape byte the command actually emitted. */
    const runTestRaw = async (examples: { bad: string; good: string }[]) => {
      scaffold(tmpDir, [recordRule(examples)]);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { ruleTestCommand } = await import('./rule.js');
      await ruleTestCommand(RECORD_HASH);
      return consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    };

    const runTest = async (examples: { bad: string; good: string }[]) =>
      stripAnsi(await runTestRaw(examples));

    it('PASSES with no lesson on disk — a record rule has no source lesson to look up', async () => {
      // The wiring check: before slice 3 this rule would have taken the lesson
      // lookup and reported "Source lesson … not found", never touching the pairs.
      const output = await runTest([{ bad: 'console.log("dbg")', good: 'logger.info("dbg")' }]);
      expect(output).toContain('PASS');
      expect(output).not.toContain('Source lesson');
      expect(process.exitCode).toBeUndefined();
    });

    it('reports PER ORDINAL and exits 1 when one pair’s `bad` does not fire', async () => {
      const output = await runTest([
        { bad: 'console.log("dbg")', good: 'logger.info("dbg")' }, // ok
        { bad: 'nothing matches here', good: 'logger.info("x")' }, // bad silent
      ]);
      expect(output).toContain('PASS examples[0]');
      expect(output).toContain('FAIL examples[1]');
      expect(output).toContain('bad did not fire');
      expect(process.exitCode).toBe(1);
    });

    it('exits 1 when a pair’s `good` FIRES (the silence leg is checked too)', async () => {
      const output = await runTest([
        { bad: 'console.log("dbg")', good: 'console.log("still bad")' },
      ]);
      expect(output).toContain('FAIL examples[0]');
      expect(output).toContain('good fired');
      expect(process.exitCode).toBe(1);
    });

    it('SANITIZES authored exemplar text before printing it (terminal injection)', async () => {
      // A record's exemplars are author-controlled YAML. An ANSI escape in one
      // would otherwise be interpreted by the terminal rather than shown. Built
      // with `String.fromCharCode` so this source file carries no raw control byte.
      const ESC = String.fromCharCode(27);
      // The authored sequence is an ERASE-DISPLAY CSI (`ESC[2J`), deliberately NOT
      // an SGR colour code: `ui`'s own colouring emits SGR sequences (`ESC[31m`,
      // `ESC[2m`, …) whenever colours are enabled, so asserting on a colour code
      // would fail in a colour-enabled environment for a reason unrelated to the
      // sanitizer (it did — owner gate, bot round 1). The CLI never emits `ESC[2J`,
      // so its absence is attributable to `sanitizeForTerminal` alone, and the
      // check holds with colours on or off.
      const INJECTED = `${ESC}[2J`;
      // RAW output on purpose: `stripAnsi` would remove the injected escape and
      // make this assertion pass whether or not the code sanitizes.
      const raw = await runTestRaw([
        { bad: `${INJECTED}nothing matches here`, good: 'logger.info("x")' },
      ]);
      // The preview line is reached only on FAIL, which this pair is (bad silent).
      expect(stripAnsi(raw)).toContain('FAIL examples[0]');
      expect(stripAnsi(raw)).toContain('bad:');
      // The AUTHORED escape never reaches the terminal…
      expect(raw).not.toContain(INJECTED);
      // …while the visible text still does, so the preview stayed useful.
      expect(stripAnsi(raw)).toContain('nothing matches here');
    });

    it('verifies EVERY pair, not just the first', async () => {
      const output = await runTest([
        { bad: 'console.log(1)', good: 'logger.info(1)' },
        { bad: 'console.log(2)', good: 'logger.info(2)' },
        { bad: 'console.log(3)', good: 'logger.info(3)' },
      ]);
      expect(output).toContain('PASS examples[0]');
      expect(output).toContain('PASS examples[1]');
      expect(output).toContain('PASS examples[2]');
      expect(output).toContain('3 example pair(s) verified');
      expect(process.exitCode).toBeUndefined();
    });

    it('PASSES a `requires:`-bearing record — § Design 8 pass two (mmnto-ai/totem#2678)', async () => {
      // The end-to-end shape of the ticket: a § Design 8 record's `good` example
      // KEEPS the target and adds the companion. Before #2678 the smoke gate ran
      // pass one only, so `good` read as firing and `totem rule test` reported
      // FAIL for every `requires:`-bearing record. Scaffolded inline rather than
      // through `recordRule` because this rule needs a different target and the
      // `requires` block the shared helper does not carry.
      scaffold(tmpDir, [
        {
          lessonHash: RECORD_HASH,
          lessonHeading: 'git output-consuming commands must pin LC_ALL=C',
          pattern: '\\bgit\\s+(log|diff|status)\\b',
          message: 'git output-consuming commands must pin LC_ALL=C on the same line.',
          engine: 'regex',
          severity: 'warning',
          fileGlobs: ['**/*.sh', '**/*.cjs'],
          requires: { pattern: 'LC_ALL=C', scope: 'line' },
          // totem-context: inert rule-input fixture, never a git invocation (mmnto-ai/totem#2678)
          examples: [{ bad: 'git log --oneline', good: 'LC_ALL=C git log --oneline' }],
          compiledAt: '2026-08-24T00:00:00.000Z',
          createdAt: '2026-08-24T00:00:00.000Z',
        },
      ]);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { ruleTestCommand } = await import('./rule.js');
      await ruleTestCommand(RECORD_HASH);
      const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));

      expect(output).toContain('PASS examples[0]');
      expect(output).not.toContain('good fired');
      expect(process.exitCode).toBeUndefined();
    });
  });
});

describe('rule scaffold', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('generates fixture for a valid rule', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleScaffoldCommand } = await import('./rule.js');
    await ruleScaffoldCommand('efgh', {});

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Scaffolded fixture');

    const fixturePath = path.join(tmpDir, '.totem', 'tests', 'test-efgh5678efgh5678.md');
    expect(fs.existsSync(fixturePath)).toBe(true);

    const content = fs.readFileSync(fixturePath, 'utf-8');
    expect(content).toContain('rule: efgh5678efgh5678');
    expect(content).toContain('## Should fail');
    expect(content).toContain('## Should pass');
  });

  it('warns and skips when fixture already exists', async () => {
    const { totemDir } = scaffold(tmpDir, SAMPLE_RULES);
    const testsDir = path.join(totemDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });
    fs.writeFileSync(path.join(testsDir, 'test-efgh5678efgh5678.md'), 'existing', 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleScaffoldCommand } = await import('./rule.js');
    await ruleScaffoldCommand('efgh', {});

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('already exists');

    // File should NOT be overwritten
    expect(fs.readFileSync(path.join(testsDir, 'test-efgh5678efgh5678.md'), 'utf-8')).toBe(
      'existing',
    );
  });

  it('errors on unknown hash prefix', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleScaffoldCommand } = await import('./rule.js');
    await ruleScaffoldCommand('zzzz', {});

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain("No rule found matching 'zzzz'");
  });

  it('seeds fixture with Example Hit/Miss from lesson', async () => {
    const heading = 'Catch console log usage';
    const bodyAfterTags = [
      'Do not use console.log in production.',
      '',
      '**Pattern:** `console\\.log`',
      '**Example Hit:** `console.log("debug")`',
      '**Example Miss:** `logger.info("debug")`',
    ].join('\n');

    const realHash = await computeLessonHash(heading, bodyAfterTags);

    const rule = {
      lessonHash: realHash,
      lessonHeading: heading,
      pattern: 'console\\.log',
      message: 'Remove console.log statements',
      engine: 'regex',
      severity: 'error',
      compiledAt: '2026-01-01T00:00:00.000Z',
    };

    const { lessonsDir } = scaffold(tmpDir, [rule]);

    const lessonContent = [
      `## Lesson \u2014 ${heading}`,
      '',
      '**Tags:** best-practice',
      '',
      bodyAfterTags,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(lessonsDir, 'lesson-test.md'), lessonContent, 'utf-8');

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleScaffoldCommand } = await import('./rule.js');
    await ruleScaffoldCommand(realHash, {});

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Scaffolded fixture');

    const fixturePath = path.join(tmpDir, '.totem', 'tests', `test-${realHash}.md`);
    const content = fs.readFileSync(fixturePath, 'utf-8');
    expect(content).toContain('console.log("debug")');
    expect(content).toContain('logger.info("debug")');
  });

  it('writes to custom path with --out', async () => {
    scaffold(tmpDir, SAMPLE_RULES);
    const customPath = path.join(tmpDir, 'custom-fixture.md');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { ruleScaffoldCommand } = await import('./rule.js');
    await ruleScaffoldCommand('efgh', { out: customPath });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Scaffolded fixture');
    expect(fs.existsSync(customPath)).toBe(true);
  });
});

// ─── rule promote (ADR-089 zero-trust activation, mmnto-ai/totem#1581) ──

describe('rule promote', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    // Reset between tests so one test's error exit does not poison the next.
    // Without this the Node runtime keeps the last set exitCode and vitest
    // reports success-with-exit-1, failing CI even when all tests pass.
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
    // Restore exitCode so subsequent describe blocks and the vitest runner
    // itself exit cleanly (Shield finding on #1581 part 1 review).
    process.exitCode = 0;
  });

  /** Write a manifest alongside the rules file so the promote command can refresh it. */
  async function writeManifest(totemDir: string, rulesPath: string): Promise<void> {
    const { generateOutputHash } = await import('@mmnto/totem');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    // Derive rule_count from the file instead of hardcoding so the fixture
    // stays accurate when callers write multi-rule scenarios (CR nit review
    // on PR #1601).
    const parsedRules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as { rules?: unknown[] };
    const manifest = {
      version: 1 as const,
      compiled_at: '2026-04-20T12:00:00.000Z',
      model: 'test-model',
      input_hash: 'deadbeef'.repeat(8),
      output_hash: generateOutputHash(rulesPath),
      rule_count: parsedRules.rules?.length ?? 0,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }

  // ── Prop 310 § Design 1 — every manifest WRITER attests the record class ──
  it('refreshes records_hash on promote — the shipping writer reaches attestRecordsHash', async () => {
    // The wiring check the design asks for: not "the helper computes a hash", but
    // "the command that writes a manifest wrote THIS field". Without the call site
    // this manifest would keep no `records_hash` and verify-manifest would then
    // hard-FAIL "unattested file class" on a repo carrying records.
    const { attestRecordsHash } = await import('@mmnto/totem');
    const unverifiedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'bbbb2222bbbb2222',
      unverified: true,
    };
    const { totemDir } = scaffold(tmpDir, [unverifiedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);
    // A record on disk, so the attested value is NOT the empty-set constant and a
    // missing call site cannot coincidentally produce the right answer.
    const recordsDir = path.join(totemDir, 'rules');
    fs.mkdirSync(recordsDir, { recursive: true });
    fs.writeFileSync(path.join(recordsDir, 'x.rule.yaml'), 'schemaVersion: 1\n', 'utf-8');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('bbbb2222');

    const manifest = JSON.parse(
      fs.readFileSync(path.join(totemDir, 'compile-manifest.json'), 'utf-8'),
    ) as { records_hash?: string };
    expect(manifest.records_hash).toBe(attestRecordsHash(totemDir, tmpDir));
    expect(manifest.records_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('removes the unverified flag from a matching rule and refreshes the manifest', async () => {
    const unverifiedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'aaaa1111aaaa1111',
      unverified: true,
    };
    const { totemDir } = scaffold(tmpDir, [unverifiedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('aaaa');

    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as { rules: unknown[] };
    const promoted = rules.rules[0] as { unverified?: boolean; lessonHash: string };
    expect(promoted.unverified).toBeUndefined();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Promoted rule');
    expect(output).toContain('Manifest refreshed');
  });

  it('refreshes the manifest output_hash to match the mutated rules file', async () => {
    const { generateOutputHash } = await import('@mmnto/totem');
    const unverifiedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'bbbb2222bbbb2222',
      unverified: true,
    };
    const { totemDir } = scaffold(tmpDir, [unverifiedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    await writeManifest(totemDir, rulesPath);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('bbbb');

    const updatedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      output_hash: string;
    };
    const currentRulesHash = generateOutputHash(rulesPath);
    expect(updatedManifest.output_hash).toBe(currentRulesHash);
  });

  it('errors when no rule matches the prefix', async () => {
    const unverifiedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'cccc3333cccc3333',
      unverified: true,
    };
    const { totemDir } = scaffold(tmpDir, [unverifiedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('no-such-prefix');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No rule found');
    expect(process.exitCode).toBe(1);
  });

  it('errors with a disambiguation list when the prefix matches multiple rules', async () => {
    const { totemDir } = scaffold(tmpDir, [
      { ...SAMPLE_RULES[0]!, lessonHash: 'dddd4444aaaaaaaa', unverified: true },
      { ...SAMPLE_RULES[0]!, lessonHash: 'dddd4444bbbbbbbb', unverified: true },
    ]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('dddd4444');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Ambiguous');
    expect(output).toContain('matches 2 rules');
    expect(process.exitCode).toBe(1);
  });

  it('refuses to promote an archived rule', async () => {
    const archivedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'eeee5555eeee5555',
      unverified: true,
      status: 'archived',
      archivedReason: 'Test archive',
    };
    const { totemDir } = scaffold(tmpDir, [archivedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('eeee');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('archived');
    expect(output).toContain('Unarchive');
    expect(process.exitCode).toBe(1);
  });

  it('no-ops with a warning when the rule is already verified', async () => {
    const verifiedRule = {
      ...SAMPLE_RULES[0]!,
      lessonHash: 'ffff6666ffff6666',
      // No unverified field — canonical "verified" state.
    };
    const { totemDir } = scaffold(tmpDir, [verifiedRule]);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    await writeManifest(totemDir, rulesPath);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { rulePromoteCommand } = await import('./rule.js');
    await rulePromoteCommand('ffff');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('already verified');
    // Pin that the idempotent no-op does not set a failure exitCode.
    // Catches regressions where the warning path accidentally turns into
    // an error path (CR review on PR #1601).
    expect(process.exitCode ?? 0).toBe(0);
  });
});

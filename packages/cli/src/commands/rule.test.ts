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

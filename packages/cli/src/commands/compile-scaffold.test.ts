import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledRule, LessonInput } from '@mmnto/totem';
import {
  deriveVirtualFilePath,
  extractRuleExamples,
  parseFixture,
  scaffoldFixture,
  scaffoldFixturePath,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import type { AutoScaffoldDeps } from './compile.js';
import { autoScaffoldFixture } from './compile.js';

// ─── Helpers ─────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-scaffold-'));
}

function makeLesson(overrides: Partial<LessonInput> = {}): LessonInput {
  return {
    index: 0,
    heading: 'Never use eval()',
    body: [
      'Do not use eval in production code.',
      '',
      '**Pattern:** `\\beval\\s*\\(`',
      '**Engine:** regex',
      '**Severity:** error',
      '**Example Hit:** `eval("code")`',
      '**Example Miss:** `safeEval("code")`',
    ].join('\n'),
    hash: 'abcd1234abcd1234',
    ...overrides,
  };
}

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'abcd1234abcd1234',
    lessonHeading: 'Never use eval()',
    pattern: '\\beval\\s*\\(',
    message: 'Do not use eval()',
    engine: 'regex',
    severity: 'error',
    compiledAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeDeps(tmpDir: string, testedHashes?: Set<string>): AutoScaffoldDeps {
  const testsDir = path.join(tmpDir, '.totem', 'tests');
  return {
    fs,
    path,
    testsDir,
    cwd: tmpDir,
    testedHashes: testedHashes ?? new Set(),
    log: { info: vi.fn() },
    extractRuleExamples,
    deriveVirtualFilePath,
    scaffoldFixture,
    scaffoldFixturePath,
  };
}

// ─── Tests ──────────────────────────────────────────

describe('autoScaffoldFixture', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates a valid fixture file in testsDir', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    autoScaffoldFixture(lesson, rule, deps);

    const fixturePath = path.join(deps.testsDir, `test-${lesson.hash}.md`);
    expect(fs.existsSync(fixturePath)).toBe(true);

    const content = fs.readFileSync(fixturePath, 'utf-8');
    expect(content).toContain(`rule: ${lesson.hash}`);
    expect(content).toContain('## Should fail');
    expect(content).toContain('## Should pass');
  });

  it('produces a fixture that round-trips through parseFixture', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    autoScaffoldFixture(lesson, rule, deps);

    const fixturePath = path.join(deps.testsDir, `test-${lesson.hash}.md`);
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const fixture = parseFixture(content, fixturePath);

    expect(fixture).not.toBeNull();
    expect(fixture!.ruleHash).toBe(lesson.hash);
  });

  it('seeds fixture with Example Hit/Miss from lesson body', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    autoScaffoldFixture(lesson, rule, deps);

    const fixturePath = path.join(deps.testsDir, `test-${lesson.hash}.md`);
    const content = fs.readFileSync(fixturePath, 'utf-8');
    expect(content).toContain('eval("code")');
    expect(content).toContain('safeEval("code")');
  });

  it('adds the hash to testedHashes', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const testedHashes = new Set<string>();
    const deps = makeDeps(tmpDir, testedHashes);

    autoScaffoldFixture(lesson, rule, deps);

    expect(testedHashes.has(lesson.hash)).toBe(true);
  });

  it('uses TODO placeholders when no examples exist', () => {
    const lesson = makeLesson({ body: 'A lesson with no examples.' });
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    autoScaffoldFixture(lesson, rule, deps);

    const fixturePath = path.join(deps.testsDir, `test-${lesson.hash}.md`);
    const content = fs.readFileSync(fixturePath, 'utf-8');
    expect(content).toContain('// TODO: add code that should trigger this rule');
    expect(content).toContain('// TODO: add code that should NOT trigger this rule');
  });

  it('creates testsDir if it does not exist', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    expect(fs.existsSync(deps.testsDir)).toBe(false);
    autoScaffoldFixture(lesson, rule, deps);
    expect(fs.existsSync(deps.testsDir)).toBe(true);
  });

  it('logs the scaffold action', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    autoScaffoldFixture(lesson, rule, deps);

    expect(deps.log.info).toHaveBeenCalledWith(
      'Compile',
      expect.stringContaining('Auto-scaffolded test fixture'),
    );
  });

  it('returns true on success', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    expect(autoScaffoldFixture(lesson, rule, deps)).toBe(true);
  });

  it('returns false and logs on fs failure', () => {
    const lesson = makeLesson();
    const rule = makeRule();
    const deps = makeDeps(tmpDir);

    // Force mkdirSync to throw
    deps.fs = {
      ...fs,
      mkdirSync: () => {
        throw new Error('disk full');
      },
    } as typeof fs;

    expect(autoScaffoldFixture(lesson, rule, deps)).toBe(false);
    expect(deps.log.info).toHaveBeenCalledWith(
      'Compile',
      expect.stringContaining('Failed to scaffold fixture'),
    );
  });
});

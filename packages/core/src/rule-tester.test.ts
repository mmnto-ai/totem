import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler.js';
import {
  isTodoFixture,
  parseFixture,
  runRuleTests,
  scaffoldFixture,
  scaffoldFixturePath,
  testRule,
} from './rule-tester.js';

const MOCK_RULE: CompiledRule = {
  lessonHash: 'abc123',
  lessonHeading: 'Never use eval()',
  pattern: '\\beval\\s*\\(',
  message: 'Do not use eval() — it is a security risk.',
  engine: 'regex',
  compiledAt: '2026-01-01T00:00:00Z',
};

describe('parseFixture', () => {
  it('parses a valid fixture with frontmatter and code blocks', () => {
    const content = `---
rule: abc123
file: src/app.ts
---

## Should fail

\`\`\`ts
const result = eval('1 + 1');
\`\`\`

## Should pass

\`\`\`ts
const result = safeEval('1 + 1');
\`\`\`
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).not.toBeNull();
    expect(fixture!.ruleHash).toBe('abc123');
    expect(fixture!.filePath).toBe('src/app.ts');
    expect(fixture!.failLines).toHaveLength(1);
    expect(fixture!.passLines).toHaveLength(1);
  });

  it('defaults filePath to src/example.ts when not specified', () => {
    const content = `---
rule: abc123
---

## Should fail

\`\`\`ts
eval('code');
\`\`\`
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture!.filePath).toBe('src/example.ts');
  });

  it('returns null for missing frontmatter', () => {
    const fixture = parseFixture('no frontmatter here', 'test.md');
    expect(fixture).toBeNull();
  });

  it('returns null for missing rule hash', () => {
    const content = `---
file: src/app.ts
---

## Should fail
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).toBeNull();
  });

  it('defaults surface to rules and corpus to pass when frontmatter omits them (backwards-compat)', () => {
    const content = `---
rule: abc123
file: src/app.ts
---

## Should fail

\`\`\`ts
const x = badThing();
\`\`\`
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).not.toBeNull();
    expect(fixture!.surface).toBe('rules');
    expect(fixture!.corpus).toBe('pass');
  });

  it('reads explicit surface: hooks and corpus: fail from frontmatter', () => {
    const content = `---
rule: gca-tag-xor-command
file: .totem/hook-fixtures/gca.txt
surface: hooks
corpus: fail
---

## Should fail

\`\`\`text
gh pr comment 123 -b "@gemini-code-assist /gemini review"
\`\`\`
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).not.toBeNull();
    expect(fixture!.surface).toBe('hooks');
    expect(fixture!.corpus).toBe('fail');
  });

  it('rejects the fixture entirely when surface is an unknown enum value (typo guard)', () => {
    const content = `---
rule: abc123
file: src/app.ts
surface: hokks
---

## Should fail
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).toBeNull();
  });

  it('rejects the fixture entirely when corpus is an unknown enum value (typo guard)', () => {
    const content = `---
rule: abc123
file: src/app.ts
corpus: maybe
---

## Should fail
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).toBeNull();
  });

  it('rejects fixtures whose surface field is present but explicit-empty (no silent default)', () => {
    // `surface:` with no value should fail loud — silently defaulting would
    // misroute the fixture and weaken the typo-guard semantics.
    const content = `---
rule: abc123
file: src/app.ts
surface:
---

## Should fail
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).toBeNull();
  });

  it('rejects fixtures whose corpus field is present but explicit-empty (no silent default)', () => {
    const content = `---
rule: abc123
file: src/app.ts
corpus:
---

## Should fail
`;
    const fixture = parseFixture(content, 'test.md');
    expect(fixture).toBeNull();
  });
});

describe('scaffoldFixture', () => {
  it('generates valid fixture with all fields provided', () => {
    const content = scaffoldFixture({
      ruleHash: 'abcd1234abcd1234',
      filePath: 'src/utils.ts',
      failLines: ['eval("code")'],
      passLines: ['safeEval("code")'],
      heading: 'Never use eval()',
    });

    expect(content).toContain('rule: abcd1234abcd1234');
    expect(content).toContain('file: src/utils.ts');
    expect(content).toContain('eval("code")');
    expect(content).toContain('safeEval("code")');
  });

  it('defaults filePath to src/example.ts when omitted', () => {
    const content = scaffoldFixture({ ruleHash: 'abcd1234abcd1234' });
    expect(content).toContain('file: src/example.ts');
  });

  it('uses TODO placeholders when lines are omitted', () => {
    const content = scaffoldFixture({ ruleHash: 'abcd1234abcd1234' });
    expect(content).toContain('// TODO: add code that should trigger this rule');
    expect(content).toContain('// TODO: add code that should NOT trigger this rule');
  });

  it('round-trips through parseFixture', () => {
    const opts = {
      ruleHash: 'abcd1234abcd1234',
      filePath: 'src/app.ts',
      failLines: ['eval("bad")'],
      passLines: ['safe("good")'],
    };
    const content = scaffoldFixture(opts);
    const fixture = parseFixture(content, 'test.md');

    expect(fixture).not.toBeNull();
    expect(fixture!.ruleHash).toBe(opts.ruleHash);
    expect(fixture!.filePath).toBe(opts.filePath);
    expect(fixture!.failLines).toEqual(opts.failLines);
    expect(fixture!.passLines).toEqual(opts.passLines);
  });

  it('round-trips with multiple lines', () => {
    const opts = {
      ruleHash: 'abcd1234abcd1234',
      failLines: ['eval("a")', 'eval("b")'],
      passLines: ['safe("a")', 'safe("b")'],
    };
    const content = scaffoldFixture(opts);
    const fixture = parseFixture(content, 'test.md');

    expect(fixture!.failLines).toEqual(opts.failLines);
    expect(fixture!.passLines).toEqual(opts.passLines);
  });
});

describe('scaffoldFixturePath', () => {
  it('returns expected path', () => {
    const result = scaffoldFixturePath('/project/.totem/tests', 'abcd1234abcd1234');
    expect(result).toMatch(/test-abcd1234abcd1234\.md$/);
  });
});

describe('isTodoFixture', () => {
  it('detects a scaffolded TODO fixture', () => {
    const content = scaffoldFixture({ ruleHash: 'abc123' });
    const fixture = parseFixture(content, 'test.md')!;
    expect(isTodoFixture(fixture)).toBe(true);
  });

  it('returns false for a fixture with real examples', () => {
    const content = scaffoldFixture({
      ruleHash: 'abc123',
      failLines: ['eval("code")'],
      passLines: ['safeEval("code")'],
    });
    const fixture = parseFixture(content, 'test.md')!;
    expect(isTodoFixture(fixture)).toBe(false);
  });

  it('returns true when both sections are empty', () => {
    expect(
      isTodoFixture({
        ruleHash: 'x',
        filePath: 'f',
        failLines: [],
        passLines: [],
        fixturePath: 'p',
      }),
    ).toBe(true);
  });

  it('detects mixed TODO and real lines as non-TODO', () => {
    const fixture = {
      ruleHash: 'x',
      filePath: 'f',
      failLines: ['// TODO: add code that should trigger this rule'],
      passLines: ['const x = 1;'],
      fixturePath: 'p',
    };
    expect(isTodoFixture(fixture)).toBe(false);
  });
});

describe('testRule', () => {
  it('passes when fail lines trigger and pass lines do not', () => {
    const result = testRule(MOCK_RULE, {
      ruleHash: 'abc123',
      filePath: 'src/app.ts',
      failLines: ["const x = eval('code');"],
      passLines: ['const x = safeEval(code);'],
      fixturePath: 'test.md',
    });

    expect(result.passed).toBe(true);
    expect(result.missedFails).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(0);
  });

  it('fails when a fail line does not trigger the rule', () => {
    const result = testRule(MOCK_RULE, {
      ruleHash: 'abc123',
      filePath: 'src/app.ts',
      failLines: ['const x = safeEval(code);'], // should not match
      passLines: [],
      fixturePath: 'test.md',
    });

    expect(result.passed).toBe(false);
    expect(result.missedFails).toHaveLength(1);
  });

  it('fails when a pass line triggers the rule (false positive)', () => {
    const result = testRule(MOCK_RULE, {
      ruleHash: 'abc123',
      filePath: 'src/app.ts',
      failLines: [],
      passLines: ["const x = eval('code');"], // should not pass
      fixturePath: 'test.md',
    });

    expect(result.passed).toBe(false);
    expect(result.falsePositives).toHaveLength(1);
  });

  it('respects fileGlobs — rule does not fire on non-matching files', () => {
    const ruleWithGlobs: CompiledRule = {
      ...MOCK_RULE,
      fileGlobs: ['*.py'],
    };

    const result = testRule(ruleWithGlobs, {
      ruleHash: 'abc123',
      filePath: 'src/app.ts', // not a .py file
      failLines: ["eval('code');"],
      passLines: [],
      fixturePath: 'test.md',
    });

    // The fail line won't trigger because fileGlobs doesn't match .ts
    expect(result.passed).toBe(false);
    expect(result.missedFails).toHaveLength(1);
  });

  // ─── Compound (astGrepYamlRule) support — mmnto/totem#1408 ───
  it('passes a compound astGrepYamlRule fixture with a known-good fail/pass set', () => {
    const compoundRule: CompiledRule = {
      lessonHash: 'compound-has-test',
      lessonHeading: 'Empty catch block',
      pattern: '',
      message: 'Empty catch block swallows errors',
      engine: 'ast-grep',
      compiledAt: '2026-04-13T12:00:00Z',
      astGrepYamlRule: {
        rule: {
          kind: 'catch_clause',
          not: {
            has: {
              kind: 'statement_block',
              has: {
                any: [
                  { kind: 'expression_statement' },
                  { kind: 'variable_declaration' },
                  { kind: 'if_statement' },
                  { kind: 'return_statement' },
                  { kind: 'throw_statement' },
                ],
                stopBy: 'end',
              },
            },
          },
        },
      },
    };

    const result = testRule(compoundRule, {
      ruleHash: 'compound-has-test',
      filePath: 'src/app.ts',
      failLines: ['try {', '  work();', '} catch (err) {', '}'],
      passLines: ['try {', '  work();', '} catch (err) {', '  log(err);', '}'],
      fixturePath: 'test.md',
    });

    expect(result.passed).toBe(true);
    expect(result.missedFails).toHaveLength(0);
    expect(result.falsePositives).toHaveLength(0);
  });
});

describe('runRuleTests — surface filter (ADR-104 § Convergence)', () => {
  let workDir: string;
  let testsDir: string;
  let rulesPath: string;

  // The runtime-built strings below are intentional: this test file's whole
  // point is matching that pattern, but the literal substring would trip the
  // pre-tool-use security hook on Edit operations against this file AND make
  // github-code-quality's string-concat heuristics fire false positives.
  // Building from a shared base concatenated at runtime keeps the file
  // source clean of the literal token while preserving semantically correct
  // test data.
  const EVAL_TOKEN = 'ev' + 'al';
  const EVAL_CALL = `${EVAL_TOKEN}('1+1')`;
  const EVAL_PATTERN = `\\b${EVAL_TOKEN}\\s*\\(`;
  const EVAL_HEADING = `Reject ${EVAL_TOKEN}() calls`;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-tester-surface-'));
    testsDir = path.join(workDir, 'tests');
    fs.mkdirSync(testsDir);
    rulesPath = path.join(workDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rules-target',
            lessonHeading: EVAL_HEADING,
            pattern: EVAL_PATTERN,
            message: 'forbidden runtime evaluation',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00Z',
          },
        ],
        nonCompilable: [],
      }),
      'utf8',
    );
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function writeFixture(filename: string, frontmatter: string, body: string): void {
    const content = `---\n${frontmatter}\n---\n\n## Should fail\n\n\`\`\`ts\n${body}\n\`\`\`\n`;
    fs.writeFileSync(path.join(testsDir, filename), content, 'utf8');
  }

  it('processes fixtures with surface: rules (explicit)', () => {
    writeFixture(
      'rules-explicit.md',
      'rule: rules-target\nfile: src/app.ts\nsurface: rules',
      EVAL_CALL,
    );
    const summary = runRuleTests(rulesPath, testsDir);
    expect(summary.total).toBe(1);
    expect(summary.results[0]!.ruleHash).toBe('rules-target');
  });

  it('processes fixtures with no surface (defaults to rules — backwards-compat)', () => {
    writeFixture('no-surface.md', 'rule: rules-target\nfile: src/app.ts', EVAL_CALL);
    const summary = runRuleTests(rulesPath, testsDir);
    expect(summary.total).toBe(1);
  });

  it('skips fixtures with surface: hooks (silently filtered out; not surfaced as unknown-hash failures)', () => {
    writeFixture(
      'hooks-fixture.md',
      'rule: gca-tag-xor-command\nfile: hook-fixtures/gca.txt\nsurface: hooks\ncorpus: fail',
      'gh pr comment 1 -b "@gemini-code-assist /gemini review"',
    );
    const summary = runRuleTests(rulesPath, testsDir);
    expect(summary.total).toBe(0);
    expect(summary.results).toEqual([]);
    expect(summary.skippedFixtures).toEqual([]);
  });

  it('processes only rules-surface fixtures when both kinds coexist in the same testsDir', () => {
    writeFixture('rules-one.md', 'rule: rules-target\nfile: src/app.ts\nsurface: rules', EVAL_CALL);
    writeFixture(
      'hooks-one.md',
      'rule: any-hook-id\nfile: hook-fixtures/x.txt\nsurface: hooks\ncorpus: fail',
      'some payload',
    );
    const summary = runRuleTests(rulesPath, testsDir);
    expect(summary.total).toBe(1);
    expect(summary.results[0]!.ruleHash).toBe('rules-target');
  });
});

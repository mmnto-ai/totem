import { describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler.js';
import {
  isTodoFixture,
  parseFixture,
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
});

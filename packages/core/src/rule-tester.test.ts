import { describe, expect, it } from 'vitest';

import type { CompiledRule } from './compiler.js';
import { parseFixture, testRule } from './rule-tester.js';

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

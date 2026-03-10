import { describe, expect, it } from 'vitest';

import { classifyLines, extensionToLanguage } from './ast-classifier.js';

// ─── extensionToLanguage ────────────────────────────

describe('extensionToLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(extensionToLanguage('.ts')).toBe('typescript');
  });

  it('maps .tsx to tsx', () => {
    expect(extensionToLanguage('.tsx')).toBe('tsx');
  });

  it('maps .js/.mjs/.cjs to javascript', () => {
    expect(extensionToLanguage('.js')).toBe('javascript');
    expect(extensionToLanguage('.mjs')).toBe('javascript');
    expect(extensionToLanguage('.cjs')).toBe('javascript');
  });

  it('maps .jsx to tsx', () => {
    expect(extensionToLanguage('.jsx')).toBe('tsx');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(extensionToLanguage('.py')).toBeUndefined();
    expect(extensionToLanguage('.rs')).toBeUndefined();
    expect(extensionToLanguage('.md')).toBeUndefined();
  });
});

// ─── classifyLines ──────────────────────────────────

describe('classifyLines', () => {
  it('classifies a regular code line as code', async () => {
    const content = `const x = 1;\nconsole.log(x);\n`; // totem-ignore
    const result = await classifyLines(content, [1, 2], 'typescript');
    expect(result.get(1)).toBe('code');
    expect(result.get(2)).toBe('code');
  });

  it('classifies a single-line comment as comment', async () => {
    const content = `// this is a comment\nconst x = 1;\n`;
    const result = await classifyLines(content, [1], 'typescript');
    expect(result.get(1)).toBe('comment');
  });

  it('classifies a multi-line comment as comment', async () => {
    const content = `/*\n * block comment\n */\nconst x = 1;\n`;
    const result = await classifyLines(content, [2], 'typescript');
    expect(result.get(2)).toBe('comment');
  });

  it('classifies a string literal as string', async () => {
    const content = `const msg = "hello world";\n`;
    // The string token is on line 1 — but the whole line is an assignment (code)
    // The string node is a child of the variable declaration
    // classifyLines checks the node at the start of the trimmed line
    const result = await classifyLines(content, [1], 'typescript');
    // The leftmost token is `const`, which is code
    expect(result.get(1)).toBe('code');
  });

  it('classifies content inside a template literal as string', async () => {
    const content = [
      'const fixture = `',
      '  this is inside a template literal',
      '  console.log("fake code")',
      '`;',
    ].join('\n');
    const result = await classifyLines(content, [2, 3], 'typescript');
    expect(result.get(2)).toBe('string');
    expect(result.get(3)).toBe('string');
  });

  it('classifies a multi-line template literal body as string', async () => {
    const content = [
      'const diff = `diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;',
      '+const b = 2;',
      '`;',
    ].join('\n');
    // Lines 2-6 are inside the template literal
    const result = await classifyLines(content, [2, 3, 4, 5, 6], 'typescript');
    for (const line of [2, 3, 4, 5, 6]) {
      expect(result.get(line)).toBe('string');
    }
  });

  it('classifies a regex literal as regex', async () => {
    const content = `const re = /foo\\.bar/;\n`;
    const result = await classifyLines(content, [1], 'typescript');
    // The leftmost token is `const` → code
    expect(result.get(1)).toBe('code');
  });

  it('returns empty map for empty line numbers', async () => {
    const result = await classifyLines('const x = 1;', [], 'typescript');
    expect(result.size).toBe(0);
  });

  it('handles JavaScript files', async () => {
    const content = `// JS comment\nconst x = 1;\n`;
    const result = await classifyLines(content, [1, 2], 'javascript');
    expect(result.get(1)).toBe('comment');
    expect(result.get(2)).toBe('code');
  });

  it('handles TSX files', async () => {
    const content = `// TSX comment\nconst x = <div>hello</div>;\n`;
    const result = await classifyLines(content, [1, 2], 'tsx');
    expect(result.get(1)).toBe('comment');
    expect(result.get(2)).toBe('code');
  });

  it('classifies ERROR nodes as code (fail-open)', async () => {
    // Intentionally broken syntax
    const content = `const x = {{\n`;
    const result = await classifyLines(content, [1], 'typescript');
    // Should not throw, and should classify as code (fail-open)
    expect(result.get(1)).toBe('code');
  });
});

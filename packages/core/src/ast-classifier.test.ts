import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetLangRegistryForTests,
  __unsealLangRegistryForTests,
  classifyLines,
  extensionToLanguage,
  isBuiltinExtension,
  isLangRegistrySealed,
  registeredExtensions,
  registeredLanguages,
  registerLang,
  sealLangRegistry,
} from './ast-classifier.js';

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

  it('normalizes extension case before lookup', () => {
    expect(extensionToLanguage('.TS')).toBe('typescript');
    expect(extensionToLanguage('.Tsx')).toBe('tsx');
  });
});

// ─── Language registry surface (mmnto-ai/totem#1653 + #1768) ──

describe('language registry built-ins', () => {
  it('exposes all six built-in extensions from registeredExtensions()', () => {
    expect(registeredExtensions()).toEqual(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
  });

  it('exposes all three built-in languages from registeredLanguages()', () => {
    expect(registeredLanguages()).toEqual(['javascript', 'tsx', 'typescript']);
  });

  it('marks built-in extensions as built-in', () => {
    expect(isBuiltinExtension('.ts')).toBe(true);
    expect(isBuiltinExtension('.tsx')).toBe(true);
    expect(isBuiltinExtension('.rs')).toBe(false);
  });
});

describe('language registry pack-style registration', () => {
  afterEach(() => {
    __resetLangRegistryForTests();
  });

  it('accepts new (extension, language, loader) registration before seal', () => {
    const fakeLoader = () => '/fake/path/tree-sitter-fakelang.wasm';
    registerLang('.fake', 'fakelang', fakeLoader);
    expect(extensionToLanguage('.fake')).toBe('fakelang');
    expect(registeredExtensions()).toContain('.fake');
    expect(registeredLanguages()).toContain('fakelang');
  });

  it('does not mark pack-registered extensions as built-in', () => {
    registerLang('.fake', 'fakelang', () => '/fake.wasm');
    expect(isBuiltinExtension('.fake')).toBe(false);
  });

  it('throws when re-registering an extension to a different language (pack-vs-pack)', () => {
    registerLang('.fake', 'fakelang', () => '/fake.wasm');
    expect(() => registerLang('.fake', 'differentlang', () => '/other.wasm')).toThrowError(
      /already registered to language 'fakelang'.*pack-vs-pack collision/,
    );
  });

  it('throws when registering a built-in extension (immutable)', () => {
    expect(() => registerLang('.ts', 'newlang', () => '/x.wasm')).toThrowError(
      /already registered to language 'typescript'.*as a built-in.*immutable/,
    );
  });

  it('throws when registering an already-registered language with a different loader', () => {
    const loader1 = () => '/path1.wasm';
    const loader2 = () => '/path2.wasm';
    registerLang('.fake', 'fakelang', loader1);
    expect(() => registerLang('.also-fake', 'fakelang', loader2)).toThrowError(
      /Language 'fakelang' is already registered/,
    );
  });

  it('allows multiple extensions to register to the same language with the same loader', () => {
    const sharedLoader = () => '/shared.wasm';
    registerLang('.fake1', 'fakelang', sharedLoader);
    registerLang('.fake2', 'fakelang', sharedLoader);
    expect(extensionToLanguage('.fake1')).toBe('fakelang');
    expect(extensionToLanguage('.fake2')).toBe('fakelang');
  });
});

describe('language registry seal contract', () => {
  afterEach(() => {
    __resetLangRegistryForTests();
  });

  it('starts unsealed', () => {
    expect(isLangRegistrySealed()).toBe(false);
  });

  it('sealLangRegistry() flips the flag', () => {
    sealLangRegistry();
    expect(isLangRegistrySealed()).toBe(true);
  });

  it('registerLang() after seal throws with ADR-097 § 5 Q5 reference', () => {
    sealLangRegistry();
    expect(() => registerLang('.fake', 'fakelang', () => '/f.wasm')).toThrowError(
      /after engine seal.*ADR-097 § 5 Q5/,
    );
  });

  it('__unsealLangRegistryForTests reverts the seal so subsequent tests can register', () => {
    sealLangRegistry();
    expect(isLangRegistrySealed()).toBe(true);
    __unsealLangRegistryForTests();
    expect(isLangRegistrySealed()).toBe(false);
    registerLang('.fake', 'fakelang', () => '/f.wasm');
    expect(extensionToLanguage('.fake')).toBe('fakelang');
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

  it('correctly classifies lines in files larger than 32KB (#354)', async () => {
    // Generate a valid TypeScript file well over 32KB.
    // Strategy: emit many exported functions, each with a block comment,
    // a string literal line, and a code line. Track which line numbers
    // correspond to which classification.
    const lines: string[] = [];

    // Track line numbers (1-based) for assertions
    const codeLines: number[] = [];
    const commentLines: number[] = [];
    const stringLines: number[] = [];

    const functionCount = 300; // ~110 bytes per function → ~33KB+

    for (let i = 0; i < functionCount; i++) {
      // Block comment (2 lines)
      const commentStart = lines.length + 1;
      lines.push(`/** Documentation for function_${i} */`);
      commentLines.push(commentStart);

      // Function declaration (code line)
      const fnLine = lines.length + 1;
      lines.push(`export function function_${i}(): string {`);
      codeLines.push(fnLine);

      // String literal return (the line starts with `return` — leftmost token is code,
      // but the string itself is on a separate continuation line for a cleaner test)
      lines.push(`  const value =`);
      const strLine = lines.length + 1;
      lines.push(`    "padding_${i}_${'x'.repeat(40)}";`);
      // leftmost token on strLine is the opening quote → string
      stringLines.push(strLine);

      // Return + close brace (code lines)
      lines.push(`  return value;`);
      lines.push(`}`);
      lines.push('');
    }

    const content = lines.join('\n');
    const sizeKB = Buffer.byteLength(content, 'utf-8') / 1024;

    // Sanity: confirm the file is actually >32KB
    expect(sizeKB).toBeGreaterThan(32);

    // Pick lines from the beginning, middle, and end of the file
    const pickFromBeginning = {
      code: codeLines[0],
      comment: commentLines[0],
      string: stringLines[0],
    };
    const midIdx = Math.floor(functionCount / 2);
    const pickFromMiddle = {
      code: codeLines[midIdx],
      comment: commentLines[midIdx],
      string: stringLines[midIdx],
    };
    const pickFromEnd = {
      code: codeLines[functionCount - 1],
      comment: commentLines[functionCount - 1],
      string: stringLines[functionCount - 1],
    };

    const allLineNumbers = [
      pickFromBeginning.code,
      pickFromBeginning.comment,
      pickFromBeginning.string,
      pickFromMiddle.code,
      pickFromMiddle.comment,
      pickFromMiddle.string,
      pickFromEnd.code,
      pickFromEnd.comment,
      pickFromEnd.string,
    ];

    const result = await classifyLines(content, allLineNumbers, 'typescript');

    // Verify the map has entries for all requested lines (parse did not silently fail)
    expect(result.size).toBe(allLineNumbers.length);

    // Beginning of file
    expect(result.get(pickFromBeginning.code)).toBe('code');
    expect(result.get(pickFromBeginning.comment)).toBe('comment');
    expect(result.get(pickFromBeginning.string)).toBe('string');

    // Middle of file (past the 32KB boundary)
    expect(result.get(pickFromMiddle.code)).toBe('code');
    expect(result.get(pickFromMiddle.comment)).toBe('comment');
    expect(result.get(pickFromMiddle.string)).toBe('string');

    // End of file
    expect(result.get(pickFromEnd.code)).toBe('code');
    expect(result.get(pickFromEnd.comment)).toBe('comment');
    expect(result.get(pickFromEnd.string)).toBe('string');
  });
});

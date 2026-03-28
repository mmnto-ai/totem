import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enrichWithAstContext } from './ast-gate.js';
import type { DiffAddition } from './compiler.js';

// ─── enrichWithAstContext ───────────────────────────

describe('enrichWithAstContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ast-gate-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies code lines in a TypeScript file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      ['const x = 1;', 'console.log(x);', '// a comment'].join('\n'), // totem-ignore
    );

    const additions: DiffAddition[] = [
      { file: 'src/app.ts', line: 'const x = 1;', lineNumber: 1, precedingLine: null },
      { file: 'src/app.ts', line: 'console.log(x);', lineNumber: 2, precedingLine: 'const x = 1;' }, // totem-ignore
      { file: 'src/app.ts', line: '// a comment', lineNumber: 3, precedingLine: 'console.log(x);' }, // totem-ignore
    ];

    await enrichWithAstContext(additions, { cwd: tmpDir });

    expect(additions[0]!.astContext).toBe('code');
    expect(additions[1]!.astContext).toBe('code');
    expect(additions[2]!.astContext).toBe('comment');
  });

  it('classifies template literal content as string', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'test.ts'),
      ['const fixture = `', '  console.log("inside template");', '  debugger;', '`;'].join('\n'), // totem-ignore
    );

    const additions: DiffAddition[] = [
      {
        file: 'src/test.ts',
        line: '  console.log("inside template");', // totem-ignore
        lineNumber: 2,
        precedingLine: null,
      },
      {
        file: 'src/test.ts',
        line: '  debugger;',
        lineNumber: 3,
        precedingLine: '  console.log("inside template");', // totem-ignore
      },
    ];

    await enrichWithAstContext(additions, { cwd: tmpDir });

    expect(additions[0]!.astContext).toBe('string');
    expect(additions[1]!.astContext).toBe('string');
  });

  it('leaves unsupported file types unclassified (fail-open)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'style.css'), 'body { color: red; }');

    const additions: DiffAddition[] = [
      { file: 'src/style.css', line: 'body { color: red; }', lineNumber: 1, precedingLine: null },
    ];

    await enrichWithAstContext(additions, { cwd: tmpDir });

    expect(additions[0]!.astContext).toBeUndefined();
  });

  it('leaves unreadable files unclassified (fail-open)', async () => {
    const warnings: string[] = [];
    const additions: DiffAddition[] = [
      { file: 'src/missing.ts', line: 'const x = 1;', lineNumber: 1, precedingLine: null },
    ];

    await enrichWithAstContext(additions, {
      cwd: tmpDir,
      onWarn: (msg) => warnings.push(msg),
    });

    expect(additions[0]!.astContext).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0); // totem-ignore
  });

  it('handles mixed file types in one batch', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), '// comment line\nconst x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'config.json'), '{ "key": "value" }');

    const additions: DiffAddition[] = [
      { file: 'src/app.ts', line: '// comment line', lineNumber: 1, precedingLine: null },
      { file: 'src/app.ts', line: 'const x = 1;', lineNumber: 2, precedingLine: '// comment line' },
      { file: 'src/config.json', line: '{ "key": "value" }', lineNumber: 1, precedingLine: null },
    ];

    await enrichWithAstContext(additions, { cwd: tmpDir });

    expect(additions[0]!.astContext).toBe('comment');
    expect(additions[1]!.astContext).toBe('code');
    expect(additions[2]!.astContext).toBeUndefined(); // JSON not supported
  });

  it('rejects path traversal attempts (fail-open)', async () => {
    const warnings: string[] = [];
    const additions: DiffAddition[] = [
      { file: '../../../etc/passwd.ts', line: 'root:x:0:0', lineNumber: 1, precedingLine: null },
    ];

    await enrichWithAstContext(additions, {
      cwd: tmpDir,
      onWarn: (msg) => warnings.push(msg),
    });

    expect(additions[0]!.astContext).toBeUndefined();
    expect(warnings.some((w) => w.includes('escapes project root'))).toBe(true);
  });
});

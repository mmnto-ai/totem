import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchAstQuery } from './ast-query.js';

// ─── Helpers ────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ast-query-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return name;
}

// ─── matchAstQuery ──────────────────────────────────

describe('matchAstQuery', () => {
  it('matches a valid S-expression query against code', async () => {
    const file = writeFile(
      'src/app.ts',
      ['const x = 1;', 'console.log(x);', 'const y = 2;'].join('\n'),
    );

    // Query to find console.log calls — match member_expression with console.log
    const query =
      '(call_expression function: (member_expression object: (identifier) @obj (#eq? @obj "console"))) @violation';

    const matches = await matchAstQuery(file, query, [2], tmpDir);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lineNumber).toBe(2);
    expect(matches[0]!.lineText).toContain('console.log');
  });

  it('filters matches to only added lines', async () => {
    const file = writeFile(
      'src/multi.ts',
      ['console.log("line 1");', 'const x = 1;', 'console.log("line 3");'].join('\n'),
    );

    const query =
      '(call_expression function: (member_expression object: (identifier) @obj (#eq? @obj "console"))) @violation';

    // Only line 3 is "added"
    const matches = await matchAstQuery(file, query, [3], tmpDir);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lineNumber).toBe(3);
  });

  it('returns empty array for invalid S-expression (fail-open)', async () => {
    const file = writeFile('src/safe.ts', 'const x = 1;\n');

    const matches = await matchAstQuery(file, '(this is not valid!!!', [1], tmpDir);
    expect(matches).toEqual([]);
  });

  it('returns empty array for non-JS/TS files', async () => {
    const file = writeFile('config.py', 'import os\nprint("hello")\n');

    const query = '(identifier) @violation';
    const matches = await matchAstQuery(file, query, [1, 2], tmpDir);
    expect(matches).toEqual([]);
  });

  it('returns empty array when no added lines overlap with matches', async () => {
    const file = writeFile(
      'src/no-overlap.ts',
      ['console.log("line 1");', 'const x = 1;', 'const y = 2;'].join('\n'),
    );

    const query =
      '(call_expression function: (member_expression object: (identifier) @obj (#eq? @obj "console"))) @violation';

    // Lines 2 and 3 are "added" but console.log is on line 1
    const matches = await matchAstQuery(file, query, [2, 3], tmpDir);
    expect(matches).toEqual([]);
  });

  it('returns empty array for nonexistent file', async () => {
    const matches = await matchAstQuery('nonexistent.ts', '(identifier) @violation', [1], tmpDir);
    expect(matches).toEqual([]);
  });

  it('returns empty array for empty addedLineNumbers', async () => {
    const file = writeFile('src/empty.ts', 'const x = 1;\n');
    const matches = await matchAstQuery(file, '(identifier) @violation', [], tmpDir);
    expect(matches).toEqual([]);
  });

  it('handles JavaScript files', async () => {
    const file = writeFile('src/app.js', ['const x = 1;', 'console.log(x);'].join('\n'));

    const query =
      '(call_expression function: (member_expression object: (identifier) @obj (#eq? @obj "console"))) @violation';

    const matches = await matchAstQuery(file, query, [2], tmpDir);
    expect(matches).toHaveLength(1);
  });

  it('handles TSX files', async () => {
    const file = writeFile(
      'src/component.tsx',
      ['const x = 1;', 'console.log(x);', 'const el = <div>hello</div>;'].join('\n'),
    );

    const query =
      '(call_expression function: (member_expression object: (identifier) @obj (#eq? @obj "console"))) @violation';

    const matches = await matchAstQuery(file, query, [2], tmpDir);
    expect(matches).toHaveLength(1);
  });
});

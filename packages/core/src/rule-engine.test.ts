import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompiledRule, DiffAddition } from './compiler-schema.js';
import { TotemParseError } from './errors.js';
import { applyAstRulesToAdditions } from './rule-engine.js';

// ─── Helpers ────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-engine-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeRule(overrides: Partial<CompiledRule>): CompiledRule {
  return {
    lessonHash: 'deadbeef12345678',
    lessonHeading: 'Test rule',
    pattern: '.*',
    message: 'Test violation',
    engine: 'regex',
    compiledAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAddition(file: string, line: string, lineNumber: number): DiffAddition {
  return { file, line, lineNumber, precedingLine: null };
}

// ─── Error propagation (fail-closed) ────────────────

describe('applyAstRulesToAdditions', () => {
  it('propagates tree-sitter query errors instead of swallowing them (fail-closed)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'const x = 1;\n');

    const rule = makeRule({
      engine: 'ast',
      astQuery: '(this is not valid S-expression!!!',
    });

    const additions = [makeAddition('src/app.ts', 'const x = 1;', 1)];

    await expect(applyAstRulesToAdditions([rule], additions, tmpDir)).rejects.toThrow(
      TotemParseError,
    );
  });

  it('propagates ast-grep query errors instead of swallowing them (fail-closed)', async () => {
    const filePath = path.join(tmpDir, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'const x = 1;\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: { rule: { kind: '!!!INVALID_NODE_KIND!!!' } },
    });

    const additions = [makeAddition('src/app.ts', 'const x = 1;', 1)];

    await expect(applyAstRulesToAdditions([rule], additions, tmpDir)).rejects.toThrow(
      TotemParseError,
    );
  });

  it('still returns violations for valid AST rules (regression check)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'console.log("hello");\nconst x = 1;\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log($$$)',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("hello");', 1)];

    const violations = await applyAstRulesToAdditions([rule], additions, tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.lineNumber).toBe(1);
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CompiledRule, DiffAddition, RuleEventCallback } from './compiler-schema.js';
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

  it('emits suppress event for ast-grep rules on totem-ignore lines', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      'console.log("hello"); // totem-ignore\nconst x = 1;\n',
    );

    const rule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'suppress-ast-grep-test',
      astGrepPattern: 'console.log($$$)',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("hello"); // totem-ignore',
        lineNumber: 1,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash) => {
      events.push({ event, hash });
    };

    const violations = await applyAstRulesToAdditions([rule], additions, tmpDir, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toEqual([{ event: 'suppress', hash: 'suppress-ast-grep-test' }]);
  });

  it('emits suppress event for tree-sitter AST rules on totem-ignore-next-line', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// totem-ignore-next-line\nconst x = 1;\n',
    );

    const rule = makeRule({
      engine: 'ast',
      lessonHash: 'suppress-tree-sitter-test',
      astQuery: '(lexical_declaration) @violation',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'const x = 1;',
        lineNumber: 2,
        precedingLine: '// totem-ignore-next-line',
      },
    ];

    const events: Array<{ event: string; hash: string }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash) => {
      events.push({ event, hash });
    };

    const violations = await applyAstRulesToAdditions([rule], additions, tmpDir, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toEqual([{ event: 'suppress', hash: 'suppress-tree-sitter-test' }]);
  });
});

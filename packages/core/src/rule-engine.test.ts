import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CompiledRule,
  DiffAddition,
  RuleEventCallback,
  RuleEventContext,
} from './compiler-schema.js';
import { TotemParseError } from './errors.js';
import {
  applyAstRulesToAdditions,
  applyRulesToAdditions,
  extractJustification,
  matchesGlob,
} from './rule-engine.js';

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

// ─── Regex rule event context ────────────────────────

describe('applyRulesToAdditions — event context', () => {
  it('onRuleEvent callback receives file and line context on suppress', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-suppress-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug"); // totem-ignore',
        lineNumber: 42,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions([rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.hash).toBe('ctx-suppress-test');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 42,
      justification: '',
    });
  });

  it('onRuleEvent callback receives file and line context on trigger', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-trigger-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/handler.ts',
        line: 'console.log("hello");',
        lineNumber: 10,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions([rule], additions, onRuleEvent);
    expect(violations).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('trigger');
    expect(events[0]!.context).toEqual({
      file: 'src/handler.ts',
      line: 10,
    });
  });

  it('totem-context: directive suppresses rule and extracts justification', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-override-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug"); // totem-context: needed for observability',
        lineNumber: 5,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions([rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 5,
      justification: 'needed for observability',
    });
  });

  it('totem-context: on preceding line suppresses and extracts justification', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-prev-line-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug");',
        lineNumber: 6,
        precedingLine: '// totem-context: required for production monitoring',
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions([rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 6,
      justification: 'required for production monitoring',
    });
  });
});

// ─── extractJustification ────────────────────────────

describe('extractJustification', () => {
  it('returns empty string for plain totem-ignore', () => {
    expect(extractJustification('code(); // totem-ignore', null)).toBe('');
  });

  it('extracts justification from same-line totem-context:', () => {
    expect(extractJustification('code(); // totem-context: needed for DLP', null)).toBe(
      'needed for DLP',
    );
  });

  it('extracts justification from preceding line totem-context:', () => {
    expect(extractJustification('code();', '// totem-context: audit trail')).toBe('audit trail');
  });

  it('prefers same-line over preceding line', () => {
    expect(
      extractJustification(
        'code(); // totem-context: same-line reason',
        '// totem-context: preceding reason',
      ),
    ).toBe('same-line reason');
  });

  it('trims whitespace from justification', () => {
    expect(extractJustification('code(); // totem-context:   extra spaces  ', null)).toBe(
      'extra spaces',
    );
  });
});

// ─── matchesGlob ──────────────────────────────────

describe('matchesGlob', () => {
  it('matches *.ext anywhere in path', () => {
    expect(matchesGlob('src/foo.ts', '*.ts')).toBe(true);
    expect(matchesGlob('src/foo.js', '*.ts')).toBe(false);
  });

  it('matches *.test.* for test file patterns', () => {
    expect(matchesGlob('src/foo.test.ts', '*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.test.js', '*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.spec.tsx', '*.spec.*')).toBe(true);
    expect(matchesGlob('src/foo.ts', '*.test.*')).toBe(false);
    // Directory segments containing ".test." should NOT match
    expect(matchesGlob('src/.test.fixtures/foo.ts', '*.test.*')).toBe(false);
  });

  it('matches **/*.test.* recursively', () => {
    expect(matchesGlob('packages/cli/src/install-hooks.test.ts', '**/*.test.*')).toBe(true);
    expect(matchesGlob('packages/cli/src/install-hooks.ts', '**/*.test.*')).toBe(false);
  });

  it('matches directory prefixed globs', () => {
    expect(matchesGlob('packages/cli/src/foo.ts', 'packages/cli/**/*.ts')).toBe(true);
    expect(matchesGlob('packages/core/src/foo.ts', 'packages/cli/**/*.ts')).toBe(false);
  });

  it('matches literal filenames', () => {
    expect(matchesGlob('Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('src/Dockerfile', 'Dockerfile')).toBe(true);
  });
});

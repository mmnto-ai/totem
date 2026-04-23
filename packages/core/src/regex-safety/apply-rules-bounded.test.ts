import { describe, expect, it } from 'vitest';

import type { CompiledRule, DiffAddition } from '../compiler-schema.js';
import { makeRuleEngineCtx } from '../test-utils.js';
import { applyRulesToAdditionsBounded, type RuleTimeoutOutcome } from './apply-rules-bounded.js';
import { RegexEvaluator } from './evaluator.js';

function addition(file: string, line: string, lineNumber: number): DiffAddition {
  return { file, line, lineNumber, precedingLine: null };
}

function regexRule(lessonHash: string, pattern: string, engine: 'regex' = 'regex'): CompiledRule {
  return {
    lessonHash,
    lessonHeading: `rule ${lessonHash}`,
    pattern,
    message: `violation for ${lessonHash}`,
    engine,
    compiledAt: '2026-04-23T00:00:00Z',
  };
}

describe('applyRulesToAdditionsBounded — happy path', () => {
  it('flags matching additions under a sync evaluator', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const rules = [regexRule('h1', 'console\\.log')];
      const additions: DiffAddition[] = [
        addition('foo.ts', 'console.log("a")', 10),
        addition('foo.ts', 'logger.info("b")', 11),
      ];
      const result = await applyRulesToAdditionsBounded(makeRuleEngineCtx(), rules, additions, {
        evaluator,
        timeoutMode: 'strict',
        repoRoot: '/tmp/repo',
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.rule.lessonHash).toBe('h1');
      expect(result.violations[0]?.lineNumber).toBe(10);
      expect(result.timeoutOutcomes).toEqual([]);
    } finally {
      await evaluator.dispose();
    }
  });

  it('respects fileGlobs when evaluating additions', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const rule: CompiledRule = {
        ...regexRule('scoped', 'foo'),
        fileGlobs: ['**/*.md'],
      };
      const additions: DiffAddition[] = [
        addition('readme.md', 'foo', 1),
        addition('app.ts', 'foo', 1),
      ];
      const result = await applyRulesToAdditionsBounded(makeRuleEngineCtx(), [rule], additions, {
        evaluator,
        timeoutMode: 'strict',
        repoRoot: '/tmp/repo',
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.file).toBe('readme.md');
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('applyRulesToAdditionsBounded — timeout strict', () => {
  it('returns a RuleTimeoutOutcome and excludes violations for the timing-out rule', async () => {
    const evaluator = new RegexEvaluator({ timeoutMs: 150, softWarningMs: 50 });
    try {
      const rules = [regexRule('redos', '(a+)+b'), regexRule('healthy', 'foo')];
      const additions: DiffAddition[] = [
        addition('a.ts', 'a'.repeat(50000) + 'c', 1),
        addition('b.ts', 'foo', 2),
      ];
      const result = await applyRulesToAdditionsBounded(makeRuleEngineCtx(), rules, additions, {
        evaluator,
        timeoutMode: 'strict',
        repoRoot: '/tmp/repo',
      });
      const timeoutHashes = result.timeoutOutcomes.map((o: RuleTimeoutOutcome) => o.ruleHash);
      expect(timeoutHashes).toContain('redos');
      // Healthy rule should still produce its violation.
      const healthyViolation = result.violations.find((v) => v.rule.lessonHash === 'healthy');
      expect(healthyViolation).toBeDefined();
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('applyRulesToAdditionsBounded — timeout lenient', () => {
  it('records timeout outcomes but does not differ from strict at the engine layer', async () => {
    // The strict/lenient semantics are enforced at the CLI layer based on
    // the timeoutOutcomes array this function returns. The engine itself
    // is policy-free — it records the outcome and lets the caller decide
    // the exit-code effect. Locking this in prevents future drift where
    // the engine starts making policy decisions instead of surfacing them.
    const evaluator = new RegexEvaluator({ timeoutMs: 150, softWarningMs: 50 });
    try {
      const rules = [regexRule('redos', '(a+)+b')];
      const additions: DiffAddition[] = [addition('a.ts', 'a'.repeat(50000) + 'c', 1)];
      const strict = await applyRulesToAdditionsBounded(makeRuleEngineCtx(), rules, additions, {
        evaluator,
        timeoutMode: 'strict',
        repoRoot: '/tmp/repo',
      });
      const lenient = await applyRulesToAdditionsBounded(makeRuleEngineCtx(), rules, additions, {
        evaluator,
        timeoutMode: 'lenient',
        repoRoot: '/tmp/repo',
      });
      expect(strict.timeoutOutcomes).toHaveLength(1);
      expect(lenient.timeoutOutcomes).toHaveLength(1);
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('applyRulesToAdditionsBounded — invalid pattern', () => {
  it('fails loud on a compiled rule with an invalid regex (matches existing rule-engine contract)', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const rules = [regexRule('broken', '(unclosed')];
      const additions: DiffAddition[] = [addition('a.ts', 'foo', 1)];
      await expect(
        applyRulesToAdditionsBounded(makeRuleEngineCtx(), rules, additions, {
          evaluator,
          timeoutMode: 'strict',
          repoRoot: '/tmp/repo',
        }),
      ).rejects.toThrow(/invalid regex|cannot be evaluated/i);
    } finally {
      await evaluator.dispose();
    }
  });
});

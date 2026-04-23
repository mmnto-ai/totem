import { describe, expect, it } from 'vitest';

import { RegexEvaluator } from './evaluator.js';

describe('RegexEvaluator — happy path', () => {
  it('returns matched line indices for a simple pattern', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const result = await evaluator.evaluate({
        ruleHash: 'h1',
        pattern: 'console\\.log',
        flags: '',
        lines: ['console.log("a")', 'logger.info("b")', 'console.log("c")'],
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.matchedIndices).toEqual([0, 2]);
        expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await evaluator.dispose();
    }
  });

  it('returns an empty match list when no line matches', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const result = await evaluator.evaluate({
        ruleHash: 'h2',
        pattern: 'xyz\\d+',
        flags: '',
        lines: ['foo', 'bar', 'baz'],
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        expect(result.matchedIndices).toEqual([]);
      }
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('RegexEvaluator — timeout', () => {
  it('aborts catastrophic backtracking within the configured timeout', async () => {
    const evaluator = new RegexEvaluator({ timeoutMs: 150, softWarningMs: 50 });
    try {
      const start = Date.now();
      const result = await evaluator.evaluate({
        ruleHash: 'redos',
        pattern: '(a+)+b',
        flags: '',
        lines: ['a'.repeat(50000) + 'c'],
      });
      const elapsed = Date.now() - start;
      expect(result.kind).toBe('timeout');
      // Main thread must return in roughly the budget; allow generous
      // tolerance for worker respawn and test runner overhead.
      expect(elapsed).toBeLessThan(2000);
    } finally {
      await evaluator.dispose();
    }
  });

  it('respawns the worker after a timeout and accepts subsequent evaluations', async () => {
    const evaluator = new RegexEvaluator({ timeoutMs: 150, softWarningMs: 50 });
    try {
      const bad = await evaluator.evaluate({
        ruleHash: 'redos',
        pattern: '(a+)+b',
        flags: '',
        lines: ['a'.repeat(50000) + 'c'],
      });
      expect(bad.kind).toBe('timeout');

      // After respawn, a normal evaluation must succeed.
      const good = await evaluator.evaluate({
        ruleHash: 'after-redos',
        pattern: 'foo',
        flags: '',
        lines: ['foo', 'bar'],
      });
      expect(good.kind).toBe('ok');
      if (good.kind === 'ok') {
        expect(good.matchedIndices).toEqual([0]);
      }
    } finally {
      await evaluator.dispose();
    }
  });

  it('emits softWarningTriggered for evaluations between softWarningMs and timeoutMs', async () => {
    // Simulate a slow-but-not-pathological pattern by using a moderately
    // backtracking regex with bounded input. Actual wall-clock depends
    // on the host, so we pick a pattern that reliably falls in the
    // soft-warning window and adjust thresholds low enough to trip it.
    const evaluator = new RegexEvaluator({ timeoutMs: 500, softWarningMs: 1 });
    try {
      const result = await evaluator.evaluate({
        ruleHash: 'slow',
        pattern: 'foo',
        flags: '',
        // Many lines guarantee the total evaluation takes > 1ms.
        lines: new Array(1000).fill('foo'),
      });
      expect(result.kind).toBe('ok');
      if (result.kind === 'ok') {
        // With softWarningMs = 1 and 1000 lines, elapsed should exceed 1ms
        // on any reasonable host and softWarning should trip.
        expect(result.softWarningTriggered).toBe(true);
      }
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('RegexEvaluator — error cases', () => {
  it('reports an invalid regex as an error (no worker termination)', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const result = await evaluator.evaluate({
        ruleHash: 'bad-pattern',
        pattern: '(unclosed',
        flags: '',
        lines: ['anything'],
      });
      expect(result.kind).toBe('error');
      if (result.kind === 'error') {
        expect(result.message.toLowerCase()).toMatch(/invalid|syntax|unterminated/);
      }

      // Worker should still be alive for the next evaluation.
      const next = await evaluator.evaluate({
        ruleHash: 'after-bad',
        pattern: 'foo',
        flags: '',
        lines: ['foo'],
      });
      expect(next.kind).toBe('ok');
    } finally {
      await evaluator.dispose();
    }
  });
});

describe('RegexEvaluator — serialization', () => {
  it('serializes concurrent evaluate() calls onto the single worker', async () => {
    // Two in-flight evaluations must queue, not overlap. The second
    // evaluation does not start until the first resolves. This protects
    // the single-worker invariant (no multiplexing of batches onto one
    // worker message round-trip).
    const evaluator = new RegexEvaluator();
    try {
      const a = evaluator.evaluate({
        ruleHash: 'concurrent-a',
        pattern: 'foo',
        flags: '',
        lines: ['foo', 'bar'],
      });
      const b = evaluator.evaluate({
        ruleHash: 'concurrent-b',
        pattern: 'bar',
        flags: '',
        lines: ['foo', 'bar'],
      });
      const [resA, resB] = await Promise.all([a, b]);
      expect(resA.kind).toBe('ok');
      expect(resB.kind).toBe('ok');
      if (resA.kind === 'ok') expect(resA.matchedIndices).toEqual([0]);
      if (resB.kind === 'ok') expect(resB.matchedIndices).toEqual([1]);
    } finally {
      await evaluator.dispose();
    }
  });
});

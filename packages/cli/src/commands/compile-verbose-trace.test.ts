import { describe, expect, it } from 'vitest';

import type { LayerTraceEvent } from '@mmnto/totem';

import { formatVerboseTraceBlock } from './compile.js';

// ─── Format verbose trace block (mmnto-ai/totem#1482) ──

describe('formatVerboseTraceBlock', () => {
  const lesson = { heading: 'No console.log in production', hash: 'abc12345def67890' };

  it('renders a pipeline 1 single-result trace as a header plus result line', () => {
    const trace: LayerTraceEvent[] = [{ layer: 1, action: 'result', outcome: 'compiled' }];
    const block = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    const lines = block.split('\n');
    expect(lines[0]).toBe('lesson-abc12345 "No console.log in production":');
    expect(lines[1]).toBe('  result: compiled');
    expect(lines).toHaveLength(2);
  });

  it('renders a pipeline 2 first-try success with generate + verify + result', () => {
    const trace: LayerTraceEvent[] = [
      { layer: 3, action: 'generate', outcome: 'attempt-1', patternHash: 'deadbeefcafebabe' },
      { layer: 3, action: 'verify', outcome: 'MATCH' },
      { layer: 3, action: 'result', outcome: 'compiled' },
    ];
    const block = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    expect(block).toContain('lesson-abc12345');
    expect(block).toContain(
      'Layer 3 (Pipeline 3 (LLM + verify-retry)) -> attempt-1 (patternHash=deadbeefcafebabe)',
    );
    expect(block).toContain('verify on example: MATCH');
    expect(block).toContain('result: compiled');
  });

  it('renders a verify-retry-exhausted trace with retry counters and reasonCode', () => {
    const trace: LayerTraceEvent[] = [
      { layer: 3, action: 'generate', outcome: 'attempt-1', patternHash: 'a'.repeat(16) },
      { layer: 3, action: 'verify', outcome: 'example-hit-miss' },
      { layer: 3, action: 'retry', outcome: 'attempt-2-scheduled' },
      { layer: 3, action: 'generate', outcome: 'attempt-2', patternHash: 'b'.repeat(16) },
      { layer: 3, action: 'verify', outcome: 'example-hit-miss' },
      { layer: 3, action: 'retry', outcome: 'attempt-3-scheduled' },
      { layer: 3, action: 'generate', outcome: 'attempt-3', patternHash: 'c'.repeat(16) },
      { layer: 3, action: 'verify', outcome: 'example-hit-miss' },
      {
        layer: 3,
        action: 'result',
        outcome: 'skipped',
        reasonCode: 'verify-retry-exhausted',
      },
    ];
    const block = formatVerboseTraceBlock(lesson, 'skipped', 'verify-retry-exhausted', trace);
    expect(block).toContain('retry 1: attempt-2-scheduled');
    expect(block).toContain('retry 2: attempt-3-scheduled');
    expect(block).toContain('result: skipped (verify-retry-exhausted)');
    // Exactly three generate lines (one per attempt)
    const genCount = (
      block.match(/Layer 3 \(Pipeline 3 \(LLM \+ verify-retry\)\) -> attempt-/g) ?? []
    ).length;
    expect(genCount).toBe(3);
  });

  it('renders pipeline 3 (layer 2) with the correct pipeline label', () => {
    const trace: LayerTraceEvent[] = [
      { layer: 2, action: 'generate', outcome: 'produced', patternHash: '0'.repeat(16) },
      { layer: 2, action: 'verify', outcome: 'passed' },
      { layer: 2, action: 'result', outcome: 'compiled' },
    ];
    const block = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    expect(block).toContain('Layer 2 (Pipeline 2 (example-based)) -> produced');
  });

  it('falls back gracefully when trace is undefined or empty', () => {
    const undefinedBlock = formatVerboseTraceBlock(lesson, 'failed', undefined, undefined);
    expect(undefinedBlock).toContain('(no trace events recorded)');
    expect(undefinedBlock).toContain('result: failed');

    const emptyBlock = formatVerboseTraceBlock(lesson, 'noop', undefined, []);
    expect(emptyBlock).toContain('(no trace events recorded)');
  });

  it('emits a single contiguous multi-line string (no intermediate newlines before content)', () => {
    // Invariant: the caller writes this block via one process.stdout.write
    // call, so the block must already contain its internal newlines and
    // must not start or end with bare whitespace that would collide with
    // the trailing \n the caller appends.
    const trace: LayerTraceEvent[] = [{ layer: 1, action: 'result', outcome: 'compiled' }];
    const block = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    expect(block.startsWith('lesson-')).toBe(true);
    expect(block.endsWith('\n')).toBe(false);
  });

  it('renders a skipped lesson with reasonCode from the terminal event', () => {
    const trace: LayerTraceEvent[] = [
      {
        layer: 3,
        action: 'result',
        outcome: 'skipped',
        reasonCode: 'out-of-scope',
      },
    ];
    const block = formatVerboseTraceBlock(lesson, 'skipped', 'out-of-scope', trace);
    expect(block).toContain('result: skipped (out-of-scope)');
  });

  it('tolerates unknown layer numbers via the fallback label', () => {
    const trace: LayerTraceEvent[] = [
      {
        layer: 99 as 1 | 2 | 3,
        action: 'generate',
        outcome: 'produced',
      },
      {
        layer: 99 as 1 | 2 | 3,
        action: 'result',
        outcome: 'compiled',
      },
    ];
    const block = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    expect(block).toContain('Layer 99');
  });
});

// ─── Atomic stdout.write invocation ──────────────────

describe('verbose trace atomic emission', () => {
  it('guarantees the trace block formats as a single string the caller can ship via one stdout.write call', () => {
    // The compile command invokes process.stdout.write(block + '\n') once
    // per lesson so concurrent lessons cannot interleave inside the block.
    // That invariant reduces to: formatVerboseTraceBlock returns a single
    // string. The test below pins the shape so a refactor that splits the
    // render across multiple returns fails loudly.
    const lesson = { heading: 'Atomic test lesson', hash: 'aaaa1111bbbb2222' };
    const trace: LayerTraceEvent[] = [
      { layer: 3, action: 'generate', outcome: 'attempt-1', patternHash: 'f'.repeat(16) },
      { layer: 3, action: 'verify', outcome: 'MATCH' },
      { layer: 3, action: 'result', outcome: 'compiled' },
    ];
    const out = formatVerboseTraceBlock(lesson, 'compiled', undefined, trace);
    expect(typeof out).toBe('string');
    // Block must contain every event's outcome; no event gets dropped.
    for (const ev of trace) {
      expect(out).toContain(ev.outcome);
    }
  });
});

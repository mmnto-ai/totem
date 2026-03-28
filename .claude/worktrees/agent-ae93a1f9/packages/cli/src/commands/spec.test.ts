import { describe, expect, it, vi } from 'vitest';

import type { LanceStore, SearchResult } from '@mmnto/totem';

import { log } from '../ui.js';
import type { RetrievedContext } from './spec.js';
import {
  assemblePrompt,
  MAX_LESSON_CHARS,
  MAX_LESSONS,
  retrieveContext,
  SPEC_SYSTEM_PROMPT,
} from './spec.js';

// ─── Helpers ─────────────────────────────────────────────

function makeLesson(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: '**Tags:** testing\n\nAlways validate input at boundaries.',
    contextPrefix: 'Totem Lessons > Lesson — Always validate input',
    filePath: '.totem/lessons.md',
    type: 'spec',
    label: 'Totem Lessons > Lesson — Always validate input',
    score: 0.5,
    metadata: {},
    ...overrides,
  };
}

function makeSpec(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: 'Architecture overview content here.',
    contextPrefix: 'Architecture > Overview',
    filePath: 'docs/architecture.md',
    type: 'spec',
    label: 'Architecture > Overview',
    score: 0.45,
    metadata: {},
    ...overrides,
  };
}

function emptyContext(): RetrievedContext {
  return { specs: [], sessions: [], code: [], lessons: [] };
}

// ─── SYSTEM_PROMPT structure ─────────────────────────────

describe('SPEC_SYSTEM_PROMPT', () => {
  it('contains Lessons Are Law rule', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('Lessons Are Law');
  });

  it('instructs LLM to treat lessons as hard constraints', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('RELEVANT LESSONS');
    expect(SPEC_SYSTEM_PROMPT).toContain('hard architectural constraint');
  });

  it('instructs LLM to cite lessons in Architectural Context', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('Call out which lessons influenced');
  });

  it('contains RED FLAGS TDD enforcement section', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('RED FLAGS');
    expect(SPEC_SYSTEM_PROMPT).toContain('Never write code before writing the failing test');
    expect(SPEC_SYSTEM_PROMPT).toContain('Never skip the test step');
  });

  it('contains Graphviz execution flow diagram', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('digraph workflow');
    expect(SPEC_SYSTEM_PROMPT).toContain('verify_fails -> implement');
    expect(SPEC_SYSTEM_PROMPT).toContain('verify_passes -> lint');
  });
});

// ─── assemblePrompt ──────────────────────────────────────

describe('assemblePrompt', () => {
  it('includes lessons section when lessons are present', async () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson()],
    };
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test topic' }],
      ctx,
      'system prompt',
    );
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('Always validate input at boundaries.');
  });

  it('omits lessons section when no lessons found', async () => {
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test topic' }],
      emptyContext(),
      'system prompt',
    );
    expect(result).not.toContain('RELEVANT LESSONS');
  });

  it('includes full lesson body without truncation', async () => {
    const longBody = 'A'.repeat(500);
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson({ content: longBody })],
    };
    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain(longBody);
  });

  it('includes lesson score in output', async () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson({ score: 0.789 })],
    };
    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('0.789');
  });

  it('respects MAX_LESSON_CHARS budget', async () => {
    // Create lessons that individually fit but collectively exceed the budget
    const bigLesson = makeLesson({ content: 'X'.repeat(2000) });
    const lessons = Array.from({ length: 10 }, () => ({ ...bigLesson }));
    const ctx: RetrievedContext = { ...emptyContext(), lessons };

    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');

    // Extract just the lessons section
    const lessonSection = result.split('RELEVANT LESSONS (HARD CONSTRAINTS)')[1] ?? '';
    expect(lessonSection.length).toBeLessThan(MAX_LESSON_CHARS + 200); // small margin for headers
  });

  it('skips oversized lessons but includes smaller ones after', async () => {
    const hugeLesson = makeLesson({ content: 'H'.repeat(MAX_LESSON_CHARS + 1), label: 'Huge' });
    const smallLesson = makeLesson({ content: 'Small lesson body', label: 'Small' });
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [hugeLesson, smallLesson],
    };
    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('RELEVANT LESSONS');
    expect(result).toContain('Small lesson body');
    expect(result).not.toContain('H'.repeat(100));
  });

  it('includes both specs and lessons as separate sections', async () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      specs: [makeSpec()],
      lessons: [makeLesson()],
    };
    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('RELATED SPECS & ADRs');
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
  });

  it('includes issue context when provided', async () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson()],
    };
    const result = await assemblePrompt(
      [
        {
          issue: {
            number: 42,
            title: 'Fix the widget',
            body: 'The widget is broken',
            state: 'open',
            labels: ['bug'],
          },
          freeText: null,
        },
      ],
      ctx,
      'system prompt',
    );
    expect(result).toContain('ISSUE #42');
    expect(result).toContain('Fix the widget');
    expect(result).toContain('RELEVANT LESSONS');
  });
});

// ─── Constants ───────────────────────────────────────────

describe('spec constants', () => {
  it('MAX_LESSONS is a reasonable cap', () => {
    expect(MAX_LESSONS).toBeGreaterThanOrEqual(5);
    expect(MAX_LESSONS).toBeLessThanOrEqual(20);
  });

  it('MAX_LESSON_CHARS provides a meaningful budget', () => {
    expect(MAX_LESSON_CHARS).toBeGreaterThanOrEqual(4_000);
    expect(MAX_LESSON_CHARS).toBeLessThanOrEqual(16_000);
  });
});

// ─── retrieveContext (partition logic) ───────────────────

// ─── retrieveContext with linked stores (#667) ──────────

function mockStore(results: SearchResult[]): LanceStore {
  return { search: vi.fn().mockResolvedValue(results) } as unknown as LanceStore;
}

function mockFailingStore(err: Error): LanceStore {
  return { search: vi.fn().mockRejectedValue(err) } as unknown as LanceStore;
}

describe('retrieveContext — cross-totem linked stores', () => {
  it('merges results from primary + linked stores', async () => {
    const primary = mockStore([makeSpec({ label: 'primary', score: 0.8 })]);
    const linked = mockStore([makeSpec({ label: 'linked', score: 0.6 })]);

    const ctx = await retrieveContext('test query', primary, [linked]);

    expect(ctx.specs.length).toBe(2);
    const labels = ctx.specs.map((s) => s.label);
    expect(labels).toContain('primary');
    expect(labels).toContain('linked');
  });

  it('linked store failure does not block primary query', async () => {
    const primary = mockStore([makeSpec({ label: 'primary', score: 0.9 })]);
    const failing = mockFailingStore(new Error('ECONNREFUSED'));

    const ctx = await retrieveContext('test query', primary, [failing]);

    expect(ctx.specs.length).toBe(1);
    expect(ctx.specs.some((s) => s.label === 'primary')).toBe(true);
  });

  it('results sorted by score across stores', async () => {
    const primary = mockStore([makeSpec({ label: 'low', score: 0.3 })]);
    const linked = mockStore([makeSpec({ label: 'high', score: 0.9 })]);

    const ctx = await retrieveContext('test query', primary, [linked]);

    const scores = ctx.specs.map((s) => s.score ?? 0);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('config error in linked store logs warning and continues', async () => {
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const primary = mockStore([makeSpec({ label: 'primary', score: 0.5 })]);
    const broken = mockFailingStore(new Error('Invalid config: dimension mismatch'));

    const ctx = await retrieveContext('test query', primary, [broken]);

    expect(ctx.specs.length).toBe(1);
    expect(ctx.specs.some((s) => s.label === 'primary')).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('empty linkedStores behaves same as no linked stores', async () => {
    const primary = mockStore([makeSpec({ label: 'only', score: 0.7 })]);

    const withEmpty = await retrieveContext('test query', primary, []);
    const withUndefined = await retrieveContext('test query', primary);

    expect(withEmpty.specs.length).toBe(withUndefined.specs.length);
  });
});

describe('retrieveContext partitioning', () => {
  it('lessons from lessons.md are separated from regular specs', async () => {
    // Simulate what retrieveContext produces: lessons in lessons array, specs in specs array
    const ctx: RetrievedContext = {
      specs: [makeSpec({ filePath: 'docs/architecture.md' })],
      sessions: [],
      code: [],
      lessons: [makeLesson({ filePath: '.totem/lessons.md' })],
    };
    const result = await assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    // Lessons appear in their own section, not mixed with specs
    const specSection = result.split('RELATED SPECS & ADRs')[1]?.split('===')[0] ?? '';
    expect(specSection).not.toContain('lessons.md');
  });
});

import { describe, expect, it } from 'vitest';

import type { SearchResult } from '@mmnto/totem';

import type { RetrievedContext } from './spec.js';
import { assemblePrompt, MAX_LESSON_CHARS, MAX_LESSONS, SPEC_SYSTEM_PROMPT } from './spec.js';

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
});

// ─── assemblePrompt ──────────────────────────────────────

describe('assemblePrompt', () => {
  it('includes lessons section when lessons are present', () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson()],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test topic' }], ctx, 'system prompt');
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('Always validate input at boundaries.');
  });

  it('omits lessons section when no lessons found', () => {
    const result = assemblePrompt(
      [{ issue: null, freeText: 'test topic' }],
      emptyContext(),
      'system prompt',
    );
    expect(result).not.toContain('RELEVANT LESSONS');
  });

  it('includes full lesson body without truncation', () => {
    const longBody = 'A'.repeat(500);
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson({ content: longBody })],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain(longBody);
  });

  it('includes lesson score in output', () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson({ score: 0.789 })],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('0.789');
  });

  it('respects MAX_LESSON_CHARS budget', () => {
    // Create lessons that individually fit but collectively exceed the budget
    const bigLesson = makeLesson({ content: 'X'.repeat(2000) });
    const lessons = Array.from({ length: 10 }, () => ({ ...bigLesson }));
    const ctx: RetrievedContext = { ...emptyContext(), lessons };

    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');

    // Extract just the lessons section
    const lessonSection = result.split('RELEVANT LESSONS (HARD CONSTRAINTS)')[1] ?? '';
    expect(lessonSection.length).toBeLessThan(MAX_LESSON_CHARS + 200); // small margin for headers
  });

  it('skips oversized lessons but includes smaller ones after', () => {
    const hugeLesson = makeLesson({ content: 'H'.repeat(MAX_LESSON_CHARS + 1), label: 'Huge' });
    const smallLesson = makeLesson({ content: 'Small lesson body', label: 'Small' });
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [hugeLesson, smallLesson],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('RELEVANT LESSONS');
    expect(result).toContain('Small lesson body');
    expect(result).not.toContain('H'.repeat(100));
  });

  it('includes both specs and lessons as separate sections', () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      specs: [makeSpec()],
      lessons: [makeLesson()],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    expect(result).toContain('RELATED SPECS & ADRs');
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
  });

  it('includes issue context when provided', () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson()],
    };
    const result = assemblePrompt(
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

describe('retrieveContext partitioning', () => {
  // We can't easily test retrieveContext directly without a real LanceDB,
  // but we can test the partitioning logic via assemblePrompt behavior.

  it('lessons from lessons.md are separated from regular specs', () => {
    // Simulate what retrieveContext produces: lessons in lessons array, specs in specs array
    const ctx: RetrievedContext = {
      specs: [makeSpec({ filePath: 'docs/architecture.md' })],
      sessions: [],
      code: [],
      lessons: [makeLesson({ filePath: '.totem/lessons.md' })],
    };
    const result = assemblePrompt([{ issue: null, freeText: 'test' }], ctx, 'system prompt');
    // Lessons appear in their own section, not mixed with specs
    const specSection = result.split('RELATED SPECS & ADRs')[1]?.split('===')[0] ?? '';
    expect(specSection).not.toContain('lessons.md');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { type LanceStore, type SearchResult, TotemConfigError } from '@mmnto/totem';

import type { StandardIssue } from '../adapters/issue-adapter.js';
import { log } from '../ui.js';
import type { RetrievedContext } from './spec.js';
import {
  assemblePrompt,
  expandSpecQuery,
  MAX_LESSON_CHARS,
  MAX_LESSONS,
  resolveDefaultSpecPath,
  retrieveContext,
  sanitizeSpecFilename,
  SPEC_SYSTEM_PROMPT,
  validateOutputOptions,
} from './spec.js';

// ─── Helpers ─────────────────────────────────────────────

function makeLesson(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: '**Tags:** testing\n\nAlways validate input at boundaries.',
    contextPrefix: 'Totem Lessons > Lesson — Always validate input',
    filePath: '.totem/lessons.md',
    absoluteFilePath: '.totem/lessons.md',
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
    absoluteFilePath: 'docs/architecture.md',
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

  it('contains Reuse Shared Helpers rule (#1015)', () => {
    expect(SPEC_SYSTEM_PROMPT).toContain('Reuse Shared Helpers');
    expect(SPEC_SYSTEM_PROMPT).toContain('SHARED HELPERS section');
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

    // Extract just the lessons section (stop at the next === section)
    const afterLessons = result.split('RELEVANT LESSONS (HARD CONSTRAINTS)')[1] ?? '';
    const lessonSection = afterLessons.split(/\n===\s/)[0] ?? '';
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

  it('includes shared helpers section (#1015)', async () => {
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test topic' }],
      emptyContext(),
      'system prompt',
    );
    expect(result).toContain('SHARED HELPERS');
    expect(result).toContain('safeExec');
    expect(result).toContain('Instead of:');
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

// ─── expandSpecQuery (#1016) ────────────────────────────

describe('expandSpecQuery', () => {
  it('appends test keywords when issue mentions testing', () => {
    const result = expandSpecQuery('verify rule examples');
    expect(result).toContain('rule-tester');
    expect(result).toContain('testRule');
    expect(result).toContain('infrastructure');
  });

  it('does not modify unrelated queries', () => {
    const query = 'add new CLI command for status';
    expect(expandSpecQuery(query)).toBe(query);
  });

  it('is case-insensitive', () => {
    const result = expandSpecQuery('Fix TEST infrastructure');
    expect(result).toContain('rule-tester');
    expect(result).toContain('fixture');
  });

  it('matches plural and inflected forms', () => {
    expect(expandSpecQuery('update tests for coverage')).toContain('rule-tester');
    expect(expandSpecQuery('add verification step')).toContain('rule-tester');
    expect(expandSpecQuery('load fixtures from disk')).toContain('rule-tester');
    expect(expandSpecQuery('provide examples for docs')).toContain('rule-tester');
  });
});

// ─── validateOutputOptions (mmnto-ai/totem#1555) ─────────

describe('validateOutputOptions', () => {
  it('rejects simultaneous use of --stdout and --out flags', () => {
    expect(() =>
      validateOutputOptions({ out: 'file.md', stdout: true }, TotemConfigError),
    ).toThrowError(/--stdout and --out cannot be used together/);
  });

  it('throws a TotemConfigError with CONFIG_INVALID code', () => {
    expect(() =>
      validateOutputOptions({ out: 'file.md', stdout: true }, TotemConfigError),
    ).toThrowError(TotemConfigError);
    let thrown: unknown;
    try {
      validateOutputOptions({ out: 'file.md', stdout: true }, TotemConfigError);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('accepts --out alone', () => {
    expect(() => validateOutputOptions({ out: 'file.md' }, TotemConfigError)).not.toThrow();
  });

  it('accepts --stdout alone', () => {
    expect(() => validateOutputOptions({ stdout: true }, TotemConfigError)).not.toThrow();
  });

  it('accepts neither flag set', () => {
    expect(() => validateOutputOptions({}, TotemConfigError)).not.toThrow();
  });
});

// ─── sanitizeSpecFilename ────────────────────────────────

describe('sanitizeSpecFilename', () => {
  it('passes alphanumeric inputs through unchanged', () => {
    expect(sanitizeSpecFilename('1555')).toBe('1555');
    expect(sanitizeSpecFilename('my-topic')).toBe('my-topic');
    expect(sanitizeSpecFilename('migration_plan')).toBe('migration_plan');
  });

  it('replaces unsafe characters with dashes', () => {
    expect(sanitizeSpecFilename('foo/bar')).toBe('foo-bar');
    expect(sanitizeSpecFilename('hello world')).toBe('hello-world');
    expect(sanitizeSpecFilename('a.b.c')).toBe('a-b-c');
  });

  it('blocks path traversal attempts', () => {
    expect(sanitizeSpecFilename('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeSpecFilename('..\\windows\\system32')).toBe('windows-system32');
  });

  it('collapses runs of unsafe characters into a single dash', () => {
    expect(sanitizeSpecFilename('a///b')).toBe('a-b');
    expect(sanitizeSpecFilename('a   b')).toBe('a-b');
  });

  it('trims leading and trailing dashes', () => {
    expect(sanitizeSpecFilename('---foo---')).toBe('foo');
    expect(sanitizeSpecFilename('//path//')).toBe('path');
  });

  it('returns empty string for inputs that sanitize to nothing', () => {
    expect(sanitizeSpecFilename('!!!')).toBe('');
    expect(sanitizeSpecFilename('   ')).toBe('');
  });
});

// ─── resolveDefaultSpecPath ──────────────────────────────

function makeIssue(number: number): StandardIssue {
  return {
    number,
    title: `Issue #${number}`,
    body: 'body',
    state: 'open',
    labels: [],
  };
}

describe('resolveDefaultSpecPath', () => {
  const deps = {
    resolveGitRoot: vi.fn(() => '/repo'),
    pathJoin: (...parts: string[]) => parts.join('/'),
  };

  it('resolves single issue input to <gitRoot>/.totem/specs/<number>.md', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: makeIssue(1555), freeText: null }],
      '/repo/packages/cli',
      deps,
    );
    expect(result).toBe('/repo/.totem/specs/1555.md');
  });

  it('resolves single free-text input to sanitized filename', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: null, freeText: 'migration plan' }],
      '/repo',
      deps,
    );
    expect(result).toBe('/repo/.totem/specs/migration-plan.md');
  });

  it('falls back to cwd when git root is unavailable', () => {
    const fallbackDeps = {
      resolveGitRoot: vi.fn(() => null),
      pathJoin: (...parts: string[]) => parts.join('/'),
    };
    const result = resolveDefaultSpecPath(
      [{ issue: makeIssue(42), freeText: null }],
      '/some/cwd',
      fallbackDeps,
    );
    expect(result).toBe('/some/cwd/.totem/specs/42.md');
  });

  it('returns null for multi-input invocations', () => {
    const result = resolveDefaultSpecPath(
      [
        { issue: makeIssue(1), freeText: null },
        { issue: makeIssue(2), freeText: null },
      ],
      '/repo',
      deps,
    );
    expect(result).toBeNull();
  });

  it('returns null when free text sanitizes to empty', () => {
    const result = resolveDefaultSpecPath([{ issue: null, freeText: '!!!' }], '/repo', deps);
    expect(result).toBeNull();
  });

  it('returns null when single input has neither issue nor free text', () => {
    const result = resolveDefaultSpecPath([{ issue: null, freeText: null }], '/repo', deps);
    expect(result).toBeNull();
  });

  it('uses git root over cwd for monorepo subpackages', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: makeIssue(99), freeText: null }],
      '/repo/packages/cli/src',
      deps,
    );
    expect(result).toBe('/repo/.totem/specs/99.md');
  });
});

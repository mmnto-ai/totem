import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GROUNDING_ANCHOR_FREE_TEXT,
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_MIXED,
  GROUNDING_ANCHOR_RECORD,
  GroundingAnchorSchema,
  hasUnrenderableHeadingChar,
  type LanceStore,
  PROMPT_SOURCE_BUILTIN,
  PROMPT_SOURCE_OVERRIDE,
  type SearchResult,
  TotemConfigError,
} from '@mmnto/totem';

import type { StandardIssue } from '../adapters/issue-adapter.js';
import { cleanTmpDir } from '../test-utils.js';
import { log } from '../ui.js';
import type { ParsedInput, RetrievedContext, SpecRecord } from './spec.js';
import {
  assemblePrompt,
  assertOutDoesNotOverwriteRecord,
  buildRecordSearchQuery,
  evaluateGroundingFloor,
  expandSpecQuery,
  formatGroundingRefusal,
  isRecordPathOutsideRoot,
  loadSpecRecord,
  MAX_LESSON_CHARS,
  MAX_LESSONS,
  MAX_SPECS,
  resolveDefaultSpecPath,
  resolveGroundingAnchor,
  retrieveContext,
  sanitizeSpecFilename,
  SPEC_SEARCH_POOL,
  SPEC_SYSTEM_PROMPT,
  specCommand,
  validateOutputOptions,
  validateSpecInvocation,
} from './spec.js';
import { SPEC_REQUIRED_SECTIONS } from './spec-templates.js';

// ─── Mocks for the executed `specCommand` suite ─────────
//
// Everything the command touches OUTSIDE its own logic is stubbed so the
// anchored-evidence invariants (mmnto-ai/totem#2700) are measured on control
// flow, not on a live index: `runOrchestrator` is the ONLY writer of a run
// artifact, so "a refusal mints nothing" is provable by it never being
// reached, and `connect` counts prove a validation refused before the store.

const harness = vi.hoisted(() => ({
  /** Store hits keyed by the `typeFilter` `retrieveContext` asks for. */
  searchResults: {} as Record<string, unknown[]>,
  /** Every `typeFilter` the store was asked for, in call order (mmnto-ai/totem#2735). */
  searchTypeFilters: [] as string[],
  /** Every `runOrchestrator` invocation, in order — empty means no artifact could exist. */
  orchestratorArgs: [] as Array<Record<string, unknown>>,
  /** What the stubbed orchestrator returns as the draft. */
  orchestratorContent: 'DRAFT' as string | undefined,
  /** Resolved config the command reads (floor, dirs, embedding). */
  config: {} as Record<string, unknown>,
  /** How many times a store was connected — 0 proves a refusal preceded the store. */
  connects: 0,
  /** Every `writeOutput(content, outPath?)` call. */
  writes: [] as Array<{ content: string; outPath?: string }>,
}));

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    createEmbedder: vi.fn(() => ({})),
    LanceStore: class {
      async connect(): Promise<void> {
        harness.connects += 1;
      }
      async search({ typeFilter }: { typeFilter: string }): Promise<unknown[]> {
        harness.searchTypeFilters.push(typeFilter);
        return harness.searchResults[typeFilter] ?? [];
      }
    },
  };
});

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadEnv: () => {},
    loadConfig: async () => harness.config,
    requireEmbedding: () => ({ provider: 'gemini', model: 'test' }),
    runOrchestrator: async (args: Record<string, unknown>) => {
      harness.orchestratorArgs.push(args);
      return harness.orchestratorContent;
    },
    writeOutput: (content: string, outPath?: string) => {
      harness.writes.push(outPath === undefined ? { content } : { content, outPath });
    },
  };
});

vi.mock('./qbd-seam.js', () => ({
  recordQbdDerive: async () => ({}),
}));

vi.mock('../adapters/create-issue-adapter.js', () => ({
  createIssueAdapter: async () => ({
    fetchIssue: (num: number): StandardIssue => ({
      number: num,
      title: `Issue ${num}`,
      body: 'issue body',
      state: 'open',
      labels: [],
    }),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────

function makeLesson(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    content: '**Tags:** testing\n\nAlways validate input at boundaries.',
    contextPrefix: 'Totem Lessons > Lesson — Always validate input',
    // The post-mmnto-ai/totem#431 shape: lessons carry their own content type
    // and live under `.totem/lessons/`, one file each.
    filePath: '.totem/lessons/lesson-always-validate-input.md',
    absoluteFilePath: '.totem/lessons/lesson-always-validate-input.md',
    type: 'lesson',
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
    filePath: 'docs/reference/architecture.md',
    absoluteFilePath: 'docs/reference/architecture.md',
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
      [{ issue: null, freeText: 'test topic', record: null }],
      ctx,
      'system prompt',
    );
    expect(result).toContain('RELEVANT LESSONS (HARD CONSTRAINTS)');
    expect(result).toContain('Always validate input at boundaries.');
  });

  it('omits lessons section when no lessons found', async () => {
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test topic', record: null }],
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
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );
    expect(result).toContain(longBody);
  });

  it('includes lesson score in output', async () => {
    const ctx: RetrievedContext = {
      ...emptyContext(),
      lessons: [makeLesson({ score: 0.789 })],
    };
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );
    expect(result).toContain('0.789');
  });

  it('respects MAX_LESSON_CHARS budget', async () => {
    // Create lessons that individually fit but collectively exceed the budget
    const bigLesson = makeLesson({ content: 'X'.repeat(2000) });
    const lessons = Array.from({ length: 10 }, () => ({ ...bigLesson }));
    const ctx: RetrievedContext = { ...emptyContext(), lessons };

    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );

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
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );
    expect(result).toContain('RELEVANT LESSONS');
    expect(result).toContain('Small lesson body');
    expect(result).not.toContain('H'.repeat(100));
  });

  it('includes shared helpers section (#1015)', async () => {
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test topic', record: null }],
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
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );
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
          record: null,
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

// ─── retrieveContext lesson delivery (mmnto-ai/totem#2735) ──

/** A store that answers per `typeFilter` and records every request it received. */
function typedStore(rows: Partial<Record<string, SearchResult[]>>): {
  store: LanceStore;
  typeFilters: string[];
  requests: { typeFilter: string; maxResults: number }[];
} {
  const typeFilters: string[] = [];
  const requests: { typeFilter: string; maxResults: number }[] = [];
  const store = {
    search: async (req: { typeFilter: string; maxResults: number }): Promise<SearchResult[]> => {
      typeFilters.push(req.typeFilter);
      requests.push({ typeFilter: req.typeFilter, maxResults: req.maxResults });
      return rows[req.typeFilter] ?? [];
    },
  } as unknown as LanceStore;
  return { store, typeFilters, requests };
}

describe('retrieveContext — lessons are their own pool', () => {
  it('delivers a lesson AND a spec when the store holds one of each', async () => {
    const { store, typeFilters } = typedStore({
      lesson: [makeLesson({ type: 'lesson', label: 'Lesson A' })],
      spec: [makeSpec({ label: 'Spec A' })],
    });

    const ctx = await retrieveContext('test query', store);

    // The regression mmnto-ai/totem#431 introduced: lessons were partitioned
    // out of a `spec`-typed pool, so this length was 0 for every run since.
    expect(ctx.lessons.length).toBe(1);
    expect(ctx.lessons[0]!.label).toBe('Lesson A');
    expect(ctx.specs.length).toBe(1);
    expect(ctx.specs[0]!.label).toBe('Spec A');
    expect(typeFilters).toContain('lesson');
  });

  it('never asks a LINKED store for lessons — lessons come from the primary only', async () => {
    const primary = typedStore({ lesson: [makeLesson({ type: 'lesson' })], spec: [makeSpec()] });
    const linked = typedStore({ spec: [makeSpec({ label: 'linked' })] });

    const ctx = await retrieveContext('test query', primary.store, [linked.store]);

    expect(ctx.lessons.length).toBe(1);
    expect(primary.typeFilters).toContain('lesson');
    expect(linked.typeFilters).not.toContain('lesson');
    expect(linked.typeFilters).toEqual(['spec']);
  });

  // Request identity is the only thing that CAN pin "the specs delivered are
  // unchanged" against a real store: on the hybrid path the requested width is
  // the RRF fusion window (`packages/core/src/store/lance-search.ts` fetches
  // `maxResults * HYBRID_OVERFETCH_FACTOR` per leg), so a narrower request
  // changes WHICH rows survive fusion, not merely how many are cut.
  it('asks for the spec pool at exactly SPEC_SEARCH_POOL, unchanged by this slice', async () => {
    // The literal is the pin: bound to the constant alone, this test would go
    // green on a change to the constant itself. 20 is the pre-mmnto-ai/totem#2735
    // width, which is the hybrid fusion window.
    expect(SPEC_SEARCH_POOL).toBe(20);
    const { store, requests } = typedStore({ spec: [makeSpec()] });

    await retrieveContext('test query', store);

    const specRequests = requests.filter((r) => r.typeFilter === 'spec');
    expect(specRequests).toEqual([{ typeFilter: 'spec', maxResults: SPEC_SEARCH_POOL }]);
  });

  it('asks a LINKED store for specs at the delivery cap, unchanged by this slice', async () => {
    const primary = typedStore({ spec: [makeSpec()] });
    const linked = typedStore({ spec: [makeSpec({ label: 'linked' })] });

    await retrieveContext('test query', primary.store, [linked.store]);

    expect(linked.requests).toEqual([{ typeFilter: 'spec', maxResults: MAX_SPECS }]);
  });

  it('delivers the top-MAX_SPECS specs by score, in score order', async () => {
    const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    expect(scores.length).toBeGreaterThan(MAX_SPECS);
    const { store } = typedStore({
      spec: scores.map((score, i) => makeSpec({ label: `Spec ${i}`, score })),
    });

    const ctx = await retrieveContext('test query', store);

    expect(ctx.specs.length).toBe(MAX_SPECS);
    expect(ctx.specs.map((s) => s.score)).toEqual(scores.slice(0, MAX_SPECS));
  });

  it('delivers the top-MAX_SPECS by score ACROSS the primary and a linked store', async () => {
    const primary = typedStore({
      spec: [0.9, 0.7, 0.5, 0.3].map((score, i) => makeSpec({ label: `P${i}`, score })),
    });
    const linked = typedStore({
      spec: [0.8, 0.6, 0.4, 0.2].map((score, i) => makeSpec({ label: `L${i}`, score })),
    });

    const ctx = await retrieveContext('test query', primary.store, [linked.store]);

    expect(ctx.specs.length).toBe(MAX_SPECS);
    expect(ctx.specs.map((s) => s.score)).toEqual([0.9, 0.8, 0.7, 0.6, 0.5]);
  });
});

describe('assemblePrompt — lessons render in their own section', () => {
  it('a lesson never appears inside the RELATED SPECS & ADRs section', async () => {
    const ctx: RetrievedContext = {
      specs: [makeSpec({ filePath: 'docs/reference/architecture.md' })],
      sessions: [],
      code: [],
      lessons: [makeLesson({ type: 'lesson', filePath: '.totem/lessons/lesson-abc.md' })],
    };
    const result = await assemblePrompt(
      [{ issue: null, freeText: 'test', record: null }],
      ctx,
      'system prompt',
    );
    // Lessons appear in their own section, not mixed with specs
    const specSection = result.split('RELATED SPECS & ADRs')[1]?.split('===')[0] ?? '';
    expect(specSection).not.toContain('.totem/lessons/');
    expect(result).toContain('=== RELEVANT LESSONS (HARD CONSTRAINTS) ===');
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
      [{ issue: makeIssue(1555), freeText: null, record: null }],
      '/repo/packages/cli',
      deps,
    );
    expect(result).toBe('/repo/.totem/specs/1555.md');
  });

  it('resolves single free-text input to sanitized filename', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: null, freeText: 'migration plan', record: null }],
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
      [{ issue: makeIssue(42), freeText: null, record: null }],
      '/some/cwd',
      fallbackDeps,
    );
    expect(result).toBe('/some/cwd/.totem/specs/42.md');
  });

  it('returns null for multi-input invocations', () => {
    const result = resolveDefaultSpecPath(
      [
        { issue: makeIssue(1), freeText: null, record: null },
        { issue: makeIssue(2), freeText: null, record: null },
      ],
      '/repo',
      deps,
    );
    expect(result).toBeNull();
  });

  it('returns null when free text sanitizes to empty', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: null, freeText: '!!!', record: null }],
      '/repo',
      deps,
    );
    expect(result).toBeNull();
  });

  it('returns null when single input has neither issue nor free text', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: null, freeText: null, record: null }],
      '/repo',
      deps,
    );
    expect(result).toBeNull();
  });

  it('uses git root over cwd for monorepo subpackages', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: makeIssue(99), freeText: null, record: null }],
      '/repo/packages/cli/src',
      deps,
    );
    expect(result).toBe('/repo/.totem/specs/99.md');
  });

  // mmnto-ai/totem#2700: a bound record derives NO path — the only path it
  // could derive is the record's own, and the tool never drafts over it.
  it('returns null for a bound record (the draft goes to stdout or --out)', () => {
    const result = resolveDefaultSpecPath(
      [{ issue: null, freeText: null, record: makeRecord() }],
      '/repo',
      deps,
    );
    expect(result).toBeNull();
  });
});

// ─── SPEC_REQUIRED_SECTIONS (mmnto-ai/totem#2700) ────────

describe('SPEC_REQUIRED_SECTIONS', () => {
  it('every entry is a VERBATIM line of the system prompt (the gate requires only what the command asks for)', () => {
    const promptLines = SPEC_SYSTEM_PROMPT.split('\n');
    for (const section of SPEC_REQUIRED_SECTIONS) {
      expect(promptLines, `${section} is not a line of SPEC_SYSTEM_PROMPT`).toContain(section);
    }
  });

  it('every entry is renderable into the single-quoted node -e reader as a HEADING (mmnto-ai/totem#2737)', () => {
    for (const section of SPEC_REQUIRED_SECTIONS) {
      // A quote, backslash, dollar, backtick or control character would break
      // the `sh` single-quoted word, the JS string literal inside it, or both —
      // and could forge hook lines. Printable non-ASCII could not: the heading
      // predicate permits it where the PATH predicate cannot, because git
      // C-quotes path bytes above 0x7e in the `diff --name-only` output the
      // hooks' `grep -q` filters read and a heading meets no such filter. The
      // executed proof that the em dash survives the render is the frozen
      // falsifier in install-hooks.test.ts, over the four schema-constrained R3
      // drafts that carry the Verification heading byte-identical.
      expect(hasUnrenderableHeadingChar(section), `${section} cannot be rendered`).toBe(false);
    }
  });

  it('names all nine promised sections, in prompt order', () => {
    // Copied from SPEC_SYSTEM_PROMPT rather than retyped, so the em dash in the
    // Verification heading can never enter this file as a look-alike byte
    // (the mmnto-ai/totem#2692 authoring trap).
    expect([...SPEC_REQUIRED_SECTIONS]).toEqual(
      SPEC_SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('### ')),
    );
    expect(SPEC_REQUIRED_SECTIONS).toHaveLength(9);
  });
});

// ─── resolveGroundingAnchor (mmnto-ai/totem#2700) ────────

const RECORD_SHA = 'a'.repeat(64);

function makeRecord(overrides: Partial<SpecRecord> = {}): SpecRecord {
  return {
    path: '.totem/specs/2700.md',
    sha256: RECORD_SHA,
    body: '# Design record\n\nA body under the heading.\n',
    ...overrides,
  };
}

function issueInput(num: number, typed?: string): ParsedInput {
  return {
    issue: makeIssue(num),
    freeText: null,
    record: null,
    ...(typed !== undefined ? { issueRef: typed } : {}),
  };
}

function topicInput(text: string): ParsedInput {
  return { issue: null, freeText: text, record: null };
}

describe('resolveGroundingAnchor', () => {
  it('a single bare-number issue anchors `issue` with a #<n> ref', () => {
    expect(resolveGroundingAnchor([issueInput(2700, '2700')])).toEqual({
      kind: GROUNDING_ANCHOR_ISSUE,
      ref: '#2700',
    });
  });

  it('keeps an owner/repo#N or URL input AS TYPED (a fetched issue carries only a number)', () => {
    expect(resolveGroundingAnchor([issueInput(2700, 'mmnto-ai/totem#2700')])).toEqual({
      kind: GROUNDING_ANCHOR_ISSUE,
      ref: 'mmnto-ai/totem#2700',
    });
    expect(
      resolveGroundingAnchor([issueInput(42, 'https://github.com/mmnto-ai/totem/issues/42')]),
    ).toEqual({
      kind: GROUNDING_ANCHOR_ISSUE,
      ref: 'https://github.com/mmnto-ai/totem/issues/42',
    });
  });

  it('falls back to #<number> when no typed form was recorded', () => {
    expect(resolveGroundingAnchor([issueInput(7)])).toEqual({
      kind: GROUNDING_ANCHOR_ISSUE,
      ref: '#7',
    });
  });

  it('comma-joins several issue refs', () => {
    expect(resolveGroundingAnchor([issueInput(1, '1'), issueInput(2, 'mmnto-ai/totem#2')])).toEqual(
      {
        kind: GROUNDING_ANCHOR_ISSUE,
        ref: '#1, mmnto-ai/totem#2',
      },
    );
  });

  it('a bound record anchors `record` with the repo-relative path and the sha256 of its bytes', () => {
    expect(resolveGroundingAnchor([{ issue: null, freeText: null, record: makeRecord() }])).toEqual(
      {
        kind: GROUNDING_ANCHOR_RECORD,
        ref: '.totem/specs/2700.md',
        sha256: RECORD_SHA,
      },
    );
  });

  it('topics only anchor `free-text`, several joined with a pipe', () => {
    expect(resolveGroundingAnchor([topicInput('cache invalidation')])).toEqual({
      kind: GROUNDING_ANCHOR_FREE_TEXT,
      ref: 'cache invalidation',
    });
    expect(resolveGroundingAnchor([topicInput('alpha'), topicInput('beta')])).toEqual({
      kind: GROUNDING_ANCHOR_FREE_TEXT,
      ref: 'alpha | beta',
    });
  });

  it('issues AND topics anchor the honest `mixed` kind — issue refs first, then topics', () => {
    expect(
      resolveGroundingAnchor([issueInput(9, '9'), topicInput('alpha'), topicInput('beta')]),
    ).toEqual({
      kind: GROUNDING_ANCHOR_MIXED,
      ref: '#9 | alpha | beta',
    });
  });

  // A topic is the one anchor ref built out of raw argv, so it is the one that
  // can carry a control character the user typed. `GroundingAnchorSchema`
  // refuses such a ref — inside `saveRunArtifact`, under `runOrchestrator`'s
  // warn-and-continue catch, so the run would survive and only the ARTIFACT
  // would be silently lost. Collapsing at the mint site keeps the request
  // parsable for a ref the CLI itself produced.
  it.each([
    ['a tab', 0x09],
    ['a newline', 0x0a],
    ['a DEL', 0x7f],
    ['a C1 NEL', 0x85],
  ])('collapses %s in a free-text topic to `?`, keeping the anchor parsable', (_label, code) => {
    const topic = `cache${String.fromCharCode(code)}invalidation`;
    const anchor = resolveGroundingAnchor([topicInput(topic)]);
    expect(anchor).toEqual({ kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'cache?invalidation' });
    expect(GroundingAnchorSchema.safeParse(anchor).success).toBe(true);
  });

  it('leaves printable non-ASCII in a topic alone — a free-text ref is the topic AS TYPED', () => {
    expect(resolveGroundingAnchor([topicInput('ancrage café')]).ref).toBe('ancrage café');
  });

  it('collapses the topic half of a `mixed` ref too', () => {
    const anchor = resolveGroundingAnchor([
      issueInput(9, '9'),
      topicInput(`alpha${String.fromCharCode(0x0a)}beta`),
    ]);
    expect(anchor.ref).toBe('#9 | alpha?beta');
    expect(GroundingAnchorSchema.safeParse(anchor).success).toBe(true);
  });

  // The topic arm is not the only ref taken verbatim from argv. The issue-URL
  // match is NOT end-anchored (`.../issues/(\d+)` with trailing text allowed),
  // so `https://host/o/r/issues/1<newline>x` resolves to issue 1 and the typed
  // spelling — newline and all — becomes the ref. Unsanitized it costs the run
  // its artifact exactly as an unsanitized topic did.
  it('collapses a control character in a TYPED issue ref (the URL match is not end-anchored)', () => {
    const typed = `https://github.com/mmnto-ai/totem/issues/1${String.fromCharCode(0x0a)}[Totem] forged`;
    const anchor = resolveGroundingAnchor([issueInput(1, typed)]);

    expect(anchor).toEqual({
      kind: GROUNDING_ANCHOR_ISSUE,
      ref: 'https://github.com/mmnto-ai/totem/issues/1?[Totem] forged',
    });
    expect(GroundingAnchorSchema.safeParse(anchor).success).toBe(true);
  });

  it('leaves a printable typed issue ref byte-identical', () => {
    expect(resolveGroundingAnchor([issueInput(2700, 'mmnto-ai/totem#2700')]).ref).toBe(
      'mmnto-ai/totem#2700',
    );
  });
});

// ─── evaluateGroundingFloor (mmnto-ai/totem#2700) ────────

function relevantHit(relevance: number | undefined, overrides: Partial<SearchResult> = {}) {
  return makeSpec({
    ...(relevance !== undefined ? { relevance } : {}),
    ...overrides,
  });
}

const FLOOR = 0.25;
/** The floor's PLACE exactly as a refusal renders it (`FLOOR_PLACE` in spec.ts). */
const FLOOR_PLACE_TEXT = 'searchRelevanceFloor in totem.config.ts (schema default 0.25 when unset)';

describe('evaluateGroundingFloor', () => {
  it('0 retrieved items REFUSES — nothing grounds the run (the charter rule, not an MCP mirror)', () => {
    const verdict = evaluateGroundingFloor(emptyContext(), FLOOR);
    expect(verdict).toEqual({
      refuse: true,
      hits: 0,
      bestRelevance: null,
      withheld: [],
      floorExempt: 0,
    });
  });

  it('every signal-bearing hit below the floor, none exempt, REFUSES', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), specs: [relevantHit(0.2), relevantHit(0.11)] },
      FLOOR,
    );
    expect(verdict.refuse).toBe(true);
    expect(verdict.hits).toBe(2);
    expect(verdict.bestRelevance).toBeCloseTo(0.2, 10);
    expect(verdict.floorExempt).toBe(0);
  });

  it('one hit AT the floor PROCEEDS (the floor is inclusive)', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), specs: [relevantHit(0.1), relevantHit(FLOOR)] },
      FLOOR,
    );
    expect(verdict.refuse).toBe(false);
    expect(verdict.withheld).toEqual([]);
  });

  it('one floor-EXEMPT hit beside below-floor signal PROCEEDS (a keyword-only hit is never withheld for a weak sibling)', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), specs: [relevantHit(0.05)], code: [relevantHit(undefined)] },
      FLOOR,
    );
    expect(verdict.refuse).toBe(false);
    expect(verdict.floorExempt).toBe(1);
    expect(verdict.withheld).toEqual([]);
  });

  // Lessons are DELIVERED but never judged by the floor (mmnto-ai/totem#2735).
  // The gate was ruled over the spec/session/code partitions while the lesson
  // partition was structurally empty; feeding a now-populated one in would
  // silently loosen the refusal arm, since an FTS-only lesson is floor-EXEMPT
  // and `refuse` requires `floorExempt === 0`.
  it('a run whose ONLY retrieved item is an FTS-only lesson REFUSES as 0 hits', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), lessons: [relevantHit(undefined, { type: 'lesson' })] },
      FLOOR,
    );
    expect(verdict.refuse).toBe(true);
    expect(verdict.hits).toBe(0);
    expect(verdict.floorExempt).toBe(0);
    expect(verdict.bestRelevance).toBeNull();
  });

  it('a below-floor spec beside an FTS-only lesson still REFUSES (a lesson is not floor-exempt evidence)', () => {
    const verdict = evaluateGroundingFloor(
      {
        ...emptyContext(),
        specs: [relevantHit(0.05, { filePath: 'docs/weak.md' })],
        lessons: [relevantHit(undefined, { type: 'lesson' })],
      },
      FLOOR,
    );
    expect(verdict.refuse).toBe(true);
    expect(verdict.hits).toBe(1);
    expect(verdict.floorExempt).toBe(0);
    expect(verdict.withheld).toEqual([{ filePath: 'docs/weak.md', relevance: 0.05 }]);
  });

  it('an AT-floor spec beside lessons PROCEEDS, and the lessons are not counted as hits', () => {
    const verdict = evaluateGroundingFloor(
      {
        ...emptyContext(),
        specs: [relevantHit(FLOOR)],
        lessons: [relevantHit(undefined, { type: 'lesson' }), relevantHit(0.9, { type: 'lesson' })],
      },
      FLOOR,
    );
    // Delivery is not the gate: `retrieveContext` still returns those lessons
    // (see the lesson-delivery suite) and the executed-command suite proves
    // they reach the prompt. The floor simply never reads them.
    expect(verdict.refuse).toBe(false);
    expect(verdict.hits).toBe(1);
    expect(verdict.bestRelevance).toBeCloseTo(FLOOR, 10);
  });

  it('no relevance anywhere PROCEEDS — a pure-FTS corpus is never demoted', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), specs: [relevantHit(undefined), relevantHit(undefined)] },
      FLOOR,
    );
    expect(verdict.refuse).toBe(false);
    expect(verdict.bestRelevance).toBeNull();
    expect(verdict.floorExempt).toBe(2);
  });

  // A non-finite relevance is what the CORE builder drops: the item it writes
  // carries no relevance at all, exactly an FTS-only hit's shape. The floor
  // must read it the same way, or the artifact and the judgment disagree.
  it.each([NaN, Infinity, -Infinity])(
    'a non-finite relevance (%s) is floor-EXEMPT, never counted as signal',
    (relevance) => {
      const verdict = evaluateGroundingFloor(
        { ...emptyContext(), specs: [relevantHit(relevance)] },
        FLOOR,
      );
      expect(verdict.floorExempt).toBe(1);
      expect(verdict.bestRelevance).toBeNull();
      expect(verdict.withheld).toEqual([]);
      expect(verdict.refuse).toBe(false);
    },
  );

  it('a NaN hit beside a genuinely weak one is not disclosed as a withheld candidate', () => {
    const verdict = evaluateGroundingFloor(
      {
        ...emptyContext(),
        specs: [relevantHit(0.05, { filePath: 'docs/weak.md' }), relevantHit(NaN)],
      },
      FLOOR,
    );
    // One exempt hit is enough to proceed — and nothing is withheld.
    expect(verdict.floorExempt).toBe(1);
    expect(verdict.refuse).toBe(false);
    expect(verdict.withheld).toEqual([]);
  });

  // Was "counts hits across ALL FOUR partitions" when the lesson partition was
  // structurally empty and could not change the count. mmnto-ai/totem#2735
  // makes it populated, so the gate holds its ruled inputs: the three
  // partitions it was exercised over. A delivered lesson is counted on the
  // `Found:` line and in the artifact, never as a grounding hit.
  it('counts hits across the spec, session and code partitions — never lessons', () => {
    const verdict = evaluateGroundingFloor(
      {
        specs: [relevantHit(0.9)],
        sessions: [relevantHit(0.8)],
        code: [relevantHit(0.7)],
        lessons: [relevantHit(0.6, { type: 'lesson' })],
      },
      FLOOR,
    );
    expect(verdict.hits).toBe(3);
    expect(verdict.bestRelevance).toBeCloseTo(0.9, 10);
  });

  it('the withheld list carries every below-floor candidate as path + relevance (linked hits keep their store)', () => {
    const verdict = evaluateGroundingFloor(
      {
        ...emptyContext(),
        specs: [
          relevantHit(0.2, { filePath: 'docs/a.md' }),
          relevantHit(0.1, { filePath: 'doctrine/b.md', sourceRepo: 'strategy' }),
        ],
      },
      FLOOR,
    );
    expect(verdict.withheld).toEqual([
      { filePath: 'docs/a.md', relevance: 0.2 },
      { filePath: 'doctrine/b.md', sourceRepo: 'strategy', relevance: 0.1 },
    ]);
  });
});

// ─── formatGroundingRefusal (mmnto-ai/totem#2700) ────────

describe('formatGroundingRefusal', () => {
  it('a 0-hit refusal names the topic, the 0 hits, and the floor VALUE and PLACE', () => {
    const verdict = evaluateGroundingFloor(emptyContext(), FLOOR);
    const { message } = formatGroundingRefusal('an-unanchored-slug', verdict, FLOOR, 0);
    expect(message).toContain('an-unanchored-slug');
    expect(message).toContain('0 hits');
    expect(message).toContain(
      'floor 0.250 — searchRelevanceFloor in totem.config.ts (schema default 0.25 when unset)',
    );
  });

  // With lessons delivered, "nothing in the index grounds this run" sits beside
  // a `Found: … N lessons` line. The message names the contradiction rather
  // than leaving the reader to reconcile the two (mmnto-ai/totem#2735).
  it('a 0-hit refusal on a lesson-holding index names the lessons it did not judge', () => {
    // The seeded count IS the delivered count — the invariant production holds,
    // where the caller passes `context.lessons.length`.
    const lessons = [makeLesson(), makeLesson()];
    const verdict = evaluateGroundingFloor({ ...emptyContext(), lessons }, FLOOR);
    expect(verdict.hits).toBe(0);

    const { message } = formatGroundingRefusal(
      'an-unanchored-slug',
      verdict,
      FLOOR,
      lessons.length,
    );

    expect(message).toBe(
      [
        'Refusing to draft an unanchored spec for topic(s): an-unanchored-slug.',
        'Retrieval returned 0 grounding hits (specs, sessions, code) — nothing in the index grounds this run.',
        '2 lessons were retrieved, but lessons do not ground a run (mmnto-ai/totem#2727 rules whether they may).',
        `floor 0.250 — ${FLOOR_PLACE_TEXT}`,
      ].join('\n'),
    );
  });

  it('a single delivered lesson reads as one, not as "1 lessons"', () => {
    const verdict = evaluateGroundingFloor({ ...emptyContext(), lessons: [makeLesson()] }, FLOOR);

    const { message } = formatGroundingRefusal('an-unanchored-slug', verdict, FLOOR, 1);

    expect(message).toContain(
      '1 lesson was retrieved, but lessons do not ground a run (mmnto-ai/totem#2727 rules whether they may).',
    );
  });

  // Pinned against the LITERAL pre-mmnto-ai/totem#2735 message, not against a
  // sibling call: the guarantee is that this text did not move, and only an
  // exact comparison with the old bytes can say so.
  it('with NO lessons delivered the 0-hit message is the pre-fold text, byte for byte', () => {
    const verdict = evaluateGroundingFloor(emptyContext(), FLOOR);
    const { message } = formatGroundingRefusal('an-unanchored-slug', verdict, FLOOR, 0);
    expect(message).toBe(
      [
        'Refusing to draft an unanchored spec for topic(s): an-unanchored-slug.',
        'Retrieval returned 0 hits — nothing in the index grounds this run.',
        `floor 0.250 — ${FLOOR_PLACE_TEXT}`,
      ].join('\n'),
    );
  });

  it('the below-floor message is the pre-fold text whether or not lessons were delivered', () => {
    const verdict = evaluateGroundingFloor(
      { ...emptyContext(), specs: [relevantHit(0.2, { filePath: 'docs/a.md' })] },
      FLOOR,
    );
    const expected = [
      'Refusing to draft an unanchored spec for topic(s): weak topic.',
      'Retrieval returned 1 hits, but best relevance 0.200 is below the floor.',
      `floor 0.250 — ${FLOOR_PLACE_TEXT}`,
      'Withheld candidates (path + relevance only, no content):',
      '1. docs/a.md — relevance 0.200',
    ].join('\n');

    expect(formatGroundingRefusal('weak topic', verdict, FLOOR, 10).message).toBe(expected);
    expect(formatGroundingRefusal('weak topic', verdict, FLOOR, 0).message).toBe(expected);
  });

  it('a below-floor refusal names the best relevance and DISCLOSES every withheld candidate', () => {
    const verdict = evaluateGroundingFloor(
      {
        ...emptyContext(),
        specs: [
          relevantHit(0.2, { filePath: 'docs/a.md' }),
          relevantHit(0.1, { filePath: 'doctrine/b.md', sourceRepo: 'strategy' }),
        ],
      },
      FLOOR,
    );
    const { message } = formatGroundingRefusal('weak topic', verdict, FLOOR, 0);
    expect(message).toContain('best relevance 0.200');
    expect(message).toContain('1. docs/a.md — relevance 0.200');
    expect(message).toContain('2. [strategy] doctrine/b.md — relevance 0.100');
  });

  it('the hint names both cures and the --raw inspection path', () => {
    const { recoveryHint } = formatGroundingRefusal(
      'topic',
      evaluateGroundingFloor(emptyContext(), FLOOR),
      FLOOR,
      0,
    );
    expect(recoveryHint).toContain('totem spec <issue>');
    expect(recoveryHint).toContain('totem spec --from <record>');
    expect(recoveryHint).toContain('--raw');
  });
});

// ─── The record arm of assemblePrompt + its query ────────

describe('assemblePrompt — the record arm (mmnto-ai/totem#2700)', () => {
  it('renders the RECORD banner with the path and the digest head, and the body verbatim', async () => {
    const record = makeRecord({ body: '# Design record\n\nThe ruled contract.\n' });
    const result = await assemblePrompt(
      [{ issue: null, freeText: null, record }],
      emptyContext(),
      'system prompt',
    );
    expect(result).toContain(`=== RECORD .totem/specs/2700.md (sha256 ${'a'.repeat(12)}) ===`);
    expect(result).toContain('<record_body>');
    expect(result).toContain('The ruled contract.');
  });

  it('does not emit an ISSUE or TOPIC section for a record', async () => {
    const result = await assemblePrompt(
      [{ issue: null, freeText: null, record: makeRecord() }],
      emptyContext(),
      'system prompt',
    );
    expect(result).not.toContain('=== TOPIC ===');
    expect(result).not.toContain('=== ISSUE #');
  });
});

describe('buildRecordSearchQuery', () => {
  it('queries on the record`s first heading plus the head of its body', () => {
    const query = buildRecordSearchQuery(
      makeRecord({ body: '# Anchored evidence\n\nThe body head.\n' }),
    );
    expect(query.startsWith('Anchored evidence')).toBe(true);
    expect(query).toContain('The body head.');
  });

  it('degrades to the body head when the record carries no heading', () => {
    const query = buildRecordSearchQuery(makeRecord({ body: 'no heading at all' }));
    expect(query).toBe('no heading at all');
  });
});

// ─── --from validation (mmnto-ai/totem#2700) ─────────────

describe('validateSpecInvocation', () => {
  it('refuses no inputs and no --from, carrying the usage line', () => {
    let thrown: unknown;
    try {
      validateSpecInvocation([], {}, TotemConfigError);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(String((thrown as Error).message)).toContain('at least one issue/topic');
    expect(String((thrown as { recoveryHint: string }).recoveryHint)).toContain(
      'Usage: totem spec [inputs...] [--from <record>]',
    );
  });

  it('refuses --from together with positional inputs', () => {
    expect(() =>
      validateSpecInvocation(['2700'], { from: 'record.md' }, TotemConfigError),
    ).toThrowError(/--from <record> cannot be combined with positional inputs/);
  });

  it('accepts inputs alone and --from alone', () => {
    expect(() => validateSpecInvocation(['2700'], {}, TotemConfigError)).not.toThrow();
    expect(() => validateSpecInvocation([], { from: 'record.md' }, TotemConfigError)).not.toThrow();
  });
});

/**
 * Whether this platform (and this account) can make each link kind — a Windows
 * account without SeCreateSymbolicLinkPrivilege cannot symlink, and a
 * filesystem without hardlinks cannot link. Probed ONCE, outside any test, so
 * every `skipIf` below is a real capability check rather than a swallowed
 * failure inside an assertion. Shared by the containment suite (`loadSpecRecord`
 * must see THROUGH a link) and the `--out` alias suite (a link is a second name
 * for the record).
 */
const linkable = ((): { hard: boolean; sym: boolean } => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-link-probe-'));
  const target = path.join(probeDir, 'target');
  fs.writeFileSync(target, 'probe');
  const attempt = (make: () => void): boolean => {
    try {
      make();
      return true;
    } catch (err) {
      void err;
      return false;
    }
  };
  const hard = attempt(() => fs.linkSync(target, path.join(probeDir, 'hard')));
  const sym = attempt(() => fs.symlinkSync(target, path.join(probeDir, 'sym')));
  cleanTmpDir(probeDir);
  return { hard, sym };
})();

describe('loadSpecRecord', () => {
  let tmpDir: string;
  const deps = { resolveGitRoot: () => null };

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-spec-record-')));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('binds the record: repo-relative forward-slash path, sha256 of the bytes, the body from the SAME buffer', () => {
    const nested = path.join(tmpDir, '.totem', 'specs');
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(nested, '2700.md');
    const bytes = Buffer.from('# Record\n\nBody.\n', 'utf-8');
    fs.writeFileSync(file, bytes);

    const loaded = loadSpecRecord(file, tmpDir, deps, TotemConfigError);
    expect(loaded.record.path).toBe('.totem/specs/2700.md');
    expect(loaded.record.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(loaded.record.body).toBe(bytes.toString('utf-8'));
    expect(loaded.absolutePath).toBe(path.resolve(file));
  });

  it('refuses a missing path, naming it', () => {
    const missing = path.join(tmpDir, 'nope.md');
    let thrown: unknown;
    try {
      loadSpecRecord(missing, tmpDir, deps, TotemConfigError);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(String((thrown as Error).message)).toContain('--from record not found');
    expect(String((thrown as Error).message)).toContain(missing);
  });

  it('refuses a directory', () => {
    const dir = path.join(tmpDir, 'adir');
    fs.mkdirSync(dir);
    expect(() => loadSpecRecord(dir, tmpDir, deps, TotemConfigError)).toThrowError(
      /--from record is not a file/,
    );
  });

  it('refuses an empty record', () => {
    const file = path.join(tmpDir, 'empty.md');
    fs.writeFileSync(file, '');
    expect(() => loadSpecRecord(file, tmpDir, deps, TotemConfigError)).toThrowError(
      /--from record is empty/,
    );
  });

  it('refuses a whitespace-only record', () => {
    const file = path.join(tmpDir, 'blank.md');
    fs.writeFileSync(file, '   \n\t\n  \n');
    expect(() => loadSpecRecord(file, tmpDir, deps, TotemConfigError)).toThrowError(
      /--from record is empty/,
    );
  });

  // ── The ref is relative to the GIT ROOT, not the cwd (mmnto-ai/totem#2700) ──
  //
  // Every case above stubs `resolveGitRoot: () => null`, which collapses root
  // and cwd and leaves the git-root half of the path untested. The pre-commit
  // reader resolves the ref from the WORKTREE TOP, so a `root = cwd` mutation
  // would publish a ref no hook could open.

  it('binds the ref against the git root even when the command runs from a subdirectory', () => {
    const sub = path.join(tmpDir, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    const nested = path.join(tmpDir, '.totem', 'specs');
    fs.mkdirSync(nested, { recursive: true });
    const file = path.join(nested, 'x.md');
    fs.writeFileSync(file, '# X\n\nBody.\n');

    const loaded = loadSpecRecord(file, sub, { resolveGitRoot: () => tmpDir }, TotemConfigError);

    // A `root = cwd` mutation yields `../.totem/specs/x.md` — and would now be
    // refused outright by the containment gate below.
    expect(loaded.record.path).toBe('.totem/specs/x.md');
  });

  // ── Containment: the record must live inside the git root ──

  it('refuses a record OUTSIDE the git root, naming the path and the root', () => {
    const root = path.join(tmpDir, 'repo');
    fs.mkdirSync(root, { recursive: true });
    const outside = path.join(tmpDir, 'sibling.md');
    fs.writeFileSync(outside, '# S\n\nBody.\n');

    let thrown: unknown;
    try {
      loadSpecRecord('../sibling.md', root, { resolveGitRoot: () => root }, TotemConfigError);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
    const message = String((thrown as Error).message);
    expect(message).toContain('outside the repository');
    expect(message).toContain(outside);
    expect(message).toContain(root);
  });

  it('a file named `..notes.md` INSIDE the root is contained and binds normally', () => {
    const file = path.join(tmpDir, '..notes.md');
    fs.writeFileSync(file, '# N\n\nBody.\n');

    const loaded = loadSpecRecord(file, tmpDir, { resolveGitRoot: () => tmpDir }, TotemConfigError);
    expect(loaded.record.path).toBe('..notes.md');
  });

  // Containment must run BEFORE the record is stat'd or read: otherwise the
  // out-of-root refusal is decided by whatever the read happens to say, and a
  // path that escapes the repo surfaces as "not a file" (or an EISDIR-class
  // read error) rather than as the containment refusal that carries the cure.
  it('an out-of-root DIRECTORY is refused as uncontained, not as "not a file"', () => {
    const root = path.join(tmpDir, 'repo');
    fs.mkdirSync(root, { recursive: true });
    const outsideDir = path.join(tmpDir, 'sibling-dir');
    fs.mkdirSync(outsideDir, { recursive: true });

    let thrown: unknown;
    try {
      loadSpecRecord('../sibling-dir', root, { resolveGitRoot: () => root }, TotemConfigError);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
    const message = String((thrown as Error).message);
    expect(message).toContain('outside the repository');
    expect(message).not.toContain('is not a file');
  });

  // ── Containment sees THROUGH a link (mmnto-ai/totem#2700) ──
  //
  // A symlink inside the repo is lexically contained, so normalization alone
  // reads it as legal — and would publish a ref the pre-commit reader resolves
  // to a file outside the tree. Containment therefore also compares the two
  // REALPATHS. `record.path` still carries the LEXICAL spelling of the file as
  // given: the hook resolves links on its own side, and rewriting the ref to a
  // link's target would publish a path the operator never wrote.

  it.skipIf(!linkable.sym)(
    'refuses an in-repo SYMLINK whose target is OUTSIDE the root, naming both paths',
    () => {
      const root = path.join(tmpDir, 'repo');
      fs.mkdirSync(root, { recursive: true });
      const outside = path.join(tmpDir, 'outside.md');
      fs.writeFileSync(outside, '# Outside\n\nBody.\n');
      const link = path.join(root, 'linked.md');
      fs.symlinkSync(outside, link);

      let thrown: unknown;
      try {
        loadSpecRecord('linked.md', root, { resolveGitRoot: () => root }, TotemConfigError);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toMatchObject({ code: 'CONFIG_INVALID' });
      const message = String((thrown as Error).message);
      expect(message).toContain('outside the repository');
      // The link as given AND what it resolves to — the second is the whole
      // reason the first was refused. The resolved form is the filesystem's
      // canonical path (a Windows runner's temp dir is handed out as an 8.3
      // short name like RUNNER~1, which realpath expands), so compare against
      // the same canonicalization the code applies, never the raw temp path.
      expect(message).toContain(link);
      expect(message).toContain(`resolves to ${fs.realpathSync.native(outside)}`);
    },
  );

  it.skipIf(!linkable.sym)(
    'accepts an in-repo SYMLINK to an in-repo file, binding the LEXICAL path',
    () => {
      const root = path.join(tmpDir, 'repo');
      const nested = path.join(root, '.totem', 'specs');
      fs.mkdirSync(nested, { recursive: true });
      const target = path.join(nested, '2700.md');
      fs.writeFileSync(target, '# Record\n\nBody.\n');
      const link = path.join(root, 'linked.md');
      fs.symlinkSync(target, link);

      const loaded = loadSpecRecord(
        'linked.md',
        root,
        { resolveGitRoot: () => root },
        TotemConfigError,
      );
      expect(loaded.record.path).toBe('linked.md');
      expect(loaded.record.body).toBe('# Record\n\nBody.\n');
    },
  );

  // ── A leading BOM is a decoding artifact, not part of the document ──

  it('strips ONE leading BOM from the body while hashing the RAW bytes', () => {
    const file = path.join(tmpDir, 'bom.md');
    // Built numerically: an authored `\u` escape lands in a source file as a
    // raw control byte through some editing paths (mmnto-ai/totem#2692).
    const bom = String.fromCharCode(0xfeff);
    const text = `${bom}# Anchored evidence\n\nThe body head.\n`;
    const bytes = Buffer.from(text, 'utf-8');
    fs.writeFileSync(file, bytes);

    const loaded = loadSpecRecord(file, tmpDir, deps, TotemConfigError);

    // The body the prompt and the query see opens on the heading itself.
    expect(loaded.record.body.startsWith('#')).toBe(true);
    expect(loaded.record.body).toBe('# Anchored evidence\n\nThe body head.\n');
    expect(buildRecordSearchQuery(loaded.record).startsWith('Anchored evidence')).toBe(true);
    // The digest is over the RAW bytes, BOM included: the pre-commit reader
    // hashes the file as it sits on disk, so a stripped-before-hash digest
    // would read as "revised since binding" on the very first commit.
    expect(loaded.record.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(loaded.record.sha256).not.toBe(
      crypto.createHash('sha256').update(Buffer.from(loaded.record.body, 'utf-8')).digest('hex'),
    );
  });

  it('renders a BOM-prefixed record into the prompt with no mark in record_body', async () => {
    const file = path.join(tmpDir, 'bom-prompt.md');
    const bom = String.fromCharCode(0xfeff);
    fs.writeFileSync(file, `${bom}# Anchored evidence\n\nThe body head.\n`, 'utf-8');

    const loaded = loadSpecRecord(file, tmpDir, deps, TotemConfigError);
    const prompt = await assemblePrompt(
      [{ issue: null, freeText: null, record: loaded.record }],
      emptyContext(),
      'SYSTEM',
    );

    expect(prompt).toContain(`<record_body>\n${loaded.record.body}\n</record_body>`);
    expect(prompt).toContain('<record_body>\n# Anchored evidence');
    expect(prompt).not.toContain(bom);
  });
});

describe('isRecordPathOutsideRoot', () => {
  // The cross-drive arm (`path.relative` returning an ABSOLUTE path when the
  // record lives on another volume) cannot be staged portably through
  // loadSpecRecord, so the predicate is exercised directly. It consults both
  // path flavors because its input is already normalized to forward slashes:
  // `D:/x.md` is not a repo-relative path on any platform.
  // `a/../../x.md` is the case a first-segment test misses: it escapes the root
  // without SAYING `..` first. The strict pre-commit reader is probed with the
  // same shape (resolved against the worktree top), so neither side can be the
  // looser of the two.
  it.each([
    '..',
    '../sibling.md',
    '../../etc/passwd',
    'a/../../x.md',
    '/etc/passwd',
    'D:/records/x.md',
  ])('refuses %s as outside the root', (relativePath) => {
    expect(isRecordPathOutsideRoot(relativePath)).toBe(true);
  });

  it.each(['.totem/specs/2700.md', '..notes.md', 'a/../b.md', 'x.md'])(
    'accepts %s as contained',
    (relativePath) => {
      expect(isRecordPathOutsideRoot(relativePath)).toBe(false);
    },
  );
});

describe('assertOutDoesNotOverwriteRecord', () => {
  it('refuses an --out that resolves to the record — never drafts over it', () => {
    expect(() =>
      assertOutDoesNotOverwriteRecord(
        './specs/2700.md',
        path.resolve('/repo', 'specs/2700.md'),
        '/repo',
        TotemConfigError,
      ),
    ).toThrowError(/never drafts over the record/);
  });

  it('allows any other --out, and a missing --out', () => {
    expect(() =>
      assertOutDoesNotOverwriteRecord(
        'draft.md',
        path.resolve('/repo', 'specs/2700.md'),
        '/repo',
        TotemConfigError,
      ),
    ).not.toThrow();
    expect(() =>
      assertOutDoesNotOverwriteRecord(
        undefined,
        path.resolve('/repo', 'specs/2700.md'),
        '/repo',
        TotemConfigError,
      ),
    ).not.toThrow();
  });

  // ── Aliases: a second NAME for the record is still the record ──
  //
  // The path-spelling comparison alone is defeated by either link kind: a
  // symlink has a different resolved path, and a hardlink's two names share no
  // path relationship at all — both would let the draft clobber the record.

  describe('link aliases', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-out-alias-')));
    });

    afterEach(() => {
      cleanTmpDir(tmpDir);
    });

    /** The record, written fresh, plus the absolute path of a would-be alias. */
    function stage(aliasName: string): { record: string; alias: string } {
      const record = path.join(tmpDir, 'record.md');
      fs.writeFileSync(record, '# Record\n\nThe ruled contract.\n');
      return { record, alias: path.join(tmpDir, aliasName) };
    }

    it.skipIf(!linkable.hard)(
      'refuses a HARDLINK to the record — the two names share an inode, not a path',
      () => {
        const { record, alias } = stage('hard-alias.md');
        fs.linkSync(record, alias);

        expect(() =>
          assertOutDoesNotOverwriteRecord(alias, record, tmpDir, TotemConfigError),
        ).toThrowError(/never drafts over the record/);
      },
    );

    it.skipIf(!linkable.sym)('refuses a SYMLINK to the record', () => {
      const { record, alias } = stage('sym-alias.md');
      fs.symlinkSync(record, alias);

      expect(() =>
        assertOutDoesNotOverwriteRecord(alias, record, tmpDir, TotemConfigError),
      ).toThrowError(/never drafts over the record/);
    });

    it('an unrelated EXISTING file beside the record is still allowed', () => {
      const { record, alias } = stage('other.md');
      fs.writeFileSync(alias, 'a different file\n');

      expect(() =>
        assertOutDoesNotOverwriteRecord(alias, record, tmpDir, TotemConfigError),
      ).not.toThrow();
    });

    it('a --out that does not exist yet is allowed (the common case)', () => {
      const { record, alias } = stage('not-yet.md');

      expect(() =>
        assertOutDoesNotOverwriteRecord(alias, record, tmpDir, TotemConfigError),
      ).not.toThrow();
    });
  });
});

// ─── specCommand, executed (mmnto-ai/totem#2700) ─────────

describe('specCommand — anchored evidence, executed against stubbed seams', () => {
  let tmpDir: string;
  let originalCwd: string;
  /** Every `log.warn` message the command emitted, in order. */
  let warnings: string[] = [];
  /** Every `log.dim` message the command emitted, in order. */
  let dims: string[] = [];

  /** Files currently under the run store the orchestrator would write to. */
  function runArtifactNames(): string[] {
    const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  }

  function writeRecord(body: string, name = 'record.md'): string {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, body, 'utf-8');
    return file;
  }

  function sha256Of(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }

  /** The artifact request the (single) orchestrator call carried. */
  function artifactRequest(): Record<string, unknown> {
    expect(harness.orchestratorArgs.length).toBe(1);
    return harness.orchestratorArgs[0]!['artifact'] as Record<string, unknown>;
  }

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-spec-cmd-')));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    harness.searchResults = {};
    harness.searchTypeFilters = [];
    harness.orchestratorArgs = [];
    harness.orchestratorContent = 'DRAFT';
    harness.connects = 0;
    harness.writes = [];
    harness.config = {
      totemDir: '.totem',
      lanceDir: '.lancedb',
      searchRelevanceFloor: FLOOR,
      embedding: { provider: 'gemini', model: 'test' },
    };
    warnings = [];
    dims = [];
    vi.spyOn(log, 'warn').mockImplementation((_tag: string, msg: string) => {
      warnings.push(msg);
    });
    vi.spyOn(log, 'dim').mockImplementation((_tag: string, msg: string) => {
      dims.push(msg);
    });
    vi.spyOn(log, 'info').mockImplementation(() => {});
    vi.spyOn(log, 'success').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('refuses "no inputs and no --from" BEFORE the store connects', async () => {
    await expect(specCommand([], {})).rejects.toThrowError(/at least one issue\/topic/);
    expect(harness.connects).toBe(0);
    expect(harness.orchestratorArgs).toEqual([]);
  });

  it.each([
    ['a missing record', () => path.join(tmpDir, 'nope.md'), /--from record not found/],
    [
      'a directory',
      () => {
        const dir = path.join(tmpDir, 'adir');
        fs.mkdirSync(dir);
        return dir;
      },
      /--from record is not a file/,
    ],
    ['an empty record', () => writeRecord(''), /--from record is empty/],
    ['a whitespace-only record', () => writeRecord('  \n \n'), /--from record is empty/],
  ])('refuses %s BEFORE the store connects and before any LLM call', async (_label, make, re) => {
    await expect(specCommand([], { from: make() })).rejects.toThrowError(re);
    expect(harness.connects).toBe(0);
    expect(harness.orchestratorArgs).toEqual([]);
    expect(runArtifactNames()).toEqual([]);
  });

  it('refuses --from together with positional inputs BEFORE the store connects', async () => {
    const record = writeRecord('# R\n\nbody\n');
    await expect(specCommand(['2700'], { from: record })).rejects.toThrowError(
      /cannot be combined with positional inputs/,
    );
    expect(harness.connects).toBe(0);
    expect(harness.orchestratorArgs).toEqual([]);
  });

  it('refuses an --out that resolves to the record BEFORE the store connects', async () => {
    const record = writeRecord('# R\n\nbody\n');
    await expect(specCommand([], { from: record, out: record })).rejects.toThrowError(
      /never drafts over the record/,
    );
    expect(harness.connects).toBe(0);
    expect(harness.orchestratorArgs).toEqual([]);
    expect(runArtifactNames()).toEqual([]);
  });

  it('asks the store for lessons and carries them into the prompt (mmnto-ai/totem#2735)', async () => {
    harness.searchResults = {
      spec: [relevantHit(0.7)],
      lesson: [
        relevantHit(0.7, {
          type: 'lesson',
          label: 'Lesson A',
          filePath: '.totem/lessons/lesson-abc.md',
          content: 'Always validate input at boundaries.',
        }),
      ],
    };

    await specCommand(['2735'], { stdout: true });

    expect(harness.searchTypeFilters).toContain('lesson');
    const prompt = String(harness.orchestratorArgs[0]!['prompt']);
    // The real section header (`formatLessonSection` in utils.ts), not the bare
    // phrase — the system prompt carries "RELEVANT LESSONS" on its own, so a
    // `toContain` on that alone passes with zero lessons delivered.
    expect(prompt).toContain('=== RELEVANT LESSONS (HARD CONSTRAINTS) ===');
    expect(prompt).toContain('Always validate input at boundaries.');
  });

  it('a --from run anchors on the record, leaves its bytes UNCHANGED, and drafts to stdout', async () => {
    const record = writeRecord('# Design record\n\nThe ruled contract.\n');
    const before = sha256Of(record);
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand([], { from: record, stdout: true });

    expect(sha256Of(record)).toBe(before);
    const artifact = artifactRequest();
    expect(artifact['anchor']).toEqual({
      kind: GROUNDING_ANCHOR_RECORD,
      ref: 'record.md',
      sha256: before,
    });
    expect(artifact['floor']).toBe(FLOOR);
    expect(harness.orchestratorArgs[0]!['runMetadata']).toMatchObject({
      caller: 'spec',
      promptSource: PROMPT_SOURCE_BUILTIN,
    });
    // The prompt carries the very bytes the digest binds — the WHOLE record,
    // not a fragment of it. A `toContain` on one sentence would still pass if
    // the record were truncated or re-wrapped on the way into the prompt, and
    // `anchor.sha256` would then name bytes the model never saw.
    const prompt = String(harness.orchestratorArgs[0]!['prompt']);
    const bytes = fs.readFileSync(record, 'utf-8');
    expect(prompt).toContain(`<record_body>\n${bytes}\n</record_body>`);
    expect(harness.writes).toEqual([{ content: 'DRAFT' }]);
  });

  it('a --from run without --out or --stdout says there is NO derived path for a record', async () => {
    const record = writeRecord('# R\n\nbody\n');
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand([], { from: record });

    expect(harness.writes).toEqual([{ content: 'DRAFT' }]);
    expect(dims).toContain('No derived path for a record — use --out <path> to keep the draft.');
  });

  it('records promptSource "override" when a custom system prompt drafted the run', async () => {
    const promptsDir = path.join(tmpDir, '.totem', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'spec.md'), '# Custom prompt\n', 'utf-8');
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand(['2700'], { stdout: true });

    expect(harness.orchestratorArgs[0]!['runMetadata']).toMatchObject({
      promptSource: PROMPT_SOURCE_OVERRIDE,
    });
  });

  it('an ISSUE-anchored run proceeds with anchor kind `issue` and emits NO not-evidence warning', async () => {
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand(['2700'], { stdout: true });

    expect(artifactRequest()['anchor']).toEqual({ kind: GROUNDING_ANCHOR_ISSUE, ref: '#2700' });
    expect(warnings.some((line) => line.includes('NOT gate evidence'))).toBe(false);
  });

  it('a free-text run above the floor PROCEEDS but is warned as NOT gate evidence', async () => {
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand(['some topic'], { stdout: true });

    expect(artifactRequest()['anchor']).toEqual({
      kind: GROUNDING_ANCHOR_FREE_TEXT,
      ref: 'some topic',
    });
    expect(warnings.some((line) => line.includes('NOT gate evidence'))).toBe(true);
    expect(warnings.some((line) => line.includes(GROUNDING_ANCHOR_FREE_TEXT))).toBe(true);
  });

  it('an issue + topic run anchors `mixed`, proceeds, and is warned as NOT gate evidence', async () => {
    harness.searchResults = { spec: [relevantHit(0.7)] };

    await specCommand(['2700', 'a loose topic'], { stdout: true });

    expect(artifactRequest()['anchor']).toEqual({
      kind: GROUNDING_ANCHOR_MIXED,
      ref: '#2700 | a loose topic',
    });
    expect(warnings.some((line) => line.includes(GROUNDING_ANCHOR_MIXED))).toBe(true);
    expect(warnings.some((line) => line.includes('NOT gate evidence'))).toBe(true);
  });

  // "Mints nothing" is proved by the orchestrator never being REACHED —
  // `runOrchestrator` is the only writer of a run artifact and it is stubbed
  // here, so a run-store file count could not fail whatever the command did.
  it('a free-text run with 0 hits REFUSES and mints nothing (the orchestrator is never reached)', async () => {
    await expect(specCommand(['nonsense slug'], { stdout: true })).rejects.toThrowError(
      /Retrieval returned 0 hits/,
    );
    expect(harness.orchestratorArgs).toEqual([]);
  });

  // The WIRING, not the formatter: this is the only test that fails if the
  // caller stops passing `context.lessons.length` (a literal 0 there leaves
  // every formatter-level test green). One delivered lesson, no spec/session/
  // code rows — the count in the refusal has to come from the delivered pool.
  it('a free-text run with 0 grounding hits carries the DELIVERED lesson count into the refusal', async () => {
    harness.searchResults = { lesson: [makeLesson()] };

    await expect(specCommand(['nonsense slug'], { stdout: true })).rejects.toThrowError(
      /1 lesson was retrieved, but lessons do not ground a run/,
    );
    expect(harness.orchestratorArgs).toEqual([]);
  });

  it('a free-text run entirely below the floor REFUSES, naming the floor and every withheld candidate', async () => {
    harness.searchResults = { spec: [relevantHit(0.1, { filePath: 'docs/a.md' })] };
    let thrown: unknown;
    try {
      await specCommand(['weak slug'], { stdout: true });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ code: 'GATE_INVALID' });
    const message = String((thrown as Error).message);
    expect(message).toContain('weak slug');
    expect(message).toContain('best relevance 0.100');
    expect(message).toContain(
      'floor 0.250 — searchRelevanceFloor in totem.config.ts (schema default 0.25 when unset)',
    );
    expect(message).toContain('docs/a.md — relevance 0.100');
    expect(harness.orchestratorArgs).toEqual([]);
  });

  it('an ISSUE-anchored run with 0 hits is NEVER refused (an issue is grounding)', async () => {
    await specCommand(['2700'], { stdout: true });
    expect(harness.orchestratorArgs.length).toBe(1);
  });

  it('a --from run with 0 hits is NEVER refused (a record is grounding)', async () => {
    const record = writeRecord('# R\n\nbody\n');
    await specCommand([], { from: record, stdout: true });
    expect(harness.orchestratorArgs.length).toBe(1);
  });

  it('--raw is EXEMPT from the refusal: it reaches the orchestrator, which prints context and mints nothing', async () => {
    await specCommand(['nonsense slug'], { raw: true });
    expect(harness.orchestratorArgs.length).toBe(1);
    expect(harness.orchestratorArgs[0]!['options']).toMatchObject({ raw: true });
  });

  it('the proceed path records the floor it was judged against on the artifact', async () => {
    harness.config = { ...harness.config, searchRelevanceFloor: 0.6 };
    harness.searchResults = { spec: [relevantHit(0.9)] };
    await specCommand(['2700'], { stdout: true });
    expect(artifactRequest()['floor']).toBe(0.6);
  });
});

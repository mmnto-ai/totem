import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('@mmnto/totem', async () => {
  const { z } = await import('zod');
  return {
    acquireLock: vi.fn(async () => vi.fn()),
    generateLessonHeading: vi.fn((body: string) => body.slice(0, 40)),
    // No live full-sync epoch in these tests — the convenience sync runs
    // (the #2562 deferral path has its own dedicated tests below).
    hasFullSyncCheckpoint: vi.fn(() => false),
    sanitize: vi.fn((t: string) => t),
    // Stand-in with the fields add_lesson reads (mmnto-ai/totem#3009); the
    // real class is covered in core and in context-linked-rebuild.test.ts.
    StoreNeedsRebuildError: class StoreNeedsRebuildError extends Error {
      readonly code = 'STORE_NEEDS_REBUILD';
      constructor(
        readonly detail: string,
        readonly recoveryHint: string,
      ) {
        super(`[Totem Error] ${detail} A reader does not rebuild the store. ${recoveryHint}`);
        this.name = 'StoreNeedsRebuildError';
      }
    },
    writeLessonFileAsync: vi.fn(async (_dir: string, entry: string) => {
      lastWrittenEntry = entry;
      return '/fake/lessons/lesson-001.md';
    }),
    // Real enum so AddLessonInputSchema validation behaves authentically
    // for applies_to coverage (item 020).
    LessonRoleSchema: z.enum([
      'mutator',
      'boundary',
      'aggregator',
      'hot-path',
      'boundary-test',
      'infrastructure',
      'presentation',
      'any',
    ]),
  };
});

/** The absolute CLI entry the mocked resolver returns on a hit (mmnto-ai/totem#3008). */
const FAKE_ENTRY = '/fake/project/node_modules/@mmnto/cli/dist/index.js';
const RESOLVED_HIT = { ok: true as const, entry: FAKE_ENTRY, version: '9.9.9', tier: 'pinned' };
let mockResolution: unknown = RESOLVED_HIT;

vi.mock('@mmnto/totem/cli-resolve', () => ({
  resolveTotemCli: vi.fn(() => mockResolution),
}));

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => ({
    projectRoot: '/fake/project',
    config: { totemDir: '.totem', lanceDir: '.totem/.lance' },
  })),
  getProjectBasics: vi.fn(async () => ({
    projectRoot: '/fake/project',
    config: { totemDir: '.totem', lanceDir: '.totem/.lance' },
  })),
  reconnectStore: vi.fn(async () => undefined),
}));

vi.mock('../xml-format.js', () => ({
  formatXmlResponse: vi.fn((_tag: string, msg: string) => msg),
}));

// Stub fs.promises.mkdir so the handler doesn't hit the real filesystem
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    default: {
      ...actual,
      promises: { ...actual.promises, mkdir: vi.fn(async () => undefined) },
      existsSync: vi.fn(() => true),
    },
    promises: { ...actual.promises, mkdir: vi.fn(async () => undefined) },
    existsSync: vi.fn(() => true),
  };
});

// Stub child_process.spawn so runSync never actually spawns
vi.mock('node:child_process', () => {
  const { EventEmitter } = require('node:events');
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter();
      child.pid = 12345;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      // Default: instant success. The mmnto-ai/totem#3012 outcome tests set
      // `spawnBehavior` to a failed exit, a spawn error, or a hang (timeout).
      if (spawnBehavior === 'fail') {
        setTimeout(() => {
          child.stderr.emit('data', Buffer.from('embedder exploded'));
          child.emit('close', 1);
        }, 0);
      } else if (spawnBehavior === 'spawn-error') {
        setTimeout(() => child.emit('error', new Error('ENOENT pnpm')), 0);
      } else if (spawnBehavior === 'ok') {
        setTimeout(() => child.emit('close', 0), 0);
      }
      return child;
    }),
  };
});

let spawnBehavior: 'ok' | 'fail' | 'spawn-error' | 'hang' = 'ok';

// ---------------------------------------------------------------------------
// Imports (after mocks are in place)
// ---------------------------------------------------------------------------

import { _resetRateLimit, registerAddLesson } from './add-lesson.js';

let lastWrittenEntry = '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register the tool and capture its handler. */
function setup(): (args: Record<string, unknown>) => Promise<unknown> {
  const fakeServer = {
    registerTool: (_name: string, _opts: unknown, handler: unknown) => {
      capturedHandler = handler as (args: Record<string, unknown>) => Promise<unknown>;
    },
  };
  registerAddLesson(fakeServer as never);
  return capturedHandler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('add_lesson auth model (#844)', () => {
  let handle: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    _resetRateLimit();
    lastWrittenEntry = '';
    handle = setup();
  });

  // --- Schema validation ---

  it('rejects lesson with empty heading (empty lesson string)', async () => {
    const result = (await handle({ lesson: '', context_tags: ['tag'] })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Validation error');
    expect(result.content[0]!.text).toContain('non-empty');
  });

  it('rejects lesson with empty body', async () => {
    const result = (await handle({ lesson: '', context_tags: ['test'] })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Validation error');
  });

  it('rejects lesson with no tags', async () => {
    const result = (await handle({ lesson: 'Some lesson body', context_tags: [] })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Validation error');
    expect(result.content[0]!.text).toContain('At least one context tag');
  });

  // --- Rate limiting ---

  it('rejects after rate limit exceeded', async () => {
    // Add 25 lessons successfully
    for (let i = 0; i < 25; i++) {
      const res = (await handle({
        lesson: `Lesson number ${i + 1}`,
        context_tags: ['test'],
      })) as { isError?: boolean };
      expect(res.isError).toBeUndefined();
    }

    // 26th should fail
    const result = (await handle({
      lesson: 'One too many',
      context_tags: ['test'],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Rate limit exceeded: maximum 25 lessons per session');
  });

  // --- Source provenance ---

  it('adds source provenance to written lesson', async () => {
    await handle({ lesson: 'Cache invalidation is hard', context_tags: ['caching'] });
    expect(lastWrittenEntry).toContain('**Source:** mcp (added at ');
    // Verify it looks like an ISO timestamp
    const match = lastWrittenEntry.match(/added at (\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
    expect(match).not.toBeNull();
  });

  // --- applies_to (strategy item 020) ---

  it('omits **Applies-to:** line when applies_to is not provided', async () => {
    await handle({ lesson: 'No role declared', context_tags: ['test'] });
    expect(lastWrittenEntry).not.toContain('**Applies-to:**');
  });

  it('serializes applies_to as kebab-case **Applies-to:** prose line', async () => {
    await handle({
      lesson: 'A mutator-only lesson',
      context_tags: ['determinism'],
      applies_to: ['mutator', 'boundary'],
    });
    expect(lastWrittenEntry).toContain('**Applies-to:** mutator, boundary');
  });

  it('rejects unknown role in applies_to', async () => {
    const result = (await handle({
      lesson: 'Bad role',
      context_tags: ['test'],
      applies_to: ['mutator', 'database'],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Validation error');
  });

  it('rejects empty applies_to array', async () => {
    const result = (await handle({
      lesson: 'Empty role list',
      context_tags: ['test'],
      applies_to: [],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Validation error');
  });

  // --- Heading sanitization ---

  it('sanitizes heading of XML-like content', async () => {
    // generateLessonHeading mock returns the first 40 chars of the body
    // We feed it a body that starts with XML-like tags so the heading will contain them
    await handle({
      lesson: '<script>alert("xss")</script> real lesson content here',
      context_tags: ['security'],
    });

    // The heading in the written entry should have < and > stripped
    // The heading comes from generateLessonHeading which returns first 40 chars
    expect(lastWrittenEntry).toContain('## Lesson — ');
    // Should NOT contain raw < or > in the heading line
    const headingLine = lastWrittenEntry.split('\n')[0]!;
    expect(headingLine).not.toMatch(/<(?!\/)/); // no opening angle brackets
    expect(headingLine).not.toContain('>');
  });

  // --- Spawn options (#1023; no shell since mmnto-ai/totem#3008) ---

  it('passes env to spawn and no shell (node runs the entry directly)', async () => {
    const { spawn } = await import('node:child_process');

    await handle({ lesson: 'Windows compat test', context_tags: ['test'] });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    const opts = lastCall[2] as Record<string, unknown>;
    const env = opts.env as Record<string, unknown>;
    expect(env).toBeDefined();
    expect(Object.keys(env).some((k) => k.toLowerCase() === 'path')).toBe(true);
    expect(opts.shell).toBeFalsy();
  });

  // --- The resolved CLI (mmnto-ai/totem#3008) ---

  it('the sync spawns node with the resolved entry, never a package manager, npx, a bare totem or a shell', async () => {
    const { spawn } = await import('node:child_process');
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;

    await handle({ lesson: 'Resolved sync', context_tags: ['test'] });

    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore + 1);
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([FAKE_ENTRY, 'sync', '--incremental']);
    for (const arg of args as string[]) {
      expect(['npx', 'pnpm', 'yarn', 'totem']).not.toContain(arg);
    }
    expect((opts as { shell?: unknown }).shell).toBeFalsy();
  });

  it('with nothing resolvable, the sync spawns nothing, the lesson stays written and the refusal is the sync output', async () => {
    const { spawn } = await import('node:child_process');
    mockResolution = {
      ok: false,
      looked: [
        'a workspace build at packages/cli/dist/index.js, walking up from /fake/project',
        'a pinned install at node_modules/@mmnto/cli/dist/index.js, walking up from /fake/project',
        'an npm-layout global install of @mmnto/cli on PATH',
      ],
      unverified: [],
    };
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;

    try {
      const result = (await handle({
        lesson: 'Written with no CLI',
        context_tags: ['test'],
      })) as { isError?: boolean; content: Array<{ text: string }> };

      expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore);
      expect(lastWrittenEntry).toContain('Written with no CLI');
      const text = result.content[0]!.text;
      expect(text).toContain('Sync failed: Totem CLI not found. Looked for: (1) a workspace build');
      expect(text).toContain('(3) an npm-layout global install of @mmnto/cli on PATH.');
      expect(text).not.toContain('was found on PATH');
    } finally {
      mockResolution = RESOLVED_HIT;
    }
  });

  // --- Live full-sync epoch deferral (#2562, falsification round 3 MAJOR 1) ---

  it('defers the convenience sync while a full re-index checkpoint is live', async () => {
    const { spawn } = await import('node:child_process');
    const { acquireLock, hasFullSyncCheckpoint } = await import('@mmnto/totem');
    // Consulted twice on the live path (#2564 leg MAJOR-2): once for the
    // lock bypass, once (re-derived) for the sync deferral.
    vi.mocked(hasFullSyncCheckpoint).mockReturnValueOnce(true).mockReturnValueOnce(true);
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;
    const lockCallsBefore = vi.mocked(acquireLock).mock.calls.length;

    const result = (await handle({
      lesson: 'Written during a live epoch',
      context_tags: ['test'],
    })) as { isError?: boolean; content: Array<{ text: string }> };

    // The lesson is written, the 60s-killed sync is NOT spawned (a promoted
    // paced resume can never finish inside its timeout), and the response
    // says so honestly instead of reporting a spurious timeout failure.
    expect(result.isError).toBeUndefined();
    expect(lastWrittenEntry).toContain('Written during a live epoch');
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore);
    expect(result.content[0]!.text).toContain('Sync deferred');
    // #2564 (leg MAJOR-2): under a live epoch the lock is held unstealably
    // for corpus-sized wall-clock — the write must NOT contend on it, or the
    // tool blocks for the full acquisition budget and the lesson is lost.
    expect(vi.mocked(acquireLock).mock.calls.length).toBe(lockCallsBefore);
  });

  it('writes the lesson and runs its sync when the vector store needs a rebuild, and says the sync rebuilt it (mmnto-ai/totem#3009)', async () => {
    const { spawn } = await import('node:child_process');
    const totem = await import('@mmnto/totem');
    const contextMock = await import('../context.js');
    // The mocked stand-in's constructor is (detail, recoveryHint).
    const StandIn = totem.StoreNeedsRebuildError as unknown as new (
      detail: string,
      recoveryHint: string,
    ) => Error;
    const fault = new StandIn(
      'The vector store at /fake/project/.lancedb cannot be opened (lance error: bad manifest).',
      'Run `totem sync --full` in that repository.',
    );
    vi.mocked(contextMock.getContext).mockRejectedValueOnce(fault);
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;

    const result = (await handle({
      lesson: 'Written over a broken store',
      context_tags: ['test'],
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBeUndefined();
    expect(lastWrittenEntry).toContain('Written over a broken store');
    // The convenience sync (the rebuilder) still ran.
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore + 1);
    const text = result.content[0]!.text;
    expect(text).toContain('Sync completed successfully.');
    expect(text).toContain(
      'The vector store could not be opened (The vector store at /fake/project/.lancedb cannot be opened (lance error: bad manifest).); this sync rebuilt it.',
    );
  });

  describe('store-fault message by sync outcome (mmnto-ai/totem#3012)', () => {
    async function rejectWithStoreFault(): Promise<void> {
      const totem = await import('@mmnto/totem');
      const contextMock = await import('../context.js');
      const StandIn = totem.StoreNeedsRebuildError as unknown as new (
        detail: string,
        recoveryHint: string,
      ) => Error;
      vi.mocked(contextMock.getContext).mockRejectedValueOnce(
        new StandIn('The store is unreadable.', 'Run `totem sync --full` in that repository.'),
      );
    }

    afterEach(() => {
      spawnBehavior = 'ok';
      vi.useRealTimers();
    });

    it('a timed-out sync: the rebuild was started and the next sync resumes it', async () => {
      await rejectWithStoreFault();
      spawnBehavior = 'hang';
      vi.useFakeTimers();

      const pending = handle({
        lesson: 'Lesson before a timeout',
        context_tags: ['test'],
      }) as Promise<{
        isError?: boolean;
        content: Array<{ text: string }>;
      }>;
      await vi.advanceTimersByTimeAsync(61_000);
      const result = await pending;

      expect(result.isError).toBeUndefined();
      expect(lastWrittenEntry).toContain('Lesson before a timeout');
      const text = result.content[0]!.text;
      expect(text).toContain('Sync failed: Sync timed out after 60s.');
      expect(text).toContain(
        'The vector store could not be opened (The store is unreadable.); this sync started a rebuild that did not finish within 60 s; the next `totem sync` resumes it.',
      );
    });

    it('a failed sync: it may have begun a rebuild, and the output tail is kept', async () => {
      await rejectWithStoreFault();
      spawnBehavior = 'fail';

      const result = (await handle({
        lesson: 'Lesson before a failure',
        context_tags: ['test'],
      })) as {
        content: Array<{ text: string }>;
      };

      const text = result.content[0]!.text;
      expect(text).toContain('Sync failed: embedder exploded');
      expect(text).toContain(
        'The vector store could not be opened (The store is unreadable.); the sync exited with an error and may have begun a rebuild; run `totem sync --full` to finish it.',
      );
      expect(text).not.toContain('within 60 s');
    });

    it('a sync that could not start: run the full sync', async () => {
      await rejectWithStoreFault();
      spawnBehavior = 'spawn-error';

      const result = (await handle({
        lesson: 'Lesson before a spawn error',
        context_tags: ['test'],
      })) as {
        content: Array<{ text: string }>;
      };

      const text = result.content[0]!.text;
      expect(text).toContain('Sync failed: Spawn error: ENOENT pnpm');
      expect(text).toContain(
        'The vector store could not be opened (The store is unreadable.); the sync could not start; run `totem sync --full`.',
      );
      expect(text).not.toContain('within 60 s');
    });
  });

  it('a getContext failure that is not a store fault still fails loud (mmnto-ai/totem#3009)', async () => {
    const contextMock = await import('../context.js');
    vi.mocked(contextMock.getContext).mockRejectedValueOnce(new Error('Config exploded'));
    lastWrittenEntry = '';

    const result = (await handle({ lesson: 'Never written', context_tags: ['test'] })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Config exploded');
    expect(lastWrittenEntry).toBe('');
  });

  it('takes the sync lock (bounded) on the normal path', async () => {
    // Leg NIT-R2: the live-path cell asserts the lock is NOT taken; without
    // this inverse cell a mutant removing locking entirely stays green.
    const { acquireLock } = await import('@mmnto/totem');
    const lockCallsBefore = vi.mocked(acquireLock).mock.calls.length;

    await handle({ lesson: 'Normal path locks', context_tags: ['test'] });

    expect(vi.mocked(acquireLock).mock.calls.length).toBe(lockCallsBefore + 1);
    // The acquisition is bounded (leg MAJOR-R1): a long-held lock must not
    // block this tool for the full ~255s default budget.
    const lastLockCall = vi.mocked(acquireLock).mock.calls.at(-1)!;
    expect(lastLockCall[2]).toMatchObject({ maxRetries: 4 });
  });

  it('falls back to a lockless write when the lock is held by a live long sync (leg MAJOR-R1)', async () => {
    const { spawn } = await import('node:child_process');
    const { acquireLock } = await import('@mmnto/totem');
    // No checkpoint marker (a long paced INCREMENTAL hold writes none), and
    // the bounded acquisition times out against the live holder.
    vi.mocked(acquireLock).mockRejectedValueOnce(
      Object.assign(new Error('Could not acquire sync lock after 4 attempts.'), {
        code: 'SYNC_FAILED',
      }),
    );
    const spawnCallsBefore = vi.mocked(spawn).mock.calls.length;

    const result = (await handle({
      lesson: 'Written past a held lock',
      context_tags: ['test'],
    })) as { isError?: boolean; content: Array<{ text: string }> };

    // The lesson is WRITTEN (not lost), the convenience sync is deferred
    // (it would contend on the same lock and die by its kill-timer), and the
    // response claims neither an unproven cause nor indexing-by-the-holder
    // (leg MINOR-S1 / NIT-S1).
    expect(result.isError).toBeUndefined();
    expect(lastWrittenEntry).toContain('Written past a held lock');
    expect(vi.mocked(spawn).mock.calls.length).toBe(spawnCallsBefore);
    expect(result.content[0]!.text).toContain('Sync deferred');
    expect(result.content[0]!.text).toContain('could not be acquired');
    expect(result.content[0]!.text).not.toContain('indexed by it');
  });

  it('a non-SYNC_FAILED acquisition error still fails loud (no silent lockless write)', async () => {
    const { acquireLock } = await import('@mmnto/totem');
    vi.mocked(acquireLock).mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
    );

    const result = (await handle({
      lesson: 'Should not be written',
      context_tags: ['test'],
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(lastWrittenEntry).not.toContain('Should not be written');
  });
});

// ---------------------------------------------------------------------------
// Double-heading bug (#1284)
// ---------------------------------------------------------------------------

describe('add_lesson double-heading guard (#1284)', () => {
  let handle: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    _resetRateLimit();
    lastWrittenEntry = '';
    handle = setup();
  });

  /** Count occurrences of `## Lesson —` (all dash variants) in a string. */
  function countLessonHeadings(entry: string): number {
    const matches = entry.match(/^## Lesson[\s\u2014\u2013-]+/gm);
    return matches ? matches.length : 0;
  }

  it('does not duplicate heading when body starts with canonical em-dash heading', async () => {
    await handle({
      lesson:
        '## Lesson — Read-path schema changes break write-path invariants\n\nWhen modifying parsing logic that produces a data structure, also consider the writers.',
      context_tags: ['architecture'],
    });

    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
    expect(lastWrittenEntry).toContain(
      '## Lesson — Read-path schema changes break write-path invariants',
    );
    // And the auto-generated duplicate must not appear
    expect(lastWrittenEntry).not.toContain('## Lesson — Lesson —');
  });

  it('handles en-dash heading variant', async () => {
    await handle({
      lesson: '## Lesson – Use err in catch blocks\n\nDo not use error in catch blocks.',
      context_tags: ['style'],
    });

    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
  });

  it('handles hyphen heading variant', async () => {
    await handle({
      lesson: '## Lesson - Plain hyphen variant\n\nBody text here.',
      context_tags: ['test'],
    });

    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
  });

  it('preserves existing behavior when body does NOT start with a heading', async () => {
    await handle({
      lesson:
        'Always validate input at trust boundaries. This is a plain lesson body with no heading.',
      context_tags: ['security'],
    });

    // Exactly one heading should still be generated (by the auto-path)
    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
    expect(lastWrittenEntry).toContain('## Lesson — ');
  });

  it('strips the pre-existing heading from the body so it is not included twice in content', async () => {
    await handle({
      lesson: '## Lesson — First heading\n\nBody line one.\nBody line two.',
      context_tags: ['test'],
    });

    // The body portion of the entry should contain "Body line one" and "Body line two"
    // but should NOT contain the verbatim "## Lesson — First heading" line anywhere
    // below the first line of the file.
    const lines = lastWrittenEntry.split('\n');
    const headingLineCount = lines.filter((l) => /^## Lesson[\s\u2014\u2013-]+/.test(l)).length;
    expect(headingLineCount).toBe(1);
    expect(lastWrittenEntry).toContain('Body line one.');
    expect(lastWrittenEntry).toContain('Body line two.');
  });

  it('still applies tags and provenance when body has a pre-existing heading', async () => {
    await handle({
      lesson: '## Lesson — Heading here\n\nBody content.',
      context_tags: ['tag-one', 'tag-two'],
    });

    expect(lastWrittenEntry).toContain('**Tags:** tag-one, tag-two');
    expect(lastWrittenEntry).toContain('**Source:** mcp (added at ');
  });

  it('handles single-line lesson without trailing newline', async () => {
    // Shield caught this edge case: if the caller sends just `## Lesson — Foo`
    // with no body and no trailing newline, the earlier regex variant that
    // required `\n+` at the end would fall through and produce a double heading.
    await handle({
      lesson: '## Lesson — Single line no body',
      context_tags: ['edge-case'],
    });

    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
    expect(lastWrittenEntry).toContain('## Lesson — Single line no body');
    expect(lastWrittenEntry).not.toContain('## Lesson — Lesson');
  });

  it('handles pre-formatted lesson with leading blank lines or whitespace', async () => {
    // Both GCA and CR flagged that a caller (especially an LLM) could emit
    // a pre-formatted lesson prefixed by blank lines or leading whitespace.
    // Without ^\s* the detection would miss it, fall through to the auto-title
    // path, and reproduce the double-heading bug.
    await handle({
      lesson: '\n\n## Lesson — Leading whitespace variant\n\nBody content.',
      context_tags: ['test'],
    });

    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
    expect(lastWrittenEntry).toContain('## Lesson — Leading whitespace variant');
    expect(lastWrittenEntry).not.toContain('## Lesson — Lesson');
  });

  it('does NOT treat lowercase "## lesson" as a canonical heading', async () => {
    // Stay case-sensitive to match the parser's LESSON_HEADING_RE
    // (`^## Lesson [—–-] ` with capital L) in core/drift-detector.ts.
    // If we accepted lowercase here we would strip a line the parser would
    // treat as body text, breaking round-trip semantics. The fallback path
    // generates a title from the full body and the lowercase line is
    // preserved verbatim inside the written entry.
    await handle({
      lesson: '## lesson — not canonical heading\nSome body.',
      context_tags: ['test'],
    });

    // Exactly one canonical "## Lesson" line at the top — and the original
    // lowercase line is preserved verbatim in the body (not stripped).
    expect(countLessonHeadings(lastWrittenEntry)).toBe(1);
    expect(lastWrittenEntry).toContain('## lesson — not canonical heading');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('@mmnto/totem', () => ({
  acquireLock: vi.fn(async () => vi.fn()),
  generateLessonHeading: vi.fn((body: string) => body.slice(0, 40)),
  sanitize: vi.fn((t: string) => t),
  writeLessonFileAsync: vi.fn(async (_dir: string, entry: string) => {
    lastWrittenEntry = entry;
    return '/fake/lessons/lesson-001.md';
  }),
}));

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => ({
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
      // Simulate instant success
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    }),
  };
});

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

  // --- Spawn options (#1023) ---

  it('passes env and shell options to spawn for Windows compat (#1023)', async () => {
    const { spawn } = await import('node:child_process');

    await handle({ lesson: 'Windows compat test', context_tags: ['test'] });

    const lastCall = vi.mocked(spawn).mock.calls.at(-1)!;
    const opts = lastCall[2] as Record<string, unknown>;
    const env = opts.env as Record<string, unknown>;
    expect(env).toBeDefined();
    expect(Object.keys(env).some((k) => k.toLowerCase() === 'path')).toBe(true);
    expect(typeof opts.shell).toBe('boolean');
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
});

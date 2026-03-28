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
    // Add 10 lessons successfully
    for (let i = 0; i < 10; i++) {
      const res = (await handle({
        lesson: `Lesson number ${i + 1}`,
        context_tags: ['test'],
      })) as { isError?: boolean };
      expect(res.isError).toBeUndefined();
    }

    // 11th should fail
    const result = (await handle({
      lesson: 'One too many',
      context_tags: ['test'],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Rate limit exceeded: maximum 10 lessons per session');
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
});

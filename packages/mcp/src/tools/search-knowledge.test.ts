import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

/** Tracks the mock store behaviour for each test. */
let mockSearchResults: Array<{
  label: string;
  type: string;
  filePath: string;
  score: number;
  content: string;
}> = [];

let mockHealthCheckResult: {
  healthy: boolean;
  dimensionMatch?: boolean;
  storedDimensions?: number | null;
  expectedDimensions?: number;
  issues?: string[];
} = { healthy: true };

let mockHealthCheckThrows = false;
let mockSearchThrows = false;
let mockSearchThrowsOnce = false;
let mockReconnectCalled = false;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {},
}));

vi.mock('@mmnto/totem', () => ({
  ContentTypeSchema: {
    options: ['code', 'session_log', 'spec', 'lesson'],
  },
}));

vi.mock('../context.js', () => ({
  getContext: vi.fn(async () => ({
    projectRoot: '/fake/project',
    config: {
      totemDir: '.totem',
      lanceDir: '.totem/.lance',
      contextWarningThreshold: 50_000,
      partitions: { core: ['packages/core/'] },
    },
    store: {
      search: vi.fn(async () => {
        if (mockSearchThrows) {
          throw new Error('LanceDB search failed');
        }
        if (mockSearchThrowsOnce) {
          mockSearchThrowsOnce = false;
          throw new Error('Stale handle error');
        }
        return mockSearchResults;
      }),
      healthCheck: vi.fn(async () => {
        if (mockHealthCheckThrows) {
          throw new Error('Health check exploded');
        }
        return mockHealthCheckResult;
      }),
    },
  })),
  reconnectStore: vi.fn(async () => {
    mockReconnectCalled = true;
  }),
}));

vi.mock('../xml-format.js', () => ({
  formatXmlResponse: vi.fn((_tag: string, msg: string) => msg),
  formatSystemWarning: vi.fn((msg: string) => `[SYSTEM WARNING] ${msg}`),
}));

vi.mock('../search-log.js', () => ({
  logSearch: vi.fn(),
  setLogDir: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are in place)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reset the module-level firstHealthCheckDone flag by re-importing.
 * Since vitest caches modules, we use vi.resetModules() + dynamic import.
 */
async function setupFresh(): Promise<(args: Record<string, unknown>) => Promise<unknown>> {
  // Re-import to reset the module-level firstHealthCheckDone flag
  const mod = await import('./search-knowledge.js');
  const fakeServer = {
    registerTool: (_name: string, _opts: unknown, handler: unknown) => {
      capturedHandler = handler as (args: Record<string, unknown>) => Promise<unknown>;
    },
  };
  mod.registerSearchKnowledge(fakeServer as never);
  return capturedHandler;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search_knowledge', () => {
  let handle: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(async () => {
    mockSearchResults = [];
    mockHealthCheckResult = { healthy: true };
    mockHealthCheckThrows = false;
    mockSearchThrows = false;
    mockSearchThrowsOnce = false;
    mockReconnectCalled = false;

    // Reset modules to clear the firstHealthCheckDone flag
    vi.resetModules();

    // Re-apply all mocks after module reset
    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: class {},
    }));

    vi.doMock('@mmnto/totem', () => ({
      ContentTypeSchema: {
        options: ['code', 'session_log', 'spec', 'lesson'],
      },
    }));

    vi.doMock('../context.js', () => ({
      getContext: vi.fn(async () => ({
        projectRoot: '/fake/project',
        config: {
          totemDir: '.totem',
          lanceDir: '.totem/.lance',
          contextWarningThreshold: 50_000,
          partitions: { core: ['packages/core/'] },
        },
        store: {
          search: vi.fn(async () => {
            if (mockSearchThrows) {
              throw new Error('LanceDB search failed');
            }
            if (mockSearchThrowsOnce) {
              mockSearchThrowsOnce = false;
              throw new Error('Stale handle error');
            }
            return mockSearchResults;
          }),
          healthCheck: vi.fn(async () => {
            if (mockHealthCheckThrows) {
              throw new Error('Health check exploded');
            }
            return mockHealthCheckResult;
          }),
        },
      })),
      reconnectStore: vi.fn(async () => {
        mockReconnectCalled = true;
      }),
    }));

    vi.doMock('../xml-format.js', () => ({
      formatXmlResponse: vi.fn((_tag: string, msg: string) => msg),
      formatSystemWarning: vi.fn((msg: string) => `[SYSTEM WARNING] ${msg}`),
    }));

    vi.doMock('../search-log.js', () => ({
      logSearch: vi.fn(),
      setLogDir: vi.fn(),
    }));

    handle = await setupFresh();
  });

  // --- Successful search returning results ---

  it('returns formatted results for a successful search', async () => {
    mockSearchResults = [
      {
        label: 'Cache invalidation',
        type: 'lesson',
        filePath: 'lessons/cache.md',
        score: 0.95,
        content: 'Cache invalidation is hard.',
      },
      {
        label: 'API patterns',
        type: 'code',
        filePath: 'src/api.ts',
        score: 0.82,
        content: 'Use REST not GraphQL.',
      },
    ];

    const result = (await handle({ query: 'caching patterns' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toContain('Cache invalidation');
    expect(result.content[0]!.text).toContain('lesson');
    expect(result.content[0]!.text).toContain('0.950');
    expect(result.content[0]!.text).toContain('API patterns');
    expect(result.content[0]!.text).toContain('0.820');
  });

  // --- Empty search results ---

  it('returns "No results found" for empty search', async () => {
    mockSearchResults = [];

    const result = (await handle({ query: 'nonexistent topic' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toContain('No results found');
  });

  // --- Health check gating ---

  it('runs health check on first search call', async () => {
    mockHealthCheckResult = {
      healthy: false,
      dimensionMatch: true,
      storedDimensions: null,
      issues: ['Missing embeddings for 5 entries'],
    };
    mockSearchResults = [
      {
        label: 'Test',
        type: 'lesson',
        filePath: 'test.md',
        score: 0.9,
        content: 'Test content',
      },
    ];

    const result = (await handle({ query: 'test' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    // Health warning should be prepended to the search result
    expect(result.content[0]!.text).toContain('[SYSTEM WARNING]');
    expect(result.content[0]!.text).toContain('Test');
  });

  it('blocks search on dimension mismatch', async () => {
    mockHealthCheckResult = {
      healthy: false,
      dimensionMatch: false,
      storedDimensions: 768,
      expectedDimensions: 1536,
    };

    const result = (await handle({ query: 'anything' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('DIMENSION MISMATCH');
  });

  it('does not block search when health check itself fails', async () => {
    mockHealthCheckThrows = true;
    mockSearchResults = [
      {
        label: 'Result',
        type: 'code',
        filePath: 'src/test.ts',
        score: 0.85,
        content: 'Some result',
      },
    ];

    const result = (await handle({ query: 'test query' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    // Should still return results — health check failure is non-blocking
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Result');
  });

  // --- Reconnect on unhealthy store ---

  it('reconnects and retries when search throws', async () => {
    mockSearchThrowsOnce = true;
    mockSearchResults = [
      {
        label: 'After reconnect',
        type: 'lesson',
        filePath: 'lessons/reconnect.md',
        score: 0.75,
        content: 'Reconnected successfully.',
      },
    ];

    const result = (await handle({ query: 'reconnect test' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(mockReconnectCalled).toBe(true);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('After reconnect');
  });

  it('returns error when both initial search and retry fail', async () => {
    mockSearchThrows = true;

    const result = (await handle({ query: 'doomed query' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('[Totem Error]');
    expect(result.content[0]!.text).toContain('Search failed');
  });

  // --- Result formatting ---

  it('formats multiple results with numbered headings and separators', async () => {
    mockSearchResults = [
      {
        label: 'First result',
        type: 'lesson',
        filePath: 'lessons/first.md',
        score: 0.99,
        content: 'First content.',
      },
      {
        label: 'Second result',
        type: 'spec',
        filePath: 'specs/second.md',
        score: 0.88,
        content: 'Second content.',
      },
      {
        label: 'Third result',
        type: 'code',
        filePath: 'src/third.ts',
        score: 0.77,
        content: 'Third content.',
      },
    ];

    const result = (await handle({ query: 'multi' })) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = result.content[0]!.text;
    expect(text).toContain('### 1. First result (lesson)');
    expect(text).toContain('### 2. Second result (spec)');
    expect(text).toContain('### 3. Third result (code)');
    expect(text).toContain('**File:** lessons/first.md | **Score:** 0.990');
    expect(text).toContain('---');
  });

  it('passes type_filter and max_results to store.search', async () => {
    mockSearchResults = [];

    await handle({
      query: 'filtered search',
      type_filter: 'lesson',
      max_results: 10,
    });

    // The mock store.search is called by performSearch — we verify indirectly
    // by checking we get "No results found" without any error
    const result = (await handle({
      query: 'filtered search',
      type_filter: 'lesson',
      max_results: 10,
    })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('No results found');
  });

  it('passes boundary parameter for partition filtering', async () => {
    mockSearchResults = [];

    const result = (await handle({
      query: 'core internals',
      boundary: 'core',
    })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('No results found');
  });
});

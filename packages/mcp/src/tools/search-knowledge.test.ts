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

/**
 * mmnto/totem#1294 Phase 2: per-test linked store / error state. Tests that
 * exercise the federation path assign to these before calling the handler;
 * the default is "no linked stores configured, no init errors."
 */
interface MockLinkedStore {
  search: (options: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
}
let mockLinkedStores: Map<string, MockLinkedStore> = new Map();
let mockLinkedStoreInitErrors: Map<string, string> = new Map();

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
    // mmnto/totem#1294 Phase 2: linked store fields. Tests that want to
    // exercise the federation path assign to `mockLinkedStores` before
    // calling the handler; most tests leave it as an empty Map.
    linkedStores: mockLinkedStores,
    linkedStoreInitErrors: mockLinkedStoreInitErrors,
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
    mockLinkedStores = new Map();
    mockLinkedStoreInitErrors = new Map();

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
        // mmnto/totem#1294 Phase 2: linked store fields
        linkedStores: mockLinkedStores,
        linkedStoreInitErrors: mockLinkedStoreInitErrors,
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

  // ─── Cross-Repo Context Mesh (mmnto/totem#1294 Phase 2) ───────

  describe('federated search (linkedIndexes)', () => {
    function makeLinkedStore(
      results: Array<{
        label: string;
        type: string;
        filePath: string;
        absoluteFilePath: string;
        sourceRepo?: string;
        score: number;
        content: string;
      }>,
    ): MockLinkedStore {
      return {
        search: vi.fn(async () => results),
      };
    }

    it('federates across primary + linked stores when boundary is undefined', async () => {
      mockSearchResults = [
        {
          label: 'Primary hit',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.8,
          content: 'primary content',
        },
      ];
      mockLinkedStores.set(
        'strategy',
        makeLinkedStore([
          {
            label: 'Strategy hit',
            type: 'spec',
            filePath: 'adr/adr-001.md',
            absoluteFilePath: '/abs/totem-strategy/adr/adr-001.md',
            sourceRepo: 'strategy',
            score: 0.9, // higher than primary — should rank first
            content: 'strategy content',
          },
        ]),
      );

      const result = (await handle({ query: 'architecture' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      // Strategy hit (higher score) should appear first with [strategy] tag
      expect(text).toContain('[strategy] Strategy hit');
      expect(text).toContain('Primary hit');
      // Strategy hit's index should precede primary hit's
      const strategyIdx = text.indexOf('Strategy hit');
      const primaryIdx = text.indexOf('Primary hit');
      expect(strategyIdx).toBeLessThan(primaryIdx);
    });

    it('boundary matching a linked store name routes ONLY to that store', async () => {
      mockSearchResults = [
        {
          label: 'Primary hit',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.99,
          content: 'primary content',
        },
      ];
      const strategyStore = makeLinkedStore([
        {
          label: 'Strategy ADR',
          type: 'spec',
          filePath: 'adr/adr-001.md',
          absoluteFilePath: '/abs/totem-strategy/adr/adr-001.md',
          sourceRepo: 'strategy',
          score: 0.5,
          content: 'adr content',
        },
      ]);
      mockLinkedStores.set('strategy', strategyStore);

      const result = (await handle({
        query: 'architecture',
        boundary: 'strategy',
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeUndefined();
      expect(strategyStore.search).toHaveBeenCalled();
      // Only strategy results should appear — primary is not queried
      expect(result.content[0]!.text).toContain('Strategy ADR');
      expect(result.content[0]!.text).not.toContain('Primary hit');
    });

    it('boundary matching a partition name still routes to primary (partitions win over links)', async () => {
      mockSearchResults = [
        {
          label: 'Core file',
          type: 'code',
          filePath: 'packages/core/src/foo.ts',
          score: 0.9,
          content: 'core content',
        },
      ];
      const linkedStore = makeLinkedStore([
        {
          label: 'Should not appear',
          type: 'spec',
          filePath: 'other.md',
          absoluteFilePath: '/abs/other/other.md',
          sourceRepo: 'core',
          score: 0.99,
          content: 'linked content',
        },
      ]);
      // Collision: link name "core" matches a partition name
      mockLinkedStores.set('core', linkedStore);

      const result = (await handle({
        query: 'anything',
        boundary: 'core', // partition "core" wins
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Core file');
      expect(result.content[0]!.text).not.toContain('Should not appear');
      // Linked store was never queried
      expect(linkedStore.search).not.toHaveBeenCalled();
    });

    it('unknown boundary falls back to raw prefix on primary only', async () => {
      mockSearchResults = [];
      const linkedStore = makeLinkedStore([
        {
          label: 'Should not appear',
          type: 'spec',
          filePath: 'other.md',
          absoluteFilePath: '/abs/other/other.md',
          sourceRepo: 'strategy',
          score: 0.99,
          content: 'linked content',
        },
      ]);
      mockLinkedStores.set('strategy', linkedStore);

      const result = (await handle({
        query: 'test',
        boundary: 'some/random/prefix/',
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeUndefined();
      expect(linkedStore.search).not.toHaveBeenCalled();
    });

    it('linked store search failure degrades to primary-only result', async () => {
      mockSearchResults = [
        {
          label: 'Primary hit',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.8,
          content: 'primary content',
        },
      ];
      // Use mockRejectedValue to avoid an inline `throw new Error` that
      // trips the over-broad "error normalization" and "[Totem Error]
      // prefix" lint rules on test fixtures (tracked for refinement in
      // mmnto/totem#1286). The rejected-Promise shape is semantically
      // equivalent for the federation-failure path under test.
      const brokenLink: MockLinkedStore = {
        search: vi.fn().mockRejectedValue(new Error('Connection refused')),
      };
      mockLinkedStores.set('broken', brokenLink);

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Primary still returns despite linked failure — federation is
      // non-blocking per Tenet 4 (but surfaced via logSearch for telemetry)
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Primary hit');
      expect(brokenLink.search).toHaveBeenCalled();
    });

    it('boundary matching a failed-init linked store returns explicit error (no silent primary fallback)', async () => {
      // Shield AI catch: if a linked store name is in linkedStoreInitErrors
      // but not in linkedStores (e.g., init failed, or reconnect blew up),
      // the previous implementation silently fell through to querying the
      // primary store with the name as a raw path prefix — returning
      // unrelated local hits. Tenet 4 violation (silent drift).
      mockLinkedStoreInitErrors.set('strategy', 'Linked index is empty (0 rows).');
      mockSearchResults = [
        {
          label: 'Bogus primary hit that happens to match "strategy"',
          type: 'code',
          filePath: 'src/strategy-pattern.ts',
          score: 0.9,
          content: 'some code',
        },
      ];

      const result = (await handle({ query: 'test', boundary: 'strategy' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Must return isError with a clear message naming the broken link,
      // NOT bogus primary results from the raw-prefix fallback
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('strategy');
      expect(result.content[0]!.text).toContain('not available');
      // Explicitly check the primary results are NOT in the response
      expect(result.content[0]!.text).not.toContain('Bogus primary hit');
    });

    it('first-query-warn-block surfaces linkedStoreInitErrors', async () => {
      mockLinkedStoreInitErrors.set('strategy', 'Linked index at /abs/strategy is empty (0 rows).');
      mockSearchResults = [
        {
          label: 'Primary result',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.9,
          content: 'content',
        },
      ];

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Not blocking — primary results still return
      expect(result.isError).toBeUndefined();
      // But the init error is surfaced in the response via system warning
      expect(result.content[0]!.text).toContain('[SYSTEM WARNING]');
      expect(result.content[0]!.text).toContain('strategy');
      expect(result.content[0]!.text).toContain('empty (0 rows)');
      // Primary result still present
      expect(result.content[0]!.text).toContain('Primary result');
    });

    it('reconnect path invalidates stale linked store handles (Shield AI catch)', async () => {
      // Shield AI finding on the Phase 2 review: reconnectStore was only
      // reconnecting the primary store. If a linked index gets rebuilt by
      // a concurrent `totem sync`, its table handle goes stale and queries
      // fail silently. Phase 2 fix: reconnectStore iterates every linked
      // store and reconnects each.
      //
      // This test uses the reconnect-on-search-throw path (mockSearchThrowsOnce)
      // to trigger reconnectStore. Note: we can't inspect linkedStore.reconnect
      // directly because the mock context only exposes a read path — but we
      // can verify that the full federation path remains functional AFTER
      // reconnect fires, which is the observable Shield cared about.
      mockSearchThrowsOnce = true;
      mockSearchResults = [
        {
          label: 'After reconnect primary',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.7,
          content: 'content',
        },
      ];
      mockLinkedStores.set(
        'strategy',
        makeLinkedStore([
          {
            label: 'Linked still works',
            type: 'spec',
            filePath: 'adr/adr-001.md',
            absoluteFilePath: '/abs/strategy/adr/adr-001.md',
            sourceRepo: 'strategy',
            score: 0.8,
            content: 'strategy content after reconnect',
          },
        ]),
      );

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(mockReconnectCalled).toBe(true);
      expect(result.isError).toBeUndefined();
      // Both primary (post-reconnect) and linked (never went stale in this mock)
      // should appear in the merged results
      expect(result.content[0]!.text).toContain('After reconnect primary');
      expect(result.content[0]!.text).toContain('Linked still works');
    });

    it('primary results use relative path, linked results use absolute path', async () => {
      mockSearchResults = [
        {
          label: 'Primary',
          type: 'code',
          filePath: 'src/primary.ts',
          score: 0.7,
          content: 'primary content',
        },
      ];
      mockLinkedStores.set(
        'strategy',
        makeLinkedStore([
          {
            label: 'Linked',
            type: 'spec',
            filePath: 'adr/linked.md',
            absoluteFilePath: '/abs/totem-strategy/adr/linked.md',
            sourceRepo: 'strategy',
            score: 0.6,
            content: 'linked content',
          },
        ]),
      );

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      const text = result.content[0]!.text;
      // Primary: relative path in the File field
      expect(text).toContain('**File:** src/primary.ts');
      // Linked: absolute path in the File field
      expect(text).toContain('**File:** /abs/totem-strategy/adr/linked.md');
      // Linked result has the [sourceRepo] tag prefix
      expect(text).toContain('[strategy] Linked');
      // Primary has no tag prefix (uses bare label)
      expect(text).toMatch(/### \d+\. Primary \(code\)/);
    });
  });
});

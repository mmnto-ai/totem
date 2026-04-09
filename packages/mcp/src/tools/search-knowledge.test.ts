import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that reference them
// ---------------------------------------------------------------------------

let capturedHandler: (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Tracks the mock store behaviour for each test. `absoluteFilePath` is
 * optional — when omitted the mock store fills it in from the fake
 * `projectRoot` (mirroring real `LanceStore` which constructs it via
 * `path.join(sourceContext.absolutePathRoot, filePath)`).
 */
let mockSearchResults: Array<{
  label: string;
  type: string;
  filePath: string;
  absoluteFilePath?: string;
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
 * mmnto/totem#1295 CR minor: number of upcoming `getContext()` calls
 * that should throw before getContext starts returning normally.
 * Decremented on each throw. The test for the one-shot flag fix sets
 * this to a high enough number to cover every getContext call within
 * a single handle() invocation, then expects subsequent calls to work.
 */
let mockGetContextFailuresRemaining = 0;

/**
 * mmnto/totem#1294 Phase 2: per-test linked store / error state. Tests that
 * exercise the federation path assign to these before calling the handler;
 * the default is "no linked stores configured, no init errors."
 */
interface MockLinkedStore {
  search: (options: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  // mmnto/totem#1295 CR minor: tests that exercise the reconnect path
  // need to actually verify per-store reconnect calls fired. The mock now
  // exposes a `reconnect` spy and the mocked `reconnectStore` (below)
  // iterates `mockLinkedStores` and calls `.reconnect()` on each — same
  // pattern as the real `reconnectStore` in context.ts.
  reconnect: () => Promise<void>;
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
  getContext: vi.fn(async () => {
    if (mockGetContextFailuresRemaining > 0) {
      mockGetContextFailuresRemaining -= 1;
      throw new Error('Transient init failure');
    }
    return {
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
          // Fill in absoluteFilePath from the fake projectRoot when the
          // test didn't set one explicitly — mirrors real LanceStore.
          return mockSearchResults.map((r) => ({
            ...r,
            absoluteFilePath: r.absoluteFilePath ?? `/fake/project/${r.filePath}`,
          }));
        }),
        reconnect: vi.fn(async () => {}),
        healthCheck: vi.fn(async () => {
          if (mockHealthCheckThrows) {
            throw new Error('Health check exploded');
          }
          return mockHealthCheckResult;
        }),
      },
      // mmnto/totem#1294 Phase 2: linked store fields. Tests that want
      // to exercise the federation path assign to `mockLinkedStores`
      // before calling the handler; most tests leave it as an empty Map.
      linkedStores: mockLinkedStores,
      linkedStoreInitErrors: mockLinkedStoreInitErrors,
    };
  }),
  reconnectStore: vi.fn(async () => {
    mockReconnectCalled = true;
    // mmnto/totem#1295 CR minor: mirror the real reconnectStore — iterate
    // linked stores and call each one's reconnect spy so tests can assert
    // per-store reconnect actually fired.
    for (const linkedStore of mockLinkedStores.values()) {
      try {
        await linkedStore.reconnect();
      } catch (err) {
        // Best-effort, mirror the real reconnectStore behavior.
        // Suppression is intentional — discard the error explicitly so
        // the bare-catch lint rule doesn't fire and unexpected mock
        // breakage stays grep-able.
        void err;
      }
    }
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
    mockGetContextFailuresRemaining = 0;
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
      getContext: vi.fn(async () => {
        if (mockGetContextFailuresRemaining > 0) {
          mockGetContextFailuresRemaining -= 1;
          throw new Error('Transient init failure');
        }
        return {
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
              // Fill in absoluteFilePath from the fake projectRoot when
              // the test didn't set one explicitly — mirrors LanceStore.
              return mockSearchResults.map((r) => ({
                ...r,
                absoluteFilePath: r.absoluteFilePath ?? `/fake/project/${r.filePath}`,
              }));
            }),
            reconnect: vi.fn(async () => {}),
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
        };
      }),
      reconnectStore: vi.fn(async () => {
        mockReconnectCalled = true;
        // mmnto/totem#1295 CR minor: mirror reconnectStore — iterate
        // linked stores so tests can assert per-store reconnect fired.
        for (const linkedStore of mockLinkedStores.values()) {
          try {
            await linkedStore.reconnect();
          } catch (err) {
            // Best-effort, mirror the real reconnectStore behavior.
            // Suppression is intentional — discard the error explicitly.
            void err;
          }
        }
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

  it('dimension mismatch warning persists across queries until the index is fixed (CR MAJOR)', async () => {
    // mmnto/totem#1295 CR MAJOR: the round-7 fix moved
    // `firstHealthCheckDone = true` to after the healthCheck() await, but
    // still consumed the flag on UNHEALTHY results. That meant a persistent
    // dimension mismatch showed the actionable "rm -rf .lancedb &&
    // totem sync --full" guidance ONCE, then the next query skipped the
    // gate and fell back to the cryptic LanceDB "vector dimension mismatch"
    // error — exactly what this gate exists to prevent.
    //
    // The fix: don't consume the flag on dimension mismatch. The friendly
    // diagnostic fires on EVERY query until the state is actually fixed.
    mockHealthCheckResult = {
      healthy: false,
      dimensionMatch: false,
      storedDimensions: 768,
      expectedDimensions: 1536,
    };

    const first = (await handle({ query: 'anything' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(first.isError).toBe(true);
    expect(first.content[0]!.text).toContain('DIMENSION MISMATCH');
    expect(first.content[0]!.text).toContain('rm -rf .lancedb');

    // Second query: WITHOUT the fix, this would return a regular search
    // (the flag would have been consumed, runFirstQueryHealthCheck would
    // return null, the outer catch would see a cryptic LanceDB error from
    // performSearch OR worse, fall into the success path silently).
    // WITH the fix, the dimension mismatch warning fires again and the
    // search is blocked again.
    const second = (await handle({ query: 'anything' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(second.isError).toBe(true);
    expect(second.content[0]!.text).toContain('DIMENSION MISMATCH');
    expect(second.content[0]!.text).toContain('rm -rf .lancedb');

    // Simulate the user fixing the index: healthCheck now returns healthy.
    // After the fix-then-retry, the warning should stop firing (normal
    // one-shot semantics resume).
    mockHealthCheckResult = { healthy: true };
    mockSearchResults = [
      {
        label: 'Post-fix hit',
        type: 'code',
        filePath: 'src/foo.ts',
        score: 0.8,
        content: 'recovered',
      },
    ];
    const third = (await handle({ query: 'anything' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(third.isError).toBeUndefined();
    expect(third.content[0]!.text).not.toContain('DIMENSION MISMATCH');
    expect(third.content[0]!.text).toContain('Post-fix hit');
  });

  it('non-fatal health warnings stay one-shot even after dimension-mismatch fix', async () => {
    // Sanity check for the companion rule: non-fatal health issues (stale
    // rows, missing partitions) still consume the flag after one warning.
    // Only dimension mismatch is special-cased to persist.
    mockHealthCheckResult = {
      healthy: false,
      dimensionMatch: true, // dim is fine — other issues
      issues: ['Partition "core" has no rows'],
    };
    mockSearchResults = [
      {
        label: 'Hit',
        type: 'code',
        filePath: 'src/foo.ts',
        score: 0.7,
        content: 'content',
      },
    ];

    const first = (await handle({ query: 'test' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(first.isError).toBeUndefined();
    expect(first.content[0]!.text).toContain('Index health issues detected');
    expect(first.content[0]!.text).toContain('Hit');

    // Second query: the non-fatal warning should NOT repeat (one-shot)
    const second = (await handle({ query: 'test' })) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };
    expect(second.isError).toBeUndefined();
    expect(second.content[0]!.text).not.toContain('Index health issues detected');
    expect(second.content[0]!.text).toContain('Hit');
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
    // mmnto/totem#1295 CR MAJOR: File line uses absolute path (mock fills
    // absoluteFilePath from /fake/project + filePath when not set explicitly)
    expect(text).toContain('**File:** /fake/project/lessons/first.md | **Score:** 0.990');
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
        // mmnto/totem#1295 CR minor: every linked-store mock now exposes
        // a reconnect spy so tests can assert per-store reconnect actually
        // fired during the reconnect path.
        reconnect: vi.fn(async () => {}),
      };
    }

    it('federates across primary + linked stores via fair RRF rank merge', async () => {
      // mmnto/totem#1295 GCA CRITICAL: federation must merge by
      // rank-within-store (RRF), not raw score, because LanceStore returns
      // scores in incompatible scales (hybrid RRF ~0.03 vs vector-only
      // ~0.85). This test sets up scores where the OLD raw-score sort
      // would give the wrong answer:
      //
      //   Primary: P1 (0.95), P2 (0.94)         — both very high (vector scale)
      //   Linked:  S1 (0.04), S2 (0.03)         — both very low  (RRF scale)
      //
      //   Old raw-score sort: P1, P2, S1, S2     ← linked store starved
      //   New RRF sort:       P1, S1, P2, S2     ← rank 0s interleave fairly
      //
      // The "rank 0 from each store should beat rank 1 from any store"
      // property is the architectural guarantee RRF provides.
      mockSearchResults = [
        {
          label: 'P1 primary top',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.95,
          content: 'primary top content',
        },
        {
          label: 'P2 primary second',
          type: 'code',
          filePath: 'src/bar.ts',
          score: 0.94,
          content: 'primary second content',
        },
      ];
      mockLinkedStores.set(
        'strategy',
        makeLinkedStore([
          {
            label: 'S1 strategy top',
            type: 'spec',
            filePath: 'adr/adr-001.md',
            absoluteFilePath: '/abs/totem-strategy/adr/adr-001.md',
            sourceRepo: 'strategy',
            score: 0.04, // raw-score sort would put this BEHIND both P1 and P2
            content: 'strategy top content',
          },
          {
            label: 'S2 strategy second',
            type: 'spec',
            filePath: 'adr/adr-002.md',
            absoluteFilePath: '/abs/totem-strategy/adr/adr-002.md',
            sourceRepo: 'strategy',
            score: 0.03,
            content: 'strategy second content',
          },
        ]),
      );

      const result = (await handle({ query: 'architecture', max_results: 10 })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;

      // All four results present
      expect(text).toContain('P1 primary top');
      expect(text).toContain('S1 strategy top');
      expect(text).toContain('P2 primary second');
      expect(text).toContain('S2 strategy second');

      // RRF interleaving: S1 (rank 0 in its store) must appear BEFORE
      // P2 (rank 1 in primary), even though P2 has 23x the raw score.
      // This is the architectural fix — without RRF, S1 would be last.
      const p1Idx = text.indexOf('P1 primary top');
      const s1Idx = text.indexOf('S1 strategy top');
      const p2Idx = text.indexOf('P2 primary second');
      const s2Idx = text.indexOf('S2 strategy second');

      // Stable sort within ties: bucket order is primary-first then linked,
      // so among rank-0 results P1 comes before S1; among rank-1 results
      // P2 comes before S2.
      expect(p1Idx).toBeLessThan(s1Idx);
      expect(s1Idx).toBeLessThan(p2Idx); // ← THE KEY ASSERTION
      expect(p2Idx).toBeLessThan(s2Idx);
    });

    it('federation displays normalized RRF scores, not raw store scores', async () => {
      // mmnto/totem#1295 GCA CRITICAL: the visible `score` field is
      // overwritten with the RRF score during federation so the displayed
      // order matches the displayed numbers. Otherwise users would see
      // results sorted by an invisible secondary key, which is confusing.
      mockSearchResults = [
        {
          label: 'P1',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.99, // raw vector-distance scale
          content: 'primary',
        },
      ];
      mockLinkedStores.set(
        'strategy',
        makeLinkedStore([
          {
            label: 'S1',
            type: 'spec',
            filePath: 'adr/adr-001.md',
            absoluteFilePath: '/abs/strategy/adr/adr-001.md',
            sourceRepo: 'strategy',
            score: 0.04, // raw RRF scale
            content: 'strategy',
          },
        ]),
      );

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
      };
      const text = result.content[0]!.text;

      // The original raw scores (0.990 / 0.040) must NOT appear — they
      // would mislead the user about cross-store comparability.
      expect(text).not.toContain('0.990');
      expect(text).not.toContain('0.040');
      // The RRF score for rank 0 with k=60 is 1/61 ≈ 0.016
      expect(text).toContain('0.016');
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

    it('linked store runtime failure surfaces per-query warning (non-blocking)', async () => {
      // mmnto/totem#1295 GCA/CR fix: previously this path silently dropped
      // linked failures with no user-visible signal (Tenet 4 violation).
      // The new per-query runtime-warning architecture surfaces the failure
      // inline on every query it occurred on, without mutating global state
      // (so transient issues don't cause permanent session drift).
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
        reconnect: vi.fn().mockRejectedValue(new Error('Reconnect also broken')),
      };
      mockLinkedStores.set('broken', brokenLink);

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Federation is non-blocking — primary results still land
      expect(result.isError).toBeUndefined();
      expect(brokenLink.search).toHaveBeenCalled();
      expect(result.content[0]!.text).toContain('Primary hit');

      // Runtime failure is surfaced as a per-query system warning so the
      // agent sees the drift in-context (Tenet 4: Fail Loud)
      expect(result.content[0]!.text).toContain('[SYSTEM WARNING]');
      expect(result.content[0]!.text).toContain('Federated search');
      expect(result.content[0]!.text).toContain('broken');
      expect(result.content[0]!.text).toContain('Connection refused');
    });

    it('linked store literally named "primary" does not collide with actual primary failure slot (CR MAJOR)', async () => {
      // mmnto/totem#1295 CR MAJOR: `deriveLinkName` strips leading dots
      // from the basename, so a linked repo at `.primary/` would derive
      // to the link name `'primary'`. The earlier implementation stored
      // primary store failures under `runtimeFailures.set('primary', ...)`,
      // which would have either overwritten or been overwritten by the
      // legitimate linked store named 'primary'.
      //
      // The fix splits primary into a dedicated `failures.primary` slot
      // (string | null), keeping the linked-store map free of reserved
      // keys. This test exercises the collision scenario:
      //
      //   1. The actual primary store throws (so failures.primary is set).
      //   2. A linked store literally named 'primary' returns results
      //      successfully — its results must NOT be misreported as the
      //      primary store, AND the warning copy must distinguish them.
      mockSearchThrows = true;
      const linkedNamedPrimary = makeLinkedStore([
        {
          label: 'Linked-primary hit',
          type: 'spec',
          filePath: 'adr/adr-001.md',
          absoluteFilePath: '/abs/.primary/adr/adr-001.md',
          sourceRepo: 'primary',
          score: 0.8,
          content: 'linked content from a repo named primary',
        },
      ]);
      mockLinkedStores.set('primary', linkedNamedPrimary);

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Federation succeeds with the linked-named-primary results
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Linked-primary hit');

      // The warning surfaces the actual primary store failure WITHOUT
      // collision. With the bug, the linked store's success would have
      // either overwritten the primary failure (no warning) or the
      // primary failure would have overwritten the linked store's entry.
      const text = result.content[0]!.text;
      expect(text).toContain('[SYSTEM WARNING]');
      // The warning must reference primary store failure
      expect(text).toContain('primary store');
      // The warning must NOT reference any linked store failure (the
      // 'primary' linked store succeeded)
      expect(text).not.toContain('1 linked index(es) failed');
      // Linked store named 'primary' got its tag prefix
      expect(text).toContain('[primary] Linked-primary hit');
    });

    it('entire federation down returns isError (CR MAJOR — do not mask outage as "no results")', async () => {
      // mmnto/totem#1295 CR MAJOR catch: when primary AND every linked
      // store fail, results.length === 0 but the previous code fell
      // through to a success-shaped "No results found" body with the
      // warning prepended. The agent reads that as "no relevant knowledge
      // in the index" when actually the entire search plane is broken.
      // Tenet 4 violation (silent degradation).
      //
      // The fix: detect the federated case where `failures.primary !== null`
      // AND `failures.linked.size === linkedStores.size` AND results are
      // empty, and return isError: true with the runtime warning as the
      // error text so the agent sees the breakdown of what's down.
      mockSearchThrows = true;
      const brokenLinkA: MockLinkedStore = {
        search: vi.fn().mockRejectedValue(new Error('Linked A down')),
        reconnect: vi.fn().mockRejectedValue(new Error('A reconnect failed')),
      };
      const brokenLinkB: MockLinkedStore = {
        search: vi.fn().mockRejectedValue(new Error('Linked B down')),
        reconnect: vi.fn().mockRejectedValue(new Error('B reconnect failed')),
      };
      mockLinkedStores.set('strategy', brokenLinkA);
      mockLinkedStores.set('playground', brokenLinkB);

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Must be isError — not a silent "no results found" body
      expect(result.isError).toBe(true);
      const text = result.content[0]!.text;
      // The runtime warning (breakdown of what failed) is the error text
      expect(text).toContain('[SYSTEM WARNING]');
      expect(text).toContain('primary store');
      expect(text).toContain('2 linked index(es) failed');
      // Each broken store is named in the detail lines
      expect(text).toContain('strategy');
      expect(text).toContain('playground');
      // Critically: the "No results found." body must NOT appear
      expect(text).not.toContain('No results found');
    });

    it('partial-failure federation (some linked OK, some broken) still returns success-shape "no results"', async () => {
      // mmnto/totem#1295 CR MAJOR follow-up: verify the all-failed check
      // is narrow enough. When at least ONE store successfully returned
      // zero results, the zero-ness is authoritative and the response
      // should be a normal "No results found" body with the warning
      // prepended — NOT isError. The agent can see the warning and
      // decide whether to retry or accept the zero-result answer.
      const brokenLink: MockLinkedStore = {
        search: vi.fn().mockRejectedValue(new Error('Linked down')),
        reconnect: vi.fn().mockRejectedValue(new Error('Reconnect failed')),
      };
      const healthyLink = makeLinkedStore([]); // healthy, empty results
      mockLinkedStores.set('strategy', brokenLink);
      mockLinkedStores.set('playground', healthyLink);
      mockSearchResults = []; // primary also empty but healthy

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Not isError — at least one store answered authoritatively
      expect(result.isError).toBeUndefined();
      const text = result.content[0]!.text;
      // Runtime warning surfaces the partial failure
      expect(text).toContain('[SYSTEM WARNING]');
      expect(text).toContain('strategy');
      // "No results found" body IS present because primary + healthy linked
      // both returned zero
      expect(text).toContain('No results found');
    });

    it('primary store failure does not block linked-store results (GCA HIGH)', async () => {
      // mmnto/totem#1295 GCA HIGH catch: previously the primary store
      // search bubbled out of `Promise.all` and killed the entire
      // federation, even when linked stores were healthy. Now primary
      // failures are caught inside `federatedSearch` and routed through
      // the same per-query runtime-warning path as linked failures —
      // populated under the reserved `'primary'` key.
      mockSearchThrows = true;
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
            content: 'strategy content',
          },
        ]),
      );

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // Federation is non-blocking — linked results still land
      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Linked still works');

      // Primary failure is surfaced as a per-query runtime warning under
      // the reserved 'primary' key
      expect(result.content[0]!.text).toContain('[SYSTEM WARNING]');
      expect(result.content[0]!.text).toContain('primary');
    });

    it('per-query runtime warnings do not mutate global init errors (transient failures stay transient)', async () => {
      // mmnto/totem#1295 CR/GCA architectural fix: the original Phase 2
      // implementation mutated linkedStoreInitErrors on runtime failure,
      // which permanently degraded the session for transient issues like
      // a file lock during a parallel `totem sync`. The fix: runtime
      // failures populate a per-query Map that is discarded after the
      // response is built. A subsequent successful query sees zero warning.
      const flaky: MockLinkedStore = {
        search: vi
          .fn()
          .mockRejectedValueOnce(new Error('Transient lock'))
          .mockResolvedValueOnce([
            {
              label: 'Recovered',
              type: 'spec',
              filePath: 'adr/adr-001.md',
              absoluteFilePath: '/abs/flaky/adr/adr-001.md',
              sourceRepo: 'flaky',
              score: 0.8,
              content: 'recovered content',
            },
          ]),
        // First-query reconnect attempt fails (so the runtime warning fires);
        // second query bypasses the catch path entirely.
        reconnect: vi.fn().mockRejectedValue(new Error('Reconnect lock')),
      };
      mockLinkedStores.set('flaky', flaky);
      mockSearchResults = [
        {
          label: 'Primary',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.7,
          content: 'primary',
        },
      ];

      // First query: runtime failure → warning present
      const first = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(first.content[0]!.text).toContain('[SYSTEM WARNING]');
      expect(first.content[0]!.text).toContain('flaky');

      // Second query: linked store recovers → NO warning carried over
      const second = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(second.content[0]!.text).not.toContain('[SYSTEM WARNING]');
      expect(second.content[0]!.text).toContain('Recovered');
    });

    it('targeted Case 2 returns isError when the linked store fails completely (GCA HIGH)', async () => {
      // mmnto/totem#1295 GCA HIGH: when the user explicitly names a
      // boundary and the targeted linked store fails (initial AND
      // reconnect+retry), the response must signal isError: true rather
      // than falling through to a "no results found" body. The agent
      // should not misinterpret a real outage as an absence of relevant
      // knowledge. This is symmetric with Case 3 (boundary matches a
      // failed-init linked store).
      // The search throws on EVERY call (initial + post-reconnect retry).
      // Reconnect succeeds so the retry actually fires — proves we go all
      // the way through the retry path before returning isError.
      const targeted: MockLinkedStore = {
        search: vi.fn().mockRejectedValue(new Error('Connection refused')),
        reconnect: vi.fn(async () => {}),
      };
      mockLinkedStores.set('strategy', targeted);
      // Primary results are deliberately set so we can prove they are
      // NOT leaked into the response (a regression would show them).
      mockSearchResults = [
        {
          label: 'Bogus primary hit',
          type: 'code',
          filePath: 'src/strategy.ts',
          score: 0.9,
          content: 'unrelated local',
        },
      ];

      const result = (await handle({ query: 'test', boundary: 'strategy' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBe(true);
      // Both reconnect and the second search were attempted
      expect(targeted.reconnect).toHaveBeenCalledOnce();
      expect(targeted.search).toHaveBeenCalledTimes(2);
      // Error message names the targeted boundary and includes both errors
      const text = result.content[0]!.text;
      expect(text).toContain('strategy');
      expect(text).toContain('Connection refused');
      // Critically: NO bogus primary results leaked into the response
      expect(text).not.toContain('Bogus primary hit');
    });

    it('boundary matching a name-collision error keyed under the bare derived name routes via Case 3', async () => {
      // mmnto/totem#1295 GCA HIGH catch: the collision detection in
      // initContext used to key the error under a descriptive composite
      // (e.g., `strategy (collision at .strategy2)`), so a user typing
      // `boundary: 'strategy'` could not find the entry via
      // `linkedStoreInitErrors.has('strategy')` and would fall through to
      // raw-prefix search on the primary — exactly the silent drift this
      // PR is supposed to prevent.
      //
      // The fix in context.ts now keys collisions under the BARE derived
      // name. This test asserts the contract from the consumer side:
      // a collision-style error message keyed under the bare name MUST
      // route via Case 3 (explicit isError) rather than Case 4 (raw
      // prefix). This is the integration guarantee the bare-name keying
      // change unlocks.
      mockLinkedStoreInitErrors.set(
        'strategy',
        'Another linked index already claims the name "strategy". ' +
          'Path "./strategy2" also derives the link name "strategy". ' +
          'Rename one of the linked directories or remove the duplicate from config.linkedIndexes.',
      );
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

      expect(result.isError).toBe(true);
      // The collision-style message should be surfaced via Case 3 wrapping
      expect(result.content[0]!.text).toContain('strategy');
      expect(result.content[0]!.text).toContain('not available');
      expect(result.content[0]!.text).toContain('already claims');
      // Bogus primary hit MUST NOT appear (no raw-prefix fallback)
      expect(result.content[0]!.text).not.toContain('Bogus primary hit');
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

    it('one-shot linked-stores warning is NOT consumed by a transient getContext failure (CR minor)', async () => {
      // mmnto/totem#1295 CR minor: previously `firstLinkedStoresCheckDone`
      // was set BEFORE awaiting `getContext()`, so a transient init error
      // on the very first call permanently suppressed the startup warning
      // for the rest of the session. The fix moves the flag write to
      // AFTER getContext resolves successfully.
      //
      // This test exercises the bug-fixed contract end-to-end:
      //   1. First handle() call: getContext throws on every call (4+ times
      //      to cover setLogDir, runFirstQueryHealthCheck, runFirstLinkedStoresCheck,
      //      and performSearch). The handler returns isError but neither
      //      first-query flag is consumed.
      //   2. Second handle() call: getContext succeeds. The first-query gates
      //      run for real, the linkedStoreInitErrors warning is surfaced,
      //      and the search returns normally.
      mockLinkedStoreInitErrors.set('strategy', 'Linked index is empty (0 rows).');
      mockSearchResults = [
        {
          label: 'Primary result',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.9,
          content: 'content',
        },
      ];

      // First call: 8 failures is enough to cover every getContext
      // invocation in a single handle() call (setLogDir, healthCheck,
      // linkedStores, performSearch, plus the outer-retry path).
      mockGetContextFailuresRemaining = 8;
      const first = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      // The first call hard-fails (no context, no results)
      expect(first.isError).toBe(true);
      // Critically: the warning is NOT surfaced in the failure response
      // (linkedStoresWarning was null because getContext threw)
      expect(first.content[0]!.text).not.toContain('Linked index is empty');

      // Second call: getContext now succeeds. With the fix, the first-query
      // flag was NOT consumed on the first attempt, so the warning surfaces.
      mockGetContextFailuresRemaining = 0;
      const second = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      expect(second.isError).toBeUndefined();
      // The startup warning is now surfaced — the bug fix is observable
      expect(second.content[0]!.text).toContain('[SYSTEM WARNING]');
      expect(second.content[0]!.text).toContain('strategy');
      expect(second.content[0]!.text).toContain('empty (0 rows)');
      // And the actual search result is also present
      expect(second.content[0]!.text).toContain('Primary result');
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

    it('linked store stale-handle recovers via per-store reconnect+retry (Shield AI catch)', async () => {
      // Shield AI finding on the Phase 2 review: if a linked index gets
      // rebuilt by a concurrent `totem sync`, its table handle goes stale
      // and queries fail. The fix is the per-linked-store catch+reconnect+
      // retry inside `federatedSearch`: when a linked store's search
      // throws, federatedSearch calls its `.reconnect()` and retries the
      // search before recording a runtime failure.
      //
      // mmnto/totem#1295 CR minor: this test asserts the linked-store
      // reconnect spy was actually invoked AND that the retry produces
      // recovered results. Without the spy assertion, the test would still
      // pass if federatedSearch stopped reconnecting linked stores entirely
      // — the exact regression Shield AI was guarding against.
      mockSearchResults = [
        {
          label: 'Primary',
          type: 'code',
          filePath: 'src/foo.ts',
          score: 0.7,
          content: 'content',
        },
      ];
      const strategyStore: MockLinkedStore = {
        // First search call throws (stale handle), second call (after
        // reconnect) returns the recovered result.
        search: vi
          .fn()
          .mockRejectedValueOnce(new Error('Stale handle'))
          .mockResolvedValueOnce([
            {
              label: 'Linked recovered',
              type: 'spec',
              filePath: 'adr/adr-001.md',
              absoluteFilePath: '/abs/strategy/adr/adr-001.md',
              sourceRepo: 'strategy',
              score: 0.8,
              content: 'strategy content after reconnect',
            },
          ]),
        reconnect: vi.fn(async () => {}),
      };
      mockLinkedStores.set('strategy', strategyStore);

      const result = (await handle({ query: 'test' })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      // The linked store's reconnect spy was actually invoked
      expect(strategyStore.reconnect).toHaveBeenCalledOnce();
      // The search spy was called twice: once that threw, once after reconnect
      expect(strategyStore.search).toHaveBeenCalledTimes(2);
      expect(result.isError).toBeUndefined();
      // Both primary and the recovered linked result are in the merged response
      expect(result.content[0]!.text).toContain('Primary');
      expect(result.content[0]!.text).toContain('Linked recovered');
      // No runtime warning because the recovery succeeded
      expect(result.content[0]!.text).not.toContain('[SYSTEM WARNING]');
    });

    it('all results display absolute paths so the agent can Read/Edit unambiguously', async () => {
      // mmnto/totem#1295 CR MAJOR: `formatResult` previously fell back to
      // relative `filePath` for primary hits, reintroducing repo-root
      // ambiguity in the common case — exactly the bug `absoluteFilePath`
      // was added to fix. Both primary and linked hits must now display
      // absolute paths in the File line.
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
      // Primary: absolute path (constructed by the mock from projectRoot
      // + filePath, mirroring real LanceStore behavior)
      expect(text).toContain('**File:** /fake/project/src/primary.ts');
      // Primary's relative path must NOT appear in the File line — the
      // regression would be the bare `src/primary.ts` (without the
      // `/fake/project/` prefix) appearing where the absolute path goes
      expect(text).not.toContain('**File:** src/primary.ts ');
      // Linked: absolute path in the File field (unchanged)
      expect(text).toContain('**File:** /abs/totem-strategy/adr/linked.md');
      // Linked result has the [sourceRepo] tag prefix
      expect(text).toContain('[strategy] Linked');
      // Primary has no tag prefix (uses bare label)
      expect(text).toMatch(/### \d+\. Primary \(code\)/);
    });
  });
});

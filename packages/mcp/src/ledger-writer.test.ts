import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-writer-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Read the ledger as parsed rows. */
function readRows(ledgerPath: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(ledgerPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function mockContext(): void {
  // Mock getContext to return our tmp project root + minimal config.
  vi.doMock('./context.js', () => ({
    getContext: async () => ({
      projectRoot: tmpDir,
      config: { totemDir: '.totem' },
    }),
  }));
}

describe('logMcpCall', () => {
  it('appends an mcp_call event to events.ndjson with the activity_name', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');

    const ledgerPath = path.join(tmpDir, '.totem', 'ledger', 'events.ndjson');
    expect(fs.existsSync(ledgerPath)).toBe(true);

    const rows = readRows(ledgerPath);
    // Exactly one row, and it is the mcp_call. `logMcpCall` fires at handler
    // ENTRY — before the health gate and before the search — so it must NOT
    // mint a query-before-derive correlation ID here (mmnto-ai/totem#2510):
    // a search that was blocked or threw grounded nothing.
    expect(rows).toHaveLength(1);

    const parsed = rows[0]!;
    expect(parsed.type).toBe('mcp_call');
    expect(parsed.activity_name).toBe('search_knowledge');
    expect(parsed.source).toBe('bot');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('does NOT mint a corpus_query row — that is the post-search seam', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'));
    expect(rows.some((r) => r.type === 'corpus_query')).toBe(false);
  });

  it('includes session_id when .session-id is present and within TTL', async () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    const ledgerDir = path.join(tmpDir, '.totem', 'ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, '.session-id'), sessionId, 'utf-8');

    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');

    const lines = fs
      .readFileSync(path.join(ledgerDir, 'events.ndjson'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.session_id).toBe(sessionId);
  });

  it('omits session_id when .session-id is missing', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');

    const lines = fs
      .readFileSync(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.session_id).toBeUndefined();
  });

  it('does not throw when getContext fails', async () => {
    vi.doMock('./context.js', () => ({
      getContext: async () => {
        throw new Error('context load failed');
      },
    }));
    const { logMcpCall } = await import('./ledger-writer.js');
    // Must not throw — telemetry is fire-and-forget.
    await expect(logMcpCall('search_knowledge')).resolves.toBeUndefined();
  });

  it('appends a second event without overwriting the first', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');
    await logMcpCall('describe_project');

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'));
    // Pin the TOTAL row multiset, not just the type-filtered view: a filtered
    // assertion alone would still pass if an extra unexpected row appeared.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type)).toEqual(['mcp_call', 'mcp_call']);
    expect(rows[0]!.activity_name).toBe('search_knowledge');
    expect(rows[1]!.activity_name).toBe('describe_project');
  });
});

describe('logCorpusQuery (mmnto-ai/totem#2510)', () => {
  it('writes a corpus_query row carrying a correlation ID', async () => {
    // The QBD writer only records inside an instrumented project, so the
    // `.totem` directory must exist — as it does in any real repo.
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    mockContext();
    const { logCorpusQuery } = await import('./ledger-writer.js');
    await logCorpusQuery();

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('corpus_query');
    expect(rows[0]!.activity_name).toBe('search_knowledge');
    expect(rows[0]!.source).toBe('bot');
    expect(typeof rows[0]!.qbd_correlation_id).toBe('string');
  });

  it('does not throw when getContext fails', async () => {
    vi.doMock('./context.js', () => ({
      getContext: async () => {
        throw new Error('context load failed');
      },
    }));
    const { logCorpusQuery } = await import('./ledger-writer.js');
    await expect(logCorpusQuery()).resolves.toBeUndefined();
  });
});

describe('logSelectionManifest (mmnto-ai/totem#2468)', () => {
  const input = {
    context: { query: 'q', status: 'ok' },
    universe: 'store-returned-pool maxResults=5',
    candidates: [
      {
        id: 'a.ts',
        disposition: 'selected' as const,
        reason: 'returned rank=1',
        bytes: 4,
        approxTokens: 1,
      },
    ],
    warnings: [],
  };

  it('writes a schema-valid row to selection-manifests.ndjson end-to-end', async () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    mockContext();
    const { logSelectionManifest } = await import('./ledger-writer.js');
    await logSelectionManifest(input);

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'selection-manifests.ndjson'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({
      schemaVersion: 1,
      emitter: 'search_knowledge',
      universe: 'store-returned-pool maxResults=5',
    });
    expect(rows[0]!.costBasis).toEqual({
      bytes: 'utf8-length',
      approxTokens: 'ceil(bytes/4) approximation',
    });
    // Emitting-package version rides the row (leg round 2, finding 4 — the
    // compile.ts precedent names "regressions that strip cli_version" as a
    // known class; this guards the seam).
    expect(String(rows[0]!.cli_version)).toMatch(/^\d+\.\d+\.\d+/);
    // The events.ndjson stream is untouched — the sidecar ruling (#2468 OQ1).
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'))).toBe(false);
  });

  it('does not throw when getContext fails', async () => {
    vi.doMock('./context.js', () => ({
      getContext: async () => {
        throw new Error('context load failed');
      },
    }));
    const { logSelectionManifest } = await import('./ledger-writer.js');
    await expect(logSelectionManifest(input)).resolves.toBeUndefined();
  });

  it('never throws on a contract-invalid row — the sense wrapper absorbs it, nothing persists', async () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    mockContext();
    const { logSelectionManifest } = await import('./ledger-writer.js');
    const poisoned = {
      ...input,
      candidates: [{ ...input.candidates[0]!, reason: '' }],
    };
    await expect(logSelectionManifest(poisoned)).resolves.toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'ledger', 'selection-manifests.ndjson'))).toBe(
      false,
    );
  });
});

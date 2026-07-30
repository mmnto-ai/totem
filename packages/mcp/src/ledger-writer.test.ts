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
    // A search_knowledge call now writes TWO rows: the unchanged ADR-029
    // `mcp_call` row, plus the #2510 `corpus_query` row. Assert by type rather
    // than by position so neither can drift silently.
    expect(rows.map((r) => r.type).sort()).toEqual(['corpus_query', 'mcp_call']);

    const parsed = rows.find((r) => r.type === 'mcp_call')!;
    expect(parsed.activity_name).toBe('search_knowledge');
    expect(parsed.source).toBe('bot');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('writes a corpus_query row for search_knowledge (mmnto-ai/totem#2510)', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('search_knowledge');

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'));
    const query = rows.find((r) => r.type === 'corpus_query')!;
    expect(query.activity_name).toBe('search_knowledge');
    expect(query.source).toBe('bot');
    // The correlation ID must be present and minted at this row's own instant.
    expect(typeof query.qbd_correlation_id).toBe('string');
  });

  it('does NOT write a corpus_query row for non-query tools', async () => {
    mockContext();
    const { logMcpCall } = await import('./ledger-writer.js');
    await logMcpCall('describe_project');

    const rows = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'));
    expect(rows.map((r) => r.type)).toEqual(['mcp_call']);
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

    const mcpCalls = readRows(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson')).filter(
      (r) => r.type === 'mcp_call',
    );
    expect(mcpCalls).toHaveLength(2);
    expect(mcpCalls[0]!.activity_name).toBe('search_knowledge');
    expect(mcpCalls[1]!.activity_name).toBe('describe_project');
  });
});

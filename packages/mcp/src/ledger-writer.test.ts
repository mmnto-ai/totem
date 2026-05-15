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

    const lines = fs
      .readFileSync(ledgerPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe('mcp_call');
    expect(parsed.activity_name).toBe('search_knowledge');
    expect(parsed.source).toBe('bot');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
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

    const lines = fs
      .readFileSync(path.join(tmpDir, '.totem', 'ledger', 'events.ndjson'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim());
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).activity_name).toBe('search_knowledge');
    expect(JSON.parse(lines[1]!).activity_name).toBe('describe_project');
  });
});

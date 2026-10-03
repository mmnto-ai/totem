import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerTools } from './register-tools.js';

/**
 * Pins the MCP tool annotations (mmnto-ai/totem#3004) through the server's own
 * advertised `tools/list`, not the source literals: a real McpServer registered
 * through the SAME `registerTools()` the entrypoint uses (`index.ts` connects a
 * stdio transport at import time, so it cannot be imported here), read by a
 * real Client over an in-memory transport. A tool the server advertises is a
 * tool this test sees; the pinned table below is the only list.
 */

const EXPECTED: Record<
  string,
  { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }
> = {
  search_knowledge: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  describe_project: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  add_lesson: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  // Closed-world since mmnto-ai/totem#3008: the spawn reaches no registry.
  verify_execution: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
};

const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const;

let client: Client;
let server: McpServer;
let tools: Awaited<ReturnType<Client['listTools']>>['tools'];

beforeAll(async () => {
  server = new McpServer({ name: 'annotations-test', version: '0.0.0' });
  registerTools(server);
  client = new Client({ name: 'annotations-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client.close();
  await server.close();
});

describe('MCP tool annotations (tools/list)', () => {
  it('every advertised tool declares readOnlyHint, destructiveHint and openWorldHint as booleans', () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      for (const hint of HINTS) {
        expect(typeof tool.annotations?.[hint], `${tool.name}.${hint}`).toBe('boolean');
      }
    }
  });

  it('the four tools carry exactly the pinned values', () => {
    const advertised = Object.fromEntries(
      tools.map((tool) => [tool.name, tool.annotations ?? null]),
    );
    expect(Object.keys(advertised).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [name, expected] of Object.entries(EXPECTED)) {
      expect(advertised[name], name).toEqual(expected);
    }
  });
});

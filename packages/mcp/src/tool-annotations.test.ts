import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerAddLesson } from './tools/add-lesson.js';
import { registerDescribeProject } from './tools/describe-project.js';
import { registerSearchKnowledge } from './tools/search-knowledge.js';
import { registerVerifyExecution } from './tools/verify-execution.js';

/**
 * Pins the MCP tool annotations (mmnto-ai/totem#3004) through the server's own
 * advertised `tools/list`, not the source literals: a real McpServer with the
 * same registrations as `index.ts`, read by a real Client over an in-memory
 * transport. `index.ts` connects a stdio transport at import time, so the test
 * mirrors its register calls and a drift guard below keeps the two in step.
 */

const REGISTRATIONS = [
  registerSearchKnowledge,
  registerAddLesson,
  registerVerifyExecution,
  registerDescribeProject,
] as const;

const EXPECTED: Record<
  string,
  { readOnlyHint: boolean; destructiveHint: boolean; openWorldHint: boolean }
> = {
  search_knowledge: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  describe_project: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  add_lesson: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  verify_execution: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'] as const;

let client: Client;
let server: McpServer;
let tools: Awaited<ReturnType<Client['listTools']>>['tools'];

beforeAll(async () => {
  server = new McpServer({ name: 'annotations-test', version: '0.0.0' });
  for (const register of REGISTRATIONS) register(server);
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
  it('registers the same tools as the server entrypoint', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const entry = fs.readFileSync(path.join(here, 'index.ts'), 'utf-8');
    const entryCalls = [...entry.matchAll(/^(register[A-Za-z]+)\(server\);$/gm)].map((m) => m[1]);
    expect(entryCalls.sort()).toEqual(REGISTRATIONS.map((fn) => fn.name).sort());
  });

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

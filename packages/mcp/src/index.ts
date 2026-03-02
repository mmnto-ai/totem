#!/usr/bin/env node

import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { registerAddLesson } from './tools/add-lesson.js';
import { registerSearchKnowledge } from './tools/search-knowledge.js';

const require = createRequire(import.meta.url);
const { version } = z.object({ version: z.string() }).parse(require('../package.json'));

const server = new McpServer({
  name: '@mmnto/totem',
  version,
});

registerSearchKnowledge(server);
registerAddLesson(server);

const transport = new StdioServerTransport();
await server.connect(transport);

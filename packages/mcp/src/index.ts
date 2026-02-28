#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSearchKnowledge } from './tools/search-knowledge.js';
import { registerAddLesson } from './tools/add-lesson.js';

const server = new McpServer({
  name: '@mmnto/totem',
  version: '0.1.0',
});

registerSearchKnowledge(server);
registerAddLesson(server);

const transport = new StdioServerTransport();
await server.connect(transport);

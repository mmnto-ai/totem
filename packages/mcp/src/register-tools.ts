import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAddLesson } from './tools/add-lesson.js';
import { registerDescribeProject } from './tools/describe-project.js';
import { registerSearchKnowledge } from './tools/search-knowledge.js';
import { registerVerifyExecution } from './tools/verify-execution.js';

/**
 * The one registration path for the server's tools. The shipped entrypoint
 * (`index.ts`, which connects its stdio transport at import time) and the
 * annotations test both call it, so a tool the server advertises is a tool the
 * test sees: there is no second list to drift from (mmnto-ai/totem#3004).
 */
export function registerTools(server: McpServer): void {
  registerSearchKnowledge(server);
  registerAddLesson(server);
  registerVerifyExecution(server);
  registerDescribeProject(server);
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ContentType } from '@mmnto/totem';
import { ContentTypeSchema } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { formatXmlResponse } from '../xml-format.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

async function performSearch(
  query: string,
  typeFilter?: ContentType,
  maxResults?: number,
): Promise<ToolResult> {
  const { store } = await getContext();
  const results = await store.search({
    query,
    typeFilter,
    maxResults: maxResults ?? 5,
  });

  if (results.length === 0) {
    return {
      content: [
        { type: 'text' as const, text: formatXmlResponse('knowledge', 'No results found.') },
      ],
    };
  }

  const formatted = results
    .map(
      (r, i) =>
        `### ${i + 1}. ${r.label} (${r.type})\n` +
        `**File:** ${r.filePath} | **Score:** ${r.score.toFixed(3)}\n\n` +
        `${r.content}`,
    )
    .join('\n\n---\n\n');

  return { content: [{ type: 'text' as const, text: formatXmlResponse('knowledge', formatted) }] };
}

export function registerSearchKnowledge(server: McpServer): void {
  server.registerTool(
    'search_knowledge',
    {
      description: `Search the Totem knowledge index for relevant code, session logs, specs, or lessons. Use this BEFORE writing code, reviewing PRs, or making architectural decisions to retrieve domain constraints, past traps, and established patterns.`,
      inputSchema: {
        query: z.string().describe('The search query'),
        type_filter: z
          .enum(ContentTypeSchema.options)
          .optional()
          .describe('Filter results by content type: code, session_log, or spec'),
        max_results: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of results to return (default: 5)'),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ query, type_filter, max_results }) => {
      try {
        return await performSearch(query, type_filter, max_results);
      } catch (originalErr) {
        // Any LanceDB error could indicate a stale handle (e.g. files deleted
        // during a full sync rebuild). Reconnect and retry once before failing.
        try {
          await reconnectStore();
          return await performSearch(query, type_filter, max_results);
        } catch (retryErr) {
          // Retry failed — report both errors for diagnostics
          const originalMessage =
            originalErr instanceof Error ? originalErr.message : String(originalErr);
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);

          const text =
            originalMessage === retryMessage
              ? `[Totem Error] Search failed: ${originalMessage}`
              : `[Totem Error] Search failed. Initial error: ${originalMessage}. Retry after reconnect also failed: ${retryMessage}`;

          return {
            content: [{ type: 'text' as const, text }],
            isError: true,
          };
        }
      }
    },
  );
}

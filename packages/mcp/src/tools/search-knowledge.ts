import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ContentType } from '@mmnto/totem';
import { ContentTypeSchema } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';

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
    return { content: [{ type: 'text' as const, text: 'No results found.' }] };
  }

  const formatted = results
    .map(
      (r, i) =>
        `### ${i + 1}. ${r.label} (${r.type})\n` +
        `**File:** ${r.filePath} | **Score:** ${r.score.toFixed(3)}\n\n` +
        `${r.content}`,
    )
    .join('\n\n---\n\n');

  return { content: [{ type: 'text' as const, text: formatted }] };
}

export function registerSearchKnowledge(server: McpServer): void {
  server.registerTool(
    'search_knowledge',
    {
      description:
        'Search the Totem knowledge index for relevant code, session logs, specs, or lessons.',
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
      } catch (err) {
        const originalMessage = err instanceof Error ? err.message : String(err);

        // Detect stale LanceDB file handles after a full sync rebuild.
        // NOTE: This relies on string matching LanceDB error messages, which may
        // break if the library changes its error format in a future version.
        const isStale = /not found/i.test(originalMessage) || /LanceError/i.test(originalMessage);

        if (isStale) {
          try {
            await reconnectStore();
            return await performSearch(query, type_filter, max_results);
          } catch (retryErr) {
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `[Totem Error] Failed to search knowledge after reconnect: ${retryMessage}`,
                },
              ],
              isError: true,
            };
          }
        }

        const message = originalMessage.startsWith('[Totem Error]')
          ? originalMessage
          : `[Totem Error] Failed to search knowledge: ${originalMessage}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}

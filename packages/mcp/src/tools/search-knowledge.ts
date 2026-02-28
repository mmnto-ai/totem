import { z } from 'zod';
import { ContentTypeSchema } from '@mmnto/totem';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from '../context.js';

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
        const { store } = await getContext();

        const results = await store.search({
          query,
          typeFilter: type_filter,
          maxResults: max_results ?? 5,
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
      } catch (err) {
        const originalMessage = err instanceof Error ? err.message : String(err);
        const message = originalMessage.startsWith('[Totem Error]')
          ? originalMessage
          : `[Totem Error] Failed to search knowledge: ${originalMessage}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}

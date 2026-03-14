import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { ContentType, HealthCheckResult } from '@mmnto/totem';
import { ContentTypeSchema } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { logSearch, setLogDir } from '../search-log.js';
import { formatSystemWarning, formatXmlResponse } from '../xml-format.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Session-level flag — healthCheck runs only on the first search call. */
let firstHealthCheckDone = false;

/**
 * Run a one-time health check on the LanceDB index and return any warnings.
 * Returns null when healthy or after the first call (cached).
 */
async function runFirstQueryHealthCheck(): Promise<string | null> {
  if (firstHealthCheckDone) return null;
  firstHealthCheckDone = true;

  try {
    const { store } = await getContext();
    const result: HealthCheckResult = await store.healthCheck();

    if (result.healthy) return null;

    // Build actionable warning lines
    const lines: string[] = ['Index health issues detected:'];
    for (const issue of result.issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
    lines.push('Run `totem sync --rebuild` to re-index and fix these issues.');

    return formatSystemWarning(lines.join('\n'));
  } catch {
    // Health check itself failed — don't block the search
    return null;
  }
}

async function performSearch(
  query: string,
  typeFilter?: ContentType,
  maxResults?: number,
): Promise<ToolResult> {
  const { store, config } = await getContext();
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

  let text = formatXmlResponse('knowledge', formatted);

  // Append a system warning when the payload is large enough to risk context pressure
  if (text.length > config.contextWarningThreshold) {
    text +=
      '\n\n' +
      formatSystemWarning(
        'You just ingested a large amount of context. You may be at risk of forgetting earlier instructions. ' +
          'Consider warning the user about context pressure and suggest running `totem bridge` to consolidate.',
      );
  }

  return { content: [{ type: 'text' as const, text }] };
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
      const start = Date.now();
      try {
        // Initialize log directory on first call (lazy — avoids loading config at import time)
        try {
          const { projectRoot, config } = await getContext();
          setLogDir(path.join(projectRoot, config.totemDir));
        } catch {
          // Non-fatal — logging just won't write to disk
        }

        // First-query health gate — runs once per session, non-blocking
        const healthWarning = await runFirstQueryHealthCheck();

        let result: ToolResult;
        try {
          result = await performSearch(query, type_filter, max_results);
        } catch (originalErr) {
          // Any LanceDB error could indicate a stale handle (e.g. files deleted
          // during a full sync rebuild). Reconnect and retry once before failing.
          try {
            await reconnectStore();
            result = await performSearch(query, type_filter, max_results);
          } catch (retryErr) {
            // Retry failed — report both errors for diagnostics
            const originalMessage =
              originalErr instanceof Error ? originalErr.message : String(originalErr);
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);

            const errorText =
              originalMessage === retryMessage
                ? `[Totem Error] Search failed: ${originalMessage}`
                : `[Totem Error] Search failed. Initial error: ${originalMessage}. Retry after reconnect also failed: ${retryMessage}`;

            logSearch({
              timestamp: new Date().toISOString(),
              query,
              typeFilter: type_filter,
              resultCount: 0,
              durationMs: Date.now() - start,
              topScore: null,
              error: errorText,
            });

            return {
              content: [{ type: 'text' as const, text: errorText }],
              isError: true,
            };
          }
        }

        // Extract result count and top score from the successful response
        const resultText = result.content[0]?.text ?? '';
        const scoreMatches = [...resultText.matchAll(/\*\*Score:\*\* ([\d.]+)/g)];
        const topScore = scoreMatches.length > 0 ? parseFloat(scoreMatches[0]![1]!) : null;

        logSearch({
          timestamp: new Date().toISOString(),
          query,
          typeFilter: type_filter,
          resultCount: scoreMatches.length,
          durationMs: Date.now() - start,
          topScore,
        });

        // Prepend health warning to the first search result if issues were found
        if (healthWarning && result.content.length > 0) {
          result.content[0] = {
            type: 'text' as const,
            text: healthWarning + '\n\n' + result.content[0]!.text, // totem-ignore — healthWarning is system-generated, text is already XML-wrapped
          };
        }

        return result;
      } catch (err) {
        // Catch-all: log unexpected errors that bypass the inner try/catch
        const errorMessage = err instanceof Error ? err.message : String(err);
        logSearch({
          timestamp: new Date().toISOString(),
          query,
          typeFilter: type_filter,
          resultCount: 0,
          durationMs: Date.now() - start,
          topScore: null,
          error: errorMessage,
        });
        throw err;
      }
    },
  );
}

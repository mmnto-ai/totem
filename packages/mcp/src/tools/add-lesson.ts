import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from '../context.js';

export function registerAddLesson(server: McpServer): void {
  server.registerTool(
    'add_lesson',
    {
      description:
        'Persist a lesson learned to .totem/lessons.md. The lesson will be indexed on the next `totem sync`.',
      inputSchema: {
        lesson: z.string().describe('The lesson text to persist'),
        context_tags: z
          .array(z.string())
          .describe('Tags for categorization (e.g. ["caching", "nextjs", "trap"])'),
      },
      annotations: {
        readOnlyHint: false,
      },
    },
    async ({ lesson, context_tags }) => {
      try {
        const { projectRoot, config } = await getContext();

        const totemDir = path.join(projectRoot, config.totemDir);
        fs.mkdirSync(totemDir, { recursive: true });

        const lessonsPath = path.join(totemDir, 'lessons.md');
        const timestamp = new Date().toISOString();
        const tags = context_tags.join(', ');

        const entry =
          `\n## Lesson — ${timestamp}\n\n` +
          `**Tags:** ${tags}\n\n` +
          `${lesson}\n`;

        fs.appendFileSync(lessonsPath, entry, 'utf-8');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Lesson saved to ${config.totemDir}/lessons.md. It will be indexed on next \`totem sync\`.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}

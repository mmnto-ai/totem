import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getContext, reconnectStore } from '../context.js';

/**
 * Detect the correct package-manager command for running `totem sync`.
 */
function detectSyncCommand(projectRoot: string): { cmd: string; args: string[] } {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return { cmd: 'pnpm', args: ['exec', 'totem', 'sync', '--incremental'] };
  }
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
    return { cmd: 'yarn', args: ['totem', 'sync', '--incremental'] };
  }
  return { cmd: 'npx', args: ['totem', 'sync', '--incremental'] };
}

const RECONNECT_DELAY_MS = 5_000;

/** Debounce guard — prevents concurrent sync processes. */
let syncPending = false;

export function registerAddLesson(server: McpServer): void {
  server.registerTool(
    'add_lesson',
    {
      description:
        'Persist a lesson learned to .totem/lessons.md. An incremental re-index is automatically triggered in the background.',
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
        await fs.promises.mkdir(totemDir, { recursive: true });

        const lessonsPath = path.join(totemDir, 'lessons.md');
        const timestamp = new Date().toISOString();
        const tags = context_tags.join(', ');

        const entry = `\n## Lesson — ${timestamp}\n\n` + `**Tags:** ${tags}\n\n` + `${lesson}\n`;

        await fs.promises.appendFile(lessonsPath, entry, 'utf-8');

        // Fire-and-forget: spawn background incremental sync so the lesson
        // is searchable within this session (Issue #22).
        // Debounce: skip if a sync is already in flight.
        if (!syncPending) {
          syncPending = true;
          const { cmd, args } = detectSyncCommand(projectRoot);
          const logPath = path.join(totemDir, 'mcp-sync.log');
          const logFd = fs.openSync(logPath, 'a');
          const child = spawn(cmd, args, {
            cwd: projectRoot,
            detached: true,
            stdio: ['ignore', logFd, logFd],
            shell: true,
            windowsHide: true,
          });
          child.unref();
          fs.closeSync(logFd);

          // Reconnect the store after the sync has had time to finish,
          // so the next search_knowledge call sees the new data.
          const errLogPath = path.join(totemDir, 'mcp-errors.log');
          setTimeout(() => {
            reconnectStore()
              .catch((err: unknown) => {
                const msg = `[${new Date().toISOString()}] Store reconnect failed: ${err instanceof Error ? err.message : String(err)}\n`;
                fs.promises.appendFile(errLogPath, msg, 'utf-8').catch(() => {
                  // Last-resort: file logging failed — nothing left to do.
                });
              })
              .finally(() => {
                syncPending = false;
              });
          }, RECONNECT_DELAY_MS);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Lesson saved to ${config.totemDir}/lessons.md. Background re-index triggered — it will be searchable shortly.`,
            },
          ],
        };
      } catch (err) {
        const originalMessage = err instanceof Error ? err.message : String(err);
        const message = originalMessage.startsWith('[Totem Error]')
          ? originalMessage
          : `[Totem Error] Failed to add lesson: ${originalMessage}`;
        return { content: [{ type: 'text' as const, text: message }], isError: true };
      }
    },
  );
}

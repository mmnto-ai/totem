import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { generateLessonHeading } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { formatXmlResponse } from '../xml-format.js';

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

const SYNC_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10_000;

/** Debounce guard — prevents concurrent sync processes. */
let syncPending = false;

/**
 * Kill a child process tree. With `shell: true`, child.kill() only kills the
 * shell — we need to kill the process group to prevent orphaned children.
 */
function killTree(child: ReturnType<typeof spawn>): void {
  if (child.pid == null) return;
  try {
    // Negative PID kills the process group on Unix; on Windows, taskkill /T handles the tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // Best-effort — process may have already exited
    child.kill();
  }
}

/**
 * Spawn `totem sync --incremental` and await its completion (up to SYNC_TIMEOUT_MS).
 * Returns { success, output } with captured stdout/stderr (capped at MAX_OUTPUT_BYTES).
 */
function runSync(projectRoot: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const { cmd, args } = detectSyncCommand(projectRoot);
    const chunks: string[] = [];
    let totalBytes = 0;
    let capped = false;

    const child = spawn(cmd, args, {
      cwd: projectRoot,
      detached: process.platform !== 'win32', // enables process group kill on Unix
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    const capture = (data: Buffer) => {
      if (capped) return;
      const str = data.toString();
      totalBytes += str.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        chunks.push(str.slice(0, MAX_OUTPUT_BYTES - (totalBytes - str.length)));
        chunks.push('\n... (output truncated)');
        capped = true;
      } else {
        chunks.push(str);
      }
    };

    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      killTree(child);
      resolve({ success: false, output: 'Sync timed out after 60s.' });
    }, SYNC_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, output: chunks.join('') });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: `Spawn error: ${err.message}` });
    });
  });
}

export function registerAddLesson(server: McpServer): void {
  server.registerTool(
    'add_lesson',
    {
      description:
        'Persist a lesson learned to .totem/lessons.md. An incremental re-index runs automatically and the result is returned.',
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
        const heading = generateLessonHeading(lesson);
        const tags = context_tags.join(', ');

        const entry = `\n## Lesson — ${heading}\n\n` + `**Tags:** ${tags}\n\n` + `${lesson}\n`;

        await fs.promises.appendFile(lessonsPath, entry, 'utf-8');

        // Await sync so the LLM gets definitive success/failure confirmation.
        // Debounce: skip if a sync is already in flight.
        let syncMessage: string;
        if (syncPending) {
          syncMessage =
            'A sync is already in progress — this lesson will be indexed when it completes.';
        } else {
          syncPending = true;
          try {
            const { success, output } = await runSync(projectRoot);

            // Reconnect so the next search_knowledge call sees new data.
            try {
              await reconnectStore();
            } catch {
              // Non-fatal — store will reconnect on next search
            }

            syncMessage = success
              ? `Sync completed successfully. ${output.trim()}`
              : `Sync failed: ${output.trim()}`;
          } finally {
            syncPending = false;
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: formatXmlResponse(
                'lesson_added',
                `Lesson saved to ${config.totemDir}/lessons.md. ${syncMessage}`,
              ),
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

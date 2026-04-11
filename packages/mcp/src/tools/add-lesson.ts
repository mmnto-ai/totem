import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { acquireLock, generateLessonHeading, sanitize, writeLessonFileAsync } from '@mmnto/totem';

import { getContext, reconnectStore } from '../context.js';
import { detectPackageManager } from '../utils.js';
import { formatXmlResponse } from '../xml-format.js';

// ---------------------------------------------------------------------------
// Rate limiting (#844) — simple in-memory session counter
// ---------------------------------------------------------------------------
const MAX_LESSONS_PER_SESSION = 25;
let sessionLessonCount = 0;

/** Exported for testing — reset the rate-limit counter between test runs. */
export function _resetRateLimit(): void {
  sessionLessonCount = 0;
}

// ---------------------------------------------------------------------------
// Input validation schema (#844)
// ---------------------------------------------------------------------------
const AddLessonInputSchema = z.object({
  lesson: z.string().min(1, 'Lesson body must be a non-empty string'),
  context_tags: z.array(z.string().min(1)).min(1, 'At least one context tag is required'),
});

// ---------------------------------------------------------------------------
// Heading sanitization (#844) — strip XML-like angle brackets
// ---------------------------------------------------------------------------
function sanitizeHeading(heading: string): string {
  return heading.replace(/[<>]/g, '');
}

/**
 * Build the correct package-manager command for running `totem sync`.
 */
function detectSyncCommand(projectRoot: string): { cmd: string; args: string[] } {
  const pm = detectPackageManager(projectRoot);
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['exec', 'totem', 'sync', '--incremental'] };
  if (pm === 'yarn') return { cmd: 'yarn', args: ['totem', 'sync', '--incremental'] };
  return { cmd: 'npx', args: ['totem', 'sync', '--incremental'] };
}

const SYNC_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10_000;

/** Debounce guard — concurrent callers share the same sync promise. */
let activeSyncPromise: Promise<{ success: boolean; output: string }> | null = null;

/**
 * Kill a child process tree. With `detached: true`, child.kill() only kills the
 * lead process — we need to kill the process group to prevent orphaned children.
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
      windowsHide: true,
      env: { ...process.env },
      shell: process.platform === 'win32', // resolve .cmd shims on Windows (#1023)
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
        'Persist a lesson learned to .totem/lessons/. An incremental re-index runs automatically and the result is returned.',
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
      // --- Rate limiting (#844) ---
      if (sessionLessonCount >= MAX_LESSONS_PER_SESSION) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Rate limit exceeded: maximum ${MAX_LESSONS_PER_SESSION} lessons per session`,
            },
          ],
          isError: true,
        };
      }

      // --- Schema validation (#844) ---
      const parsed = AddLessonInputSchema.safeParse({ lesson, context_tags });
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => i.message).join('; ');
        return {
          content: [{ type: 'text' as const, text: `Validation error: ${issues}` }],
          isError: true,
        };
      }

      try {
        const { projectRoot, config } = await getContext();

        const totemDir = path.join(projectRoot, config.totemDir);
        await fs.promises.mkdir(totemDir, { recursive: true });

        const lessonsDir = path.join(totemDir, 'lessons');
        const validLesson = parsed.data.lesson;
        const validTags = parsed.data.context_tags;
        const safeLesson = sanitize(validLesson);
        const safeTags =
          validTags
            .map((t) => sanitize(t).replace(/[\n,]/g, ' ').trim())
            .filter(Boolean)
            .join(', ') || 'untagged';

        // --- Double-heading guard (#1284) ---
        // If the caller supplies a pre-formatted lesson whose body already
        // starts with a canonical `## Lesson — Foo` heading, extract the
        // heading and strip it from the body. Without this, `generateLessonHeading`
        // would derive a title from the "Lesson — Foo" text and produce
        // `## Lesson — Lesson — Foo`, and the original heading would remain
        // inside the body — yielding two `## Lesson — ...` lines in one file
        // that the parser then counts as two separate lessons.
        // The separator class matches em-dash (\u2014), en-dash (\u2013), and
        // hyphen, consistent with the parser's LESSON_HEADING_RE in #1278.
        // The terminator allows either trailing newlines OR end-of-string so
        // a single-line input like `## Lesson — Foo` (no body, no trailing
        // newline) still gets normalized instead of slipping through.
        // Leading `\s*` absorbs blank lines or whitespace before the heading
        // (LLM callers sometimes emit pre-formatted lessons with a leading
        // newline). Case sensitivity intentionally matches the parser's
        // canonical form in core/drift-detector.ts — if we accepted lowercase
        // here we would strip a line the parser would still treat as body
        // text, breaking round-trip semantics.
        // `matchAll` + iterator instead of `match` to satisfy the project-wide
        // lint rule about iterating all regex matches — the `^` anchor ensures
        // at most one match here regardless.
        const LESSON_HEADING_RE = /^\s*## Lesson[\s\u2014\u2013-]+(.+?)(?:\s*\n+|\s*$)/g;
        const headingMatch = safeLesson.matchAll(LESSON_HEADING_RE).next().value;
        let rawHeading: string;
        let bodyContent: string;
        if (headingMatch) {
          rawHeading = headingMatch[1]!;
          bodyContent = safeLesson.slice(headingMatch[0].length).trim();
        } else {
          rawHeading = generateLessonHeading(safeLesson);
          bodyContent = safeLesson.trim();
        }
        const heading = sanitizeHeading(rawHeading);

        // --- Source provenance (#844) ---
        const provenance = `\n**Source:** mcp (added at ${new Date().toISOString()})`;

        const entry =
          `## Lesson — ${heading}\n\n` +
          `**Tags:** ${safeTags}\n\n` +
          `${bodyContent}\n` +
          provenance;

        // Acquire lock before writing lesson, release before spawning sync
        // (the spawned sync process acquires its own lock via runSync/withLock)
        const releaseLock = await acquireLock(totemDir);
        let fileName: string;
        try {
          const writtenPath = await writeLessonFileAsync(lessonsDir, entry);
          fileName = path.basename(writtenPath);
          sessionLessonCount++;
        } finally {
          releaseLock();
        }

        const isJoining = activeSyncPromise !== null;
        if (!activeSyncPromise) {
          activeSyncPromise = runSync(projectRoot).finally(() => {
            activeSyncPromise = null;
          });
        }
        const { success, output } = await activeSyncPromise;

        if (!isJoining) {
          try {
            await reconnectStore();
          } catch {
            // Non-fatal — store will reconnect on next search
          }
        }

        const syncMessage = success
          ? `Sync completed successfully. ${output.trim()}`
          : `Sync failed: ${output.trim()}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: formatXmlResponse(
                'lesson_added',
                `Lesson saved to ${config.totemDir}/lessons/${fileName}. ${syncMessage}`,
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

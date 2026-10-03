import { execFileSync, spawn } from 'node:child_process';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { resolveCliSpawn } from '../cli-spawn.js';
import { getProjectBasics } from '../context.js';
import { formatXmlResponse } from '../xml-format.js';

const MAX_OUTPUT_CHARS = 10_000;
const LINT_TIMEOUT_MS = 30_000;

/**
 * Check for unstaged changes and return a warning if found.
 */
function checkUnstagedChanges(projectRoot: string): string | null {
  try {
    const output = execFileSync('git', ['diff', '--name-only'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 5000,
      shell: process.platform === 'win32',
    }).trim();
    if (output) {
      const files = output.split('\n').slice(0, 10);
      return (
        `WARNING: You have unstaged changes in ${files.length} file(s): ${files.join(', ')}. ` +
        'These were NOT verified. Stage them with `git add` and run verify_execution again.'
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run `totem lint` as a child process and capture output: `node` plus the
 * resolved CLI entry, no shell (mmnto-ai/totem#3008).
 */
function runLint(
  projectRoot: string,
  cmd: string,
  entry: string,
  stagedOnly: boolean,
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let totalChars = 0;

    const isWin = process.platform === 'win32';
    const child = spawn(cmd, [entry, 'lint', ...(stagedOnly ? ['--staged'] : [])], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin, // process group for clean tree-kill on Unix
      env: { ...process.env },
    });

    const capture = (data: Buffer) => {
      const str = data.toString();
      if (totalChars < MAX_OUTPUT_CHARS) {
        chunks.push(str.slice(0, MAX_OUTPUT_CHARS - totalChars));
        totalChars += str.length;
      }
    };

    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timer = setTimeout(() => {
      try {
        if (isWin && child.pid) {
          execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else if (child.pid) {
          process.kill(-child.pid); // totem-ignore — Unix-only process group kill, not child.kill()
        }
      } catch {
        // Best effort
      }
      resolve({ success: false, output: 'Lint timed out after 30s.' });
    }, LINT_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, output: chunks.reduce((acc, c) => acc + c, '') });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, output: `Lint spawn error: ${err.message}` });
    });
  });
}

export function registerVerifyExecution(server: McpServer): void {
  server.registerTool(
    'verify_execution',
    {
      description:
        'Run deterministic lint checks against your current changes to mathematically verify ' +
        'no project rules were violated. Call this BEFORE declaring a task complete. ' +
        'Returns PASS or FAIL with specific violations. Zero LLM — pure AST/regex checks. ' +
        'Writes rule metrics under .totem/ and, on a pending pack promotion, rewrites ' +
        'compiled-rules.json in place.',
      inputSchema: {
        staged_only: z
          .boolean()
          .default(true)
          .describe(
            'If true, verifies only staged changes. If false, verifies all uncommitted changes.',
          ),
      },
      // Destructive: on a pending pack promotion the spawned lint rewrites the tracked
      // compiled-rules.json in place and writes verification-outcomes.json (committable). On every
      // run that evaluates rules it writes .totem/cache/rule-metrics.json, the telemetry sink
      // .totem/temp/telemetry.jsonl and, on a suppression, a Trap Ledger event (all ignored). The
      // handler's `git diff --name-only` may refresh git's own index cache. Not open-world: the
      // tool spawns a resolved local or npm-global CLI entry with `node` and reaches no registry
      // (mmnto-ai/totem#3008). Disclosed, not counted: the lint's git reads are local commands, and
      // in a partial clone git itself may fetch missing objects from the checkout's own remote
      // while diffing; that is the repository's configuration, not a reach this tool makes.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ staged_only }) => {
      try {
        // Only the project root is needed; never open the vector store here,
        // so a store fault cannot block lint verification (mmnto-ai/totem#3009).
        const { projectRoot } = await getProjectBasics();

        // No local and no npm-layout global CLI: refuse, never fetch, and spawn
        // nothing (mmnto-ai/totem#3008).
        const target = resolveCliSpawn(projectRoot);
        if (!target.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: formatXmlResponse(
                  'verify_execution',
                  `Verification: NOT RUN\n\n${target.message}`,
                ),
              },
            ],
            isError: true,
          };
        }

        // Check for unstaged changes if running staged-only
        let warning = '';
        if (staged_only) {
          const unstagedWarning = checkUnstagedChanges(projectRoot);
          if (unstagedWarning) {
            warning = unstagedWarning + '\n\n';
          }
        }

        const { success, output } = await runLint(
          projectRoot,
          target.cmd,
          target.entry,
          staged_only,
        );

        const verdict = success ? 'PASS' : 'FAIL';
        const message =
          `CLI: ${target.label}\n` + warning + `Verification: ${verdict}\n\n${output.trim()}`;

        return {
          content: [
            {
              type: 'text' as const,
              text: formatXmlResponse('verify_execution', message),
            },
          ],
          isError: !success,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `[Totem Error] ${message}` }],
          isError: true,
        };
      }
    },
  );
}

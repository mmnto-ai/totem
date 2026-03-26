import { execFileSync, spawn } from 'node:child_process';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getContext } from '../context.js';
import { detectPackageManager } from '../utils.js';
import { formatXmlResponse } from '../xml-format.js';

const MAX_OUTPUT_CHARS = 10_000;
const LINT_TIMEOUT_MS = 30_000;

/**
 * Build the correct command for running `totem lint`.
 */
function detectLintCommand(
  projectRoot: string,
  stagedOnly: boolean,
): { cmd: string; args: string[] } {
  const lintArgs = stagedOnly ? ['lint', '--staged'] : ['lint'];
  const pm = detectPackageManager(projectRoot);
  if (pm === 'pnpm') return { cmd: 'pnpm', args: ['exec', 'totem', ...lintArgs] };
  if (pm === 'yarn') return { cmd: 'yarn', args: ['totem', ...lintArgs] };
  return { cmd: 'npx', args: ['totem', ...lintArgs] };
}

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
 * Run totem lint as a child process and capture output.
 */
function runLint(
  projectRoot: string,
  stagedOnly: boolean,
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const { cmd, args } = detectLintCommand(projectRoot, stagedOnly);
    const chunks: string[] = [];
    let totalChars = 0;

    const isWin = process.platform === 'win32';
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin, // process group for clean tree-kill on Unix
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
        'Returns PASS or FAIL with specific violations. Zero LLM — pure AST/regex checks.',
      inputSchema: {
        staged_only: z
          .boolean()
          .default(true)
          .describe(
            'If true, verifies only staged changes. If false, verifies all uncommitted changes.',
          ),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ staged_only }) => {
      try {
        const { projectRoot } = await getContext();

        // Check for unstaged changes if running staged-only
        let warning = '';
        if (staged_only) {
          const unstagedWarning = checkUnstagedChanges(projectRoot);
          if (unstagedWarning) {
            warning = unstagedWarning + '\n\n';
          }
        }

        const { success, output } = await runLint(projectRoot, staged_only);

        const verdict = success ? 'PASS' : 'FAIL';
        const message = warning + `Verification: ${verdict}\n\n${output.trim()}`;

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

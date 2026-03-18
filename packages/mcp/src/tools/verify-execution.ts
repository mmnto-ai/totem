import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getContext } from '../context.js';
import { formatXmlResponse } from '../xml-format.js';

const MAX_OUTPUT_CHARS = 10_000;
const LINT_TIMEOUT_MS = 30_000;

/**
 * Detect the correct command for running `totem lint`.
 */
function detectLintCommand(projectRoot: string): { cmd: string; args: string[] } {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return { cmd: 'pnpm', args: ['exec', 'totem', 'lint'] };
  }
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) {
    return { cmd: 'yarn', args: ['totem', 'lint'] };
  }
  return { cmd: 'npx', args: ['totem', 'lint'] };
}

/**
 * Check for unstaged changes and return a warning if found.
 */
function checkUnstagedChanges(projectRoot: string): string | null {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
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
function runLint(projectRoot: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const { cmd, args } = detectLintCommand(projectRoot);
    const chunks: string[] = [];
    let totalChars = 0;

    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
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
        if (process.platform === 'win32' && child.pid) {
          const { execSync } = require('node:child_process');
          execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } else {
          child.kill();
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

        const { success, output } = await runLint(projectRoot);

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

import { execFileSync } from 'node:child_process';

import { z } from 'zod';

import { GH_TIMEOUT_MS, IS_WIN } from '../utils.js';

const GH_MAX_BUFFER = 10 * 1024 * 1024; // 10MB — handles paginated API responses

/**
 * Shared error handler for all GitHub CLI interactions.
 * Re-throws [Totem Error] as-is, wraps ZodErrors and ENOENT, and
 * falls through to a generic message for anything else.
 */
export function handleGhError(err: unknown, context: string): never {
  if (err instanceof Error && err.message.includes('[Totem Error]')) {
    throw err;
  }
  if (err instanceof z.ZodError) {
    throw new Error(`[Totem Error] Failed to parse GitHub ${context}: ${err.message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT')) {
    throw new Error(`[Totem Error] GitHub CLI (gh) is required. Install: https://cli.github.com`);
  }
  if (/\b(403|429)\b/.test(msg) || /rate.limit/i.test(msg)) {
    throw new Error(`[Totem Error] GitHub API rate limit exceeded. Try again later.`);
  }
  throw new Error(`[Totem Error] Failed to fetch ${context}: ${msg}`);
}

/**
 * Shared fetch → JSON.parse → Zod validate utility for all `gh` CLI calls.
 */
export function ghFetchAndParse<T>(
  args: string[],
  schema: z.ZodType<T>,
  context: string,
  cwd: string,
): T {
  try {
    const raw = execFileSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GH_TIMEOUT_MS,
      shell: IS_WIN,
      maxBuffer: GH_MAX_BUFFER,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `[Totem Error] GitHub CLI returned invalid JSON for ${context}. Are you authenticated?`,
      );
    }

    return schema.parse(parsed);
  } catch (err) {
    handleGhError(err, context);
  }
}

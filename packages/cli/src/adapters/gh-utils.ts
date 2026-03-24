import { execFileSync } from 'node:child_process';

import { z } from 'zod';

import { TotemConfigError, TotemError, TotemParseError } from '@mmnto/totem';

import { GH_TIMEOUT_MS, IS_WIN } from '../utils.js';

const GH_MAX_BUFFER = 10 * 1024 * 1024; // 10MB — handles paginated API responses
const GH_PAGINATED_TIMEOUT_MS = 60_000; // 60s — paginated endpoints can be slow

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
    throw new TotemParseError(
      `Failed to parse GitHub ${context}`,
      'Check that the GitHub API response format has not changed and your gh CLI is up to date.',
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ENOENT')) {
    throw new TotemConfigError(
      'GitHub CLI (gh) is required but was not found.',
      'Install the GitHub CLI: https://cli.github.com',
      'CONFIG_MISSING',
    );
  }
  if (/\b(403|429)\b/.test(msg) || /rate.limit/i.test(msg)) {
    throw new TotemError(
      'SHIELD_FAILED',
      'GitHub API rate limit exceeded.',
      'Wait a few minutes and try again, or authenticate with `gh auth login` for a higher rate limit.',
    );
  }
  throw new TotemError(
    'SHIELD_FAILED',
    `Failed to fetch ${context}: ${msg}`,
    'Run `gh auth status` to verify authentication, then retry.',
  );
}

/**
 * Execute a `gh` CLI command that does not return JSON (mutations like close, comment, edit).
 * Throws on failure with a friendly error message.
 */
export function ghExec(args: string[], cwd: string): void {
  try {
    execFileSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      timeout: GH_TIMEOUT_MS,
      shell: IS_WIN,
      stdio: 'pipe',
    });
  } catch (err) {
    const context = args.slice(0, 3).join(' ');
    handleGhError(err, context);
  }
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
  const isPaginated = args.includes('--paginate');
  try {
    const raw = execFileSync('gh', args, {
      cwd,
      encoding: 'utf-8',
      timeout: isPaginated ? GH_PAGINATED_TIMEOUT_MS : GH_TIMEOUT_MS,
      shell: IS_WIN,
      maxBuffer: GH_MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new TotemParseError(
        `GitHub CLI returned invalid JSON for ${context}.`,
        'Run `gh auth status` to check your authentication.',
      );
    }

    return schema.parse(parsed);
  } catch (err) {
    handleGhError(err, context);
  }
}

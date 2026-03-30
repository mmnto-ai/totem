import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CONFIG_FILES, describeProject, TotemConfigSchema, TotemError } from '@mmnto/totem';

import { getContext } from '../context.js';

/**
 * Lightweight config loader for describe — avoids requiring embedder.
 * Falls back to getContext() if available, otherwise loads config directly.
 */
async function getDescriptionFromContext() {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const projectRoot = process.cwd();

  // Try cached context first (avoids re-loading config).
  // getContext() requires an embedder, so it will throw on Lite tier —
  // we intentionally swallow the error and fall back to direct config load.
  try {
    const ctx = await getContext();
    return describeProject(ctx.config, ctx.projectRoot);
  } catch {
    // Expected on Lite tier — fall through to direct config load
  }

  // Direct config load for Lite tier (no embedder)
  let configPath: string | null = null;
  for (const file of CONFIG_FILES) {
    const candidate = path.join(projectRoot, file);
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    throw new Error('[Totem Error] No totem config found. Run totem init first.');
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  const config = TotemConfigSchema.parse(raw);

  return describeProject(config, path.dirname(configPath));
}

export function registerDescribeProject(server: McpServer): void {
  server.registerTool(
    'describe_project',
    {
      description:
        'Returns a structured JSON summary of the project governance scope: rules, lessons, config tier, partitions, targets, and hooks. Fast, deterministic, no LLM required.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      try {
        const result = await getDescriptionFromContext();
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const hint = err instanceof TotemError ? err.recoveryHint : undefined;
        const text = hint ? `${msg}\n\nRecovery hint: ${hint}` : msg;
        return {
          content: [{ type: 'text' as const, text }],
          isError: true,
        };
      }
    },
  );
}

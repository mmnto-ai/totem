import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { describeProject, TotemConfigSchema } from '@mmnto/totem';

import { getContext } from '../context.js';

/**
 * Lightweight config loader for describe — avoids requiring embedder.
 * Falls back to getContext() if available, otherwise loads config directly.
 */
async function getDescriptionFromContext() {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const projectRoot = process.cwd();

  // Try cached context first (avoids re-loading config)
  try {
    const ctx = await getContext();
    return describeProject(ctx.config, ctx.projectRoot);
  } catch {
    // getContext() requires embedder — fall back to direct config load
  }

  // Direct config load for Lite tier (no embedder)
  const configFiles = ['totem.config.ts', 'totem.yaml', 'totem.yml', 'totem.toml'];
  let configPath: string | null = null;
  for (const file of configFiles) {
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
        return {
          content: [{ type: 'text' as const, text: msg }],
          isError: true,
        };
      }
    },
  );
}

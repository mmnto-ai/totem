import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  CONFIG_FILES,
  describeProject,
  type ProjectDescription,
  TotemConfigSchema,
  TotemError,
} from '@mmnto/totem';

import { getContext } from '../context.js';
import { type DescribeProjectOutput, type RichProjectState } from '../schemas/describe-project.js';
import {
  extractGitState,
  extractLessonCount,
  extractMilestoneState,
  extractPackageVersions,
  extractRecentPrs,
  extractRuleCounts,
  extractStrategyPointer,
  extractTestCount,
} from '../state-extractors.js';

interface LegacyContext {
  legacy: ProjectDescription;
  projectRoot: string;
  totemDir: string;
}

/**
 * Lightweight config loader for describe — avoids requiring embedder.
 * Falls back to getContext() if available, otherwise loads config directly.
 */
async function getLegacyContext(): Promise<LegacyContext> {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const projectRoot = process.cwd();

  // Try cached context first (avoids re-loading config).
  // getContext() requires an embedder, so it will throw on Lite tier —
  // we intentionally swallow the error and fall back to direct config load.
  try {
    const ctx = await getContext();
    return {
      legacy: describeProject(ctx.config, ctx.projectRoot),
      projectRoot: ctx.projectRoot,
      totemDir: ctx.config.totemDir,
    };
  } catch {
    // Expected on Lite tier — fall through to direct config load
  }

  // Direct config load for Lite tier (no embedder).
  // Only .ts configs are supported here — jiti cannot parse YAML/TOML.
  // YAML/TOML users will have getContext() succeed since those configs
  // still define an embedding provider (Standard/Full tier).
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

  if (!configPath.endsWith('.ts')) {
    throw new Error(
      '[Totem Error] MCP describe_project fallback only supports .ts configs. ' +
        'YAML/TOML configs require an embedding provider (Standard+ tier).',
    );
  }

  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  const config = TotemConfigSchema.parse(raw);
  const configRoot = path.dirname(configPath);

  return {
    legacy: describeProject(config, configRoot),
    projectRoot: configRoot,
    totemDir: config.totemDir,
  };
}

function buildRichState(projectRoot: string, totemDir: string): RichProjectState {
  return {
    strategyPointer: extractStrategyPointer(projectRoot),
    gitState: extractGitState(projectRoot),
    packageVersions: extractPackageVersions(projectRoot),
    ruleCounts: extractRuleCounts(projectRoot, totemDir),
    lessonCount: extractLessonCount(projectRoot, totemDir),
    testCount: extractTestCount(projectRoot),
    milestone: extractMilestoneState(projectRoot),
    recentPrs: extractRecentPrs(projectRoot),
  };
}

export function registerDescribeProject(server: McpServer): void {
  server.registerTool(
    'describe_project',
    {
      description:
        'Returns a structured JSON summary of the project governance scope: rules, lessons, config tier, partitions, targets, and hooks. Pass `includeRichState: true` to append a session-briefing payload (git state, strategy pointer, package versions, rule/lesson counts, milestone, recent PRs). Fast, deterministic, no LLM required.',
      // totem-context: MCP SDK's registerTool accepts a Zod raw shape, not a
      // JSON Schema object. This matches the convention already used in
      // search-knowledge.ts and add-lesson.ts. The SDK converts the shape to
      // JSON Schema internally before exposing the tool to clients.
      inputSchema: {
        includeRichState: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: { includeRichState?: boolean }) => {
      try {
        const { legacy, projectRoot, totemDir } = await getLegacyContext();
        const output: DescribeProjectOutput = args.includeRichState
          ? { ...legacy, richState: buildRichState(projectRoot, totemDir) }
          : { ...legacy };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
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

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { IngestTarget } from '@mmnto/totem';
import { safeExec } from '@mmnto/totem';

import { IS_WIN } from '../utils.js';

// ─── Utilities ───────────────────────────────────────────

export function buildNpxCommand(isWin: boolean): { command: string; args: string[] } {
  return isWin
    ? { command: 'cmd', args: ['/c', 'npx', '-y', '@mmnto/mcp'] }
    : { command: 'npx', args: ['-y', '@mmnto/mcp'] };
}

// ─── Types ───────────────────────────────────────────────

export type ConfigFormat = 'ts' | 'yaml' | 'toml';
export type Ecosystem = 'javascript' | 'python' | 'rust' | 'go';

export interface DetectedProject {
  hasTypeScript: boolean;
  hasSrc: boolean;
  hasDocs: boolean;
  hasSpecs: boolean;
  hasContext: boolean;
  hasSessions: boolean;
  preferredConfigFormat: ConfigFormat;
  ecosystems: Ecosystem[];
}

export type AiTool = 'Claude Code' | 'Gemini CLI' | 'Cursor' | 'JetBrains Junie' | 'GitHub Copilot';

export interface HookInstallerResult {
  file: string;
  action: 'created' | 'exists' | 'skipped' | 'merged';
  err?: string;
  /** Overrides the default action text in the post-init summary. Used by
   *  force-mode skill refreshes (`--force-skill-refresh`, mmnto-ai/totem#2008)
   *  to surface destructive-by-consent semantics in the summary line. */
  summaryActionOverride?: string;
}

export interface AiToolInfo {
  name: AiTool;
  mcpPath: string | null;
  reflexFile: string | null;
  serverEntry: Record<string, unknown> | null;
  hookInstaller?: (
    cwd: string,
    opts?: { forceSkillRefresh?: boolean },
  ) => Promise<HookInstallerResult[]>;
}

export type EmbeddingTier = 'openai' | 'ollama' | 'gemini' | 'none';

export interface DetectedOrchestrator {
  block: string;
  config: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────

/** Check whether a CLI command exists on PATH. */
function cliExists(name: string): boolean {
  try {
    const cmd = IS_WIN ? 'where' : 'which';
    safeExec(cmd, [name], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Check whether any of the given env keys are set (in process.env or .env file content). */
export function hasKey(envContent: string, ...keyNames: string[]): boolean {
  for (const keyName of keyNames) {
    if (process.env[keyName] && /\S/.test(process.env[keyName]!)) {
      return true;
    }
  }
  const keyPattern = new RegExp(`^\\s*(?:${keyNames.join('|')})\\s*=\\s*\\S+`, 'm');
  return keyPattern.test(envContent);
}

// ─── AI_TOOLS constant ──────────────────────────────────

const { command: npxCmd, args: npxArgs } = buildNpxCommand(IS_WIN);

/**
 * Base AI tool definitions (without hook installers).
 * Hook installers are wired up in init.ts since they depend on scaffolding helpers.
 */
export const AI_TOOLS: AiToolInfo[] = [
  {
    name: 'Claude Code',
    mcpPath: '.mcp.json',
    reflexFile: 'CLAUDE.md',
    serverEntry: { type: 'stdio', command: npxCmd, args: npxArgs },
  },
  {
    name: 'Gemini CLI',
    mcpPath: '.gemini/settings.json',
    reflexFile: 'GEMINI.md',
    serverEntry: { command: npxCmd, args: npxArgs },
  },
  {
    name: 'Cursor',
    mcpPath: '.cursor/mcp.json',
    reflexFile: '.cursorrules',
    serverEntry: { type: 'stdio', command: npxCmd, args: npxArgs },
  },
  {
    name: 'JetBrains Junie',
    mcpPath: '.junie/mcp/mcp.json',
    reflexFile: '.junie/guidelines.md',
    serverEntry: { command: npxCmd, args: npxArgs },
  },
  {
    name: 'GitHub Copilot',
    mcpPath: null,
    reflexFile: '.github/copilot-instructions.md',
    serverEntry: null,
  },
];

// ─── Detection functions ─────────────────────────────────

export function detectProject(cwd: string): DetectedProject {
  const exists = (p: string) => fs.existsSync(path.join(cwd, p));

  // Check root tsconfig, then per-package tsconfigs for monorepos
  let hasTypeScript = exists('tsconfig.json');
  if (!hasTypeScript && exists('packages')) {
    try {
      hasTypeScript = fs
        .readdirSync(path.join(cwd, 'packages'))
        .some((d) => fs.existsSync(path.join(cwd, 'packages', d, 'tsconfig.json')));
    } catch {
      // packages/ unreadable — skip
    }
  }

  // Detect ecosystems (additive — monorepos can have multiple)
  const ecosystems: Ecosystem[] = [];
  if (exists('package.json') || hasTypeScript) ecosystems.push('javascript');
  if (exists('requirements.txt') || exists('pyproject.toml') || exists('Pipfile')) {
    ecosystems.push('python');
  }
  if (exists('Cargo.toml')) ecosystems.push('rust');
  if (exists('go.mod')) ecosystems.push('go');

  // Determine preferred config format based on ecosystem markers
  let preferredConfigFormat: ConfigFormat = 'yaml'; // ecosystem-neutral default
  if (ecosystems.includes('javascript')) {
    preferredConfigFormat = 'ts';
  } else if (ecosystems.includes('rust') || ecosystems.includes('python')) {
    preferredConfigFormat = 'toml';
  }

  return {
    hasTypeScript,
    hasSrc: exists('src'),
    hasDocs: exists('docs'),
    hasSpecs: exists('specs'),
    hasContext: exists('context'),
    hasSessions: exists('context/sessions'),
    preferredConfigFormat,
    ecosystems,
  };
}

export function detectAiTools(cwd: string): AiToolInfo[] {
  const exists = (p: string) => fs.existsSync(path.join(cwd, p));
  const detected: AiToolInfo[] = [];

  if (exists('CLAUDE.md') || exists('.claude')) {
    detected.push(AI_TOOLS.find((t) => t.name === 'Claude Code')!);
  }
  if (exists('.gemini')) {
    detected.push(AI_TOOLS.find((t) => t.name === 'Gemini CLI')!);
  }
  if (exists('.cursorrules') || exists('.cursor/mcp.json')) {
    detected.push(AI_TOOLS.find((t) => t.name === 'Cursor')!);
  }
  if (exists('.junie') || exists('.junie/guidelines.md')) {
    detected.push(AI_TOOLS.find((t) => t.name === 'JetBrains Junie')!);
  }
  if (exists('.github/copilot-instructions.md')) {
    detected.push(AI_TOOLS.find((t) => t.name === 'GitHub Copilot')!);
  }

  return detected;
}

/**
 * Auto-detect the best embedding tier from the environment.
 * Checks for API keys in env and .env, and optionally for a running Ollama instance.
 */
export function detectEmbeddingTier(cwd: string): EmbeddingTier {
  // Read .env file once (loadEnv may not have run yet)
  let envContent = '';
  try {
    const envPath = path.join(cwd, '.env');
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf-8');
  } catch {
    // .env unreadable — proceed with env vars only
  }

  // Gemini first — task-type aware embeddings, best retrieval quality
  if (hasKey(envContent, 'GEMINI_API_KEY', 'GOOGLE_API_KEY')) return 'gemini';

  // OpenAI — widely available, low friction
  if (hasKey(envContent, 'OPENAI_API_KEY')) return 'openai';

  return 'none';
}

// ─── Orchestrator emission (Tenet-16 corollary) ──────────

/**
 * Every LLM-backed role tag (lowercased `runOrchestrator` tag) a generated
 * config names explicitly. Emitted configs assign a model per role instead of
 * committing an ambient `orchestrator.defaultModel` — config names roles, not
 * one ambient vendor default (Tenet-16 corollary, mmnto-ai/totem-strategy#800
 * item 1). A role absent from this list fails loud at invocation ("No model
 * specified") instead of silently riding a vendor default.
 */
export const INIT_ORCHESTRATOR_ROLES = [
  'compile',
  'docs',
  'spec',
  'shield',
  'triage',
  'extract',
  'reviewlearn',
] as const;

/**
 * Model IDs stamped into generated consumer configs, one per detection branch
 * (docs/reference/supported-models.md § Updating Defaults, location 3).
 * `claudeCli` is the claude CLI's own tier alias, which tracks that CLI's
 * current Sonnet instead of pinning a dated ID.
 */
export const INIT_ORCHESTRATOR_MODELS = {
  geminiCli: 'gemini-3.5-flash',
  claudeCli: 'sonnet',
  gemini: 'gemini-3.5-flash',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5.6-terra',
  ollama: 'gemma4',
} as const;

/** Map every emitted role to the same model ID (uniform per-provider default). */
export function buildRoleOverrides(model: string): Record<string, string> {
  return Object.fromEntries(INIT_ORCHESTRATOR_ROLES.map((role) => [role, model]));
}

/** Escape a value for embedding in a single-quoted TS string literal, so a
 *  future model ID or shell command containing `'` or `\` cannot emit a
 *  syntactically broken consumer config (mmnto-ai/totem#2360 review round). */
function escapeTsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Render the TS-template orchestrator block from the same object that gets
 * serialized into YAML/TOML configs, so the two surfaces cannot drift.
 * Handles every JSON-shaped value type; `null`/`undefined` render as an
 * absent key (optional-key semantics, matching the YAML/TOML serializers).
 */
export function renderOrchestratorBlock(config: Record<string, unknown>): string {
  const lines = ['  orchestrator: {'];
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      lines.push(`    ${key}: '${escapeTsString(value)}',`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`    ${key}: ${String(value)},`);
    } else if (Array.isArray(value)) {
      lines.push(`    ${key}: ${JSON.stringify(value)},`);
    } else if (value && typeof value === 'object') {
      lines.push(`    ${key}: {`);
      for (const [role, model] of Object.entries(value as Record<string, string>)) {
        lines.push(`      ${role}: '${escapeTsString(model)}',`);
      }
      lines.push('    },');
    }
  }
  lines.push('  },');
  return lines.join('\n');
}

function orchestratorResult(config: Record<string, unknown>): DetectedOrchestrator {
  return { config, block: renderOrchestratorBlock(config) };
}

/**
 * Auto-detect the best orchestrator from the environment.
 * Priority: gemini CLI → claude CLI → API keys (GEMINI → ANTHROPIC → OPENAI) → ollama → null.
 *
 * Detection resolves the consumer's local environment at genesis; the emitted
 * block names a model per role rather than committing an ambient
 * `defaultModel`. Note `totem lesson compile --cloud` deliberately resolves
 * from `--model` / `defaultModel` only (mmnto-ai/totem#2357), so it stays
 * fail-loud under this shape.
 */
export function detectOrchestrator(cwd: string): DetectedOrchestrator | null {
  // Read .env file once (loadEnv may not have run yet)
  let envContent = '';
  try {
    const envPath = path.join(cwd, '.env');
    if (fs.existsSync(envPath)) envContent = fs.readFileSync(envPath, 'utf-8');
  } catch {
    // .env unreadable — proceed with env vars only
  }

  // 1. Gemini CLI on PATH → shell provider
  if (cliExists('gemini')) {
    return orchestratorResult({
      provider: 'shell',
      command: 'gemini --model {model} -o json -e none < {file}',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.geminiCli),
    });
  }

  // 2. Claude CLI on PATH → shell provider (anthropic)
  if (cliExists('claude')) {
    return orchestratorResult({
      provider: 'shell',
      command: 'claude -p --model {model} < {file}',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.claudeCli),
    });
  }

  // 3. API keys → native SDK providers
  if (hasKey(envContent, 'GEMINI_API_KEY', 'GOOGLE_API_KEY')) {
    return orchestratorResult({
      provider: 'gemini',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.gemini),
    });
  }

  if (hasKey(envContent, 'ANTHROPIC_API_KEY')) {
    return orchestratorResult({
      provider: 'anthropic',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.anthropic),
    });
  }

  if (hasKey(envContent, 'OPENAI_API_KEY')) {
    return orchestratorResult({
      provider: 'openai',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.openai),
    });
  }

  // 4. Ollama running locally → use gemma4 (free, fast, air-gappable)
  if (cliExists('ollama')) {
    return orchestratorResult({
      provider: 'ollama',
      overrides: buildRoleOverrides(INIT_ORCHESTRATOR_MODELS.ollama),
    });
  }

  // 5. Nothing found → omit orchestrator (Lite/Standard tier)
  return null;
}

// ─── Target builders ─────────────────────────────────────

export function buildTargets(detected: DetectedProject): IngestTarget[] {
  const targets: IngestTarget[] = [];

  // Lessons targets — directory glob first, legacy glob for backward compat
  targets.push(
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
  );

  if (detected.hasTypeScript) {
    if (detected.hasSrc) {
      targets.push(
        { glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' },
        { glob: 'src/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
      );
    } else {
      // Monorepo layout — scan packages/
      targets.push(
        { glob: 'packages/**/*.ts', type: 'code', strategy: 'typescript-ast' },
        { glob: 'packages/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
      );
    }
  }

  if (detected.hasSessions) {
    targets.push({
      glob: 'context/sessions/**/*.md',
      type: 'session_log',
      strategy: 'session-log',
    });
  }

  if (detected.hasSpecs) {
    targets.push({
      glob: 'specs/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  if (detected.hasDocs) {
    targets.push({
      glob: 'docs/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  if (detected.hasContext) {
    // When hasSessions is also true, context/sessions/ files match both this
    // target and the session_log target above. The sync engine deduplicates by
    // file path, using the first matching target's type.
    targets.push({
      glob: 'context/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  // Fallback: if nothing else detected (besides the 2 lesson targets at lines 259-262),
  // add a sensible default. INVARIANT: update this guard if lesson target count changes.
  if (targets.length <= 2) {
    targets.push({
      glob: '**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  return targets;
}

export function formatTargets(targets: IngestTarget[]): string {
  const lines = targets.map((t) => {
    return `    { glob: '${t.glob}', type: '${t.type}', strategy: '${t.strategy}' },`;
  });
  return lines.join('\n');
}

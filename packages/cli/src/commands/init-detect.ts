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
}

export interface AiToolInfo {
  name: AiTool;
  mcpPath: string | null;
  reflexFile: string | null;
  serverEntry: Record<string, unknown> | null;
  hookInstaller?: (cwd: string) => Promise<HookInstallerResult[]>;
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

/**
 * Auto-detect the best orchestrator from the environment.
 * Priority: gemini CLI → claude CLI → API keys (GEMINI → ANTHROPIC → OPENAI) → null.
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
    const config = {
      provider: 'shell',
      command: 'gemini --model {model} -o json -e none < {file}',
      defaultModel: 'gemini-3-flash-preview',
      overrides: {
        spec: 'gemini-3.1-pro-preview',
        shield: 'gemini-3.1-pro-preview',
        triage: 'gemini-3.1-pro-preview',
      },
    };
    return {
      config,
      block: `  orchestrator: {
    provider: 'shell',
    command: 'gemini --model {model} -o json -e none < {file}',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      'spec': 'gemini-3.1-pro-preview',
      'shield': 'gemini-3.1-pro-preview',
      'triage': 'gemini-3.1-pro-preview',
    },
  },`,
    };
  }

  // 2. Claude CLI on PATH → shell provider (anthropic)
  if (cliExists('claude')) {
    const config = {
      provider: 'shell',
      command: 'claude -p {file} --model {model} --output-format json',
      defaultModel: 'sonnet',
    };
    return {
      config,
      block: `  orchestrator: {
    provider: 'shell',
    command: 'claude -p {file} --model {model} --output-format json',
    defaultModel: 'sonnet',
  },`,
    };
  }

  // 3. API keys → native SDK providers
  if (hasKey(envContent, 'GEMINI_API_KEY', 'GOOGLE_API_KEY')) {
    const config = {
      provider: 'gemini',
      defaultModel: 'gemini-3-flash-preview',
      overrides: {
        spec: 'gemini-3.1-pro-preview',
        shield: 'gemini-3.1-pro-preview',
        triage: 'gemini-3.1-pro-preview',
      },
    };
    return {
      config,
      block: `  orchestrator: {
    provider: 'gemini',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      'spec': 'gemini-3.1-pro-preview',
      'shield': 'gemini-3.1-pro-preview',
      'triage': 'gemini-3.1-pro-preview',
    },
  },`,
    };
  }

  if (hasKey(envContent, 'ANTHROPIC_API_KEY')) {
    const config = { provider: 'anthropic', defaultModel: 'claude-sonnet-4-6' };
    return {
      config,
      block: `  orchestrator: {
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
  },`,
    };
  }

  if (hasKey(envContent, 'OPENAI_API_KEY')) {
    const config = { provider: 'openai', defaultModel: 'gpt-5.4-mini' };
    return {
      config,
      block: `  orchestrator: {
    provider: 'openai',
    defaultModel: 'gpt-5.4-mini',
  },`,
    };
  }

  // 4. Ollama running locally → use gemma4 (free, fast, air-gappable)
  if (cliExists('ollama')) {
    const config = { provider: 'ollama', defaultModel: 'gemma4' };
    return {
      config,
      block: `  orchestrator: {
    provider: 'ollama',
    defaultModel: 'gemma4',
  },`,
    };
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

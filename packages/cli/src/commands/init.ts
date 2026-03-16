import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import { z } from 'zod';

import type { IngestTarget } from '@mmnto/totem';

import { BASELINE_MARKER, UNIVERSAL_LESSONS_MARKDOWN } from '../assets/universal-lessons.js';
import { bold, brand, dim, log, printBanner, success } from '../ui.js';
import { IS_WIN } from '../utils.js';
import { installEnforcementHooks, installPostMergeHook } from './install-hooks.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 3;
const REFLEX_START = '<!-- totem:reflexes:start -->';
const REFLEX_END = '<!-- totem:reflexes:end -->';
const REFLEX_VERSION_RE = /<!-- totem:reflexes:version:(\d+) -->/;
const LEGACY_SENTINEL = '## Totem AI Integration (Auto-Generated)';

export const AI_PROMPT_BLOCK = `
${REFLEX_START}
<!-- totem:reflexes:version:${REFLEX_VERSION} -->

## Totem AI Integration (Auto-Generated)
You have access to the Totem MCP for long-term project memory. You MUST operate with the following reflexes:

### Memory Reflexes
1. **BLOCKING — Pull Before Coding:** Before writing or modifying code that touches more than one file, you MUST call \`search_knowledge\` with a query describing what you're about to change. This is not optional. The vector DB contains traps, edge cases, and architectural constraints that prevent rework. Skip this and you risk repeating a mistake that's already been solved.
2. **Pull Before Planning:** Before writing specs, architecture, or fixing complex bugs, use \`search_knowledge\` to retrieve domain constraints and past traps.
3. **Pull on Session Start:** At the beginning of every session, call \`search_knowledge\` with a broad query about the current task or area of work. The vector DB is your institutional memory — use it before relying on your own context window.
4. **Proactive Anchoring (The 3 Triggers):** You must autonomously call \`add_lesson\` when any of the following occur — do NOT wait for the user to ask:
   - **The Trap Trigger:** If you spend >2 turns fixing a bug caused by a framework quirk, unexpected API response, or edge case. (Anchor the symptom + fix).
   - **The Pivot Trigger:** If the user introduces a new architectural pattern or deprecates an old one. (Anchor the rule).
   - **The Handoff Trigger:** At the end of a session or when wrapping up a complex feature, extract the non-obvious lessons learned and anchor them.
5. **Tool Preference (MCP over CLI):** Always prioritize using dedicated MCP tools (e.g., GitHub, Supabase, Vercel) over executing generic shell commands (like \`gh issue view\` or \`curl\`). MCP tools provide structured, un-truncated data optimized for your context window. Only fall back to bash execution if an MCP tool is unavailable or fails.

Lessons are automatically re-indexed in the background after each \`add_lesson\` call — no manual sync needed.

### Memory Classification
When deciding where to store information or rules, use this decision tree:
- If forgetting this causes a mistake on an UNRELATED task (Core Safety): Store in your root agent memory file (e.g., CLAUDE.md or GEMINI.md).
- If it's a stable, project-wide workflow rule: Store in project config (e.g., CLAUDE.md).
- If it's a stable syntax/style pattern: Store in the project's styleguide or linter rules.
- If it's domain knowledge, an edge case, or a past trap: You MUST use the Totem \`add_lesson\` tool to anchor it into the project's LanceDB.

### Workflow Orchestrator Rituals
[FOR LOCAL CLI/TERMINAL AGENTS ONLY] Do not attempt to run these commands if you are a headless bot or operating in a cloud PR environment (e.g., Gemini Code Assist on GitHub).
Totem provides CLI commands that map to your development lifecycle. Use them at these moments:
1. **Start of Session:** Run \`totem briefing\` to get oriented with current branch state, open PRs, and recent context. Run \`totem triage\` if you need to pick a new task.
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to generate an architectural plan and review related context before writing code.
3. **Before Push:** Run \`totem lint\` for a fast compiled-rules check (zero LLM, ~2s). **Before PR:** Run \`totem shield\` for a full AI-powered code review against project knowledge (~18s).
4. **End of Session:** Run \`totem handoff\` to generate a snapshot for the next agent session with current progress and open threads.

### Cloud / PR Review Bots
[FOR CLOUD BOTS ONLY — e.g., Gemini Code Assist, GitHub Copilot PR Review]
You do NOT have access to the local CLI. Instead, use the Totem MCP tools directly:
1. **Before reviewing a PR:** Call \`search_knowledge\` with queries about the files and patterns being changed to check for known traps and architectural constraints.
2. **Before suggesting changes:** Call \`search_knowledge\` to verify your suggestion aligns with established project patterns and past lessons.
3. **When you spot a recurring issue:** Call \`add_lesson\` to persist the trap so future reviews catch it automatically.

### Context Management Guardrail
You must be highly defensive of your own context window. If you notice this session becoming long, or if you are asked to read multiple massive files at once, you MUST proactively warn the user about impending context loss. When warning the user, suggest they run \`totem bridge\` to condense their mid-task state so they can safely clear the chat and resume. If you receive a \`<totem_system_warning>\` tag in a tool response, read it silently and synthesize a natural-language warning to the user — do NOT echo the raw XML.
${REFLEX_END}
`;

interface DetectedProject {
  hasTypeScript: boolean;
  hasSrc: boolean;
  hasDocs: boolean;
  hasSpecs: boolean;
  hasContext: boolean;
  hasSessions: boolean;
}

type AiTool = 'Claude Code' | 'Gemini CLI' | 'Cursor' | 'JetBrains Junie' | 'GitHub Copilot';

export interface HookInstallerResult {
  file: string;
  action: 'created' | 'exists' | 'skipped' | 'merged';
  err?: string;
}

interface AiToolInfo {
  name: AiTool;
  mcpPath: string | null;
  reflexFile: string | null;
  serverEntry: Record<string, unknown> | null;
  hookInstaller?: (cwd: string) => Promise<HookInstallerResult[]>;
}

export function buildNpxCommand(isWin: boolean): { command: string; args: string[] } {
  return isWin
    ? { command: 'cmd', args: ['/c', 'npx', '-y', '@mmnto/mcp'] }
    : { command: 'npx', args: ['-y', '@mmnto/mcp'] };
}

const TOTEM_FILE_MARKER = '// [totem] auto-generated';

/**
 * Scaffold a file with idempotency — skips if the marker is already present.
 * Creates parent directories as needed.
 */
export function scaffoldFile(
  filePath: string,
  content: string,
  marker: string = TOTEM_FILE_MARKER,
): { action: 'created' | 'exists' | 'skipped'; err?: string } {
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (existing.includes(marker)) {
        return { action: 'exists' };
      }
      return { action: 'skipped' };
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return { action: 'created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: `[Totem Error] ${message}` };
  }
}

const { command: npxCmd, args: npxArgs } = buildNpxCommand(IS_WIN);

// --- Gemini CLI hook templates ---

const GEMINI_SESSION_START = `// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs \`totem briefing\` at the start of every Gemini CLI session.
const { execSync } = require('child_process');

try {
  const output = execSync('totem briefing', {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stderr.write(output);
} catch (err) {
  process.stderr.write('[Totem Error] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}
`;

const GEMINI_BEFORE_TOOL = `// [totem] auto-generated — Gemini CLI BeforeTool hook
// Intercepts git push/commit to run \`totem shield\` before proceeding.
const { execSync } = require('child_process');

module.exports = function beforeTool(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return;
  const cmd = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
  if (!/git\\s+(push|commit)/.test(cmd) && !/["']git["'].*["'](push|commit)["']/.test(cmd)) return;

  try {
    execSync('totem lint', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
  } catch (err) {
    throw new Error('[Totem Error] Shield check failed. Fix violations before pushing.\\n' + err.message);
  }
};
`;

const GEMINI_SKILL = `<!-- [totem] auto-generated — Totem Architect skill -->
# Totem Architect

Before designing, planning, or implementing features, query the project's memory index for relevant context:

1. Use the \`search_knowledge\` MCP tool with a query describing what you're about to build.
2. Review returned lessons, specs, and code patterns before writing any code.
3. If you discover a trap or architectural constraint, factor it into your design.

This ensures you build on existing knowledge rather than repeating past mistakes.
`;

async function installGeminiHooks(cwd: string): Promise<HookInstallerResult[]> {
  const results: HookInstallerResult[] = [];
  const files: Array<{ rel: string; content: string; marker: string }> = [
    {
      rel: '.gemini/hooks/SessionStart.js',
      content: GEMINI_SESSION_START,
      marker: TOTEM_FILE_MARKER,
    },
    { rel: '.gemini/hooks/BeforeTool.js', content: GEMINI_BEFORE_TOOL, marker: TOTEM_FILE_MARKER },
    {
      rel: '.gemini/skills/totem.md',
      content: GEMINI_SKILL,
      marker: '<!-- [totem] auto-generated — Totem Architect skill -->',
    },
  ];

  for (const { rel, content, marker } of files) {
    const filePath = path.join(cwd, rel);
    const result = scaffoldFile(filePath, content, marker);
    results.push({ file: rel, ...result });
  }

  return results;
}

// --- Claude Code hook installer ---

const CLAUDE_SHIELD_GATE = `// [totem] auto-generated — Claude Code shield gate hook
// Intercepts git push/commit to run \`totem shield\` before proceeding.
const { execSync } = require('child_process');

const input = process.env.TOOL_INPUT || '';
if (/git/.test(input) && /(push|commit)/.test(input)) {
  try {
    execSync('totem lint', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
  } catch (err) {
    process.exit(1);
  }
}
`;

const CLAUDE_PRETOOLUSE_ENTRY = {
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command: 'node .totem/hooks/shield-gate.cjs',
    },
  ],
};

// Zod schema for the subset of settings.local.json that we need to validate.
// Uses .passthrough() to preserve unknown keys during round-trip read/write.
const HookCommandSchema = z.union([
  z.string(),
  z.object({ type: z.string(), command: z.string() }).passthrough(),
]);

const ClaudeSettingsSchema = z
  .object({
    hooks: z
      .object({
        PreToolUse: z
          .array(
            z
              .object({
                matcher: z.string().optional(),
                hooks: z.array(HookCommandSchema).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Check whether a hook entry already contains a totem shield reference. */
function hasTotemShield(entry: z.infer<typeof HookCommandSchema>): boolean {
  if (typeof entry === 'string') return entry.includes('totem shield');
  return entry.command.includes('totem shield') || entry.command.includes('shield-gate');
}

/**
 * Merge Totem hooks into .claude/settings.local.json without overwriting
 * existing user-defined hooks.
 */
export function scaffoldClaudeHooks(filePath: string): {
  action: 'created' | 'merged' | 'skipped';
  err?: string;
} {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fullConfig = { hooks: { PreToolUse: [CLAUDE_PRETOOLUSE_ENTRY] } };

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf-8');
      return { action: 'created' };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        action: 'skipped',
        err: `[Totem Error] Could not parse settings.local.json (invalid JSON): ${message}`,
      };
    }

    const result = ClaudeSettingsSchema.safeParse(rawParsed);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return {
        action: 'skipped',
        err: `[Totem Error] Could not merge config: settings.local.json has unexpected shape: ${detail}`,
      };
    }

    const parsed = result.data;
    const preToolUse = parsed.hooks?.PreToolUse ?? [];

    if (
      preToolUse.some(
        (h) => h.matcher === 'Bash' && Array.isArray(h.hooks) && h.hooks.some(hasTotemShield),
      )
    ) {
      return { action: 'skipped' };
    }

    const hooks = parsed.hooks ?? {};
    hooks.PreToolUse = [...preToolUse, CLAUDE_PRETOOLUSE_ENTRY];
    parsed.hooks = hooks;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: `[Totem Error] ${message}` };
  }
}

async function installClaudeHooks(cwd: string): Promise<HookInstallerResult[]> {
  const results: HookInstallerResult[] = [];

  // Scaffold the shield-gate script
  const scriptRel = '.totem/hooks/shield-gate.cjs';
  const scriptResult = scaffoldFile(
    path.join(cwd, scriptRel),
    CLAUDE_SHIELD_GATE,
    TOTEM_FILE_MARKER,
  );
  results.push({ file: scriptRel, ...scriptResult });

  // Scaffold the settings.local.json hook entry
  const settingsRel = '.claude/settings.local.json';
  const settingsResult = scaffoldClaudeHooks(path.join(cwd, settingsRel));
  results.push({ file: settingsRel, ...settingsResult });

  return results;
}

const AI_TOOLS: AiToolInfo[] = [
  {
    name: 'Claude Code',
    mcpPath: '.mcp.json',
    reflexFile: 'CLAUDE.md',
    serverEntry: { type: 'stdio', command: npxCmd, args: npxArgs },
    hookInstaller: installClaudeHooks,
  },
  {
    name: 'Gemini CLI',
    mcpPath: '.gemini/settings.json',
    reflexFile: 'GEMINI.md',
    serverEntry: { command: npxCmd, args: npxArgs },
    hookInstaller: installGeminiHooks,
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

function detectAiTools(cwd: string): AiToolInfo[] {
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

export function scaffoldMcpConfig(
  filePath: string,
  serverEntry: Record<string, unknown>,
): { action: 'created' | 'merged' | 'skipped'; err?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ mcpServers: { totem: serverEntry } }, null, 2) + '\n',
        'utf-8',
      );
      return { action: 'created' };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        action: 'skipped',
        err: `Could not parse ${path.basename(filePath)} (invalid JSON): ${message}`,
      };
    }

    if (
      parsed.mcpServers !== undefined &&
      (typeof parsed.mcpServers !== 'object' ||
        parsed.mcpServers === null ||
        Array.isArray(parsed.mcpServers))
    ) {
      return {
        action: 'skipped',
        err: `Could not merge config: "mcpServers" in ${path.basename(filePath)} must be an object.`,
      };
    }

    const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
    if ('totem' in servers) {
      return { action: 'skipped' };
    }

    servers.totem = serverEntry;
    parsed.mcpServers = servers;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: message };
  }
}

function detectProject(cwd: string): DetectedProject {
  const exists = (p: string) => fs.existsSync(path.join(cwd, p));
  return {
    hasTypeScript: exists('tsconfig.json'),
    hasSrc: exists('src'),
    hasDocs: exists('docs'),
    hasSpecs: exists('specs'),
    hasContext: exists('context'),
    hasSessions: exists('context/sessions'),
  };
}

function buildTargets(detected: DetectedProject): IngestTarget[] {
  const targets: IngestTarget[] = [];

  // Lessons targets — directory glob first, legacy glob for backward compat
  targets.push(
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
    { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
  );

  if (detected.hasTypeScript) {
    targets.push(
      { glob: 'src/**/*.ts', type: 'code', strategy: 'typescript-ast' },
      { glob: 'src/**/*.tsx', type: 'code', strategy: 'typescript-ast' },
    );

    if (!detected.hasSrc) {
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
    targets.push({
      glob: 'context/**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  // Fallback: if nothing else detected (besides the lessons target), add a sensible default
  if (targets.length <= 1) {
    targets.push({
      glob: '**/*.md',
      type: 'spec',
      strategy: 'markdown-heading',
    });
  }

  return targets;
}

function formatTargets(targets: IngestTarget[]): string {
  const lines = targets.map((t) => {
    return `    { glob: '${t.glob}', type: '${t.type}', strategy: '${t.strategy}' },`;
  });
  return lines.join('\n');
}

type EmbeddingTier = 'openai' | 'ollama' | 'gemini' | 'none';

export async function generateConfig(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
): Promise<string> {
  const { DEFAULT_IGNORE_PATTERNS } = await import('@mmnto/totem');
  let embeddingBlock: string;
  switch (embeddingTier) {
    case 'openai':
      embeddingBlock = `  embedding: { provider: 'openai', model: 'text-embedding-3-small' },`;
      break;
    case 'ollama':
      embeddingBlock = `  embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },`;
      break;
    case 'gemini':
      embeddingBlock = `  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },`;
      break;
    case 'none':
      embeddingBlock = `  // embedding: { provider: 'openai', model: 'text-embedding-3-small' },\n  // Lite tier — set OPENAI_API_KEY and re-run \`totem init\` to enable sync/search.`;
      break;
  }

  return `import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
${formatTargets(targets)}
  ],

${embeddingBlock}

  ignorePatterns: [
${DEFAULT_IGNORE_PATTERNS.map((p) => `    '${p}',`).join('\n')}
  ],

  orchestrator: {
    provider: 'shell',
    command: 'gemini --model {model} -o json -e none < {file}',
    defaultModel: 'gemini-3-flash-preview',
    overrides: {
      'spec': 'gemini-3.1-pro-preview',
      'shield': 'gemini-3.1-pro-preview',
      'triage': 'gemini-3.1-pro-preview',
    },
  },
};

export default config;
`;
}

/**
 * Auto-detect the best embedding tier from the environment.
 * Checks for API keys in env and .env, and optionally for a running Ollama instance.
 */
export function detectEmbeddingTier(cwd: string): EmbeddingTier {
  // Check env (including already-loaded .env)
  if (process.env['OPENAI_API_KEY'] && /\S/.test(process.env['OPENAI_API_KEY'])) return 'openai';

  // Read .env file once (loadEnv may not have run yet)
  const envPath = path.join(cwd, '.env');
  const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

  if (/^\s*OPENAI_API_KEY\s*=\s*\S+/m.test(envContent)) return 'openai';

  // Gemini: single-key DX — GEMINI_API_KEY covers both orchestrator and embeddings
  if (
    (process.env['GEMINI_API_KEY'] && /\S/.test(process.env['GEMINI_API_KEY'])) ||
    (process.env['GOOGLE_API_KEY'] && /\S/.test(process.env['GOOGLE_API_KEY'])) ||
    /^\s*(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*\S+/m.test(envContent)
  ) {
    return 'gemini';
  }

  return 'none';
}

/**
 * Install the Universal AI Developer Baseline lessons into the lessons file.
 * Returns 'installed', 'exists' (already present), or 'skipped' (user declined).
 * In non-TTY mode (CI), defaults to installing without prompting.
 */
export async function installBaselineLessons(
  baselinePath: string,
  rl: readline.Interface,
): Promise<'installed' | 'exists' | 'skipped'> {
  try {
    if (fs.existsSync(baselinePath)) {
      const existing = fs.readFileSync(baselinePath, 'utf-8');
      if (existing.includes(BASELINE_MARKER)) return 'exists';
    }

    // In non-TTY mode (CI, piped input), default to installing
    let declined = false;
    if (process.stdin.isTTY) {
      const answer = await rl.question('Install Universal AI Developer Baseline lessons? (Y/n): ');
      declined = answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no';
    }

    if (declined) return 'skipped';

    const dir = path.dirname(baselinePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(baselinePath, UNIVERSAL_LESSONS_MARKDOWN, 'utf-8');
    return 'installed';
  } catch (err) {
    log.warn(
      'Totem',
      `Could not install baseline lessons: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'skipped';
  }
}

// ─── Reflex detection & upgrade ──────────────────────────

export type ReflexStatus = 'current' | 'outdated' | 'missing';

/** Detect whether the reflex block in a file is current, outdated, or missing. */
export function detectReflexStatus(content: string): ReflexStatus {
  // Check for versioned sentinel first
  const versionMatch = content.match(REFLEX_VERSION_RE);
  if (versionMatch) {
    const version = parseInt(versionMatch[1]!, 10);
    return version >= REFLEX_VERSION ? 'current' : 'outdated';
  }

  // Legacy sentinel — injected by older totem versions without version markers
  if (content.includes(LEGACY_SENTINEL) || content.includes('Totem Memory Reflexes')) {
    return 'outdated';
  }

  return 'missing';
}

/**
 * Upgrade a reflex block from legacy (v1, no boundaries) or older versioned
 * blocks to the current version. Returns the updated file content.
 *
 * Strategy:
 * - If start/end boundaries exist, replace between them (clean swap).
 * - If only the legacy sentinel exists (v1), find the block start and
 *   look for the next user-owned `## ` heading or EOF as the boundary.
 * - If the boundary can't be determined cleanly, append the new block
 *   and set `clean: false` so the caller can warn about manual cleanup.
 */
export function upgradeReflexes(content: string): { content: string; clean: boolean } {
  // Case 1: Has start/end boundaries (versioned block from a previous version)
  const startIdx = content.indexOf(REFLEX_START);
  const endIdx = content.indexOf(REFLEX_END);

  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    const before = content.slice(0, startIdx).replace(/\n+$/, '\n');
    const after = content.slice(endIdx + REFLEX_END.length);
    return { content: before + AI_PROMPT_BLOCK + after, clean: true };
  }

  // Case 2: Legacy block (v1) — no boundaries, appended at end of file
  const legacyIdx = content.indexOf(LEGACY_SENTINEL);
  if (legacyIdx !== -1) {
    // Walk backwards to include any leading whitespace before the heading
    let blockStart = legacyIdx;
    while (blockStart > 0 && content[blockStart - 1] === '\n') blockStart--;

    // Find the end: the next ## heading that isn't part of the Totem block, or EOF
    const afterLegacy = content.slice(legacyIdx);
    // Match a `\n## ` followed by text that is NOT "Totem AI" (user content after the block)
    const nextH2 = afterLegacy.match(/\r?\n## (?!Totem AI Integration)/);
    const blockEnd = nextH2?.index !== undefined ? legacyIdx + nextH2.index : content.length;

    const before = content.slice(0, blockStart);
    const after = content.slice(blockEnd);
    return { content: before + AI_PROMPT_BLOCK + after, clean: true };
  }

  // Case 3: Has "Totem Memory Reflexes" text but not the standard heading — can't locate cleanly
  return { content: content + '\n' + AI_PROMPT_BLOCK, clean: false };
}

/** Inject or upgrade reflex block in an AI context file. */
function injectReflexes(filePath: string): 'injected' | 'current' | 'missing' | 'outdated' {
  if (!fs.existsSync(filePath)) return 'missing';

  const content = fs.readFileSync(filePath, 'utf-8');
  const status = detectReflexStatus(content);

  if (status === 'current') return 'current';
  if (status === 'missing') {
    fs.appendFileSync(filePath, AI_PROMPT_BLOCK);
    return 'injected';
  }

  // 'outdated' — defer to caller for user confirmation
  return 'outdated';
}

/** Apply the reflex upgrade to a file. Returns true if clean, false if manual cleanup needed. */
function applyReflexUpgrade(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { content: updated, clean } = upgradeReflexes(content);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return clean;
}

interface InitSummaryEntry {
  file: string;
  action: string;
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = path.join(cwd, 'totem.config.ts');
  const totemDir = path.join(cwd, '.totem');
  const configExists = fs.existsSync(configPath);

  const rl = readline.createInterface({ input, output });
  const summary: InitSummaryEntry[] = [];

  try {
    printBanner();

    if (!configExists) {
      // --- Fresh install: generate config ---
      log.info('Totem', 'Scanning project...');
      const detected = detectProject(cwd);

      const detections: string[] = [];
      if (detected.hasTypeScript) detections.push('TypeScript');
      if (detected.hasSrc) detections.push('src/');
      if (detected.hasDocs) detections.push('docs/');
      if (detected.hasSpecs) detections.push('specs/');
      if (detected.hasContext) detections.push('context/');
      if (detected.hasSessions) detections.push('session logs');

      if (detections.length > 0) {
        log.info('Totem', `Detected: ${bold(detections.join(', '))}`);
      } else {
        log.dim('Totem', 'No specific project structure detected. Using markdown defaults.');
      }

      const targets = buildTargets(detected);

      // Auto-detect embedding tier from environment
      let embeddingTier = detectEmbeddingTier(cwd);

      if (embeddingTier === 'openai') {
        log.info(
          'Totem',
          `Detected ${bold('OPENAI_API_KEY')} in environment. Using OpenAI embeddings.`,
        );
      } else if (embeddingTier === 'gemini') {
        log.info(
          'Totem',
          `Detected ${bold('GEMINI_API_KEY')} in environment. Using Gemini embeddings (single-key DX).`,
        );
      } else {
        // No key detected — prompt the user
        const answer = await rl.question(
          'Enter your OpenAI API key, type "ollama" for a local model, or press Enter for Lite tier: ',
        );

        const input = answer.trim().replace(/[\r\n]/g, '');
        if (input.toLowerCase() === 'ollama') {
          embeddingTier = 'ollama';
          log.info('Totem', 'Configured for Ollama. Make sure it is running locally.');
        } else if (input) {
          if (!/^sk-[a-zA-Z0-9_-]+$/.test(input)) {
            log.warn(
              'Totem',
              'API key does not look like a valid OpenAI key (expected sk-...). Starting in Lite tier.',
            );
          } else {
            const envPath = path.join(cwd, '.env');
            const envLine = `OPENAI_API_KEY="${input}"\n`;

            if (fs.existsSync(envPath)) {
              const existing = fs.readFileSync(envPath, 'utf-8');
              if (!/^\s*OPENAI_API_KEY\s*=/m.test(existing)) {
                const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
                fs.appendFileSync(envPath, prefix + envLine);
              }
            } else {
              fs.writeFileSync(envPath, envLine);
            }

            embeddingTier = 'openai';
            summary.push({ file: '.env', action: 'Saved OpenAI API key' });
          }
        }
      }

      if (embeddingTier === 'none') {
        log.info('Totem', `Starting in ${bold('Lite')} tier (add-lesson, bridge, eject only).`);
        log.dim(
          'Totem',
          'Set OPENAI_API_KEY and re-run `totem init` to unlock sync/search/shield.',
        );
      }

      const configContent = await generateConfig(targets, embeddingTier);
      fs.writeFileSync(configPath, configContent, 'utf-8');
      const tierLabel =
        embeddingTier === 'none'
          ? 'Lite'
          : embeddingTier === 'openai'
            ? 'Standard'
            : 'Standard (Ollama)';
      summary.push({
        file: 'totem.config.ts',
        action: `Created with auto-detected targets (${tierLabel} tier)`,
      });
    } else {
      log.dim('Totem', 'totem.config.ts already exists. Checking reflexes and hooks...');
    }

    // --- Always run: .totem/ directory ---
    if (!fs.existsSync(totemDir)) {
      fs.mkdirSync(totemDir, { recursive: true });
    }

    const lessonsDir = path.join(totemDir, 'lessons');
    if (!fs.existsSync(lessonsDir)) {
      fs.mkdirSync(lessonsDir, { recursive: true });
      // .gitkeep for git tracking of empty directory
      const gitkeepPath = path.join(lessonsDir, '.gitkeep');
      if (!fs.existsSync(gitkeepPath)) {
        fs.writeFileSync(gitkeepPath, '', 'utf-8');
      }
      summary.push({ file: '.totem/lessons/', action: 'Created lessons directory' });
    }

    // --- Universal Lessons baseline ---
    const baselinePath = path.join(lessonsDir, 'baseline.md');
    const baselineResult = await installBaselineLessons(baselinePath, rl);
    if (baselineResult === 'installed') {
      summary.push({
        file: '.totem/lessons/baseline.md',
        action: 'Installed Universal Baseline lessons',
      });
    }

    // --- Unified AI tool selection ---
    const detectedTools = detectAiTools(cwd);

    if (detectedTools.length > 0) {
      const toolNames = detectedTools.map((t) => t.name).join(', ');
      log.info('Totem', `Detected AI tools: ${bold(toolNames)}`);
      const toolAnswer = await rl.question(
        'Which tools should Totem configure? [all/none/select] (default: all): ',
      );

      let selectedTools: AiToolInfo[];
      const trimmed = toolAnswer.trim().toLowerCase();

      if (trimmed === 'none') {
        selectedTools = [];
      } else if (trimmed === 'select') {
        selectedTools = [];
        for (const tool of detectedTools) {
          const pick = await rl.question(`  Configure ${tool.name}? (Y/n): `);
          if (pick.trim().toLowerCase() !== 'n' && pick.trim().toLowerCase() !== 'no') {
            selectedTools.push(tool);
          }
        }
      } else {
        // 'all' or Enter (default)
        selectedTools = detectedTools;
      }

      // --- MCP scaffolding for selected tools ---
      for (const tool of selectedTools) {
        if (!tool.mcpPath || !tool.serverEntry) continue;
        const filePath = path.join(cwd, tool.mcpPath);
        const result = scaffoldMcpConfig(filePath, tool.serverEntry);

        if (result.err) {
          log.error('Totem Error', result.err); // totem-ignore — result.err is internal scaffolding error, not LLM output
          console.error(
            `To fix this, add the following manually to your ${tool.mcpPath} under "mcpServers":\n`,
          );
          console.error(`  "totem": ${JSON.stringify(tool.serverEntry, null, 2)}\n`);
        } else if (result.action === 'created') {
          summary.push({ file: tool.mcpPath, action: `Created with Totem MCP server` });
        } else if (result.action === 'merged') {
          summary.push({ file: tool.mcpPath, action: `Added totem to mcpServers` });
        }
      }

      // --- Reflex injection & upgrade for selected tools ---
      const outdatedFiles: Array<{ tool: AiToolInfo; filePath: string }> = [];

      for (const tool of selectedTools) {
        if (!tool.reflexFile) continue;
        const filePath = path.join(cwd, tool.reflexFile);
        try {
          const result = injectReflexes(filePath);
          if (result === 'injected') {
            summary.push({ file: tool.reflexFile, action: 'Injected memory reflexes (v2)' });
          } else if (result === 'outdated') {
            outdatedFiles.push({ tool, filePath });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Totem Error', `Failed to inject reflexes into ${tool.reflexFile}: ${message}`);
        }
      }

      // Prompt once for all outdated reflex files
      if (outdatedFiles.length > 0) {
        const fileList = outdatedFiles.map((f) => f.tool.reflexFile).join(', ');
        log.warn('Totem', `Outdated reflexes found in: ${bold(fileList)}`);

        let shouldUpgrade = false;
        if (process.stdin.isTTY) {
          const answer = await rl.question(`Upgrade reflexes to v${REFLEX_VERSION}? (Y/n): `);
          shouldUpgrade =
            answer.trim().toLowerCase() !== 'n' && answer.trim().toLowerCase() !== 'no';
        } else {
          // Non-TTY (CI/scripted): auto-upgrade to match baseline lessons behavior
          shouldUpgrade = true;
          log.info('Totem', 'Non-interactive mode — auto-upgrading reflexes.');
        }

        if (shouldUpgrade) {
          for (const { tool, filePath } of outdatedFiles) {
            try {
              const clean = applyReflexUpgrade(filePath);
              if (clean) {
                summary.push({
                  file: tool.reflexFile!,
                  action: `Upgraded reflexes to v${REFLEX_VERSION}`,
                });
              } else {
                summary.push({
                  file: tool.reflexFile!,
                  action: `Appended v${REFLEX_VERSION} reflexes (manual cleanup needed — remove old block)`,
                });
                log.warn(
                  'Totem',
                  `Could not cleanly replace old reflexes in ${tool.reflexFile}. New block appended — please remove the old one manually.`,
                );
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.error(
                'Totem Error',
                `Failed to upgrade reflexes in ${tool.reflexFile}: ${message}`,
              );
            }
          }
        } else {
          for (const { tool } of outdatedFiles) {
            summary.push({
              file: tool.reflexFile!,
              action: 'Outdated reflexes — upgrade declined',
            });
          }
        }
      }

      // --- Hook installation for selected tools ---
      for (const tool of selectedTools) {
        if (!tool.hookInstaller) continue;
        const results = await tool.hookInstaller(cwd);
        for (const result of results) {
          if (result.err) {
            log.error('Totem Error', `Hook scaffolding failed for ${result.file}: ${result.err}`); // totem-ignore — internal hook installer error
          } else if (result.action === 'created') {
            summary.push({ file: result.file, action: `Scaffolded ${tool.name} hook` });
          } else if (result.action === 'merged') {
            summary.push({
              file: result.file,
              action: `Merged ${tool.name} hook into existing config`,
            });
          }
        }
      }
    }

    // --- Always run: enforcement hooks (pre-commit + pre-push) ---
    const enforcement = await installEnforcementHooks(cwd, rl);
    if (enforcement.preCommit === 'installed' || enforcement.preCommit === 'appended') {
      summary.push({
        file: '.git/hooks/pre-commit',
        action: `${enforcement.preCommit === 'installed' ? 'Installed' : 'Appended'} main-branch protection`,
      });
    } else if (enforcement.preCommit === 'skipped-non-shell') {
      summary.push({
        file: '.git/hooks/pre-commit',
        action: 'Skipped — non-shell hook detected (manual integration needed)',
      });
    }
    if (enforcement.prePush === 'installed' || enforcement.prePush === 'appended') {
      summary.push({
        file: '.git/hooks/pre-push',
        action: `${enforcement.prePush === 'installed' ? 'Installed' : 'Appended'} deterministic shield gate`,
      });
    } else if (enforcement.prePush === 'skipped-non-shell') {
      summary.push({
        file: '.git/hooks/pre-push',
        action: 'Skipped — non-shell hook detected (manual integration needed)',
      });
    }

    // --- Always run: post-merge git hook ---
    await installPostMergeHook(cwd, rl);

    // --- Always run: .gitignore ---
    const gitignorePath = path.join(cwd, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      if (!gitignore.includes('.lancedb')) {
        fs.appendFileSync(gitignorePath, '\n# Totem\n.lancedb/\n');
        summary.push({ file: '.gitignore', action: 'Added .lancedb/ exclusion' });
      }
    }

    // --- Auto-ingest cursor rules (ADR-048) ---
    const { scanCursorInstructions } = await import('@mmnto/totem');
    const cursorInstructions = scanCursorInstructions(cwd);
    if (cursorInstructions.length > 0) {
      const answer = await rl.question(
        `\nFound ${cursorInstructions.length} existing AI rule(s) (.cursorrules / .mdc). Compile into deterministic invariants? (Y/n): `,
      );
      if (answer.trim().toLowerCase() !== 'n' && answer.trim().toLowerCase() !== 'no') {
        try {
          const { compileCommand } = await import('./compile.js');
          await compileCommand({ fromCursor: true });
          summary.push({
            file: '.totem/compiled-rules.json',
            action: `Compiled ${cursorInstructions.length} cursor rule(s) into invariants`,
          });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          console.error(`[Totem] Could not compile cursor rules: ${detail}`);
        }
      }
    }

    // --- Print summary ---
    if (summary.length > 0) {
      console.error(`\n${brand('--- Totem Init Summary ---')}`);
      for (const entry of summary) {
        console.error(`  ${success('OK')} ${dim(entry.file)} — ${entry.action}`);
      }
      console.error(brand('--------------------------'));
    }

    log.success('Totem', 'Init complete. Run `totem sync` to index your project.');
  } finally {
    rl.close();
  }
}

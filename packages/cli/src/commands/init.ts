import * as fs from 'node:fs';
import * as path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';

import type { IngestTarget } from '@mmnto/totem';

import { bold, brand, dim, log, printBanner, success } from '../ui.js';
import { IS_WIN } from '../utils.js';
import { installPostMergeHook } from './install-hooks.js';

const AI_PROMPT_BLOCK = `

## Totem AI Integration (Auto-Generated)
You have access to the Totem MCP for long-term project memory. You MUST operate with the following reflexes:

### Memory Reflexes
1. **Pull Before Planning:** Before writing specs, architecture, or fixing complex bugs, use \`search_knowledge\` to retrieve domain constraints and past traps.
2. **Proactive Anchoring (The 3 Triggers):** You must autonomously call \`add_lesson\` when any of the following occur — do NOT wait for the user to ask:
   - **The Trap Trigger:** If you spend >2 turns fixing a bug caused by a framework quirk, unexpected API response, or edge case. (Anchor the symptom + fix).
   - **The Pivot Trigger:** If the user introduces a new architectural pattern or deprecates an old one. (Anchor the rule).
   - **The Handoff Trigger:** At the end of a session or when wrapping up a complex feature, extract the non-obvious lessons learned and anchor them.
3. **Tool Preference (MCP over CLI):** Always prioritize using dedicated MCP tools (e.g., GitHub, Supabase, Vercel) over executing generic shell commands (like \`gh issue view\` or \`curl\`). MCP tools provide structured, un-truncated data optimized for your context window. Only fall back to bash execution if an MCP tool is unavailable or fails.

Lessons are automatically re-indexed in the background after each \`add_lesson\` call — no manual sync needed.

### Workflow Orchestrator Rituals
[FOR LOCAL CLI/TERMINAL AGENTS ONLY] Do not attempt to run these commands if you are a headless bot or operating in a cloud PR environment (e.g., Gemini Code Assist on GitHub).
Totem provides CLI commands that map to your development lifecycle. Use them at these moments:
1. **Start of Session:** Run \`totem briefing\` to get oriented with current branch state, open PRs, and recent context. Run \`totem triage\` if you need to pick a new task.
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to generate an architectural plan and review related context before writing code.
3. **Before PR/Push:** Run \`totem shield\` to analyze uncommitted changes against project knowledge — catches architectural drift and pattern violations.
4. **End of Session:** Run \`totem handoff\` to generate a snapshot for the next agent session with current progress and open threads.

### Cloud / PR Review Bots
[FOR CLOUD BOTS ONLY — e.g., Gemini Code Assist, GitHub Copilot PR Review]
You do NOT have access to the local CLI. Instead, use the Totem MCP tools directly:
1. **Before reviewing a PR:** Call \`search_knowledge\` with queries about the files and patterns being changed to check for known traps and architectural constraints.
2. **Before suggesting changes:** Call \`search_knowledge\` to verify your suggestion aligns with established project patterns and past lessons.
3. **When you spot a recurring issue:** Call \`add_lesson\` to persist the trap so future reviews catch it automatically.
`;

interface DetectedProject {
  hasTypeScript: boolean;
  hasSrc: boolean;
  hasDocs: boolean;
  hasSpecs: boolean;
  hasContext: boolean;
  hasSessions: boolean;
}

type AiTool = 'Claude Code' | 'Gemini CLI' | 'Cursor';

export interface HookInstallerResult {
  file: string;
  action: 'created' | 'exists' | 'skipped' | 'merged';
  err?: string;
}

interface AiToolInfo {
  name: AiTool;
  mcpPath: string;
  reflexFile: string | null;
  serverEntry: Record<string, unknown>;
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
    execSync('totem shield', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
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

const CLAUDE_PRETOOLUSE_ENTRY = {
  matcher: 'Bash',
  hooks: [
    'if printf "%s" "$TOOL_INPUT" | grep -q "git" && printf "%s" "$TOOL_INPUT" | grep -qE "(push|commit)"; then totem shield; fi',
  ],
};

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
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        action: 'skipped',
        err: `[Totem Error] Could not parse settings.local.json (invalid JSON): ${message}`,
      };
    }

    // Deep merge: check if PreToolUse already has a totem entry
    const hooksUntyped = (parsed as { hooks?: unknown }).hooks;
    if (
      hooksUntyped !== undefined &&
      (typeof hooksUntyped !== 'object' || hooksUntyped === null || Array.isArray(hooksUntyped))
    ) {
      return {
        action: 'skipped',
        err: '[Totem Error] Could not merge config: "hooks" in settings.local.json must be an object.',
      };
    }
    const hooks = (hooksUntyped ?? {}) as Record<string, unknown>;
    if (hooks.PreToolUse !== undefined && !Array.isArray(hooks.PreToolUse)) {
      return {
        action: 'skipped',
        err: '[Totem Error] Could not merge config: "hooks.PreToolUse" in settings.local.json must be an array.',
      };
    }
    const preToolUse = (hooks.PreToolUse ?? []) as Array<{ matcher?: string }>;

    if (
      preToolUse.some(
        (h: { matcher?: string; hooks?: string[] }) =>
          h.matcher === 'Bash' &&
          Array.isArray(h.hooks) &&
          h.hooks.some((cmd) => cmd.includes('totem shield')),
      )
    ) {
      return { action: 'skipped' };
    }

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
  const rel = '.claude/settings.local.json';
  const filePath = path.join(cwd, rel);
  const result = scaffoldClaudeHooks(filePath);
  return [{ file: rel, ...result }];
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
    reflexFile: '.gemini/gemini.md',
    serverEntry: { command: npxCmd, args: npxArgs },
    hookInstaller: installGeminiHooks,
  },
  {
    name: 'Cursor',
    mcpPath: '.cursor/mcp.json',
    reflexFile: '.cursorrules',
    serverEntry: { type: 'stdio', command: npxCmd, args: npxArgs },
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

  // Fallback: if nothing detected, add a sensible default
  if (targets.length === 0) {
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

function generateConfig(targets: IngestTarget[], provider: 'openai' | 'ollama'): string {
  const embeddingBlock =
    provider === 'openai'
      ? `  embedding: { provider: 'openai', model: 'text-embedding-3-small' },`
      : `  embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },`;

  return `import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
${formatTargets(targets)}
  ],

${embeddingBlock}

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

/** Inject reflex block into an AI context file if not already present. */
function injectReflexes(filePath: string): 'injected' | 'exists' | 'missing' {
  if (!fs.existsSync(filePath)) return 'missing';

  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.includes('Totem AI Integration') || content.includes('Totem Memory Reflexes')) {
    return 'exists';
  }
  fs.appendFileSync(filePath, AI_PROMPT_BLOCK);
  return 'injected';
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

      let provider: 'openai' | 'ollama' = 'openai';
      const answer = await rl.question(
        'Enter your OpenAI API key (or press Enter to configure local Ollama later): ',
      );

      const apiKey = answer.trim().replace(/[\r\n]/g, '');
      if (apiKey) {
        if (!/^sk-[a-zA-Z0-9_-]+$/.test(apiKey)) {
          log.warn(
            'Totem',
            'API key does not look like a valid OpenAI key (expected sk-...). Skipping.',
          );
          provider = 'ollama';
        } else {
          const envPath = path.join(cwd, '.env');
          const envLine = `OPENAI_API_KEY="${apiKey}"\n`;

          if (fs.existsSync(envPath)) {
            const existing = fs.readFileSync(envPath, 'utf-8');
            if (!/^\s*OPENAI_API_KEY\s*=/m.test(existing)) {
              const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
              fs.appendFileSync(envPath, prefix + envLine);
            }
          } else {
            fs.writeFileSync(envPath, envLine);
          }

          summary.push({ file: '.env', action: 'Saved OpenAI API key' });
        }
      } else {
        provider = 'ollama';
        log.info('Totem', 'Configured for Ollama. Make sure it is running locally.');
      }

      const configContent = generateConfig(targets, provider);
      fs.writeFileSync(configPath, configContent, 'utf-8');
      summary.push({ file: 'totem.config.ts', action: 'Created with auto-detected targets' });
    } else {
      log.dim('Totem', 'totem.config.ts already exists. Checking reflexes and hooks...');
    }

    // --- Always run: .totem/ directory ---
    if (!fs.existsSync(totemDir)) {
      fs.mkdirSync(totemDir, { recursive: true });
    }

    const lessonsPath = path.join(totemDir, 'lessons.md');
    if (!fs.existsSync(lessonsPath)) {
      fs.writeFileSync(
        lessonsPath,
        `# Totem Lessons\n\nLessons learned from PR reviews and Shield checks.\nThis file is version-controlled and reviewed in PR diffs.\n\n---\n`,
        'utf-8',
      );
      summary.push({ file: '.totem/lessons.md', action: 'Created lessons file' });
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
        const filePath = path.join(cwd, tool.mcpPath);
        const result = scaffoldMcpConfig(filePath, tool.serverEntry);

        if (result.err) {
          log.error('Totem', result.err);
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

      // --- Reflex injection for selected tools ---
      for (const tool of selectedTools) {
        if (!tool.reflexFile) continue;
        const filePath = path.join(cwd, tool.reflexFile);
        try {
          const result = injectReflexes(filePath);
          if (result === 'injected') {
            summary.push({ file: tool.reflexFile, action: 'Injected memory reflexes' });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Totem', `Failed to inject reflexes into ${tool.reflexFile}: ${message}`);
        }
      }

      // --- Hook installation for selected tools ---
      for (const tool of selectedTools) {
        if (!tool.hookInstaller) continue;
        const results = await tool.hookInstaller(cwd);
        for (const result of results) {
          if (result.err) {
            log.error('Totem', `Hook scaffolding failed for ${result.file}: ${result.err}`);
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

// ─── Init templates ─────────────────────────────────────
// Extracted from init.ts — template constants and config generators.

import type { IngestTarget } from '@mmnto/totem';

import { detectOrchestrator, type EmbeddingTier, formatTargets } from './init-detect.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 3;
export const REFLEX_START = '<!-- totem:reflexes:start -->';
export const REFLEX_END = '<!-- totem:reflexes:end -->';
export const REFLEX_VERSION_RE = /<!-- totem:reflexes:version:(\d+) -->/;
export const LEGACY_SENTINEL = '## Totem AI Integration (Auto-Generated)';

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

export const TOTEM_FILE_MARKER = '// [totem] auto-generated';

// --- Gemini CLI hook templates ---

export const GEMINI_SESSION_START = `// [totem] auto-generated — Gemini CLI SessionStart hook
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

export const GEMINI_BEFORE_TOOL = `// [totem] auto-generated — Gemini CLI BeforeTool hook
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

export const GEMINI_SKILL = `<!-- [totem] auto-generated — Totem Architect skill -->
# Totem Architect

Before designing, planning, or implementing features, query the project's memory index for relevant context:

1. Use the \`search_knowledge\` MCP tool with a query describing what you're about to build.
2. Review returned lessons, specs, and code patterns before writing any code.
3. If you discover a trap or architectural constraint, factor it into your design.

This ensures you build on existing knowledge rather than repeating past mistakes.
`;

// --- Claude Code hook templates ---

export const CLAUDE_SHIELD_GATE = `// [totem] auto-generated — Claude Code shield gate hook
// Intercepts git push/commit to run \`totem shield\` before proceeding.
const { execSync } = require('child_process');

const input = process.env.TOOL_INPUT || '';
if (/\bgit\b/.test(input) && /\b(push|commit)\b/.test(input)) {
  try {
    execSync('totem lint', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
  } catch (err) {
    process.exit(1);
  }
}
`;

export const CLAUDE_PRETOOLUSE_ENTRY = {
  matcher: 'Bash',
  hooks: [
    {
      type: 'command',
      command: 'node .totem/hooks/shield-gate.cjs',
    },
  ],
};

// ─── Config generation ──────────────────────────────────

export async function generateConfig(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
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

  const orchestrator = detectOrchestrator(cwd);
  const orchestratorBlock = orchestrator
    ? `\n${orchestrator.block}`
    : `\n  // orchestrator: no CLI or API key detected. Add one and re-run \`totem init\`.`;

  return `import type { TotemConfig } from '@mmnto/totem';

const config: TotemConfig = {
  targets: [
${formatTargets(targets)}
  ],

${embeddingBlock}

  ignorePatterns: [
${DEFAULT_IGNORE_PATTERNS.map((p) => `    '${p}',`).join('\n')}
  ],
${orchestratorBlock}
};

export default config;
`;
}

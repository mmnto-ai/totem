// ─── Init templates ─────────────────────────────────────
// Extracted from init.ts — template constants and config generators.

import type { IngestTarget } from '@mmnto/totem';

import type { ConfigFormat, EmbeddingTier } from './init-detect.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 4;
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
1. **Start of Session:** Run \`totem status\` to check manifest freshness, rule count, lesson count, and review staleness. Read \`docs/active_work.md\` for momentum. Run \`totem triage\` if you need to pick a new task.
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to generate an architectural plan and review related context before writing code.
3. **Before Push:** Run \`totem lint\` for a fast compiled-rules check (zero LLM, ~2s). **Before PR:** Run \`totem review\` for a full AI-powered code review against project knowledge (~18s).
4. **End of Session:** Run \`totem handoff\` to generate a snapshot for the next agent session with current progress and open threads.

### Cloud / PR Review Bots
[FOR CLOUD BOTS ONLY — e.g., Gemini Code Assist, GitHub Copilot PR Review]
You do NOT have access to the local CLI. Instead, use the Totem MCP tools directly:
1. **Before reviewing a PR:** Call \`search_knowledge\` with queries about the files and patterns being changed to check for known traps and architectural constraints.
2. **Before suggesting changes:** Call \`search_knowledge\` to verify your suggestion aligns with established project patterns and past lessons.
3. **When you spot a recurring issue:** Call \`add_lesson\` to persist the trap so future reviews catch it automatically.

### Context Management Guardrail
You must be highly defensive of your own context window. If you notice this session becoming long, or if you are asked to read multiple massive files at once, you MUST proactively warn the user about impending context loss. When warning the user, suggest they run \`totem handoff\` to capture mid-task state so they can safely clear the chat and resume. If you receive a \`<totem_system_warning>\` tag in a tool response, read it silently and synthesize a natural-language warning to the user. Do NOT echo the raw XML.
${REFLEX_END}
`;

export const TOTEM_FILE_MARKER = '// [totem] auto-generated';

// ─── Bare-ref regex (xrepo-qualify-refs sealed at mmnto-ai/totem-strategy#145) ───
//
// Mirrors the compiled rule pattern at lessonHash "xrepo-qualify-refs"
// in mmnto-ai/totem-strategy:.totem/compiled-rules.json.
// Seal SHA: c488888b (mmnto-ai/totem-strategy#145, merged 2026-04-26).
//
// If the lint-side rule changes shape, update this constant too — readers
// can verify "is the rule still the same shape?" by comparing the seal SHA
// pointer against the current totem-strategy compiled-rules.json.
//
// The regex matches bare `#NNN` references that are NOT preceded by an
// `owner/repo` qualifier and NOT followed by an alpha/dash character
// (excludes anchor-style IDs like `#section-2`).

export const BARE_REF_REGEX_SOURCE = '(?<!\\b[\\w-]+/[\\w-]+)#(\\d+)(?![-\\w])';

// --- Gemini CLI hook templates ---

export const GEMINI_SESSION_START = `// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs \`totem status\` at the start of every Gemini CLI session.
const { execSync } = require('child_process');

try {
  execSync('totem status', {
    timeout: 30000,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (err) {
  process.stderr.write('[Totem Error] Status unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}
`;

export const GEMINI_BEFORE_TOOL = `// [totem] auto-generated — Gemini CLI BeforeTool hook
// Intercepts:
//   1. git push/commit   → run \`totem lint\` before proceeding (existing shield-gate behavior)
//   2. write_file/edit_file → block bare cross-repo refs in substrate paths
//      (xrepo-qualify-refs, sealed in mmnto-ai/totem-strategy#145)
const { execSync } = require('child_process');

const BARE_REF_REGEX_SOURCE = ${JSON.stringify(BARE_REF_REGEX_SOURCE)};
const SCOPED_PATH_RE = /(\\.handoff[\\\\\\/]|\\.journal[\\\\\\/]|\\.md$)/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\\s*totem-context:/;

function checkXrepoQualifyRefs(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!SCOPED_PATH_RE.test(filePath)) return;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return;

  const lines = content.split(/\\r?\\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }
  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...filtered.join('\\n').matchAll(re)];
  if (matches.length === 0) return;

  const refs = matches.slice(0, 5).map((m) => '#' + m[1]).join(', ');
  throw new Error(
    '[totem PreWriteShield] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '. ' +
    'Qualify each as <owner>/<repo>#NNN (e.g., mmnto-ai/totem#1234). ' +
    'For verbatim quotation, prefix with a <!-- totem-context: <reason> --> directive on the preceding line. ' +
    'Sealed in mmnto-ai/totem-strategy#145.',
  );
}

module.exports = function beforeTool(toolName, toolInput) {
  checkXrepoQualifyRefs(toolName, toolInput);

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

export const CLAUDE_SHIELD_GATE = `// [totem] auto-generated — Claude Code review gate hook
// Intercepts git push/commit to run \`totem review\` before proceeding.
const { execSync } = require('child_process');

const input = process.env.TOOL_INPUT || '';
if (/\bgit\s+(push|commit)\b/.test(input)) {
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

// ─── PreWriteShield: write-time xrepo-qualify-refs enforcement ──────────
//
// Intercepts Write/Edit tool calls in substrate-participating paths
// (.handoff/**, .journal/**, *.md) and blocks bare PR/issue references
// before they hit disk. Eliminates the agent friction loop where a write
// only fails at commit-time (`totem lint` pre-commit).
//
// Exit-code contract is load-bearing — see hook source for details.
//
// Per OQ 2 of mmnto-ai/totem#1846 design: this entry installs into
// committed `.claude/settings.json` (team-level guarantee) — distinct
// from CLAUDE_PRETOOLUSE_ENTRY which lives in `.claude/settings.local.json`
// (per-developer environment safety). The asymmetry reflects the
// architectural distinction between seal-anchored substrate enforcement
// and per-developer command interception.

export const CLAUDE_PREWRITESHIELD = `// [totem] auto-generated — Claude Code PreWriteShield hook
// Write-time enforcement of xrepo-qualify-refs.
// Sealed in mmnto-ai/totem-strategy#145 (seal SHA c488888b).
//
// Mirrors the compiled rule pattern at lessonHash "xrepo-qualify-refs"
// in mmnto-ai/totem-strategy:.totem/compiled-rules.json.
//
// Exit-code contract (LOAD-BEARING — preserves the rule encoded as numbers):
//   0 = allow (no violation, out of scope, or hook-internal failure → fail-soft)
//   1 = hook-internal error (distinguish from intentional block)
//   2 = block (Claude Code blocking convention; bare ref detected in scoped path)
//
// Fail-soft on parse errors / non-string content: \`totem lint\` at
// commit-time remains the hard gate. The hook tightens the loop where
// it can; it does not weaken the existing commit-time guarantee.
'use strict';

const BARE_REF_REGEX_SOURCE = ${JSON.stringify(BARE_REF_REGEX_SOURCE)};
const SCOPED_PATH_RE = /(\\.handoff[\\\\\\/]|\\.journal[\\\\\\/]|\\.md$)/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\\s*totem-context:/;

let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  let parsed;
  try {
    parsed = stdin ? JSON.parse(stdin) : {};
  } catch (err) {
    process.stderr.write('[totem PreWriteShield] could not parse stdin JSON; allowing\\n');
    process.exit(0);
  }

  const toolName = parsed.tool_name;
  if (toolName !== 'Write' && toolName !== 'Edit') {
    process.exit(0);
  }

  const input = (typeof parsed.tool_input === 'object' && parsed.tool_input !== null) ? parsed.tool_input : {};
  const filePath = String(input.file_path || '');
  if (!SCOPED_PATH_RE.test(filePath)) {
    process.exit(0);
  }

  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') {
    process.stderr.write('[totem PreWriteShield] non-string content; allowing\\n');
    process.exit(0);
  }

  // Suppression-directive bypass mirrors rule-engine.ts isSuppressed
  // (line + preceding-line window).
  const lines = content.split(/\\r?\\n/);
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : '';
    if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    filtered.push(line);
  }

  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...filtered.join('\\n').matchAll(re)];
  if (matches.length === 0) {
    process.exit(0);
  }

  const refs = matches.slice(0, 5).map((m) => '#' + m[1]).join(', ');
  process.stderr.write(
    '[totem PreWriteShield] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '\\n' +
    'Qualify each as \`<owner>/<repo>#NNN\` before writing (e.g., \`mmnto-ai/totem#1234\`).\\n' +
    'For verbatim quotation, prefix with a \`<!-- totem-context: <reason> -->\` directive on the preceding line.\\n' +
    'Sealed in mmnto-ai/totem-strategy#145.\\n',
  );
  process.exit(2);
});
`;

export const CLAUDE_PREWRITESHIELD_ENTRY = {
  matcher: 'Write|Edit',
  hooks: [
    {
      type: 'command',
      command: 'node .claude/hooks/PreWriteShield.cjs',
    },
  ],
};

// ─── Config generation ──────────────────────────────────

export async function generateConfig(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
): Promise<string> {
  const { detectOrchestrator, formatTargets } = await import('./init-detect.js');
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
      embeddingBlock = `  // embedding: { provider: 'openai', model: 'text-embedding-3-small' },\n  // embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },\n  // embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' },\n  // Lite tier — configure an embedding provider and re-run \`totem init\` to enable sync/search.`;
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

/**
 * Build a plain config object suitable for YAML/TOML serialization.
 */
async function buildConfigObject(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
): Promise<Record<string, unknown>> {
  const { detectOrchestrator } = await import('./init-detect.js');
  const { DEFAULT_IGNORE_PATTERNS } = await import('@mmnto/totem');

  const config: Record<string, unknown> = {
    targets: targets.map((t) => {
      const entry: Record<string, string> = { glob: t.glob, type: t.type };
      if (t.strategy) entry['strategy'] = t.strategy;
      return entry;
    }),
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
  };

  // Embedding
  switch (embeddingTier) {
    case 'openai':
      config['embedding'] = { provider: 'openai', model: 'text-embedding-3-small' };
      break;
    case 'ollama':
      config['embedding'] = {
        provider: 'ollama',
        model: 'nomic-embed-text',
        baseUrl: 'http://localhost:11434',
      };
      break;
    case 'gemini':
      config['embedding'] = {
        provider: 'gemini',
        model: 'gemini-embedding-2-preview',
        dimensions: 768,
      };
      break;
  }

  // Orchestrator
  const orchestrator = detectOrchestrator(cwd);
  if (orchestrator) {
    config['orchestrator'] = orchestrator.config;
  }

  return config;
}

/**
 * Generate a YAML configuration file.
 */
export async function generateYamlConfig(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
): Promise<string> {
  const { stringify } = await import('yaml');
  const config = await buildConfigObject(targets, embeddingTier, cwd);
  return `# Totem configuration — https://github.com/mmnto-ai/totem\n${stringify(config)}`;
}

/**
 * Generate a TOML configuration file.
 */
export async function generateTomlConfig(
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
): Promise<string> {
  const { stringify } = await import('smol-toml');
  const config = await buildConfigObject(targets, embeddingTier, cwd);
  return `# Totem configuration — https://github.com/mmnto-ai/totem\n${stringify(config)}`;
}

/**
 * Generate config in the specified format.
 */
export async function generateConfigForFormat(
  format: ConfigFormat,
  targets: IngestTarget[],
  embeddingTier: EmbeddingTier,
  cwd: string,
): Promise<{ content: string; filename: string }> {
  switch (format) {
    case 'yaml':
      return {
        content: await generateYamlConfig(targets, embeddingTier, cwd),
        filename: 'totem.yaml',
      };
    case 'toml':
      return {
        content: await generateTomlConfig(targets, embeddingTier, cwd),
        filename: 'totem.toml',
      };
    default:
      return {
        content: await generateConfig(targets, embeddingTier, cwd),
        filename: 'totem.config.ts',
      };
  }
}

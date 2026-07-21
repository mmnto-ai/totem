// ─── Init templates ─────────────────────────────────────
// Extracted from init.ts — template constants and config generators.

import type { IngestTarget } from '@mmnto/totem';

import type { ConfigFormat, EmbeddingTier } from './init-detect.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 7;
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
1. **Start of Session:** The SessionStart hook automatically runs \`totem describe\` to emit the project-orientation banner (project, tier, rule/lesson counts, targets, hooks). For richer derived project state (recent merged PRs, current branch + uncommitted files, latest strategy journal pointer, package versions, rule/lesson counts), call the MCP \`describe_project\` tool — the derived view replaces the retired \`docs/active_work.md\` convention (state is observed, not declared). For a freshness check (manifest staleness, shield drift, review state), run \`totem status\`. Run \`totem triage\` if you need to pick a new task.
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to generate an architectural plan and review related context before writing code.
3. **Before Push:** Run \`totem lint\` for a fast compiled-rules check (zero LLM, ~2s). **Before PR:** Run \`totem review\` for a full AI-powered code review against project knowledge (~18s).
4. **End of Session:** Run \`totem handoff\` to generate a snapshot for the next agent session with current progress and open threads.
5. **Managed hooks self-repair:** \`totem init\` distributes \`.totem/prepare.cjs\` and wires \`package.json\` \`prepare\` to it only when no \`prepare\` script exists. The wrapper runs \`totem hook install\` on every \`pnpm install\`, drift-repairing the managed Claude/Gemini hooks — no manual re-install needed.

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

/**
 * The end marker that CLOSES every managed whole-file session hook template
 * (`.claude/hooks/*.cjs`, `.gemini/hooks/*.js`). Mirrors the #2406 git-hook
 * bounded-ownership semantics (`TOTEM_HOOK_END` et al.) for the JS/CJS hook
 * family: a marker-headed file whose end marker is present with nothing after
 * it is a bounded totem-OWNED whole file, safe to drift-repair without
 * `--force`. A LEGACY file written by a pre-#2410 template carries no in-file
 * end marker → not bounded → declines bare repair and takes one
 * `totem hook install --force` (identical to the shipped #2406 git-hook
 * migration). Collision-free against {@link TOTEM_FILE_MARKER}: the `end `
 * infix means the start marker is never a substring of the end marker.
 */
export const TOTEM_FILE_END = '// [totem] end auto-generated';

/**
 * Whether the totem `marker` OPENS the file — only whitespace may precede it. The
 * ownership GATE for the session-hook family (`.claude/hooks/*.cjs`,
 * `.gemini/hooks/*.js` — no shebang preamble): a user-owned file that merely QUOTES
 * the marker string somewhere in its body is NOT marker-headed and must never be
 * regenerated or overwritten, not even under `--force` (mmnto-ai/totem#2413 — the
 * `includes(marker)` false-positive that let a quoting user file be clobbered).
 * Distinct from install-hooks' `isTotemOwnedWholeFile`, which additionally tolerates
 * a `#!`-shebang preamble that is legitimate for git hooks but never appears here.
 */
export function markerOpensFile(content: string, marker: string): boolean {
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  return content.slice(0, idx).trim().length === 0;
}

/**
 * Whether a marker-headed session-hook file is a bounded totem-OWNED whole file —
 * the precondition for a no-force drift-repair (mmnto-ai/totem#2410). The single
 * shared ownership checker for the session-hook family, consumed by both init's
 * `scaffoldFile` and install-hooks' `regenerateManagedSessionHooks`
 * (mmnto-ai/totem#2413 — was two divergent twins). The session-hook analog of
 * install-hooks' git-hook `isTotemOwnedWholeFile`, minus the shebang preamble the
 * JS/CJS family never carries:
 *   - the marker must OPEN the file (only whitespace before it — no user content);
 *   - the `endMarker` must be present;
 *   - nothing but trailing whitespace may follow the end marker (else a whole-file
 *     rewrite would clobber appended user content).
 */
export function isBoundedOwnedFile(content: string, marker: string, endMarker: string): boolean {
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  if (content.slice(0, idx).trim().length !== 0) return false;
  const end = content.indexOf(endMarker, idx + marker.length);
  if (end === -1) return false;
  if (content.slice(end + endMarker.length).trim().length !== 0) return false;
  return true;
}

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

// ─── Auto-close keyword regex (mmnto-ai/totem#1762) ──────────────────────
//
// The CANONICAL source is `@mmnto/totem`'s `AUTO_CLOSE_REGEX_SOURCE`
// (packages/core/src/autoclose/matcher.ts) — the ONE shared evaluator that D1
// (PR-time check) and D2 (post-merge reconciliation) consume. This is a LOCAL
// MIRROR, not an independent copy: init-templates must NOT statically
// value-import from the heavy core barrel (the cold-start rule,
// mmnto-ai/totem#2339 — it pulls LanceDB into every `--help`), and these
// template constants are evaluated at module top-level so a deferred
// `await import()` is not possible. The mirror is drift-LOCKED by the
// init.test.ts assertions that render the templates and assert each inlines
// `JSON.stringify(<core AUTO_CLOSE_REGEX_SOURCE>)`; if this literal ever drifts
// from core's, those tests fail. Update BOTH in the same change.
const AUTO_CLOSE_REGEX_SOURCE =
  '\\b(?:closed|closes|close|fixed|fixes|fix|resolved|resolves|resolve)\\b' +
  '(?:\\s*:\\s*|\\s+)' +
  '(?:https?://github\\.com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/(?:issues|pull)/(\\d+)' +
  '|([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)#(\\d+)' +
  '|#(\\d+))';

// --- Gemini CLI hook templates ---

/**
 * The ownership/presence marker that opens BOTH whole-file SessionStart hook
 * templates (`GEMINI_SESSION_START` + `CLAUDE_SESSION_START`). The
 * `totem doctor --parity` orientation slice (mmnto-ai/totem#2073) keys
 * presence-detection + owned-file classification on this marker; a test asserts
 * both templates start with it, so the constant stays the single source of truth.
 */
export const SESSION_START_MARKER = '// [totem] auto-generated';

export const GEMINI_SESSION_START = `// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs \`totem describe\` at the start of every Gemini CLI session to emit
// the project-orientation banner ("[Describe] Project: ... Lessons: N
// Targets: N Hooks: ..."). Matches the family-canonical pattern used by
// totem-strategy, totem-substrate, arhgap11, and totem-status, and
// matches the Claude-side SessionStart hook scaffolded by this same init
// pass (mmnto-ai/totem#1884).
const { execSync } = require('child_process');

try {
  execSync('totem describe', {
    timeout: 30000,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (err) {
  process.stdout.write('[Totem] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}

// totem orient --session — live derived in-flight state, ADDITIVE to describe
// (mmnto-ai/totem#2044 PR-3). Own try/catch; orient --session is itself boot-safe.
try {
  execSync('totem orient --session', {
    timeout: 30000,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (err) {
  // Boot-safe: orient is additive to describe; a failure never blocks session start —
  // surface a NON-fatal breadcrumb (matches the Claude-side hook) rather than swallow.
  process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}
${TOTEM_FILE_END}
`;

export const GEMINI_BEFORE_TOOL = `// [totem] auto-generated — Gemini CLI BeforeTool hook
// Intercepts (Gemini CLI write tools are write_file + replace — there is NO
// edit_file; docs.gemini file-system tools + gemini-cli#20321):
//   Guard 1: git push/commit → run \`totem lint\` before proceeding (shield-gate)
//   Rule 1:  write_file/replace → block bare cross-repo refs in substrate paths —
//            xrepo-qualify-refs, sealed in mmnto-ai/totem-strategy#145 (SHA c488888b).
//   Rule 2:  write_file/replace → block GitHub auto-close keywords adjacent to an
//            issue ref in **/*.md (EXEMPT .github/**, .totem/**) — design of
//            record mmnto-ai/totem#1762; sibling seal pending its own PR.
const { execSync } = require('child_process');

const BARE_REF_REGEX_SOURCE = ${JSON.stringify(BARE_REF_REGEX_SOURCE)};
// Single-sourced from @mmnto/totem's AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762);
// inlined for the rendered standalone hook the way BARE_REF_REGEX_SOURCE is.
const AUTO_CLOSE_REGEX_SOURCE = ${JSON.stringify(AUTO_CLOSE_REGEX_SOURCE)};
const SCOPED_PATH_RE = /(\\.handoff[\\\\\\/]|\\.journal[\\\\\\/]|\\.md$)/i;
const MD_PATH_RE = /\\.md$/i;
// EXEMPT .github/** (intentional close keywords) and .totem/** (tool/agent-authored
// lessons etc. — never a GitHub auto-close surface). NOT .changeset/**: changeset
// prose is composed into the Version-Packages PR DESCRIPTION (an auto-close
// surface — verified on PR mmnto-ai/totem#2474); use totem-context there.
const GITHUB_EXEMPT_RE = /(^|[\\\\\\/])\\.(github|totem)[\\\\\\/]/i;
const SUPPRESS_DIRECTIVE_RE = /<!--\\s*totem-context:/;

// mmnto-ai/totem#1762: any close-keyword (close/fix/resolve inflections) adjacent
// to an issue ref in narrative markdown can auto-close a linked issue when the
// text reaches a PR body / commit message — genuine OR negated. Presence
// invariant, zero semantics (no negation parser). Scoped to **/*.md, EXEMPT
// .github/** (PR/issue templates where close keywords are intentional).
function checkAutoCloseKeywords(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!MD_PATH_RE.test(filePath) || GITHUB_EXEMPT_RE.test(filePath)) return;
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
  const re = new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
  const matches = [...filtered.join('\\n').matchAll(re)];
  if (matches.length === 0) return;

  // Group layout: 1+2 = URL owner/repo+N; 3+4 = qualified owner/repo+N; 5 = bare N.
  const refs = matches.slice(0, 5).map((m) => (m[1] ? m[1] + '#' + m[2] : m[3] ? m[3] + '#' + m[4] : '#' + m[5])).join(', ');
  throw new Error(
    '[totem BeforeTool] GitHub auto-close keyword adjacent to issue ref in write to ' + filePath + ': ' + refs + '\\n' +
    'GitHub auto-closes linked issues from a PR body / commit message carrying this pattern (even under negation).\\n' +
    'Rephrase to a non-keyword form (\`references\` / \`see\` / \`tracks\`).\\n' +
    'For verbatim quotation, prefix with a \`<!-- totem-context: <reason> -->\` directive on the preceding line.\\n' +
    'mmnto-ai/totem#1762.',
  );
}

function checkXrepoQualifyRefs(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
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
    '[totem BeforeTool] Bare PR/issue reference(s) in write to ' + filePath + ': ' + refs + '. ' +
    'Qualify each as <owner>/<repo>#NNN (e.g., mmnto-ai/totem#1234). ' +
    'For verbatim quotation, prefix with a <!-- totem-context: <reason> --> directive on the preceding line. ' +
    'Sealed in mmnto-ai/totem-strategy#145.',
  );
}

module.exports = function beforeTool(toolName, toolInput) {
  checkAutoCloseKeywords(toolName, toolInput);
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
${TOTEM_FILE_END}
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
// ALSO enforces the GitHub auto-close guard (mmnto-ai/totem#1762): any
// close-keyword (close/fix/resolve inflections) adjacent to an issue ref in a
// **/*.md write (EXEMPT .github/**, .totem/**) is blocked before it can reach a
// PR body / commit message and accidentally auto-close a linked issue — presence
// invariant, zero semantics, no negation parser. Shares @mmnto/totem's
// AUTO_CLOSE_REGEX_SOURCE (the one shared evaluator).
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
// Rule 1: xrepo-qualify-refs (bare cross-repo refs) —
//         sealed in mmnto-ai/totem-strategy#145 (seal SHA c488888b).
// Rule 2: GitHub auto-close keyword guard —
//         design of record mmnto-ai/totem#1762; sibling seal pending its own PR.
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
// Single-sourced from @mmnto/totem's AUTO_CLOSE_REGEX_SOURCE (mmnto-ai/totem#1762);
// inlined for the rendered standalone .cjs the way BARE_REF_REGEX_SOURCE is.
const AUTO_CLOSE_REGEX_SOURCE = ${JSON.stringify(AUTO_CLOSE_REGEX_SOURCE)};
const SCOPED_PATH_RE = /(\\.handoff[\\\\\\/]|\\.journal[\\\\\\/]|\\.md$)/i;
const AUTO_CLOSE_MD_RE = /\\.md$/i;
// EXEMPT .github/** (intentional close keywords) and .totem/** (tool/agent-authored
// content — never a GitHub auto-close surface). NOT .changeset/**: changeset prose
// is composed into the Version-Packages PR DESCRIPTION (an auto-close surface —
// verified on PR mmnto-ai/totem#2474); the totem-context directive is the escape.
const AUTO_CLOSE_GITHUB_RE = /(^|[\\\\\\/])\\.(github|totem)[\\\\\\/]/i;
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

  const joined = filtered.join('\\n');

  // ── Auto-close keyword guard (mmnto-ai/totem#1762): **/*.md, EXEMPT .github/**, .totem/** ──
  // Presence invariant, zero semantics: any close-keyword adjacent to an issue
  // ref (genuine OR negated) is blocked. Checked before the bare-ref arm because
  // accidental upstream-issue closure is the higher-blast-radius failure.
  if (AUTO_CLOSE_MD_RE.test(filePath) && !AUTO_CLOSE_GITHUB_RE.test(filePath)) {
    const acRe = new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi');
    const acMatches = [...joined.matchAll(acRe)];
    if (acMatches.length > 0) {
      // Group layout: 1+2 = URL owner/repo+N; 3+4 = qualified owner/repo+N; 5 = bare N.
      const acRefs = acMatches.slice(0, 5).map((m) => (m[1] ? m[1] + '#' + m[2] : m[3] ? m[3] + '#' + m[4] : '#' + m[5])).join(', ');
      process.stderr.write(
        '[totem PreWriteShield] GitHub auto-close keyword adjacent to issue ref in write to ' + filePath + ': ' + acRefs + '\\n' +
        'GitHub auto-closes linked issues from a PR body / commit message carrying this pattern (even under negation).\\n' +
        'Rephrase to a non-keyword form (\`references\` / \`see\` / \`tracks\`).\\n' +
        'For verbatim quotation, prefix with a \`<!-- totem-context: <reason> -->\` directive on the preceding line.\\n' +
        'mmnto-ai/totem#1762.\\n',
      );
      process.exit(2);
    }
  }

  const re = new RegExp(BARE_REF_REGEX_SOURCE, 'g');
  const matches = [...joined.matchAll(re)];
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
${TOTEM_FILE_END}
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

// --- Claude Code SessionStart hook (mmnto-ai/totem#1845 slice 1) ---
//
// Symmetric to .gemini/hooks/SessionStart.js: runs the Totem CLI's
// `describe` at session start so Claude boots with project orientation
// (project name, tier, lessons count, targets list) instead of starting
// cold. Wires into committed `.claude/settings.json` (team-level
// guarantee per the same architectural rule that placed PreWriteShield
// there in Phase B; orientation IS a team contract).
//
// `.cjs` extension is load-bearing: package.json `type: module` repos
// otherwise resolve `.js` as ESM and reject the CommonJS `require()`
// calls. Claude Code execs hooks via plain `node`.
//
// stderr is routed to stdout because the Totem CLI writes diagnostic
// output to stderr; SessionStart context must land in Claude's prompt,
// not in user-visible noise.
//
// Fallbacks are deliberately generic — project-specific orientation is
// the job of `totem describe` itself, not the fallback message.

// totem-context: hook script template content — child_process is part
// of the rendered .cjs payload that Claude Code execs via plain `node`,
// not a runtime call from this cli source. Same shape as
// GEMINI_SESSION_START + CLAUDE_PREWRITESHIELD above. Hook scripts
// can't go through safeExec because they don't have access to the cli
// runtime when Claude execs them.
export const CLAUDE_SESSION_START = `// [totem] auto-generated — Claude Code SessionStart hook
// Runs \`@mmnto/cli describe\` at the start of every Claude Code session.
// Mirrors \`.gemini/hooks/SessionStart.js\`. \`.cjs\` extension because
// package.json may have "type": "module" — Claude Code execs hooks via
// plain \`node\`, which would otherwise treat \`.js\` as ESM.
//
// A.3.a: mints a session UUID, persists to .totem/ledger/.session-id,
// and appends a \`session_start\` event to .totem/ledger/events.ndjson
// BEFORE running \`totem describe\`. Subsequent MCP calls within the
// session correlate via session_id (ADR-029 § Session Heuristic).
// Fire-and-forget: any ledger failure must NOT block the briefing.
const { spawnSync } = require('child_process');
const { existsSync, mkdirSync, writeFileSync, appendFileSync } = require('fs');
const { randomUUID } = require('crypto');
const { join } = require('path');

// ─── A.3.a: mint session ID + log session_start event ──────────
try {
  const ledgerDir = join(process.cwd(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const sessionId = randomUUID();
  writeFileSync(join(ledgerDir, '.session-id'), sessionId, 'utf-8');
  // Amended ADR-078 (2026-07-15): agent_source is the env-carried seat-id
  // (TOTEM_SELF_AGENT, first non-empty comma entry), never a vendor class
  // ('claude' has no reverse projection to a seat). Omitted entirely when
  // the env var is absent: stamp absence, never guess (Tenet 4). The parse
  // deliberately mirrors deriveSearchLogAttribution (packages/mcp/src/
  // search-log.ts) and parseEnvAgentList (packages/core/src/
  // orchestration-resolver.ts) — inlined because this rendered .cjs hook
  // runs standalone in consumer repos with no access to those modules; if
  // the shared parse semantics change, change this template in the same PR.
  const selfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const event = {
    timestamp: new Date().toISOString(),
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    ...(selfAgent ? { agent_source: selfAgent } : {}),
    justification: '',
    session_id: sessionId,
  };
  appendFileSync(join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\\n', 'utf-8');
} catch (err) {
  // Fire-and-forget; ledger failures must not block the briefing. A lightweight
  // stderr breadcrumb makes hook misconfigurations diagnosable in consumer repos
  // (CR R1 catch — empty catch suppresses all signal). stderr (not stdout) so
  // the briefing path remains clean for Claude's prompt context.
  process.stderr.write(
    '[SessionStart] Session-start telemetry unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\\n',
  );
}

// ─── totem describe briefing (existing behavior) ────────────────
try {
  const cliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (existsSync(cliPath)) {
    const result = spawnSync(process.execPath, [cliPath, 'describe'], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    if (result.error) {
      throw result.error;
    }
    // Totem CLI writes diagnostic output to stderr; route to stdout so the
    // session-start context lands in Claude's prompt rather than user-visible noise.
    process.stdout.write((result.stdout || '') + (result.stderr || ''));
  } else {
    process.stdout.write(
      '[Totem] @mmnto/cli not installed. Run \`pnpm install\` (or your package manager equivalent) to enable session-start orientation.\\n',
    );
  }
} catch (err) {
  process.stdout.write(
    '[Totem] Briefing unavailable: ' +
      (err instanceof Error ? err.message : String(err)) +
      '\\n',
  );
}

// ─── totem orient --session — live derived in-flight state (mmnto-ai/totem#2044 PR-3) ──
// ADDITIVE to describe (Tenet 13: describe = static identity sensor — scope/tier/
// counts; orient = live in-flight sensor — open PRs/issues/board/freeze). Append,
// never replace. Its OWN try/catch so an orient failure never disturbs the describe
// briefing or the boot; \`orient --session\` is itself boot-safe (emits nothing when
// nothing is high-signal, never exits non-zero, degrades to honest "could not derive").
try {
  const orientCliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (existsSync(orientCliPath)) {
    const orientResult = spawnSync(process.execPath, [orientCliPath, 'orient', '--session'], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    // spawnSync sets .error (it does NOT throw) on a spawn-level failure; re-throw so
    // it surfaces through the catch breadcrumb below rather than writing '' silently.
    if (orientResult.error) {
      throw orientResult.error;
    }
    process.stdout.write((orientResult.stdout || '') + (orientResult.stderr || ''));
  }
} catch (err) {
  // Boot-safe: orient is additive to describe (already emitted), so a failure never
  // blocks session start — but surface a NON-fatal breadcrumb to stderr (not stdout,
  // to keep the prompt clean) for debuggability rather than swallowing silently.
  process.stderr.write(
    '[SessionStart] orient briefing unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\\n',
  );
}
${TOTEM_FILE_END}
`;

export const CLAUDE_SESSION_START_ENTRY = {
  hooks: [
    {
      type: 'command',
      command: 'node .claude/hooks/SessionStart.cjs',
      timeout: 30000,
    },
  ],
};

// ─── Claude Code action-gate wrapper (PR-C, mmnto-ai/totem#2048) ───────
//
// ONE parameterized PreToolUse wrapper that generalizes the shipped
// `review-gate.sh` content-hash pattern into a reusable form. It reads the
// PreToolUse stdin envelope, shells to `totem gate check --event <name>
// --payload <json>`, parses the emitted `GateVerdict`, and maps
// `disposition` → host exit code (ADR-109 §2). One wrapper, N gates: each
// installed PreToolUse entry points at this same script with a different
// `--event` arg baked into the `command` string, so new gates need no new
// CLI flag (the `knownGateEvents()` registry is the single source of truth).
//
// `.cjs` extension is load-bearing: `type: module` repos resolve `.js` as
// ESM and reject the CommonJS `require()` calls; Claude Code execs hooks via
// plain `node`.
//
// Disposition → exit code (ADR-109 §2, branch ONLY on disposition — R2):
//   allow → exit 0 (silent)
//   warn  → exit 0 + reason/provenance to stderr (advisory; NEVER blocks)
//   deny  → reason/provenance to stderr; --strict (default) → exit 2
//           (Claude block convention), --pilot → exit 0
//
// THE EMPTY-SUBSYSTEM GUARDRAIL (strategy-claude T0041Z — LOAD-BEARING):
//   A normal Edit/Write carries `tool_input.file_path` (a PATH), NOT a
//   declared `subsystem`. Path→subsystem mapping is deferred (ADR-109
//   line 112), so an Edit has NO declared subsystem → NO GATE APPLIES →
//   exit 0 (pass through). The wrapper must NOT invoke `gate check` for it.
//   Handing freeze-check an empty subsystem throws GATE_INVALID; a blanket
//   fail-closed would then block EVERY edit (a gate meant to deny ONE frozen
//   subsystem denying ALL edits — Tenet 19 drift). Only when a declared
//   subsystem IS present does the wrapper shell out; only then can a broken
//   deterministic source (corrupt freeze.json) fail-close (exit 2).
//
// Tier (--strict default / --pilot) is read by the WRAPPER, not the engine
// (the engine stays pure per ADR-109 [LOCKED]; freeze-check never emits
// `warn`). The tier is BAKED into the installed command string at install
// time and read ONLY from argv — there is NO env-var override, so a default
// (`--strict`) install is enforcement-immune to a consumer's environment
// (env-var sourcing would be a fail-open: a `TOTEM_GATE_TIER=pilot` in any
// shell could silently downgrade every gate to advisory). Pilot is an
// explicit, install-time opt-in only.

// totem-context: hook script template content — child_process is part of the
// rendered .cjs payload that Claude Code execs via plain `node`, not a runtime
// call from this cli source. Same shape as CLAUDE_SESSION_START above.
export const CLAUDE_GATE_WRAPPER = `// [totem] auto-generated — Claude Code action-gate wrapper
// ONE parameterized PreToolUse wrapper for the Totem gate engine (PR-C,
// mmnto-ai/totem#2048). Reads --event <name> from argv (baked per-entry into
// the installed command), reads the PreToolUse stdin envelope, shells to
// \`totem gate check\`, and maps the GateVerdict disposition → host exit code.
// \`.cjs\` extension because package.json may have "type": "module" — Claude
// Code execs hooks via plain \`node\`, which would otherwise treat \`.js\` as ESM.
//
// Exit-code contract (LOAD-BEARING — ADR-109 §2; branch ONLY on disposition):
//   0 = allow | warn | --pilot deny | NOT-APPLICABLE fail-soft
//       (unparseable/non-object envelope, no-declared-subsystem pass-through)
//   2 = deny (--strict, Claude block convention)
//       | APPLICABLE-gate-not-evaluable fail-closed (missing CLI, non-zero
//         \`gate check\`, unparseable verdict, or unknown disposition)
'use strict';

const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

// ─── Parse baked args (--event <name>, optional --pilot / --strict) ─────
// The tier is read ONLY from argv (baked into the installed command at
// install time). There is NO env-var override: env sourcing would be a
// fail-open (any shell with TOTEM_GATE_TIER=pilot could silently downgrade
// enforcement). Default (no flag) = strict, so a default install is
// environment-immune; --pilot is an explicit install-time opt-in.
const argv = process.argv.slice(2);
let event = '';
let tier = 'strict';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--event') {
    event = argv[i + 1] || '';
    i++;
  } else if (argv[i] === '--pilot') {
    tier = 'pilot';
  } else if (argv[i] === '--strict') {
    tier = 'strict';
  }
}

// Read the PreToolUse stdin envelope.
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
    // Fail-soft on a malformed envelope (mirror PreWriteShield): a broken
    // host envelope is not an applicable gate, so it must NOT block.
    process.stderr.write('[totem gate-wrapper] could not parse stdin JSON; allowing\\n');
    process.exit(0);
  }

  // Valid JSON can still be a non-object (the bytes \`null\`, \`123\`, or a bare
  // quoted string). Such an envelope carries no \`tool_input\` to dereference and
  // is NOT an applicable gate → fail-soft (exit 0). Guarding here also prevents
  // a TypeError-on-deref from leaking as exit 1.
  if (parsed === null || typeof parsed !== 'object') {
    process.stderr.write('[totem gate-wrapper] stdin JSON is not an object; allowing\\n');
    process.exit(0);
  }

  const input =
    typeof parsed.tool_input === 'object' && parsed.tool_input !== null ? parsed.tool_input : {};

  // ─── THE EMPTY-SUBSYSTEM GUARDRAIL ────────────────────────────────────
  // freeze-check's predicate is on a DECLARED subsystem. A normal Edit/Write
  // carries tool_input.file_path (a path), NOT a subsystem. With no declared
  // subsystem, NO GATE APPLIES → pass through (exit 0). Do NOT shell out — a
  // blanket fail-closed here would block every ordinary edit.
  const declaredSubsystem =
    typeof input.subsystem === 'string' && input.subsystem.trim() !== ''
      ? input.subsystem.trim()
      : '';
  if (declaredSubsystem === '') {
    process.exit(0);
  }

  // A gate genuinely applies. Build the --payload from the declared fields.
  // NOTE: this payload projection is freeze-check-shaped (subsystem-only). The
  // wrapper is --event-parameterized, but the payload it builds is currently
  // freeze-check-specific; a future gate needing a different payload field must
  // extend this projection (e.g. branch on \`event\`).
  const payload = JSON.stringify({ subsystem: declaredSubsystem });

  // Resolve the LOCAL Totem CLI (the global \`totem\` binary may be stale and
  // missing deps — the known repo gotcha). Invoke node on the installed dist
  // entry.
  //
  // FAIL-CLOSED on a missing CLI: we are PAST the empty-subsystem guardrail, so
  // a gate genuinely APPLIES here. freeze-check has NO commit-time hard floor
  // (unlike PreWriteShield, whose fail-soft is backed by \`totem-lint\` at
  // commit), so an APPLICABLE gate that cannot be evaluated for ANY reason
  // (missing CLI OR corrupt freeze.json) must fail closed — not silently allow
  // (guardrail rule + Tenet 4 fail-closed). Fail-SOFT (exit 0) is reserved for
  // genuinely NOT-APPLICABLE inputs (unparseable/non-object envelope, no
  // declared subsystem), all of which already returned above.
  const cliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (!existsSync(cliPath)) {
    process.stderr.write(
      '[totem gate] ' +
        event +
        ' applies but the totem CLI is not resolvable; failing closed. ' +
        'Reinstall totem or run \`totem eject\` to remove the gate.\\n',
    );
    process.exit(2);
  }

  const result = spawnSync(
    process.execPath,
    [cliPath, 'gate', 'check', '--event', event, '--payload', payload],
    { encoding: 'utf-8', timeout: 30000 },
  );

  // ─── FAIL-CLOSED ──────────────────────────────────────────────────────
  // A gate genuinely applies (a declared subsystem was present) and the
  // evaluation itself failed (non-zero exit: corrupt freeze.json, spawn
  // error, etc.). Never silently allow when an applicable gate's source is
  // broken → exit 2. (No-declared-subsystem already returned exit 0 above,
  // so this only blocks when a subsystem was actually declared.)
  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    process.stderr.write(
      '[totem gate-wrapper] gate "' +
        event +
        '" evaluation failed (source broken or unavailable) — blocking (fail-closed).\\n' +
        (result.stderr || (result.error ? String(result.error.message || result.error) : '')) +
        '\\n',
    );
    process.exit(2);
  }

  let verdict;
  try {
    verdict = JSON.parse(result.stdout || '');
  } catch (err) {
    // The command emitted unparseable stdout despite a 0 exit — an applicable
    // gate whose verdict we cannot read is a broken source → fail-closed.
    process.stderr.write(
      '[totem gate-wrapper] gate "' + event + '" emitted unparseable verdict — blocking (fail-closed).\\n',
    );
    process.exit(2);
  }

  // ─── Disposition → host exit code (branch ONLY on disposition) ─────────
  const disposition = verdict && typeof verdict.disposition === 'string' ? verdict.disposition : '';
  // reason/provenance are OPAQUE stderr passthrough — never parsed for control flow.
  const detail =
    (verdict && verdict.reason ? verdict.reason : '') +
    (verdict && verdict.provenance ? ' [' + JSON.stringify(verdict.provenance) + ']' : '');

  if (disposition === 'allow') {
    process.exit(0);
  }
  if (disposition === 'warn') {
    process.stderr.write('[totem gate-wrapper] ' + event + ' (warn): ' + detail + '\\n');
    process.exit(0);
  }
  if (disposition === 'deny') {
    process.stderr.write('[totem gate-wrapper] ' + event + ' (deny): ' + detail + '\\n');
    process.exit(tier === 'pilot' ? 0 : 2);
  }

  // Unknown disposition from an applicable gate — fail-closed.
  process.stderr.write(
    '[totem gate-wrapper] gate "' + event + '" returned unknown disposition "' + disposition + '" — blocking (fail-closed).\\n',
  );
  process.exit(2);
});
${TOTEM_FILE_END}
`;

// The PreToolUse entry constant for the freeze-check gate. The \`--event\`
// is baked into the command string per-entry (one wrapper, N gates = N
// entries pointing at the same script with different --event args).
// Matches the \`Write|Edit\` matcher so the wrapper sees every write — the
// empty-subsystem guardrail (in the wrapper) is what keeps ordinary edits
// passing through. Installed into committed \`.claude/settings.json\`
// (team-level governance — gate opt-in is repo policy, Tenet 12).
//
// SOURCE OF TRUTH for the ACTUAL installed command is
// gate-install.ts \`gateCommand(event, tier)\` — it builds the per-gate,
// per-tier string at install time. This constant supplies ONLY the canonical
// \`matcher\` and hook \`type\` (the fields \`gateEntry()\` reads); its \`command\`
// here mirrors the DEFAULT install (freeze-check at the default \`--strict\`
// tier) so a reader sees exactly what a default \`totem gate install\` bakes,
// not a tier-less never-installed string.
export const CLAUDE_GATE_WRAPPER_ENTRY = {
  matcher: 'Write|Edit',
  hooks: [
    {
      type: 'command',
      command: 'node .claude/hooks/gate-wrapper.cjs --event freeze-check --strict',
    },
  ],
};

// ─── Init-distributed prepare wrapper (mmnto-ai/totem#2410 PR-B) ─────────
//
// `totem init` distributes this dependency-free CommonJS wrapper to
// `.totem/prepare.cjs` and wires the consumer's `package.json` `prepare` script
// to invoke it (`node .totem/prepare.cjs`). On every `pnpm install` (the npm
// `prepare` lifecycle) it runs `totem hook install`, so a consumer repo's managed
// hooks self-repair without a manual step. It is a MANAGED_SESSION_HOOKS roster
// member (below), so `totem hook install` itself drift-repairs it for adopters.
//
// The repo-relative install path + the canonical `prepare` script command, shared
// by init's wiring and the doctor parity sensor so both key off one source of truth.
export const PREPARE_SCRIPT_REL = '.totem/prepare.cjs';
export const PREPARE_SCRIPT_COMMAND = 'node .totem/prepare.cjs';

// Wrapper semantics (strategy#894 Option B, Tenet-4 core):
//   - ALL logic runs in Node — NEVER a shell (the Windows quoting class, mmnto-ai/totem#2351).
//   - CLI RESOLUTION: `@mmnto/cli` ships an `exports` map declaring only an `import`
//     condition and NO `./package.json` subpath, so from this CommonJS wrapper BOTH
//     `require.resolve('@mmnto/cli/package.json')` AND `require.resolve('@mmnto/cli')`
//     throw ERR_PACKAGE_PATH_NOT_EXPORTED (verified against the real manifest at
//     packages/cli/package.json, mmnto-ai/totem#2410 PR-B). The working alternative:
//     a manual node_modules walk from the wrapper's own dir + the install cwd, reading
//     package.json directly off disk — it bypasses the exports gate entirely.
//   - NOT INSTALLED: the walk finds no `@mmnto/cli` → ONE stderr line naming the
//     declared-skip class (CLI absent → hooks skipped; strategy#630 class) → exit 0.
//   - INSTALLED: spawn `node <bin> hook install` (stdio inherited) and propagate the
//     child's exit code VERBATIM — a genuine `hook install` failure fails `prepare`
//     LOUD (exit != 0); the CLI's OWN declared skips are exit 0 and pass through. A
//     spawn-level error (child.error set) → print + exit 1.
//
// Marker-headed (opens the file) + end-marker-bounded, so a bare `totem hook install`
// bounded-repairs it and a user-owned `.totem/prepare.cjs` is never clobbered.
export const PREPARE_WRAPPER = `${TOTEM_FILE_MARKER} — Totem init-distributed prepare wrapper (mmnto-ai/totem#2410)
// Runs \`totem hook install\` on \`pnpm install\` (the npm \`prepare\` lifecycle) so a
// consumer repo's managed hooks self-repair without a manual step. Dependency-free
// CommonJS by design — Node execs a \`.cjs\` via plain \`node\`, no build step. ALL
// logic is in Node, NEVER a shell (the Windows quoting class, mmnto-ai/totem#2351).
//
// CLI resolution note: @mmnto/cli's \`exports\` map declares only an \`import\` condition
// and no \`./package.json\` subpath, so \`require.resolve\` (both the package and its
// package.json) throws ERR_PACKAGE_PATH_NOT_EXPORTED from this CommonJS file. The
// working alternative is a manual node_modules walk that reads package.json off disk.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Walk up from each start dir looking for node_modules/@mmnto/cli/package.json.
// Bypasses the exports gate that blocks require.resolve from a CommonJS wrapper.
function findCliPackageJson(startDirs) {
  for (const start of startDirs) {
    if (typeof start !== 'string' || start.length === 0) continue;
    let dir = start;
    while (true) {
      const candidate = path.join(dir, 'node_modules', '@mmnto', 'cli', 'package.json');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

const pkgJsonPath = findCliPackageJson([__dirname, process.cwd()]);
if (pkgJsonPath === null) {
  // Declared skip (strategy#630 class): the CLI is not a dependency here, so there
  // is nothing to install — exit 0 so \`prepare\` (and thus \`pnpm install\`) succeeds.
  process.stderr.write(
    '[totem prepare] @mmnto/cli is not installed — skipping hook install ' +
      '(managed hooks will be set up once the CLI is a dependency).\\n',
  );
  process.exit(0);
}

// Read the bin entry off the resolved manifest and resolve it to an absolute path.
let binJs;
try {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  const bin = pkg && pkg.bin;
  let binRel = null;
  if (typeof bin === 'string') {
    binRel = bin;
  } else if (bin && typeof bin === 'object') {
    binRel = bin.totem || bin[Object.keys(bin)[0]] || null;
  }
  if (typeof binRel !== 'string' || binRel.length === 0) {
    process.stderr.write(
      '[totem prepare] @mmnto/cli is installed but declares no usable bin — ' +
        'cannot run hook install. Reinstall @mmnto/cli.\\n',
    );
    process.exit(1);
  }
  binJs = path.resolve(path.dirname(pkgJsonPath), binRel);
} catch (err) {
  process.stderr.write(
    '[totem prepare] could not read @mmnto/cli package.json: ' +
      (err && err.message ? err.message : String(err)) +
      '\\n',
  );
  process.exit(1);
}

// Spawn \`node <bin> hook install\` — never a shell (the Windows quoting class).
const child = spawnSync(process.execPath, [binJs, 'hook', 'install'], { stdio: 'inherit' });
if (child.error) {
  process.stderr.write(
    '[totem prepare] failed to spawn totem hook install: ' +
      (child.error.message || String(child.error)) +
      '\\n',
  );
  process.exit(1);
}
// Propagate the child's exit code verbatim: a genuine hook-install failure fails
// prepare loud; the CLI's own declared skips already exit 0.
process.exit(child.status == null ? 1 : child.status);
${TOTEM_FILE_END}
`;

// ─── Managed session-hook regeneration roster (mmnto-ai/totem#2410 PR-A) ───
//
// The whole-file, marker-headed `.cjs` / `.js` hook artifacts that `totem init`
// distributes and `totem hook install` regenerates-if-present. Each entry pairs
// the repo-relative path with its canonical content + the marker/end-marker that
// bound the totem-OWNED region (the #2406 git-hook semantics, generalized to the
// JS/CJS hook family). Read by init's installers, `hook install`'s
// `regenerateManagedSessionHooks`, and the roster-invariant test.
//
// INVARIANT (locked by test): every entry's `content` embeds its own `marker`
// AND `endMarker`, so a regenerated artifact is always bounded-owned and thus
// self-repairing on the next bare `totem hook install`.
//
// Not the git hooks (`.git/hooks/*` — those ride `installGitHook`), and not the
// distributed skills (marker-block REPLACE, a different ownership model). The
// gate-wrapper is a roster member because it is a marker-headed whole file even
// though its creation is owned by `gate install` / `init --gates=` rather than
// the default Claude installer.

export interface ManagedSessionHook {
  /** Repo-relative install path (POSIX separators). */
  rel: string;
  /** Canonical whole-file content — embeds `marker` at the head and `endMarker` at the tail. */
  content: string;
  /** Ownership/presence marker that must OPEN the file. */
  marker: string;
  /** End marker that must CLOSE the bounded totem-owned region. */
  endMarker: string;
}

export const MANAGED_SESSION_HOOKS: ReadonlyArray<ManagedSessionHook> = [
  {
    rel: '.claude/hooks/PreWriteShield.cjs',
    content: CLAUDE_PREWRITESHIELD,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    rel: '.claude/hooks/SessionStart.cjs',
    content: CLAUDE_SESSION_START,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    rel: '.claude/hooks/gate-wrapper.cjs',
    content: CLAUDE_GATE_WRAPPER,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    rel: '.gemini/hooks/SessionStart.js',
    content: GEMINI_SESSION_START,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    rel: '.gemini/hooks/BeforeTool.js',
    content: GEMINI_BEFORE_TOOL,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    // The init-distributed prepare wrapper (mmnto-ai/totem#2410 PR-B). A roster member
    // so `totem hook install` drift-repairs it for adopters (init creates it; this verb
    // regenerates-if-present). Not a session hook per se, but the same bounded-ownership
    // whole-file semantics apply.
    rel: PREPARE_SCRIPT_REL,
    content: PREPARE_WRAPPER,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
];

// ─── Claude Code skill distribution (mmnto-ai/totem#1890 Phase C slice 3) ───
//
// Skills are surfaced into consumer repos at `.claude/skills/<name>/SKILL.md`.
// Marker-based replace: canonical content lives between SKILL_MARKER_START
// and SKILL_MARKER_END. Re-running `totem init` replaces inside-marker
// content with the current canonical; content AFTER the end marker is
// user-customization territory and survives across refreshes.
//
// Ships signoff, signon, review-reply, and review-loop. Each passed the
// canonical/customization audit (universal across consumer repos,
// idempotent on refresh, no `totem <name>` subcommand collision).
// signon is the session-start read-twin of signoff, promoted from the
// strategy-local pilot per mmnto-ai/totem-strategy#536 (Proposal 295 d2).
// review-loop is the warm-lane thin driver for the local pre-push review
// loop (Prop 304 R2, mmnto-ai/totem#2106): invoke → fix → re-invoke until
// the CLI reports the round settled; all loop state stays CLI-owned.
//
// Source-of-truth is `mmnto-ai/totem:.claude/skills/<name>/SKILL.md`. The
// `installed-skills-match-source.test.ts` invariant locks these constants
// against the source files so canonical drift fails CI rather than
// silently propagating stale skill content to consumers.

export const SKILL_MARKER_START = '<!-- totem:skill-start -->';
export const SKILL_MARKER_END = '<!-- totem:skill-end -->';

export const SIGNOFF_SKILL_CONTENT =
  `---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

${SKILL_MARKER_START}

End-of-session wrap-up. Post-Proposal-282 (ADR-106), journals + handoffs live in the per-repo \`.totem/orchestration/<agent-id>/\` tree (gitignored) — NOT the substrate. Substrate stays as a frozen archive for forensic reads; the active surface is local.

1. **Update memory.** Update auto-memory files (e.g. \`MEMORY.md\`, topic memories) with any new state — version shipped, tickets closed, key decisions, banked feedback or doctrine signals.

2. **Write a journal entry to the per-repo orchestration path.** Filename convention: \`<model>-NNNN-<short-topic-slug>.md\` (e.g., \`claude-0057-phase-4-resolver-shipped.md\`).

   **Resolve the path two steps:**

   a. **Identify your agent-id** from the current repo's basename. The hardcoded map (Proposal 282 § Scope item 3 — keep in sync with the ADR-106 cohort list):

   | Repo (\`git rev-parse --show-toplevel\` basename) | Claude agent-id                     | Gemini agent-id   | Kimi agent-id     |
   | ----------------------------------------------- | ----------------------------------- | ----------------- | ----------------- |
   | \`totem\`                                         | \`totem-claude\`                      | \`totem-gemini\`    | \`totem-kimi\`      |
   | \`totem-strategy\`                                | \`strategy-claude\`                   | \`strategy-gemini\` | _(not seated)_    |
   | \`liquid-city\`                                   | \`lc-claude\`                         | \`lc-gemini\`       | _(not seated)_    |
   | \`arhgap11\`                                      | \`arhgap11-claude\`                   | \`arhgap11-gemini\` | _(not seated)_    |
   | \`totem-status\`                                  | _(no Claude variant)_               | \`status-gemini\`   | _(not seated)_    |
   | \`totem-playground\`                              | _(orphan stream — no native agent)_ | _(orphan stream)_ | _(orphan stream)_ |

   Seat discovery is dir-derived (mmnto-ai/totem#2141): any \`.totem/orchestration/<agent-id>/\` directory registers that seat for this repo, UNIONED with the basename map above so roster siblings stay visible on fresh clones where the gitignored tree is partial (precedence: \`TOTEM_SELF_AGENT\` env > \`config.json\` \`host_agents\` > seat dirs ∪ basename map). Override hook: a \`host_agents: string[]\` field in \`.totem/orchestration/config.json\` still **replaces** the derived answer — but omitting a PRESENT seat dir attaches a loud warning naming the omitted seat (the dir is the registration; config-exclusion is not a decommission mechanism). The returned list of agent-ids is used by consumers (e.g., \`totem mail\`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session.

   **Visiting case.** If your row's Claude-agent-id column is \`_(no Claude variant)_\` or \`_(orphan stream — no native agent)_\`, you are visiting a repo that doesn't natively host your agent. Resolve the journal path to \`<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/\`, where \`<your-home-agent-id>\` is your own agent-id (e.g., a \`strategy-claude\` session always writes as \`strategy-claude\` regardless of which repo it's visiting; concretely, \`strategy-claude\` visiting \`totem-status\` writes to \`totem-status/.totem/orchestration/strategy-claude/journal/\`). The journal records the visiting agent's session state — the host repo doesn't need a native Claude agent to be a valid write target.

   b. **Resolve the journal directory** via \`resolveOrchestrationPaths(repoRoot, agentId).journal\` from \`@mmnto/totem\`. Returns the absolute path to \`<repoRoot>/.totem/orchestration/<agent-id>/journal/\` when the tree exists. If \`source === 'none'\` (the tree does not exist yet in this repo) the resolver returns \`null\` for every path field — in that case, construct the path manually as \`<repoRoot>/.totem/orchestration/<agent-id>/journal/\` and create the directory first via \`mkdir -p\`; the path is gitignored and safe to create.

3. **No commit, no push.** \`.totem/orchestration/\` is gitignored — local filesystem write is the entire operation. No more substrate rebase-retry loops; the cross-agent write-collision class is eliminated by the single-writer-per-path invariant (you only ever write into your own \`<agent-id>/\` subtree).

` +
  // totem-context: documentation example — `git branch -D` shown in canonical signoff procedure for human readers; not a runtime invocation in this file
  `4. **Clean up stale local branches:**

   \`\`\`bash
   git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | while read -r branch track; do
     [[ "$track" == "[gone]" ]] && git branch -D -- "$branch"
   done
   \`\`\`

5. **Prune + compact your own ECL cursor (retention + processed-mark GC).** Delete your own \`outbox/\` dispatches older than the retention window (**N = 14 days**) per ECL outbox-retention doctrine (\`mmnto-ai/totem-strategy:doctrine/ecl-discipline.md\` § 4.4), THEN compact your \`processed/\` cursor per § 4.5 / ADR-106 § A2. The outbox is transport, not archive — a dispatch's durable content already lives in its home (rulings → ADRs / issues, work-state → the GH board, session history → \`journal/\`), so the aged courier file is disposable (gitignored + local). The \`processed/\` cursor is the read-side twin: a mark whose inbound dispatch its sender already swept shadows nothing, so it is safely collectable. The operator should never have to janitor the mail substrate.

   **Mechanism:** \`totem ecl-gc --apply --compact\` — self-resolves your agent-id (same precedence as step 2a: \`TOTEM_SELF_AGENT\` env > \`config.json\` \`host_agents\` > seat-dir ∪ basename map). It **prunes** only \`<repoRoot>/.totem/orchestration/<your-agent-id>/outbox/\` (a self-resolving binary structurally cannot prune a peer), then **compacts** only your own \`processed/\` marks that shadow nothing. Compaction is cursor-coupled, not age-based, and deletes ONLY against a provably-complete poll — full expected cohort roster present, zero scan warnings, not truncated — else it retains everything (uncertain ⇒ retain). Dry-run by default; \`--apply\` deletes. Neither phase touches \`journal/\`. Report the pruned + collected counts. **Exit codes:** \`0\` clean · \`1\` some deletes failed (janitorial sensor) · \`2\` usage/agent-unresolvable · \`3\` compaction ABORTED loudly (fail-loud, never a silent skip) — no cohort roster declared, the roster is incomplete on this machine, or its A2.4 re-poll check tripped. **Do not block the seal on \`1\` or \`3\`** — the gate-red arms retain the whole cursor (uncertain ⇒ retain); only note them. The gc is a janitorial sensor, not a gate (Tenet 13).

6. **Report:** what shipped, what's pending, what's next.

**Cross-repo handoffs** (when you need to dispatch a message to another agent) write to your own \`<repoRoot>/.totem/orchestration/<agent-id>/outbox/<YYYY-MM-DDTHHMMZ>-<your-agent-id>.md\` with \`to: <recipient-agent-id>\` in the frontmatter. Recipients discover inbound handoffs by polling the single-level glob \`<workspace>/*/.totem/orchestration/*/outbox/*.md\` filtered by their own \`to:\` frontmatter match.

**Substrate (legacy) is read-only.** Do NOT write new content to \`mmnto-ai/totem-substrate:.handoff/\` or \`:.journal/\`. The substrate stays mounted as a frozen archive accessible via \`resolveSubstratePaths(cwd)\` for forensic reads; the cutover broadcast (when it lands) will confirm the final substrate-write cutoff.

${SKILL_MARKER_END}
`;

export const SIGNON_SKILL_CONTENT = `---
name: signon
description: Session-start — consume/derive orientation, poll mail since last signoff, re-derive carryforward gates, present next-steps for operator ruling
---

${SKILL_MARKER_START}

Session-start bring-up. **Read-only** — no mutations, no dispatches, no board edits until the operator rules on next steps (Proposal 295 d2: read-only orient + grounded next-work). Solo — no agent fleet (\`feedback_session_start_derive_cheaply\`: cheap derivation IS the validation dogfood).

1. **Consume the injected orientation.** On Claude Code seats the SessionStart hook already injects the latest journal + carryforward, inbound mail, branch/ticket-matched context, and a bounded session-orientation slice (parked/freeze state, open PRs, board↔issue coherence drift, and an open-issue-count pointer) — do not re-run what it injected. Everything else the bring-up needs (the full board in-flight set, corpus freshness, doctrine currency) is derived on demand via \`totem orient\`. On a hook-less seat (other vendors, cold starts), derive it all: \`totem orient\`.

2. **Poll mail since last signoff.** \`totem mail\` — shows unread cross-repo mail addressed to this repo's agent(s) (ADR-106 §3). Unread = inbound − handled: consumption is tracked by \`processed/\` marks (\`feedback_check_outbox_before_replying\`), so the CLI path needs no cutoff stamp. Read every hit before proceeding — new mail can reprioritize everything below. (Fallback — a seat that must stamp-poll instead derives the cutoff from the newest journal's CONTENT date, the filename stamp or frontmatter, **never file mtime**, which git resets on clone/worktree and silently reports "inbox clean" over waiting mail; mmnto-ai/totem-strategy#813.)

3. **Re-derive the carryforward gates — don't trust the journal's framing** (Tenet 20 read-side twin). For each carryforward item in the latest journal, freshly derive its gate state (the PR it waits on, the issue, the date, the release train) via \`gh\` / \`git\` reads. Cross-repo gates resolve through the frozen cohort roster — \`totem\` / \`strategy\` / \`status\` / \`lc\` → \`mmnto-ai/{totem, totem-strategy, totem-status, liquid-city}\` (mmnto-ai/totem-strategy#611 gates any change). An item whose gate fired leads the next-steps list; an item still gated is reported as waiting, not worked.

4. **Surface owed-now sensors.** Anything the injected/derived orientation flags as owed (corpus \`⚠ stale\`, strategy-doctrine \`⚠ publish owed\`, board drift) goes on the list as a candidate — sensors report, they don't gate (Tenet 13).

5. **Present and stop.** One message: state summary (inbox, gate states, owed-now items) + ranked next-steps with a recommendation. Then wait for the operator's ruling — signon ends at the judgment handoff; mutations belong to the ruled work, not the bring-up.

${SKILL_MARKER_END}
`;

export const REVIEW_REPLY_SKILL_CONTENT = `---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments
---

${SKILL_MARKER_START}

Triage PR review comments from all bots for PR $ARGUMENTS.

## Phase 1: Fetch & Categorize (Deterministic)

Run the triage command to fetch, normalize, deduplicate, and categorize all bot comments:

\`\`\`bash
pnpm totem triage-pr $ARGUMENTS
\`\`\`

This outputs a categorized inbox grouped by blast radius (Security → Architecture → Convention → Nits) with cross-bot deduplication already applied. The heavy lifting is done in TypeScript — no LLM math needed.

**STOP HERE.** Present the output to the user and wait for them to specify actions. Do NOT proceed to Phase 2 until the user replies.

## Phase 2: Execute Actions (Bulk Support)

The user may type individual IDs (e.g., \`fix 4, 11\`) OR use bulk actions:

- \`fix all security\`
- \`defer all nits\`
- \`extract all architecture\`

### \`fix <numbers | category>\`

Mark items as will-fix. No API calls — just acknowledge. The user will make code changes next.

### \`defer <numbers | category> [ticket]\`

Auto-reply on the PR acknowledging the deferral:

- **CodeRabbit items:** Reply inline to each thread with "Tracked in #NNN" or "Deferred — not blocking for this PR."
- **GCA items:** DO NOT reply inline. Batch ALL GCA responses into ONE issue comment: \`@gemini-code-assist\` followed by a numbered list addressing each finding. Use \`gh pr comment $ARGUMENTS --body-file -\` and pipe the comment body via stdin.
- **SARIF items:** No reply needed (our own tool).

### \`nit <numbers | category>\`

Same as defer but reply text is "Acknowledged — nit / by design."

### \`extract <numbers | category>\`

For each selected finding, generate a lesson and call \`mcp__totem-dev__add_lesson\` (or equivalent):

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get \`lifecycle: nursery\` treatment

### \`done\`

Print a summary of actions taken, then — when the round is being dispositioned — assemble and post the single consolidated round-disposition comment (see the section below), which EXECUTES \`totem review --covariate\` to carry the \`local-lane:\` line, on the operator's explicit go. Then exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain \`@gemini-code-assist\`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (\`/issues/{pr}/comments\`), not the review comments reply endpoint.

## Consolidated round-disposition comment (a concrete step, operator-gated)

Disposing the round is ONE consolidated comment (single-comment ownership per bot-protocols) — a real, numbered step of the flow, NOT an optional aside. Like every GitHub mutation in this skill it is operator-gated: assemble the body, show it, and post ONLY on an explicit human go. Run this as part of \`done\` (or whenever the operator asks to post the round disposition):

1. **Obtain the covariate line — execute the verb, never hand-author it.** Run the read-only, zero-LLM command and capture its stdout:

\`\`\`bash
totem review --covariate
\`\`\`

It resolves the current branch lineage exactly as the review fan does, loads the LATEST verdict artifact for that lineage (\`.totem/artifacts/verdicts/\`), and prints the canonical \`local-lane:\` line from the single core-owned renderer — never trust a pasted or hand-copied value. If it reports no verdict for the current lineage, there is no line to carry (note that in the body and continue).

2. **Assemble the single body.** One comment: the per-item dispositions (fixed / deferred / nit / extracted) followed by the non-empty \`local-lane:\` line from step 1, verbatim. The local \`review-loop\` holds this line but never posts it, so \`/review-reply\` is the SOLE path that carries it to GitHub.

3. **Post on an explicit go.** Show the assembled body and wait for the operator; on their go, post the ONE comment with \`gh pr comment $ARGUMENTS --body-file -\` (pipe the body via stdin). Never mutate the PR autonomously.

${SKILL_MARKER_END}
`;

export const REVIEW_LOOP_SKILL_CONTENT = `---
name: review-loop
description: Drive the local pre-push review loop to settle — absorb findings locally before any external bot pass
---

${SKILL_MARKER_START}

Drive the LOCAL pre-push review loop to convergence: run the review, absorb its findings, re-run, and repeat until the CLI reports the round **settled** — before any external bot pass. The loop state (round chaining, the settle computation, lane coverage) is entirely CLI-owned; this skill is a thin driver. Do not reimplement settle logic or count rounds yourself — read what the CLI reports.

This is NOT the external-bot triage skill. \`/review-reply\` handles bot comments on a PR; do NOT invoke external review bots (CodeRabbit, Gemini Code Assist, Greptile) from here. This loop settles local findings first.

## The loop

1. **Run the review.** \`totem review\` runs the repo's configured lanes. Do NOT pass \`--model\` unless the user explicitly asked for a one-lane run — an explicit \`--model\` selects a single-lane invocation and never joins the configured fan. If \`review.lanes\` is not configured, \`totem review\` runs the legacy single-lane path and emits NO verdict artifact or \`local-lane:\` line — this loop's contract requires the verdict artifact, so configure \`review.lanes\` first (a single entry suffices).

2. **Read the reported outcome.** The CLI reports the findings, the lane coverage (completed / attempted), the settled state, and the round number. Take them as reported — do not derive \`settled\` yourself.

3. **If not settled: apply fixes, then re-run.** Fix the actionable findings — **WARN and CRITICAL are actionable; INFO is cosmetic** and can be skipped. Then re-run \`totem review\`; the CLI chains the next round automatically from the prior verdict. An explicit \`--continues <verdict-hash>\` override exists for the rare case where the CLI reports a lineage fork you know is wrong (e.g. a rebase it mis-linked) — otherwise let it chain on its own.

4. **Repeat until settled — or stop honestly.** Loop until the CLI reports the round **settled**. Stop and report if the CLI's max-rounds advisory fires, or a finding is disputed. Never loop forever, and never silently override a disputed finding — a dispute goes to the human.

## Honesty rules

- **Never use \`--override\` without an explicit human go.** It is trap-ledgered.
- **A degraded round is never settled.** If completed < attempted (a lane failed), the round did not settle — say so; a dropped lane is not a pass.
- **Report the outcome faithfully** — the findings, the counts, and the settled state exactly as the CLI reports them.

## At settle: hold the covariate line locally (never post a PR comment)

\`review-loop\` NEVER creates or posts a PR comment. The local loop runs BEFORE any external bot pass, and the round-disposition comment is ONE consolidated comment owned by the operator-invoked \`/review-reply\` workflow. At settle the CLI already prints the covariate line — hold and report it locally, in exactly this format:

<!-- covariate line format v1 — do not alter without a spec amendment -->

\`\`\`
local-lane: <verdictHash8> round=<n> settled=<true|false> lanes=<completed>/<attempted>
\`\`\`

\`<verdictHash8>\` is the first 8 hex characters of the verdict artifact hash the CLI reports. This line is a versioned contract (format v1) consumed by a measurement pilot — do not change its shape without a spec amendment. The CLI renders it from the verdict artifact on every fan run via a single core-owned renderer, so it is re-derivable from the canonical artifact and never hand-authored — on demand, the read-only \`totem review --covariate\` (zero-LLM) resolves the current lineage and prints the latest verdict's line. Inclusion of any pending \`local-lane:\` line in the single consolidated round-disposition comment belongs to \`/review-reply\` (which obtains it by running \`totem review --covariate\`), not to this loop — never post it to GitHub yourself.

${SKILL_MARKER_END}
`;

export const DISTRIBUTED_CLAUDE_SKILLS = [
  { name: 'signoff', content: SIGNOFF_SKILL_CONTENT },
  { name: 'signon', content: SIGNON_SKILL_CONTENT },
  { name: 'review-reply', content: REVIEW_REPLY_SKILL_CONTENT },
  { name: 'review-loop', content: REVIEW_LOOP_SKILL_CONTENT },
] as const;

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

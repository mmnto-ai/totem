// ─── Init templates ─────────────────────────────────────
// Extracted from init.ts — template constants and config generators.

import type { IngestTarget } from '@mmnto/totem';

import type { ConfigFormat, EmbeddingTier } from './init-detect.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 16;
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
1. **Start of Session:** The SessionStart hook automatically runs \`totem describe\` to emit the project-orientation banner (project, tier, rule/lesson counts, targets, hooks). For richer derived project state (recent merged PRs, current branch + uncommitted files, latest strategy journal pointer, package versions, rule/lesson counts), call the MCP \`describe_project\` tool — the derived view replaces the retired \`docs/active_work.md\` convention (state is observed, not declared). For a freshness check (manifest staleness, shield drift, review state), run \`totem status\`. Run \`totem triage\` if you need to pick a new task. On a seat without the SessionStart hook (a cold start, or a vehicle that doesn't run hooks), run \`totem orient\` to derive in-flight and parked project state from primitives.
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to retrieve related context (lessons, specs, code) before writing code. Treat any generated plan as one retrieval input, never the contract — derive the actual design from primary sources (the issue, the code, project doctrine). Under the strict hook tier — which a Claude Code or Cursor seat gets automatically, because the installed hooks arm it when the shell carries \`CLAUDECODE\`, \`CLAUDE_CODE_ENTRYPOINT\` or \`CURSOR_TRACE_ID\` (any other seat opts in with \`totem hook install --strict\`, or with \`hooks.tier\` followed by \`totem hook install --force\` so the tier is re-rendered; mmnto-ai/totem#2706) — this is REQUIRED, not optional: the pre-commit hook blocks until the checkout carries an ANCHORED \`totem spec\` run artifact, and prints the evidence it found. ANCHORED means the run was grounded on an ISSUE, or on a hand-authored design record bound with \`totem spec --from <record>\` — and that its SUBJECT carries the shape the command promises: for an issue run, every required heading with a non-empty body (or, when your project overrides the spec system prompt, just one heading with a body — a custom prompt is not held to the built-in skeleton); for a bound record, at least one heading with a body in the RECORD's own bytes, re-read from disk at commit time. A free-text topic run is NOT evidence (that is the confabulation surface the rule exists for), and neither is an artifact written before this rule — re-run it anchored. A response served from the cache writes no artifact, so add \`--fresh\` when the gate says there is nothing new (mmnto-ai/totem#2690, mmnto-ai/totem#2700). Under the same strict tier the pre-push hook additionally blocks a legs-owed push — a diff touching the paths in \`hooks.legsOwed.globs\` (doctrine, public copy, \`.changeset/**\` and the contract classes your project declares) — until the checkout carries a fresh leg deposit for its head, written with \`totem legs deposit --sha HEAD --from <findings.json>\` once the leg returns, and the gate prints the evidence it found (mmnto-ai/totem#2698). That legs gate can also be armed on its own, at any tier, with \`hooks.legsOwed.enforce: 'block'\` — a standard-tier install then refuses a legs-owed push too, and the gate's line names the key (mmnto-ai/totem#2771).
3. **Before Push:** Run \`totem lint\` — the deterministic enforcement floor (zero LLM, ~2s). **Before PR:** \`totem review\` runs supplementary AI lanes over the diff (~18s) — advisory sensors, not a merge gate; known limits are disclosed in the run output (LLM window truncation on large diffs; non-code files skipped). Your team's own review discipline decides what constitutes the review of record.
4. **End of Session:** Run \`totem handoff\` to generate a snapshot for the next agent session with current progress and open threads.
5. **Managed hooks self-repair:** \`totem init\` distributes \`.totem/prepare.cjs\` and wires \`package.json\` \`prepare\` to it only when no \`prepare\` script exists. The wrapper runs \`totem hook install\` on every \`pnpm install\`, drift-repairing the managed Claude/Gemini hooks — no manual re-install needed.
6. **Action gates (PreToolUse):** a gate installed with \`totem gate install <event>\` is evaluated by the repo-local \`@mmnto/cli\` first and by a \`totem\` on PATH when that is absent; an applicable gate that neither can evaluate fails closed and its message names the exits. A \`Bash|PowerShell\`-matched gate applies to a fresh clone's bootstrap commands (install, build), so bootstrap such a clone from a terminal outside the harness when no \`totem\` is on PATH (mmnto-ai/totem#2799, mmnto-ai/totem#2822).

### Cloud / PR Review Bots
[FOR CLOUD BOTS ONLY — e.g., Gemini Code Assist, GitHub Copilot PR Review]
You do NOT have access to the local CLI. Instead, use the Totem MCP tools directly:
1. **Before reviewing a PR:** Call \`search_knowledge\` with queries about the files and patterns being changed to check for known traps and architectural constraints.
2. **Before suggesting changes:** Call \`search_knowledge\` to verify your suggestion aligns with established project patterns and past lessons.
3. **When you spot a recurring issue:** Call \`add_lesson\` to persist the trap so future reviews catch it automatically.

### Context Management Guardrail
You must be highly defensive of your own context window — and you are the ONLY party holding the denominator (your model's window size and current occupancy); no Totem tool can measure it for you. Large Totem tool responses may carry a self-closing \`<size-disclosure ... />\` line stating that payload's measured size and cumulative session totals — a measurement, never a risk claim. Weigh it against your own occupancy and escalate to the user only when the pressure is genuinely material, suggesting \`totem handoff\` to capture mid-task state before clearing the chat. If you receive a \`<totem_system_warning>\` tag in a tool response (e.g. index staleness or degraded retrieval), read it silently and act on it or surface it naturally. Do NOT echo raw XML tags to the user.
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
const { spawnSync } = require('child_process');

// totem-status refresh-gh — GH-federation snapshot refresh (mmnto-ai/totem-status#127
// C3 residual; tracking mmnto-ai/totem#2556). Spawn-and-forget, detached+unref, and
// fired BEFORE the synchronous describe/orient briefings so it overlaps them: session
// start must never block on it (mmnto-ai/totem#2059 measured ~3s of synchronous gh
// calls here). The verb's exit-0-or-nothing contract (single-flight, atomic rename,
// no-clobber when gh is missing) makes blind firing safe. ENOENT = the sidecar is not
// adopted in this repo (the common non-cohort case) — zero noise; any other spawn
// failure keeps a non-fatal stderr breadcrumb.
// A SECOND verb rides this same block: \`totem-status refresh-obligation-store\`
// (mmnto-ai/totem-status#127 slice-two residual, sibling of mmnto-ai/totem#2556)
// writes the durable obligation store beside the GH snapshot, so it gets the same
// session-start moment. Same primary-checkout gate, same detached+unref spawn, same
// inherited log fd, same ENOENT-silent arm — and each firing stamps its own \`verb=\`
// field, so the log records WHICH verbs fired and in what order. That does NOT
// restore the #2570 per-child reap discriminator: both stamps are written
// back-to-back before either child writes, and child output carries no verb tag
// and arrives in nondeterministic order, so a silent tail attributes only to the
// LAST verb stamped. Reopen when the sidecar tags its own output. Blind firing
// stays safe here too: that verb is in-process single-flight only, so it races the
// daemon exactly the way its manual invocation already does.
// PRIMARY checkout only (.git must be a DIRECTORY): in a linked worktree .git is a
// pointer FILE, and a detached child inheriting the worktree cwd holds a Windows
// directory lock that breaks worktree removal; the primary's hooks + the daemon
// cover the workspace-level snapshot (single-flight makes extra fires redundant).
// A non-git cwd has no refresh moment at all. The stat is cwd-anchored, not a
// walk-up: both host runtimes launch session hooks with cwd = project root, so a
// subdirectory cwd (which would skip) does not occur in practice — and adding a
// git walk would cost a synchronous process on the very path this block keeps free.
try {
  const nodePath = require('path');
  const { statSync } = require('fs');
  let primaryCheckout = false;
  try {
    primaryCheckout = statSync(nodePath.join(process.cwd(), '.git')).isDirectory();
  } catch {
    // not a git checkout (or .git unreadable) — no refresh moment here
  }
  if (primaryCheckout) {
    const { spawn } = require('child_process');
    // Observability leg (mmnto-ai/totem#2570, routed from the status seat's
    // 2026-08-03 silent no-write): under stdio:'ignore' plus the verb's
    // exit-0-or-nothing contract, a reaped or dying child leaves NO trace
    // (Windows detached is not job-object breakaway — a hook-harness
    // tree-kill takes the child mid-run). Each firing stamps a workspace-root
    // log and hands the children the same fd, so their output lands after the
    // stamps. Measured caveat now that TWO verbs share one fd: both stamps are
    // written back-to-back before either child writes, and the children's
    // output is unlabelled and interleaves nondeterministically — so a silent
    // tail no longer discriminates per child; it attributes only to the LAST
    // verb stamped. The stamps still record which verbs fired, and in what
    // order. Log failures degrade to the previous blind firing — the stamp
    // must never block or break the spawn.
    const { openSync, closeSync, appendFileSync, existsSync, writeFileSync } = require('fs');
    // REPO-LOCAL log, inside .git (falsification round: the primary-checkout
    // gate just proved .git is a directory; never tracked, dies with the
    // clone, writable wherever git itself writes, and per-repo so concurrent
    // firings from sibling repos never interleave). A workspace-parent path
    // would grow an un-gitignorable file OUTSIDE the repo tree for every
    // consumer of these published templates — including non-adopters, whose
    // ENOENT firing still stamps.
    const logPath = nodePath.join(process.cwd(), '.git', 'totem-status-refresh-hook.log');
    // Control characters are scrubbed from path-derived fields before they
    // reach the log (terminal-injection guideline: a crafted checkout path
    // must not forge stamp lines or inject terminal controls).
    const scrub = (v) => String(v).replace(/[\\x00-\\x1f\\x7f]/g, '?');
    let stdio = 'ignore';
    let logFd = null;
    try {
      try {
        // 1 MiB self-cap: the log truncates rather than growing forever.
        if (statSync(logPath).size > 1048576) writeFileSync(logPath, '');
      } catch {
        // no log yet — nothing to cap
      }
      appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-gh\\n');
      logFd = openSync(logPath, 'a');
      stdio = ['ignore', logFd, logFd];
    } catch {
      // log unavailable — refresh still fires blind, as before
    }
    const refresh = spawn('totem-status', ['refresh-gh'], {
      detached: true,
      stdio,
    });
    refresh.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-gh\\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
    });
    refresh.unref();
    // Second verb, same gate and same log fd (see the banner above). Written out
    // rather than looped so the spawn, the stamp, and the breadcrumb each carry a
    // literal verb — a reader of the generated hook (or of the log) never has to
    // resolve a variable to know which refresh fired.
    try {
      appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-obligation-store\\n');
    } catch {
      // log unavailable — this verb still fires blind, exactly as the first does
    }
    const refreshStore = spawn('totem-status', ['refresh-obligation-store'], {
      detached: true,
      stdio,
    });
    refreshStore.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-obligation-store\\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-obligation-store spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
    });
    refreshStore.unref();
    // Each child holds its own copy of the fd from spawn time; release the parent's
    // once BOTH are away (an early close would hand the second spawn an EBADF).
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // nothing to release
      }
    }
  }
} catch (err) {
  // Block-level breadcrumb: this catch covers the whole gated block, so neither
  // verb fired — it names the SIDECAR, not one verb. The per-spawn breadcrumbs
  // inside still name their own verb.
  process.stderr.write('[SessionStart] totem-status sidecar refresh unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}

// ─── A.3.a: mint session ID + log session_start event ──────────
// New with mmnto-ai/totem#2468: this template never took over the A.3.a duty
// its Claude sibling carries, so Gemini-seat sessions had no session UUID and
// no session_start denominator row — the selection-manifest join key and the
// recorded-absence contract both need them. Same shape as the Claude template.
// Fire-and-forget: a ledger failure must NOT block the briefing.
let mintedSessionId = null;
try {
  const nodePath = require('path');
  const { mkdirSync, writeFileSync, appendFileSync } = require('fs');
  const { randomUUID } = require('crypto');
  const ledgerDir = nodePath.join(process.cwd(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  mintedSessionId = randomUUID();
  writeFileSync(nodePath.join(ledgerDir, '.session-id'), mintedSessionId, 'utf-8');
  const selfAgentEntry = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const event = {
    timestamp: new Date().toISOString(),
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    ...(selfAgentEntry ? { agent_source: selfAgentEntry } : {}),
    justification: '',
    session_id: mintedSessionId,
  };
  appendFileSync(nodePath.join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\\n', 'utf-8');
} catch (err) {
  process.stderr.write(
    '[SessionStart] session-start telemetry unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\\n',
  );
}

// Interactive Gemini ingests SessionStart CONTEXT only from the
// hookSpecificOutput.additionalContext envelope — plain exit-0 stdout wraps as
// systemMessage, which the interactive startup consumer never injects, so the
// briefing was absent from model context in the primary dev flow even once
// registered (mmnto-ai/totem#2613; leg-verified against @google/gemini-cli
// 0.54.4). systemMessage rides alongside the envelope for the human surfaces:
// interactive startup and /clear render it as a UI info item and -p echoes it
// to stderr — so the briefing is VISIBLE to the human on those surfaces and
// injected as context for the model (one payload, both audiences).
// The Totem CLI writes its banner and diagnostics to STDERR, so capture takes
// BOTH streams — the same seam the Claude-side template documents; a
// stdout-only capture silently drops the describe leg (mmnto-ai/totem#2613
// falsification round). A leg failure carries any partial stdout plus the
// fail-soft note; exit is ALWAYS 0 (never blocks boot).
// Per-leg 20s budgets cut the measured worst-case process exit from 60s to
// 40s against Gemini's 60s DEFAULT_HOOK_TIMEOUT (which tree-kills at expiry;
// no descendant inherits this hook's own streams).
let briefing = '';
try {
  const describeRun = spawnSync('totem describe', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // spawnSync sets .error (it does NOT throw) on spawn-level failure/timeout.
  briefing += describeRun.stdout || '';
  if (describeRun.error || describeRun.status !== 0) {
    const reason = describeRun.error
      ? (describeRun.error.message || String(describeRun.error))
      : ((describeRun.stderr || '').trim() || 'totem describe exited ' + describeRun.status);
    briefing += '[Totem] Briefing unavailable: ' + reason + '\\n';
  } else {
    briefing += describeRun.stderr || '';
  }
} catch (err) {
  // Belt for a genuinely throwing spawnSync: same fail-soft note.
  briefing += '[Totem] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\\n';
}

// Selection-manifest block boundary (mmnto-ai/totem#2468): everything in
// \`briefing\` up to here is the describe leg — including its fail-soft note,
// which IS injected payload when it fires.
const describeBriefingEnd = briefing.length;

// totem orient --session — live derived in-flight state, ADDITIVE to describe
// (mmnto-ai/totem#2044 PR-3). Own try/catch; orient --session is itself boot-safe.
try {
  const orientRun = spawnSync('totem orient --session', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  briefing += orientRun.stdout || '';
  if (orientRun.error || orientRun.status !== 0) {
    const orientReason = orientRun.error
      ? (orientRun.error.message || String(orientRun.error))
      : ((orientRun.stderr || '').trim() || 'totem orient exited ' + orientRun.status);
    // Boot-safe: orient is additive to describe; a failure never blocks session
    // start. The note rides the briefing (both keys) so the model and the human
    // both see the orient gap — a stderr-only note is invisible to the model
    // (CR round on this PR); the parent-stderr breadcrumb stays for hook
    // diagnostics.
    briefing += '[Totem] Orient briefing unavailable: ' + orientReason + '\\n';
    process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + orientReason + '\\n');
  } else {
    briefing += orientRun.stderr || '';
  }
} catch (err) {
  const orientMsg = err instanceof Error ? err.message : String(err);
  briefing += '[Totem] Orient briefing unavailable: ' + orientMsg + '\\n';
  process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + orientMsg + '\\n');
}

// ─── selection manifest (mmnto-ai/totem#2468 M1) ────────────────
// Inline append mirroring the A.3.a write above — this rendered hook runs
// standalone in consumer repos with no access to @mmnto/totem's writer. The
// row shape is BOUND to SelectionManifestRowSchema (strict): change both in
// the same PR; the template contract test parses this row with the real
// schema. A zero-byte block never becomes a candidate (nothing was injected).
try {
  const nodePath = require('path');
  const { appendFileSync } = require('fs');
  const { createHash } = require('crypto');
  const measure = (id, content, reason) => {
    const bytes = Buffer.byteLength(content, 'utf-8');
    return {
      id,
      disposition: 'selected',
      reason,
      bytes,
      approxTokens: Math.ceil(bytes / 4),
      fingerprint: createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16),
    };
  };
  const selfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const row = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    emitter: 'session-start',
    ...(mintedSessionId ? { session_id: mintedSessionId } : {}),
    ...(selfAgent ? { agent_source: selfAgent } : {}),
    // mmnto-ai/totem#2629: provenance disclosed on every row (ruled item 1).
    // Self-minted row — the minting seat IS this process's env read, so the
    // core conflict probe is structurally inapplicable; only the two-value
    // provenance enum rides. Mirrors senseAgentAttribution's biconditional.
    agent_source_provenance: selfAgent ? 'env' : 'absent',
    context: { template: 'gemini-managed' },
    universe: 'managed-template blocks: describe + orient --session',
    costBasis: { bytes: 'utf8-length', approxTokens: 'ceil(bytes/4) approximation' },
    candidates: [
      measure('describe', briefing.slice(0, describeBriefingEnd), 'always-injected briefing'),
      measure('orient:session-block', briefing.slice(describeBriefingEnd), 'always-injected briefing'),
    ].filter((c) => c.bytes > 0),
    warnings: [],
  };
  appendFileSync(
    nodePath.join(process.cwd(), '.totem', 'ledger', 'selection-manifests.ndjson'),
    JSON.stringify(row) + '\\n',
    'utf-8',
  );
} catch (err) {
  process.stderr.write(
    '[SessionStart] selection manifest unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\\n',
  );
}

process.stdout.write(JSON.stringify({
  systemMessage: briefing,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing },
}) + '\\n');
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
//   Rule 3:  write_file/replace → block unquoted ': ' in dispatch frontmatter
//            subject:/expected-action: values under .totem/orchestration/*/outbox/
//            (strict-YAML consumers reject the dispatch; mmnto-ai/totem-status#123).
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
// ECL dispatch surface: .totem/orchestration/<seat>/outbox/*.md (either separator).
const OUTBOX_PATH_RE = /(^|[\\\\\\/])\\.totem[\\\\\\/]orchestration[\\\\\\/][^\\\\\\/]+[\\\\\\/]outbox[\\\\\\/][^\\\\\\/]+\\.md$/i;
const DISPATCH_KEY_RE = /^(subject|expected-action):\\s*(.*)$/;

// Sender-side subject-quoting guard (routed ask, mmnto-ai/totem-status#123): an
// unquoted ': ' (or trailing ':') inside a subject:/expected-action: value breaks
// strict-YAML frontmatter parsers ("mapping values are not allowed in this
// context") — the dispatch delivers only via lenient fallbacks, and sensor
// parity across consumers is lost. Kill the class at write time, at the source.
// Full-file writes scan the leading frontmatter block only (body prose about
// the schema stays writable); fragment edits scan every line but honor the
// totem-context escape.
function checkOutboxSubjectQuoting(toolName, toolInput) {
  if (toolName !== 'write_file' && toolName !== 'edit_file' && toolName !== 'replace') return;
  const input = (typeof toolInput === 'object' && toolInput !== null) ? toolInput : {};
  const filePath = String(input.file_path || input.path || '');
  if (!OUTBOX_PATH_RE.test(filePath)) return;
  const content = input.content !== undefined ? input.content : input.new_string;
  if (typeof content !== 'string') return;

  const lines = content.split(/\\r?\\n/);
  // Mode is TOOL-determined (CR round 1 on the introducing PR): write_file is a
  // full-file write — scan ONLY a leading frontmatter block, and a
  // frontmatter-less full write has nothing in scope (schema completeness is
  // the mail consumer's concern, not this guard's). replace/edit_file are
  // fragments: scan all lines, honoring the totem-context escape.
  const fragment = toolName !== 'write_file';
  let start = 0;
  let end = lines.length;
  if (!fragment) {
    if (lines.length > 0 && lines[0].trim() === '---') {
      start = 1;
      end = start;
      while (end < lines.length && lines[end].trim() !== '---') end++;
    } else {
      end = 0;
    }
  }
  const offenders = [];
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (fragment) {
      const prev = i > 0 ? lines[i - 1] : '';
      if (SUPPRESS_DIRECTIVE_RE.test(line) || SUPPRESS_DIRECTIVE_RE.test(prev)) continue;
    }
    const m = DISPATCH_KEY_RE.exec(line);
    if (!m) continue;
    const value = m[2].trim();
    if (value === '') continue;
    const first = value.charAt(0);
    // A quoted scalar is exempt ONLY when well-terminated on THIS line with
    // YAML-legal escapes (optional trailing comment): unterminated quotes,
    // trailing junk, and invalid escapes like \\q are all strict-YAML errors
    // (greptile P1 + CR round 2 on the introducing PR). Multi-line quoted
    // scalars are YAML-valid but BLOCKED BY POLICY: the cohort's lenient
    // line-oriented consumer (mmnto-ai/totem-status#123) cannot see them —
    // single-physical-line values are the dispatch contract. Block scalars are
    // exempt ONLY as a bare header (>, >-, |2, ...): a header with trailing
    // text (">note: x") is invalid YAML and falls through to the scan.
    if (first === '"' || first === "'") {
      if (first === '"' && /^"(?:[^"\\\\]|\\\\(?:[0abtnvfre "/\\\\N_LP\\t]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}))*"(\\s+#.*)?$/.test(value)) continue;
      if (first === "'" && /^'(?:[^']|'')*'(\\s+#.*)?$/.test(value)) continue;
      offenders.push(m[1]);
      continue;
    }
    if ((first === '>' || first === '|') && /^[>|][+-]?[0-9]*$/.test(value)) continue;
    if (value.indexOf(': ') !== -1 || value.charAt(value.length - 1) === ':') offenders.push(m[1]);
  }
  if (offenders.length === 0) return;

  throw new Error(
    '[totem BeforeTool] Unquoted ":" in dispatch frontmatter value(s) [' + offenders.join(', ') + '] in write to ' + filePath + '. ' +
    'Strict-YAML mail consumers reject the whole dispatch ("mapping values are not allowed in this context"). ' +
    'Quote the value on ONE line with YAML-legal escapes only, e.g. subject: "Re: your round -- topic". ' +
    'Sender-side guard routed from mmnto-ai/totem-status#123 (lenient consumer parsing is the fallback, not the contract).',
  );
}

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

function beforeTool(toolName, toolInput) {
  checkOutboxSubjectQuoting(toolName, toolInput);
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
}
module.exports = beforeTool;

// Entry point — Gemini runs this file as a COMMAND hook (\`node BeforeTool.cjs\`)
// with the hook-input JSON on stdin; without this block the file defines a
// function and exits 0 = allow, leaving every guard above inert
// (mmnto-ai/totem#2611). Exit contract (leg-verified against
// @google/gemini-cli 0.54.4): exit 0 allow · exit 1 ALLOW with warning (an
// uncaught throw exits 1 — throwing can never deny) · exit >= 2 deny ·
// structured stdout {"decision":"deny","reason"} deny. A violation emits the
// structured deny AND exits 2 so either channel suffices. Gemini reads stderr
// only when stdout is EMPTY, so the stderr copy on the deny path never enters
// the hook pipeline — it serves hand-run invocations; on the exit-1 paths the
// stderr breadcrumb IS the payload that surfaces as the warning. Input the
// guard cannot evaluate (unparseable JSON, missing tool_name) is
// allow-with-warning (exit 1): denying every call on a vendor shape change
// would brick the seat, and exiting 0 would hide the outage.
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', function (chunk) { raw += chunk; });
  process.stdin.on('end', function () {
    let input;
    try {
      input = JSON.parse(raw);
    } catch (err) {
      process.stderr.write('[totem BeforeTool] hook input is not parseable JSON — guard did not evaluate this call: ' + (err instanceof Error ? err.message : String(err)) + '\\n');
      process.exit(1);
    }
    if (typeof input !== 'object' || input === null || typeof input.tool_name !== 'string') {
      process.stderr.write('[totem BeforeTool] hook input carries no tool_name — guard did not evaluate this call\\n');
      process.exit(1);
    }
    try {
      beforeTool(input.tool_name, input.tool_input);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stdout.write(JSON.stringify({ decision: 'deny', reason: reason }) + '\\n');
      process.stderr.write(reason + '\\n');
      process.exit(2);
    }
    process.exit(0);
  });
}
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
// ALSO enforces the ECL dispatch frontmatter-quoting guard
// (mmnto-ai/totem-status#123): an unquoted ': ' in a subject:/expected-action:
// value under .totem/orchestration/*/outbox/ breaks strict-YAML mail consumers;
// the write is blocked so the class dies sender-side, cohort-wide.
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
// Rule 3: ECL dispatch frontmatter-quoting guard (outbox subject:/expected-action:
//         values must be strict-YAML-safe) — routed from mmnto-ai/totem-status#123.
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
// ECL dispatch surface: .totem/orchestration/<seat>/outbox/*.md (either separator).
const OUTBOX_PATH_RE = /(^|[\\\\\\/])\\.totem[\\\\\\/]orchestration[\\\\\\/][^\\\\\\/]+[\\\\\\/]outbox[\\\\\\/][^\\\\\\/]+\\.md$/i;
const DISPATCH_KEY_RE = /^(subject|expected-action):\\s*(.*)$/;

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

  // ── Rule 3: dispatch frontmatter quoting (mmnto-ai/totem-status#123) ──
  // Unquoted ': ' (or trailing ':') in a subject:/expected-action: value breaks
  // strict-YAML frontmatter parsers; the dispatch then delivers only via lenient
  // fallbacks and consumer sensor parity is lost. Full-file writes scan the
  // leading frontmatter block only (body prose about the schema stays writable);
  // fragment edits scan every line but honor the totem-context escape. Checked
  // first: a malformed dispatch is unreadable regardless of what its body says.
  if (OUTBOX_PATH_RE.test(filePath)) {
    const dLines = content.split(/\\r?\\n/);
    // Mode is TOOL-determined (CR round 1 on the introducing PR): Write is a
    // full-file write — scan ONLY a leading frontmatter block, and a
    // frontmatter-less full write has nothing in scope (schema completeness is
    // the mail consumer's concern, not this guard's). Edit is a fragment:
    // scan all lines, honoring the totem-context escape.
    const dFragment = toolName === 'Edit';
    let dStart = 0;
    let dEnd = dLines.length;
    if (!dFragment) {
      if (dLines.length > 0 && dLines[0].trim() === '---') {
        dStart = 1;
        dEnd = dStart;
        while (dEnd < dLines.length && dLines[dEnd].trim() !== '---') dEnd++;
      } else {
        dEnd = 0;
      }
    }
    const offenders = [];
    for (let i = dStart; i < dEnd; i++) {
      const dLine = dLines[i];
      if (dFragment) {
        const dPrev = i > 0 ? dLines[i - 1] : '';
        if (SUPPRESS_DIRECTIVE_RE.test(dLine) || SUPPRESS_DIRECTIVE_RE.test(dPrev)) continue;
      }
      const m = DISPATCH_KEY_RE.exec(dLine);
      if (!m) continue;
      const value = m[2].trim();
      if (value === '') continue;
      const first = value.charAt(0);
      // A quoted scalar is exempt ONLY when well-terminated on THIS line with
      // YAML-legal escapes (optional trailing comment): unterminated quotes,
      // trailing junk, and invalid escapes like \\q are all strict-YAML errors
      // (greptile P1 + CR round 2 on the introducing PR). Multi-line quoted
      // scalars are YAML-valid but BLOCKED BY POLICY: the cohort's lenient
      // line-oriented consumer (mmnto-ai/totem-status#123) cannot see them —
      // single-physical-line values are the dispatch contract. Block scalars are
      // exempt ONLY as a bare header (>, >-, |2, ...): a header with trailing
      // text (">note: x") is invalid YAML and falls through to the scan.
      if (first === '"' || first === "'") {
        if (first === '"' && /^"(?:[^"\\\\]|\\\\(?:[0abtnvfre "/\\\\N_LP\\t]|x[0-9A-Fa-f]{2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}))*"(\\s+#.*)?$/.test(value)) continue;
        if (first === "'" && /^'(?:[^']|'')*'(\\s+#.*)?$/.test(value)) continue;
        offenders.push(m[1]);
        continue;
      }
      if ((first === '>' || first === '|') && /^[>|][+-]?[0-9]*$/.test(value)) continue;
      if (value.indexOf(': ') !== -1 || value.charAt(value.length - 1) === ':') offenders.push(m[1]);
    }
    if (offenders.length > 0) {
      process.stderr.write(
        '[totem PreWriteShield] Unquoted ":" in dispatch frontmatter value(s) [' + offenders.join(', ') + '] in write to ' + filePath + '\\n' +
        'Strict-YAML mail consumers reject the whole dispatch ("mapping values are not allowed in this context").\\n' +
        'Quote the value on ONE line with YAML-legal escapes only, e.g. subject: "Re: your round -- topic".\\n' +
        'Sender-side guard routed from mmnto-ai/totem-status#123 (lenient consumer parsing is the fallback, not the contract).\\n',
      );
      process.exit(2);
    }
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
// Symmetric to .gemini/hooks/SessionStart.cjs: runs the Totem CLI's
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
// Mirrors \`.gemini/hooks/SessionStart.cjs\`. \`.cjs\` extension because
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
// Hoisted so the selection-manifest row below (mmnto-ai/totem#2468) can carry
// the same session UUID as its join key.
let mintedSessionId = null;
try {
  const ledgerDir = join(process.cwd(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const sessionId = randomUUID();
  mintedSessionId = sessionId;
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

// ─── totem-status refresh-gh — GH-federation snapshot refresh ───
// (mmnto-ai/totem-status#127 C3 residual; tracking mmnto-ai/totem#2556.)
// Spawn-and-forget, detached+unref, fired BEFORE the synchronous describe/orient
// briefings so it overlaps them: session start must never block on it
// (mmnto-ai/totem#2059 measured ~3s of synchronous gh calls here). The verb's
// exit-0-or-nothing contract (single-flight, atomic rename, no-clobber when gh
// is missing) makes blind firing safe. ENOENT = the sidecar is not adopted in
// this repo (the common non-cohort case) — zero noise; any other spawn failure
// keeps a non-fatal stderr breadcrumb.
// A SECOND verb rides this same block: \`totem-status refresh-obligation-store\`
// (mmnto-ai/totem-status#127 slice-two residual, sibling of mmnto-ai/totem#2556)
// writes the durable obligation store beside the GH snapshot, so it gets the same
// session-start moment. Same primary-checkout gate, same detached+unref spawn, same
// inherited log fd, same ENOENT-silent arm — and each firing stamps its own \`verb=\`
// field, so the log records WHICH verbs fired and in what order. That does NOT
// restore the #2570 per-child reap discriminator: both stamps are written
// back-to-back before either child writes, and child output carries no verb tag
// and arrives in nondeterministic order, so a silent tail attributes only to the
// LAST verb stamped. Reopen when the sidecar tags its own output. Blind firing
// stays safe here too: that verb is in-process single-flight only, so it races the
// daemon exactly the way its manual invocation already does.
// PRIMARY checkout only (.git must be a DIRECTORY): in a linked worktree .git is a
// pointer FILE, and a detached child inheriting the worktree cwd holds a Windows
// directory lock that breaks worktree removal; the primary's hooks + the daemon
// cover the workspace-level snapshot (single-flight makes extra fires redundant).
// A non-git cwd has no refresh moment at all. The stat is cwd-anchored, not a
// walk-up: both host runtimes launch session hooks with cwd = project root, so a
// subdirectory cwd (which would skip) does not occur in practice — and adding a
// git walk would cost a synchronous process on the very path this block keeps free.
try {
  const nodePath = require('path');
  const { statSync } = require('fs');
  let primaryCheckout = false;
  try {
    primaryCheckout = statSync(nodePath.join(process.cwd(), '.git')).isDirectory();
  } catch {
    // not a git checkout (or .git unreadable) — no refresh moment here
  }
  if (primaryCheckout) {
    const { spawn } = require('child_process');
    // Observability leg (mmnto-ai/totem#2570, routed from the status seat's
    // 2026-08-03 silent no-write): under stdio:'ignore' plus the verb's
    // exit-0-or-nothing contract, a reaped or dying child leaves NO trace
    // (Windows detached is not job-object breakaway — a hook-harness
    // tree-kill takes the child mid-run). Each firing stamps a workspace-root
    // log and hands the children the same fd, so their output lands after the
    // stamps. Measured caveat now that TWO verbs share one fd: both stamps are
    // written back-to-back before either child writes, and the children's
    // output is unlabelled and interleaves nondeterministically — so a silent
    // tail no longer discriminates per child; it attributes only to the LAST
    // verb stamped. The stamps still record which verbs fired, and in what
    // order. Log failures degrade to the previous blind firing — the stamp
    // must never block or break the spawn.
    const { openSync, closeSync, appendFileSync, existsSync, writeFileSync } = require('fs');
    // REPO-LOCAL log, inside .git (falsification round: the primary-checkout
    // gate just proved .git is a directory; never tracked, dies with the
    // clone, writable wherever git itself writes, and per-repo so concurrent
    // firings from sibling repos never interleave). A workspace-parent path
    // would grow an un-gitignorable file OUTSIDE the repo tree for every
    // consumer of these published templates — including non-adopters, whose
    // ENOENT firing still stamps.
    const logPath = nodePath.join(process.cwd(), '.git', 'totem-status-refresh-hook.log');
    // Control characters are scrubbed from path-derived fields before they
    // reach the log (terminal-injection guideline: a crafted checkout path
    // must not forge stamp lines or inject terminal controls).
    const scrub = (v) => String(v).replace(/[\\x00-\\x1f\\x7f]/g, '?');
    let stdio = 'ignore';
    let logFd = null;
    try {
      try {
        // 1 MiB self-cap: the log truncates rather than growing forever.
        if (statSync(logPath).size > 1048576) writeFileSync(logPath, '');
      } catch {
        // no log yet — nothing to cap
      }
      appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-gh\\n');
      logFd = openSync(logPath, 'a');
      stdio = ['ignore', logFd, logFd];
    } catch {
      // log unavailable — refresh still fires blind, as before
    }
    const refresh = spawn('totem-status', ['refresh-gh'], {
      detached: true,
      stdio,
    });
    refresh.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-gh\\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
    });
    refresh.unref();
    // Second verb, same gate and same log fd (see the banner above). Written out
    // rather than looped so the spawn, the stamp, and the breadcrumb each carry a
    // literal verb — a reader of the generated hook (or of the log) never has to
    // resolve a variable to know which refresh fired.
    try {
      appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-obligation-store\\n');
    } catch {
      // log unavailable — this verb still fires blind, exactly as the first does
    }
    const refreshStore = spawn('totem-status', ['refresh-obligation-store'], {
      detached: true,
      stdio,
    });
    refreshStore.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-obligation-store\\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-obligation-store spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
    });
    refreshStore.unref();
    // Each child holds its own copy of the fd from spawn time; release the parent's
    // once BOTH are away (an early close would hand the second spawn an EBADF).
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // nothing to release
      }
    }
  }
} catch (err) {
  // Block-level breadcrumb: this catch covers the whole gated block, so neither
  // verb fired — it names the SIDECAR, not one verb. The per-spawn breadcrumbs
  // inside still name their own verb.
  process.stderr.write('[SessionStart] totem-status sidecar refresh unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\\n');
}

// ─── totem describe briefing (existing behavior) ────────────────
// Captured (mmnto-ai/totem#2468): the injected block is the selection-manifest
// candidate below — the not-installed notice is a notice, not a briefing.
let describeText = '';
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
    describeText = (result.stdout || '') + (result.stderr || '');
    process.stdout.write(describeText);
  } else {
    // The notice is printed in exactly the state where a Bash|PowerShell-matched
    // gate self-blocks (no repo-local CLI), so it names the property and the exit
    // (mmnto-ai/totem#2822 ask 3): the wrapper's PATH arm usually carries a fresh
    // clone, and when it cannot, the bootstrap belongs in a real terminal.
    process.stdout.write(
      '[Totem] @mmnto/cli not installed. Run \`pnpm install\` (or your package manager equivalent) to enable session-start orientation. ' +
        'If a Bash|PowerShell-matched gate is installed here it applies to the bootstrap commands and falls back to a totem on PATH; ' +
        'with no totem anywhere, bootstrap this clone from a terminal outside the harness.\\n',
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
let orientText = '';
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
    orientText = (orientResult.stdout || '') + (orientResult.stderr || '');
    process.stdout.write(orientText);
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

// ─── selection manifest (mmnto-ai/totem#2468 M1) ────────────────
// Inline append mirroring the session_start write above — this rendered hook
// runs standalone in consumer repos with no access to @mmnto/totem's writer.
// The row shape is BOUND to SelectionManifestRowSchema (strict): change both
// in the same PR; the template contract test parses this row with the real
// schema. A zero-byte block never becomes a candidate (nothing was injected).
try {
  const { createHash } = require('crypto');
  const measure = (id, content, reason) => {
    const bytes = Buffer.byteLength(content, 'utf-8');
    return {
      id,
      disposition: 'selected',
      reason,
      bytes,
      approxTokens: Math.ceil(bytes / 4),
      fingerprint: createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16),
    };
  };
  const selfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const row = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    emitter: 'session-start',
    ...(mintedSessionId ? { session_id: mintedSessionId } : {}),
    ...(selfAgent ? { agent_source: selfAgent } : {}),
    // mmnto-ai/totem#2629: provenance disclosed on every row (ruled item 1).
    // Self-minted row — the minting seat IS this process's env read, so the
    // core conflict probe is structurally inapplicable; only the two-value
    // provenance enum rides. Mirrors senseAgentAttribution's biconditional.
    agent_source_provenance: selfAgent ? 'env' : 'absent',
    context: { template: 'claude-managed' },
    universe: 'managed-template blocks: describe + orient --session',
    costBasis: { bytes: 'utf8-length', approxTokens: 'ceil(bytes/4) approximation' },
    candidates: [
      measure('describe', describeText, 'always-injected briefing'),
      measure('orient:session-block', orientText, 'always-injected briefing'),
    ].filter((c) => c.bytes > 0),
    warnings: [],
  };
  appendFileSync(
    join(process.cwd(), '.totem', 'ledger', 'selection-manifests.ndjson'),
    JSON.stringify(row) + '\\n',
    'utf-8',
  );
} catch (err) {
  process.stderr.write(
    '[SessionStart] selection manifest unavailable (non-fatal): ' +
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
// --payload -` with the projected JSON on the child's stdin (never argv: a
// Bash command can run to tens of kilobytes and win32 caps a command line at
// 32,767 characters), parses the emitted `GateVerdict`, and maps
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
// Tier (--strict default / --pilot) is read by the WRAPPER and, since
// mmnto-ai/totem#2800 (R1), also FORWARDED to `gate check --tier` so a gate can
// apply it to its OWN unevaluable class (merge-ready warns under pilot where a
// read failed to derive; freeze-check ignores it and fails closed at every
// tier). The engine stays pure — the tier is an input, not state. The tier is
// BAKED into the installed command string at install
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
//       (unparseable/non-object envelope; freeze-check with no declared
//        subsystem; transport-shield on a tool other than Bash/PowerShell or
//        with no non-empty string command; merge-ready on any command that is
//        not \`gh pr merge\` at command position)
//   2 = deny (--strict, Claude block convention)
//       | APPLICABLE-gate-not-evaluable fail-closed (no CLI resolvable
//         (repo-local, then PATH), non-zero \`gate check\`, unparseable verdict,
//         or unknown disposition)
//       | an --event this wrapper has no payload projection for (a baked event
//         it cannot project is an applicable gate it cannot evaluate)
//       | the BUDGET spent before a gate could be evaluated — the projection's
//         git reads did not answer inside it (mmnto-ai/totem#2856 § D)
//       | the BUDGET spent before the envelope arrived on stdin — the host
//         opened this hook and never closed its input (same § D, fold F6)
//     Both budget arms are fail-closed at EVERY tier, --pilot included: an
//     applicable gate that could not be evaluated is not a softened deny.
'use strict';

const { spawnSync } = require('child_process');
const { existsSync, realpathSync } = require('fs');
const { basename, delimiter, dirname, join } = require('path');

// ─── PATH FALLBACK for the Totem CLI (mmnto-ai/totem#2822) ──────────────
// A \`Bash|PowerShell\`-matched gate applies to the very commands that CREATE
// the repo-local CLI on a fresh clone (\`pnpm install\`, then \`pnpm build\` in
// this monorepo), so with a repo-local-only resolution the gate blocks its own
// bootstrap — and blocks the cure it prints. This is a RESOLUTION arm, not an
// exemption: an applicable gate that cannot be evaluated by EITHER arm still
// fails closed (mmnto-ai/totem#2799 ruling, Tenet 4).
//
// A session started in a fresh worktree has no node_modules at its cwd and
// takes this arm; with no global CLI it fails closed — the ruling, not a bug.
//
// The repo-local pinned dist stays FIRST — the pinned-beats-ambient ordering of
// ADR-072 § 2; tiers 1, 3 and 5 are out of scope for a hook that must not shell
// out. This runs only when the pinned dist is absent. Two npm-global layouts
// are probed per PATH dir, first hit wins:
//   (a) <dir>/node_modules/@mmnto/cli/dist/index.js — the win32 layout, where
//       the \`totem.cmd\` shim sits beside \`node_modules\`;
//   (b) <dir>/totem realpath'd — the POSIX npm-global symlink, taken only when
//       it resolves to an existing \`.js\` file (a shell shim resolves to an
//       extensionless script and is correctly skipped).
// A dir that yields neither is skipped; nothing here throws.
//
// PATH is trusted here at exactly the level \`node\` itself already is: the
// settings.json entry invokes this hook as a bare \`node\`, so whoever controls
// PATH controls the interpreter before this line ever runs.
//
// Returns { entry, display }: \`entry\` is the absolute path to spawn, \`display\`
// a NON-resolvable rendering (basenames only) for the stderr provenance line —
// hook stderr lands in transcripts that get pasted into issues, so it never
// carries a user-profile path.
function resolveCliFromPath() {
  const raw = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  const dirs = raw.split(delimiter);
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (!dir) continue;
    const packaged = join(dir, 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
    if (existsSync(packaged)) {
      return {
        entry: packaged,
        display: basename(dir) + '/node_modules/@mmnto/cli/dist/index.js',
      };
    }
    const shim = join(dir, 'totem');
    if (existsSync(shim)) {
      try {
        const real = realpathSync(shim);
        if (typeof real === 'string' && real.endsWith('.js') && existsSync(real)) {
          return {
            entry: real,
            display:
              basename(dir) + '/totem -> ' + basename(dirname(real)) + '/' + basename(real),
          };
        }
      } catch (err) {
        // An unreadable link is not a resolution — keep scanning the PATH.
      }
    }
  }
  return null;
}

// ─── merge-ready: \`gh pr merge\` at COMMAND POSITION + its payload ──────
//
// One walk over the command text does BOTH jobs, so recognition and argv
// extraction can never disagree: it tracks quoting, splits on the unquoted
// command separators (\`;\`, \`&\`, \`|\`, a newline, \`(\`/\`)\`, \`{\`/\`}\`, and a
// backtick) and tokenizes each segment. A segment whose FIRST token is the
// \`gh\` executable, followed by \`pr\` and \`merge\`, is a merge at command
// position; a quoted "gh pr merge" is a single token and never matches, so
// \`echo "gh pr merge"\` does not fire. What is NOT the command is stripped from
// the segment's front before the anchor is read — a leading redirection, the
// transparent wrapper programs with their options, the shell's reserved words
// (\`do\`, \`then\`, \`else\`, \`if\`, \`elif\`, \`while\`, \`until\`, \`!\`, \`coproc\`) and
// any run of \`NAME=value\` assignment prefixes — so \`for … ; do gh pr merge;
// done\`, \`if gh pr merge 5; then …\` and \`GH_TOKEN=x gh pr merge 5\` all fire.
// Before the PR's review round only \`do\`/\`then\`/\`else\`/\`!\` were skipped, so a
// merge used AS an \`if\` condition, or behind an assignment prefix, went
// unjudged (mmnto-ai/totem#2844 round 1, greptile). EVERY matching segment is
// collected, not the first: \`gh pr merge 7; gh pr merge 8\` yields two argv
// lists and the wrapper judges each PR on its own facts (same round).
//
// HEREDOC BODIES AND COMMENTS ARE BLANKED FIRST (mmnto-ai/totem#2800 fold F4).
// A heredoc body is DATA, not commands: \`cat <<EOF\` … \`gh pr merge 5\` … \`EOF\`
// writes a line of text and merges nothing, and firing there was a false deny —
// the one direction this projection must not have. Since mmnto-ai/totem#2857
// the scanner that finds those bodies is a VERBATIM port of core's
// \`findHeredocs\` (see the sync anchor below), not a second reading of the same
// grammar: quoted (\`<<'EOF'\`, \`<<"EOF"\`, \`<<\\EOF\`) and bare delimiters,
// \`<<\` and \`<<-\` (whose terminator may be tab-indented), an unterminated body
// read to the end of the command, \`<<<\` left alone (a here-string is not a
// heredoc), \`$(( … ))\` / \`(( … ))\` skipped whole so a shift opens nothing, a
// \`#\` that begins a word discarded to end-of-line, and the paren bookkeeping
// that says whether a \`)\` ends a word. Every \`<<\` on the operator line is
// queued and its body consumed in order, as bash does for \`cat <<A <<B\`.
//
// WHAT THE ANCHOR NOW READS (mmnto-ai/totem#2856, the strict tier's
// precondition — under PILOT each of these was one lost advisory read, under
// STRICT a bypass): the executable may be spelled \`gh\`, \`gh.exe\` or either
// behind a path; a CLOSED table of transparent wrapper programs (\`sudo\`,
// \`env\`, \`timeout\`, \`nice\`, \`nohup\`, \`command\`, \`exec\`, \`time\`) is stripped
// with its option grammar; \`eval\` re-tokenizes its operand once and
// \`env -S\` / \`--split-string\` splits its own operand into the words that
// take the option's place; a leading redirection is skipped with its file;
// and a backtick substitution is a segment of its own. In POWERSHELL mode a
// trailing backtick is that shell's LINE CONTINUATION instead — at a WORD
// BOUNDARY the backtick and the newline are consumed and the next line
// continues the command, the twin of bash's trailing backslash there
// (round-6 leg, G3, bounded by round-7's H4); it was a separator in both
// modes before, which made the backtick itself the merge's target and left
// the real one in the next segment. INSIDE a word the two shells differ:
// PowerShell's backtick escapes the newline INTO the argument, so
// \`gh pr merg<backtick><LF>e 5\` is the word \`merg<LF>e\` and merges
// nothing — and neither does this.
//
// Disclosed misses, same posture as transport-shield's scanner — the gate does
// NOT fire, which is the safe direction, never a false deny. Every one of them
// is a LOCKED row in gate-install.test.ts, so this list is read from the suite,
// not from memory:
//   - a VARIABLE executable (\`$GH pr merge 5\`, \`\${GH} pr merge 5\`): the walk
//     cannot expand it, and the \`unresolvedTarget\` arm covers only the PR
//     argument, not the program;
//   - an UNQUOTED win32 path (\`C:\\tools\\gh.exe pr merge 5\`): this walk reads
//     POSIX quoting for BOTH tools, so the separators are consumed as escapes
//     and the token arrives as \`C:toolsgh.exe\`. Quoted, it projects;
//   - \`timeout\` with NO duration (\`timeout gh pr merge 5\`): the grammar
//     consumes exactly one positional before the command, so \`gh\` reads as the
//     duration. The form is invalid to \`timeout\` itself;
//   - a wrapper program not on the table (\`npx\`, \`xargs\`, \`bash -c "…"\`) and a
//     builtin flag not in it: the table is closed on purpose — the walk cannot
//     know which operand of an arbitrary program is the command;
//   - a table word spelled by PATH (\`/usr/bin/time -f x gh pr merge 5\`): the
//     table is keyed on the bare word the shell reads at command position, and
//     \`/usr/bin/time\` is a PROGRAM with its own option grammar, not the
//     reserved word this table models;
//   - env's OWN splitting rules inside a \`-S\` / \`--split-string\` operand.
//     The operand itself is no longer a miss: it is SPLIT and read, because
//     every spelling of it RUNS the merge (fold 3, measured on coreutils
//     8.32 with a stub \`gh\`) and consuming it with the option made all of
//     them a bypass under STRICT. But it is split on WHITESPACE and nothing
//     more: env's own escapes (\`\\_\` is a SPACE, \`\\n\`, \`\\t\`, \`\\#\`,
//     \`\\$\`), its \`$VAR\` expansion inside the string and its \`#\` comment
//     are not modelled, and quotes INSIDE the string are not stripped.
//     Measured: \`env -S 'gh\\_pr\\_merge\\_5'\` runs \`gh pr merge 5\`, while
//     the split reads ONE word here and nothing projects; and
//     \`env -S 'env -S "gh pr merge 5"'\` runs it too, because env strips the
//     quotes inside its own operand while this walk keeps them and reads
//     \`"gh\` as the executable (both locked rows, round-7 leg H5). The
//     ATTACHED SHORT spelling is no longer among them: \`env -Sgh pr merge 5\`
//     and \`env -S'gh pr merge 5'\` both arrive as the token
//     \`-Sgh pr merge 5\`, and the rest of that token is now read as the
//     operand, so both are judged;
//   - CLUSTERED short options on a table word (\`env -vu X gh pr merge 5\`,
//     \`env -iS '<cmd>'\`): the option test reads the WHOLE \`-\` token, so a
//     cluster matches no entry of that word's operand list, is dropped as one
//     flag, and the operand belonging to the cluster's LAST letter (\`X\` for
//     \`-vu\`, the command string for \`-iS\`) is left standing at the front of
//     the strip, where it blocks the anchor. coreutils RUNS the merge in both
//     (measured, 8.32 — the \`-i\` spelling with absolute paths inside the
//     operand, since \`-i\` clears the environment). ATTACHMENT is not the gap:
//     \`env -uX\`, \`nice -n10\`, \`timeout -k5 30\` and \`timeout -sTERM 30\` all
//     project and all run. CLUSTERING is (round-8 leg, J4);
//   - \`eval\` nested deeper than ONE level
//     (\`eval "eval \\"gh pr merge 5\\""\`);
//   - a substitution inside DOUBLE quotes (\`echo "\`gh pr merge 5\`"\`,
//     \`echo "$(gh pr merge 5)"\`): bash EXECUTES both of those, but the
//     tokenizer's quote arm swallows the whole string as ONE token, so the
//     merge inside runs unjudged. Filed as mmnto-ai/totem#2893 (round-5 leg,
//     F4); the single-quoted spelling really is data and stays a control row;
//   - a redirection operator carrying a tokenizer separator (\`>|\`, \`2>&1\`,
//     \`>& file\`, \`<& 3\`, \`exec 3>&1 …\`): \`|\` and \`&\` end the segment before
//     the operator is read as one word, and ALL FIVE of those are merges the
//     shell runs — measured with a stub on bash 5.3, each applies its
//     redirection and then runs \`gh pr merge 5\` (the \`<& 3\` form once that
//     descriptor is open). The segment they leave starts at the FILE
//     (\`out.txt\`, \`1\`, \`file\`, \`3\`), so nothing of the merge is read: a
//     fail-open, not text the shell ignores (round-6 leg, G2). A \`&>\` splits
//     the same way but leaves a readable \`>\` at the front of the next
//     segment, so THAT one projects;
//   - PowerShell's own quoting (backtick escapes outside double quotes,
//     here-strings) is not modelled — the walk reads POSIX quoting for both
//     tools. PowerShell's call operator is NOT a miss: \`& gh pr merge 5\`
//     projects, because \`&\` is one of the separators and the segment after it
//     starts at \`gh\` (row, not memory).
// Disclosed FALSE FIRES, the deny direction, all contrived — text the shell
// does not execute as a merge but that sits at a segment's front here: a bash
// array assignment whose elements spell a merge (\`A=(gh pr merge 8)\`) is judged
// as a merge of 8, because \`(\` is a separator and the segment inside it starts
// with \`gh\`; a \`case\` pattern \`gh pr merge)\` yields an EMPTY argv, which
// projects to the current branch's PR (both surfaced when every segment began
// to be collected, round 2 F6); and a function DEFINITION whose body is a
// merge (\`f() { gh pr merge 5; }\`) fires at definition time, because \`{\` is a
// separator and the body is its own segment (round 3, F4; it fired before this
// PR's rounds too). A fourth, PowerShell's own: a double-quoted string whose
// backtick escapes a quote (\`Write-Output "a \`"; gh pr merge 5\`"b"\`) is ONE
// string to PowerShell and merges nothing, but this walk reads POSIX quoting
// for both tools, so the \`"\` after the escaping backtick closes the string and
// the merge reaches a segment's front (round-5 leg, F13; a row asserts it).
// A fifth, and the only one that is not contrived: an INVALID OPTION to a
// word on the table above (\`command -x\`, \`exec -x\`, \`timeout -Z 30\`,
// \`nice -Z\`, \`env -Z\`, \`nohup -x\`, \`sudo -Z\`). Each makes the program answer
// "invalid option" and run NOTHING, while the strip below reads any unknown
// \`-\` token as one of that word's own options and projects the merge behind
// it. Ruled disclose-not-cure (round-6 leg, G4): the cure is a closed \`flags\`
// list per program — the shape \`time\` carries, whose reserved-word grammar
// really is two flags — and on a mutant with that list everywhere it turns
// every real flag the list omits (\`sudo -n\`, \`sudo -E\`,
// \`timeout --foreground\`) into a MISS, which is a bypass under STRICT. A
// false fire on a command that runs nothing costs one bogus deny; rows assert
// each of them, so this paragraph is read from the suite.
// A sixth, PowerShell's again (round-7 leg, H4): a backtick that is the LAST
// CHARACTER OF THE INPUT (\`gh pr merge 5 <backtick>\`, with nothing after it,
// not even a newline) is a continuation with nothing to continue — pwsh
// answers with a parse error and runs NOTHING — while here the backtick is
// not followed by a newline, so it falls through to the separator arm and the
// merge in front of it is judged. Narrowed to that one spelling on a
// measurement (round-8 leg, J3): give the SAME input a trailing newline
// (\`gh pr merge 5 <backtick><LF>\`) and pwsh runs the merge, while the
// continuation arm here consumes the pair and projects it — no divergence.
// A seventh, env's (round-7 leg, H5): a \`$VAR\` inside a \`-S\` operand
// (\`env -S 'gh pr merge $PR'\`) makes env REFUSE the whole command — it
// supports only \`\${VARNAME}\` and answers "only \${VARNAME} expansion is
// supported" — so NOTHING runs, while the split reaches the anchor and
// \`$PR\` rides as an \`unresolvedTarget\` the strict tier denies.
// An eighth, PowerShell's third (round-8 leg, J3): a backtick followed by
// WHITESPACE and then a newline (\`gh pr merge <backtick><space><LF>5\`) is not
// a continuation either, because the backtick escapes that SPACE. pwsh runs
// \`gh pr merge\` with NO TARGET — the current branch's PR merges — and reads
// the next line as its own statement, while here the backtick is not
// IMMEDIATELY followed by a newline, so the separator arm takes it and the
// walk projects \`unresolvedTarget\` naming the backtick: a target nobody
// wrote, which the strict tier denies (measured on pwsh 7 with a stub \`gh\`;
// a row asserts the projection).
// \`TOTEM_MERGE_GATE_OVERRIDE=1\` is the audited way past any of them.
// ─── The heredoc scanner (mmnto-ai/totem#2857) ─────────────────────────
// sync-anchor: findHeredocs-scanner-downstream (packages/core/src/transport-shield.ts findHeredocs; the parity test in gate-install.test.ts is the lock)
//
// A VERBATIM port of core's \`findHeredocs\` and its three tables, not a second
// reading of the same grammar. The hand copy this replaces had diverged in the
// FAIL-OPEN direction — it opened heredocs core does not, and each one blanked
// the \`gh pr merge\` on a following line (a lost advisory read under PILOT, a
// bypass under STRICT): no paren-boundary arms, so a \`#\` after \`(\` or after an
// operator \`)\` was text and a \`<<word\` inside it opened a body; a narrower
// bare-delimiter class, so \`<<E:F\` read as the prefix \`E\` and the terminator
// line never matched; and a double-quote backslash that escaped ANY next
// character where core escapes only DQ_ESCAPABLE.
//
// A distributed hook cannot import core (its exports map carries \`import\`
// conditions only and no scanner subpath — mmnto-ai/totem#2851), so the cohort
// lesson for an inlined standalone utility rules: port verbatim, anchor both
// sites, lock it with an executable parity test. Change nothing here without
// changing core's \`findHeredocs\` and re-running that test.

/** Inside double quotes a backslash escapes only these (POSIX); elsewhere it is kept. */
const DQ_ESCAPABLE = ['$', '\`', '"', '\\\\', '\\n'];

/**
 * \`<<\` or \`<<-\`, optional blanks, then the delimiter WORD as bash delimits it:
 * single-quoted, double-quoted, backslash-quoted (\`\\EOF\`) or bare — a bare
 * word running to the next blank, quote, backslash or operator character, so
 * \`EOF.TXT\`, \`E:F\` and \`1EOF\` are whole delimiter words. Groups: 1 the dash,
 * 2 single-quoted, 3 double-quoted, 4 backslash-quoted, 5 bare.
 */
const HEREDOC_AT =
  /^<<(-?)[ \\t]*(?:'([^'\\n]+)'|"([^"\\n]+)"|\\\\([^\\s'"\\\\<>()|&;]+)|([^\\s'"\\\\<>()|&;]+))/;

/**
 * Characters after which the next character BEGINS a word — where a \`#\` starts
 * a comment (POSIX 2.3 rule 9). Parentheses are not here: an opening \`(\` and an
 * OPERATOR \`)\` begin a word, but the \`)\` that closes a \`$( … )\` continues one,
 * so the walk tracks which \`(\` each \`)\` closes and sets the boundary from that.
 */
const WORD_BOUNDARY = [' ', '\\t', '\\r', '\\n', ';', '|', '&'];

// The index just past the \`))\` that closes an arithmetic expansion whose
// opening \`$((\` / \`((\` ends at \`from\`; the end of the command when it is
// unterminated. A \`<<\` inside is a SHIFT, never a heredoc operator — without
// this guard \`echo $((1<<2))\` opened a heredoc and swallowed every command
// after it, so a real \`gh pr merge\` went unjudged (F1).
function skipArithmetic(command, from) {
  let depth = 2;
  let i = from;
  while (i < command.length) {
    const ch = command[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return command.length;
}

/**
 * ONE pass over the command that tracks shell quoting and SKIPS heredoc
 * bodies, returning every heredoc's span. Core's \`findHeredocs\`, arm for arm:
 * an operator inside a quoted argument is text, \`<<<\` is a here-string, a
 * \`#\` that begins a word discards the rest of its line without quote
 * processing, \`$(( … ))\` / \`(( … ))\` is skipped whole, and \`parens\` records
 * what each open \`(\` is — a substitution (\`$(\`, \`<(\`, \`>(\`), which is part of
 * a word, or a grouping operator — so the \`)\` that closes it can say whether
 * the next character begins a word. A body starts after the newline that ends
 * the operator's line and runs to the first line that IS the delimiter (an
 * exact line match, as bash reads it), or to the end of the command.
 *
 * The one thing core's scanner does not need and this one does: the COMMENT
 * regions. Core's tokenizer reads comments itself; this wrapper's does not, so
 * the blanker below has to blank them exactly as the hand copy dropped them,
 * or a \`<# … #>\` block or a \`#\` comment whose text begins with a merge would
 * reach the anchor. They are collected in the SAME two arms that discard them,
 * so the two readings cannot disagree, and they are NOT part of the span list
 * the parity lock compares.
 */
function scanShell(command, ps) {
  const spans = [];
  const comments = [];
  const pending = [];
  const parens = [];
  let inSingle = false;
  let inDouble = false;
  let boundary = true;
  let i = 0;
  // Consume EVERY body queued on the operator line, in order, starting just
  // past that line's newline — bash reads \`cat <<A <<B\` as two bodies, so a
  // command sitting in B's body is data too (F2). An unterminated body runs to
  // the end of the command and no later heredoc on that line can start.
  const consumeBodies = (from) => {
    let cursor = from;
    for (let p = 0; p < pending.length; p++) {
      const h = pending[p];
      const bodyStart = cursor;
      let bodyEnd = command.length;
      let unterminated = true;
      let resume = command.length;
      let at = bodyStart;
      while (at <= command.length) {
        const nl = command.indexOf('\\n', at);
        const stop = nl === -1 ? command.length : nl;
        let line = command.slice(at, stop);
        if (h.stripTabs) line = line.replace(/^\\t+/, '');
        if (line === h.delimiter) {
          bodyEnd = at;
          unterminated = false;
          resume = nl === -1 ? command.length : nl + 1;
          break;
        }
        if (nl === -1) break;
        at = nl + 1;
      }
      spans.push({
        delimiter: h.delimiter,
        quoted: h.quoted,
        stripTabs: h.stripTabs,
        unterminated: unterminated,
        bodyStart: bodyStart,
        bodyEnd: bodyEnd,
      });
      cursor = resume;
      if (unterminated) break;
    }
    pending.length = 0;
    return cursor;
  };
  while (i < command.length) {
    const ch = command[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      i += 1;
      boundary = false;
      continue;
    }
    if (inDouble) {
      if (ps && ch === '\`' && i + 1 < command.length) {
        // PowerShell's escape inside a double-quoted string is the backtick.
        i += 2;
        boundary = false;
        continue;
      }
      if (ch === '\\\\' && i + 1 < command.length && DQ_ESCAPABLE.indexOf(command[i + 1]) !== -1) {
        i += 2;
        boundary = false;
        continue;
      }
      if (ch === '"') inDouble = false;
      i += 1;
      boundary = false;
      continue;
    }
    if (ps && command.slice(i, i + 2) === '<#') {
      // PowerShell's block comment, discarded without quote processing; an
      // unterminated one runs to the end. Applied ONLY for the PowerShell tool
      // (round 4, F8): in bash \`sort <#tmp\` is a redirect from a file named
      // \`#tmp\`, and discarding from it to a later \`#>\` would swallow real
      // commands.
      const close = command.indexOf('#>', i + 2);
      const end = close === -1 ? command.length : close + 2;
      comments.push({ start: i, end: end });
      i = end;
      boundary = true;
      continue;
    }
    if (ch === '#' && boundary) {
      // A comment: discarded to the end of the line without quote processing;
      // the newline itself stays (it may end an operator line).
      const nl = command.indexOf('\\n', i);
      const end = nl === -1 ? command.length : nl;
      comments.push({ start: i, end: end });
      i = end;
      continue;
    }
    if (ch === '$' && command.slice(i, i + 3) === '$((') {
      i = skipArithmetic(command, i + 3);
      boundary = false;
      continue;
    }
    if (ch === '(' && command[i + 1] === '(' && boundary) {
      i = skipArithmetic(command, i + 2);
      boundary = false;
      continue;
    }
    if ((ch === '$' || ch === '<' || ch === '>') && command[i + 1] === '(') {
      // A command or process substitution: part of the word that carries it.
      // Its first character begins a word (a \`#\` right after \`$(\` is a
      // comment).
      parens.push('subst');
      i += 2;
      boundary = true;
      continue;
    }
    if (ch === '(') {
      parens.push('group');
      i += 1;
      boundary = true;
      continue;
    }
    if (ch === ')') {
      // The \`)\` of a substitution continues the word; an operator \`)\` ends one.
      boundary = parens.pop() !== 'subst';
      i += 1;
      continue;
    }
    if (ch === '\\\\') {
      i += 2;
      boundary = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      boundary = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      boundary = false;
      continue;
    }
    if (ch === '\\n') {
      i = pending.length > 0 ? consumeBodies(i + 1) : i + 1;
      boundary = true;
      continue;
    }
    // \`<<\` opens a heredoc; \`<<<\` is a here-string and is left alone — at BOTH
    // of its first two characters (without the preceding-character guard the
    // second \`<\` of \`<<<\` opened a heredoc whose body swallowed every later
    // line, a fail-open path — CodeRabbit on mmnto-ai/totem#2855).
    if (ch === '<' && command[i + 1] === '<' && command[i - 1] !== '<' && command[i + 2] !== '<') {
      const m = HEREDOC_AT.exec(command.slice(i));
      if (m !== null) {
        pending.push({
          stripTabs: (m[1] || '') === '-',
          quoted: m[2] !== undefined || m[3] !== undefined || m[4] !== undefined,
          delimiter:
            m[2] !== undefined
              ? m[2]
              : m[3] !== undefined
                ? m[3]
                : m[4] !== undefined
                  ? m[4]
                  : m[5] !== undefined
                    ? m[5]
                    : '',
        });
        i += m[0].length;
        boundary = false;
        continue;
      }
    }
    boundary = WORD_BOUNDARY.indexOf(ch) !== -1;
    i += 1;
  }
  if (pending.length > 0) consumeBodies(command.length);
  return { heredocs: spans, comments: comments };
}

/** Every heredoc in the command — core's span shape minus the unused \`body\`. */
function findHeredocSpans(command, powershell) {
  return scanShell(command, powershell === true).heredocs;
}

/**
 * The command with every heredoc body, and every comment, replaced by SPACES:
 * core's blanking shape, so LENGTH and every offset are preserved (the hand
 * copy dropped body lines instead, which moved every offset after them). The
 * tokenizer below treats any run of spaces as one boundary, so the change of
 * shape is invisible to it — the heredoc rows in the suite are that proof.
 */
function blankHeredocBodies(command, powershell) {
  const scan = scanShell(command, powershell === true);
  const regions = [];
  for (let s = 0; s < scan.heredocs.length; s++) {
    regions.push({ start: scan.heredocs[s].bodyStart, end: scan.heredocs[s].bodyEnd });
  }
  for (let c = 0; c < scan.comments.length; c++) {
    regions.push(scan.comments[c]);
  }
  let out = command;
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    if (region.end <= region.start) continue;
    out =
      out.slice(0, region.start) +
      ' '.repeat(region.end - region.start) +
      out.slice(region.end);
  }
  return out;
}

// The words the shell reads at command position that are NOT the command:
// reserved words that introduce a compound command (\`time\` and \`coproc\` are
// reserved words too — the round-2 leg found them missing), the negation, and
// the builtins that execute their operand as the command (\`exec\`, \`command\`,
// \`eval\`). Stripped from a segment's front, in any run, before the
// \`gh pr merge\` anchor is read.
//
// Four of them — \`time\`, \`exec\`, \`command\`, \`eval\` — also carry an OPTION
// grammar, so they appear again in TRANSPARENT_WRAPPERS below and the strip
// reads them from THERE (the table is consulted first). They stay here so this
// list still reads as what it is: every word the shell itself skips at command
// position.
const COMMAND_POSITION_WORDS = [
  'do',
  'then',
  'else',
  'if',
  'elif',
  'while',
  'until',
  'time',
  'coproc',
  '!',
  'exec',
  'command',
  'eval',
];

// A \`NAME=value\` word at a segment's front is an assignment PREFIX to the
// command that follows it (\`GH_TOKEN=x gh pr merge 5\`), never the command.
function isAssignmentPrefix(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

// The executable spellings the anchor accepts (mmnto-ai/totem#2856 § A):
// \`gh\`, \`gh.exe\`, and either of those behind a path (\`./gh\`,
// \`/usr/local/bin/gh\`, \`'C:\\tools\\gh.exe'\`). The BASENAME after the last
// \`/\` or \`\\\` is what is read, and the \`.exe\` suffix is case-insensitive as
// win32 resolves it. Reading only the bare token \`gh\` left every other
// spelling of the SAME executable unjudged — one lost advisory read under
// PILOT, a bypass under STRICT (greptile P1 on mmnto-ai/totem#2855).
// A VARIABLE executable (\`$GH\`, \`\${GH}\`) is not a spelling this wrapper can
// expand, and stays a disclosed miss below.
function isGhExecutable(token) {
  if (typeof token !== 'string' || token === '') return false;
  const slash = token.lastIndexOf('/');
  const back = token.lastIndexOf('\\\\');
  const cut = slash > back ? slash : back;
  const base = cut === -1 ? token : token.slice(cut + 1);
  if (base === 'gh') return true;
  // The whole \`gh.exe\` basename compares case-insensitively: win32 resolves
  // file names without case, so \`GH.EXE pr merge 5\` and \`Gh.exe pr merge 5\`
  // run the same executable as \`gh.exe pr merge 5\` (CodeRabbit on
  // mmnto-ai/totem#2894 — the stem-only lower-casing left both unjudged). The
  // bare \`gh\` stays EXACT: \`GH\` is a different name on a POSIX filesystem,
  // and on win32 it is a disclosed miss locked in the suite.
  return base.length === 6 && base.toLowerCase() === 'gh.exe';
}

// ─── Transparent wrapper programs (mmnto-ai/totem#2856 § B) ─────────────
// A CLOSED table of words that RUN their operand as the command, with the
// option grammar needed to find that operand:
//   operand     — options that take a SEPARATE next token (skip the option AND
//                 that token);
//   positional  — how many non-option words the program itself consumes before
//                 the command (only \`timeout\`'s duration);
//   terminator  — whether a \`--\` ends its options;
//   describe    — options that make the word DESCRIBE its operand instead of
//                 executing it (\`command -v\`, \`sudo -l\`): the segment ends
//                 with NO projection, because nothing is executed;
//   flags       — when present, the ONLY options the word HAS: any other
//                 \`-\` token is not an option of it, so the shell runs no
//                 command and there is nothing to project (bash's \`time\`
//                 reserved word answers \`-f: command not found\`);
//   evaluates   — the builtin whose operand is a STRING to re-tokenize;
//   evaluatesOperand
//               — the OPTIONS whose own operand is a command STRING: the
//                 operand is split into words and those words TAKE THE
//                 OPTION'S PLACE, so the strip reads on from them
//                 (\`env -S 'gh pr merge 5'\`).
// Every other \`-\` token is skipped as a flag of the wrapper, so a long option
// with an ATTACHED value (\`--user=x\`, \`--kill-after=5\`, \`--adjustment=10\`)
// needs no entry and a bare \`-10\` reads as \`nice\`'s adjustment. A long option
// that takes a SEPARATE operand does need one, beside its short spelling, or
// the operand itself reads as the command (\`sudo --user root gh …\` read
// \`root\` as the program — round-5 leg, F2). After a wrapper is consumed the
// strip loops, so the assignment prefixes of \`env NAME=v gh …\` and a wrapper
// wrapping a wrapper both resolve.
//
// The table is CLOSED on purpose (ADR-082 A1, Tenet 19): a program that is not
// on it IS the command, because this walk cannot know which of an arbitrary
// program's operands is a command — \`npx\` runs a package, \`xargs\` builds its
// own argv. Widening it is a later PR with its own rows, never a guess here.
const TRANSPARENT_WRAPPERS = {
  sudo: {
    // Every sudo option that takes an argument, per sudo(8): \`-a type\`,
    // \`-C num\`, \`-c class\`, \`-D directory\`, \`-g group\`, \`-h host\`,
    // \`-p prompt\`, \`-R directory\`, \`-r role\`, \`-t type\`, \`-T timeout\`,
    // \`-u user\`, \`-U user\`, each with its long spelling. \`-R\`, \`-a\` and
    // \`-c\` were missing (Greptile P1 on mmnto-ai/totem#2894 named \`-R\`): the
    // generic path dropped the option alone and left its operand standing at
    // command position, so \`sudo -R /chroot gh pr merge 5\` ran unjudged.
    // \`--preserve-env=list\` is long-only with an attached operand, so the
    // generic drop already reads it right.
    operand: [
      '-a',
      '-c',
      '-u',
      '-g',
      '-p',
      '-C',
      '-D',
      '-h',
      '-R',
      '-r',
      '-t',
      '-T',
      '-U',
      '--auth-type',
      '--login-class',
      '--user',
      '--group',
      '--prompt',
      '--chdir',
      '--chroot',
      '--host',
      '--role',
      '--type',
      '--other-user',
      '--command-timeout',
    ],
    positional: 0,
    terminator: true,
    // sudo's DESCRIBE-only options: \`-l\`/\`--list\` prints what the user may
    // run, \`-v\`/\`--validate\` refreshes the timestamp, \`-V\`/\`--version\`
    // prints the version, \`-K\`/\`--remove-timestamp\` clears the credentials
    // and may not carry a command. None of them executes the operand, so
    // \`sudo -l gh pr merge 5\` merges nothing — projecting there was a FALSE
    // DENY (round-5 leg, F1).
    describe: ['-l', '--list', '-v', '--validate', '-V', '--version', '-K', '--remove-timestamp'],
  },
  env: {
    operand: ['-u', '-C', '--unset', '--chdir'],
    positional: 0,
    terminator: false,
    // \`-S\` / \`--split-string\` does NOT consume its operand: env splits that
    // string into words and PREPENDS them to the arguments that follow, then
    // runs the first word as the command. Measured on coreutils 8.32 with a
    // stub \`gh\`, every one of \`env -S 'gh pr merge 5'\`,
    // \`env -S "gh pr merge" 5\`, \`env -S gh pr merge 5\`,
    // \`env --split-string gh pr merge 5\`, \`env --split-string='gh pr merge 5'\`,
    // \`env -u X -S 'gh pr merge 5'\` and \`env -S 'A=1 gh pr merge 5'\` RUNS
    // \`gh pr merge 5\`. Consuming the operand with the option made all seven a
    // MISS — consistency in the miss direction, which is a bypass under STRICT
    // (fold 3, on the round-6 fold's own measurement). So the words take the
    // option's place and the strip reads on from them, the way \`eval\`'s
    // operand is re-read. The ATTACHED SHORT spellings join them (round-7
    // leg, H5): \`env -Sgh pr merge 5\` and \`env -S'gh pr merge 5'\` both
    // arrive as the one token \`-Sgh pr merge 5\` and run the merge too. An
    // \`=\` is NOT a separator for a short option, so \`env -S=x\` reads its
    // operand as \`=x\` — which is what env does with it.
    evaluatesOperand: ['-S', '--split-string'],
  },
  timeout: { operand: ['-k', '-s', '--kill-after', '--signal'], positional: 1, terminator: true },
  nice: { operand: ['-n', '--adjustment'], positional: 0, terminator: false },
  nohup: { operand: [], positional: 0, terminator: false },
  command: { operand: [], positional: 0, terminator: false, describe: ['-v', '-V'] },
  exec: { operand: ['-a'], positional: 0, terminator: false },
  // \`time\` here is BASH'S RESERVED WORD, not \`/usr/bin/time\`: its grammar is
  // \`time [-p] [--] pipeline\` — no option of it takes an operand, and any
  // other \`-\` token is not an option at all (bash runs \`-f\` as a command and
  // answers "command not found", merging nothing). \`time -f x gh pr merge 5\`
  // was read with GNU time's option grammar and projected a merge the shell
  // never runs — a false deny (round-5 leg, F3). The PROGRAM \`/usr/bin/time\`
  // is a path-spelled wrapper, which this closed table does not carry.
  time: { operand: [], positional: 0, terminator: true, flags: ['-p'] },
  eval: { operand: [], positional: 0, terminator: false, evaluates: true },
};

// A REDIRECTION is not the command — and it is not an ARGUMENT either
// (mmnto-ai/totem#2856 § C, widened by the round-5 leg's F5 and F12). The
// shell applies it wherever it stands and runs the rest, so
// \`> out.txt gh pr merge 5\` merges, \`gh > out.txt pr merge 5\` merges, and
// \`gh pr merge 5 > out.txt\` merges PR 5 — while reading it at the segment's
// FRONT only left \`>\` riding into argv as the merge's target, where the
// engine denied a pull request on branch "\`>\`" with a reason no one wrote.
// So: ONE strip over the WHOLE segment, ahead of every other strip and of the
// anchor test.
//
// An operator ALONE (\`>\`, \`>>\`, \`<\`, \`<>\`, \`2>\`, \`<<<\`) takes the next
// token — the file — with it; a FUSED form (\`>out.txt\`, \`2>/dev/null\`,
// \`<<<bar\`, \`2<>file\`) is one token and drops alone. A \`<<EOF\` head is a
// fused form too and drops harmlessly: the scanner blanked its BODY long
// before this, so nothing of the heredoc is left to decide here.
//
// Residue, disclosed and unreachable rather than claimed: an operator carrying
// \`|\` or \`&\` (\`>|\`, \`2>&1\`, \`>& file\`, \`<& 3\`, \`exec 3>&1 …\`) never
// arrives as ONE token, because those two characters are the tokenizer's own
// segment separators and end the token first. ALL FIVE of those run the merge
// — measured with a stub on bash 5.3, each applies its redirection and then
// runs \`gh pr merge 5\` (the \`<& 3\` form once that descriptor is open) — so
// every one of them is a fail-open miss, not text the shell ignores (round-6
// leg, G2). \`&>\` splits the same way but leaves a readable \`>\` at the front
// of the next segment, so that one IS read.
//
// WHAT MAKES A REDIRECTION REAL IS THE QUOTING OF THE OPERATOR, not of the
// word it sits in (round-7 leg, H1/H2; the round-6 rule this replaces read
// "any part of which came from inside quotes or from an escape", which is not
// the shell's). Bash decides on the operator characters alone: quote the
// FILENAME and the redirection still happens — \`>"out.txt" gh pr merge 5\`
// truncates out.txt and merges PR 5 — while quoting the OPERATOR makes the
// whole word an argument: \`gh pr merge --squash ">"out.txt\` passes the string
// \`>out.txt\` to gh and redirects nothing. So the walk records, per token, the
// INDEX of its first character that came from inside quotes or from a
// backslash escape (\`-1\` when none), and a token is stripped only when an
// operator prefix lies ENTIRELY BEFORE that index — the LONGEST prefix that
// does, which is not always the longest the patterns match (the bounded rule
// below). Under the round-6 rule every one of \`>"out.txt"\`, \`2>"err.log"\`,
// \`<<<'bar'\` and \`>"$FILE"\` rode into argv as data — a merge judged on a
// target nobody wrote, or (trailing) a branch named \`>merge.log\`. The rows
// that made the round-6 rule necessary are unchanged by this one, because
// their operator character is itself quoted or escaped: \`-b "<br>" 5\` and
// \`-b \\<br\\> 5\` both have their first literal character at index 0.
//
// The FILENAME may hold ANYTHING, whitespace included (round-8 leg, J1):
// \`>"out file.txt" gh pr merge 5\` is one token here, and while the fused
// pattern's filename class excluded whitespace that token matched neither
// pattern — so it stood in front of \`gh\`, broke the anchor, and a real
// redirection with a real merge behind it went unjudged; trailing, the same
// word rode into argv and the engine read a branch named \`>merge log.txt\`.
// The operator prefix is what decides, so the class is \`[\\s\\S]+\` and the
// first-literal index above is what still keeps a quoted OPERATOR out.
//
// The operator prefix is BOUNDED by that first literal index, and the bound
// is what picks the operator (fold 6, the round-8 corpus partitioned by
// provenance): bash extends an operator token over UNQUOTED characters only,
// so \`>">"out.txt gh pr merge 5\` is the operator \`>\` with the filename
// \`>out.txt\` — a real redirection with a real merge behind it. The greedy
// \`[<>]{1,2}\` reads \`>>\` there, a prefix that ends PAST the index, and under
// the index rule alone the word stayed, stood in front of \`gh\`, broke the
// anchor and nothing was judged: a bypass under STRICT, and the same shape in
// \`<<"<"bar\` and \`2<">"out.txt\`. So the prefix taken is the LONGEST one that
// is itself an operator and ends at or before the index (\`>>\` → \`>\`,
// \`<<<\` → \`<<\` → \`<\`, \`2<>\` → \`2<\`), which is the shell's own rule; a word
// whose first literal character is at index 0 has no such prefix and stays
// data (\`">"out.txt\` is the ARGUMENT \`>out.txt\`).
//
// Residue of both rules, disclosed and locked as rows (round-8 leg, J5,
// re-measured at fold 6 over the 3 768-case quoting corpus, where the two
// fail-open families read 0 and every divergence left is one of three kinds).
// FIRST, a quote pair that opens at index 0 of the word — \`"">out.txt\`,
// \`">">out.txt\`, \`"2">file\` — leaves no operator prefix before it, so the
// word is data here (\`>out.txt\`, \`>>out.txt\`, \`2>file\`) while bash passes
// the empty string, \`>\` or \`2\` as an ARGUMENT and applies the redirection
// that follows it. SECOND, a \`$VAR\` in a kept filename is not expanded here,
// so the word this walk names is \`>$FILE\` where bash wrote \`>varfile.txt\`.
// Both of those are confined to the argv's TEXT, and each word they keep
// names a target the engine denies. THIRD, where the quote sits INSIDE the
// operator prefix the bounded rule strips the word, and bash sometimes runs
// nothing at all behind it: an empty filename (\`>"">out.txt\`) or a file that
// does not exist (\`<"<"<out.txt\`, \`2<">"out.txt\`) fails the redirection, so
// the walk judges a merge the shell never ran — a bogus deny, not a bypass.
// All three are the deny direction, and the rows assert the projection.
const REDIRECTION_ALONE = /^[0-9]*(?:<<<|[<>]{1,2})$/;
const REDIRECTION_FUSED = /^([0-9]*(?:<<<|[<>]{1,2}))[\\s\\S]+$/;

// The length of the operator prefix BOUNDED by \`at\`, the token's first
// literal index: the longest prefix of the greedy match that is itself a
// redirection operator and ends at or before \`at\`, or \`-1\` when none is
// (\`">"out.txt\`, first literal at 0). A token with no literal character at
// all (\`at === -1\`) keeps the greedy match, as it always has.
function boundedOperatorLength(prefix, at) {
  if (at === -1) return prefix.length;
  for (let n = prefix.length < at ? prefix.length : at; n > 0; n--) {
    if (REDIRECTION_ALONE.test(prefix.slice(0, n))) return n;
  }
  return -1;
}

/**
 * The argv after EVERY \`gh pr merge\` at command position in the command —
 * one array per merge, in command order — or an empty array when there is
 * none. A compound command that merges twice yields two, and the wrapper
 * judges each (mmnto-ai/totem#2844 round 1).
 */
function ghPrMergeArgvs(rawCommand, powershell, depth) {
  // \`eval\` re-enters this function ONCE (§ B); every other caller is depth 0.
  const level = typeof depth === 'number' ? depth : 0;
  const command = blankHeredocBodies(rawCommand, powershell === true);
  // Each segment's tokens, and beside them ONE NUMBER PER TOKEN: the INDEX,
  // within the token, of the first character that came from inside quotes or
  // from a backslash escape — \`-1\` when the whole word is bare. The
  // redirection strip below is its only reader, and it needs the index rather
  // than a yes/no because the shell decides a redirection on the QUOTING OF
  // THE OPERATOR: \`>"out.txt"\` redirects (first literal character at 1, past
  // the \`>\`) while \`">"out.txt\` is the argument \`>out.txt\` (first literal
  // character at 0, on the operator itself). A yes/no answered both with
  // "data" and let a real redirection ride into argv (round-7 leg, H1/H2); it
  // answered \`-b "<br>" 5\` correctly, and so does the index (round-6 leg,
  // G1). The numbers ride in a PARALLEL array so every reader of a token stays
  // a reader of a plain string. It annotates the walk's output; it changes no
  // grammar.
  const segments = [];
  const literalAts = [];
  let current = [];
  let currentLiteralAt = [];
  let token = '';
  let hasToken = false;
  let tokenLiteralAt = -1;
  let i = 0;
  /** The next character appended to this token is literal: mark the first. */
  const markLiteral = () => {
    if (tokenLiteralAt === -1) tokenLiteralAt = token.length;
  };
  const endToken = () => {
    if (hasToken) {
      current.push(token);
      currentLiteralAt.push(tokenLiteralAt);
      token = '';
      hasToken = false;
      tokenLiteralAt = -1;
    }
  };
  const endSegment = () => {
    endToken();
    segments.push(current);
    literalAts.push(currentLiteralAt);
    current = [];
    currentLiteralAt = [];
  };
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      hasToken = true;
      markLiteral();
      i++;
      while (i < command.length && command[i] !== "'") {
        token += command[i];
        i++;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      hasToken = true;
      markLiteral();
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\\\' && i + 1 < command.length) {
          token += command[i + 1];
          i += 2;
          continue;
        }
        token += command[i];
        i++;
      }
      i++;
      continue;
    }
    // A parameter expansion is ONE word: without this, \`\${PR}\` splits on its
    // braces and the unresolved-target evidence line reads just "$"
    // (mmnto-ai/totem#2800 round 2, F10). A \`$( … )\` is deliberately NOT
    // swallowed the same way — a real \`gh pr merge\` inside a command
    // substitution has to keep firing, so its parens stay separators.
    if (ch === '$' && command[i + 1] === '{') {
      const close = command.indexOf('}', i + 2);
      const end = close === -1 ? command.length : close + 1;
      token += command.slice(i, end);
      hasToken = true;
      i = end;
      continue;
    }
    if (ch === ' ' || ch === '\\t' || ch === '\\r') {
      endToken();
      i++;
      continue;
    }
    // A BACKTICK command substitution opens a segment of its own
    // (mmnto-ai/totem#2856 § C): its operand is a command the shell runs, so a
    // merge inside one has to be judged, exactly as a merge inside \`$( … )\`
    // is. The backtick is kept as a TOKEN, the way \`$(\` leaves its \`$\` behind:
    // without it a merge whose TARGET is a backtick substitution would lose
    // that target and fall back to the current branch — judging a pull request
    // the command never named. One inside a heredoc body is already blanked,
    // and that is correct — a body is data. One inside DOUBLE quotes never
    // reaches here either, because the quote arm above swallows the whole
    // string as one token — and that one is NOT data: bash executes a backtick
    // pair and a \`$( … )\` inside double quotes, so \`echo "\`gh pr merge 5\`"\`
    // merges PR 5 unjudged. A disclosed fail-open, filed as
    // mmnto-ai/totem#2893 (round-5 leg, F4).
    // POWERSHELL'S LINE CONTINUATION is a trailing BACKTICK — the twin of the
    // backslash-newline arm below AT A WORD BOUNDARY, and the reason this one
    // has to be read first: in ps mode the backtick and the newline after it
    // are consumed and the next line's words continue the command, so
    // \`gh pr merge <backtick><LF>5\` is \`gh pr merge 5\`. Read as the segment
    // separator it is in BASH, that command projected the backtick itself as
    // the merge's target (\`unresolvedTarget\`, a deny on a target nobody wrote
    // under strict) while the real target sat in the next segment and merged
    // unjudged (round-6 leg, G3). Bash keeps the separator: there a backtick
    // opens a command substitution, whatever follows it.
    //
    // INSIDE A WORD the two shells part company (round-7 leg, H4). Bash's
    // backslash-newline really joins the halves — \`me\\<LF>rge\` is \`merge\`
    // — while PowerShell's backtick is its ESCAPE character and
    // \`merg<backtick><LF>e\` is the single argument \`merg<LF>e\`, which is not
    // \`merge\` and runs nothing. So the join applies only where no token is
    // open; inside one, the escaped newline lands IN the token, the anchor
    // fails to match, and nothing is projected — which is what PowerShell
    // does. Joining there projected a merge the shell never runs.
    if (
      powershell === true &&
      ch === '\`' &&
      (command[i + 1] === '\\n' || (command[i + 1] === '\\r' && command[i + 2] === '\\n'))
    ) {
      if (hasToken) {
        markLiteral();
        token += '\\n';
      }
      i += command[i + 1] === '\\r' ? 3 : 2;
      continue;
    }
    if (ch === '\`') {
      endToken();
      current.push('\`');
      currentLiteralAt.push(-1);
      endSegment();
      i++;
      continue;
    }
    if (
      ch === ';' ||
      ch === '&' ||
      ch === '|' ||
      ch === '\\n' ||
      ch === '(' ||
      ch === ')' ||
      ch === '{' ||
      ch === '}'
    ) {
      endSegment();
      i++;
      continue;
    }
    // A line continuation joins the two halves of ONE word (\`gh \\<LF>pr\` is
    // \`ghpr\` to the shell, and \`gh \\<LF>pr merge\` keeps \`gh\` at the front of
    // the segment): drop both characters and keep tokenizing (round 3, F6).
    if (ch === '\\\\' && (command[i + 1] === '\\n' || (command[i + 1] === '\\r' && command[i + 2] === '\\n'))) {
      i += command[i + 1] === '\\r' ? 3 : 2;
      continue;
    }
    if (ch === '\\\\' && i + 1 < command.length) {
      markLiteral();
      token += command[i + 1];
      hasToken = true;
      i += 2;
      continue;
    }
    token += ch;
    hasToken = true;
    i++;
  }
  endSegment();

  const found = [];
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const literalAt = literalAts[s];
    // FIRST, over the WHOLE segment: drop every redirection (the two patterns
    // above). It runs before the strip below and before the anchor test, so a
    // redirection in front of the command does not hide it, one in the middle
    // does not break the anchor, and a trailing one never rides into argv.
    // The OPERATOR's own quoting decides, as it does in the shell: strip only
    // when an operator prefix lies entirely before the token's first literal
    // character (round-7 leg, H1/H2), and the prefix taken is the longest one
    // that does — \`boundedOperatorLength\` above, fold 6.
    let tokens = [];
    for (let r = 0; r < segment.length; r++) {
      const word = segment[r];
      const at = literalAt[r];
      if (REDIRECTION_ALONE.test(word) && (at === -1 || word.length <= at)) {
        // The operator and the file it names, both gone — however that file
        // is spelled: \`> "out.txt"\` is as real a redirection as \`> out.txt\`.
        r += 1;
        continue;
      }
      const fused = REDIRECTION_FUSED.exec(word);
      if (fused !== null && boundedOperatorLength(fused[1], at) !== -1) continue;
      tokens.push(word);
    }
    // Then strip everything at the segment's front that is NOT the command, in
    // any run: a transparent wrapper with its options (the table above), a
    // command-position word, an assignment prefix. The loop re-runs after each
    // one, so \`env -u X A=1 gh …\` and \`sudo -u root timeout 30 gh …\` both
    // resolve to the same anchor test.
    let stripping = true;
    while (stripping && tokens.length > 0) {
      const head = tokens[0];
      const wrapper = Object.prototype.hasOwnProperty.call(TRANSPARENT_WRAPPERS, head)
        ? TRANSPARENT_WRAPPERS[head]
        : null;
      if (wrapper === null) {
        if (COMMAND_POSITION_WORDS.indexOf(head) !== -1 || isAssignmentPrefix(head)) {
          tokens = tokens.slice(1);
          continue;
        }
        break;
      }
      tokens = tokens.slice(1);
      // \`eval\` hands the shell a STRING: join what is left with one space and
      // re-tokenize it ONCE. That inner projection IS this segment's, and the
      // depth bound keeps \`eval "eval \\"gh pr merge 5\\""\` a disclosed miss.
      if (wrapper.evaluates === true) {
        if (level < 1 && tokens.length > 0) {
          const inner = ghPrMergeArgvs(tokens.join(' '), powershell, level + 1);
          for (let k = 0; k < inner.length; k++) {
            found.push(inner[k]);
          }
        }
        tokens = [];
        break;
      }
      while (tokens.length > 0 && tokens[0].charAt(0) === '-' && tokens[0].length > 1) {
        const opt = tokens[0];
        if (opt === '--') {
          tokens = tokens.slice(1);
          if (wrapper.terminator === true) break;
          continue;
        }
        if (wrapper.describe !== undefined && wrapper.describe.indexOf(opt) !== -1) {
          // \`command -v gh …\` prints a path and \`sudo -l gh …\` prints a
          // policy line; each runs nothing, so there is nothing to judge and
          // nothing to project.
          tokens = [];
          stripping = false;
          break;
        }
        if (wrapper.flags !== undefined && wrapper.flags.indexOf(opt) === -1) {
          // A \`-\` token that is not one of this word's OWN options: the shell
          // has no command to run here (\`time -f x gh pr merge 5\` makes bash
          // try to run \`-f\`), so the segment ends with no projection.
          tokens = [];
          stripping = false;
          break;
        }
        if (wrapper.evaluatesOperand !== undefined) {
          // Where the operand is: a LONG option carries an attached one after
          // an \`=\` (\`--split-string='gh pr merge 5'\`), a SHORT one carries it
          // with no separator at all (\`-Sgh pr merge 5\`, and
          // \`-S'gh pr merge 5'\`, which the quote arm joins into that same
          // token), and otherwise it is the NEXT token. An \`=\` is not a
          // separator for a short option — \`env -S=x\` hands env the operand
          // \`=x\` — so the split is long-only (round-7 leg, H5).
          //
          // …and when an \`=\` FOLLOWS the short option's letter this arm does
          // not apply at all: the token falls through to be dropped as a flag
          // of the word, which is the route that reads both spellings right
          // (round-8 leg, J2). \`env -S=X gh pr merge 5\` is env splitting the
          // operand \`=X\` into one word, an assignment with an EMPTY NAME, so
          // the command is \`gh pr merge 5\` and the merge RUNS (measured,
          // coreutils 8.32); reading \`=X\` as the operand here put it at the
          // front of the strip, where it is neither an assignment this walk
          // accepts nor a command, and the merge behind it went unjudged.
          // \`env -S='gh pr merge 5'\` is the same rule the other way: env's
          // words are \`=gh\`, \`pr\`, \`merge\`, \`5\`, the command is coreutils
          // \`pr\` and no merge runs — and none is projected.
          let name = opt;
          let attached = null;
          if (opt.charAt(1) === '-') {
            const eq = opt.indexOf('=');
            if (eq !== -1) {
              name = opt.slice(0, eq);
              attached = opt.slice(eq + 1);
            }
          } else if (opt.charAt(2) !== '=') {
            name = opt.slice(0, 2);
            if (opt.length > 2) attached = opt.slice(2);
          }
          if (wrapper.evaluatesOperand.indexOf(name) !== -1) {
            // The operand is a COMMAND STRING, not a value to skip past: env
            // splits it into words and prepends them to what follows. Split
            // on whitespace — env's own rule — put the words where the option
            // stood, and let the strip read on, so the assignment strip runs
            // for \`env -S 'A=1 gh pr merge 5'\` and the anchor sees \`gh\`.
            const operandText = attached === null ? (tokens.length > 1 ? tokens[1] : '') : attached;
            const rest = tokens.slice(attached === null ? 2 : 1);
            const words = operandText.split(/\\s+/);
            tokens = [];
            for (let w = 0; w < words.length; w++) {
              if (words[w] !== '') tokens.push(words[w]);
            }
            tokens = tokens.concat(rest);
            continue;
          }
        }
        if (wrapper.operand.indexOf(opt) !== -1) {
          tokens = tokens.slice(2);
          continue;
        }
        tokens = tokens.slice(1);
      }
      for (let p = 0; stripping && p < wrapper.positional && tokens.length > 0; p++) {
        tokens = tokens.slice(1);
      }
    }
    if (
      tokens.length >= 3 &&
      isGhExecutable(tokens[0]) &&
      tokens[1] === 'pr' &&
      tokens[2] === 'merge'
    ) {
      found.push(tokens.slice(3));
    }
  }
  return found;
}

// ─── The one budget for the whole run (mmnto-ai/totem#2856 § D) ─────────
// The instant this hook must be finished by. It is set as the FIRST thing the
// entry does — before stdin is read and before any projection — so that EVERY
// spawn this process makes, the projection's git reads included, is bounded by
// it. Before this PR the deadline came into being only at the evaluation loop,
// and the projection ran up to three 10-second git reads per merge ahead of
// it: a hung git on a multi-merge envelope reached the HOST's hook timeout,
// where a killed hook's exit code is never applied — a fail-OPEN on a gate
// whose posture is fail-closed (round 3, F3).
//
// Zero until the entry sets it, which reads as "already spent": an exported
// \`projectMergeReady\` (the seam below) therefore does no git reads at all.
let deadline = 0;

/** The default budget, and the ceiling \`--budget-ms\` is clamped to. */
const DEFAULT_BUDGET_MS = 30000;

/**
 * The budget a \`--budget-ms <n>\` argument asks for, clamped to
 * [1000, 30000]. The clamp is SILENT and one-directional by design: the
 * argument exists so a test can shorten the window, and a malformed or
 * oversized value must never WIDEN it (Tenet 4 keeps the safe direction). The
 * value it settles on is echoed in the budget line when the arm fires.
 */
function clampBudgetMs(raw) {
  const n = parseInt(String(raw), 10);
  if (!isFinite(n) || n > DEFAULT_BUDGET_MS) return DEFAULT_BUDGET_MS;
  if (n < 1000) return 1000;
  return n;
}

/**
 * Run git read-only and return trimmed stdout, or '' when it did not answer.
 * Bounded by what is LEFT of the budget (never more than 10 s, never less than
 * a 250 ms floor), and it does not spawn at all once the budget is spent.
 */
function gitRead(args) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return '';
  const res = spawnSync('git', args, {
    encoding: 'utf-8',
    timeout: Math.max(250, Math.min(10000, remaining)),
  });
  if (res.error || typeof res.status !== 'number' || res.status !== 0) return '';
  return (res.stdout || '').trim();
}

/** \`owner/name\` out of any git remote URL shape (ssh, https, with or without .git). */
function repoFromRemote(url) {
  const m = /[:/]([^/:]+)\\/([^/]+?)(?:\\.git)?$/.exec(url.trim());
  return m ? m[1] + '/' + m[2] : '';
}

// The flags of \`gh pr merge\` that CONSUME the next argv element — without this
// list, \`gh pr merge -b "some branch"\` would read the body as the PR target.
const GH_MERGE_VALUE_FLAGS = [
  '-R',
  '--repo',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-t',
  '--subject',
  '--match-head-commit',
  '--author-email',
];

/**
 * Project { repo, pr, branch?, headSha? } from the argv after \`gh pr merge\`:
 * a number, a PR URL, a branch, \`-R/--repo\`. With no argument at all, gh
 * merges the PR for the CURRENT branch — so the payload carries pr: null plus
 * that branch, exactly as the gate's payload contract allows.
 */
function projectMergeReady(argv) {
  let repo = '';
  let pr = null;
  let branch = '';
  let positional = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    if (arg.slice(0, 2) === '--' && eq > 2) {
      if (arg.slice(0, eq) === '--repo') repo = arg.slice(eq + 1);
      continue;
    }
    if (GH_MERGE_VALUE_FLAGS.indexOf(arg) !== -1) {
      if (arg === '-R' || arg === '--repo') repo = argv[i + 1] || '';
      i++;
      continue;
    }
    if (arg.charAt(0) === '-') continue;
    if (positional === null) positional = arg;
  }

  // An UNEXPANDED shell variable (\`gh pr merge $PR\`) is not a target this
  // projection can know (mmnto-ai/totem#2800 fold F13): the shell expands it
  // after the hook has already decided. Reading it as a branch name would judge
  // the wrong PR — or none — so it rides as \`unresolvedTarget\`, which the
  // engine treats as unevaluable (strict denies, pilot warns).
  let unresolvedTarget = '';
  if (positional !== null && /[$\`]/.test(positional)) {
    unresolvedTarget = positional;
    positional = null;
  }

  if (positional !== null) {
    const url = /^https?:\\/\\/[^/]+\\/([^/]+)\\/([^/]+)\\/pull\\/(\\d+)/.exec(positional);
    if (url) {
      if (repo === '') repo = url[1] + '/' + url[2];
      pr = parseInt(url[3], 10);
    } else if (/^\\d+$/.test(positional)) {
      pr = parseInt(positional, 10);
    } else {
      branch = positional;
    }
  }

  // gh itself honours GH_REPO before the git remote; mirror that order so the
  // gate reads the SAME pull request the command would merge.
  if (repo === '') repo = (process.env.GH_REPO || '').trim();
  if (repo === '') repo = repoFromRemote(gitRead(['config', '--get', 'remote.origin.url']));
  // The current-branch fallback is for a command that named NO target. An
  // unresolved one named a target we could not read, so it must not fall back.
  if (pr === null && branch === '' && unresolvedTarget === '') {
    branch = gitRead(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  const headSha = gitRead(['rev-parse', 'HEAD']);
  const out = { repo: repo, pr: pr };
  if (branch !== '') out.branch = branch;
  if (unresolvedTarget !== '') out.unresolvedTarget = unresolvedTarget;
  if (/^[0-9a-f]{40}$/i.test(headSha)) out.headSha = headSha;
  return out;
}

// ─── The export seam (mmnto-ai/totem#2856 § E) ─────────────────────────
// Everything above is pure and side-effect free; everything below is the
// hook's ENTRY — it reads argv and stdin and exits the process. A \`require\`
// of this file (the suite's in-process driver for the strip table, the
// executable test, the budget clamp and the scanner-parity lock) must run
// NEITHER, so the entry runs only when this file is the main module. The
// module-scope \`return\` is CommonJS's own early exit, and it sits AFTER every
// module-level binding above so the exported functions are all initialized.
//
// Nothing else changes when the file runs as a hook: \`require.main\` is this
// module, the \`return\` is not taken, and the entry below is the same code it
// has always been. One consequence worth naming: an exported
// \`projectMergeReady\` runs with no budget set (see \`deadline\`), so it does no
// git reads — the projection's shape is what the seam is for, the git facts
// are the entry's.
if (require.main !== module) {
  module.exports = {
    blankHeredocBodies: blankHeredocBodies,
    clampBudgetMs: clampBudgetMs,
    findHeredocSpans: findHeredocSpans,
    ghPrMergeArgvs: ghPrMergeArgvs,
    isGhExecutable: isGhExecutable,
    projectMergeReady: projectMergeReady,
  };
  return;
}

// ─── Parse baked args (--event <name>, optional --pilot / --strict) ─────
// The tier is read ONLY from argv (baked into the installed command at
// install time). There is NO env-var override: env sourcing would be a
// fail-open (any shell with TOTEM_GATE_TIER=pilot could silently downgrade
// enforcement). Default (no flag) = strict, so a default install is
// environment-immune; --pilot is an explicit install-time opt-in.
//
// \`--budget-ms <n>\` is the one argument the install line never writes: it
// exists so a test can SHORTEN the run's budget, and it is clamped so it can
// only ever shorten it (§ D). An env var was the alternative and was ruled
// out for the same reason the tier is argv-only — any shell could set it.
// BOTH spellings parse: \`--budget-ms 1500\` and \`--budget-ms=1500\`. The
// attached form used to fall through as an unknown argument and silently left
// the 30 000 ms default standing — a WIDENING on a caller that wrote the
// argument to shorten the window (round-5 leg, F7). A repeated flag is
// last-wins, and no spelling of it can ever exceed the default, because every
// value goes through the same clamp.
const argv = process.argv.slice(2);
let event = '';
let tier = 'strict';
let budgetMs = DEFAULT_BUDGET_MS;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--event') {
    event = argv[i + 1] || '';
    i++;
  } else if (argv[i] === '--pilot') {
    tier = 'pilot';
  } else if (argv[i] === '--strict') {
    tier = 'strict';
  } else if (argv[i] === '--budget-ms') {
    budgetMs = clampBudgetMs(argv[i + 1]);
    i++;
  } else if (argv[i].slice(0, 12) === '--budget-ms=') {
    budgetMs = clampBudgetMs(argv[i].slice(12));
  }
}

// The FIRST thing the entry does after reading its own arguments: from here on
// every spawn — the projection's git reads and the evaluation loop's gate
// checks alike — is bounded by one deadline, so the wrapper always terminates
// within the budget plus one 1 000 ms floor with its OWN exit code.
deadline = Date.now() + budgetMs;

// …and the READ of the envelope is inside it too (round-5 leg, F6). The budget
// used to start counting for everything the hook did AFTER the envelope had
// arrived; arriving itself was unbounded. A host that writes the envelope and
// holds the pipe open, or hands this hook a stdin that never ends, left it
// waiting with no deadline of its own until the HOST's own timeout killed it —
// and a killed hook's exit code is never applied, which is a fail-OPEN on a
// gate whose posture is fail-closed. Exactly the class § D cured for the
// projection's git reads, one step earlier in the run.
//
// The timer is cleared by the \`end\` handler below BEFORE anything is
// evaluated, so a normal run — every run where stdin closes — never sees it.
const stdinBudgetTimer = setTimeout(
  () => {
    process.stderr.write(
      '[totem gate-wrapper] the ' +
        budgetMs +
        ' ms budget was spent before the envelope arrived on stdin — blocking (fail-closed).\\n',
    );
    process.exit(2);
  },
  Math.max(0, deadline - Date.now()),
);

// Read the PreToolUse stdin envelope.
let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  clearTimeout(stdinBudgetTimer);
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

  // ─── PER-EVENT PAYLOAD PROJECTION ─────────────────────────────────────
  // Each gate reads a DIFFERENT slice of the PreToolUse envelope, so the
  // projection branches on the baked --event. Every branch owns its own
  // NOT-APPLICABLE test — the point past which a gate genuinely applies and
  // any evaluation failure must fail CLOSED.
  //
  //   event            | applies when                     | payload
  //   -----------------|----------------------------------|---------------------------
  //   freeze-check     | tool_input.subsystem is a         | { subsystem }
  //                    | non-empty string                  |
  //   transport-shield | tool_name is Bash or PowerShell   | { tool, command, platform }
  //                    | AND tool_input.command is a       |
  //                    | non-empty string                  |
  //   merge-ready      | tool_name is Bash or PowerShell   | { repo, pr, branch?, headSha? }
  //                    | AND the command runs \`gh pr merge\`|
  //                    | at COMMAND POSITION               |
  //   (anything else)  | — no projection → fail closed     | —
  //
  // A projection yields ONE payload per gate evaluation — and merge-ready can
  // yield several for one envelope (one per \`gh pr merge\` at command
  // position), each judged on its own below.
  let payloads = [];

  if (event === 'freeze-check') {
    // THE EMPTY-SUBSYSTEM GUARDRAIL: freeze-check's predicate is on a DECLARED
    // subsystem. A normal Edit/Write carries tool_input.file_path (a path), NOT
    // a subsystem. With no declared subsystem, NO GATE APPLIES → pass through
    // (exit 0). Do NOT shell out — a blanket fail-closed here would block every
    // ordinary edit.
    const declaredSubsystem =
      typeof input.subsystem === 'string' && input.subsystem.trim() !== ''
        ? input.subsystem.trim()
        : '';
    if (declaredSubsystem === '') {
      process.exit(0);
    }
    payloads = [JSON.stringify({ subsystem: declaredSubsystem })];
  } else if (event === 'transport-shield') {
    // transport-shield's predicate is on a SHELL COMMAND. Anything that is not
    // a Bash/PowerShell invocation carrying a command string is NOT an
    // applicable gate → pass through (exit 0), mirroring the guardrail above.
    // The installed matcher is the CLI's own, so a foreign tool_name here means
    // a hand-edited settings entry, not a shape to judge.
    const tool = parsed.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    if (typeof input.command !== 'string' || input.command.trim() === '') {
      process.exit(0);
    }
    payloads = [
      JSON.stringify({
        tool: tool,
        command: input.command,
        platform: process.platform,
      }),
    ];
  } else if (event === 'merge-ready') {
    // merge-ready's predicate is on a PULL REQUEST about to be merged. The gate
    // installs under Bash|PowerShell, so this branch sees every shell command:
    // anything that is not \`gh pr merge\` at COMMAND POSITION is NOT an
    // applicable gate → pass through (exit 0) WITHOUT spawning.
    const tool = parsed.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    if (typeof input.command !== 'string' || input.command.trim() === '') {
      process.exit(0);
    }
    const merges = ghPrMergeArgvs(input.command, tool === 'PowerShell');
    if (merges.length === 0) {
      process.exit(0);
    }
    // One payload per merge: \`gh pr merge 7; gh pr merge 8\` is judged twice,
    // each PR against its own facts (mmnto-ai/totem#2844 round 1).
    for (let m = 0; m < merges.length; m++) {
      payloads.push(JSON.stringify(projectMergeReady(merges[m])));
    }
  } else {
    // A baked --event this wrapper cannot project is an APPLICABLE gate it
    // cannot evaluate → fail closed (ADR-109). Reinstalling refreshes the
    // wrapper (\`totem gate install\` drift-repairs the bounded region).
    process.stderr.write(
      '[totem gate-wrapper] no payload projection for event "' + event + '"; failing closed.\\n',
    );
    process.exit(2);
  }

  // No payload past the projection is not an applicable gate that passed — it
  // is a branch above that forgot to project, and before the loop that shape
  // fail-closed through the child's non-zero exit. Keep the default closed
  // (round 2, F7).
  if (payloads.length === 0) {
    process.stderr.write(
      '[totem gate-wrapper] event "' + event + '" projected no payload; failing closed.\\n',
    );
    process.exit(2);
  }

  // Resolve the Totem CLI: the repo-local pinned dist FIRST (a global \`totem\`
  // may be stale and missing deps — the known repo gotcha; the
  // pinned-beats-ambient ordering of ADR-072 § 2, Tenet 14), then a \`totem\` on
  // PATH as a FALLBACK (mmnto-ai/totem#2822 — the bootstrap self-block above).
  // Invoke node on whichever dist entry resolved.
  //
  // FAIL-CLOSED when NEITHER arm resolves: we are PAST the per-event
  // applicability guardrail (freeze-check: a declared subsystem;
  // transport-shield: a Bash or PowerShell command), so a gate genuinely
  // APPLIES here. Neither gate has a commit-time hard floor (unlike
  // PreWriteShield, whose fail-soft is backed by \`totem-lint\` at commit), so an
  // APPLICABLE gate that cannot be evaluated for ANY reason (no CLI anywhere OR
  // a broken source) must fail closed — not silently allow (guardrail rule +
  // Tenet 4 fail-closed). Fail-SOFT (exit 0) is reserved for genuinely
  // NOT-APPLICABLE inputs (unparseable/non-object envelope, no declared
  // subsystem, no shell command), all of which already returned above.
  const localCliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  let cliPath = '';
  // Which arm resolved — 'repo-local' or 'PATH' — for the provenance line the
  // fail-closed arms below disclose. Empty until one resolves.
  let arm = '';
  // The PATH arm's non-resolvable rendering of what it found (basenames only).
  let cliDisplay = '';
  if (existsSync(localCliPath)) {
    cliPath = localCliPath;
    arm = 'repo-local';
  } else {
    const fromPath = resolveCliFromPath();
    if (fromPath) {
      cliPath = fromPath.entry;
      cliDisplay = fromPath.display;
      arm = 'PATH';
    }
  }

  if (!cliPath) {
    // The exits named here must be exits the gate does NOT block: "reinstall
    // totem" and \`totem eject\` are Bash commands a Bash|PowerShell gate blocks
    // with this very message (mmnto-ai/totem#2822). They are ORDERED: the
    // editor path still needs the bootstrap before the gate can be reinstalled.
    process.stderr.write(
      '[totem gate] ' +
        event +
        ' applies but no totem CLI is resolvable ' +
        '(repo-local node_modules/@mmnto/cli/dist/index.js absent; no totem on PATH); ' +
        'failing closed. Exits: bootstrap from a terminal OUTSIDE the harness ' +
        '(pnpm install and pnpm build, or npm i -g @mmnto/cli); or remove this ' +
        "gate's entry from .claude/settings.json with the editor, bootstrap, " +
        'then re-run totem gate install ' +
        event +
        '.\\n',
    );
    process.exit(2);
  }

  // The payload rides on the child's STDIN (\`--payload -\`), never argv: a Bash
  // command can run to tens of kilobytes and win32 caps a command line at
  // 32,767 characters — an argv payload past it fails the spawn with
  // ENAMETOOLONG and would land in the fail-closed arm below with nothing
  // broken (mmnto-ai/totem#2799, pass 3).
  // The baked tier rides along (mmnto-ai/totem#2800 R1): the ENGINE owns the
  // strict/pilot split for a gate's UNEVALUABLE class (a read that could not
  // derive), while the disposition → exit map below stays the wrapper's. A gate
  // that ignores the tier — freeze-check — still fails closed at both.
  //
  // \`--tier\` is forwarded ONLY when it is NOT the default (fold F3): a CLI at
  // or below 2.2.1 has no such option and would exit non-zero with
  // "unknown option", which is the fail-closed arm — and on a
  // \`Bash|PowerShell\` gate that re-creates the mmnto-ai/totem#2822 bootstrap
  // self-block through the PATH arm. \`strict\` IS the engine's default, so a
  // strict wrapper stays runnable against a 2.2.x CLI; a \`--pilot\` install
  // passes the flag and needs a CLI at 2.3.0 or newer (the install-time
  // disclosure says so).
  const checkArgs = [cliPath, 'gate', 'check', '--event', event];
  if (tier !== 'strict') {
    checkArgs.push('--tier', tier);
  }
  checkArgs.push('--payload', '-');

  // Provenance for the PATH fallback arm (mmnto-ai/totem#2822): a CLI older
  // than 2.2.0 has no \`gate check --payload -\` and lands in the fail-closed
  // arms below (unknown option → non-zero exit, or nothing on stdout). The
  // BEHAVIOUR is unchanged — exit 2 either way — the line only names WHICH CLI
  // evaluated and how to update it. Empty on the repo-local arm. It prints the
  // basename rendering, never the absolute entry: this is transcript-bound text.
  // The floor NAMED here is the floor this wrapper actually needs: a strict
  // wrapper sends no \`--tier\`, so 2.2.0 (the \`--payload -\` cut) still answers
  // it; a pilot wrapper sends \`--tier pilot\`, which only 2.3.0 and newer parse
  // (mmnto-ai/totem#2800 fold F3).
  const armNote =
    arm === 'PATH'
      ? 'evaluated by the PATH CLI at ' +
        cliDisplay +
        (tier === 'strict'
          ? "; a CLI older than 2.2.0 lacks 'gate check --payload -' — "
          : "; a CLI older than 2.3.0 lacks 'gate check --tier' (this entry is baked --pilot) — ") +
        'update it: npm i -g @mmnto/cli@latest\\n'
      : '';

  // ─── One evaluation per projected payload ─────────────────────────────
  // freeze-check and transport-shield project exactly one. merge-ready projects
  // one per \`gh pr merge\` at command position, so \`gh pr merge 7; gh pr merge 8\`
  // is judged TWICE, each PR on its own facts — judging only the first let the
  // shell run the second unjudged (mmnto-ai/totem#2844 round 1). The first
  // strict deny, and every fail-closed arm, EXITS at once; a warn, and a deny
  // under --pilot, print their line and let the NEXT payload be judged, so every
  // merge in the envelope gets its stderr line; exit 0 only once every payload
  // has allowed or warned.
  //
  // ONE budget across every payload, not one per payload (round 2, F5): the
  // hook host kills a PreToolUse hook at its own default budget (60 s on both
  // Claude Code and Gemini, the same figure the session-hook templates above
  // cut their legs against) and a killed hook's exit code is never applied — a
  // fail-OPEN on a gate whose posture is fail-closed. The budget is set at the
  // ENTRY (see \`deadline\` above), so it now covers the projection's git reads
  // too (mmnto-ai/totem#2856 § D); before that it began here, and a hung git
  // ahead of it could run the hook into the host's kill through up to three
  // 10-second reads per merge (round 3, F3).
  //
  // Two arms keep the whole run inside it: a payload whose spawn would start
  // past the deadline gets the fail-closed line below INSTEAD of a spawn, and
  // a spawn that starts inside it still gets the one-second floor (round 3,
  // F2) and times out into the evaluation-failed arm. Either way the wrapper
  // exits with its OWN code, inside the budget plus one floor.
  for (let p = 0; p < payloads.length; p++) {
    if (Date.now() >= deadline) {
      process.stderr.write(
        '[totem gate-wrapper] the ' +
          budgetMs +
          ' ms budget was spent before gate "' +
          event +
          "\\" could be evaluated (the projection's git reads did not answer in time) — blocking (fail-closed).\\n",
      );
      process.exit(2);
    }
    const result = spawnSync(process.execPath, checkArgs, {
      encoding: 'utf-8',
      timeout: Math.max(1000, deadline - Date.now()),
      input: payloads[p],
    });

    // ─── The child's stderr IS a gate surface (fold F1) ──────────────────
    // merge-ready's audited-override line, its zero-checks fact and every
    // "could not derive" line are written by the ENGINE to stderr. Passing them
    // through verbatim in EVERY arm — allow included — is what puts them in the
    // transcript; printing them only on failure hid the override's audit trail,
    // the one line that must never be silent.
    if (typeof result.stderr === 'string' && result.stderr !== '') {
      process.stderr.write(result.stderr);
    }

    // ─── FAIL-CLOSED ────────────────────────────────────────────────────
    // A gate genuinely applies (the per-event projection above found its input:
    // a declared subsystem, or a Bash/PowerShell command) and the evaluation
    // itself failed (non-zero exit: corrupt freeze.json, an invalid payload,
    // spawn error, etc.). Never silently allow when an applicable gate's source
    // is broken → exit 2. (Not-applicable envelopes already returned exit 0
    // above, so this only blocks when the gate's input was actually present.)
    if (result.error || typeof result.status !== 'number' || result.status !== 0) {
      process.stderr.write(
        '[totem gate-wrapper] gate "' +
          event +
          '" evaluation failed (source broken or unavailable) — blocking (fail-closed).\\n' +
          // The child's stderr already went through verbatim above (fold F1);
          // only a spawn-level error (no child, so no stderr) is added here.
          (result.error ? String(result.error.message || result.error) + '\\n' : '') +
          armNote,
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
        '[totem gate-wrapper] gate "' + event + '" emitted unparseable verdict — blocking (fail-closed).\\n' + armNote,
      );
      process.exit(2);
    }

    // ─── Disposition → host exit code (branch ONLY on disposition) ───────
    const disposition = verdict && typeof verdict.disposition === 'string' ? verdict.disposition : '';
    // reason/provenance are OPAQUE stderr passthrough — never parsed for control flow.
    const detail =
      (verdict && verdict.reason ? verdict.reason : '') +
      (verdict && verdict.provenance ? ' [' + JSON.stringify(verdict.provenance) + ']' : '');

    if (disposition === 'allow') {
      // Deliberately SILENT on the PATH arm too: a provenance line on every
      // allowed Bash command would be transcript noise on the common path, and
      // the operator already learned the property at install time (the
      // \`gate install\` disclosure) — stderr here is reserved for what blocks.
      continue;
    }
    if (disposition === 'warn') {
      process.stderr.write('[totem gate-wrapper] ' + event + ' (warn): ' + detail + '\\n');
      continue;
    }
    if (disposition === 'deny') {
      process.stderr.write('[totem gate-wrapper] ' + event + ' (deny): ' + detail + '\\n');
      if (tier !== 'pilot') {
        process.exit(2);
      }
      continue;
    }

    // Unknown disposition from an applicable gate — fail-closed. The provenance
    // note rides here too, so all four not-evaluable causes in the exit-code
    // contract above disclose which arm evaluated.
    process.stderr.write(
      '[totem gate-wrapper] gate "' + event + '" returned unknown disposition "' + disposition + '" — blocking (fail-closed).\\n' + armNote,
    );
    process.exit(2);
  }
  process.exit(0);
});
${TOTEM_FILE_END}
`;

// The PreToolUse entry constant for the freeze-check gate — the EXEMPLAR of the
// installed shape, not a template every gate is stamped from. The \`--event\` is
// baked into the command string per-entry (one wrapper, N gates = N entries
// pointing at the same script with different --event args).
//
// SOURCE OF TRUTH for the MATCHER is the core gate registry
// (mmnto-ai/totem#2799): \`knownGates()\` carries each gate's own matcher, the
// caller resolves it, and \`gateEntry()\` writes THAT — freeze-check under
// \`Write|Edit\` (so the wrapper sees every write; the empty-subsystem guardrail
// is what keeps ordinary edits passing through), transport-shield under
// \`Bash|PowerShell\`. This constant stays the \`Write|Edit\` freeze-check
// exemplar and is never consulted for another gate's matcher.
//
// SOURCE OF TRUTH for the ACTUAL installed command is
// gate-install.ts \`gateCommand(event, tier)\` — it builds the per-gate,
// per-tier string at install time. This constant supplies ONLY the canonical
// hook \`type\` (the one field \`gateEntry()\` still reads); its \`matcher\` and
// \`command\` here mirror the DEFAULT freeze-check install (at the default
// \`--strict\` tier) so a reader sees exactly what a default
// \`totem gate install freeze-check\` bakes, not a tier-less never-installed
// string. Installed into committed \`.claude/settings.json\` (team-level
// governance — gate opt-in is repo policy, Tenet 12).
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

// The Gemini BeforeTool guard ships as `.cjs` (mmnto-ai/totem#2481). Its body is
// CommonJS (top-level `require('child_process')`); a consumer `package.json` with
// `"type": "module"` makes Node resolve a bare `.js` as ESM, so the guard throws
// `ReferenceError: require is not defined` before it reads the tool call — and
// Gemini CLI treats the crash as a non-fatal warning, so the write-time guard
// fail-opens SILENTLY. The `.cjs` extension is load-bearing (CommonJS regardless of
// the consumer's package `type`), mirroring the Claude-side `.cjs` session hooks.
export const GEMINI_BEFORE_TOOL_REL = '.gemini/hooks/BeforeTool.cjs';

// The pre-#2481 path. A consumer upgraded from an earlier Totem still carries this
// fail-open `.js` (and, if it registered the hook, a `.gemini/settings.json` command
// pointing at it). The upgrade path migrates it to GEMINI_BEFORE_TOOL_REL via
// LEGACY_MANAGED_SESSION_HOOKS below.
export const GEMINI_BEFORE_TOOL_LEGACY_REL = '.gemini/hooks/BeforeTool.js';

// The Gemini SessionStart briefing ships as `.cjs` for the SAME reason
// (mmnto-ai/totem#2488, closing the #2481 slice's deliberate scope-out). Its body is
// CommonJS too (top-level `require('child_process')` for the describe/orient briefings
// and the totem-status refresh spawn), so in a `"type": "module"` consumer Node resolves
// a bare `.js` as ESM and the hook throws `ReferenceError: require is not defined`
// before it emits anything — the session-start briefing fail-opens SILENTLY. Per
// mmnto-ai/totem#2558, `totem init` emits no `.gemini/settings.json` SessionStart
// registration and Gemini CLI has no filename-convention discovery, so this file only
// ever executes via host/plain-node paths (exactly where the live break surfaced, on
// totem-status) — and unlike BeforeTool there is no registration seam to migrate; the
// file rename is the whole fix. Arming the hook in Gemini CLI stays #2558's scope.
export const GEMINI_SESSION_START_REL = '.gemini/hooks/SessionStart.cjs';

// The pre-#2488 path, migrated to GEMINI_SESSION_START_REL via
// LEGACY_MANAGED_SESSION_HOOKS below.
export const GEMINI_SESSION_START_LEGACY_REL = '.gemini/hooks/SessionStart.js';

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
    rel: GEMINI_SESSION_START_REL,
    content: GEMINI_SESSION_START,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    rel: GEMINI_BEFORE_TOOL_REL,
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

// ─── Legacy managed-artifact migration roster (mmnto-ai/totem#2481) ───
//
// Whole-file artifacts an EARLIER Totem distributed under a path this version has
// since renamed. `migrateLegacyGeminiHooks` (install-hooks.ts) runs on the upgrade
// path (`totem hook install`) and `totem init`: it materializes `successorRel` from
// canonical `content` and removes the bounded totem-owned `legacyRel`. The SAME
// ownership gate as the drift-repair path applies (markerOpensFile / isBoundedOwnedFile
// — no NEW predicate), so a user-owned file that merely shares the legacy name is
// never touched. `regenerateManagedSessionHooks` is regenerate-only-if-present and
// would not create the renamed successor on upgrade; a PRESENT legacy artifact is
// proof the repo already adopted the hook, so the successor is materialized here
// rather than left for a fresh `totem init` (which the consumer may never re-run).

export interface LegacyManagedHook {
  /** Pre-rename repo-relative path, removed once migrated (POSIX separators). */
  legacyRel: string;
  /** Current repo-relative path, materialized from `content`. */
  successorRel: string;
  /** Canonical successor content — embeds `marker` at head and `endMarker` at tail. */
  content: string;
  /** Ownership/presence marker that must OPEN the legacy file to migrate it. */
  marker: string;
  /** End marker bounding the totem-owned region in the legacy file. */
  endMarker: string;
}

export const LEGACY_MANAGED_SESSION_HOOKS: ReadonlyArray<LegacyManagedHook> = [
  {
    legacyRel: GEMINI_BEFORE_TOOL_LEGACY_REL,
    successorRel: GEMINI_BEFORE_TOOL_REL,
    content: GEMINI_BEFORE_TOOL,
    marker: TOTEM_FILE_MARKER,
    endMarker: TOTEM_FILE_END,
  },
  {
    // mmnto-ai/totem#2488 — same fail-open class as the BeforeTool entry above.
    legacyRel: GEMINI_SESSION_START_LEGACY_REL,
    successorRel: GEMINI_SESSION_START_REL,
    content: GEMINI_SESSION_START,
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
// "Distributed skill constants match source-of-truth" suite in `init.test.ts`
// locks these constants against those files byte-for-byte, so canonical drift
// fails CI rather than silently propagating stale skill content to consumers.

export const SKILL_MARKER_START = '<!-- totem:skill-start -->';
export const SKILL_MARKER_END = '<!-- totem:skill-end -->';

/**
 * The two roots a distributed skill is written to (mmnto-ai/totem#2788, the
 * mmnto-ai/totem#2532 slice-2 charter; landed by mmnto-ai/totem#2899): the
 * `.claude/skills/` copy Claude Code reads and the vendor-neutral
 * `.agents/skills/` twin that Gemini CLI, Antigravity, Kimi and Codex read.
 * ONE list, read by both `totem init` (which writes each root under its own
 * condition) and `totem eject` (which scrubs and rosters both), so a root can
 * never drift between the writer and the remover the way a hand-mirrored
 * literal would (the re-armed leg on mmnto-ai/totem#2899 fold 1, F3). The two
 * copies are equal inside the markers and each keeps its own extension tail
 * below the end marker — the contract the parity manifest states; byte
 * equality is the zero-tail case.
 */
export const SKILL_TWIN_ROOTS = ['.claude', '.agents'] as const;
export type SkillTwinRoot = (typeof SKILL_TWIN_ROOTS)[number];

export const SIGNOFF_SKILL_CONTENT =
  `---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

${SKILL_MARKER_START}

End-of-session wrap-up. Post-Proposal-282 (ADR-106), journals + handoffs live in the per-repo \`.totem/orchestration/<agent-id>/\` tree (gitignored) — NOT the substrate. Substrate stays as a frozen archive for forensic reads; the active surface is local.

0. **Crown gate — derive FIRST (Prop 305 §8; operator-ruled 2026-08-13; non-cohort scope amended by operator word 2026-08-14, recorded on the mmnto-ai/totem-strategy#488 R-table).** **Journal rule first — every seat, every repo:** restate your OWN chain's still-open \`owed:\` lines only — lines where YOU are the waiter and \`@holder:\` names the counterparty who owes (naming yourself as \`@holder:\` makes a note-to-self the parser silently skips) — and never another seat's carryforward: the parser keys each edge's waiter to the journal-owning seat, so a copied line mints a live foreign edge in YOUR chain (a line self-held at its origin is a skipped note-to-self THERE and a LIVE edge in yours) that persists until your own next journal drops it. (Canonical rulings home: mmnto-ai/totem-status#127.) **Then the gate ladder:** read the \`totem:agent-bus\` marker in this repo's AGENTS.md and check the step-2a cohort table below. No declared marker (absent, or missing \`role\`/\`seat\` — the parity sensor's not-declared set) AND this repo's basename is NOT in the cohort table = **non-cohort consumer**: the crown gate does not apply — run your full signoff. No declared marker but the repo IS in the table = a cohort repo that has not normalized: treat as crown **vacant** (fail-closed — the ruled default). Marker declared: derive \`primary=\` fresh — that seat is the crown; declared but no \`primary=\` = crown **vacant**. Vacant (either arm) is a legitimate state: surface upkeep stages/defers, mail the operator, and no seat self-promotes (transfer is the operator's word, Prop 305 §8.1; vacancy legitimacy §8.4b). **Before comparing yourself to \`primary=\`, verify your OWN identity — the signon S0 check applies at signoff too:** your seat derives per step 2a, and a mis-scoped or inherited \`TOTEM_SELF_AGENT\` naming a foreign seat must not make this session the crown; a foreign or ambiguous self-identity is fail-closed — no crown decision, no upkeep mutations — until the identity is fixed. If you are NOT the crown, your signoff is seat-anchored + own-lane: skip the surface-upkeep MUTATIONS — derived-cache/corpus rebuilds, GH board writes, cohort-wide upkeep walks, and step 4's shared-tree branch cleanup (crown-scoped there by name) — while every OTHER managed step (1–3, 5–6) still runs for every seat, and read-only derivation stays open to all: derive, then report staleness to the crown by mail.

1. **Update memory.** Update auto-memory files (e.g. \`MEMORY.md\`, topic memories) with any new state — version shipped, tickets closed, key decisions, banked feedback or doctrine signals.

2. **Write a journal entry to the per-repo orchestration path.** Filename convention: \`<model>-NNNN-<short-topic-slug>.md\` (e.g., \`claude-0057-phase-4-resolver-shipped.md\`).

   **Resolve the path two steps:**

   a. **Identify your agent-id** from the current repo's basename. The hardcoded map (Proposal 282 § Scope item 3 — the prose twin of \`COHORT_AGENT_MAP\` in \`@mmnto/totem\`, which a test holds it to; the roster of record is the cohort-roles matrix in the strategy doctrine):

   | Repo (\`git rev-parse --show-toplevel\` basename) | Claude agent-id                     | Gemini agent-id   | Kimi agent-id     |
   | ----------------------------------------------- | ----------------------------------- | ----------------- | ----------------- |
   | \`totem\`                                         | \`totem-claude\`                      | \`totem-gemini\`    | \`totem-kimi\`      |
   | \`totem-strategy\`                                | \`strategy-claude\`                   | \`strategy-gemini\` | \`strategy-kimi\`   |
   | \`liquid-city\`                                   | \`lc-claude\`                         | \`lc-gemini\`       | \`lc-kimi\`         |
   | \`arhgap11\`                                      | \`arhgap11-claude\`                   | \`arhgap11-gemini\` | _(not seated)_    |
   | \`totem-status\`                                  | \`status-claude\`                     | \`status-gemini\`   | \`status-kimi\`     |
   | \`totem-playground\`                              | _(orphan stream — no native agent)_ | _(orphan stream)_ | _(orphan stream)_ |

   This table is the BOOTSTRAP FALLBACK, not the roster: three of the roster's five vendor columns plus two archived repositories, and it rots when a seat is added — three of its four Kimi cells read "not seated" for weeks after those seats were seated (filled here; mmnto-ai/totem#2865). The core map it twins carries the four Kimi seats (mmnto-ai/totem#2875), and the table-to-map sync test holds the two as an equality, so a Kimi seat resolves on a fresh clone with no seat dir, no \`TOTEM_SELF_AGENT\` and no \`config.json\` \`host_agents\`. \`totem mail --derive-seat\` is the derivation; no cell here overrides it. Seat discovery is dir-derived (mmnto-ai/totem#2141): any \`.totem/orchestration/<agent-id>/\` directory registers that seat for this repo, UNIONED with the basename map above so roster siblings stay visible on fresh clones where the gitignored tree is partial (precedence: \`TOTEM_SELF_AGENT\` env > \`config.json\` \`host_agents\` > seat dirs ∪ basename map). Override hook: a \`host_agents: string[]\` field in \`.totem/orchestration/config.json\` still **replaces** the derived answer — but omitting a PRESENT seat dir attaches a loud warning naming the omitted seat (the dir is the registration; config-exclusion is not a decommission mechanism). The returned list of agent-ids is used by consumers (e.g., \`totem mail\`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session.

   **Visiting case.** If your own agent-id does not appear in your row — the cell for your vendor reads \`_(not seated)_\` or an orphan-stream value, or the table has no column for your vendor at all — you are visiting a repo that doesn't natively host your agent. Resolve the journal path to \`<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/\`, where \`<your-home-agent-id>\` is your own agent-id (e.g., a \`strategy-claude\` session always writes as \`strategy-claude\` regardless of which repo it's visiting; concretely, \`strategy-claude\` visiting \`totem-status\` — whose row seats \`status-claude\`, not \`strategy-claude\` — writes to \`totem-status/.totem/orchestration/strategy-claude/journal/\`). The journal records the visiting agent's session state — the host repo doesn't need a native agent of your vendor to be a valid write target.

   b. **Resolve the journal directory** via \`resolveOrchestrationPaths(repoRoot, agentId).journal\` from \`@mmnto/totem\`. Returns the absolute path to \`<repoRoot>/.totem/orchestration/<agent-id>/journal/\` when the tree exists. If \`source === 'none'\` (the tree does not exist yet in this repo) the resolver returns \`null\` for every path field — in that case, construct the path manually as \`<repoRoot>/.totem/orchestration/<agent-id>/journal/\` and create the directory first via \`mkdir -p\`; the path is gitignored and safe to create.

3. **No commit, no push.** \`.totem/orchestration/\` is gitignored — local filesystem write is the entire operation. No more substrate rebase-retry loops; the cross-agent write-collision class is eliminated by the single-writer-per-path invariant (you only ever write into your own \`<agent-id>/\` subtree).

` +
  // totem-context: documentation example — `git branch -D` shown in canonical signoff procedure for human readers; not a runtime invocation in this file
  `4. **Clean up stale local branches — CROWN ONLY where the crown gate applies (step 0; in a non-cohort repo the gate does not apply and this step simply runs — the named design choice per the mmnto-ai/totem-strategy#488 R8 ruling).** The cleanup mutates the SHARED per-repo working tree — cohort upkeep, not own-lane (worktree-pinned branches refuse deletion, so it is collision-safe, but ownership is the point, not safety). A non-crown cohort seat skips this step and reports any \`[gone]\` branches to the crown (or, crown vacant, the operator) by mail instead.

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

0. **Derive the seat FIRST — before orient, before any journal read, before any knowledge search** (mmnto-ai/totem#2801). Read the INHERITED \`TOTEM_SELF_AGENT\` this session was launched with; \`totem mail --derive-seat\` is the probe — one stdout line \`seat=<id> source=env\` and exit 0 when the inherited env names exactly one seat this repo hosts, otherwise a stderr refusal (exit 2) naming the supplied value (or \`unset\`) and every seat this repo hosts. **Hosts** means one thing everywhere: config.json \`host_agents\`, else the seat dirs, else the cohort map keyed on the origin repository — never the env you supplied, which is the thing being checked. **Set → that is your seat: use it, and never write a different one.** An inline \`TOTEM_SELF_AGENT=<seat>\` on any later command may only RESTATE the inherited value; writing a different seat over it silently re-points every step below at a seat that is not yours, and once overridden the tool can no longer see what you inherited — the operator's account is the only witness left. **Set but REFUSED** (the probe exits 2 while the env names a seat): your declaration and this repo disagree, so act as if you have no seat — put the refusal line itself in front of the operator, verbatim, and change nothing to make it pass; signon is read-only, so \`totem seat add\` is never run here. On a repo with no seat registration at all the refusal says the repo cannot CORROBORATE you, not that your seat is wrong: \`totem mail --as <your-seat>\` and a per-shell poll still serve your declaration, because a declaration on the command line is yours to make and this probe only checks one. **Empty → STOP and ask the operator.** Do not guess, do not fall back to the crown, do not derive a seat from the repo basename, the branch, or the only seat in sight; a bring-up on an unknown identity is worse than no bring-up. Report exactly one line and wait: \`Failure Mode: Hook-less session launched without TOTEM_SELF_AGENT set.\`

1. **Assignment mail before orient — poll since last signoff, seat-anchored.** On a hook-less seat the order is fixed: assignment mail before orient, before any journal read, and before any knowledge search — an assignment can turn every one of those into a disclosure (step 2), and the managed hook derives neither the poll nor the journal for you (step 3). Poll AS YOUR SEAT: per-shell \`TOTEM_SELF_AGENT=<your-seat>\` (the mmnto-ai/totem#2629 scope ruling — never user/machine scope; prefer the inline form \`TOTEM_SELF_AGENT=<seat> totem mail\` where shell state does not persist between tool calls, and on a session whose step-0 env is already set that inline form RESTATES that seat and never another) or \`totem mail --as <your-seat>\`. **S0 identity check:** the banner's \`Self agents:\` line must name exactly your seat. Since @mmnto/cli 1.117.0 an identity-less multi-seat poll gates itself (broadcast-only serve, directed mail withheld as a count, exit 2 — the mmnto-ai/totem#2204 deterministic floor), so the residual S0 catches is the WRONG-single-identity class: a mis-scoped or inherited env naming a foreign seat resolves single-seat, ungated, and serves that seat's directed mail. A banner naming a FOREIGN seat = STOP: act on nothing served, propagate nothing from it, fix the identity, re-poll. A GATED poll's LISTING is broadcast-only by construction — but warning lines can still name an unclassifiable or unresolvable file (an ECL basename is recipient + compressed subject — the CLI's named limit), so propagate nothing from a gated poll's warnings either: fix the identity and re-poll for your directed mail. An \`Error:\` line is the same surface: since the mmnto-ai/totem#2685 fix a poll whose OWN outbox (one this repo hosts for a resolved seat) carries a dispatch with an unresolvable \`to:\` exits 4 (SENDER FAULT) — the verdict IS derived, read it, but the \`to:\` is yours to fix first (one recipient per dispatch, or broadcast; a comma list is never a recipient), and propagate nothing from the fault line; exit 2 stays NOT-DERIVED and wins when both hold. Unread = inbound − handled: consumption is tracked by \`processed/\` marks (\`feedback_check_outbox_before_replying\`), so the CLI path needs no cutoff stamp. Read every hit before proceeding — new mail can reprioritize everything below. (Fallback — a seat that must stamp-poll instead derives the cutoff from the newest journal's CONTENT date, the filename stamp or frontmatter, **never file mtime**, which git resets on clone/worktree and silently reports "inbox clean" over waiting mail; mmnto-ai/totem-strategy#813.)

2. **Kit-first — while a BLIND round is in flight, read the kit and nothing else.** The BLIND-kit marker is the dispatch SUBJECT's literal prefix \`BLIND round: \`, followed by the round's name and, in the same subject, the deposit clause \`— deposit to <orchestrator-seat> by <ISO-8601 deadline>\`; no frontmatter key carries it, so the subject line is what you read. **A round is in flight while such a dispatch has an unpassed deadline and no deposit received.** In flight, signon ENDS here: read the kit and the artifact the kit names, and nothing else — no \`totem orient\`, no journal, no knowledge search, no board or PR read — because live repository detail is precisely what a blind classification must not carry. The kit-first rule has no partial arm: if any step ran before you reached the kit, report the exposure to the round's orchestrator seat by directed mail and do not classify; a disclosed round is re-armed in a fresh session, never repaired in place.

3. **Consume the injected orientation — the managed hook injects exactly two blocks.** The managed SessionStart hook injects exactly two briefing blocks — \`totem describe\` and \`totem orient --session\` — and injects nothing else: no journal and no mail (it does other work at boot, none of which reaches your context), so your latest journal (step 4) and your seat-anchored mail (step 1) are derived BY HAND on every seat, hook or not — never assumed present. Do not re-run the two blocks it did inject. A repo may also run its own session hook; whatever such a hook injects serves the seat it is CONFIGURED for, not a derived identity, so confirm the injected material is YOURS: a visiting session receives the HOST seat's, and your carryforward derives from \`.totem/orchestration/<your-seat>/journal/\` (step 4), never from a foreign journal. On a hook-seat MISMATCH (an injected journal or mail banner naming another seat), consume NONE of the injected material — treat the session as hook-less and derive it all: \`totem orient\` plus your own seat-anchored poll (step 1). Everything else the bring-up needs (the full board in-flight set, corpus freshness, doctrine currency) is derived on demand via \`totem orient\`. On a hook-less seat (other vendors, cold starts), derive it all: \`totem orient\`.

4. **Re-derive the carryforward gates — don't trust the journal's framing** (Tenet 20 read-side twin). For each carryforward item in YOUR SEAT's latest journal (\`.totem/orchestration/<your-seat>/journal/\` — on a multi-seat repo another seat's newer journal is not your carryforward), freshly derive its gate state (the PR it waits on, the issue, the date, the release train) via \`gh\` / \`git\` reads. Cross-repo gates resolve through the frozen cohort roster — \`totem\` / \`strategy\` / \`status\` / \`lc\` → \`mmnto-ai/{totem, totem-strategy, totem-status, liquid-city}\` (mmnto-ai/totem-strategy#611 gates any change). An item whose gate fired leads the next-steps list; an item still gated is reported as waiting, not worked.

5. **Surface owed-now sensors.** Anything the injected/derived orientation flags as owed (corpus \`⚠ stale\`, strategy-doctrine \`⚠ publish owed\`, board drift) goes on the list as a candidate — sensors report, they don't gate (Tenet 13).

6. **Present and stop.** One message: state summary (seat, inbox, gate states, owed-now items) + ranked next-steps with a recommendation. Then wait for the operator's ruling — signon ends at the judgment handoff; mutations belong to the ruled work, not the bring-up.

${SKILL_MARKER_END}
`;

export const REVIEW_REPLY_SKILL_CONTENT = `---
name: review-reply
description: Unified PR review triage — fetch, normalize, and batch-action bot comments; and the completion recipe that ends a bus audit
---

${SKILL_MARKER_START}

Triage PR review comments from all bots for PR $ARGUMENTS.

## Before Phase 1: confirm each invoked bot's review is on the head

A review trigger is the operator's to post, and what a bot does with it is not ours to control — so before triaging, confirm every invoked bot's review against the review object for THIS head sha, or the bot's summary comment for that sha, never a green commit status on the head: CodeRabbit's status settles green on every push head whether or not it reviewed that head (\`Review completed\` on the sha it reviewed, \`Review skipped\` on every push head it did not), and a PENDING status means still reviewing; Greptile's green \`Greptile Review\` check run does mark the sha it reviewed; GCA posted neither a status nor a check run on any GCA-reviewed sha measured so far. The reads, in order — the head sha; every review with the sha it was submitted against; the sha each Greptile summary comment names as its \`Last reviewed commit\`; the sha each CodeRabbit summary comment names as covered in its \`final_review_risk_coverage\` marker — so both halves compare a printed sha against a printed head, never an improvised one:

\`\`\`bash
gh pr view $ARGUMENTS --json headRefOid --jq .headRefOid
gh api --paginate "repos/{owner}/{repo}/pulls/$ARGUMENTS/reviews" --jq '.[] | [.user.login, .commit_id, .state, .submitted_at] | join(" ")'
gh api --paginate "repos/{owner}/{repo}/issues/$ARGUMENTS/comments" --jq '.[] | select(.user.login == "greptile-apps[bot]") | .body | capture("Last reviewed commit:.*?/commit/(?<sha>[0-9a-f]{40})") | .sha'
gh api --paginate "repos/{owner}/{repo}/issues/$ARGUMENTS/comments" --jq '.[] | select(.user.login == "coderabbitai[bot]") | .body | capture("coveredCommitId.:.(?<sha>[0-9a-f]{40})") | .sha'
\`\`\`

A summary-comment verdict is read from the PR's issue comments and matched to the head by the \`Last reviewed commit\` sha its own body names — never by the comment's timestamp, which an in-place re-review does not advance. A chat reply or silence with no review to confirm is not a pass under the cadence of one external pass per chosen bot, so the pass is a standalone re-trigger, posted by the operator on the same terms — that bot's first pass, not a re-invoke, which the cadence reserves for risky rework with the reason recorded in the round comment. Before merging on the other reviewers, either wait one acknowledgement window (about 12 minutes from the trigger) or merge and record the late acknowledgement as one line on the PR thread naming the bot and the time it acknowledged.

## Phase 1: Fetch & Categorize (Deterministic)

Run the triage command to fetch, normalize, deduplicate, and categorize all bot comments:

\`\`\`bash
pnpm exec totem triage-pr $ARGUMENTS
\`\`\`

\`pnpm exec\` is the documented explicit form: it puts \`node_modules/.bin\` first on the path and runs the \`totem\` bin from there. A bare \`pnpm totem …\` reaches the same bin only as a fallback — pnpm tries a builtin command first, then a declared \`totem\` script, and hands the name to \`pnpm exec\` only when it finds neither — so the explicit form is the one to run; a Windows consumer once saw a \`cmd\` banner instead of the triage on the bare form (mmnto-ai/totem#2903, one occurrence, not reproduced since). From an installed \`@mmnto/cli\`, \`node node_modules/@mmnto/cli/dist/index.js triage-pr $ARGUMENTS\` is the same triage with no resolver in between; in a checkout whose workspace build is the intended binary, \`node packages/cli/dist/index.js triage-pr $ARGUMENTS\`.

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
- **ghcq items:** \`github-code-quality[bot]\` has no known @-listener (attested: no in-org tag attempt has drawn a response and none is documented — mmnto-ai/totem#2626) — do not tag it; treat its dispositions as audit-trail-only.
- **SARIF items:** No reply needed (our own tool).

### \`nit <numbers | category>\`

Same as defer but reply text is "Acknowledged — nit / by design."

### \`extract <numbers | category>\`

For each selected finding, generate a lesson and call \`mcp__totem-dev__add_lesson\` (or equivalent):

- Use the bot's finding as the lesson body
- Add relevant tags from the file path and finding category
- The lesson will automatically get \`lifecycle: nursery\` treatment

### \`done\`

Print a summary of actions taken, then — when the round is being dispositioned — assemble and post the single consolidated round-disposition comment (see the section below), which EXECUTES \`totem review --covariate\` to carry the \`local-lane:\` line, on the operator's explicit go. Then, as the LAST action of the round, run \`totem resolve-threads\` (step 4 of that section) — dry first, \`--apply\` only on the operator's explicit go. Then exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain \`@gemini-code-assist\`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (\`/issues/{pr}/comments\`), not the review comments reply endpoint.

## Consolidated round-disposition comment (a concrete step, operator-gated)

Disposing the round is ONE consolidated comment (single-comment ownership per bot-protocols) — a real, numbered step of the flow, NOT an optional aside. Like every GitHub mutation in this skill it is operator-gated: assemble the body, show it, and post ONLY on an explicit human go. Run this as part of \`done\` (or whenever the operator asks to post the round disposition):

1. **Obtain the covariate line — execute the verb, never hand-author it.** Run the read-only, zero-LLM command and capture its stdout:

\`\`\`bash
totem review --covariate
\`\`\`

It resolves the current branch lineage exactly as the review fan does and prints the canonical \`local-lane:\` line from the core-owned renderers — the LATEST verdict artifact's line (\`.totem/artifacts/verdicts/\`) when the current diff is admitted, or the exact-identity admission record's \`not-applicable\` form (\`.totem/artifacts/admissions/\`, format v1.1, mmnto-ai/totem#2473) when the current diff is a deterministic skip — never trust a pasted or hand-copied value. Under format v1.2 (mmnto-ai/totem#2698) every shape carries the appended \`leg: <sha8> blocking=<n> material=<n> folded=<n>\` field (or \`leg: none\`), and a lineage with no artifact of either family but a leg deposit for HEAD prints the \`local-lane: none\` head shape — carry whatever the verb prints, verbatim. If it reports no line at all, there is none to carry (note that in the body and continue).

2. **Assemble the single body.** One comment: @-tag EVERY bot addressed in the round — exactly ONE tag each (e.g. \`@gemini-code-assist\`, \`@coderabbitai\`, \`@greptileai\`) so each bot registers the disposition, each tag on its OWN line (operator-ruled 2026-09-15; the line shape is practice, not a GCA guarantee, and position within the comment is unruled), and tags must be present when the comment is POSTED, never edited in (GCA's listener fires on comment-created only). One notification per bot per round: a bot with nothing addressed gets no tag, and a bot already @-tagged in this round's batch comment (the GCA defer/nit batch above) is NOT re-tagged here. ghcq (\`github-code-quality[bot]\`) has no known listener — it is never tagged; its items are dispositioned in the body for the audit trail only (mmnto-ai/totem#2626). Never combine a tag with ANY bot's review trigger — triggers are standalone comments, one trigger and no prose (a trigger embedded in a content-rich comment chat-routes the bot). Then the per-item dispositions (fixed / deferred / nit / extracted), then ONE machine line per bot-rooted thread this round answered, each on its own line —

\`\`\`text
disposition: <rootCommentId> <fixed|declined|deferred|nit|extracted|held>
\`\`\`

— where \`<rootCommentId>\` is the thread root's REST comment id, the \`id=\` on the row \`totem resolve-threads $ARGUMENTS\` prints in its dry run — run that dry run NOW, before assembling: it is read-only, it lists every thread with its id whether or not this comment exists yet, and it runs again after posting as step 4's evidence check (\`totem triage-pr\` carries the id but does not print it) — and the verb is this round's word for that thread. The merge-ready gate's predicate 4 (mmnto-ai/totem#2861) reads a RESOLVED HIGH/Major inline as dispositioned only when a non-bot PR-level comment created after its root carries the line naming ITS id (or a non-bot reply sits in the thread): a round disposition that omits a thread's line leaves that HIGH applying to the head, a line naming another thread does not discharge it, and a line edited into an older comment does not count — post a new comment for a late line. A finding outside any thread (a review-body item, a summary-table row) has no line: it has no thread to resolve. Then the non-empty \`local-lane:\` line from step 1, verbatim. The local \`review-loop\` holds this line but never posts it, so \`/review-reply\` is the SOLE path that carries it to GitHub.

3. **Post on an explicit go.** Show the assembled body and wait for the operator; on their go, post the ONE comment with \`gh pr comment $ARGUMENTS --body-file -\` (pipe the body via stdin). Never mutate the PR autonomously.

4. **Resolve the threads this round dispositioned — dry first, \`--apply\` on the operator's explicit go.** The comment you just posted IS the evidence the verb reads, so this step runs AFTER it, and it is the LAST action of the round. Print the plan (this never mutates):

\`\`\`bash
totem resolve-threads $ARGUMENTS
\`\`\`

Every bot-rooted thread prints one row carrying its REST root comment id and a verdict: \`resolve\`, \`skip:already-resolved\`, \`skip:outdated\`, \`skip:no-evidence\`, \`skip:not-selected\`. A \`skip:no-evidence\` row is a thread this round has not answered — neither an in-thread reply from a human nor a PR-level comment created after that thread's root — and the verb will NEVER resolve it under any flag; give it evidence and re-run rather than working around it. Show the plan and wait. Only on the operator's explicit go, run the mutating half (add \`--ids <comma-separated REST root comment ids>\` to narrow it to named rows; an unmatched id aborts before anything is resolved):

\`\`\`bash
totem resolve-threads $ARGUMENTS --apply
\`\`\`

The verb never posts a comment, a reply or a review — the only mutation it can issue is \`resolveReviewThread\`, which is what the merge-ready gate's unresolved-bot-threads predicate reads. Exit \`2\` means it did not do everything asked (an unmatched id, a failed mutation, or a selected thread with no evidence); exit \`1\` means the read did not complete and NOTHING was resolved. Report what it printed, verbatim.

A clean \`--apply\` run is NOT an allow verdict, and it clears the unresolved-bot-threads predicate only when no unresolved, non-outdated thread rooted by a known review bot remains: a \`skip:no-evidence\` row stays unresolved and, under \`--apply\`, makes the run exit 2; a run narrowed with \`--ids\` leaves its unnamed rows as \`skip:not-selected\` and exits 0. The gate re-reads the PR when \`gh pr merge\` runs, and a bot HIGH inline whose commit cannot be read makes the evaluation UNEVALUABLE once every earlier predicate passes — a deny the resolve run does not predict (under the pilot tier it warns; strict denies). After the apply, read the floor itself — \`totem gate check --event merge-ready --payload '{"repo":"<owner/repo>","pr":$ARGUMENTS}'\`, with \`--tier pilot\` where the installed gate is the pilot — and report that verdict beside the resolve rows, before the merge word is asked for.

## Ending a blind-round audit on the bus (the completion recipe)

A finished audit or round deposit for a kit that arrived by mail ends with ONE call:

\`\`\`bash
totem mail reply <source dispatch path> --body-file <deposit>
\`\`\`

It sends the reply into your own outbox AND writes the \`processed/\` mark for the source in the same call. \`--no-mark\` stages the reply and leaves the source unread for a later \`totem mail mark <source>\`. Never a hand-written mark, and never a separate send followed by a hand-written mark: the mark is the consumption record the next poll reads, and the reply verb writes it under the same resolved root as the reply — the resident checkout that hosts your seat (mmnto-ai/totem#2930). Run both calls from that resident checkout, never from a worktree: the reply refuses a worktree, and since mmnto-ai/totem#2968 so does a standalone \`totem mail mark\` — on a CLI before that fix the mark resolved the nearest marker, and from a worktree that minted a phantom store no poll drains. The source path is the \`read:\` line under the item in \`totem mail\`'s listing (mmnto-ai/totem#2919; the item's \`filePath\` under \`--json\`) — pass it as printed. When the send's own verify line is not in front of you, \`totem mail verify <written path>\` re-checks the dispatch you wrote.

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

<!-- covariate line format v1.2 — do not alter without a spec amendment (v1.1 added the additive admission form; v1.2 appends the leg field to both shapes and adds the \`local-lane: none\` head for a deposit-only lineage: mmnto-ai/totem#2698 design § Implementation Design, the .totem/specs/2473.md v1.2 clause) -->

\`\`\`text
local-lane: <verdictHash8> round=<n> settled=<true|false> lanes=<completed>/<attempted> leg: <sha8> blocking=<n> material=<n> folded=<n>
local-lane: not-applicable (<reason>) recorded=<recordHash8> at=<createdAt> leg: <sha8> blocking=<n> material=<n> folded=<n>
local-lane: none leg: <sha8> blocking=<n> material=<n> folded=<n>
\`\`\`

\`<verdictHash8>\` is the first 8 hex characters of the verdict artifact hash the CLI reports. The second shape is the ADMISSION form (format v1.1, mmnto-ai/totem#2473): rendered when the current diff resolves to a deterministic not-applicable admission — \`<recordHash8>\` addresses the admission record in \`.totem/artifacts/admissions/\`, and it is discriminated on the literal second token \`not-applicable\`. The third shape is the DEPOSIT-ONLY head: rendered when no verdict and no admission record exists for the lineage but a leg deposit resolves for HEAD, so a diff is never presented with no evidence line at all. \`leg: none\` replaces the field on the FIRST TWO shapes when no deposit resolves for HEAD; the third shape never carries it, because a deposit resolving is the only reason that shape renders. Consumers discriminate on the second token (\`<hash8>\` · \`not-applicable\` · \`none\`); \`<sha8>\` is the first 8 hex of the deposit's \`diffSha\`; a folded finding counts in both its severity bucket and \`folded\`. This line is a versioned contract consumed by a measurement pilot — do not change any shape without a spec amendment. The CLI renders every shape from its canonical artifacts via single core-owned renderers, so the line is re-derivable and never hand-authored — on demand, the read-only \`totem review --covariate\` (zero-LLM) resolves the current state and prints the verdict's line (admitted diff), the admission record's line (deterministic skip), or the deposit-only head (neither artifact exists for the lineage, but a leg read HEAD). Inclusion of any pending \`local-lane:\` line in the single consolidated round-disposition comment belongs to \`/review-reply\` (which obtains it by running \`totem review --covariate\`), not to this loop — never post it to GitHub yourself.

${SKILL_MARKER_END}
`;

export const DISTRIBUTED_CLAUDE_SKILLS = [
  { name: 'signoff', content: SIGNOFF_SKILL_CONTENT },
  { name: 'signon', content: SIGNON_SKILL_CONTENT },
  { name: 'review-reply', content: REVIEW_REPLY_SKILL_CONTENT },
  { name: 'review-loop', content: REVIEW_LOOP_SKILL_CONTENT },
] as const;

// ─── The public AGENTS.md floor (mmnto-ai/totem-strategy#619 design v1 § 1) ──
// The product-valid instruction set any consumer gets from `totem init`: a
// marker-bounded managed span (`AGENTS_FLOOR_BLOCK`) that later inits refresh in
// place, inside a file whose every other byte is the repository's own. The span
// is written for ANY consumer, so it names no private repository, no deployment,
// no operator, no doctrine tag and no agent vendor list — the sterility test in
// `agents-floor-sterility.test.ts` holds it to that, and holds this repository's
// committed AGENTS.md to carrying the span byte-identically (the "sterile floor
// IS the init scaffold" product test the issue names).

export const AGENTS_FLOOR_REL = 'AGENTS.md';
export const AGENTS_FLOOR_START = '<!-- totem:agents-floor:start -->';
export const AGENTS_FLOOR_END = '<!-- totem:agents-floor:end -->';

/**
 * The managed span, start marker through end marker, with NO trailing newline:
 * a refresh replaces exactly the bytes from the start marker through the end
 * marker, so everything around the span (the line terminator after it included)
 * is untouched and a second refresh is a byte no-op.
 */
export const AGENTS_FLOOR_BLOCK = `${AGENTS_FLOOR_START}
<!-- Managed by \`totem init\`: the span between these markers is refreshed in place; everything outside it is yours. -->

## Session start

1. Run \`totem status\` for health.
2. **Never guess architecture.** Before modifying a core system, run \`totem search <system>\`.
3. Before writing code, call \`search_knowledge\` describing what you are changing.
4. Do not push speculative fixes: run \`totem lint\` locally and front-load every check before the first push.
5. Cold start (no session hook injected orientation): derive it with \`totem orient\`, after \`/signon\`'s seat and assignment-mail steps where that skill is installed.

## Working rules

- Before pushing: your formatter, then \`totem lint\` (the enforcement floor), then \`totem review\` where configured (advisory lanes, never a merge gate).
- After a PR merges: \`totem lesson extract <pr> --yes\`.
- **Never bypass a quality gate without a ticket.** No \`--no-verify\`, \`totem-ignore\`, \`eslint-disable\`, \`@ts-ignore\`, skipped tests, or ignore patterns added to pacify CI; a suppression carries a ticket reference.
- After roughly 15 turns of code changes: run \`totem status\`, re-query the knowledge index for the system you are modifying, and state your architectural assumption.
- **Controller, not implementer.** Delegate build-and-test cycles to background agents; keep this thread for decisions.

## Review bots

If this repository uses review bots: review triggers are the maintainer's to post, never an agent's. Reply to findings through \`/review-reply\`, one dispositions comment per round, and never cite a commit before it is pushed.

## Installed skills

Where \`totem init\` installs the \`/signon\`, \`/signoff\`, \`/review-reply\` and \`/review-loop\` skills, every later \`totem init\` refreshes each one's managed span and keeps what you add below its end marker.

${AGENTS_FLOOR_END}`;

/** The line terminator a file uses: CRLF when it carries any, else LF. */
export function detectEol(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/** The canonical span rendered in a file's own line terminator. */
export function agentsFloorBlockFor(eol: '\r\n' | '\n'): string {
  return eol === '\n' ? AGENTS_FLOOR_BLOCK : AGENTS_FLOOR_BLOCK.replace(/\n/g, '\r\n');
}

/**
 * The fence scan: byte ranges of CLOSED fenced code blocks (``` or ~~~ fences,
 * CommonMark's two shapes, opened at most three SPACES in — a tab-indented
 * fence line is indented code, not a fence; a closer must use the same
 * character and be at least as long), `end` exclusive, plus the position of an
 * opener no closer answered (`null` when the fences balance). A floor marker
 * quoted inside a closed fence is prose about the marker, never the marker —
 * the adoption hint tells a maintainer to add the two lines, which is exactly
 * what invites quoting them. Below an UNCLOSED opener the text is undecidable
 * by a scan: a quotation the author never closed, or a real span under a stray
 * fence line — one reading deletes a quotation, the other hides a span (two
 * legs' mirror findings). Neither tool guesses: markers there are AMBIGUOUS,
 * never paired, and both tools name the fence so the maintainer can close it.
 *
 * Three CommonMark rules the scan honours so a quoted example is read the way
 * a renderer reads it: a closing fence carries no info string (a ```sh line
 * never closes an open block — it is text inside it); a multi-line HTML
 * comment (a line-initial `<!--` whose line carries no `-->`, through the
 * first line that does) is raw HTML, so a fence-looking line inside it is not
 * a fence and a floor marker inside it is not a marker; and a `<!--` inside an
 * open fence is the fence's content. Markers a comment swallows, and markers
 * below an unclosed fence or comment opener, are ambiguous: excluded from
 * pairing and named by `agentsFloorAmbiguousFenceLine`, never silently prose.
 *
 * Disclosed limit: this is a line scan for two block kinds, not a markdown
 * parser. A fence-looking line inside any OTHER raw HTML block (a `<div>` …
 * `</div>` wrapper, say) is still counted here, and an odd number of such
 * lines shifts the pairing of every fence below them. The wiki tells
 * maintainers to keep fence-looking lines out of raw HTML in AGENTS.md.
 */
function scanFences(content: string): {
  /** Closed fenced code blocks, opener line start through closer line end. */
  ranges: Array<{ start: number; end: number }>;
  /** Closed multi-line HTML comment blocks, opener line start through the line carrying `-->`. */
  comments: Array<{ start: number; end: number }>;
  /** A fence opener no closer answered, else `null`. */
  unclosedAt: number | null;
  /** A multi-line comment opener no `-->` answered, else `null`. */
  unclosedCommentAt: number | null;
} {
  // One sequential pass over the lines, the way a block parser reads them: a
  // fence opener owns every line until its closer (a `<!--` inside it is
  // content), a multi-line comment opener owns every line until the first
  // `-->` (a fence-looking line inside it is content). Neither pass can be
  // computed from the other's output, which is why this is not two regexes.
  const ranges: Array<{ start: number; end: number }> = [];
  const comments: Array<{ start: number; end: number }> = [];
  let state:
    | { kind: 'fence'; at: number; marker: string }
    | { kind: 'comment'; at: number }
    | null = null;
  let lineStart = 0;
  while (lineStart <= content.length) {
    const nl = content.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? content.length : nl + 1;
    const line = content.slice(lineStart, nl === -1 ? content.length : nl).replace(/\r$/, '');
    if (state === null) {
      const opener = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line);
      if (opener !== null) {
        state = { kind: 'fence', at: lineStart, marker: opener[1]! };
      } else if (/^[ ]{0,3}<!--/.test(line) && !line.includes('-->')) {
        state = { kind: 'comment', at: lineStart };
      }
    } else if (state.kind === 'fence') {
      const closer = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        closer !== null &&
        closer[1]![0] === state.marker[0] &&
        closer[1]!.length >= state.marker.length
      ) {
        ranges.push({ start: state.at, end: lineEnd });
        state = null;
      }
    } else if (line.includes('-->')) {
      comments.push({ start: state.at, end: lineEnd });
      state = null;
    }
    if (nl === -1) break;
    lineStart = lineEnd;
  }
  return {
    ranges,
    comments,
    unclosedAt: state !== null && state.kind === 'fence' ? state.at : null,
    unclosedCommentAt: state !== null && state.kind === 'comment' ? state.at : null,
  };
}

/** The code point of the byte-order mark a UTF-8 editor may leave at byte 0. */
const BOM_CODE_POINT = 0xfeff;

/**
 * The whole-line predicate, stated once: `marker` at `at` in `content` is a
 * whole line when its line carries at most three leading spaces (CommonMark's
 * HTML-block indent; four make an indented code block, which is prose), the
 * marker, and trailing blanks before LF, CRLF or the end of the file. A
 * byte-order mark before a marker on line 1 is tolerated. A file whose lines
 * end in a bare CR (old-Mac terminators) has no whole lines by this rule and is
 * therefore never touched — a disclosed limit, not a guess.
 */
function isWholeLineMarker(content: string, at: number, marker: string): boolean {
  const lineBegin = content.lastIndexOf('\n', at - 1) + 1;
  const prefix = content.slice(lineBegin, at);
  const afterBom = lineBegin === 0 && content.charCodeAt(0) === BOM_CODE_POINT;
  const lineStart = /^[ ]{0,3}$/.test(afterBom ? prefix.slice(1) : prefix);
  const lineEnd = /^[ \t]*(?:\r?\n|$)/.test(content.slice(at + marker.length));
  return lineStart && lineEnd;
}

/**
 * Every position of `marker` in `content` that counts as a marker: a whole
 * line (see `isWholeLineMarker`) that is neither inside a closed fenced code
 * block nor below an unclosed fence opener (ambiguous, see `scanFences`). The
 * scaffold writes markers at column 0 as whole lines and the adoption hint
 * asks for whole lines, so a marker quoted in an inline code span, mentioned
 * mid-sentence, or sitting in an indented code block is prose and never pairs.
 */
export function agentsFloorMarkerPositions(content: string, marker: string): number[] {
  const { ranges, comments, unclosedAt, unclosedCommentAt } = scanFences(content);
  const positions: number[] = [];
  let at = content.indexOf(marker);
  while (at !== -1) {
    const fenced = ranges.some((r) => at >= r.start && at < r.end);
    // A marker inside a multi-line comment block is that block's content (a
    // renderer never sees it as markup); a marker below an unclosed fence or
    // comment opener is ambiguous. Both are excluded, and both are named by
    // `agentsFloorAmbiguousFenceLine` so the exclusion is never silent.
    const commented =
      comments.some((c) => at >= c.start && at < c.end) ||
      (unclosedCommentAt !== null && at > unclosedCommentAt);
    const ambiguous = unclosedAt !== null && at > unclosedAt;
    if (isWholeLineMarker(content, at, marker) && !fenced && !commented && !ambiguous) {
      positions.push(at);
    }
    at = content.indexOf(marker, at + marker.length);
  }
  return positions;
}

/**
 * Where an unclosed fence opener, an unclosed HTML comment opener, or a
 * closed multi-line HTML comment swallows floor markers: the 1-based line of
 * the earliest such opener that has at least one whole-line marker (start or
 * end) inside or below it, else `null`. Both tools name it instead of
 * guessing — computed on the text they are about to leave on disk, so the line
 * is right after a refresh or a scrub above it moved it.
 */
export function agentsFloorAmbiguousFenceLine(content: string): number | null {
  const { comments, unclosedAt, unclosedCommentAt } = scanFences(content);
  const hasMarkerIn = (from: number, to: number): boolean =>
    [AGENTS_FLOOR_START, AGENTS_FLOOR_END].some((marker) => {
      let at = content.indexOf(marker, from);
      while (at !== -1 && at < to) {
        if (isWholeLineMarker(content, at, marker)) return true;
        at = content.indexOf(marker, at + marker.length);
      }
      return false;
    });
  const candidates: number[] = [];
  if (unclosedAt !== null && hasMarkerIn(unclosedAt, content.length)) candidates.push(unclosedAt);
  if (unclosedCommentAt !== null && hasMarkerIn(unclosedCommentAt, content.length)) {
    candidates.push(unclosedCommentAt);
  }
  for (const c of comments) {
    if (hasMarkerIn(c.start, c.end)) candidates.push(c.start);
  }
  if (candidates.length === 0) return null;
  const earliest = Math.min(...candidates);
  return content.slice(0, earliest).split('\n').length;
}

/**
 * The line terminator to render a span in: the one the bytes OUTSIDE the span
 * use (the span is about to be replaced, so its own endings must not decide
 * the file's), falling back to the whole file's when nothing outside the span
 * carries a terminator at all (a file that is nothing but the span keeps its
 * own endings, so it stays a byte no-op). Disclosed limit: "outside" is the
 * whole file minus THIS span, so in a file that mixes terminators between two
 * spans the other span's endings weigh in — a file with two managed spans is
 * already broken (init names it), and a file mixing CRLF and LF outside the
 * span is converged toward whichever terminator it carries, not preserved
 * byte-for-byte.
 */
export function eolOutsideSpan(
  content: string,
  span: { start: number; end: number },
): '\r\n' | '\n' {
  const outside = content.slice(0, span.start) + content.slice(span.end);
  return outside.includes('\n') ? detectEol(outside) : detectEol(content);
}

/**
 * Locate one complete managed span in `content`, searching from `from`: the
 * FIRST end marker at or after `from`, paired END-anchored with the LAST start
 * marker before it and at or after `from` — the reflex scrub's pairing
 * (mmnto-ai/totem#2602), so an orphan start marker sitting above a complete
 * span never widens it, the bytes between an orphan and the real span stay the
 * repository's, and a caller that advances `from` past what it has already
 * handled can never re-pair an orphan it left behind. Markers inside closed
 * fenced code blocks are prose and never pair; markers below an unclosed fence
 * opener are ambiguous and never pair either (the callers name the fence, see
 * `agentsFloorAmbiguousFenceLine`). `null` when no complete pair exists at or
 * after `from`. `end` is exclusive and includes the end-marker line's trailing
 * blanks.
 */
export function locateAgentsFloorSpan(
  content: string,
  from = 0,
): { start: number; end: number } | null {
  const starts = agentsFloorMarkerPositions(content, AGENTS_FLOOR_START);
  const ends = agentsFloorMarkerPositions(content, AGENTS_FLOOR_END);
  for (const endIdx of ends) {
    if (endIdx < from) continue;
    // The last start marker before this end marker, and not before `from`.
    let startIdx = -1;
    for (const s of starts) {
      if (s >= from && s < endIdx) startIdx = s;
    }
    if (startIdx !== -1) {
      // The span is whole lines: it starts at the start-marker line's first
      // column (a tolerated byte-order mark on line 1 stays outside it, and an
      // indent of up to three spaces is normalized away by a refresh) and ends
      // after the end-marker line's trailing blanks, so neither survives into
      // the seam.
      const lineBegin = content.lastIndexOf('\n', startIdx - 1) + 1;
      const start = lineBegin === 0 && content.charCodeAt(0) === BOM_CODE_POINT ? 1 : lineBegin;
      const trailing = /^[ \t]*/.exec(content.slice(endIdx + AGENTS_FLOOR_END.length))![0].length;
      return { start, end: endIdx + AGENTS_FLOOR_END.length + trailing };
    }
    // An orphan end marker: keep scanning — a later complete pair is still a span.
  }
  return null;
}

/**
 * The whole file `totem init` writes when a repository has no AGENTS.md yet:
 * a title, the managed span, and a stub for the repository's own rules. Only
 * the span is managed after this first write.
 */
export function renderAgentsFloorScaffold(projectName: string): string {
  return `# ${projectName}: Agent Instructions

Canonical instructions for AI coding agents working in this repository. Any agent that reads \`AGENTS.md\` starts here.

${AGENTS_FLOOR_BLOCK}

## Repository conventions

Add this repository's own rules here: environment, branching, code style, publishing. Everything outside the markers above is yours; \`totem init\` never rewrites it.
`;
}

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

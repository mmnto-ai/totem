// ─── Init templates ─────────────────────────────────────
// Extracted from init.ts — template constants and config generators.

import type { IngestTarget } from '@mmnto/totem';

import type { ConfigFormat, EmbeddingTier } from './init-detect.js';

// ─── Reflex versioning ────────────────────────────────────
// Bump REFLEX_VERSION whenever the AI_PROMPT_BLOCK content changes materially.
// This allows `totem init` to detect stale blocks and offer upgrades.

export const REFLEX_VERSION = 15;
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
2. **Before Implementation:** Run \`totem spec <issue-url-or-topic>\` to retrieve related context (lessons, specs, code) before writing code. Treat any generated plan as one retrieval input, never the contract — derive the actual design from primary sources (the issue, the code, project doctrine). Under the strict hook tier — which AI agents get automatically — this is REQUIRED, not optional: the pre-commit hook blocks until the checkout carries an ANCHORED \`totem spec\` run artifact, and prints the evidence it found. ANCHORED means the run was grounded on an ISSUE, or on a hand-authored design record bound with \`totem spec --from <record>\` — and that its SUBJECT carries the shape the command promises: for an issue run, every required heading with a non-empty body (or, when your project overrides the spec system prompt, just one heading with a body — a custom prompt is not held to the built-in skeleton); for a bound record, at least one heading with a body in the RECORD's own bytes, re-read from disk at commit time. A free-text topic run is NOT evidence (that is the confabulation surface the rule exists for), and neither is an artifact written before this rule — re-run it anchored. A response served from the cache writes no artifact, so add \`--fresh\` when the gate says there is nothing new (mmnto-ai/totem#2690, mmnto-ai/totem#2700). Under the same strict tier the pre-push hook additionally blocks a legs-owed push — a diff touching the paths in \`hooks.legsOwed.globs\` (doctrine, public copy, \`.changeset/**\` and the contract classes your project declares) — until the checkout carries a fresh leg deposit for its head, written with \`totem legs deposit --sha HEAD --from <findings.json>\` once the leg returns, and the gate prints the evidence it found (mmnto-ai/totem#2698). That legs gate can also be armed on its own, at any tier, with \`hooks.legsOwed.enforce: 'block'\` — a standard-tier install then refuses a legs-owed push too, and the gate's line names the key (mmnto-ai/totem#2771).
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

// ─── merge-ready: \`gh pr merge\` at COMMAND POSITION + its payload ──────
//
// One walk over the command text does BOTH jobs, so recognition and argv
// extraction can never disagree: it tracks quoting, splits on the unquoted
// command separators (\`;\`, \`&\`, \`|\`, a newline, \`(\`/\`)\`, \`{\`/\`}\`) and
// tokenizes each segment. A segment whose FIRST token is \`gh\`, followed by
// \`pr\` and \`merge\`, is a merge at command position; a quoted
// "gh pr merge" is a single token and never matches, so
// \`echo "gh pr merge"\` does not fire. Leading shell keywords (\`do\`,
// \`then\`, \`else\`, \`!\`) are skipped so \`for … ; do gh pr merge; done\` fires.
//
// HEREDOC BODIES ARE BLANKED FIRST (mmnto-ai/totem#2800 fold F4). A heredoc
// body is DATA, not commands: \`cat <<EOF\` … \`gh pr merge 5\` … \`EOF\` writes a
// line of text and merges nothing, and firing there was a false deny — the one
// direction this projection must not have. The blanker is the shape core's
// transport-shield scanner uses, in a self-contained form because a distributed
// hook cannot import core: quoted (\`<<'EOF'\`, \`<<"EOF"\`, \`<<\\EOF\`) and bare
// delimiters, \`<<\` and \`<<-\` (whose terminator may be tab-indented), an
// unterminated body read to the end of the command, and \`<<<\` left alone (a
// here-string is not a heredoc). Round 2 added the two guards that keep the
// blanker from EATING commands: \`$(( … ))\` / \`(( … ))\` is skipped whole, so a
// shift (\`$((1<<2))\`) opens nothing, and a \`#\` that begins a word is a comment
// discarded to end-of-line, so neither its text nor a \`<<note\` inside it is
// read — before them, either one swallowed the rest of the command and a real
// merge after it went unjudged. Every \`<<\` on the operator line is queued and
// its body consumed in order, as bash does for \`cat <<A <<B\`.
//
// Disclosed misses, same posture as transport-shield's scanner — the gate does
// NOT fire, which is the safe direction, never a false deny:
//   - an env-assignment prefix (\`GH_TOKEN=x gh pr merge 5\`): the assignment is
//     the segment's first token, so the position anchor does not see \`gh\`;
//   - a wrapper program that takes operands before \`gh\` (\`sudo\`, \`timeout 30\`,
//     \`npx\`), for the same reason;
//   - PowerShell's own quoting (backtick escapes, here-strings) is not
//     modelled — the walk reads POSIX quoting for both tools.
// Which characters END a word, so the scanner can say whether the next one
// BEGINS one. Same set core's scanner uses (mmnto-ai/totem#2800 round 2, F1).
function isWordBoundary(ch) {
  return (
    ch === ' ' ||
    ch === '\\t' ||
    ch === '\\r' ||
    ch === '\\n' ||
    ch === ';' ||
    ch === '|' ||
    ch === '&'
  );
}

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

function blankHeredocBodies(command, powershell) {
  let out = '';
  let i = 0;
  let quote = '';
  let boundary = true;
  let pending = [];

  // Consume EVERY body queued on the operator line, in order, starting just
  // past that line's newline — bash reads \`cat <<A <<B\` as two bodies, so a
  // command sitting in B's body is data too (F2). Terminator lines are kept;
  // body lines are dropped with their newlines, so the segments around them
  // stay separated exactly as the shell separates them. An unterminated body
  // runs to the end and is dropped whole.
  const consumeBodies = (from) => {
    let cursor = from;
    for (let p = 0; p < pending.length; p++) {
      const h = pending[p];
      let at = cursor;
      cursor = command.length;
      while (at <= command.length) {
        const nl = command.indexOf('\\n', at);
        const stop = nl === -1 ? command.length : nl;
        let line = command.slice(at, stop);
        if (h.stripTabs) line = line.replace(/^\\t+/, '');
        line = line.replace(/\\r$/, '');
        const next = nl === -1 ? command.length : nl + 1;
        if (line === h.delimiter) {
          out += command.slice(at, next);
          cursor = next;
          break;
        }
        if (nl === -1) break;
        out += '\\n';
        at = next;
      }
    }
    pending = [];
    return cursor;
  };

  while (i < command.length) {
    const ch = command[i];
    if (quote !== '') {
      out += ch;
      if (ch === '\\\\' && quote === '"' && i + 1 < command.length) {
        out += command[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      boundary = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      boundary = false;
      continue;
    }
    // A backslash before a NEWLINE is a line continuation: the shell removes
    // both characters and the command carries on, so the scanner must too
    // (mmnto-ai/totem#2800 round 3, F6). Absorbing the newline into a token is
    // what hid \`gh \\<LF>pr merge 5\` from the position anchor.
    if (ch === '\\\\' && (command[i + 1] === '\\n' || (command[i + 1] === '\\r' && command[i + 2] === '\\n'))) {
      i += command[i + 1] === '\\r' ? 3 : 2;
      continue;
    }
    if (ch === '\\\\' && i + 1 < command.length) {
      out += ch + command[i + 1];
      i += 2;
      boundary = false;
      continue;
    }
    // A \`#\` that BEGINS a word is a comment: discarded to the end of the line
    // WITHOUT quote processing, so neither its text nor a \`<<note\` inside it
    // reaches the tokenizer (F1). The newline stays — it may end an operator
    // line whose bodies are still queued.
    if (ch === '#' && boundary) {
      const nl = command.indexOf('\\n', i);
      i = nl === -1 ? command.length : nl;
      continue;
    }
    // PowerShell's \`<# … #>\` block comment is data, not commands: blank it
    // whole, the way a heredoc body is blanked (round 3, F8). Applied ONLY when
    // the TOOL is PowerShell (round 4, F8): bash has no such comment, and there
    // \`sort <#tmp\` is a redirect from a file named \`#tmp\` — blanking from it
    // to a later \`#>\` would swallow real commands. A \`<#\` inside a quoted
    // string never reaches here, because the quote arms run first.
    if (powershell && ch === '<' && command[i + 1] === '#') {
      const close = command.indexOf('#>', i + 2);
      i = close === -1 ? command.length : close + 2;
      boundary = true;
      continue;
    }
    if (ch === '$' && command.slice(i, i + 3) === '$((') {
      const end = skipArithmetic(command, i + 3);
      out += command.slice(i, end);
      i = end;
      boundary = false;
      continue;
    }
    if (ch === '(' && command[i + 1] === '(' && boundary) {
      const end = skipArithmetic(command, i + 2);
      out += command.slice(i, end);
      i = end;
      boundary = false;
      continue;
    }
    // \`<<\` opens a heredoc; \`<<<\` is a here-string and is left alone.
    if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      let j = i + 2;
      let head = '<<';
      let dash = false;
      if (command[j] === '-') {
        dash = true;
        head += '-';
        j++;
      }
      while (j < command.length && (command[j] === ' ' || command[j] === '\\t')) {
        head += command[j];
        j++;
      }
      // The delimiter word, quoted (\`<<'EOF'\`, \`<<"EOF"\`) or bare, with a
      // backslash-quoted form (\`<<\\EOF\`) read as bash reads it.
      let delim = '';
      const q = command[j] === "'" || command[j] === '"' ? command[j] : '';
      if (q !== '') {
        head += q;
        j++;
      }
      while (j < command.length) {
        const c = command[j];
        if (q !== '') {
          head += c;
          j++;
          if (c === q) break;
          delim += c;
          continue;
        }
        if (c === '\\\\' && j + 1 < command.length) {
          head += c + command[j + 1];
          delim += command[j + 1];
          j += 2;
          continue;
        }
        if (/[A-Za-z0-9_.\\-\\/]/.test(c)) {
          head += c;
          delim += c;
          j++;
          continue;
        }
        break;
      }
      out += head;
      i = j;
      boundary = false;
      if (delim !== '') pending.push({ delimiter: delim, stripTabs: dash });
      continue;
    }
    if (ch === '\\n') {
      out += '\\n';
      i += 1;
      if (pending.length > 0) i = consumeBodies(i);
      boundary = true;
      continue;
    }
    out += ch;
    boundary = isWordBoundary(ch);
    i++;
  }
  return out;
}

function ghPrMergeArgs(rawCommand, powershell) {
  const command = blankHeredocBodies(rawCommand, powershell === true);
  const segments = [];
  let current = [];
  let token = '';
  let hasToken = false;
  let i = 0;
  const endToken = () => {
    if (hasToken) {
      current.push(token);
      token = '';
      hasToken = false;
    }
  };
  const endSegment = () => {
    endToken();
    segments.push(current);
    current = [];
  };
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      hasToken = true;
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

  for (const segment of segments) {
    let tokens = segment;
    while (
      tokens.length > 0 &&
      (tokens[0] === 'do' || tokens[0] === 'then' || tokens[0] === 'else' || tokens[0] === '!')
    ) {
      tokens = tokens.slice(1);
    }
    if (tokens.length >= 3 && tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') {
      return tokens.slice(3);
    }
  }
  return null;
}

/** Run git read-only and return trimmed stdout, or '' when it did not answer. */
function gitRead(args) {
  const res = spawnSync('git', args, { encoding: 'utf-8', timeout: 10000 });
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
  let payload = '';

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
    payload = JSON.stringify({ subsystem: declaredSubsystem });
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
    payload = JSON.stringify({
      tool: tool,
      command: input.command,
      platform: process.platform,
    });
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
    const mergeArgs = ghPrMergeArgs(input.command, tool === 'PowerShell');
    if (mergeArgs === null) {
      process.exit(0);
    }
    payload = JSON.stringify(projectMergeReady(mergeArgs));
  } else {
    // A baked --event this wrapper cannot project is an APPLICABLE gate it
    // cannot evaluate → fail closed (ADR-109). Reinstalling refreshes the
    // wrapper (\`totem gate install\` drift-repairs the bounded region).
    process.stderr.write(
      '[totem gate-wrapper] no payload projection for event "' + event + '"; failing closed.\\n',
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
  const result = spawnSync(process.execPath, checkArgs, {
    encoding: 'utf-8',
    timeout: 30000,
    input: payload,
  });

  // ─── The child's stderr IS a gate surface (fold F1) ────────────────────
  // merge-ready's audited-override line, its zero-checks fact and every
  // "could not derive" line are written by the ENGINE to stderr. Passing them
  // through verbatim in EVERY arm — allow included — is what puts them in the
  // transcript; printing them only on failure hid the override's audit trail,
  // the one line that must never be silent.
  if (typeof result.stderr === 'string' && result.stderr !== '') {
    process.stderr.write(result.stderr);
  }

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

  // ─── FAIL-CLOSED ──────────────────────────────────────────────────────
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

  // ─── Disposition → host exit code (branch ONLY on disposition) ─────────
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

  // Unknown disposition from an applicable gate — fail-closed. The provenance
  // note rides here too, so all four not-evaluable causes in the exit-code
  // contract above disclose which arm evaluated.
  process.stderr.write(
    '[totem gate-wrapper] gate "' + event + '" returned unknown disposition "' + disposition + '" — blocking (fail-closed).\\n' + armNote,
  );
  process.exit(2);
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

   a. **Identify your agent-id** from the current repo's basename. The hardcoded map (Proposal 282 § Scope item 3 — keep in sync with the ADR-106 cohort list):

   | Repo (\`git rev-parse --show-toplevel\` basename) | Claude agent-id                     | Gemini agent-id   | Kimi agent-id     |
   | ----------------------------------------------- | ----------------------------------- | ----------------- | ----------------- |
   | \`totem\`                                         | \`totem-claude\`                      | \`totem-gemini\`    | \`totem-kimi\`      |
   | \`totem-strategy\`                                | \`strategy-claude\`                   | \`strategy-gemini\` | _(not seated)_    |
   | \`liquid-city\`                                   | \`lc-claude\`                         | \`lc-gemini\`       | _(not seated)_    |
   | \`arhgap11\`                                      | \`arhgap11-claude\`                   | \`arhgap11-gemini\` | _(not seated)_    |
   | \`totem-status\`                                  | \`status-claude\`                     | \`status-gemini\`   | _(not seated)_    |
   | \`totem-playground\`                              | _(orphan stream — no native agent)_ | _(orphan stream)_ | _(orphan stream)_ |

   Seat discovery is dir-derived (mmnto-ai/totem#2141): any \`.totem/orchestration/<agent-id>/\` directory registers that seat for this repo, UNIONED with the basename map above so roster siblings stay visible on fresh clones where the gitignored tree is partial (precedence: \`TOTEM_SELF_AGENT\` env > \`config.json\` \`host_agents\` > seat dirs ∪ basename map). Override hook: a \`host_agents: string[]\` field in \`.totem/orchestration/config.json\` still **replaces** the derived answer — but omitting a PRESENT seat dir attaches a loud warning naming the omitted seat (the dir is the registration; config-exclusion is not a decommission mechanism). The returned list of agent-ids is used by consumers (e.g., \`totem mail\`) to filter cross-repo handoffs — messages addressed to any agent-id in the list belong to this repo's session.

   **Visiting case.** If your row's Claude-agent-id column is \`_(no Claude variant)_\` or \`_(orphan stream — no native agent)_\`, you are visiting a repo that doesn't natively host your agent. Resolve the journal path to \`<repoRoot>/.totem/orchestration/<your-home-agent-id>/journal/\`, where \`<your-home-agent-id>\` is your own agent-id (e.g., a \`strategy-claude\` session always writes as \`strategy-claude\` regardless of which repo it's visiting; concretely, \`strategy-claude\` visiting \`totem-status\` writes to \`totem-status/.totem/orchestration/strategy-claude/journal/\`). The journal records the visiting agent's session state — the host repo doesn't need a native Claude agent to be a valid write target.

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

1. **Consume the injected orientation.** On Claude Code seats a SessionStart hook may inject a journal + carryforward, inbound mail, branch/ticket-matched context, and a bounded session-orientation slice (parked/freeze state, open PRs, board↔issue coherence drift, and an open-issue-count pointer) — the hook serves the seat it is CONFIGURED for, not a derived identity, so confirm the injected journal is YOURS: a visiting session receives the HOST seat's, and your carryforward derives from \`.totem/orchestration/<your-seat>/journal/\` (step 3), never from a foreign journal. On a hook-seat MISMATCH (the injected journal or mail banner names another seat), consume NONE of the injected material — treat the session as hook-less: derive it all via \`totem orient\` plus your own seat-anchored poll (step 2). Do not re-run what the hook injected. Everything else the bring-up needs (the full board in-flight set, corpus freshness, doctrine currency) is derived on demand via \`totem orient\`. On a hook-less seat (other vendors, cold starts), derive it all: \`totem orient\`.

2. **Poll mail since last signoff — seat-anchored.** Poll AS YOUR SEAT: per-shell \`TOTEM_SELF_AGENT=<your-seat>\` (the mmnto-ai/totem#2629 scope ruling — never user/machine scope; prefer the inline form \`TOTEM_SELF_AGENT=<seat> totem mail\` where shell state does not persist between tool calls) or \`totem mail --as <your-seat>\`. **S0 identity check:** the banner's \`Self agents:\` line must name exactly your seat. Since @mmnto/cli 1.117.0 an identity-less multi-seat poll gates itself (broadcast-only serve, directed mail withheld as a count, exit 2 — the mmnto-ai/totem#2204 deterministic floor), so the residual S0 catches is the WRONG-single-identity class: a mis-scoped or inherited env naming a foreign seat resolves single-seat, ungated, and serves that seat's directed mail. A banner naming a FOREIGN seat = STOP: act on nothing served, propagate nothing from it, fix the identity, re-poll. A GATED poll's LISTING is broadcast-only by construction — but warning lines can still name an unclassifiable or unresolvable file (an ECL basename is recipient + compressed subject — the CLI's named limit), so propagate nothing from a gated poll's warnings either: fix the identity and re-poll for your directed mail. An \`Error:\` line is the same surface: since the mmnto-ai/totem#2685 fix a poll whose OWN outbox (one this repo hosts for a resolved seat) carries a dispatch with an unresolvable \`to:\` exits 4 (SENDER FAULT) — the verdict IS derived, read it, but the \`to:\` is yours to fix first (one recipient per dispatch, or broadcast; a comma list is never a recipient), and propagate nothing from the fault line; exit 2 stays NOT-DERIVED and wins when both hold. Unread = inbound − handled: consumption is tracked by \`processed/\` marks (\`feedback_check_outbox_before_replying\`), so the CLI path needs no cutoff stamp. Read every hit before proceeding — new mail can reprioritize everything below. (Fallback — a seat that must stamp-poll instead derives the cutoff from the newest journal's CONTENT date, the filename stamp or frontmatter, **never file mtime**, which git resets on clone/worktree and silently reports "inbox clean" over waiting mail; mmnto-ai/totem-strategy#813.)

3. **Re-derive the carryforward gates — don't trust the journal's framing** (Tenet 20 read-side twin). For each carryforward item in YOUR SEAT's latest journal (\`.totem/orchestration/<your-seat>/journal/\` — on a multi-seat repo another seat's newer journal is not your carryforward), freshly derive its gate state (the PR it waits on, the issue, the date, the release train) via \`gh\` / \`git\` reads. Cross-repo gates resolve through the frozen cohort roster — \`totem\` / \`strategy\` / \`status\` / \`lc\` → \`mmnto-ai/{totem, totem-strategy, totem-status, liquid-city}\` (mmnto-ai/totem-strategy#611 gates any change). An item whose gate fired leads the next-steps list; an item still gated is reported as waiting, not worked.

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

Print a summary of actions taken, then — when the round is being dispositioned — assemble and post the single consolidated round-disposition comment (see the section below), which EXECUTES \`totem review --covariate\` to carry the \`local-lane:\` line, on the operator's explicit go. Then exit.

## CRITICAL: GCA Reply Protocol

**NEVER reply individually to GCA bot comments.** GCA has a quota and will NOT respond to replies unless they contain \`@gemini-code-assist\`. Always batch ALL GCA responses into a single PR-level comment using the issue comments API endpoint (\`/issues/{pr}/comments\`), not the review comments reply endpoint.

## Consolidated round-disposition comment (a concrete step, operator-gated)

Disposing the round is ONE consolidated comment (single-comment ownership per bot-protocols) — a real, numbered step of the flow, NOT an optional aside. Like every GitHub mutation in this skill it is operator-gated: assemble the body, show it, and post ONLY on an explicit human go. Run this as part of \`done\` (or whenever the operator asks to post the round disposition):

1. **Obtain the covariate line — execute the verb, never hand-author it.** Run the read-only, zero-LLM command and capture its stdout:

\`\`\`bash
totem review --covariate
\`\`\`

It resolves the current branch lineage exactly as the review fan does and prints the canonical \`local-lane:\` line from the core-owned renderers — the LATEST verdict artifact's line (\`.totem/artifacts/verdicts/\`) when the current diff is admitted, or the exact-identity admission record's \`not-applicable\` form (\`.totem/artifacts/admissions/\`, format v1.1, mmnto-ai/totem#2473) when the current diff is a deterministic skip — never trust a pasted or hand-copied value. Under format v1.2 (mmnto-ai/totem#2698) every shape carries the appended \`leg: <sha8> blocking=<n> material=<n> folded=<n>\` field (or \`leg: none\`), and a lineage with no artifact of either family but a leg deposit for HEAD prints the \`local-lane: none\` head shape — carry whatever the verb prints, verbatim. If it reports no line at all, there is none to carry (note that in the body and continue).

2. **Assemble the single body.** One comment: @-tag EVERY bot addressed in the round — exactly ONE tag each (e.g. \`@gemini-code-assist\`, \`@coderabbitai\`, \`@greptileai\`) so each bot registers the disposition, and tags must be present when the comment is POSTED, never edited in (GCA's listener fires on comment-created only). One notification per bot per round: a bot with nothing addressed gets no tag, and a bot already @-tagged in this round's batch comment (the GCA defer/nit batch above) is NOT re-tagged here. ghcq (\`github-code-quality[bot]\`) has no known listener — it is never tagged; its items are dispositioned in the body for the audit trail only (mmnto-ai/totem#2626). Never combine a tag with ANY bot's review trigger — triggers are standalone comments, one trigger and no prose (a trigger embedded in a content-rich comment chat-routes the bot). Then the per-item dispositions (fixed / deferred / nit / extracted) followed by the non-empty \`local-lane:\` line from step 1, verbatim. The local \`review-loop\` holds this line but never posts it, so \`/review-reply\` is the SOLE path that carries it to GitHub.

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

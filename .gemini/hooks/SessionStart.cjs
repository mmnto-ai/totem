// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem describe` at the start of every Gemini CLI session to emit
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
    // log and hands the child the same fd, so the verb's own success line
    // lands after the stamp; a stamp with nothing after it means the child
    // never finished. Log failures degrade to the previous blind firing —
    // the stamp must never block or break the spawn.
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
    const scrub = (v) => String(v).replace(/[\x00-\x1f\x7f]/g, '?');
    let stdio = 'ignore';
    let logFd = null;
    try {
      try {
        // 1 MiB self-cap: the log truncates rather than growing forever.
        if (statSync(logPath).size > 1048576) writeFileSync(logPath, '');
      } catch {
        // no log yet — nothing to cap
      }
      appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + '\n');
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
        appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn-error code=' + ((err && err.code) || 'unknown') + '\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
    });
    refresh.unref();
    // The child holds its own copy of the fd from spawn time; release the parent's.
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // nothing to release
      }
    }
  }
} catch (err) {
  process.stderr.write('[SessionStart] totem-status refresh-gh unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
}

// Interactive Gemini ingests SessionStart output ONLY from the
// hookSpecificOutput.additionalContext envelope — plain exit-0 stdout wraps as
// systemMessage, which the interactive startup consumer never reads, so the
// briefing was silently dropped in the primary dev flow even once registered
// (mmnto-ai/totem#2613; leg-verified against @google/gemini-cli 0.54.4).
// systemMessage rides alongside the envelope: /clear renders ONLY
// systemMessage (as a UI info item) and -p prints it to stderr — without it
// those surfaces lose the briefing entirely; the interactive consumer ignores
// systemMessage, so nothing double-renders.
// The Totem CLI writes its banner and diagnostics to STDERR, so capture takes
// BOTH streams — the same seam the Claude-side template documents; a
// stdout-only capture silently drops the describe leg (mmnto-ai/totem#2613
// falsification round).
// Per-leg 20s budgets cut the measured worst-case process exit from 60s to
// 40s against Gemini's 60s DEFAULT_HOOK_TIMEOUT. Residual (pre-existing): the
// vendor keys hook completion on stream CLOSURE, so a hung grandchild holding
// a pipe can stall the hook past any inner budget.
let briefing = '';
try {
  const describeRun = spawnSync('totem describe', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // spawnSync sets .error (it does NOT throw) on a spawn-level failure.
  if (describeRun.error) throw describeRun.error;
  if (describeRun.status !== 0) {
    throw new Error((describeRun.stderr || '').trim() || 'totem describe exited ' + describeRun.status);
  }
  briefing += (describeRun.stdout || '') + (describeRun.stderr || '');
} catch (err) {
  // Fail-soft (exit 0, never blocks boot): the unavailable note rides the
  // envelope so it still reaches interactive context.
  briefing += '[Totem] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\n';
}

// totem orient --session — live derived in-flight state, ADDITIVE to describe
// (mmnto-ai/totem#2044 PR-3). Own try/catch; orient --session is itself boot-safe.
try {
  const orientRun = spawnSync('totem orient --session', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (orientRun.error) throw orientRun.error;
  if (orientRun.status !== 0) {
    throw new Error((orientRun.stderr || '').trim() || 'totem orient exited ' + orientRun.status);
  }
  briefing += (orientRun.stdout || '') + (orientRun.stderr || '');
} catch (err) {
  // Boot-safe: orient is additive to describe; a failure never blocks session start —
  // surface a NON-fatal breadcrumb (matches the Claude-side hook) rather than swallow.
  process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
}

process.stdout.write(JSON.stringify({
  systemMessage: briefing,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing },
}) + '\n');
// [totem] end auto-generated

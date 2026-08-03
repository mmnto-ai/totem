// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem describe` at the start of every Gemini CLI session to emit
// the project-orientation banner ("[Describe] Project: ... Lessons: N
// Targets: N Hooks: ..."). Matches the family-canonical pattern used by
// totem-strategy, totem-substrate, arhgap11, and totem-status, and
// matches the Claude-side SessionStart hook scaffolded by this same init
// pass (mmnto-ai/totem#1884).
const { execSync } = require('child_process');

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

try {
  execSync('totem describe', {
    timeout: 30000,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (err) {
  process.stdout.write('[Totem] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\n');
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
  process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
}
// [totem] end auto-generated

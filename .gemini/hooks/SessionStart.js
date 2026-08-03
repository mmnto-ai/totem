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
// A non-git cwd has no refresh moment at all.
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
    const refresh = spawn('totem-status', ['refresh-gh'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    refresh.on('error', (err) => {
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
    });
    refresh.unref();
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

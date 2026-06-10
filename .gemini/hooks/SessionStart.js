// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem describe` at the start of every Gemini CLI session to emit
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

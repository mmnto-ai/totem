// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem briefing` at the start of every Gemini CLI session.
const { execSync } = require('child_process');

try {
  const output = execSync('node packages/cli/dist/index.js briefing', {
    encoding: 'utf-8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stderr.write(output);
} catch (err) {
  process.stderr.write(
    '[Totem Error] Briefing unavailable: ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem status` at the start of every Gemini CLI session.
const { execSync } = require('child_process');

try {
  execSync('node packages/cli/dist/index.js status', {
    timeout: 30000,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
} catch (err) {
  process.stderr.write(
    '[Totem Error] Status unavailable: ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

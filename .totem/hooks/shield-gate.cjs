// [totem] auto-generated — Claude Code shield gate hook
// Intercepts git push/commit to run `totem shield` before proceeding.
const { execSync } = require('child_process');

const input = process.env.TOOL_INPUT || '';
if (/git/.test(input) && /(push|commit)/.test(input)) {
  try {
    execSync('node packages/cli/dist/index.js shield --deterministic', {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'inherit',
    });
  } catch (err) {
    process.exit(1);
  }
}

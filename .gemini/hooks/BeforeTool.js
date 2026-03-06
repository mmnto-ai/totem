// [totem] auto-generated — Gemini CLI BeforeTool hook
// Intercepts git push/commit to run `totem shield` before proceeding.
const { execSync } = require('child_process');

module.exports = function beforeTool(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return;
  const cmd = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);
  if (!/git\s+(push|commit)/.test(cmd) && !/["']git["'].*["'](push|commit)["']/.test(cmd)) return;

  try {
    execSync('totem shield', { encoding: 'utf-8', timeout: 60000, stdio: 'inherit' });
  } catch (err) {
    throw new Error(
      '[Totem Error] Shield check failed. Fix violations before pushing.\n' + err.message,
    );
  }
};

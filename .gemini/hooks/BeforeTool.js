// [totem] Phase-gate enforcement — Gemini CLI BeforeTool hook (ADR-063)
// Gate 1: Block git commit if /preflight hasn't been run
// Gate 2: Run totem shield before git push
const { execSync } = require('child_process');
const fs = require('fs');

module.exports = function beforeTool(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return;
  const cmd = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput);

  const isCommit = /\bgit\b.*\bcommit\b/.test(cmd);
  const isPush = /\bgit\b.*\bpush\b/.test(cmd);

  if (!isCommit && !isPush) return;

  // ─── Gate 1: Spec before commit (hard block) ──
  if (isCommit) {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
      const exempt = /^(main|master|HEAD)$|^(hotfix|docs)\//.test(branch);
      if (!exempt && !fs.existsSync('.totem/cache/.spec-completed')) {
        throw new Error(
          `[Totem Error] BLOCKED: /preflight has not been run on branch '${branch}'.\n` +
            'Run totem spec <issue> first. This gate enforces ADR-063.',
        );
      }
    } catch (err) {
      // Re-throw all errors — if we can't determine the branch, fail-closed
      throw err;
    }
  }

  // ─── Gate 2: Shield before push ──
  if (isPush) {
    try {
      execSync('node packages/cli/dist/index.js shield', {
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'inherit',
      });
    } catch (err) {
      throw new Error(
        '[Totem Error] Shield check failed. Fix violations before pushing.\n' + err.message,
      );
    }
  }
};

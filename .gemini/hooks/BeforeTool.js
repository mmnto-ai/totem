// [totem] Phase-gate enforcement — Gemini CLI BeforeTool hook (ADR-063)
// Gate 1: Block git commit if /preflight hasn't been run
// Gate 2: Run totem shield before git push
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Spec evidence (mmnto-ai/totem#2690): a `totem spec` run artifact under
// .totem/artifacts/runs/ whose TOP-LEVEL admission.runMetadata.caller is "spec"
// (the mmnto-ai/totem#2100 grounded run record — written on every successful
// run, --fresh included), else the legacy hand-set .totem/cache/.spec-completed
// marker. JSON-aware on purpose: a substring test would match a `review`
// artifact whose prompt merely QUOTES the key. Same rule as the managed git
// pre-commit hook (install-hooks.ts buildPreCommitHook). NOTE: this file is not
// registered in .gemini/settings.json (only SessionStart is) — it stays inert
// until mmnto-ai/totem#2487 arms a BeforeTool hook; the rule is kept in step so
// the two readers cannot diverge when it is.
function hasSpecEvidence(gitRoot) {
  const runsDir = path.join(gitRoot, '.totem', 'artifacts', 'runs');
  let names = [];
  try {
    names = fs.readdirSync(runsDir);
    // totem-context: intentional cleanup — a missing run store is simply "no evidence"; the loud surface is the BLOCKED throw below.
  } catch (_err) {
    names = [];
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf-8'));
      if (a && a.admission && a.admission.runMetadata && a.admission.runMetadata.caller === 'spec') {
        return true;
      }
      // totem-context: intentional cleanup — a torn/unparseable artifact is not evidence; keep scanning, the BLOCKED throw below stays loud.
    } catch (_err) {
      continue;
    }
  }
  return fs.existsSync(path.join(gitRoot, '.totem', 'cache', '.spec-completed'));
}

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
      const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
      const exempt = /^(main|master|HEAD)$|^(hotfix|docs)\//.test(branch);
      if (!exempt && !hasSpecEvidence(gitRoot)) {
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

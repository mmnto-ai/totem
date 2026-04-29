/**
 * `totem proposal new <title>` — scaffolding entry point (mmnto/totem#1288).
 *
 * Resolves the strategy repo layout (submodule or standalone), writes the
 * next NNN-prefixed proposal under `proposals/active/`, refreshes the
 * dashboard via `pnpm run docs:inject`, and stages the two mutated paths.
 * All orchestration logic lives in `../utils/governance.ts`; this file is
 * the thin CLI adapter that prints the user-facing summary.
 */

const TAG = 'Proposal';

export interface ProposalNewOptions {
  /** Override the cwd (test seam). Defaults to `process.cwd()`. */
  cwd?: string;
}

export async function proposalNewCommand(
  title: string,
  options: ProposalNewOptions = {},
): Promise<void> {
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const { scaffoldGovernanceArtifact } = await import('../utils/governance.js');

  const cwd = options.cwd ?? process.cwd();
  const { loadGovernanceConfig } = await import('../utils/governance.js');
  const config = await loadGovernanceConfig(cwd);
  const result = scaffoldGovernanceArtifact({ type: 'proposal', title, cwd, config });

  const relPath = path.relative(cwd, result.filePath);
  const dashboardSummary = result.dashboardRefreshed
    ? 'dashboard refreshed'
    : 'dashboard refresh skipped (manual required)';
  const stagedSummary = result.staged ? 'staged' : 'not staged (manual git add required)';

  log.success(TAG, `Scaffolded ${bold(relPath)}; ${dashboardSummary}; ${stagedSummary}.`);
}

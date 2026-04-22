/**
 * `totem adr new <title>` — scaffolding entry point (mmnto/totem#1288).
 *
 * Resolves the strategy repo layout (submodule or standalone), writes the
 * next NNN-prefixed ADR under `adr/`, refreshes the dashboard via
 * `pnpm run docs:inject`, and stages the two mutated paths. All
 * orchestration logic lives in `../utils/governance.ts`; this file is the
 * thin CLI adapter that prints the user-facing summary.
 */

const TAG = 'ADR';

export interface AdrNewOptions {
  /** Override the cwd (test seam). Defaults to `process.cwd()`. */
  cwd?: string;
}

export async function adrNewCommand(title: string, options: AdrNewOptions = {}): Promise<void> {
  const path = await import('node:path');
  const { log, bold } = await import('../ui.js');
  const { scaffoldGovernanceArtifact } = await import('../utils/governance.js');

  const cwd = options.cwd ?? process.cwd();
  const result = scaffoldGovernanceArtifact({ type: 'adr', title, cwd });

  const relPath = path.relative(cwd, result.filePath);
  const dashboardSummary = result.dashboardRefreshed
    ? 'dashboard refreshed'
    : 'dashboard refresh skipped (manual required)';
  const stagedSummary = result.staged ? 'staged' : 'not staged (manual git add required)';

  log.success(TAG, `Scaffolded ${bold(relPath)}; ${dashboardSummary}; ${stagedSummary}.`);
}

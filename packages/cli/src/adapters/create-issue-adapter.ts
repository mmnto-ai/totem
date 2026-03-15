import type { TotemConfig } from '@mmnto/totem';

import type { IssueAdapter } from './issue-adapter.js';

/**
 * Create the appropriate issue adapter based on config.
 * If `repositories` is set, returns a MultiRepoAdapter that aggregates issues.
 * Otherwise, returns a standard GitHubCliAdapter that uses the current repo.
 */
export async function createIssueAdapter(cwd: string, config: TotemConfig): Promise<IssueAdapter> {
  if (config.repositories && config.repositories.length > 0) {
    const { createMultiRepoAdapter } = await import('./multi-repo-adapter.js');
    return createMultiRepoAdapter(cwd, config.repositories);
  }
  const { GitHubCliAdapter } = await import('./github-cli.js');
  return new GitHubCliAdapter(cwd);
}

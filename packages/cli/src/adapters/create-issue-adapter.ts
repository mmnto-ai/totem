import type { TotemConfig } from '@mmnto/totem';

import { GitHubCliAdapter } from './github-cli.js';
import type { IssueAdapter } from './issue-adapter.js';
import { MultiRepoAdapter } from './multi-repo-adapter.js';

/**
 * Create the appropriate issue adapter based on config.
 * If `repositories` is set, returns a MultiRepoAdapter that aggregates issues.
 * Otherwise, returns a standard GitHubCliAdapter that uses the current repo.
 */
export function createIssueAdapter(cwd: string, config: TotemConfig): IssueAdapter {
  if (config.repositories && config.repositories.length > 0) {
    return new MultiRepoAdapter(cwd, config.repositories);
  }
  return new GitHubCliAdapter(cwd);
}

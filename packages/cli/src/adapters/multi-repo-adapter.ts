import type { GitHubCliAdapter } from './github-cli.js';
import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';

/**
 * Aggregates issues from multiple GitHub repositories.
 * Each issue is tagged with its source repo.
 */
export class MultiRepoAdapter implements IssueAdapter {
  private adapters: GitHubCliAdapter[] = [];
  private initialized = false;
  private cwd: string;
  private repositories: string[];

  constructor(cwd: string, repositories: string[]) {
    this.cwd = cwd;
    this.repositories = repositories;
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    const { GitHubCliAdapter: Adapter } = await import('./github-cli.js');
    this.adapters = this.repositories.map((repo) => new Adapter(this.cwd, repo));
    this.initialized = true;
  }

  fetchIssue(issueNumber: number): StandardIssue {
    // Sync — adapters must be initialized first
    if (!this.initialized) {
      throw new Error('[Totem Error] MultiRepoAdapter not initialized. Call init() first.');
    }
    const errors: string[] = [];
    for (const adapter of this.adapters) {
      try {
        return adapter.fetchIssue(issueNumber);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    throw new Error(
      `[Totem Error] Issue #${issueNumber} not found in any configured repository.\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
  }

  fetchOpenIssues(limit?: number): StandardIssueListItem[] {
    if (!this.initialized) {
      throw new Error('[Totem Error] MultiRepoAdapter not initialized. Call init() first.');
    }
    const allIssues: StandardIssueListItem[] = [];
    for (const adapter of this.adapters) {
      try {
        allIssues.push(...adapter.fetchOpenIssues(limit));
      } catch {
        // Non-fatal: if one repo fails, still return issues from others
      }
    }

    // Sort by updatedAt descending (most recent first)
    allIssues.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return allIssues;
  }
}

/** Create and initialize a MultiRepoAdapter. */
export async function createMultiRepoAdapter(
  cwd: string,
  repositories: string[],
): Promise<MultiRepoAdapter> {
  const adapter = new MultiRepoAdapter(cwd, repositories);
  await adapter['init']();
  return adapter;
}

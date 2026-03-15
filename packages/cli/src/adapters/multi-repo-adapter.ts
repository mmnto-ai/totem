import { GitHubCliAdapter } from './github-cli.js';
import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';

/**
 * Aggregates issues from multiple GitHub repositories.
 * Each issue is tagged with its source repo.
 */
export class MultiRepoAdapter implements IssueAdapter {
  private adapters: GitHubCliAdapter[];

  constructor(cwd: string, repositories: string[]) {
    this.adapters = repositories.map((repo) => new GitHubCliAdapter(cwd, repo));
  }

  fetchIssue(issueNumber: number): StandardIssue {
    // Try each repo until we find the issue
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

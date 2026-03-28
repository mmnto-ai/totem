import { TotemError } from '@mmnto/totem';

import type { GitHubCliAdapter } from './github-cli.js';
import type { IssueAdapter, StandardIssue, StandardIssueListItem } from './issue-adapter.js';

/**
 * Aggregates issues from multiple GitHub repositories.
 * Each issue is tagged with its source repo.
 */
export class MultiRepoAdapter implements IssueAdapter {
  private adapters: GitHubCliAdapter[];
  private warn: (msg: string) => void;

  private constructor(adapters: GitHubCliAdapter[], warn: (msg: string) => void) {
    this.adapters = adapters;
    this.warn = warn;
  }

  /** Public async factory — dynamically imports GitHubCliAdapter. */
  static async create(
    cwd: string,
    repositories: string[],
    warn?: (msg: string) => void,
  ): Promise<MultiRepoAdapter> {
    const { GitHubCliAdapter: Adapter } = await import('./github-cli.js');
    const adapters = repositories.map((repo) => new Adapter(cwd, repo));
    return new MultiRepoAdapter(adapters, warn ?? (() => {}));
  }

  fetchIssue(issueNumber: number): StandardIssue {
    // Try each repo — collect all matches to detect ambiguity
    const matches: StandardIssue[] = [];
    const errors: string[] = [];

    for (const adapter of this.adapters) {
      try {
        matches.push(adapter.fetchIssue(issueNumber));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (matches.length === 0) {
      throw new TotemError(
        'SHIELD_FAILED',
        `Issue #${issueNumber} not found in any configured repository.\n` +
          errors.map((e) => `  - ${e}`).join('\n'),
        'Check that the issue number exists in your configured repositories.',
      );
    }

    if (matches.length > 1) {
      const repos = matches.map((m) => m.repo).join(', ');
      throw new TotemError(
        'SHIELD_FAILED',
        `Issue #${issueNumber} is ambiguous — found in: ${repos}.`,
        `Use owner/repo#${issueNumber} syntax to specify which repository.`,
      );
    }

    return matches[0]!;
  }

  fetchOpenIssues(limit?: number): StandardIssueListItem[] {
    const allIssues: StandardIssueListItem[] = [];
    for (const adapter of this.adapters) {
      try {
        allIssues.push(...adapter.fetchOpenIssues(limit));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.warn(`[Totem] Failed to fetch issues from a repository: ${msg}`);
      }
    }

    // Sort by updatedAt descending (most recent first)
    allIssues.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Apply limit to merged results, not per-repo
    if (limit && allIssues.length > limit) {
      return allIssues.slice(0, limit);
    }

    return allIssues;
  }
}

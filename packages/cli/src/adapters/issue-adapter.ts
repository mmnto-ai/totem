/**
 * Generic issue adapter interface — decouples Totem commands from any
 * specific issue tracker (GitHub, Jira, Linear, etc.).
 */

export interface StandardIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  /** The owner/repo this issue belongs to (e.g., 'mmnto-ai/totem'). Omitted for single-repo setups. */
  repo?: string;
}

export interface StandardIssueListItem {
  number: number;
  title: string;
  labels: string[];
  updatedAt: string;
  /** The owner/repo this issue belongs to (e.g., 'mmnto-ai/totem'). Omitted for single-repo setups. */
  repo?: string;
}

/**
 * Open issue carrying its `body`, for consumers that derive structure from the
 * issue text (e.g. `totem orient`'s epic→child grouping matches `**Parent:** #N`
 * in the body). Distinct from `StandardIssueListItem` because `fetchOpenIssues`
 * deliberately omits `body` (and `updatedAt` is not needed here) — widening the
 * shared list shape would burden every existing caller (e.g. `triage`).
 */
export interface StandardIssueWithBody {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueAdapter {
  fetchIssue(issueNumber: number): StandardIssue;
  fetchOpenIssues(limit?: number): StandardIssueListItem[];
  /**
   * Fetch open issues including each issue's `body`. Optional so adapters that
   * don't support body-bearing list queries need not implement it.
   */
  fetchOpenIssuesWithBody?(limit?: number): StandardIssueWithBody[];
}

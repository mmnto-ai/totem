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

export interface IssueAdapter {
  fetchIssue(issueNumber: number): StandardIssue;
  fetchOpenIssues(limit?: number): StandardIssueListItem[];
}

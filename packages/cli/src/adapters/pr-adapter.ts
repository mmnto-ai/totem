/**
 * Generic PR adapter interface — decouples Totem commands from any
 * specific code hosting platform (GitHub, GitLab, etc.).
 */

export interface StandardPrListItem {
  number: number;
  title: string;
  headRefName: string;
}

export interface StandardPrComment {
  author: string;
  body: string;
}

export interface StandardPrReview {
  author: string;
  state: string;
  body: string;
}

export interface StandardPr {
  number: number;
  title: string;
  body: string;
  state: string;
  comments: StandardPrComment[];
  reviews: StandardPrReview[];
}

export interface StandardReviewComment {
  id: number;
  author: string;
  body: string;
  path: string;
  diffHunk: string;
  inReplyToId?: number;
  createdAt?: string;
  /**
   * ID of the parent review submission, or `null` for non-review (issue) comments.
   * Used by `totem retrospect` to bucket inline findings into push-based rounds
   * via the review's `commit_id` rather than a fragile timestamp join (CR
   * mmnto-ai/totem#1734 round-2 — `created_at` can predate `submitted_at` for
   * pending/draft reviews).
   */
  pullRequestReviewId?: number | null;
}

export interface StandardCodeScanAlert {
  number: number;
  rule_id: string;
  state: 'open' | 'dismissed' | 'fixed';
  dismissed_reason?: string;
  html_url: string;
  most_recent_instance: {
    location: {
      path: string;
      start_line: number;
    };
    message: { text: string };
  };
}

export interface StandardPrReviewSubmission {
  id: number;
  /** GitHub login of the review submitter, or `null` for deleted/ghost accounts. */
  user_login: string | null;
  /** PR head SHA at review submission time; may be absent for some review states. */
  commit_id?: string | null;
  /** ISO 8601 timestamp. */
  submitted_at?: string | null;
  state: string;
  body: string;
}

export interface PrAdapter {
  fetchOpenPRs(): StandardPrListItem[];
  fetchPr(prNumber: number): StandardPr;
  fetchReviewComments(prNumber: number): StandardReviewComment[];
  /**
   * Per-submission review records exposing `commit_id` (head SHA at review
   * time) for push-based round grouping by `totem retrospect`. Optional so
   * existing adapters that only consume `fetchPr` need not implement it.
   */
  fetchReviews?(prNumber: number): StandardPrReviewSubmission[];
  fetchCodeScanningAlerts?(prNumber: number): StandardCodeScanAlert[];
  createIssue(params: {
    title: string;
    body: string;
    labels: string[];
    milestone?: string;
  }): string; // returns issue URL
  replyToComment(prNumber: number, commentId: number, body: string): void;
  addPrComment(prNumber: number, body: string): void;
}

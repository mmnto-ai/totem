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
}

export interface PrAdapter {
  fetchOpenPRs(): StandardPrListItem[];
  fetchPr(prNumber: number): StandardPr;
  fetchReviewComments(prNumber: number): StandardReviewComment[];
  createIssue(params: {
    title: string;
    body: string;
    labels: string[];
    milestone?: string;
  }): string; // returns issue URL
  replyToComment(prNumber: number, commentId: number, body: string): void;
  addPrComment(prNumber: number, body: string): void;
}

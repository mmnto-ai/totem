import { describe, expect, it } from 'vitest';

import {
  findMergeInvocations,
  MERGE_COMMAND_REGEX_SOURCE,
  type MergeInvocationForm,
} from './command-matcher.js';

const forms = (cmd: string): MergeInvocationForm[] => findMergeInvocations(cmd).map((m) => m.form);
const blocks = (cmd: string): boolean => findMergeInvocations(cmd).length > 0;

describe('MERGE_COMMAND_REGEX_SOURCE / findMergeInvocations', () => {
  it('compiles to a valid regex', () => {
    expect(() => new RegExp(MERGE_COMMAND_REGEX_SOURCE, 'gi')).not.toThrow();
  });

  it('returns [] for empty / non-string input', () => {
    expect(findMergeInvocations('')).toEqual([]);
    expect(findMergeInvocations(undefined as unknown as string)).toEqual([]);
  });

  // ─── form 1: gh pr merge — ANY flags, bodyless, quoting variants ──────────

  it('BLOCKS a bodyless `gh pr merge` (total rerouting)', () => {
    expect(forms('gh pr merge')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS `gh pr merge` with a PR number + squash flag', () => {
    expect(forms('gh pr merge 123 --squash')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS hidden-body forms: --body, --body-file, -F, -b, -t, --subject', () => {
    expect(blocks('gh pr merge 5 --body "closes #9"')).toBe(true);
    expect(blocks('gh pr merge --body-file x.md')).toBe(true);
    expect(blocks('gh pr merge -F body.txt')).toBe(true);
    expect(blocks('gh pr merge -b "body"')).toBe(true);
    expect(blocks('gh pr merge -t "title" --squash')).toBe(true);
    expect(blocks('gh pr merge --subject "s"')).toBe(true);
  });

  it('BLOCKS a PowerShell here-string body form', () => {
    expect(blocks("gh pr merge 5 --squash --body-file @'\nbody\n'@")).toBe(true);
  });

  it('BLOCKS a command-substitution body (the body is irrelevant — the merge blocks)', () => {
    expect(blocks('gh pr merge 5 --body "$(cat notes.md)"')).toBe(true);
  });

  it('BLOCKS a leading PowerShell call operator (& gh …)', () => {
    expect(forms('& gh pr merge 5')).toEqual(['gh-pr-merge']);
    expect(blocks('&gh pr merge')).toBe(true);
  });

  it('BLOCKS gh.exe', () => {
    expect(forms('gh.exe pr merge 5')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS individually quoted tokens (PowerShell / sh quoting)', () => {
    expect(blocks("gh 'pr' 'merge'")).toBe(true);
    expect(blocks('gh "pr" merge')).toBe(true);
    expect(blocks("& 'gh' 'pr' 'merge' --squash")).toBe(true);
  });

  it('BLOCKS with irregular whitespace between tokens', () => {
    expect(blocks('gh   pr\tmerge')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(blocks('GH PR MERGE')).toBe(true);
  });

  // ─── form 2: raw merge API ────────────────────────────────────────────────

  it('BLOCKS a raw merge-API call (gh api …/pulls/N/merge)', () => {
    expect(forms('gh api repos/mmnto-ai/totem/pulls/123/merge -X PUT')).toEqual(['gh-api-merge']);
  });

  it('BLOCKS a raw merge-API call with a leading slash + interspersed flags', () => {
    expect(forms('gh api --method PUT /repos/o/r/pulls/5/merge')).toEqual(['gh-api-merge']);
  });

  it('does NOT fire on a non-merge API path (…/pulls/N/comments)', () => {
    expect(blocks('gh api repos/o/r/pulls/5/comments')).toBe(false);
  });

  // ─── form 3: deny-on-undecidable (gh pr $(…) / $VAR / backtick) ────────────

  it('BLOCKS `gh pr` followed by a command-substitution continuation', () => {
    expect(forms('gh pr $(echo merge)')).toEqual(['gh-pr-undecidable']);
  });

  it('BLOCKS `gh pr` followed by a variable continuation', () => {
    expect(forms('gh pr ${SUBCMD} --squash')).toEqual(['gh-pr-undecidable']);
    expect(forms('gh pr $SUBCMD')).toEqual(['gh-pr-undecidable']);
  });

  it('BLOCKS `gh pr` followed by a backtick continuation', () => {
    expect(forms('gh pr `echo merge`')).toEqual(['gh-pr-undecidable']);
  });

  // ─── no over-fire ─────────────────────────────────────────────────────────

  it('does NOT block read-only `gh pr` verbs', () => {
    expect(blocks('gh pr view 5 --json title,body')).toBe(false);
    expect(blocks('gh pr checkout 5')).toBe(false);
    expect(blocks('gh pr diff 5')).toBe(false);
    expect(blocks('gh pr list')).toBe(false);
    expect(blocks('gh pr status')).toBe(false);
  });

  it('does NOT block unrelated gh commands', () => {
    expect(blocks('gh repo view --json nameWithOwner')).toBe(false);
    expect(blocks('gh issue close 5')).toBe(false);
    expect(blocks('gh api graphql -f query=...')).toBe(false);
  });

  it('does NOT block unrelated non-gh commands', () => {
    expect(blocks('git commit -m "merge branch"')).toBe(false);
    expect(blocks('npm run merge')).toBe(false);
  });

  it('does NOT over-fire on `gh pr merge` inside a larger word', () => {
    expect(blocks('foogh pr merge')).toBe(false);
    expect(blocks('path/to/gh-pr-merge.md')).toBe(false);
    expect(blocks('gh print $x')).toBe(false);
    expect(blocks('gh prune 5')).toBe(false);
  });

  it('does NOT treat `merge` as a whole word when suffixed', () => {
    expect(blocks('gh pr merged')).toBe(false);
  });

  it('reports every invocation in a compound command', () => {
    const found = findMergeInvocations('gh pr view 5 && gh pr merge 5 --squash');
    expect(found.map((m) => m.form)).toEqual(['gh-pr-merge']);
    expect(found[0]?.index).toBeGreaterThan(0);
  });
});

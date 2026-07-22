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

  // ─── flag-splice: inherited flags between gh↔pr and pr↔merge (kimi B-2 + codex B-1) ─

  it('BLOCKS a --repo flag spliced between gh and pr', () => {
    expect(forms('gh --repo mmnto-ai/totem pr merge 123')).toEqual(['gh-pr-merge']);
    expect(forms('gh --repo mmnto-ai/totem pr merge 2478 --squash')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS a --repo flag spliced between pr and merge', () => {
    expect(forms('gh pr --repo mmnto-ai/totem merge 123')).toEqual(['gh-pr-merge']);
    expect(forms('gh pr --repo mmnto-ai/totem merge 2478 --squash')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS short `-R` and `--repo=owner/name` splice forms', () => {
    expect(forms('gh -R o/r pr merge 5')).toEqual(['gh-pr-merge']);
    expect(forms('gh pr --repo=o/r merge 5')).toEqual(['gh-pr-merge']);
  });

  it('does NOT over-fire when a spliced flag precedes a read-only verb', () => {
    expect(blocks('gh --repo o/r pr view 5')).toBe(false);
    expect(blocks('gh pr --repo o/r view 5')).toBe(false);
    expect(blocks('gh pr --repo o/r list')).toBe(false);
    // `merge` only as a flag VALUE of a read verb must not resolve to the subcommand.
    expect(blocks('gh pr list --search merge')).toBe(false);
  });

  // ─── variable / substitution REST merge (kimi NB-1 deny direction; codex B-1) ─

  it('BLOCKS a variable REST merge path (…/pulls/$PR/merge)', () => {
    expect(forms('gh api repos/mmnto-ai/totem/pulls/$PR/merge -X PUT')).toEqual([
      'gh-api-undecidable',
    ]);
    expect(forms('gh api repos/o/r/pulls/${PR}/merge')).toEqual(['gh-api-undecidable']);
  });

  it('BLOCKS `gh api` with a $/backtick continuation (undecidable endpoint)', () => {
    expect(forms('gh api "$ENDPOINT"')).toEqual(['gh-api-undecidable']);
    expect(forms('gh api $EP')).toEqual(['gh-api-undecidable']);
  });

  // ─── shell / cmd.exe line continuations (kimi B-3) ────────────────────────

  it('BLOCKS a `\\`+LF (sh) continuation between tokens', () => {
    expect(forms('gh pr \\\nmerge 123 --squash')).toEqual(['gh-pr-merge']);
    expect(forms('gh \\\npr merge 123')).toEqual(['gh-pr-merge']);
    expect(forms('gh \\\npr \\\nmerge')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS a `^`+LF (cmd.exe) continuation between tokens', () => {
    expect(forms('gh pr ^\nmerge 123')).toEqual(['gh-pr-merge']);
    expect(forms('gh ^\npr merge 123')).toEqual(['gh-pr-merge']);
  });

  // ─── GraphQL merge mutation (kimi NB-2) ───────────────────────────────────

  it('BLOCKS a `gh api graphql` mergePullRequest mutation', () => {
    expect(
      forms('gh api graphql -f query=\'mutation{mergePullRequest(input:{pullRequestId:"x"})}\''),
    ).toEqual(['gh-api-merge']);
  });

  it('does NOT fire on an unrelated `gh api graphql` read', () => {
    expect(blocks('gh api graphql -f query=\'query{repository(owner:"o"){name}}\'')).toBe(false);
    expect(blocks('gh api graphql -f query=...')).toBe(false);
  });

  // ─── quoted flag-and-path forms (codex round-2 finding 2) ──────────────────

  it('BLOCKS a quoted `=value` --repo spliced between gh and pr', () => {
    expect(forms("gh --repo='mmnto-ai/totem' pr merge 2478 --squash")).toEqual(['gh-pr-merge']);
    expect(forms('gh --repo="mmnto-ai/totem" pr merge 2478')).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS a quoted `=value` --repo spliced between pr and merge', () => {
    expect(forms('gh pr --repo="mmnto-ai/totem" merge 2478')).toEqual(['gh-pr-merge']);
    expect(forms("gh pr --repo='mmnto-ai/totem' merge 2478 --squash")).toEqual(['gh-pr-merge']);
  });

  it('BLOCKS a quoted `=variable` --repo value (`--repo="$REPO"`)', () => {
    expect(forms('gh --repo="$REPO" pr merge 2478')).toEqual(['gh-pr-merge']);
  });

  it('does NOT over-fire when a quoted `=value` flag precedes a read-only verb', () => {
    expect(blocks('gh pr --repo="x" view 5')).toBe(false);
    expect(blocks("gh pr --repo='o/r' list")).toBe(false);
    expect(blocks('gh --repo="o/r" pr view 5')).toBe(false);
  });

  it('BLOCKS cmd.exe `%PR%` / delayed `!PR!` variable REST merge paths', () => {
    expect(forms('gh api repos/o/r/pulls/%PR%/merge -X PUT')).toEqual(['gh-api-undecidable']);
    expect(forms('gh api repos/o/r/pulls/!PR!/merge -X PUT')).toEqual(['gh-api-undecidable']);
  });

  it('BLOCKS a `gh api` whose entire endpoint is a variable after flags', () => {
    expect(forms('gh api --method PUT "$ENDPOINT"')).toEqual(['gh-api-undecidable']);
    expect(forms('gh api %ENDPOINT%')).toEqual(['gh-api-undecidable']);
  });

  // ─── separator exclusion in flag-value classes (codex round-2 finding 5) ───

  it('does NOT cross a shell command separator inside a flag-value class', () => {
    // A `;`/`|`/`&` after `gh --repo o/r` starts a NEW command — the run must not
    // reach a `pr merge` on the far side (the changeset's no-cross-separator claim).
    expect(blocks('gh --repo o/r; pr merge')).toBe(false);
    expect(blocks('gh --repo o/r| pr merge')).toBe(false);
    expect(blocks('gh --repo o/r& pr merge')).toBe(false);
    expect(blocks('gh pr --repo=o/r; merge')).toBe(false);
  });

  // ─── glued short-flag value (kimi round-2 BLOCKING-4) ──────────────────────

  it('BLOCKS a GLUED short-flag value spliced before pr/merge (`-Ro/r`)', () => {
    expect(forms('gh pr -Rmmnto-ai/totem merge 123')).toEqual(['gh-pr-merge']);
    expect(forms('gh -Rmmnto-ai/totem pr merge')).toEqual(['gh-pr-merge']);
    expect(forms('gh pr -Rcli/cli merge 5')).toEqual(['gh-pr-merge']);
    expect(forms('gh pr -Rmmnto-ai/totem merge 123 --squash --auto')).toEqual(['gh-pr-merge']);
  });

  it('does NOT over-fire when a glued short-flag precedes a read verb (`-Rfoo/bar view`)', () => {
    expect(blocks('gh pr -Rfoo/bar view 5')).toBe(false);
    // The glued tail is non-whitespace, so it never swallows a following `merge`.
    expect(blocks('gh pr -Rfoo/bar list')).toBe(false);
  });

  // ─── line-continuation reaches the merge-API / graphql arms (kimi round-2 B-5) ─

  it('BLOCKS a `\\`+LF continuation before the merge-API path', () => {
    expect(forms('gh api \\\nrepos/o/r/pulls/5/merge -X PUT')).toEqual(['gh-api-merge']);
  });

  it('BLOCKS a continuation SPLICED inside the merge-API path (before `merge`)', () => {
    expect(forms('gh api repos/o/r/pulls/5/\\\nmerge -X PUT')).toEqual(['gh-api-merge']);
    expect(forms('gh api repos/o/r/pulls/5/^\r\nmerge')).toEqual(['gh-api-merge']);
  });

  it('BLOCKS a continuation before `merge` in a VARIABLE REST path', () => {
    expect(forms('gh api repos/o/r/pulls/$PR/\\\nmerge')).toEqual(['gh-api-undecidable']);
  });

  it('BLOCKS a continuation (incl. mid-token splice) in the graphql merge mutation', () => {
    expect(forms("gh api graphql \\\n-f query='mutation{mergePullRequest(input:{})}'")).toEqual([
      'gh-api-merge',
    ]);
    expect(forms("gh api graph\\\nql -f query='x mergePull\\\nRequest'")).toEqual(['gh-api-merge']);
  });

  it('BLOCKS a mid-token splice inside the `pulls` path segment', () => {
    expect(forms('gh api repos/o/r/pul\\\nls/5/merge')).toEqual(['gh-api-merge']);
  });

  // ─── recorded friction: a merge-valued flag before the subcommand (kimi round-2 NB-2) ─

  it('BLOCKS `gh pr --label merge list` (deny-on-undecidable friction, recorded)', () => {
    // Defensible false-DENY: a `merge`-valued flag before the subcommand makes the
    // `merge`-token binding ambiguous. The natural `gh pr list --label merge` order
    // stays clean (asserted below).
    expect(blocks('gh pr --label merge list')).toBe(true);
    expect(blocks('gh pr list --label merge')).toBe(false);
  });

  // ─── linearity: no catastrophic backtracking (codex round-2 BLOCKING) ──────
  //
  // The earlier `-{1,2}[\w-]+` flag-name gave every `--flag` two parses, so a
  // non-matching `gh` command with N repeated flag groups backtracked 2^N times
  // (measured: 6.46s at 26 groups; >30s at 28). The disjoint-class rebuild is
  // linear — assert it EMPIRICALLY, not by claim.

  it('scans an adversarial non-matching flag run in linear time (<50ms)', () => {
    const mk = (n: number): string => 'gh pr ' + Array(n).fill('--foobar').join(' ') + ' zzz-end';
    for (const n of [26, 28, 40]) {
      const cmd = mk(n);
      const t0 = process.hrtime.bigint();
      const found = findMergeInvocations(cmd); // pathological input; must not blow up
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(found).toEqual([]); // it is a NON-merge command
      expect(ms).toBeLessThan(50);
    }
  });

  it('stays linear on adversarial flag-value / glued / api-flag runs (<50ms at 40 groups)', () => {
    const prVals = 'gh pr ' + Array(40).fill('--repo=owner/name').join(' ') + ' zzz-end';
    const prGlued = 'gh pr ' + Array(40).fill('-Rowner/name').join(' ') + ' zzz-end';
    const apiFlags = 'gh api ' + Array(40).fill('--method-x val').join(' ') + ' endpoint-no-var';
    for (const cmd of [prVals, prGlued, apiFlags]) {
      const t0 = process.hrtime.bigint();
      const found = findMergeInvocations(cmd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(found).toEqual([]);
      expect(ms).toBeLessThan(50);
    }
  });

  it('scans a separator-free filler in linear time (<50ms; kimi round-2 NB-1)', () => {
    // A long separator-free string used to make the old lazy span cover the whole
    // remainder like `[\s\S]` (measured regression). The single-pass scanner walks it
    // once (de-fold + one bounded in-segment scan) with no length-based allow.
    for (const len of [4000, 152000]) {
      const cmd = 'gh api ' + 'a'.repeat(len) + ' endpoint-no-merge';
      const t0 = process.hrtime.bigint();
      const found = findMergeInvocations(cmd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(found).toEqual([]);
      expect(ms).toBeLessThan(50);
    }
  });

  // ─── CLOSED: the padding bypass is gone (codex delta-3 #3, operator-ruled) ─────
  //
  // The bounded lazy `{0,2000}?` regex span turned INPUT LENGTH into a deterministic
  // ALLOW: a `gh api` header padded past ~2000 chars slipped a real `…/pulls/{n}/merge`
  // past the cap while the same under-cap form blocked. The linear single-pass scanner
  // (findApiMergePaths) has NO length-based allow condition — the padded form now
  // BLOCKS exactly like the bare and under-cap forms. (Replaces the round-3
  // padded→ALLOW record; the bypass no longer exists to record.)
  it('BLOCKS a gh api merge path however far the header is padded (no length-based allow)', () => {
    const dangerousPath = 'repos/o/r/pulls/5/merge';
    const bare = `gh api ${dangerousPath} -X PUT`;
    const underCap = `gh api -H "X-Fill: ${'a'.repeat(1800)}" ${dangerousPath} -X PUT`;
    const padded = `gh api -H "X-Fill: ${'a'.repeat(2100)}" ${dangerousPath} -X PUT`;
    const wayPadded = `gh api -H "X-Fill: ${'a'.repeat(4000)}" ${dangerousPath} -X PUT`;
    for (const cmd of [bare, underCap, padded, wayPadded]) {
      expect(findMergeInvocations(cmd).map((m) => m.form)).toEqual(['gh-api-merge']);
    }
  });

  it('stays linear on the padded merge-path + k-repeat filler shapes (<50ms)', () => {
    const dangerousPath = 'repos/o/r/pulls/5/merge';
    // The padded-header dangerous form and kimi's k-repeat separator-free filler
    // preceding a real merge path — both must BLOCK and both must scan fast.
    const shapes = [
      `gh api -H "X-Fill: ${'a'.repeat(2100)}" ${dangerousPath} -X PUT`,
      `gh api ${'a'.repeat(152000)}/${dangerousPath} -X PUT`,
      'gh api ' + Array(40).fill('--method-x val').join(' ') + ` ${dangerousPath}`,
    ];
    for (const cmd of shapes) {
      const t0 = process.hrtime.bigint();
      const found = findMergeInvocations(cmd);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      expect(found.length).toBeGreaterThan(0); // a real merge path — must block
      expect(ms).toBeLessThan(50);
    }
  });
});

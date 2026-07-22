import { describe, expect, it } from 'vitest';

import {
  assertValidPrNumberArg,
  buildIssueCloseArgv,
  buildMergeArgv,
  displayGhCommand,
  evaluatePrMerge,
  FORBIDDEN_MERGE_FLAGS,
  type GhRunner,
  prMergeCommand,
  type PrMergeDeps,
} from './pr.js';

const CONFORMING_POSTURE = {
  squashMergeAllowed: true,
  mergeCommitAllowed: false,
  rebaseMergeAllowed: false,
  squashMergeCommitTitle: 'PR_TITLE',
  squashMergeCommitMessage: 'BLANK',
};

interface HarnessConfig {
  repo?: string;
  posture?: Record<string, unknown>;
  pr?: Record<string, unknown>;
  /** The post-merge landing state re-read by fetchMergeState (default MERGED). */
  mergedState?: string;
  throwOn?: (args: string[]) => Error | undefined;
}

function makeHarness(cfg: HarnessConfig = {}) {
  const calls: string[][] = [];
  // Accumulate the captured streams verbatim (each write() chunk carries its own
  // newlines) — a running concat reconstructs the stream exactly.
  let outStr = '';
  let errStr = '';
  const repo = cfg.repo ?? 'mmnto-ai/totem';
  const posture = cfg.posture ?? CONFORMING_POSTURE;
  const mergedState = cfg.mergedState ?? 'MERGED';
  const pr = cfg.pr ?? {
    title: 'feat: a clean title',
    body: 'A body with no close keywords. references #9.',
    state: 'OPEN',
    number: 5,
    headRefOid: 'deadbeef',
  };
  const gh: GhRunner = (args) => {
    calls.push(args);
    const thrown = cfg.throwOn?.(args);
    if (thrown) throw thrown;
    if (args[0] === 'repo' && args[1] === 'view') return `${repo}\n`;
    if (args[0] === 'api' && args[1] === 'graphql') return JSON.stringify(posture);
    if (args[0] === 'pr' && args[1] === 'view') {
      // Two `pr view` shapes: the pre-merge fetch (title,body,…) and the
      // post-merge landing-state re-read (--json state,mergedAt).
      if (args.includes('state,mergedAt')) {
        return JSON.stringify({
          state: mergedState,
          mergedAt: mergedState === 'MERGED' ? '2026-07-21T00:00:00Z' : null,
        });
      }
      return JSON.stringify(pr);
    }
    return '';
  };
  const deps: Partial<PrMergeDeps> = {
    gh,
    cwd: '/repo',
    out: (t) => {
      outStr += t;
    },
    err: (t) => {
      errStr += t;
    },
  };
  const mergeCalled = () => calls.some((a) => a[0] === 'pr' && a[1] === 'merge');
  const issueCloseCalls = () => calls.filter((a) => a[0] === 'issue' && a[1] === 'close');
  return {
    deps,
    calls,
    mergeCalled,
    issueCloseCalls,
    out: () => outStr,
    err: () => errStr,
  };
}

describe('buildMergeArgv (structural — NO body/subject flags; repo + head-bound)', () => {
  it('is `pr merge <n> --repo <r> --squash --match-head-commit <oid>`', () => {
    expect(buildMergeArgv(5, 'mmnto-ai/totem', 'deadbeef')).toEqual([
      'pr',
      'merge',
      '5',
      '--repo',
      'mmnto-ai/totem',
      '--squash',
      '--match-head-commit',
      'deadbeef',
    ]);
  });

  it('never contains any forbidden body/subject flag; DOES bind --match-head-commit', () => {
    for (const n of [1, 42, 1762, 999999]) {
      const argv = buildMergeArgv(n, 'o/r', 'sha123');
      for (const flag of FORBIDDEN_MERGE_FLAGS) {
        expect(argv).not.toContain(flag);
      }
      // Squash-only; never a non-squash merge method.
      expect(argv).toContain('--squash');
      expect(argv).not.toContain('--merge');
      expect(argv).not.toContain('--rebase');
      // Snapshot binding (codex Q): the evaluated head is pinned.
      expect(argv).toContain('--match-head-commit');
      expect(argv[argv.indexOf('--match-head-commit') + 1]).toBe('sha123');
      // Repo binding (codex B-2): same identity the lookup used.
      expect(argv).toContain('--repo');
      expect(argv[argv.indexOf('--repo') + 1]).toBe('o/r');
    }
  });
});

describe('buildIssueCloseArgv', () => {
  it('binds a bare ref to the resolved repo with a PR-naming comment', () => {
    const argv = buildIssueCloseArgv({ issue: 42 }, 5, 'mmnto-ai/totem');
    expect(argv.slice(0, 3)).toEqual(['issue', 'close', '42']);
    expect(argv).toContain('--repo');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('mmnto-ai/totem');
    const comment = argv[argv.indexOf('--comment') + 1];
    expect(comment).toContain('#5');
  });

  it('uses the qualifier repo for a cross-repo qualified ref', () => {
    const argv = buildIssueCloseArgv({ qualifier: 'mmnto-ai/totem-strategy', issue: 7 }, 5, 'o/r');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('mmnto-ai/totem-strategy');
  });

  it('the close comment carries no close-keyword adjacent to the digit ref', () => {
    const comment = buildIssueCloseArgv({ issue: 42 }, 5, 'o/r').at(-1) ?? '';
    // The word immediately before the #N ref must not be a close keyword.
    expect(comment).not.toMatch(/\b(?:closes?d?|fix(?:e[sd])?|resolve[sd]?)\s+#\d/i);
  });

  it('the close comment carries NO backticks (paste-safe — codex NB-1)', () => {
    const comment = buildIssueCloseArgv({ issue: 42 }, 5, 'o/r').at(-1) ?? '';
    expect(comment).not.toContain('`');
  });
});

describe('assertValidPrNumberArg (confused-deputy guard — codex B-2)', () => {
  it('accepts undefined (merge the current branch PR) and a positive decimal', () => {
    expect(() => assertValidPrNumberArg(undefined)).not.toThrow();
    expect(() => assertValidPrNumberArg('1762')).not.toThrow();
  });

  it('rejects a URL positional (the confused-deputy vector)', () => {
    expect(() => assertValidPrNumberArg('https://github.com/other/repo/pull/5')).toThrow(
      /invalid PR argument/i,
    );
  });

  it('rejects a branch name, a zero, and a leading-zero form', () => {
    expect(() => assertValidPrNumberArg('feature/x')).toThrow();
    expect(() => assertValidPrNumberArg('0')).toThrow();
    expect(() => assertValidPrNumberArg('007')).toThrow();
  });
});

describe('displayGhCommand (paste-safe rendering — codex NB-1)', () => {
  it('quotes the multi-word comment arg and never emits a bare #N or backtick', () => {
    const line = displayGhCommand(buildIssueCloseArgv({ issue: 55 }, 5, 'o/r'));
    expect(line.startsWith('gh issue close 55 --repo o/r --comment ')).toBe(true);
    expect(line).not.toContain('`');
    // The comment (with spaces + #N) must be a single quoted token, not bare.
    expect(line).toMatch(/--comment '.*#5.*'/);
    // No unquoted `#5` sitting outside quotes (would truncate as a shell comment).
    expect(line).not.toMatch(/[^']#5(?![^']*')/);
  });
});

describe('evaluatePrMerge (pure — reuses the ONE shared evaluator)', () => {
  const repo = 'mmnto-ai/totem';

  it('is clean for a body with no close-keyword refs', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: 'references #9, see #10', repo });
    expect(e.ok).toBe(true);
    expect(e.undeclared).toEqual([]);
  });

  it('flags a genuine close keyword', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: 'Fixes #700', repo });
    expect(e.ok).toBe(false);
    expect(e.undeclared).toContain('#700');
  });

  it('flags a NEGATED close keyword (presence invariant, no negation parser)', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: 'Does not close #2466', repo });
    expect(e.ok).toBe(false);
    expect(e.undeclared).toContain('#2466');
  });

  it('flags an EMPHASIZED close keyword', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: '**Fixes #700**', repo });
    expect(e.ok).toBe(false);
  });

  it('flags a QUOTED close keyword', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: '> closes #12', repo });
    expect(e.ok).toBe(false);
  });

  it('flags a QUALIFIED close keyword ref', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: 'resolves mmnto-ai/totem#2466', repo });
    expect(e.ok).toBe(false);
    expect(e.undeclared).toContain('mmnto-ai/totem#2466');
  });

  it('flags MULTIPLE refs', () => {
    const e = evaluatePrMerge({ title: 'feat: x', body: 'Fixes: #55 and Resolved #56', repo });
    expect(e.ok).toBe(false);
    expect(e.undeclared).toEqual(expect.arrayContaining(['#55', '#56']));
  });

  it('catches a TITLE-only close keyword', () => {
    const e = evaluatePrMerge({ title: 'Fixes #55', body: 'clean body', repo });
    expect(e.ok).toBe(false);
    expect(e.undeclared).toContain('#55');
  });

  it('AUTHORIZES a close keyword declared by a totem-close marker (marker never self-flags)', () => {
    const e = evaluatePrMerge({
      title: 'feat: x',
      body: '<!-- totem-close: #55 -->\nFixes #55',
      repo,
    });
    expect(e.ok).toBe(true);
    expect(e.declaredByMarker).toContain('#55');
    expect(e.undeclared).toEqual([]);
  });
});

describe('prMergeCommand — happy path', () => {
  it('merges a clean PR squash-only', async () => {
    const h = makeHarness();
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(true);
    const merge = h.calls.find((a) => a[0] === 'pr' && a[1] === 'merge');
    expect(merge).toEqual([
      'pr',
      'merge',
      '5',
      '--repo',
      'mmnto-ai/totem',
      '--squash',
      '--match-head-commit',
      'deadbeef',
    ]);
  });

  it('forwards an explicit PR number to `gh pr view`', async () => {
    const h = makeHarness({
      pr: { title: 't', body: 'clean', state: 'OPEN', number: 88, headRefOid: 'x' },
    });
    await prMergeCommand('88', { checkOnly: false, closeDeclared: false }, h.deps);
    const view = h.calls.find((a) => a[0] === 'pr' && a[1] === 'view');
    expect(view).toContain('88');
  });
});

describe('prMergeCommand — refuses (abortsMergeOnFailedAutocloseEvaluation)', () => {
  it('exits 1 and NEVER merges when an undeclared close-keyword ref is present', async () => {
    const h = makeHarness({
      pr: { title: 'feat: x', body: 'Fixes #700', state: 'OPEN', number: 5, headRefOid: 'x' },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
    expect(h.err()).toContain('#700');
    expect(h.err()).toContain('totem-close');
  });

  it('exits 1 on a NEGATED close keyword (still blocks) and never merges', async () => {
    const h = makeHarness({
      pr: {
        title: 'feat: x',
        body: 'Does not close #2466',
        state: 'OPEN',
        number: 5,
        headRefOid: 'x',
      },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
  });

  it('exits 1 on a TITLE-only close keyword', async () => {
    const h = makeHarness({
      pr: { title: 'Fixes #55', body: 'clean', state: 'OPEN', number: 5, headRefOid: 'x' },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
  });

  it('merges when the close keyword IS marker-authorized', async () => {
    const h = makeHarness({
      pr: {
        title: 'feat: x',
        body: '<!-- totem-close: #55 -->\nFixes #55',
        state: 'OPEN',
        number: 5,
        headRefOid: 'x',
      },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(true);
  });
});

describe('prMergeCommand — posture + fail-closed', () => {
  it('exits 1 on merge-config drift, names the field, never merges', async () => {
    const h = makeHarness({
      posture: { ...CONFORMING_POSTURE, squashMergeCommitMessage: 'COMMIT_MESSAGES' },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
    expect(h.err()).toContain('squash_merge_commit_message');
  });

  it('exits 1 on squash-only drift (merge-commit still enabled)', async () => {
    const h = makeHarness({ posture: { ...CONFORMING_POSTURE, mergeCommitAllowed: true } });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
    expect(h.err()).toContain('allow_merge_commit');
  });

  it('fails closed (exit 1, no merge) when `gh repo view` throws', async () => {
    const h = makeHarness({
      throwOn: (a) => (a[0] === 'repo' ? new Error('gh: not authenticated') : undefined),
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
    expect(h.err()).toContain('failing closed');
  });

  it('fails closed when `gh pr view` throws', async () => {
    const h = makeHarness({
      throwOn: (a) =>
        a[0] === 'pr' && a[1] === 'view' ? new Error('no PR for branch') : undefined,
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
  });

  it('fails closed on a non-OPEN PR', async () => {
    const h = makeHarness({
      pr: { title: 't', body: 'clean', state: 'MERGED', number: 5, headRefOid: 'x' },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
    expect(h.err()).toContain('MERGED');
  });

  it('exit 1 propagates when `gh pr merge` itself fails (gh stderr surfaced)', async () => {
    const h = makeHarness({
      throwOn: (a) => (a[0] === 'pr' && a[1] === 'merge' ? new Error('merge conflict') : undefined),
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.err()).toContain('merge conflict');
  });
});

describe('prMergeCommand — --check-only', () => {
  it('exits 0 on a clean PR WITHOUT merging', async () => {
    const h = makeHarness();
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: true, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(false);
  });

  it('exits 1 on an undeclared ref WITHOUT merging', async () => {
    const h = makeHarness({
      pr: { title: 'feat', body: 'Fixes #700', state: 'OPEN', number: 5, headRefOid: 'x' },
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: true, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(false);
  });
});

describe('prMergeCommand — --close-declared', () => {
  const declaredPr = {
    title: 'feat: x',
    body: '<!-- totem-close: #55, mmnto-ai/totem-strategy#7 -->\nFixes #55',
    state: 'OPEN',
    number: 5,
    headRefOid: 'x',
  };

  it('closes each marker-declared target after merge when opted in', async () => {
    const h = makeHarness({ pr: declaredPr });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: true },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(true);
    const closes = h.issueCloseCalls();
    expect(closes.some((a) => a.includes('55'))).toBe(true);
    expect(closes.some((a) => a.includes('7') && a.includes('--repo'))).toBe(true);
  });

  it('prints the exact commands and does NOT close by default', async () => {
    const h = makeHarness({ pr: declaredPr });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(true);
    expect(h.issueCloseCalls()).toHaveLength(0);
    expect(h.out()).toContain('gh issue close');
    // The printed commands are paste-safe (codex NB-1): quoted comment, no backticks.
    expect(h.out()).not.toContain('`');
    expect(h.out()).toMatch(/gh issue close 55 --repo mmnto-ai\/totem --comment '/);
  });

  it('exit 1 + summary when a requested close fails; still attempts every target (codex B-4)', async () => {
    const h = makeHarness({
      pr: declaredPr,
      throwOn: (a) =>
        a[0] === 'issue' && a[1] === 'close' && a.includes('55')
          ? new Error('denied: not a collaborator')
          : undefined,
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: true },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.mergeCalled()).toBe(true);
    // Continued through ALL targets despite the #55 failure.
    const closes = h.issueCloseCalls();
    expect(closes.some((a) => a.includes('55'))).toBe(true);
    expect(closes.some((a) => a.includes('7'))).toBe(true);
    // The final summary names the failed target.
    expect(h.err()).toMatch(/FAILED.*#55/);
  });
});

describe('prMergeCommand — confused-deputy positional (codex B-2)', () => {
  it('refuses a URL positional BEFORE any gh call (throws, never merges)', async () => {
    const h = makeHarness();
    await expect(
      prMergeCommand(
        'https://github.com/other/repo/pull/5',
        { checkOnly: false, closeDeclared: false },
        h.deps,
      ),
    ).rejects.toThrow(/invalid PR argument/i);
    expect(h.calls).toHaveLength(0);
    expect(h.mergeCalled()).toBe(false);
  });

  it('binds --repo on BOTH `gh pr view` and `gh pr merge` to the resolved repo', async () => {
    const h = makeHarness({
      pr: { title: 't', body: 'clean', state: 'OPEN', number: 88, headRefOid: 'oid88' },
    });
    await prMergeCommand('88', { checkOnly: false, closeDeclared: false }, h.deps);
    const view = h.calls.find((a) => a[0] === 'pr' && a[1] === 'view' && a.includes('88'));
    const merge = h.calls.find((a) => a[0] === 'pr' && a[1] === 'merge');
    expect(view?.[view.indexOf('--repo') + 1]).toBe('mmnto-ai/totem');
    expect(merge?.[merge.indexOf('--repo') + 1]).toBe('mmnto-ai/totem');
    // Snapshot binding uses the fetched head oid.
    expect(merge?.[merge.indexOf('--match-head-commit') + 1]).toBe('oid88');
  });
});

describe('prMergeCommand — landing-state read failure (codex round-2 BLOCKING)', () => {
  const declaredPr = {
    title: 'feat: x',
    body: '<!-- totem-close: #55 -->\nFixes #55',
    state: 'OPEN',
    number: 5,
    headRefOid: 'x',
  };
  const throwOnStateRead = (a: string[]): Error | undefined =>
    a[0] === 'pr' && a[1] === 'view' && a.includes('state,mergedAt')
      ? new Error('network unreachable')
      : undefined;

  it('with --close-declared: UNCONFIRMED (never "merged"), exit 1, names deferred targets, closes none', async () => {
    const h = makeHarness({ pr: declaredPr, throwOn: throwOnStateRead });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: true },
      h.deps,
    );
    // The merge command ran (irreversible) but its landing is unconfirmed.
    expect(h.mergeCalled()).toBe(true);
    // Partial failure — NOT a false all-actions-success signal (codex round-2).
    expect(exitCode).toBe(1);
    expect(h.issueCloseCalls()).toHaveLength(0);
    expect(h.err()).toMatch(/UNCONFIRMED/);
    expect(h.err()).toMatch(/#55/);
    // NEVER the completed-merge line.
    expect(h.out()).not.toContain('merged PR #5 (--squash)');
    // Finding 4 (codex #4 NB): the recovery text must NOT tell the operator to re-run
    // `totem pr merge` with --close-declared — the pre-merge guard rejects an
    // already-MERGED PR (state !== OPEN) before the close phase, so that re-run is
    // impossible. It must give the valid manual `gh issue close` command(s) instead.
    expect(h.err()).not.toMatch(/re-run `totem pr merge`.*--close-declared/i);
    expect(h.err()).toMatch(/gh issue close 55/);
  });

  it('without --close-declared: still says UNCONFIRMED (not "merged"), exit 0, prints manual close commands', async () => {
    const h = makeHarness({ pr: declaredPr, throwOn: throwOnStateRead });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.err()).toMatch(/UNCONFIRMED/);
    expect(h.out()).not.toContain('merged PR #5 (--squash)');
    expect(h.issueCloseCalls()).toHaveLength(0);
    // Manual-close-guidance parity (CR B-only round): the declared command is still
    // surfaced without --close-declared, and never as a --close-declared re-run.
    expect(h.err()).toMatch(/gh issue close 55/);
    expect(h.err()).not.toMatch(/re-run `totem pr merge`.*--close-declared/i);
  });
});

describe('prMergeCommand — snapshot binding / head mismatch (codex Q)', () => {
  it('exit 1 + re-evaluate instruction when the head-bound merge fails', async () => {
    const h = makeHarness({
      throwOn: (a) =>
        a[0] === 'pr' && a[1] === 'merge'
          ? new Error('Pull request is not mergeable: head branch was modified')
          : undefined,
    });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: false },
      h.deps,
    );
    expect(exitCode).toBe(1);
    expect(h.err()).toMatch(/re-run `totem pr merge` to re-evaluate/i);
    // No closes attempted after a failed merge.
    expect(h.issueCloseCalls()).toHaveLength(0);
  });
});

describe('prMergeCommand — merge-queue semantics (codex B-5)', () => {
  const queuedDeclaredPr = {
    title: 'feat: x',
    body: '<!-- totem-close: #55 -->\nFixes #55',
    state: 'OPEN',
    number: 5,
    headRefOid: 'x',
  };

  it('a non-MERGED landing state DEFERS closes and exits 0', async () => {
    const h = makeHarness({ pr: queuedDeclaredPr, mergedState: 'OPEN' });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: true },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.mergeCalled()).toBe(true);
    // The merge was invoked, but no issue was closed (deferred).
    expect(h.issueCloseCalls()).toHaveLength(0);
    expect(h.out()).toMatch(/not yet MERGED|merge queue|auto-merge/i);
    expect(h.out()).toMatch(/DEFERRED/);
    // Does NOT print the completed-merge line.
    expect(h.out()).not.toContain('merged PR #5 (--squash)');
  });

  it('a MERGED landing state proceeds to the merged message + closes', async () => {
    const h = makeHarness({ pr: queuedDeclaredPr, mergedState: 'MERGED' });
    const { exitCode } = await prMergeCommand(
      undefined,
      { checkOnly: false, closeDeclared: true },
      h.deps,
    );
    expect(exitCode).toBe(0);
    expect(h.out()).toContain('merged PR #5 (--squash)');
    expect(h.issueCloseCalls().some((a) => a.includes('55'))).toBe(true);
  });
});

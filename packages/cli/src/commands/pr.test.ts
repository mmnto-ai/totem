import { describe, expect, it } from 'vitest';

import {
  buildIssueCloseArgv,
  buildMergeArgv,
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
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify(pr);
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

describe('buildMergeArgv (structural — NO body/subject flags, EVER)', () => {
  it('is exactly `pr merge <n> --squash`', () => {
    expect(buildMergeArgv(5)).toEqual(['pr', 'merge', '5', '--squash']);
  });

  it('never contains any forbidden body/subject flag for any PR number', () => {
    for (const n of [1, 42, 1762, 999999]) {
      const argv = buildMergeArgv(n);
      for (const flag of FORBIDDEN_MERGE_FLAGS) {
        expect(argv).not.toContain(flag);
      }
      // Squash-only; never a non-squash merge method.
      expect(argv).toContain('--squash');
      expect(argv).not.toContain('--merge');
      expect(argv).not.toContain('--rebase');
    }
  });
});

describe('buildIssueCloseArgv', () => {
  it('builds a bare same-repo close with a PR-naming comment', () => {
    const argv = buildIssueCloseArgv({ issue: 42 }, 5);
    expect(argv.slice(0, 3)).toEqual(['issue', 'close', '42']);
    expect(argv).not.toContain('--repo');
    const comment = argv[argv.indexOf('--comment') + 1];
    expect(comment).toContain('#5');
  });

  it('adds --repo for a cross-repo qualified ref', () => {
    const argv = buildIssueCloseArgv({ qualifier: 'mmnto-ai/totem-strategy', issue: 7 }, 5);
    expect(argv).toContain('--repo');
    expect(argv[argv.indexOf('--repo') + 1]).toBe('mmnto-ai/totem-strategy');
  });

  it('the close comment carries no close-keyword adjacent to the digit ref', () => {
    const comment = buildIssueCloseArgv({ issue: 42 }, 5).at(-1) ?? '';
    // The word immediately before the #N ref must not be a close keyword.
    expect(comment).not.toMatch(/\b(?:closes?d?|fix(?:e[sd])?|resolve[sd]?)\s+#\d/i);
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
    expect(merge).toEqual(['pr', 'merge', '5', '--squash']);
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
  });
});

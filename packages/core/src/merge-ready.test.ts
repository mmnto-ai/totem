/**
 * merge-ready (mmnto-ai/totem#2800) — the gate's invariants, driven by the
 * checked-in fixtures under `gate-fixtures/merge-ready/`.
 *
 * FIVE of those fixtures are REAL `gh api graphql` captures taken with the
 * exported {@link MERGE_READY_QUERY} (R4): four PR captures —
 * mmnto-ai/liquid-city#363 (green rollup, one unresolved HIGH inline),
 * mmnto-ai/totem-strategy#1251, mmnto-ai/totem#2827 (the comment that
 * re-pointed to the head) and mmnto-ai/totem#2871 (a HIGH resolved through the
 * disposition path while its anchor survives on the head — the discharge
 * specimen, mmnto-ai/totem#2861) — plus the benign corpus, every bot inline
 * thread on mmnto-ai/totem#2820-2839, which measures the severity read's
 * ADR-109 false-positive budget. The other 61 are synthetic and labelled
 * `synthetic-` in their names — one per invariant the captures cannot
 * exercise (all four PRs are merged, so GitHub answers `mergeStateStatus:
 * UNKNOWN` for each and no capture can carry a BEHIND / DIRTY / BLOCKED head,
 * or a bare-resolved HIGH thread); the five PR-round-1 rows
 * (mmnto-ai/totem#2844) cover the strict connection reads and the predicate
 * order ahead of the unreadable-commit arm; the ten mmnto-ai/totem#2861 rows
 * cover the discharge read — its two evidence arms, the bare-resolve negative
 * control in the field shape, the required resolve, the per-thread split, the
 * second comments page, the incomplete window with and without evidence, the
 * deleted-account reply and the strict PR comments connection.
 * The README beside them lists every file with its sha256 and instant, and a
 * test recomputes those receipts from the files on disk.
 *
 * The network never runs here: every test injects the {@link GhRunner} seam.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TotemError } from './errors.js';
import type { GateTier, GhRunner } from './gate-types.js';
import {
  dispositionedRootIds,
  evaluateMergeReady,
  hasHighSeverityMarker,
  MERGE_READY_BRANCH_QUERY,
  MERGE_READY_OVERRIDE_ENV,
  MERGE_READY_QUERY,
  MERGE_READY_SOURCE,
  type MergeReadyEvaluation,
  mergeReadyEvaluator,
  parseMergeReadyPayload,
} from './merge-ready.js';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'gate-fixtures',
  'merge-ready',
);

interface FixturePage {
  exitCode: number;
  body?: unknown;
  stdout?: string;
}

interface Fixture {
  kind: 'capture' | 'synthetic';
  repo?: string;
  pr?: number;
  role: string;
  ghVersion: string;
  ghVersionExitCode?: number;
  pages: FixturePage[];
}

function loadFixture(name: string): Fixture {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8')) as Fixture;
}

/** A runner backed by a fixture: `--version` first, then one page per graphql call. */
function runnerFor(fixture: Fixture): { runner: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  let next = 0;
  const runner: GhRunner = (args) => {
    calls.push(args);
    if (args.length === 1 && args[0] === '--version') {
      return { stdout: fixture.ghVersion, exitCode: fixture.ghVersionExitCode ?? 0 };
    }
    const page = fixture.pages[next++];
    if (page === undefined) {
      throw new Error(`fixture exhausted after ${next - 1} pages — the read asked for one more`);
    }
    return {
      stdout: page.body !== undefined ? JSON.stringify(page.body) : (page.stdout ?? ''),
      exitCode: page.exitCode,
    };
  };
  return { runner, calls };
}

/** Evaluate a fixture against a payload; the tier defaults to strict. */
function evaluate(
  name: string,
  overrides: {
    payload?: unknown;
    tier?: GateTier;
    env?: NodeJS.ProcessEnv;
  } = {},
): MergeReadyEvaluation & { calls: string[][] } {
  const fixture = loadFixture(name);
  const { runner, calls } = runnerFor(fixture);
  const payload = overrides.payload ?? {
    repo: fixture.repo ?? 'mmnto-ai/totem',
    pr: fixture.pr ?? 4242,
  };
  const evaluation = evaluateMergeReady(payload, {
    runner,
    tier: overrides.tier,
    env: overrides.env ?? {},
  });
  return { ...evaluation, calls };
}

// ─── The README is a RECEIPT, not a claim (round 3, F1) ─────────────────────
//
// The corpus row once carried the hash the capture script printed BEFORE
// `prettier --write` reformatted the JSON, so the README described bytes that
// never reached a commit. A receipt nobody re-derives is a claim; this test
// re-derives every one of them from the files on disk.

describe('merge-ready — the fixture README matches the fixtures', () => {
  const CAPTURES = [
    'benign-corpus-bot-inlines.json',
    'liquid-city-363.json',
    'totem-2827.json',
    'totem-2871.json',
    'totem-strategy-1251.json',
  ];

  it('every sha256 in the README is the sha256 of the file it names', () => {
    const readme = fs.readFileSync(path.join(FIXTURE_DIR, 'README.md'), 'utf-8');
    const files = fs
      .readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();

    const drift: string[] = [];
    const unlisted: string[] = [];
    for (const file of files) {
      const row = new RegExp('`' + file.replace(/\./g, '\\.') + '`[^\\n]*?`([0-9a-f]{64})`');
      const match = row.exec(readme);
      if (match === null) {
        unlisted.push(file);
        continue;
      }
      const actual = createHash('sha256')
        .update(fs.readFileSync(path.join(FIXTURE_DIR, file)))
        .digest('hex');
      if (match[1] !== actual) {
        drift.push(
          `${file}: README says ${match[1].slice(0, 12)}…, file is ${actual.slice(0, 12)}…`,
        );
      }
    }

    expect(unlisted, 'fixtures with no README row').toEqual([]);
    expect(drift, 'README receipts that no longer match their files').toEqual([]);
  });

  it('the capture / synthetic split is what the README and this header say', () => {
    const files = fs
      .readdirSync(FIXTURE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort();
    const synthetic = files.filter((f) => f.startsWith('synthetic-'));
    const captures = files.filter((f) => !f.startsWith('synthetic-'));
    expect(captures.sort()).toEqual(CAPTURES);
    expect(synthetic.length).toBe(61);
    expect(files.length).toBe(66);
  });

  it('the README query sha is the sha of the exported query (round 4, F7)', () => {
    // A receipt for the QUERY, re-derived like the file receipts: change the
    // query without re-capturing and this row stops matching, which is exactly
    // when the fixtures stop describing what the evaluator would receive.
    const readme = fs.readFileSync(path.join(FIXTURE_DIR, 'README.md'), 'utf-8');
    const actual = createHash('sha256')
      .update(Buffer.from(MERGE_READY_QUERY, 'utf-8'))
      .digest('hex');
    const claimed = /sha256 of that query string at capture time:\s*\n?`([0-9a-f]{64})`/.exec(
      readme,
    );
    expect(claimed, 'the README no longer states a query sha').not.toBeNull();
    expect(claimed![1]).toBe(actual);
  });
});

// ─── The three real PR captures (R4) ────────────────────────────────────────

describe('merge-ready — the checked-in captures', () => {
  it('mmnto-ai/liquid-city#363 (capture): green rollup, one unresolved HIGH bot inline → deny', () => {
    const e = evaluate('liquid-city-363.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unresolved-bot-threads');
    expect(e.verdict.provenance.source).toBe(MERGE_READY_SOURCE);
    expect(e.detail.checks).toEqual({
      total: 6,
      success: 6,
      pending: 0,
      failing: 0,
      superseded: 0,
    });
    expect(e.detail.threads.unresolvedBot).toBe(1);
    // The root comment is GCA's, spelled WITHOUT the `[bot]` suffix on the
    // GraphQL surface — the trap `bot-identity.ts` exists to hold.
    expect(e.verdict.reason).toContain('gemini-code-assist');
    expect(e.detail.highInline).toBe(1);
    expect(e.detail.headSha).toBe('d09ce906b1a12125e089b77e668bea25f1bdef2d');
    expect(e.detail.evaluatedBy).toBe('gh 2.99.0');
  });

  it('mmnto-ai/totem-strategy#1251 (capture): clean predicates, UNKNOWN mergeability → unevaluable', () => {
    const strict = evaluate('totem-strategy-1251.json');
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.provenance.ref).toBe('unevaluable');
    expect(strict.detail.checks.total).toBe(3);
    expect(strict.detail.threads.unresolvedBot).toBe(0);
    expect(strict.notices.join('\n')).toMatch(/could not derive/);

    const pilot = evaluate('totem-strategy-1251.json', { tier: 'pilot' });
    expect(pilot.verdict.disposition).toBe('warn');
    expect(pilot.notices.join('\n')).toMatch(/tier=pilot/);
  });

  it('mmnto-ai/totem#2827 (capture): the comment re-pointed to the head while originalCommit stayed behind', () => {
    // The corpus witness for fold F2. GitHub moves `comment.commit.oid` to the
    // commit the finding CURRENTLY applies to; `originalCommit.oid` never
    // moves. Here they differ and only the current one is the head — so a
    // predicate keyed on the write-time commit reads this real HIGH finding as
    // "not on head" and goes inert. Read straight off the capture, not asserted
    // through the evaluator, so it stays a statement about GitHub's data.
    const fixture = loadFixture('totem-2827.json');
    const body = fixture.pages[0]!.body as {
      data: {
        repository: {
          pullRequest: {
            headRefOid: string;
            reviewThreads: {
              nodes: Array<{
                comments: {
                  nodes: Array<{ commit: { oid: string }; originalCommit: { oid: string } }>;
                };
              }>;
            };
          };
        };
      };
    };
    const pr = body.data.repository.pullRequest;
    const root = pr.reviewThreads.nodes[0]!.comments.nodes[0]!;
    expect(root.commit.oid).toBe(pr.headRefOid);
    expect(root.originalCommit.oid).not.toBe(pr.headRefOid);

    const e = evaluate('totem-2827.json');
    expect(e.detail.highInline).toBe(1);
    expect(e.verdict.disposition).toBe('deny');
  });

  it('mmnto-ai/totem#2871 (capture): a CodeRabbit Major resolved THROUGH THE DISPOSITION PATH while its anchor survives on the head is discharged (mmnto-ai/totem#2861)', () => {
    // The real specimen of predicate 4's own territory: the finding was
    // declined with reason in the round disposition (a PR-level comment that
    // post-dates the thread's root), the thread resolved by
    // `totem resolve-threads --apply`, and the anchored line never changed —
    // so `comment.commit.oid` IS the head and, before the cure, this read
    // `deny · high-severity-inline · highInline 1` (calibration row
    // mmnto-ai/totem#2871 on the issue). Read straight off the capture first,
    // so the shape stays a statement about GitHub's data.
    const fixture = loadFixture('totem-2871.json');
    const body = fixture.pages[0]!.body as {
      data: {
        repository: {
          pullRequest: {
            headRefOid: string;
            reviewThreads: {
              nodes: Array<{
                isResolved: boolean;
                comments: {
                  nodes: Array<{
                    databaseId: number;
                    author: { __typename: string; login: string } | null;
                    body: string;
                    createdAt: string;
                    commit: { oid: string } | null;
                  }>;
                };
              }>;
            };
            comments: {
              nodes: Array<{
                author: { __typename: string; login: string } | null;
                body: string;
                createdAt: string;
              }>;
            };
          };
        };
      };
    };
    const pr = body.data.repository.pullRequest;
    const onHead = pr.reviewThreads.nodes.filter(
      (t) =>
        t.comments.nodes[0]!.commit?.oid === pr.headRefOid &&
        hasHighSeverityMarker(t.comments.nodes[0]!.body),
    );
    expect(onHead).toHaveLength(1);
    const thread = onHead[0]!;
    expect(thread.isResolved).toBe(true);
    expect(thread.comments.nodes[0]!.author?.login).toBe('coderabbitai');
    const rootAt = Date.parse(thread.comments.nodes[0]!.createdAt);
    const humanAfterRoot = pr.comments.nodes.filter(
      (c) => c.author?.__typename !== 'Bot' && Date.parse(c.createdAt) > rootAt,
    );
    expect(humanAfterRoot.length).toBeGreaterThan(0);

    // A human comment after the root NAMES the thread on a `disposition:`
    // line — the calibration replay line posted on the PR under the 2026-09-16
    // ruling — asserted through the SHIPPED predicate, never a copy (r2-f8).
    const rootId = thread.comments.nodes[0]!.databaseId;
    expect(rootId).toBe(4000747291);
    expect(humanAfterRoot.some((c) => dispositionedRootIds(c.body).includes(rootId))).toBe(true);

    const e = evaluate('totem-2871.json', { tier: 'pilot' });
    // 17 runs under 16 names on the 2026-09-18 re-capture: one name ran twice
    // (both SUCCESS) and is judged by its later run (mmnto-ai/totem#2879) — a
    // live specimen of the collapse inside the discharge specimen.
    expect(e.detail.checks).toEqual({
      total: 16,
      success: 16,
      pending: 0,
      failing: 0,
      superseded: 1,
    });
    expect(e.detail.threads.unresolvedBot).toBe(0);
    expect(e.detail.highInline).toBe(0);
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 0, prLevelDisposition: 1 });
    // Merged, so GitHub answers UNKNOWN: the read lands on the arm that is
    // reachable ONLY when predicates 1–4 have passed — the replay's witness.
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/mergeStateStatus: UNKNOWN/);
    expect(
      e.notices.some((n) => n.includes('1 HIGH/Major bot inline(s) on the head commit discharged')),
    ).toBe(true);
  });

  it('sends the exported query, as argv, with no shell string anywhere', () => {
    const e = evaluate('liquid-city-363.json');
    expect(e.calls[0]).toEqual(['--version']);
    const graphql = e.calls[1]!;
    expect(graphql.slice(0, 3)).toEqual(['api', 'graphql', '-f']);
    expect(graphql[3]).toBe(`query=${MERGE_READY_QUERY}`);
    expect(graphql).toContain('owner=mmnto-ai');
    expect(graphql).toContain('name=liquid-city');
    expect(graphql).toContain('number=363');
    // A typed variable for `$number: Int!`, a string for the rest.
    expect(graphql[graphql.indexOf('number=363') - 1]).toBe('-F');
  });
});

// ─── Predicate 1: checks ────────────────────────────────────────────────────

describe('merge-ready — predicate 1 (checks)', () => {
  it('a failing check denies and names it', () => {
    const e = evaluate('synthetic-failing-check.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('checks');
    expect(e.verdict.reason).toContain('Totem Lint');
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 1,
      pending: 0,
      failing: 1,
      superseded: 0,
    });
  });

  it('a still-running check denies and names it', () => {
    const e = evaluate('synthetic-pending-check.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('checks');
    expect(e.verdict.reason).toMatch(/still running/);
    expect(e.detail.checks.pending).toBe(1);
  });

  it('R5 — zero checks passes predicate 1 as a FACT, with the count and ONE stderr line', () => {
    const e = evaluate('synthetic-zero-checks.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.checks).toEqual({
      total: 0,
      success: 0,
      pending: 0,
      failing: 0,
      superseded: 0,
    });
    const zeroLines = e.notices.filter((n) => n.includes('ZERO status checks'));
    expect(zeroLines).toHaveLength(1);
    expect(zeroLines[0]).toMatch(/branch protection/i);
  });

  // ─── Same-named runs are judged by the LATEST run (mmnto-ai/totem#2879) ──
  //
  // The rollup lists EVERY check run on the head, a concurrency group's
  // cancelled duplicate beside the run that superseded it, and its order is
  // not chronological (mmnto-ai/totem#2877's head listed the later D1 run
  // first). The latest run is the greatest `databaseId`. Two fixtures list
  // the greater id in opposite positions so that neither "first listed" nor
  // "last listed" survives as a mutant.

  it('2879 — a concurrency-cancelled run beside the LATER success of the same name passes predicate 1, listed order notwithstanding', () => {
    // The later (success) run is listed FIRST; a last-listed-wins read would
    // judge the cancelled one and deny.
    const e = evaluate('synthetic-check-superseded-cancelled.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 2,
      pending: 0,
      failing: 0,
      superseded: 1,
    });
    const lines = e.notices.filter((n) => n.includes('times on the head commit'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      'check "Auto-close required check (D1)" ran 2 times on the head commit — judged by its latest run 5003 (success)',
    );
    expect(lines[0]).toContain('1 superseded run(s) not counted (mmnto-ai/totem#2879)');
  });

  it('2879 — a success and then a LATER cancelled run of the same name DENIES naming the check: the earlier success does not stand in', () => {
    // The greater id (cancelled) is listed SECOND; a first-listed-wins read
    // would judge the success and allow.
    const e = evaluate('synthetic-check-cancelled-after-success.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('checks');
    expect(e.verdict.reason).toContain(
      '1 of 2 status checks are failing (Auto-close required check (D1))',
    );
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 1,
      pending: 0,
      failing: 1,
      superseded: 1,
    });
  });

  it('2879 — ONE cancelled run with no later run of its name still denies: the negative that must hold', () => {
    const e = evaluate('synthetic-check-single-cancelled.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('checks');
    expect(e.verdict.reason).toContain('Auto-close required check (D1)');
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 1,
      pending: 0,
      failing: 1,
      superseded: 0,
    });
    expect(e.notices.join('\n')).not.toMatch(/times on the head commit/);
  });

  it('2879 — two runs of one name where one carries no readable databaseId is UNREADABLE at both tiers, never the first or the last one listed', () => {
    for (const tier of ['strict', 'pilot'] as const) {
      const e = evaluate('synthetic-check-duplicate-id-missing.json', { tier });
      expect(e.verdict.disposition, tier).toBe(tier === 'pilot' ? 'warn' : 'deny');
      expect(e.verdict.provenance.ref, tier).toBe('unevaluable');
      expect(e.verdict.reason, tier).toContain('no readable databaseId');
      expect(e.verdict.reason, tier).toContain('Auto-close required check (D1)');
      expect(e.detail.checks, tier).toEqual({
        total: 0,
        success: 0,
        pending: 0,
        failing: 0,
        superseded: 0,
      });
    }
  });

  it('2879 — the query selects databaseId on CheckRun, so the judgment reads what gh answers', () => {
    expect(MERGE_READY_QUERY).toContain('... on CheckRun { name status conclusion databaseId }');
  });

  // ─── The fold of the leg's F1–F4, F7: arithmetic and tolerances, not only
  // the two-run happy path ─────────────────────────────────────────────────

  it('2879 — superseded counts RUNS, one disclosure line per name, and an earlier FAILED run is superseded like a cancelled one (leg F1, F2, F7)', () => {
    // Three D1 runs (FAILURE, CANCELLED, SUCCESS) beside two Totem Lint runs:
    // a mutant counting NAMES would say 2; the lines carry their whole names.
    const e = evaluate('synthetic-check-three-runs-two-names.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.checks).toEqual({
      total: 3,
      success: 3,
      pending: 0,
      failing: 0,
      superseded: 3,
    });
    const lines = e.notices.filter((n) => n.includes('times on the head commit'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      'check "Auto-close required check (D1)" ran 3 times on the head commit — judged by its latest run 5004 (success)',
    );
    expect(lines[0]).toContain('2 superseded run(s) not counted');
    expect(lines[1]).toContain(
      'check "Totem Lint" ran 2 times on the head commit — judged by its latest run 5006 (success)',
    );
    expect(lines[1]).toContain('1 superseded run(s) not counted');
    for (const line of lines) expect(line).not.toContain('…');
  });

  it('2879 — a check that ran ONCE with no readable databaseId is judged on its conclusion: the id orders same-named runs and nothing else (leg F3)', () => {
    const e = evaluate('synthetic-check-single-null-id.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 2,
      pending: 0,
      failing: 0,
      superseded: 0,
    });
    expect(e.notices.join('\n')).not.toMatch(/times on the head commit|could not derive/);
  });

  it('2879 — same-named runs on different pages of the checks connection are judged together, after the last page (leg F4)', () => {
    const e = evaluate('synthetic-check-duplicate-across-pages.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.checks).toEqual({
      total: 2,
      success: 2,
      pending: 0,
      failing: 0,
      superseded: 1,
    });
    const graphql = e.calls.filter((c) => c[0] === 'api');
    expect(graphql).toHaveLength(2);
    expect(graphql[1]).toContain('checksAfter=checks-page-1');
    const lines = e.notices.filter((n) => n.includes('times on the head commit'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('judged by its latest run 5003 (success)');
  });

  // ─── The rollup must BELONG to the head commit (fold F7) ────────────────
  //
  // Predicate 1 reads `commits(last: 1)`. Every way that node can fail to be
  // the head commit's green rollup is UNEVALUABLE — a green light read off
  // another commit, or off an unreadable answer, is the one outcome this gate
  // must never produce.

  it('a rollup that belongs to another commit is unevaluable, never a green light', () => {
    const e = evaluate('synthetic-rollup-commit-mismatch.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/rollup belongs to/i);
    expect(
      evaluate('synthetic-rollup-commit-mismatch.json', { tier: 'pilot' }).verdict.disposition,
    ).toBe('warn');
  });

  it('a PR that answered no commits is unevaluable', () => {
    const e = evaluate('synthetic-no-commits.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/no commits/i);
  });

  it('a rollup with no contexts connection is unevaluable, NOT the zero-checks fact', () => {
    const e = evaluate('synthetic-rollup-no-contexts.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/no contexts connection/i);
    expect(e.notices.some((n) => n.includes('ZERO status checks'))).toBe(false);
  });

  it('a rollup reporting PENDING while listing zero checks is unevaluable, not R5', () => {
    const e = evaluate('synthetic-rollup-state-without-checks.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/listed no checks/i);
    expect(e.notices.some((n) => n.includes('ZERO status checks'))).toBe(false);
  });

  it('a rollup that CLAIMS checks while listing none is unevaluable, not R5 (round 3, F9)', () => {
    // SUCCESS over an empty list is only the zero-checks fact when the rollup
    // also says the count is zero. `totalCount: 3` with nothing listed is a
    // truncated answer, not a PR without checks.
    const e = evaluate('synthetic-rollup-count-without-checks.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/claims 3 checks but the read materialised 0/i);
    expect(e.notices.some((n) => n.includes('ZERO status checks'))).toBe(false);
    expect(
      evaluate('synthetic-rollup-count-without-checks.json', { tier: 'pilot' }).verdict.disposition,
    ).toBe('warn');
  });

  it('a totalCount that is not a non-negative integer is unevaluable (round 4, F3)', () => {
    // The count is judged AS THE API TYPED IT. A `> 0` test on an untyped value
    // let a string "3", a boolean and a negative fall through to the
    // zero-checks fact and ALLOW.
    for (const file of [
      'synthetic-rollup-count-string.json',
      'synthetic-rollup-count-negative.json',
      'synthetic-rollup-count-boolean.json',
    ]) {
      const e = evaluate(file);
      expect(e.verdict.disposition, file).toBe('deny');
      expect(e.verdict.provenance.ref, file).toBe('unevaluable');
      expect(e.verdict.reason, file).toMatch(/not a non-negative integer/i);
      expect(
        e.notices.some((n) => n.includes('ZERO status checks')),
        file,
      ).toBe(false);
      expect(evaluate(file, { tier: 'pilot' }).verdict.disposition, file).toBe('warn');
    }
  });

  it('a claimed count the read did not materialise is an incomplete read (round 4, F3)', () => {
    // `totalCount: 3` with ONE node listed used to read as "1/1 green" and
    // allow. The claim and the delivery must agree, or the read is incomplete.
    const e = evaluate('synthetic-rollup-count-mismatch.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/claims 3 checks but the read materialised 1/i);
    expect(
      evaluate('synthetic-rollup-count-mismatch.json', { tier: 'pilot' }).verdict.disposition,
    ).toBe('warn');
  });

  it('a rollup whose state is null or not a string is unevaluable, not R5 (round 2, F3)', () => {
    // R5's fact needs the rollup to be CONSISTENT about having no checks: absent
    // entirely, or SUCCESS over an empty list. A state that cannot be read is
    // not a green light — before this it fell through the fact and ALLOWED.
    for (const file of [
      'synthetic-rollup-state-null.json',
      'synthetic-rollup-state-non-string.json',
    ]) {
      const e = evaluate(file);
      expect(e.verdict.disposition, file).toBe('deny');
      expect(e.verdict.provenance.ref, file).toBe('unevaluable');
      expect(e.verdict.reason, file).toMatch(/unreadable/i);
      expect(
        e.notices.some((n) => n.includes('ZERO status checks')),
        file,
      ).toBe(false);
      expect(evaluate(file, { tier: 'pilot' }).verdict.disposition, file).toBe('warn');
    }
  });
});

// ─── Predicate 2 + 4: bot threads and severity ──────────────────────────────

describe('merge-ready — predicates 2 and 4 (bot threads)', () => {
  it('an unresolved, non-outdated bot thread denies', () => {
    const e = evaluate('synthetic-unresolved-bot-thread.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unresolved-bot-threads');
    expect(e.detail.threads.unresolvedBot).toBe(1);
  });

  it('resolved, outdated and HUMAN threads never deny (the bot filter is the identity list)', () => {
    const e = evaluate('synthetic-resolved-outdated-human-threads.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.threads.unresolvedBot).toBe(0);
    expect(e.detail.highInline).toBe(0);
  });

  it('a HIGH inline whose comment applies to an OLDER commit does not deny', () => {
    const e = evaluate('synthetic-stale-commit-high-inline.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.highInline).toBe(0);
  });

  it('the NEGATIVE CONTROL — a RESOLVED HIGH inline still on the HEAD commit with no disposition on record denies at predicate 4 (mmnto-ai/totem#2861)', () => {
    // Predicate 4's own territory (fold F2 of mmnto-ai/totem#2800, narrowed by
    // the 2861 ruling), in the FIELD shape the legs constructed (f1, r2-f1): a
    // bare UI resolve on a PR that keeps accumulating human comments. The only
    // disposition naming this thread (root id 1001) PRE-dates the root; after
    // it come a Bot's summary, a `[bot]`-suffixed login carrying the line (a
    // counterfactual shape — GraphQL answers `Bot` for every App — kept to
    // exercise the suffix arm), human chatter, and a later round's disposition
    // that names ANOTHER thread (9999) and says so; the only in-thread reply is
    // the bot's own. Predicate 2 passes, nothing discharges, the finding still
    // applies, and the reason names the line it looked for AHEAD of the quoted
    // body so it survives the matched bound (f6).
    const e = evaluate('synthetic-head-commit-high-inline.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('high-severity-inline');
    expect(e.detail.threads.unresolvedBot).toBe(0); // predicate 2 did NOT fire
    expect(e.detail.highInline).toBe(1);
    expect(e.detail.dischargedHigh).toBe(0);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 0, prLevelDisposition: 0 });
    // The reason names the LINE the read looked for — with this thread's own
    // id — never "no disposition exists" (r2-f3: a round disposition that
    // answered other threads is a real event).
    expect(e.verdict.reason).toContain('"disposition: 1001 <verb>"');
    expect(e.verdict.reason).toMatch(/and no non-bot reply in its thread/);
    expect(e.verdict.reason).toMatch(/a round disposition that did not name this thread/);
    // The id survives the 160-character bound on `matched` because the line
    // LEADS the clause (r3-f3: a clause that led with prose cut it off).
    expect(e.verdict.provenance.matched).toContain('"disposition: 1001 <verb>"');
    expect(e.notices.some((n) => n.includes('discharged'))).toBe(false);
    // The fixture really carries the post-dating human chatter the field has.
    const fixture = loadFixture('synthetic-head-commit-high-inline.json');
    const pr = (
      fixture.pages[0]!.body as {
        data: {
          repository: {
            pullRequest: {
              comments: {
                nodes: Array<{
                  author: { __typename: string; login: string };
                  body: string;
                  createdAt: string;
                }>;
              };
            };
          };
        };
      }
    ).data.repository.pullRequest;
    const humanAfterRoot = pr.comments.nodes.filter(
      (c) => c.author.__typename === 'User' && c.createdAt > '2026-09-08T03:00:00Z',
    );
    // Three post-dating User-typed nodes: the `[bot]`-suffixed login NAMING
    // this thread (skipped by the suffix arm, not by content), the human
    // chatter, and the other round's disposition naming 9999 — asserted
    // through the shipped predicate. The last is the r2-f1 shape: under a
    // round-keyed read it discharged; under the id it cannot.
    const suffixed = humanAfterRoot.filter((c) => /\[bot\]$/i.test(c.author.login));
    const humans = humanAfterRoot.filter((c) => !/\[bot\]$/i.test(c.author.login));
    expect(suffixed.length).toBe(1);
    expect(dispositionedRootIds(suffixed[0]!.body)).toContain(1001);
    expect(humans.length).toBe(2);
    expect(humans.every((c) => !dispositionedRootIds(c.body).includes(1001))).toBe(true);
    expect(humans.some((c) => dispositionedRootIds(c.body).includes(9999))).toBe(true);
  });

  // ─── The discharge read (mmnto-ai/totem#2861) ────────────────────────────
  //
  // A HIGH on the head whose thread was RESOLVED through the disposition path
  // — the resolve-threads evidence rule on the same read — no longer applies.
  // The bare resolve above is the fail-closed arm; these are the two evidence
  // arms and the edges of each.

  it('a resolved HIGH on the head with a non-bot PR-level disposition line naming it AFTER its root is discharged', () => {
    const e = evaluate('synthetic-high-inline-discharged-pr-level.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.highInline).toBe(0);
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 0, prLevelDisposition: 1 });
    // The audit breadcrumb: what the predicate RELEASED, and by which arm, is
    // on stderr.
    const line = e.notices.find((n) => n.includes('discharged through the disposition path'));
    expect(line).toBeDefined();
    expect(line).toContain('1 HIGH/Major bot inline(s)');
    expect(line).toContain('1 by a PR-level disposition line naming the thread');
    expect(line).toContain('mmnto-ai/totem#4242');
  });

  it('a resolved HIGH on the head with a non-bot IN-THREAD reply and no PR-level comment is discharged', () => {
    const e = evaluate('synthetic-high-inline-discharged-in-thread.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.highInline).toBe(0);
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 1, prLevelDisposition: 0 });
    expect(e.notices.join('\n')).toContain('1 by a non-bot in-thread reply');
  });

  it('a root with no readable databaseId is a thread no line can name — it stays applying, and the page stays readable (r3-f4)', () => {
    // The schema types `databaseId` nullable. A page-scoped refusal would
    // route the PR into the unevaluable class, which pilot maps to `warn` —
    // the same downgrade fold 1 removed for the incomplete window. So the
    // thread alone fails closed, at both tiers, and the reason says why.
    for (const tier of ['strict', 'pilot'] as const) {
      const e = evaluate('synthetic-high-inline-root-id-missing.json', { tier });
      expect(e.verdict.disposition, tier).toBe('deny');
      expect(e.verdict.provenance.ref, tier).toBe('high-severity-inline');
      expect(e.verdict.reason, tier).toMatch(/no line can name it/);
      expect(e.detail.highInline, tier).toBe(1);
      expect(e.detail.dischargedHigh, tier).toBe(0);
      expect(e.notices.join('\n'), tier).not.toMatch(/could not derive/);
    }
  });

  it('evidence FOUND discharges even when the thread window is incomplete (f7)', () => {
    // The window is incomplete (`hasNextPage`) and carries only the bot's own
    // reply, but the PR-level disposition after the root is on record: the
    // completeness test never precedes the evidence tests.
    const e = evaluate('synthetic-high-inline-discharged-window-incomplete.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 0, prLevelDisposition: 1 });
  });

  it('a deleted-account reply (author: null) is a human reply — the resolve-threads rule', () => {
    const e = evaluate('synthetic-high-inline-deleted-author-reply.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.dischargedHigh).toBe(1);
  });

  it('an UNRESOLVED HIGH with a post-dating disposition is NOT discharged: the resolve is required, predicate 2 denies first', () => {
    const e = evaluate('synthetic-high-inline-unresolved-with-disposition.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unresolved-bot-threads');
    expect(e.detail.highInline).toBe(1);
    expect(e.detail.dischargedHigh).toBe(0);
  });

  it('discharge is judged PER THREAD: one discharged beside one bare denies at predicate 4 naming the bare one', () => {
    const e = evaluate('synthetic-high-inline-mixed-discharge.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('high-severity-inline');
    expect(e.detail.highInline).toBe(1);
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.dischargedBy).toEqual({ inThreadReply: 1, prLevelDisposition: 0 });
    expect(e.verdict.reason).toContain('coderabbitai');
    expect(e.verdict.reason).toContain('"disposition: 1002 <verb>"');
    expect(e.verdict.reason).toMatch(/a round disposition that did not name this thread/);
  });

  it('the pr-level fixture disposition names root 1001 on its line, read through the shipped predicate', () => {
    // Read straight off the fixture rather than only through the verdict: the
    // negative control's post-dating comments name nothing but 9999 (asserted
    // above), while the pr-level fixture's disposition body names the thread.
    const pr = (
      loadFixture('synthetic-high-inline-discharged-pr-level.json').pages[0]!.body as {
        data: {
          repository: {
            pullRequest: {
              comments: {
                nodes: Array<{ author: { __typename: string }; body: string }>;
              };
            };
          };
        };
      }
    ).data.repository.pullRequest;
    const human = pr.comments.nodes.filter((c) => c.author.__typename === 'User');
    expect(human).toHaveLength(1);
    expect(dispositionedRootIds(human[0]!.body)).toEqual([1001]);
  });

  it('the disposition line is read at line start anywhere in the body, fenced included, and never inside an HTML comment, a quote, a list or a span', () => {
    const line = 'disposition: 4000747291 declined';
    // The skills render machine lines inside text fences; a fenced line counts.
    expect(dispositionedRootIds(`## Round 1 disposition\n\n\`\`\`text\n${line}\n\`\`\`\n`)).toEqual(
      [4000747291],
    );
    expect(dispositionedRootIds(`prose\n\n${line}`)).toEqual([4000747291]);
    expect(dispositionedRootIds(`   ${line}`)).toEqual([4000747291]);
    expect(dispositionedRootIds(`\t${line}`)).toEqual([4000747291]);
    expect(dispositionedRootIds(`## Round 1 disposition\r\n\r\n${line}\r\n`)).toEqual([4000747291]);
    // Several lines, in order, without duplicates; a verb is not required.
    expect(
      dispositionedRootIds(
        'disposition: 11 fixed\ndisposition: 22 declined\ndisposition: 11 nit\ndisposition: 33',
      ),
    ).toEqual([11, 22, 33]);
    // Not at line start: an inline span mid-sentence, a blockquote, a list
    // item, a table cell. Not the token: a prose sentence, a different key.
    expect(dispositionedRootIds(`as recorded: \`${line}\`.`)).toEqual([]);
    expect(dispositionedRootIds(`> ${line}`)).toEqual([]);
    expect(dispositionedRootIds(`- ${line}`)).toEqual([]);
    expect(dispositionedRootIds(`| ${line} |`)).toEqual([]);
    expect(dispositionedRootIds('the disposition: 4000747291 was declined')).toEqual([]);
    expect(dispositionedRootIds('dispositions: 4000747291 declined')).toEqual([]);
    // An HTML comment is stripped before the read — terminated, or left open
    // to the end of the body the way a renderer hides it (r3-f9).
    expect(dispositionedRootIds(`<!--\n${line}\n-->`)).toEqual([]);
    expect(dispositionedRootIds(`<!-- note\n${line}`)).toEqual([]);
    expect(dispositionedRootIds(`${line}\n<!-- note`)).toEqual([4000747291]);
    // The id is the exact decimal the seat copied: a longer run of digits is
    // a different id, and nothing coerced — a leading zero, a fraction, a
    // glued letter or dash is not this id (r3-f5: `Number()` had equated
    // `01001`, `1001.5` and `1001x` to 1001).
    expect(dispositionedRootIds('disposition: 40007472911 declined')).toEqual([40007472911]);
    for (const lenient of [
      'disposition: 04000747291 declined',
      'disposition: 4000747291.0 declined',
      'disposition: 4000747291.5 declined',
      'disposition: 4000747291x declined',
      'disposition: 4000747291-fixed',
      'disposition: +4000747291 declined',
      'disposition:4000747291 declined',
      'Disposition: 4000747291 declined',
    ]) {
      expect(dispositionedRootIds(lenient), lenient).toEqual([]);
    }
    expect(dispositionedRootIds('disposition: 4000747291')).toEqual([4000747291]);
    expect(dispositionedRootIds('disposition: 4000747291\r\n')).toEqual([4000747291]);
    expect(dispositionedRootIds('no line at all')).toEqual([]);
    // A fenced QUOTE of a prior disposition names the same ids it named — the
    // disclosed residue of accepting fenced lines; it can only re-name threads
    // an earlier disposition already named.
    expect(
      dispositionedRootIds(
        `For the record, the round disposition read:\n\n\`\`\`\n${line}\n\`\`\``,
      ),
    ).toEqual([4000747291]);
  });

  it('PR-level evidence on the SECOND comments page is found, with the cursor sent', () => {
    const e = evaluate('synthetic-comments-second-page-evidence.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.dischargedHigh).toBe(1);
    expect(e.detail.threads.pagesRead).toBe(2);
    expect(e.calls[2]).toContain('commentsAfter=CURSOR-C1');
  });

  it('a resolved HIGH with more comments than the window and no evidence in what was read is a bare resolve that DENIES at both tiers, the reason naming the window (f2)', () => {
    // Pre-cure this shape was a predicate-4 FACT that denied at every tier; a
    // first fold routed it to the unevaluable class, which pilot maps to
    // `warn` — a downgrade the first leg caught (f2). It is a fact-side deny
    // again, judged on what was read, and the reason says the window was
    // incomplete rather than calling the thread unanswered outright.
    for (const tier of ['strict', 'pilot'] as const) {
      const e = evaluate('synthetic-high-inline-resolved-window-incomplete.json', { tier });
      expect(e.verdict.disposition, tier).toBe('deny');
      expect(e.verdict.provenance.ref, tier).toBe('high-severity-inline');
      expect(e.verdict.reason, tier).toMatch(
        /no non-bot reply in the ten comments read \(the thread has more/,
      );
      expect(e.verdict.reason, tier).toContain('"disposition: 1001 <verb>"');
      // The id sits inside the 160-character bound on `matched` (r3-f3).
      expect(e.verdict.provenance.matched, tier).toContain('"disposition: 1001 <verb>"');
      expect(e.detail.highInline, tier).toBe(1);
      expect(e.detail.dischargedHigh, tier).toBe(0);
      expect(e.notices.join('\n'), tier).not.toMatch(/could not derive/);
    }
  });

  it('reads comment.commit (where the finding applies NOW), never originalCommit', () => {
    // The falsifier for the inert predicate this fold removed: both fixtures
    // carry the SAME `originalCommit` (an older sha) and differ only in
    // `commit.oid`. A predicate keyed on the write-time commit cannot tell them
    // apart — it would allow both.
    const stale = evaluate('synthetic-stale-commit-high-inline.json');
    const current = evaluate('synthetic-head-commit-high-inline.json');
    expect(stale.verdict.disposition).toBe('allow');
    expect(current.verdict.disposition).toBe('deny');
  });

  it('CodeRabbit "Potential issue" reads as a HIGH marker (fold F9)', () => {
    const e = evaluate('synthetic-coderabbit-potential-issue.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('high-severity-inline');
    expect(hasHighSeverityMarker('_Potential issue_ the error is dropped')).toBe(true);
    expect(hasHighSeverityMarker('nit: rename this local')).toBe(false);
  });
});

// ─── The severity read's false-positive budget (ADR-109, fold round 2 F4) ───
//
// Predicate 4 is the gate's only non-exact-match read, so ADR-109 requires a
// STATED budget and the fixture that measures it — the transport-shield
// precedent. The budget is ZERO high-severity reads over the benign corpus, and
// this is the fixture: every bot inline thread on mmnto-ai/totem#2820 through
// mmnto-ai/totem#2839, each carrying the severity ITS OWN BOT declared.
//
// The read is measured against the bots' declarations, not against a hand list,
// so a marker that widens into prose fails here rather than in a merge.

interface CorpusThread {
  thread: string;
  pr: number;
  bot: string;
  isResolved: boolean;
  /** The commit the comment applies to NOW (what predicate 4 reads). */
  commit: string;
  /** The commit it was WRITTEN against — equal to `commit` until GitHub re-points it. */
  originalCommit: string;
  /** True when the two differ: the gap predicate 4 exists for. */
  rePointed: boolean;
  declaredLabel: string;
  expectedHigh: boolean;
  body: string;
}

describe('merge-ready — the severity read over the benign corpus', () => {
  const corpus = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, 'benign-corpus-bot-inlines.json'), 'utf-8'),
  ) as { threads: CorpusThread[]; prsThatAnswered: number };

  it('the corpus is the whole window, not a hand-picked subset', () => {
    expect(corpus.threads.length).toBe(16);
    expect(corpus.prsThatAnswered).toBe(10);
    // Every one of the three review bots is represented.
    expect(new Set(corpus.threads.map((t) => t.bot))).toEqual(
      new Set(['greptile-apps', 'coderabbitai', 'gemini-code-assist']),
    );
  });

  it('BUDGET: the read agrees with every bot own severity label — zero false reads', () => {
    const disagreements = corpus.threads.filter(
      (t) => hasHighSeverityMarker(t.body) !== t.expectedHigh,
    );
    expect(
      disagreements.map((t) => `${t.thread} (${t.declaredLabel})`),
      'the severity read disagreed with a bot own declaration',
    ).toEqual([]);
    expect(corpus.threads.filter((t) => t.expectedHigh).length).toBe(8);
  });

  it('states the re-pointing counts the README claims (round 3, F2)', () => {
    // `comment.commit` moves as the diff moves; `originalCommit` does not.
    // Predicate 4 exists because of that gap, so the corpus must SHOW it — and
    // show it where it actually happens. mmnto-ai/totem#2831 re-points nothing
    // among its HIGH threads, which the README used to claim it did.
    const rePointed = corpus.threads.filter((t) => t.rePointed);
    const highRePointed = rePointed.filter((t) => t.expectedHigh);
    expect(rePointed.length).toBe(8);
    expect(highRePointed.map((t) => t.pr).sort()).toEqual([2827, 2839, 2839]);

    // The per-PR breakdowns the README prints, asserted here so the table
    // cannot drift from the fixture (round 4, F12).
    const byPr = (rows: CorpusThread[]): Record<number, number> =>
      rows.reduce<Record<number, number>>(
        (acc, t) => ({ ...acc, [t.pr]: (acc[t.pr] ?? 0) + 1 }),
        {},
      );
    expect(byPr(rePointed)).toEqual({ 2827: 1, 2830: 1, 2831: 2, 2834: 1, 2839: 3 });
    expect(byPr(highRePointed)).toEqual({ 2827: 1, 2839: 2 });
    expect(byPr(corpus.threads.filter((t) => t.expectedHigh))).toEqual({
      2821: 1,
      2827: 1,
      2830: 1,
      2831: 3,
      2839: 2,
    });
    expect(corpus.threads.filter((t) => t.pr === 2831 && t.expectedHigh && t.rePointed)).toEqual(
      [],
    );
    // Every row carries both commit fields, so the claim stays checkable.
    for (const t of corpus.threads) {
      expect(typeof t.commit, t.thread).toBe('string');
      expect(typeof t.originalCommit, t.thread).toBe('string');
    }
  });

  it('the greptile P2 thread on mmnto-ai/totem#2831 reads NOT high (the fold F4 falsifier)', () => {
    // The prose read this replaced flagged it, through the word "critical" in
    // its own explanation: a false deny on a finding its author ranked below
    // the bar. The badge alt text is what decides now.
    const p2 = corpus.threads.find((t) => t.thread === 'mmnto-ai/totem#2831/thread-2');
    expect(p2, 'the P2 specimen must stay in the corpus').toBeDefined();
    expect(p2!.declaredLabel).toBe('alt="P2"');
    expect(p2!.body.toLowerCase()).toContain('critical'); // the prose that fooled the old read
    expect(hasHighSeverityMarker(p2!.body)).toBe(false);
  });

  it('CODE is not a label: a marker quoted in a fence or a code span is not high (round 3, F4)', () => {
    // The firing path this closes: this gate's own docstring carries every
    // marker, so a CodeRabbit Minor whose suggestion block quotes merge-ready.ts
    // would read as HIGH and false-deny the gate's own maintenance PR.
    const quoted = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, 'synthetic-benign-fenced-marker-quote.json'), 'utf-8'),
    ) as { threads: CorpusThread[] };
    const row = quoted.threads[0]!;
    expect(row.declaredLabel).toBe('_\u{1F7E1} Minor_');
    expect(row.body).toContain('```'); // the fence really is in the body
    expect(hasHighSeverityMarker(row.body)).toBe(false);

    // A4 — a TRUE control (round 4, F11): a fenced block on its own lines
    // carrying the label cell. Pre-strip this read HIGH (the cell opens a line
    // inside the fence); post-strip it does not. The earlier A4 row was an
    // inline span mid-sentence, which never read HIGH either way.
    expect(
      hasHighSeverityMarker('here is the row:\n\n```md\n| _\u{1F7E0} Major_ |\n```\n\nend'),
    ).toBe(false);
    // The same cell OUTSIDE the fence still reads HIGH — the control's other half.
    expect(hasHighSeverityMarker('here is the row:\n\n| _\u{1F7E0} Major_ |\n\nend')).toBe(true);
    // A5 — a backtick fence.
    expect(
      hasHighSeverityMarker('see below\n\n```md\n_\u{1F534} Critical_ | body\n```\n\ndone'),
    ).toBe(false);
    // A6 — a tilde fence.
    expect(
      hasHighSeverityMarker('see below\n\n~~~md\n<img alt="P1" src="x.svg">\n~~~\n\ndone'),
    ).toBe(false);
    // The complement: the SAME label outside code still reads high.
    expect(hasHighSeverityMarker('_\u{1F534} Critical_ | body')).toBe(true);

    // An indented block and a <pre> block are code too (round 4, F4).
    expect(hasHighSeverityMarker('example:\n\n    _\u{1F534} Critical_ | body\n\ndone')).toBe(
      false,
    );
    expect(hasHighSeverityMarker('example:\n\n<pre>\n_\u{1F534} Critical_ | body\n</pre>\n')).toBe(
      false,
    );
  });

  it('stripping code leaves a PLACEHOLDER, not a gap that opens an anchor (round 4, F2)', () => {
    // The round-3 stripper replaced a span with a SPACE, so the text after it
    // began a fresh line/cell position and the CR arm matched — a regression
    // the stripper itself introduced. Each of these read HIGH with a space
    // placeholder and must not now.
    expect(hasHighSeverityMarker('``_\u{1F7E0} Major_``')).toBe(false);
    expect(hasHighSeverityMarker('`x`_\u{1F7E0} Major_')).toBe(false);
    expect(hasHighSeverityMarker('| `x`_\u{1F7E0} Major_ |')).toBe(false);
    // A label with no code anywhere near it is untouched by the stripper.
    expect(hasHighSeverityMarker('| _\u{1F7E0} Major_ |')).toBe(true);
  });

  it('the glyph class is read as CODE POINTS, not surrogate halves (round 4, F9)', () => {
    // Without the `u` flag the astral dots decompose, so a lone surrogate — or
    // a bare variation selector — before "major" matched as if it were one.
    expect(hasHighSeverityMarker('\uD83D major rewrite')).toBe(false);
    expect(hasHighSeverityMarker('\uDD34 major rewrite')).toBe(false);
    // Built from its code point, never pasted: a raw variation selector is
    // invisible in a diff and an editor can drop it, which would leave this
    // control asserting nothing (round 5, F7).
    expect(hasHighSeverityMarker(`${String.fromCharCode(0xfe0f)} major rewrite`)).toBe(false);
    // The four dots and the warning sign still read as labels.
    for (const glyph of ['\u{1F534}', '\u{1F7E0}', '\u{1F7E1}', '\u{1F535}', '⚠']) {
      expect(hasHighSeverityMarker(`${glyph} Critical\n\nbody`), glyph).toBe(true);
    }
  });

  it('the greptile badge is read whatever the quote style, unquoted included (round 4, F10)', () => {
    expect(hasHighSeverityMarker('<img alt="P1" src="x.svg">')).toBe(true);
    expect(hasHighSeverityMarker("<img alt='P1' src='x.svg'>")).toBe(true);
    expect(hasHighSeverityMarker('<img alt=P1 src=x.svg>')).toBe(true);
    expect(hasHighSeverityMarker('<img alt=P0 />')).toBe(true);
    // The levels below the bar stay below it in every spelling.
    expect(hasHighSeverityMarker('<img alt=P2 src=x.svg>')).toBe(false);
    // And an alt value that merely STARTS with P1 is not the badge.
    expect(hasHighSeverityMarker('<img alt=P1x src=x.svg>')).toBe(false);
  });

  it('an em-dash-led line is not a label (round 3, F7)', () => {
    // LABEL_GLYPH was "any glyph that is not ASCII", so a line opening with an
    // em dash read as a CodeRabbit heading. It is now the four severity dots
    // and the warning sign only.
    expect(hasHighSeverityMarker('— major rewrite of the parser')).toBe(false);
    expect(hasHighSeverityMarker('– critical path timing')).toBe(false);
    expect(hasHighSeverityMarker('⚠️ Potential issue\n\nthe error is dropped')).toBe(true);
  });

  it('reads each bot structured label, and no prose that merely uses the words', () => {
    // Positives: the label forms, transcribed from the corpus.
    for (const label of [
      '<a href="#"><img alt="P0" src="x.svg" align="top"></a> **Boom**',
      '<a href="#"><img alt="P1" src="x.svg" align="top"></a> **Boom**',
      '![high](https://www.gstatic.com/codereviewagent/high-priority.svg)',
      '_Potential issue_\n\nthe error is dropped',
      // Single quotes: HTML permits either, so the read must not turn on the
      // quote style (round 3, F11).
      "<a href='#'><img alt='P1' src='x.svg' align='top'></a> **Boom**",
    ]) {
      expect(hasHighSeverityMarker(label), label.slice(0, 40)).toBe(true);
    }

    // Negatives: the levels below the bar, and prose that shares the words.
    for (const benign of [
      '<a href="#"><img alt="P2" src="x.svg" align="top"></a> **Nit**',
      '<a href="#"><img alt="P3" src="x.svg" align="top"></a> **Nit**',
      '![medium](https://www.gstatic.com/codereviewagent/medium-priority.svg)',
      // There is deliberately NO GCA `critical` arm: that asset 404s and GCA's
      // published rubric tops out at `high`, so an arm for it would be
      // inference rather than transcription (round 3, F5).
      '![critical](https://www.gstatic.com/codereviewagent/critical-priority.svg)',
      'This is a critical section of the parser, but only a nit.',
      '- critical path issues remain',
      '> major rewrite needed here',
      'the major refactor is out of scope',
      'a potential issue could arise if the cache is cold',
    ]) {
      expect(hasHighSeverityMarker(benign), benign.slice(0, 40)).toBe(false);
    }
  });

  it('a bot HIGH inline with a NULL commit is unevaluable, never a silent pass (round 2, F8)', () => {
    // Predicate 4's input is missing for that thread, so whether it applies to
    // the head is unknown. R2: an unreadable input is never a pass — it used to
    // fall out of the filter and read as "not on head".
    const e = evaluate('synthetic-high-inline-null-commit.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/carry no commit/i);
    expect(e.notices.join('\n')).toMatch(/could not derive/);
    expect(
      evaluate('synthetic-high-inline-null-commit.json', { tier: 'pilot' }).verdict.disposition,
    ).toBe('warn');
  });

  it('a failing check beside a null-commit HIGH inline DENIES as predicate 1 at both tiers — a tier never softens a fact (PR round 1)', () => {
    // Before the fold the unreadable-commit arm returned first, so this shape
    // was the UNEVALUABLE class: `warn` under pilot, and `ref: unevaluable`
    // under strict for an audit record whose cause was predicate 1.
    for (const tier of ['strict', 'pilot'] as const) {
      const e = evaluate('synthetic-failing-check-and-null-commit-high.json', { tier });
      expect(e.verdict.disposition, tier).toBe('deny');
      expect(e.verdict.provenance.ref, tier).toBe('checks');
      expect(e.verdict.reason, tier).toMatch(/status checks are failing/);
      expect(e.notices.join('\n'), tier).not.toMatch(/could not derive/);
    }
  });

  it("BEHIND beside a null-commit HIGH inline is still unevaluable — predicate 4's missing input precedes predicate 5 (PR round 1)", () => {
    const strict = evaluate('synthetic-merge-state-behind-and-null-commit-high.json');
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.provenance.ref).toBe('unevaluable');
    expect(strict.verdict.reason).toMatch(/carry no commit/i);
    expect(
      evaluate('synthetic-merge-state-behind-and-null-commit-high.json', { tier: 'pilot' }).verdict
        .disposition,
    ).toBe('warn');
  });

  it('no bot review present passes predicates 2-4 as a fact, never a failure', () => {
    const e = evaluate('synthetic-merge-state-clean.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.verdict.reason).toMatch(/No bot review present/);
  });
});

// ─── Predicate 3: CHANGES_REQUESTED ─────────────────────────────────────────

describe('merge-ready — predicate 3 (changes requested)', () => {
  it('an un-superseded CHANGES_REQUESTED denies; a later COMMENTED from the SAME reviewer does not clear it', () => {
    // The fixture carries satur8d CHANGES_REQUESTED, then someone-else
    // COMMENTED, then satur8d COMMENTED — GitHub's own semantics say a
    // COMMENTED review is not a decision, so it supersedes nothing (fold F6).
    // A reader that took the latest review of ANY state would report [].
    const e = evaluate('synthetic-changes-requested-standing.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('changes-requested');
    expect(e.detail.changesRequestedBy).toEqual(['satur8d']);
  });

  it('a later APPROVED from the SAME reviewer supersedes it, and a DIFFERENT reviewer COMMENTED after does not resurrect it', () => {
    // What this fixture actually proves: satur8d CHANGES_REQUESTED then
    // APPROVED (the supersession), with a coderabbitai COMMENTED afterwards
    // that must not re-open anything. The SAME-reviewer COMMENTED case is the
    // standing fixture's job, one test up (round 2, F12: the old title claimed
    // both).
    const e = evaluate('synthetic-changes-requested-superseded.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.changesRequestedBy).toEqual([]);
  });
});

// ─── Predicate 5: mergeStateStatus ──────────────────────────────────────────

describe('merge-ready — predicate 5 (mergeStateStatus)', () => {
  const passes: Array<[string, string]> = [
    ['CLEAN', 'synthetic-merge-state-clean.json'],
    ['HAS_HOOKS', 'synthetic-merge-state-has-hooks.json'],
    ['UNSTABLE', 'synthetic-merge-state-unstable.json'],
  ];
  for (const [status, file] of passes) {
    it(`${status} passes`, () => {
      const e = evaluate(file);
      expect(e.verdict.disposition).toBe('allow');
      expect(e.detail.mergeStateStatus).toBe(status);
    });
  }

  const denies: Array<[string, string]> = [
    ['BEHIND', 'synthetic-merge-state-behind.json'],
    ['DIRTY', 'synthetic-merge-state-dirty.json'],
    ['BLOCKED', 'synthetic-merge-state-blocked.json'],
    ['DRAFT', 'synthetic-merge-state-draft.json'],
  ];
  for (const [status, file] of denies) {
    it(`${status} denies at predicate 5`, () => {
      const e = evaluate(file);
      expect(e.verdict.disposition).toBe('deny');
      expect(e.verdict.provenance.ref).toBe('merge-state');
      expect(e.verdict.reason).toContain(status);
    });
  }

  it('UNKNOWN is unevaluable — strict denies, pilot warns, neither allows', () => {
    const strict = evaluate('synthetic-merge-state-unknown.json');
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.provenance.ref).toBe('unevaluable');
    expect(strict.verdict.reason).toMatch(/mergeability/i);

    const pilot = evaluate('synthetic-merge-state-unknown.json', { tier: 'pilot' });
    expect(pilot.verdict.disposition).toBe('warn');
  });

  it('a mergeStateStatus this gate does not read is unevaluable, never allow', () => {
    const e = evaluate('synthetic-merge-state-unrecognised.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toContain('SOMETHING_NEW');
  });
});

// ─── Pagination + the unevaluable class ─────────────────────────────────────

describe('merge-ready — pagination and the unevaluable class', () => {
  it('a clean first page with a dirty SECOND page denies (the capped-read bar)', () => {
    const e = evaluate('synthetic-pagination-second-page-deny.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unresolved-bot-threads');
    expect(e.detail.threads.pagesRead).toBe(2);
    expect(e.detail.threads.complete).toBe(true);
    // The second page is fetched with the first page's cursor, on the
    // number-keyed document.
    expect(e.calls[2]).toContain('threadsAfter=CURSOR-1');
  });

  it('a pagination FAILURE is unevaluable, not clean', () => {
    const strict = evaluate('synthetic-pagination-second-page-fails.json');
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.provenance.ref).toBe('unevaluable');
    expect(strict.detail.threads.complete).toBe(false);
    expect(strict.notices.join('\n')).toMatch(/could not derive/);

    const pilot = evaluate('synthetic-pagination-second-page-fails.json', { tier: 'pilot' });
    expect(pilot.verdict.disposition).toBe('warn');
    expect(pilot.verdict.disposition).not.toBe('allow');
  });

  it('a missing or truncated reviews / reviewThreads connection is unevaluable, never an empty complete list (PR round 1)', () => {
    // Greptile's round-1 P1: `?? []` and a defaulted `hasNext: false` turned an
    // answer WITHOUT these connections into "no reviews, no threads, complete",
    // and predicates 2–4 passed on a list the read never received. The checks
    // rollup already failed closed on the same shape; these now match it.
    for (const [file, pattern] of [
      ['synthetic-reviews-connection-missing.json', /reviews connection was missing/],
      ['synthetic-threads-connection-missing.json', /review threads connection was missing/],
      ['synthetic-threads-pageinfo-missing.json', /review threads connection carried no pageInfo/],
      // The evidence surface (mmnto-ai/totem#2861) is held to the same bar.
      ['synthetic-comments-connection-missing.json', /PR comments connection was missing/],
    ] as const) {
      const strict = evaluate(file);
      expect(strict.verdict.disposition, file).toBe('deny');
      expect(strict.verdict.provenance.ref, file).toBe('unevaluable');
      expect(strict.verdict.reason, file).toMatch(pattern);
      expect(strict.detail.threads.complete, file).toBe(false);
      const pilot = evaluate(file, { tier: 'pilot' });
      expect(pilot.verdict.disposition, file).toBe('warn');
      expect(pilot.verdict.disposition, file).not.toBe('allow');
    }
  });

  it('a head sha that moved between pages is unevaluable, named', () => {
    const e = evaluate('synthetic-head-moved.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/head sha moved/i);
  });

  it('a rate-limited (non-zero) gh exit is unevaluable and names what gh said', () => {
    const e = evaluate('synthetic-rate-limit-exit.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/rate limit/i);
  });

  it('a GraphQL error in a 200 body is a failed read, not an empty one', () => {
    const e = evaluate('synthetic-graphql-error-body.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unevaluable');
    expect(e.verdict.reason).toMatch(/rate limit exceeded/i);
  });

  it('gh absent or unauthenticated is unevaluable at BOTH tiers, never allow', () => {
    const strict = evaluate('synthetic-gh-absent.json');
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.reason).toMatch(/gh is unavailable/i);

    const pilot = evaluate('synthetic-gh-absent.json', { tier: 'pilot' });
    expect(pilot.verdict.disposition).toBe('warn');
    expect(pilot.notices.join('\n')).toMatch(/could not derive/);
  });

  it('every unevaluable path is named on stderr under BOTH tiers — only the exit differs', () => {
    for (const file of [
      'synthetic-gh-absent.json',
      'synthetic-rate-limit-exit.json',
      'synthetic-pagination-second-page-fails.json',
      'synthetic-head-moved.json',
      'synthetic-merge-state-unknown.json',
      'synthetic-comments-connection-missing.json',
    ]) {
      for (const tier of ['strict', 'pilot'] as const) {
        const e = evaluate(file, { tier });
        expect(e.notices.some((n) => n.includes('could not derive'))).toBe(true);
        expect(e.verdict.disposition).toBe(tier === 'pilot' ? 'warn' : 'deny');
      }
    }
  });
});

// ─── Branch resolution ──────────────────────────────────────────────────────

describe('merge-ready — branch resolution', () => {
  it('pr: null + branch resolves through the branch-keyed document', () => {
    const e = evaluate('synthetic-branch-resolution.json', {
      payload: { repo: 'mmnto-ai/totem', pr: null, branch: 'feat/example' },
    });
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.pr).toBe(4242);
    const graphql = e.calls[1]!;
    expect(graphql[3]).toBe(`query=${MERGE_READY_BRANCH_QUERY}`);
    expect(graphql).toContain('branch=feat/example');
  });
});

// ─── The audited override ───────────────────────────────────────────────────

describe('merge-ready — the audited override', () => {
  it('allows a denying PR with an audit line naming repo, pr, head sha and the predicate', () => {
    const e = evaluate('synthetic-merge-state-behind.json', {
      env: { [MERGE_READY_OVERRIDE_ENV]: '1' },
    });
    expect(e.verdict.disposition).toBe('allow');
    expect(e.verdict.provenance.ref).toBe('override');
    expect(e.detail.override).toBe(true);
    const audit = e.notices.find((n) => n.includes('OVERRIDE'));
    expect(audit).toBeDefined();
    expect(audit).toContain('mmnto-ai/totem#4242');
    // The head sha, SHORTENED to 12: the fixture sha is 40 identical chars, so
    // a bare `toContain` of the prefix could not tell 12 from 40.
    expect(audit).toContain('a'.repeat(12));
    expect(audit).not.toContain('a'.repeat(13));
    expect(audit).toContain('merge-state');
  });

  it('allows even when the READ failed, and the audit line says so', () => {
    const e = evaluate('synthetic-gh-absent.json', {
      env: { [MERGE_READY_OVERRIDE_ENV]: '1' },
    });
    expect(e.verdict.disposition).toBe('allow');
    const audit = e.notices.find((n) => n.includes('OVERRIDE'));
    expect(audit).toMatch(/would have denied: the read failed/);
  });

  it('is not triggered by any value other than exactly "1"', () => {
    const e = evaluate('synthetic-merge-state-behind.json', {
      env: { [MERGE_READY_OVERRIDE_ENV]: 'true' },
    });
    expect(e.verdict.disposition).toBe('deny');
  });
});

// ─── Payload contract ───────────────────────────────────────────────────────

describe('merge-ready — payload validation (never a default allow)', () => {
  it('accepts the wrapper projection shapes', () => {
    expect(parseMergeReadyPayload({ repo: 'mmnto-ai/totem', pr: 2800 })).toEqual({
      repo: 'mmnto-ai/totem',
      pr: 2800,
    });
    expect(
      parseMergeReadyPayload({ repo: 'mmnto-ai/totem', pr: null, branch: 'feat/x' }),
    ).toMatchObject({ pr: null, branch: 'feat/x' });
  });

  for (const [why, payload] of [
    ['a non-object', 42],
    ['no repo', { pr: 1 }],
    ['an empty repo', { repo: '   ', pr: 1 }],
    ['a repo that is not owner/name', { repo: 'totem', pr: 1 }],
    ['neither pr nor branch', { repo: 'mmnto-ai/totem', pr: null }],
    ['a non-integer pr', { repo: 'mmnto-ai/totem', pr: 1.5 }],
    ['a zero pr', { repo: 'mmnto-ai/totem', pr: 0 }],
    ['a short headSha', { repo: 'mmnto-ai/totem', pr: 1, headSha: 'abc' }],
  ] as Array<[string, unknown]>) {
    it(`throws GATE_INVALID on ${why}`, () => {
      expect(() => parseMergeReadyPayload(payload)).toThrow(TotemError);
      expect(() => parseMergeReadyPayload(payload)).toThrow(/merge-ready payload is invalid/);
    });
  }

  it('an unexpanded shell variable is unevaluable BEFORE any gh call (fold F13)', () => {
    // The runner throws if touched: the arm must return without a read, since
    // there is no PR to query and guessing would judge the wrong one.
    const runner: GhRunner = () => {
      throw new Error('the evaluator must not call gh for an unresolved target');
    };
    const payload = { repo: 'mmnto-ai/totem', pr: null, unresolvedTarget: '$PR' };

    const strict = evaluateMergeReady(payload, { runner, env: {} });
    expect(strict.verdict.disposition).toBe('deny');
    expect(strict.verdict.provenance.ref).toBe('unevaluable');
    expect(strict.verdict.reason).toMatch(/shell variable not expanded/i);
    expect(strict.verdict.reason).toContain('$PR');
    expect(strict.notices.join('\n')).toMatch(/could not derive/);

    const pilot = evaluateMergeReady(payload, { runner, tier: 'pilot', env: {} });
    expect(pilot.verdict.disposition).toBe('warn');
  });

  it('names a payload head sha that is not the PR head, without changing the disposition', () => {
    const e = evaluate('synthetic-merge-state-clean.json', {
      payload: {
        repo: 'mmnto-ai/totem',
        pr: 4242,
        headSha: 'dddddddddddddddddddddddddddddddddddddddd',
      },
    });
    expect(e.verdict.disposition).toBe('allow');
    expect(e.notices.some((n) => n.includes('is not the PR head'))).toBe(true);
  });
});

// ─── The registry evaluator's stderr surface ────────────────────────────────

describe('mergeReadyEvaluator — the registry entry', () => {
  it('routes every notice to the injected stderr sink and returns only the verdict', () => {
    const fixture = loadFixture('synthetic-zero-checks.json');
    const { runner } = runnerFor(fixture);
    const lines: string[] = [];
    const verdict = mergeReadyEvaluator({ repo: 'mmnto-ai/totem', pr: 4242 }, '.totem', {
      ghRunner: runner,
      env: {},
      writeStderr: (line) => lines.push(line),
    });
    expect(verdict.disposition).toBe('allow');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ZERO status checks/);
    expect(lines[0]!.endsWith('\n')).toBe(true);
  });

  it('honours the tier passed through the gate context', () => {
    const fixture = loadFixture('synthetic-merge-state-unknown.json');
    const strict = mergeReadyEvaluator({ repo: 'mmnto-ai/totem', pr: 4242 }, '.totem', {
      ghRunner: runnerFor(fixture).runner,
      env: {},
      writeStderr: () => {},
    });
    expect(strict.disposition).toBe('deny');

    const pilot = mergeReadyEvaluator({ repo: 'mmnto-ai/totem', pr: 4242 }, '.totem', {
      ghRunner: runnerFor(fixture).runner,
      tier: 'pilot',
      env: {},
      writeStderr: () => {},
    });
    expect(pilot.disposition).toBe('warn');
  });
});

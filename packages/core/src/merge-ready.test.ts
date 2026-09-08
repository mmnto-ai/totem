/**
 * merge-ready (mmnto-ai/totem#2800) — the gate's invariants, driven by the
 * checked-in fixtures under `gate-fixtures/merge-ready/`.
 *
 * FOUR of those fixtures are REAL `gh api graphql` captures taken with the
 * exported {@link MERGE_READY_QUERY} (R4): three PR captures —
 * mmnto-ai/liquid-city#363 (green rollup, one unresolved HIGH inline),
 * mmnto-ai/totem-strategy#1251, and mmnto-ai/totem#2827 (the comment that
 * re-pointed to the head) — plus the benign corpus, every bot inline thread on
 * mmnto-ai/totem#2820-2839, which measures the severity read's ADR-109
 * false-positive budget. The other 35 are synthetic and labelled `synthetic-`
 * in their names — one per invariant the captures cannot exercise (all three
 * PRs are merged, so GitHub answers `mergeStateStatus: UNKNOWN` for each and no
 * capture can carry a BEHIND / DIRTY / BLOCKED head, or a resolved HIGH thread).
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
    expect(synthetic.length).toBe(35);
    expect(files.length).toBe(39);
  });
});

// ─── The three real PR captures (R4) ────────────────────────────────────────

describe('merge-ready — the checked-in captures', () => {
  it('mmnto-ai/liquid-city#363 (capture): green rollup, one unresolved HIGH bot inline → deny', () => {
    const e = evaluate('liquid-city-363.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('unresolved-bot-threads');
    expect(e.verdict.provenance.source).toBe(MERGE_READY_SOURCE);
    expect(e.detail.checks).toEqual({ total: 6, success: 6, pending: 0, failing: 0 });
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
    expect(e.detail.checks).toEqual({ total: 2, success: 1, pending: 0, failing: 1 });
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
    expect(e.detail.checks).toEqual({ total: 0, success: 0, pending: 0, failing: 0 });
    const zeroLines = e.notices.filter((n) => n.includes('ZERO status checks'));
    expect(zeroLines).toHaveLength(1);
    expect(zeroLines[0]).toMatch(/branch protection/i);
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
    expect(e.verdict.reason).toMatch(/claims 3 checks but listed none/i);
    expect(e.notices.some((n) => n.includes('ZERO status checks'))).toBe(false);
    expect(
      evaluate('synthetic-rollup-count-without-checks.json', { tier: 'pilot' }).verdict.disposition,
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

  it('a RESOLVED HIGH inline that still applies to the HEAD commit denies at predicate 4', () => {
    // Predicate 4's own territory (ruled, fold F2): a human resolved the thread
    // without changing the code, so predicate 2 passes and the finding still
    // applies to what would merge. Resolution is IGNORED here by design.
    const e = evaluate('synthetic-head-commit-high-inline.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('high-severity-inline');
    expect(e.detail.threads.unresolvedBot).toBe(0); // predicate 2 did NOT fire
    expect(e.detail.highInline).toBe(1);
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

    // A4 — an inline code span carrying a label.
    expect(hasHighSeverityMarker('the arm is `_\u{1F7E0} Major_` in the table')).toBe(false);
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
    expect(audit).toContain('aaaaaaaaaaaa'); // the head sha, shortened
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

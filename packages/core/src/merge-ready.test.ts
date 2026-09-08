/**
 * merge-ready (mmnto-ai/totem#2800) — the gate's invariants, driven by the
 * checked-in fixtures under `gate-fixtures/merge-ready/`.
 *
 * Two of those fixtures are REAL `gh api graphql` captures taken with the
 * exported {@link MERGE_READY_QUERY} (R4): mmnto-ai/liquid-city#363 (green
 * rollup, one unresolved HIGH inline) and mmnto-ai/totem-strategy#1251. The
 * rest are synthetic and labelled `synthetic-` in their names — one per
 * invariant the two captures cannot exercise (both PRs are merged, so GitHub
 * answers `mergeStateStatus: UNKNOWN` for each and no capture can carry a
 * BEHIND / DIRTY / BLOCKED head).
 *
 * The network never runs here: every test injects the {@link GhRunner} seam.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TotemError } from './errors.js';
import type { GateTier, GhRunner } from './gate-types.js';
import {
  evaluateMergeReady,
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

// ─── The two real captures (R4) ─────────────────────────────────────────────

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

  it('a HIGH inline on an OLDER commit does not deny', () => {
    const e = evaluate('synthetic-stale-commit-high-inline.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.detail.highInline).toBe(0);
  });

  it('the same HIGH inline on the HEAD commit denies at predicate 4', () => {
    const e = evaluate('synthetic-head-commit-high-inline.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('high-severity-inline');
    expect(e.detail.highInline).toBe(1);
  });

  it('no bot review present passes predicates 2-4 as a fact, never a failure', () => {
    const e = evaluate('synthetic-merge-state-clean.json');
    expect(e.verdict.disposition).toBe('allow');
    expect(e.verdict.reason).toMatch(/No bot review present/);
  });
});

// ─── Predicate 3: CHANGES_REQUESTED ─────────────────────────────────────────

describe('merge-ready — predicate 3 (changes requested)', () => {
  it('an un-superseded CHANGES_REQUESTED denies and names the reviewer', () => {
    const e = evaluate('synthetic-changes-requested-standing.json');
    expect(e.verdict.disposition).toBe('deny');
    expect(e.verdict.provenance.ref).toBe('changes-requested');
    expect(e.detail.changesRequestedBy).toEqual(['satur8d']);
  });

  it('a later APPROVED from the SAME reviewer supersedes it; a COMMENTED does not', () => {
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

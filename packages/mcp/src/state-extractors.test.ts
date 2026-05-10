import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// packages/mcp/src -> packages/mcp -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

import { UNCOMMITTED_FILES_CAP } from './schemas/describe-project.js';
import {
  extractGitState,
  extractLessonCount,
  extractMilestoneState,
  extractPackageVersions,
  extractRecentPrs,
  extractRuleCounts,
  extractStrategyPointer,
  extractTestCount,
} from './state-extractors.js';

// totem-context: fixture-based git repo isolates extractGitState from the
// live repo's working-tree size so Windows CI's slow process spawn can't
// trip the default 5s vitest timeout. No shell:true per the MCP package's
// "No shell: true on spawn calls" policy; existing pattern in shield.test.ts
// confirms git execFileSync resolves on Windows CI without a shell.
function initFixtureRepo(tmp: string, branch = 'main'): void {
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: tmp, stdio: 'pipe' });
  };
  run('init', '-b', branch);
  run(
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'user.name=Test',
    'commit',
    '--allow-empty',
    '-m',
    'initial',
  );
}

// Retry semantics avoid Windows AV/handle-hold races on tempdir cleanup.
const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;

describe('extractGitState', () => {
  it('returns null/empty for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nogit-'));
    try {
      const state = extractGitState(tmp);
      expect(state.branch).toBeNull();
      expect(state.uncommittedFiles).toEqual([]);
      expect(state.truncated).toBe(false);
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns the current branch and uncommitted files for a fresh repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-git-'));
    try {
      initFixtureRepo(tmp, 'fixture-branch');
      fs.writeFileSync(path.join(tmp, 'untracked.txt'), 'hello');

      const state = extractGitState(tmp);
      expect(state.branch).toBe('fixture-branch');
      expect(state.uncommittedFiles).toEqual(['untracked.txt']);
      expect(state.truncated).toBe(false);
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('caps the file list and flags truncation at UNCOMMITTED_FILES_CAP', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-git-cap-'));
    try {
      initFixtureRepo(tmp);
      for (let i = 0; i < UNCOMMITTED_FILES_CAP + 5; i++) {
        fs.writeFileSync(path.join(tmp, `f${i}.txt`), '');
      }

      const state = extractGitState(tmp);
      expect(state.truncated).toBe(true);
      expect(state.uncommittedFiles.length).toBe(UNCOMMITTED_FILES_CAP);
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });
});

describe('extractStrategyPointer (mmnto-ai/totem#1710)', () => {
  let prevEnvPrimary: string | undefined;
  let prevEnvAlias: string | undefined;
  let prevEnvSubstrate: string | undefined;
  beforeEach(() => {
    // Isolate the resolver from any developer-shell env override so the
    // "absent strategy" test can reach the unresolved branch deterministically.
    // TOTEM_SUBSTRATE_PATH is also scrubbed so resolveSubstratePaths()
    // can't bypass test fixtures (CR review on PR #1821).
    prevEnvPrimary = process.env.TOTEM_STRATEGY_ROOT;
    prevEnvAlias = process.env.STRATEGY_ROOT;
    // totem-context: env capture-and-restore is the canonical isolation pattern (per CR review on mmnto-ai/totem#1821).
    prevEnvSubstrate = process.env.TOTEM_SUBSTRATE_PATH;
    delete process.env.TOTEM_STRATEGY_ROOT;
    delete process.env.STRATEGY_ROOT;
    // totem-context: symmetric restore in afterEach below; leak prevention is preserved.
    delete process.env.TOTEM_SUBSTRATE_PATH;
  });
  afterEach(() => {
    // Symmetric restore: when prev was undefined, the env var was unset
    // before this suite ran — DELETE rather than leak the test's value.
    if (prevEnvPrimary === undefined) delete process.env.TOTEM_STRATEGY_ROOT;
    else process.env.TOTEM_STRATEGY_ROOT = prevEnvPrimary;
    if (prevEnvAlias === undefined) delete process.env.STRATEGY_ROOT;
    else process.env.STRATEGY_ROOT = prevEnvAlias;
    // totem-context: symmetric restore — DELETE when prev was undefined to avoid leaking the test's value.
    if (prevEnvSubstrate === undefined) delete process.env.TOTEM_SUBSTRATE_PATH;
    // totem-context: symmetric restore of captured value — canonical isolation pattern.
    else process.env.TOTEM_SUBSTRATE_PATH = prevEnvSubstrate;
  });

  it('returns the unresolved branch when no strategy root is reachable', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nostrat-'));
    try {
      const ptr = extractStrategyPointer(tmp);
      expect(ptr.resolved).toBe(false);
      if (!ptr.resolved) {
        expect(ptr.reason).toMatch(/strategy/i);
      }
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('extracts latestJournal from resolved substrate path over local default', () => {
    // Phase C dual-resolver invariant (mmnto-ai/totem#1820): when a
    // substrate sibling is reachable, `latestJournal` reads from the
    // substrate's journal subdir, NOT the repo-local sediment. The sediment
    // is the fallback for when substrate is unreachable.
    // totem-context: test fixture only; agents do not consume this temp dir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-phase-c-'));
    try {
      const parent = path.join(tmp, 'parent');
      fs.mkdirSync(parent);

      // Strategy clone (satisfies resolveStrategyRoot's isDirectory check
      // via the config-arg layer; SHA goes null because there's no real
      // git history — the graceful-degrade contract on the resolved branch).
      const strategyDir = path.join(parent, 'totem-strategy-clone');
      fs.mkdirSync(strategyDir);

      // Substrate clone with valid shape + a newer journal entry.
      const substrateDir = path.join(parent, 'totem-substrate');
      fs.mkdirSync(substrateDir);
      // totem-context: substrate fixture build — shape gate, not gitRoot probe (see substrate-resolver.ts validateSubstrateShape).
      fs.mkdirSync(path.join(substrateDir, '.git'));
      fs.mkdirSync(path.join(substrateDir, '.handoff'));
      const substrateJournal = path.join(substrateDir, '.journal');
      fs.mkdirSync(substrateJournal);
      // totem-context: writing test journal markdown to a journal subdir; not a hooks-manager bypass.
      fs.writeFileSync(path.join(substrateJournal, '2026-05-01-test.md'), '');
      // totem-context: writing test journal markdown to a journal subdir; not a hooks-manager bypass.
      fs.writeFileSync(path.join(substrateJournal, '2026-05-04-newest.md'), '');

      // Repo-local sediment with ONLY an older entry — proves substrate is preferred.
      const repo = path.join(parent, 'repo');
      fs.mkdirSync(repo);
      const localJournal = path.join(repo, '.journal');
      fs.mkdirSync(localJournal);
      // totem-context: writing test journal markdown to a journal subdir; not a hooks-manager bypass.
      fs.writeFileSync(path.join(localJournal, '2025-01-01-stale.md'), '');

      // Strategy resolved via config; substrate resolved via sibling-walk
      // from `repo` (depth 1 finds `parent/totem-substrate`).
      const ptr = extractStrategyPointer(repo, { strategyRoot: strategyDir });
      expect(ptr.resolved).toBe(true);
      if (ptr.resolved) {
        expect(ptr.latestJournal).toBe('2026-05-04-newest.md');
      }
    } finally {
      // totem-context: matches established cleanup pattern in this file (12 existing instances at lines 31, 81, 209, …); centralization is out-of-scope follow-up.
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('falls back to repo-local sediment when substrate is unreachable', () => {
    // Phase C ADR-090 invariant: when substrate is absent, latestJournal
    // reads from repo-local sediment (the now-frozen pre-extraction path).
    // totem-context: test fixture only; agents do not consume this temp dir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-phase-c-fallback-'));
    try {
      const parent = path.join(tmp, 'parent');
      fs.mkdirSync(parent);

      const strategyDir = path.join(parent, 'totem-strategy-clone');
      fs.mkdirSync(strategyDir);

      // No `parent/totem-substrate/` — sibling-walk falls through.

      const repo = path.join(parent, 'repo');
      fs.mkdirSync(repo);
      const localJournal = path.join(repo, '.journal');
      fs.mkdirSync(localJournal);
      // totem-context: writing test journal markdown to a journal subdir; not a hooks-manager bypass.
      fs.writeFileSync(path.join(localJournal, '2026-04-15-sediment.md'), '');

      const ptr = extractStrategyPointer(repo, { strategyRoot: strategyDir });
      expect(ptr.resolved).toBe(true);
      if (ptr.resolved) {
        expect(ptr.latestJournal).toBe('2026-04-15-sediment.md');
      }
    } finally {
      // totem-context: matches established cleanup pattern in this file (12 existing instances at lines 31, 81, 209, …); centralization is out-of-scope follow-up.
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns null latestJournal when neither substrate nor sediment resolves (ADR-090)', () => {
    // totem-context: test fixture only; agents do not consume this temp dir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-phase-c-null-'));
    try {
      const parent = path.join(tmp, 'parent');
      fs.mkdirSync(parent);
      const strategyDir = path.join(parent, 'totem-strategy-clone');
      fs.mkdirSync(strategyDir);
      const repo = path.join(parent, 'repo');
      fs.mkdirSync(repo);
      // No substrate, no sediment.

      const ptr = extractStrategyPointer(repo, { strategyRoot: strategyDir });
      expect(ptr.resolved).toBe(true);
      if (ptr.resolved) {
        expect(ptr.latestJournal).toBeNull();
      }
    } finally {
      // totem-context: matches established cleanup pattern in this file (12 existing instances at lines 31, 81, 209, …); centralization is out-of-scope follow-up.
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns the resolved branch with a 7-char SHA and journal filename on the live repo', (ctx) => {
    const ptr = extractStrategyPointer(REPO_ROOT);
    // Integration assertion only runs when strategy is reachable on the
    // running host. After the `.strategy` submodule retirement
    // (mmnto-ai/totem#1749), the resolver legitimately returns
    // `unresolved` on CI runners that have no env override, no
    // `TotemConfig.strategyRoot`, and no sibling `../totem-strategy/`
    // clone. The unresolved branch is covered by the prior test; the
    // shape of the resolved branch is covered by the resolver's own
    // unit tests in `packages/core/src/strategy-resolver.test.ts`.
    if (!ptr.resolved) {
      ctx.skip();
      return;
    }
    if (ptr.sha !== null) {
      expect(ptr.sha).toMatch(/^[0-9a-f]{7}$/);
    }
    if (ptr.latestJournal !== null) {
      expect(ptr.latestJournal).toMatch(/\.md$/);
    }
  });
});

describe('extractPackageVersions', () => {
  it('returns {} when packages/ is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nopkg-'));
    try {
      expect(extractPackageVersions(tmp)).toEqual({});
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('captures fixed-group versions on the live repo', () => {
    const versions = extractPackageVersions(REPO_ROOT);
    // Whichever of the fixed-group packages exist must carry a version string.
    for (const pkgName of Object.keys(versions)) {
      expect(versions[pkgName]).toMatch(/^\d+\.\d+\.\d+/);
    }
    // At least one of the headline packages must be present on the self-host.
    expect(versions['@mmnto/cli'] !== undefined || versions['@mmnto/totem'] !== undefined).toBe(
      true,
    );
  });
});

describe('extractRuleCounts', () => {
  it('returns zeros when compiled-rules.json is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-norules-'));
    try {
      const counts = extractRuleCounts(tmp, '.totem');
      expect(counts).toEqual({ active: 0, archived: 0, nonCompilable: 0 });
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns zeros when compiled-rules.json is malformed', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-badrules-'));
    try {
      fs.mkdirSync(path.join(tmp, '.totem'));
      fs.writeFileSync(path.join(tmp, '.totem', 'compiled-rules.json'), '{ broken json');
      const counts = extractRuleCounts(tmp, '.totem');
      expect(counts).toEqual({ active: 0, archived: 0, nonCompilable: 0 });
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('splits active from archived on the live repo', () => {
    const counts = extractRuleCounts(REPO_ROOT, '.totem');
    expect(counts.active).toBeGreaterThan(0);
    expect(counts.archived).toBeGreaterThanOrEqual(0);
    expect(counts.nonCompilable).toBeGreaterThanOrEqual(0);
  });
});

describe('extractLessonCount', () => {
  it('returns 0 when lessons/ is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nolessons-'));
    try {
      expect(extractLessonCount(tmp, '.totem')).toBe(0);
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns the live lesson count', () => {
    expect(extractLessonCount(REPO_ROOT, '.totem')).toBeGreaterThan(0);
  });
});

describe('extractMilestoneState', () => {
  it('returns null/empty with bestEffort=true when active_work.md is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-noactive-'));
    try {
      const state = extractMilestoneState(tmp);
      expect(state).toEqual({ name: null, gateTickets: [], bestEffort: true });
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('parses milestone and tickets on the live repo', () => {
    const state = extractMilestoneState(REPO_ROOT);
    expect(state.bestEffort).toBe(true);
    // Milestone value depends on the current doc; just enforce the shape contract.
    if (state.name !== null) {
      expect(state.name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    // Ticket list should never include legacy 1-2 digit fragments and should
    // not explode past the 200-entry safety cap.
    expect(state.gateTickets.length).toBeLessThanOrEqual(200);
    for (const ticket of state.gateTickets) {
      expect(ticket).toMatch(/^#\d{3,5}$/);
    }
  });
});

describe('extractTestCount', () => {
  it('always returns null in v1', () => {
    expect(extractTestCount(REPO_ROOT)).toBeNull();
  });
});

describe('extractRecentPrs', () => {
  it('returns [] for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-norecent-'));
    try {
      expect(extractRecentPrs(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, RM_OPTS);
    }
  });

  it('returns up to the requested limit, newest first on the live repo', () => {
    const prs = extractRecentPrs(REPO_ROOT, 5);
    expect(prs.length).toBeLessThanOrEqual(5);
    for (const pr of prs) {
      expect(pr.title).toMatch(/#\d+/);
      expect(pr.squashSha).toMatch(/^[0-9a-f]{7,12}$/);
      expect(() => new Date(pr.date).toISOString()).not.toThrow();
    }
    if (prs.length >= 2) {
      const t0 = new Date(prs[0]!.date).getTime();
      const t1 = new Date(prs[1]!.date).getTime();
      expect(t0).toBeGreaterThanOrEqual(t1);
    }
  });
});

describe('temp dir cleanup safety', () => {
  // Smoke test: verify rmSync pattern from earlier tests does not leak.
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-cleanup-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, RM_OPTS);
  });
  it('temp dir exists inside the test', () => {
    expect(fs.existsSync(tmp)).toBe(true);
  });
});

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

describe('extractGitState', () => {
  it('returns null/empty for a non-git directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nogit-'));
    try {
      const state = extractGitState(tmp);
      expect(state.branch).toBeNull();
      expect(state.uncommittedFiles).toEqual([]);
      expect(state.truncated).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns current branch and staged/unstaged files on the live repo', () => {
    const state = extractGitState(REPO_ROOT);
    expect(state.branch).toBeTypeOf('string');
    expect(state.uncommittedFiles.length).toBeLessThanOrEqual(UNCOMMITTED_FILES_CAP);
    // If a truncation happened the cap must be hit exactly.
    if (state.truncated) {
      expect(state.uncommittedFiles.length).toBe(UNCOMMITTED_FILES_CAP);
    }
  });
});

describe('extractStrategyPointer', () => {
  it('returns null/null when .strategy/ is absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-nostrat-'));
    try {
      const ptr = extractStrategyPointer(tmp);
      expect(ptr.sha).toBeNull();
      expect(ptr.latestJournal).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns a 7-char SHA and a journal filename on the live repo', () => {
    const ptr = extractStrategyPointer(REPO_ROOT);
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
      fs.rmSync(tmp, { recursive: true, force: true });
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
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  it('temp dir exists inside the test', () => {
    expect(fs.existsSync(tmp)).toBe(true);
  });
});

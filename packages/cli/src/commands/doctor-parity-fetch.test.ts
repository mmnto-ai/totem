/**
 * Tests for the §14 network-read-only fetch edge (`doctor-parity-fetch.ts`,
 * strategy#962).
 *
 * Every test injects the transport ({@link GhFetch}) AND the local-remote reader
 * ({@link ReadRemote}) seams, so NO `gh`/`git` subprocess ever spawns and there
 * is zero live network. The suite covers: slug derivation, the roster (current +
 * opt-in cross-repo, dedup), per-repo surface selection under consumers scoping,
 * the rulesets list→detail assembly, branch-protection default-branch resolution,
 * and the no-remote / no-transport degradations.
 */

import { describe, expect, it } from 'vitest';

import {
  type GhFetch,
  type GhFetchResult,
  networkPostureRowFor,
  resolveNetworkSnapshots,
  slugFromRemoteUrl,
} from './doctor-parity-fetch.js';

/** Build a canned transport keyed by exact API path, recording each call. */
function cannedFetch(routes: Record<string, GhFetchResult>): {
  ghFetch: GhFetch;
  calls: string[];
} {
  const calls: string[] = [];
  const ghFetch: GhFetch = (apiPath) => {
    calls.push(apiPath);
    return routes[apiPath] ?? { outcome: 'not-found', detail: 'unrouted' };
  };
  return { ghFetch, calls };
}

const remoteOrigin = () => 'git@github.com:mmnto-ai/totem.git';

describe('slugFromRemoteUrl', () => {
  it('parses ssh, https, .git-suffixed and trailing-slash forms', () => {
    expect(slugFromRemoteUrl('git@github.com:mmnto-ai/totem.git')).toBe('mmnto-ai/totem');
    expect(slugFromRemoteUrl('https://github.com/mmnto-ai/totem.git')).toBe('mmnto-ai/totem');
    expect(slugFromRemoteUrl('https://github.com/mmnto-ai/totem')).toBe('mmnto-ai/totem');
    expect(slugFromRemoteUrl('https://github.com/mmnto-ai/totem/')).toBe('mmnto-ai/totem');
  });

  it('returns undefined on an unparseable / empty remote', () => {
    expect(slugFromRemoteUrl(undefined)).toBeUndefined();
    expect(slugFromRemoteUrl('')).toBeUndefined();
    expect(slugFromRemoteUrl('not-a-remote')).toBeUndefined();
  });
});

describe('networkPostureRowFor', () => {
  it('maps the three posture ids to their row kinds, others to undefined', () => {
    expect(networkPostureRowFor('repo-merge-posture')).toBe('repo-merge-posture');
    expect(networkPostureRowFor('repo-required-checks-posture')).toBe(
      'repo-required-checks-posture',
    );
    expect(networkPostureRowFor('repo-branch-protection-posture')).toBe(
      'repo-branch-protection-posture',
    );
    expect(networkPostureRowFor('knowledge-search-access')).toBeUndefined();
    expect(networkPostureRowFor('unknown-row')).toBeUndefined();
  });
});

describe('resolveNetworkSnapshots', () => {
  it('probes the current repo for row-1 with only the repoSettings surface', async () => {
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: { allow_squash_merge: true } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-merge-posture' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.repoSlug).toBe('mmnto-ai/totem');
    expect(snaps[0]?.repoId).toBe('totem');
    expect(snaps[0]?.surfaces.repoSettings?.outcome).toBe('ok');
    expect(snaps[0]?.surfaces.rulesets).toBeUndefined();
    expect(snaps[0]?.surfaces.branchProtection).toBeUndefined();
    expect(calls).toEqual(['/repos/mmnto-ai/totem']);
  });

  it('assembles the rulesets surface from a list + per-id detail fetch', async () => {
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: [{ id: 11 }, { id: 12 }],
      },
      '/repos/mmnto-ai/totem/rulesets/11': { outcome: 'ok', data: { id: 11, name: 'a' } },
      '/repos/mmnto-ai/totem/rulesets/12': { outcome: 'ok', data: { id: 12, name: 'b' } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-required-checks-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.rulesets?.outcome).toBe('ok');
    expect(snaps[0]?.surfaces.rulesets?.data).toEqual([
      { id: 11, name: 'a' },
      { id: 12, name: 'b' },
    ]);
    expect(calls).toContain('/repos/mmnto-ai/totem/rulesets/11');
    expect(calls).toContain('/repos/mmnto-ai/totem/rulesets/12');
  });

  it('degrades a NON-ARRAY rulesets list 200 to error (never an empty union)', async () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: { message: 'not a list' },
      },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-required-checks-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.rulesets?.outcome).toBe('error');
    expect(snaps[0]?.surfaces.rulesets?.detail).toContain('unparseable');
  });

  it('degrades an id-less list entry to error (a partial read cannot certify the union)', async () => {
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: [{ name: 'no-id-entry' }, { id: 11 }],
      },
      '/repos/mmnto-ai/totem/rulesets/11': { outcome: 'ok', data: { id: 11 } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-required-checks-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.rulesets?.outcome).toBe('error');
    expect(snaps[0]?.surfaces.rulesets?.detail).toContain('usable id');
    expect(calls).not.toContain('/repos/mmnto-ai/totem/rulesets/11');
  });

  it('degrades a list at the pagination boundary (100) to error, never a silent undercount', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: hundred,
      },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-required-checks-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.rulesets?.outcome).toBe('error');
    expect(snaps[0]?.surfaces.rulesets?.detail).toContain('pagination boundary');
  });

  it('resolves the default branch from repo settings for classic branch protection (row-3)', async () => {
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: { default_branch: 'main' } },
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: [],
      },
      '/repos/mmnto-ai/totem/branches/main/protection': {
        outcome: 'ok',
        data: { enforce_admins: { enabled: true } },
      },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-branch-protection-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.branchProtection?.outcome).toBe('ok');
    expect(calls).toContain('/repos/mmnto-ai/totem/branches/main/protection');
  });

  it('marks branch protection auth-class when repo 200 omits default_branch', async () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: {} },
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: [],
      },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-branch-protection-posture', consumers: ['totem'] }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.branchProtection?.outcome).toBe('auth');
  });

  it('honors consumers scoping per-repo: a cross-repo gets only the unscoped row-1 surface', async () => {
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: { default_branch: 'main' } },
      '/repos/mmnto-ai/totem/rulesets?includes_parents=true&per_page=100': {
        outcome: 'ok',
        data: [],
      },
      '/repos/mmnto-ai/totem/branches/main/protection': { outcome: 'ok', data: {} },
      '/repos/other-org/widget': { outcome: 'ok', data: { allow_squash_merge: true } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [
        { row: 'repo-merge-posture' }, // unscoped → all repos
        { row: 'repo-required-checks-posture', consumers: ['totem'] },
        { row: 'repo-branch-protection-posture', consumers: ['totem'] },
      ],
      repoId: 'totem',
      gitRoot: '/repo',
      probeRepos: ['other-org/widget'],
      ghFetch,
      readRemote: remoteOrigin,
    });
    const totem = snaps.find((s) => s.repoId === 'totem');
    const widget = snaps.find((s) => s.repoId === 'widget');
    // totem is in scope for all three rows → all three surfaces fetched.
    expect(totem?.surfaces.repoSettings?.outcome).toBe('ok');
    expect(totem?.surfaces.rulesets?.outcome).toBe('ok');
    expect(totem?.surfaces.branchProtection?.outcome).toBe('ok');
    // widget is only in the unscoped row-1 → repoSettings only, no sibling ruleset/protection reads.
    expect(widget?.surfaces.repoSettings?.outcome).toBe('ok');
    expect(widget?.surfaces.rulesets).toBeUndefined();
    expect(widget?.surfaces.branchProtection).toBeUndefined();
    expect(calls).not.toContain('/repos/other-org/widget/rulesets?includes_parents=true');
  });

  it('dedupes a cross-repo entry that equals the current slug', async () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: { allow_squash_merge: true } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-merge-posture' }],
      repoId: 'totem',
      gitRoot: '/repo',
      probeRepos: ['mmnto-ai/totem'],
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps).toHaveLength(1);
  });

  it('returns an empty roster when the current repo has no remote and no probeRepos', async () => {
    const { ghFetch, calls } = cannedFetch({});
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-merge-posture' }],
      gitRoot: '/repo',
      ghFetch,
      readRemote: () => undefined,
    });
    expect(snaps).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('propagates a no-transport outcome to the surface (offline degradation, no retries)', async () => {
    const noTransport: GhFetch = () => ({ outcome: 'no-transport', detail: 'gh not found' });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-merge-posture' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch: noTransport,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.repoSettings?.outcome).toBe('no-transport');
  });

  it('uses the cross-repo slug segment as the cohort id', async () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: {} },
      '/repos/some-org/totem-status': { outcome: 'ok', data: {} },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'repo-merge-posture' }],
      repoId: 'totem',
      gitRoot: '/repo',
      probeRepos: ['some-org/totem-status'],
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps.map((s) => s.repoId).sort()).toEqual(['totem', 'totem-status']);
  });
});

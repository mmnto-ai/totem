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
 *
 * The two 472-charter orientation rows (mmnto-ai/totem#2791) are covered on the
 * same terms: the label pagination walk, the project BINDING (bound / unbound /
 * sibling) and its GraphQL read behind an injected {@link GhGraphql}, the
 * roster-wide canon resolution (local read vs the canonical contents fetch), and
 * the GraphQL body classifier. No test spawns `gh` for these either.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyGraphqlBody,
  type GhFetch,
  type GhFetchResult,
  type GhGraphql,
  networkPostureRowFor,
  resolveLabelCanon,
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

/** Build a canned GraphQL transport returning one result, recording each call. */
function cannedGraphql(result: GhFetchResult): {
  ghGraphql: GhGraphql;
  calls: { query: string; variables: Record<string, string | number> }[];
} {
  const calls: { query: string; variables: Record<string, string | number> }[] = [];
  const ghGraphql: GhGraphql = (query, variables) => {
    calls.push({ query, variables });
    return result;
  };
  return { ghGraphql, calls };
}

/** The labels page path for one page number (mirrors the walk's exact query string). */
function labelsPath(page: number): string {
  return `/repos/mmnto-ai/totem/labels?per_page=100&page=${page}`;
}

/** `count` distinct canned label objects. */
function labelPage(count: number, prefix: string): { name: string }[] {
  return Array.from({ length: count }, (_, i) => ({ name: `${prefix}-${i}` }));
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

// === The two 472-charter orientation rows (mmnto-ai/totem#2791) ===

describe('networkPostureRowFor — orientation rows', () => {
  it('maps the label-canon and project-vocabulary ids to their row kinds', () => {
    expect(networkPostureRowFor('gh-issue-label-canon')).toBe('gh-issue-label-canon');
    expect(networkPostureRowFor('gh-project-vocabulary')).toBe('gh-project-vocabulary');
  });
});

describe('resolveNetworkSnapshots — the labels surface', () => {
  it('concatenates every page and stops on the first short page', async () => {
    const { ghFetch, calls } = cannedFetch({
      [labelsPath(1)]: { outcome: 'ok', data: labelPage(100, 'p1') },
      [labelsPath(2)]: { outcome: 'ok', data: labelPage(12, 'p2') },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-issue-label-canon' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    const labels = snaps[0]?.surfaces.labels;
    expect(labels?.outcome).toBe('ok');
    expect(Array.isArray(labels?.data)).toBe(true);
    expect(labels?.data as unknown[]).toHaveLength(112);
    // Both pages were read, in order, and the walk stopped at the short page.
    expect(calls).toEqual([labelsPath(1), labelsPath(2)]);
  });

  it('degrades the WHOLE surface at the page cap — never a partial list', async () => {
    const routes: Record<string, GhFetchResult> = {};
    for (let page = 1; page <= 11; page += 1) {
      routes[labelsPath(page)] = { outcome: 'ok', data: labelPage(100, `p${page}`) };
    }
    const { ghFetch, calls } = cannedFetch(routes);
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-issue-label-canon' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.labels?.outcome).toBe('error');
    expect(snaps[0]?.surfaces.labels?.detail).toContain('cannot certify');
    // The cap bounds the walk: the 11th page is never requested.
    expect(calls).toHaveLength(10);
    expect(calls).not.toContain(labelsPath(11));
  });

  it('propagates a non-ok page outcome (auth is never a drift verdict)', async () => {
    const { ghFetch } = cannedFetch({
      [labelsPath(1)]: { outcome: 'ok', data: labelPage(100, 'p1') },
      [labelsPath(2)]: { outcome: 'auth', detail: 'HTTP 403 — under-privileged token' },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-issue-label-canon' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.labels?.outcome).toBe('auth');
    expect(snaps[0]?.surfaces.labels?.data).toBeUndefined();
  });

  it('degrades a NON-ARRAY labels page to error', async () => {
    const { ghFetch } = cannedFetch({
      [labelsPath(1)]: { outcome: 'ok', data: { message: 'not a list' } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-issue-label-canon' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.surfaces.labels?.outcome).toBe('error');
    expect(snaps[0]?.surfaces.labels?.detail).toContain('unparseable labels page');
  });
});

describe('resolveNetworkSnapshots — the project binding', () => {
  const projectBody = {
    data: {
      organization: {
        projectV2: {
          title: 'Convergent Spine',
          fields: { pageInfo: { hasNextPage: false }, nodes: [{ name: 'Status', options: [] }] },
        },
      },
    },
  };

  it('binds the CURRENT repo to orient.projectNumber and reads its fields once', async () => {
    const { ghFetch } = cannedFetch({});
    const { ghGraphql, calls } = cannedGraphql({ outcome: 'ok', data: projectBody });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-project-vocabulary' }],
      repoId: 'totem',
      gitRoot: '/repo',
      projectNumber: 1,
      ghFetch,
      ghGraphql,
      readRemote: remoteOrigin,
    });
    expect(snaps[0]?.project).toEqual({ kind: 'bound', owner: 'mmnto-ai', number: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toEqual({ org: 'mmnto-ai', number: 1 });
    expect(calls[0]?.query).toContain('ProjectV2SingleSelectField');
    expect(snaps[0]?.surfaces.projectFields?.outcome).toBe('ok');
    expect(snaps[0]?.surfaces.projectFields?.data).toEqual(projectBody);
  });

  it('renders an UNBOUND current repo without reading anything', async () => {
    const { ghFetch, calls } = cannedFetch({});
    const { ghGraphql, calls: gqlCalls } = cannedGraphql({ outcome: 'ok', data: projectBody });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-project-vocabulary' }],
      repoId: 'totem',
      gitRoot: '/repo',
      ghFetch,
      ghGraphql,
      readRemote: remoteOrigin,
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.project).toEqual({ kind: 'unbound' });
    expect(snaps[0]?.surfaces.projectFields).toBeUndefined();
    expect(gqlCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('marks a cross-repo probe a SIBLING and never reads a project for it', async () => {
    const { ghGraphql, calls } = cannedGraphql({ outcome: 'ok', data: projectBody });
    const snaps = await resolveNetworkSnapshots({
      rows: [{ row: 'gh-project-vocabulary' }],
      repoId: 'totem',
      gitRoot: '/repo',
      probeRepos: ['other-org/widget'],
      projectNumber: 1,
      ghFetch: cannedFetch({}).ghFetch,
      ghGraphql,
      readRemote: remoteOrigin,
    });
    const widget = snaps.find((s) => s.repoId === 'widget');
    expect(widget?.project).toEqual({ kind: 'sibling' });
    expect(widget?.surfaces.projectFields).toBeUndefined();
    // Only the current repo's bound project is read.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.variables).toEqual({ org: 'mmnto-ai', number: 1 });
  });

  it('omits `project` entirely when the vocabulary row is not in scope for the repo', async () => {
    const { ghGraphql, calls } = cannedGraphql({ outcome: 'ok', data: projectBody });
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem': { outcome: 'ok', data: { allow_squash_merge: true } },
    });
    const snaps = await resolveNetworkSnapshots({
      rows: [
        { row: 'repo-merge-posture' },
        { row: 'gh-project-vocabulary', consumers: ['some-other-repo'] },
      ],
      repoId: 'totem',
      gitRoot: '/repo',
      projectNumber: 1,
      ghFetch,
      ghGraphql,
      readRemote: remoteOrigin,
    });
    expect(snaps).toHaveLength(1);
    expect(snaps[0]?.project).toBeUndefined();
    expect(Object.hasOwn(snaps[0] ?? {}, 'project')).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('resolveLabelCanon', () => {
  const script = 'gh label edit "tier-1" --color "0e8a16" --description "First tier"\r\n';

  it('reads the canon from the local checkout in the totem repo', () => {
    const reads: string[] = [];
    const canon = resolveLabelCanon({
      gitRoot: '/repo',
      repoId: 'totem',
      readFile: (absPath) => {
        reads.push(absPath);
        return script;
      },
    });
    expect(canon.outcome).toBe('ok');
    expect(canon.data).toBe(script);
    expect(canon.detail).toBe('local checkout scripts/sync-labels.ps1');
    expect(reads[0]).toContain('sync-labels.ps1');
  });

  it('degrades to error when the local canon is unreadable', () => {
    const canon = resolveLabelCanon({
      gitRoot: '/repo',
      repoId: 'totem',
      readFile: () => {
        throw new Error('ENOENT');
      },
    });
    expect(canon.outcome).toBe('error');
    expect(canon.detail).toContain('unreadable');
    expect(canon.data).toBeUndefined();
  });

  it('decodes the canonical contents payload and discloses the blob sha', () => {
    // GitHub wraps the base64 payload in newlines and the script itself is CRLF
    // — both must survive the decode.
    const wrapped = (
      Buffer.from(script, 'utf8')
        .toString('base64')
        .match(/.{1,4}/g) ?? []
    ).join('\n');
    const { ghFetch, calls } = cannedFetch({
      '/repos/mmnto-ai/totem/contents/scripts/sync-labels.ps1': {
        outcome: 'ok',
        data: { content: `${wrapped}\n`, encoding: 'base64', sha: 'abcdef1234567890' },
      },
    });
    const canon = resolveLabelCanon({ gitRoot: '/repo', repoId: 'liquid-city', ghFetch });
    expect(canon.outcome).toBe('ok');
    expect(canon.data).toBe(script);
    expect(canon.detail).toBe('mmnto-ai/totem:scripts/sync-labels.ps1@abcdef1');
    expect(calls).toEqual(['/repos/mmnto-ai/totem/contents/scripts/sync-labels.ps1']);
  });

  it('propagates a non-ok canonical fetch with a provenance-prefixed detail', () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem/contents/scripts/sync-labels.ps1': {
        outcome: 'auth',
        detail: 'HTTP 403 — under-privileged token',
      },
    });
    const canon = resolveLabelCanon({ gitRoot: '/repo', repoId: 'liquid-city', ghFetch });
    expect(canon.outcome).toBe('auth');
    expect(canon.detail).toBe(
      'canonical fetch mmnto-ai/totem:scripts/sync-labels.ps1: HTTP 403 — under-privileged token',
    );
    expect(canon.data).toBeUndefined();
  });

  it('degrades an unshaped contents 200 to error (never a decoded garbage canon)', () => {
    const { ghFetch } = cannedFetch({
      '/repos/mmnto-ai/totem/contents/scripts/sync-labels.ps1': {
        outcome: 'ok',
        data: { content: 'aGk=', encoding: 'none' },
      },
    });
    const canon = resolveLabelCanon({ gitRoot: '/repo', repoId: 'liquid-city', ghFetch });
    expect(canon.outcome).toBe('error');
    expect(canon.detail).toBe('unparseable contents response');
  });

  it('reports no-transport when a non-totem repo has no transport to fetch with', () => {
    const canon = resolveLabelCanon({ gitRoot: '/repo', repoId: 'liquid-city' });
    expect(canon.outcome).toBe('no-transport');
    expect(canon.detail).toContain('no transport');
  });
});

describe('classifyGraphqlBody', () => {
  it('classifies a permission / scope error as auth', () => {
    const result = classifyGraphqlBody({
      data: { organization: null },
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
    });
    expect(result.outcome).toBe('auth');
    expect(result.detail).toContain('not accessible');
  });

  it('classifies a NOT_FOUND error as not-found', () => {
    const result = classifyGraphqlBody({
      data: { organization: { projectV2: null } },
      errors: [
        { type: 'NOT_FOUND', message: 'Could not resolve to a ProjectV2 with the number 9' },
      ],
    });
    expect(result.outcome).toBe('not-found');
  });

  it('classifies any other error as error, carrying the first message', () => {
    const result = classifyGraphqlBody({
      errors: [{ message: 'Something went wrong while executing your query' }],
    });
    expect(result.outcome).toBe('error');
    expect(result.detail).toBe('Something went wrong while executing your query');
  });

  it('treats a body WITHOUT errors as ok, carrying the body verbatim', () => {
    const body = { data: { organization: { projectV2: { title: 'Convergent Spine' } } } };
    const result = classifyGraphqlBody(body);
    expect(result.outcome).toBe('ok');
    expect(result.data).toEqual(body);
  });

  it('never classifies an errors-bearing body as ok, even when it also resolved the project (partial data)', () => {
    // GraphQL returns partial data beside its errors. A half-read field list
    // verdicted as complete would be a drift verdict on a cannot-verify read
    // (falsification pass 1, F1) — so the presence of ANY error is decisive.
    const partial = {
      data: {
        organization: {
          projectV2: {
            title: 'Convergent Spine',
            fields: {
              pageInfo: { hasNextPage: false },
              nodes: [{ name: 'Status', options: [] }, null],
            },
          },
        },
      },
      errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
    };
    expect(classifyGraphqlBody(partial).outcome).toBe('auth');

    const transient = { ...partial, errors: [{ type: 'SERVICE_UNAVAILABLE', message: 'timeout' }] };
    expect(classifyGraphqlBody(transient).outcome).toBe('error');
  });
});

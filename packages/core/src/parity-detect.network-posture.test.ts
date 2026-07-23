/**
 * Tests for the Prop 296 §14 network-read-only posture detector family
 * (`detectNetworkPostureContract`, strategy#962).
 *
 * The detector is pure + synchronous + NEVER-networks: every test injects
 * PRE-FETCHED canned snapshots (the CLI-edge fetch is not exercised here) and,
 * for row-2, a canned declaration via the `readFile` seam. Zero live network,
 * zero gh/git spawns.
 *
 * Coverage (per the build brief): each row's pass; both-direction drift (missing
 * context / stale extra); the contributing-ruleset-bypass case (union passes but
 * a contributing ruleset is evaluate-mode / has bypass_actors → warn); a
 * 200-without-fields → unknown; no-transport → skip; declaration-file-absent →
 * skip; multi-repo mixed outcomes render per-repo; consumers-scoping;
 * nonzero approving-count → warn; a zero-rule / copilot-class ruleset never
 * satisfies presence.
 */

import { describe, expect, it } from 'vitest';

import {
  type DetectNetworkPostureContext,
  detectNetworkPostureContract,
  type NetworkProbeRepoSnapshot,
  type NetworkSurfaceSnapshot,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';

// ─── Fixtures ───────────────────────────────────────────

function mkContract(id: string, consumers?: string[]): ParityContract {
  return {
    id,
    dimension: 'enforcement',
    canonicalSource: null,
    detectionMethod: 'network-read-only probe',
    expectedValueOrDerivation: 'posture holds',
    tractability: 'mechanical',
    trackingIssue: 'mmnto-ai/totem-strategy#482',
    manifestation: 'capability-probe',
    probeClass: 'network-read-only',
    ...(consumers !== undefined ? { consumers } : {}),
  };
}

const okRepoSettings: NetworkSurfaceSnapshot = {
  outcome: 'ok',
  data: {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    squash_merge_commit_message: 'BLANK',
    squash_merge_commit_title: 'PR_TITLE',
    delete_branch_on_merge: true,
  },
};

/** A conformant required-status-checks ruleset carrying the given contexts. */
function statusCheckRuleset(
  name: string,
  contexts: string[],
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id: name.length,
    name,
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
    rules: [
      {
        type: 'required_status_checks',
        parameters: {
          required_status_checks: contexts.map((c) => ({ context: c })),
          strict_required_status_checks_policy: false,
        },
      },
    ],
    ...overrides,
  };
}

const CANONICAL_CONTEXTS = ['Totem Lint', 'Build & Lint (ubuntu-latest)'];

const declarationJson = JSON.stringify({
  'schema-version': 1,
  'ruleset-name': 'main-required-checks',
  enforcement: 'active',
  bypass_actors: [],
  required_status_checks: {
    strict_required_status_checks_policy: false,
    contexts: CANONICAL_CONTEXTS,
  },
});

const okBranchProtection: NetworkSurfaceSnapshot = {
  outcome: 'ok',
  data: {
    required_pull_request_reviews: { required_approving_review_count: 0 },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  },
};

function snapshot(
  repoSlug: string,
  repoId: string,
  surfaces: NetworkProbeRepoSnapshot['surfaces'],
): NetworkProbeRepoSnapshot {
  return { repoSlug, repoId, surfaces };
}

/** row-2 ctx with a canned declaration read (default = the conformant canonical). */
function checksCtx(
  repos: NetworkProbeRepoSnapshot[],
  declaration: string | undefined = declarationJson,
): DetectNetworkPostureContext {
  return {
    row: 'repo-required-checks-posture',
    repos,
    declarationPath: '/repo/.totem/rulesets/main.json',
    readFile: () => declaration,
  };
}

// ─── Row 1: repo-merge-posture ──────────────────────────

describe('repo-merge-posture', () => {
  const contract = mkContract('repo-merge-posture');

  it('passes on squash-only + BLANK body + PR_TITLE title', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [snapshot('mmnto-ai/totem', 'totem', { repoSettings: okRepoSettings })],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[0]?.lineName).toContain('mmnto-ai/totem');
  });

  it('warns on merge-commit + non-BLANK body drift', () => {
    const drifted: NetworkSurfaceSnapshot = {
      outcome: 'ok',
      data: {
        allow_squash_merge: true,
        allow_merge_commit: true,
        allow_rebase_merge: false,
        squash_merge_commit_message: 'COMMIT_MESSAGES',
        squash_merge_commit_title: 'PR_TITLE',
      },
    };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [snapshot('mmnto-ai/totem', 'totem', { repoSettings: drifted })],
    });
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('allow_merge_commit');
    expect(lines[0]?.verdict.message).toContain('squash_merge_commit_message');
  });

  it('is unknown (auth-class) on a 200 without the posture fields', () => {
    const shy: NetworkSurfaceSnapshot = { outcome: 'ok', data: { full_name: 'mmnto-ai/totem' } };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [snapshot('mmnto-ai/totem', 'totem', { repoSettings: shy })],
    });
    expect(lines[0]?.verdict.status).toBe('unknown');
    expect(lines[0]?.verdict.message).toContain('auth-class');
  });

  it('skips on no-transport (offline)', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [snapshot('mmnto-ai/totem', 'totem', { repoSettings: { outcome: 'no-transport' } })],
    });
    expect(lines[0]?.verdict.status).toBe('skip');
    expect(lines[0]?.verdict.message).toContain('§14 clause 4');
  });

  it('is unknown on an auth-class outcome (never a drift verdict)', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          repoSettings: { outcome: 'auth', detail: 'HTTP 401' },
        }),
      ],
    });
    expect(lines[0]?.verdict.status).toBe('unknown');
    expect(lines[0]?.verdict.message).not.toContain('drift');
  });

  it('renders per-repo lines with mixed outcomes across a multi-repo roster', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-merge-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', { repoSettings: okRepoSettings }),
        snapshot('mmnto-ai/totem-strategy', 'totem-strategy', {
          repoSettings: { outcome: 'auth', detail: 'HTTP 403' },
        }),
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[1]?.verdict.status).toBe('unknown');
    expect(lines[1]?.lineName).toContain('mmnto-ai/totem-strategy');
  });
});

// ─── Row 2: repo-required-checks-posture ────────────────

describe('repo-required-checks-posture', () => {
  const contract = mkContract('repo-required-checks-posture', ['totem']);

  function rulesetsOk(details: unknown[]): NetworkProbeRepoSnapshot['surfaces'] {
    return { rulesets: { outcome: 'ok', data: details } };
  }

  it('passes when the active-ruleset union set-equals the canonical list', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([statusCheckRuleset('main-required-checks', CANONICAL_CONTEXTS)]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.verdict.status).toBe('pass');
  });

  it('unions checks across TWO rulesets (a second ruleset must not be invisible)', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([
          statusCheckRuleset('rs-1', ['Totem Lint']),
          statusCheckRuleset('rs-2', ['Build & Lint (ubuntu-latest)']),
        ]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('pass');
  });

  it('warns on a MISSING canonical check (re-opens the gated vector)', () => {
    const repos = [
      snapshot('mmnto-ai/totem', 'totem', rulesetsOk([statusCheckRuleset('rs', ['Totem Lint'])])),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('missing required check');
    expect(lines[0]?.verdict.message).toContain('Build & Lint (ubuntu-latest)');
  });

  it('warns on a STALE EXTRA required check (silent merge-block)', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([statusCheckRuleset('rs', [...CANONICAL_CONTEXTS, 'Retired Check'])]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('stale extra');
    expect(lines[0]?.verdict.message).toContain('Retired Check');
  });

  it('warns when a contributing ruleset is EVALUATE-mode (union passes but is bypassable)', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([
          statusCheckRuleset('rs-active', ['Totem Lint']),
          statusCheckRuleset('rs-evaluate', ['Build & Lint (ubuntu-latest)'], {
            enforcement: 'evaluate',
          }),
        ]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('rs-evaluate');
    expect(lines[0]?.verdict.message).toContain('enforcement=evaluate');
  });

  it('warns when a contributing ruleset has BYPASS_ACTORS (union passes but bypassable)', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([
          statusCheckRuleset('rs-bypass', CANONICAL_CONTEXTS, {
            bypass_actors: [{ actor_id: 5, actor_type: 'Team' }],
          }),
        ]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('bypassable');
  });

  it('warns on a strict-policy mismatch on a contributing ruleset', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([
          statusCheckRuleset('rs', CANONICAL_CONTEXTS, {
            rules: [
              {
                type: 'required_status_checks',
                parameters: {
                  required_status_checks: CANONICAL_CONTEXTS.map((c) => ({ context: c })),
                  strict_required_status_checks_policy: true,
                },
              },
            ],
          }),
        ]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('strict_required_status_checks_policy');
  });

  it('a zero-rule / copilot-class ruleset never satisfies presence', () => {
    const copilotClass = {
      id: 9,
      name: 'copilot-review',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      bypass_actors: [],
      rules: [{ type: 'code_scanning', parameters: {} }],
    };
    const repos = [snapshot('mmnto-ai/totem', 'totem', rulesetsOk([copilotClass]))];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('missing required check');
  });

  it('skips when the canonical declaration file is absent', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([statusCheckRuleset('rs', CANONICAL_CONTEXTS)]),
      ),
    ];
    // readFile returns undefined = the declaration file is not on disk yet.
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-required-checks-posture',
      repos,
      declarationPath: '/repo/.totem/rulesets/main.json',
      readFile: () => undefined,
    });
    expect(lines[0]?.verdict.status).toBe('skip');
    expect(lines[0]?.verdict.message).toContain('not yet committed');
  });

  it('is unknown when the declaration is unparseable (canonical underivable)', () => {
    const repos = [
      snapshot(
        'mmnto-ai/totem',
        'totem',
        rulesetsOk([statusCheckRuleset('rs', CANONICAL_CONTEXTS)]),
      ),
    ];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos, '{ not json'));
    expect(lines[0]?.verdict.status).toBe('unknown');
  });

  it('skips (cohort permits absence) when no roster repo is in the consumers scope', () => {
    const repos = [snapshot('mmnto-ai/totem-status', 'totem-status', rulesetsOk([]))];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.verdict.status).toBe('skip');
    expect(lines[0]?.verdict.message).toContain('totem');
  });

  it('skips the rulesets surface on no-transport even with a present declaration', () => {
    const repos = [snapshot('mmnto-ai/totem', 'totem', { rulesets: { outcome: 'no-transport' } })];
    const lines = detectNetworkPostureContract(contract, checksCtx(repos));
    expect(lines[0]?.verdict.status).toBe('skip');
  });
});

// ─── Row 3: repo-branch-protection-posture ──────────────

describe('repo-branch-protection-posture', () => {
  const contract = mkContract('repo-branch-protection-posture', ['totem']);

  it('emits TWO lines per repo (classic + rulesets) and passes both when conformant', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: okBranchProtection,
          rulesets: { outcome: 'ok', data: [] },
        }),
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.lineName).toContain('classic');
    expect(lines[1]?.lineName).toContain('rulesets');
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[1]?.verdict.status).toBe('pass');
  });

  it('warns on a NONZERO approving-review-count (drift from ruled 0)', () => {
    const drifted: NetworkSurfaceSnapshot = {
      outcome: 'ok',
      data: {
        required_pull_request_reviews: { required_approving_review_count: 1 },
        enforce_admins: { enabled: true },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
      },
    };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: drifted,
          rulesets: { outcome: 'ok', data: [] },
        }),
      ],
    });
    const classic = lines.find((l) => l.lineName.includes('classic'));
    expect(classic?.verdict.status).toBe('warn');
    expect(classic?.verdict.message).toContain('required_approving_review_count=1');
  });

  it('warns when the direct-push vector opens (force pushes / deletions allowed)', () => {
    const drifted: NetworkSurfaceSnapshot = {
      outcome: 'ok',
      data: {
        required_pull_request_reviews: { required_approving_review_count: 0 },
        enforce_admins: { enabled: false },
        allow_force_pushes: { enabled: true },
        allow_deletions: { enabled: true },
      },
    };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: drifted,
          rulesets: { outcome: 'ok', data: [] },
        }),
      ],
    });
    const classic = lines.find((l) => l.lineName.includes('classic'));
    expect(classic?.verdict.status).toBe('warn');
    expect(classic?.verdict.message).toContain('enforce_admins');
    expect(classic?.verdict.message).toContain('allow_force_pushes');
    expect(classic?.verdict.message).toContain('allow_deletions');
  });

  it('is unknown (auth-class) on a 200 without the protection toggles', () => {
    const shy: NetworkSurfaceSnapshot = { outcome: 'ok', data: { url: 'x' } };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: shy,
          rulesets: { outcome: 'ok', data: [] },
        }),
      ],
    });
    const classic = lines.find((l) => l.lineName.includes('classic'));
    expect(classic?.verdict.status).toBe('unknown');
    expect(classic?.verdict.message).toContain('auth-class');
  });

  it('is unknown on a 404 classic surface (indistinguishable from under-privilege)', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: { outcome: 'not-found', detail: 'HTTP 404' },
          rulesets: { outcome: 'ok', data: [] },
        }),
      ],
    });
    const classic = lines.find((l) => l.lineName.includes('classic'));
    expect(classic?.verdict.status).toBe('unknown');
    expect(classic?.verdict.message).not.toContain('drift');
  });

  it('warns on the rulesets surface when a push/PR ruleset is bypassable', () => {
    const bypassablePr = {
      id: 3,
      name: 'pr-gate',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      bypass_actors: [{ actor_id: 1, actor_type: 'OrganizationAdmin' }],
      rules: [{ type: 'pull_request', parameters: {} }],
    };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: okBranchProtection,
          rulesets: { outcome: 'ok', data: [bypassablePr] },
        }),
      ],
    });
    const rulesetLine = lines.find((l) => l.lineName.includes('rulesets'));
    expect(rulesetLine?.verdict.status).toBe('warn');
    expect(rulesetLine?.verdict.message).toContain('pr-gate');
    expect(rulesetLine?.verdict.message).toContain('bypassable');
  });

  it('warns on the rulesets surface when a push/PR ruleset is evaluate-mode', () => {
    const evaluatePr = {
      id: 4,
      name: 'pr-evaluate',
      enforcement: 'evaluate',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      bypass_actors: [],
      rules: [{ type: 'non_fast_forward', parameters: {} }],
    };
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: okBranchProtection,
          rulesets: { outcome: 'ok', data: [evaluatePr] },
        }),
      ],
    });
    const rulesetLine = lines.find((l) => l.lineName.includes('rulesets'));
    expect(rulesetLine?.verdict.status).toBe('warn');
    expect(rulesetLine?.verdict.message).toContain('enforcement=evaluate');
  });

  it('renders classic + rulesets independently when one surface cannot verify', () => {
    const lines = detectNetworkPostureContract(contract, {
      row: 'repo-branch-protection-posture',
      repos: [
        snapshot('mmnto-ai/totem', 'totem', {
          branchProtection: okBranchProtection,
          rulesets: { outcome: 'auth', detail: 'HTTP 403' },
        }),
      ],
    });
    const classic = lines.find((l) => l.lineName.includes('classic'));
    const rulesetLine = lines.find((l) => l.lineName.includes('rulesets'));
    expect(classic?.verdict.status).toBe('pass');
    expect(rulesetLine?.verdict.status).toBe('unknown');
  });
});

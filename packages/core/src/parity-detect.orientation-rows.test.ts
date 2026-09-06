/**
 * Tests for the two 472-charter ORIENTATION rows the network-read-only family
 * senses (mmnto-ai/totem#2791): `gh-issue-label-canon` and
 * `gh-project-vocabulary`, rendered by `detectNetworkPostureContract`.
 *
 * Pure + synchronous + NEVER-networks: every test injects pre-fetched canned
 * snapshots (the CLI-edge fetch is not exercised here) and, for the label row,
 * the canon TEXT as a roster-wide surface. Zero live network, zero spawns.
 *
 * Invariants pinned: a cannot-verify outcome on either surface (or on the
 * canon) is never a drift verdict; an empty canon can never pass; the
 * provenance the CLI edge disclosed is echoed in the line; a repo with no
 * project binding, or a sibling, is honest-absent; the expected option sets
 * come from the row's own text; per-repo lines; consumers scoping.
 */

import { describe, expect, it } from 'vitest';

import {
  type DetectNetworkPostureContext,
  detectNetworkPostureContract,
  type NetworkProbeRepoSnapshot,
  type NetworkSurfaceSnapshot,
  type ProjectBinding,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';

// ─── Fixtures ───────────────────────────────────────────

const ROW_TEXT =
  'Status = Todo | In Progress | Done | Closed-Lateral | Closed-Superseded | Closed-Done | Informs-Design; Priority = Now | Next | Blocked | Horizon; extra fields permitted';

const STATUS = [
  'Todo',
  'In Progress',
  'Done',
  'Closed-Lateral',
  'Closed-Superseded',
  'Closed-Done',
  'Informs-Design',
];
const PRIORITY = ['Now', 'Next', 'Blocked', 'Horizon'];

function mkContract(id: string, expectedValue: string, consumers?: string[]): ParityContract {
  return {
    id,
    dimension: 'orientation',
    canonicalSource:
      id === 'gh-issue-label-canon' ? 'mmnto-ai/totem:scripts/sync-labels.ps1' : null,
    detectionMethod: 'capability-probe',
    expectedValueOrDerivation: expectedValue,
    tractability: 'mechanical',
    trackingIssue: 'mmnto-ai/totem-strategy#472',
    manifestation: 'capability-probe',
    senses: 'present',
    ...(consumers !== undefined ? { consumers } : {}),
  };
}

const labelContract = mkContract('gh-issue-label-canon', 'derived from scripts/sync-labels.ps1');
const vocabContract = mkContract('gh-project-vocabulary', ROW_TEXT);

const CANON_SCRIPT = [
  'gh label edit "tier-1" --color "d73a4a" --description "Immediate priority" --repo $Repo',
  'gh label edit "type: bug" --color "d73a4a" --description "Something is not working" --repo $Repo',
  'gh label edit "scope: cli" --color "de89ff" --description "CLI" --repo $Repo',
  'Merge-Label "bug" "type: bug"',
].join('\n');

const LOCAL_PROVENANCE = 'local checkout scripts/sync-labels.ps1';

const canonOk: NetworkSurfaceSnapshot = {
  outcome: 'ok',
  data: CANON_SCRIPT,
  detail: LOCAL_PROVENANCE,
};

function labelsOk(
  labels: { name: string; color?: string | null; description?: string | null }[],
): NetworkSurfaceSnapshot {
  return { outcome: 'ok', data: labels };
}

const conformantLabels = labelsOk([
  { name: 'tier-1', color: 'd73a4a', description: 'Immediate priority' },
  { name: 'type: bug', color: 'D73A4A', description: 'Something is not working' },
  { name: 'scope: cli', color: 'de89ff', description: 'CLI' },
]);

function labelSnapshot(
  repoSlug: string,
  repoId: string,
  labels: NetworkSurfaceSnapshot | undefined,
): NetworkProbeRepoSnapshot {
  return { repoSlug, repoId, surfaces: labels === undefined ? {} : { labels } };
}

function labelCtx(
  repos: NetworkProbeRepoSnapshot[],
  labelCanon: NetworkSurfaceSnapshot | undefined = canonOk,
): DetectNetworkPostureContext {
  return {
    row: 'gh-issue-label-canon',
    repos,
    ...(labelCanon !== undefined ? { labelCanon } : {}),
  };
}

function fieldsBody(
  nodes: unknown[],
  hasNextPage = false,
  projectV2: 'present' | 'null' = 'present',
): unknown {
  return {
    data: {
      organization: {
        projectV2:
          projectV2 === 'null'
            ? null
            : { title: 'Convergent Spine Roadmap', fields: { pageInfo: { hasNextPage }, nodes } },
      },
    },
  };
}

const field = (name: string, options: string[]): unknown => ({
  name,
  options: options.map((o) => ({ name: o })),
});

/** The canonical project as the GraphQL read returns it — one non-single-select node ({}) included. */
const canonicalFields = fieldsBody([{}, field('Status', STATUS), field('Priority', PRIORITY)]);

const BOUND: ProjectBinding = { kind: 'bound', owner: 'mmnto-ai', number: 1 };

function vocabSnapshot(
  repoSlug: string,
  repoId: string,
  project: ProjectBinding | undefined,
  projectFields?: NetworkSurfaceSnapshot,
): NetworkProbeRepoSnapshot {
  return {
    repoSlug,
    repoId,
    surfaces: projectFields === undefined ? {} : { projectFields },
    ...(project !== undefined ? { project } : {}),
  };
}

function vocabCtx(repos: NetworkProbeRepoSnapshot[]): DetectNetworkPostureContext {
  return { row: 'gh-project-vocabulary', repos };
}

// ─── gh-issue-label-canon ────────────────────────────────

describe('gh-issue-label-canon', () => {
  it('passes on a conformant label list and echoes the canon provenance', () => {
    const lines = detectNetworkPostureContract(
      labelContract,
      labelCtx([labelSnapshot('mmnto-ai/totem', 'totem', conformantLabels)]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineName).toBe('Parity: gh-issue-label-canon [mmnto-ai/totem]');
    expect(lines[0]?.verdict.status).toBe('pass');
    // The message names the repo (the `--json` readout has no per-repo line name).
    expect(lines[0]?.verdict.message).toContain('mmnto-ai/totem: 3/3 canonical labels present');
    expect(lines[0]?.verdict.message).toContain('3 canonical namespaces');
    expect(lines[0]?.verdict.message).toContain(`canon: ${LOCAL_PROVENANCE}`);
  });

  it('warns naming a missing canonical label', () => {
    const lines = detectNetworkPostureContract(
      labelContract,
      labelCtx([
        labelSnapshot(
          'mmnto-ai/totem',
          'totem',
          labelsOk([
            { name: 'tier-1', color: 'd73a4a', description: 'Immediate priority' },
            { name: 'scope: cli', color: 'de89ff', description: 'CLI' },
          ]),
        ),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('mmnto-ai/totem: 2/3 canonical labels present');
    expect(lines[0]?.verdict.message).toContain('missing [type: bug]');
  });

  it('warns naming a redefined colour and a redefined description', () => {
    const lines = detectNetworkPostureContract(
      labelContract,
      labelCtx([
        labelSnapshot(
          'mmnto-ai/totem',
          'totem',
          labelsOk([
            { name: 'tier-1', color: 'fbca04', description: 'Immediate priority' },
            { name: 'type: bug', color: 'd73a4a', description: null },
            { name: 'scope: cli', color: 'de89ff', description: 'CLI' },
          ]),
        ),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('tier-1 (color fbca04 vs canon d73a4a)');
    expect(lines[0]?.verdict.message).toContain('type: bug (description)');
  });

  it('warns on a name inside a canonical namespace that is not in the canon', () => {
    const lines = detectNetworkPostureContract(
      labelContract,
      labelCtx([
        labelSnapshot(
          'mmnto-ai/totem',
          'totem',
          labelsOk([
            ...(conformantLabels.data as { name: string }[]),
            { name: 'scope: docs', color: 'de89ff', description: 'x' },
          ]),
        ),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain(
      'in a canonical namespace but not in the canon [scope: docs]',
    );
  });

  it('passes with extra labels outside the namespaces and a retired name, both reported', () => {
    const lines = detectNetworkPostureContract(
      labelContract,
      labelCtx([
        labelSnapshot(
          'mmnto-ai/totem',
          'totem',
          labelsOk([
            ...(conformantLabels.data as { name: string }[]),
            { name: 'disposition: done', color: '000000', description: null },
            { name: '1.11.0', color: 'ededed', description: null },
            { name: 'bug', color: 'ededed', description: null },
          ]),
        ),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[0]?.verdict.message).toContain(
      '2 extra outside the canonical namespaces permitted',
    );
    expect(lines[0]?.verdict.message).toContain('retired name(s) still present: bug');
  });

  it('skips on a no-transport label surface and is unknown on auth / not-found / error (never a drift verdict)', () => {
    const outcomes: [NetworkSurfaceSnapshot['outcome'], string][] = [
      ['no-transport', 'skip'],
      ['auth', 'unknown'],
      ['not-found', 'unknown'],
      ['error', 'unknown'],
    ];
    for (const [outcome, status] of outcomes) {
      const lines = detectNetworkPostureContract(
        labelContract,
        labelCtx([labelSnapshot('mmnto-ai/totem', 'totem', { outcome })]),
      );
      expect(lines[0]?.verdict.status, outcome).toBe(status);
    }
  });

  it('is unknown when the label surface was not probed or is not a label list', () => {
    const notProbed = detectNetworkPostureContract(
      labelContract,
      labelCtx([labelSnapshot('mmnto-ai/totem', 'totem', undefined)]),
    );
    expect(notProbed[0]?.verdict.status).toBe('unknown');
    // Cannot-verify messages name the repo too (pass 2 p2-F4, pinned pass 3 p3-F3).
    expect(notProbed[0]?.verdict.message).toContain('mmnto-ai/totem labels: not probed');

    const unshaped = detectNetworkPostureContract(
      labelContract,
      labelCtx([labelSnapshot('mmnto-ai/totem', 'totem', { outcome: 'ok', data: { nope: true } })]),
    );
    expect(unshaped[0]?.verdict.status).toBe('unknown');
    expect(unshaped[0]?.verdict.message).toContain('not a label list');
  });

  it('is cannot-verify for EVERY repo when the canon is absent, unreadable, not text, or empty', () => {
    const repos = [
      labelSnapshot('mmnto-ai/totem', 'totem', conformantLabels),
      labelSnapshot('mmnto-ai/totem-strategy', 'totem-strategy', conformantLabels),
    ];
    // Built inline: an explicit `undefined` argument would select labelCtx's DEFAULT canon.
    const absent = detectNetworkPostureContract(labelContract, {
      row: 'gh-issue-label-canon',
      repos,
    });
    expect(absent.map((l) => l.verdict.status)).toEqual(['unknown', 'unknown']);
    // A roster-wide canon fact still names each repo on its own line (pass 3, p3-F1).
    expect(absent[0]?.verdict.message).toContain('mmnto-ai/totem: label canon');
    expect(absent[0]?.verdict.message).toContain('not resolved');
    expect(absent[1]?.verdict.message).toContain('mmnto-ai/totem-strategy: label canon');

    const offline = detectNetworkPostureContract(
      labelContract,
      labelCtx(repos, { outcome: 'no-transport' }),
    );
    expect(offline.map((l) => l.verdict.status)).toEqual(['skip', 'skip']);

    const fetchFailed = detectNetworkPostureContract(
      labelContract,
      labelCtx(repos, { outcome: 'error', detail: 'canonical fetch: HTTP 500' }),
    );
    expect(fetchFailed[0]?.verdict.status).toBe('unknown');
    expect(fetchFailed[0]?.verdict.message).toContain('HTTP 500');

    const notText = detectNetworkPostureContract(
      labelContract,
      labelCtx(repos, { outcome: 'ok', data: { content: 'x' }, detail: 'p' }),
    );
    expect(notText[0]?.verdict.status).toBe('unknown');
    expect(notText[0]?.verdict.message).toContain('not text');

    const empty = detectNetworkPostureContract(
      labelContract,
      labelCtx(repos, { outcome: 'ok', data: 'Write-Host "nothing"', detail: 'p' }),
    );
    expect(empty.map((l) => l.verdict.status)).toEqual(['unknown', 'unknown']);
    expect(empty[0]?.verdict.message).toContain('empty canon');
  });

  it('renders one line per roster repo and applies consumers scoping per repo', () => {
    const scoped = mkContract('gh-issue-label-canon', 'derived', ['totem']);
    const lines = detectNetworkPostureContract(
      scoped,
      labelCtx([
        labelSnapshot('mmnto-ai/totem', 'totem', conformantLabels),
        labelSnapshot('mmnto-ai/liquid-city', 'liquid-city', { outcome: 'auth' }),
      ]),
    );
    expect(lines.map((l) => l.lineName)).toEqual(['Parity: gh-issue-label-canon [mmnto-ai/totem]']);

    const both = detectNetworkPostureContract(
      labelContract,
      labelCtx([
        labelSnapshot('mmnto-ai/totem', 'totem', conformantLabels),
        labelSnapshot('mmnto-ai/liquid-city', 'liquid-city', { outcome: 'auth' }),
      ]),
    );
    expect(both.map((l) => l.verdict.status)).toEqual(['pass', 'unknown']);
  });
});

// ─── gh-project-vocabulary ───────────────────────────────

describe('gh-project-vocabulary', () => {
  it('passes when both governed option sets equal the row text, naming the project and the counts', () => {
    const lines = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: canonicalFields }),
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.lineName).toBe('Parity: gh-project-vocabulary [mmnto-ai/totem]');
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[0]?.verdict.message).toContain(
      'mmnto-ai/projects/1: Status 7/7, Priority 4/4 option sets equal the canon',
    );
  });

  it('passes with an extra single-select field and a different option order, both reported', () => {
    const body = fieldsBody([
      field('Status', [...STATUS].reverse()),
      field('Priority', PRIORITY),
      field('M', ['M0', 'M1']),
    ]);
    const lines = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot(
          'mmnto-ai/liquid-city',
          'liquid-city',
          { kind: 'bound', owner: 'mmnto-ai', number: 2 },
          { outcome: 'ok', data: body },
        ),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[0]?.verdict.message).toContain('mmnto-ai/projects/2');
    expect(lines[0]?.verdict.message).toContain('1 extra field(s) permitted: M');
    expect(lines[0]?.verdict.message).toContain('option order differs on Status');
  });

  it('warns naming a missing and an extra option on a governed field', () => {
    const body = fieldsBody([
      field('Status', [...STATUS.filter((o) => o !== 'Done'), 'Shipped']),
      field('Priority', PRIORITY),
    ]);
    const lines = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: body })]),
    );
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain(
      'Status: option set differs — missing [Done], extra [Shipped]',
    );
  });

  it('warns when a governed field is absent from the project (the twin reads it as a fault)', () => {
    const body = fieldsBody([field('Status', STATUS)]);
    const lines = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: body })]),
    );
    expect(lines[0]?.verdict.status).toBe('warn');
    expect(lines[0]?.verdict.message).toContain('Priority: field absent');
  });

  it('is honest-absent (skip) for an unbound current repo, a sibling, and an unresolved binding', () => {
    const lines = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem-status', 'totem-status', { kind: 'unbound' }),
        vocabSnapshot('mmnto-ai/liquid-city', 'liquid-city', { kind: 'sibling' }),
        vocabSnapshot('mmnto-ai/totem-strategy', 'totem-strategy', undefined),
      ]),
    );
    expect(lines.map((l) => l.verdict.status)).toEqual(['skip', 'skip', 'skip']);
    expect(lines[0]?.verdict.message).toContain('mmnto-ai/totem-status: no project bound');
    expect(lines[0]?.verdict.message).toContain('orient.projectNumber unset');
    expect(lines[1]?.verdict.message).toContain(
      'mmnto-ai/liquid-city: bound project not derivable',
    );
    expect(lines[1]?.verdict.message).toContain('sibling repo');
    expect(lines[2]?.verdict.message).toContain(
      'mmnto-ai/totem-strategy: project binding not resolved',
    );
  });

  it('is unknown when the row text yields no option sets (never a hardcoded pass)', () => {
    const prose = mkContract(
      'gh-project-vocabulary',
      'the option sets equal Project 1 (extra fields permitted)',
    );
    const lines = detectNetworkPostureContract(
      prose,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: canonicalFields }),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('unknown');
    expect(lines[0]?.verdict.message).toContain('cannot derive the expected option sets');
    expect(lines[0]?.verdict.message).toContain('expected-value-or-derivation text');
  });

  it('prefers the STRUCTURED expected-option-sets field over the prose, and names which canon it read', () => {
    // The prose says one thing, the structured field another: the field wins
    // (strategy's 2026-09-05 ruling — the field is the contract, the prose the
    // pinned interim), and the line discloses the source it read.
    const structured: ParityContract = {
      ...mkContract('gh-project-vocabulary', 'Status = Todo | Done; Priority = Now | Next'),
      expectedOptionSets: { Status: STATUS, Priority: PRIORITY },
    };
    const lines = detectNetworkPostureContract(
      structured,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: canonicalFields }),
      ]),
    );
    expect(lines[0]?.verdict.status).toBe('pass');
    expect(lines[0]?.verdict.message).toContain('Status 7/7, Priority 4/4');
    expect(lines[0]?.verdict.message).toContain('(canon: expected-option-sets)');

    // Prose-only rows say so too.
    const prose = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: canonicalFields }),
      ]),
    );
    expect(prose[0]?.verdict.message).toContain('(canon: expected-value-or-derivation text)');
  });

  it('is unknown when the project is null / inaccessible, when the fields overflow one page, or when the body is unshaped', () => {
    const nullProject = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, {
          outcome: 'ok',
          data: fieldsBody([], false, 'null'),
        }),
      ]),
    );
    expect(nullProject[0]?.verdict.status).toBe('unknown');
    expect(nullProject[0]?.verdict.message).toContain('not found or not accessible');

    const overflow = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, {
          outcome: 'ok',
          data: fieldsBody([field('Status', STATUS), field('Priority', PRIORITY)], true),
        }),
      ]),
    );
    expect(overflow[0]?.verdict.status).toBe('unknown');
    expect(overflow[0]?.verdict.message).toContain('more fields than one page');

    const unshaped = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, {
          outcome: 'ok',
          data: { data: { organization: { projectV2: { fields: 'nope' } } } },
        }),
      ]),
    );
    expect(unshaped[0]?.verdict.status).toBe('unknown');
    expect(unshaped[0]?.verdict.message).toContain('not a project field list');
  });

  it('skips on no-transport and is unknown on auth / error / not probed (never a drift verdict)', () => {
    const offline = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'no-transport' })]),
    );
    expect(offline[0]?.verdict.status).toBe('skip');

    const auth = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'auth', detail: 'HTTP 403' }),
      ]),
    );
    expect(auth[0]?.verdict.status).toBe('unknown');
    expect(auth[0]?.verdict.message).toContain('HTTP 403');

    const notProbed = detectNetworkPostureContract(
      vocabContract,
      vocabCtx([vocabSnapshot('mmnto-ai/totem', 'totem', BOUND)]),
    );
    expect(notProbed[0]?.verdict.status).toBe('unknown');
    expect(notProbed[0]?.verdict.message).toContain('not probed');
  });

  it('renders one line per roster repo and applies consumers scoping per repo', () => {
    const scoped = mkContract('gh-project-vocabulary', ROW_TEXT, ['totem']);
    const lines = detectNetworkPostureContract(
      scoped,
      vocabCtx([
        vocabSnapshot('mmnto-ai/totem', 'totem', BOUND, { outcome: 'ok', data: canonicalFields }),
        vocabSnapshot('mmnto-ai/liquid-city', 'liquid-city', { kind: 'sibling' }),
      ]),
    );
    expect(lines.map((l) => l.lineName)).toEqual([
      'Parity: gh-project-vocabulary [mmnto-ai/totem]',
    ]);
    expect(lines[0]?.verdict.status).toBe('pass');
  });
});

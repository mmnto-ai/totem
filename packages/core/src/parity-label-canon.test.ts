/**
 * Tests for the pure § 4b / § 4c derivations behind the two orientation parity
 * rows (mmnto-ai/totem#2791): the label canon parsed from the REAL
 * `scripts/sync-labels.ps1` in this repository (the Tenet 20 check — the parser
 * must derive the script's actual sets, not a fixture that flatters it), the
 * namespace tokens derived from the canonical names, the § 4c drift predicate,
 * the option-set grammar over the row's own text, and the § 4b drift predicate.
 * Zero I/O beyond the one in-repo script read; no network; no spawns.
 */

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  labelCanonDrift,
  type LiveLabel,
  namespaceTokensOf,
  normalizeLabelColor,
  optionSetsOfProjectFields,
  parseExpectedOptionSets,
  parseLabelCanon,
  projectVocabularyDrift,
} from './parity-label-canon.js';
import { parseParityManifest } from './parity-manifest.js';

/** The canon of record, read from this repository (packages/core/src → the repo root). */
const REAL_SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../scripts/sync-labels.ps1',
);

/** The pinned 0.1.42 row text for `gh-project-vocabulary` (verbatim). */
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

/** A three-label canon for the drift cases: one per token shape. */
const FIXTURE_SCRIPT = [
  'gh label edit "tier-1" --color "d73a4a" --description "Immediate priority" --repo $Repo 2>$null',
  'gh label edit "type: bug" --color "#D73A4A" --description "Something is not working" --repo $Repo',
  'gh label edit "scope: cli" --color "de89ff" --description "" --repo $Repo',
  'Merge-Label "bug" "type: bug"',
  'Merge-Label -OldName "enhancement" -NewName "type: feature"',
].join('\n');

function live(name: string, color = 'd73a4a', description: string | null = 'x'): LiveLabel {
  return { name, color, description };
}

// ─── parseLabelCanon ─────────────────────────────────────

describe('parseLabelCanon — the real scripts/sync-labels.ps1', () => {
  const canon = parseLabelCanon(readFileSync(REAL_SCRIPT_PATH, 'utf8'));

  it('derives exactly the 18 canonical labels the row names (tier ×3 · type ×6 · scope ×4 · domain ×3 · status ×2)', () => {
    expect(canon.labels).toHaveLength(18);
    const names = canon.labels.map((l) => l.name);
    expect(names.filter((n) => n.startsWith('tier-'))).toHaveLength(3);
    expect(names.filter((n) => n.startsWith('type: '))).toHaveLength(6);
    expect(names.filter((n) => n.startsWith('scope: '))).toHaveLength(4);
    expect(names.filter((n) => n.startsWith('domain: '))).toHaveLength(3);
    expect(names.filter((n) => n.startsWith('status: '))).toHaveLength(2);
  });

  it('derives exactly the five namespace tokens, the space kept on the colon tokens', () => {
    expect(canon.namespaces).toEqual(['domain: ', 'scope: ', 'status: ', 'tier-', 'type: ']);
  });

  it('carries the colour and description of each definition, colour lower-case without #', () => {
    const bug = canon.labels.find((l) => l.name === 'type: bug');
    expect(bug).toEqual({
      name: 'type: bug',
      color: 'd73a4a',
      description: 'Something is not working',
    });
    for (const label of canon.labels) expect(label.color).toMatch(/^[0-9a-f]{6}$/);
  });

  it('records the Merge-Label retirements (the strays the script folds into canonical names)', () => {
    expect(canon.merges.length).toBeGreaterThanOrEqual(20);
    expect(canon.merges).toContainEqual({ from: 'bug', to: 'type: bug' });
  });
});

describe('parseLabelCanon — shapes', () => {
  it('normalizes a #-prefixed upper-case colour and admits an empty description', () => {
    const canon = parseLabelCanon(FIXTURE_SCRIPT);
    expect(canon.labels).toEqual([
      { name: 'tier-1', color: 'd73a4a', description: 'Immediate priority' },
      { name: 'type: bug', color: 'd73a4a', description: 'Something is not working' },
      { name: 'scope: cli', color: 'de89ff', description: '' },
    ]);
  });

  it('reads both Merge-Label spellings (positional and named parameters)', () => {
    expect(parseLabelCanon(FIXTURE_SCRIPT).merges).toEqual([
      { from: 'bug', to: 'type: bug' },
      { from: 'enhancement', to: 'type: feature' },
    ]);
  });

  it('yields an EMPTY canon from text with no gh label edit call (the caller refuses to judge on it)', () => {
    expect(parseLabelCanon('Write-Host "nothing here"').labels).toEqual([]);
    expect(parseLabelCanon('').namespaces).toEqual([]);
  });

  it('ignores an unquoted or partial edit call (only the quoted three-argument shape defines the canon)', () => {
    expect(
      parseLabelCanon('gh label edit tier-9 --color abc123 --description nope').labels,
    ).toEqual([]);
    expect(parseLabelCanon('gh label edit "tier-9" --color "abc123"').labels).toEqual([]);
  });
});

// ─── namespaceTokensOf ───────────────────────────────────

describe('namespaceTokensOf', () => {
  it('takes the name through its first ": " (space included), else through its first "-"', () => {
    expect(namespaceTokensOf(['tier-1', 'type: bug', 'scope: cli', 'type: docs'])).toEqual([
      'scope: ',
      'tier-',
      'type: ',
    ]);
  });

  it('contributes no token for a name with neither separator, and none for a colon without a space', () => {
    expect(namespaceTokensOf(['plain', 'type:bug'])).toEqual([]);
  });
});

// ─── normalizeLabelColor ─────────────────────────────────

describe('normalizeLabelColor', () => {
  it('strips one leading # and lower-cases; null / undefined become the empty string', () => {
    expect(normalizeLabelColor('#ABCDEF')).toBe('abcdef');
    expect(normalizeLabelColor('abcdef')).toBe('abcdef');
    expect(normalizeLabelColor(null)).toBe('');
    expect(normalizeLabelColor(undefined)).toBe('');
  });
});

// ─── labelCanonDrift ─────────────────────────────────────

describe('labelCanonDrift (§ 4c)', () => {
  const canon = parseLabelCanon(FIXTURE_SCRIPT);
  const conformant: LiveLabel[] = [
    live('tier-1', 'D73A4A', 'Immediate priority'),
    live('type: bug', '#d73a4a', 'Something is not working'),
    live('scope: cli', 'de89ff', null),
  ];

  it('conforms when every canonical name is present with its colour (any case, with or without #) and description (null == empty)', () => {
    const drift = labelCanonDrift(conformant, canon);
    expect(drift.conforming).toBe(true);
    expect(drift).toMatchObject({
      missing: [],
      redefined: [],
      squatters: [],
      extra: [],
      retiredPresent: [],
    });
  });

  it('names a missing canonical label', () => {
    const drift = labelCanonDrift(conformant.slice(1), canon);
    expect(drift.conforming).toBe(false);
    expect(drift.missing).toEqual(['tier-1']);
  });

  it('names a redefined colour with expected and actual, both normalized', () => {
    const drift = labelCanonDrift(
      [live('tier-1', '#FBCA04', 'Immediate priority'), ...conformant.slice(1)],
      canon,
    );
    expect(drift.redefined).toEqual([
      { name: 'tier-1', color: { expected: 'd73a4a', actual: 'fbca04' } },
    ]);
  });

  it('names a redefined description (exact compare; a null description against canonical text is a redefinition)', () => {
    const drift = labelCanonDrift(
      [
        live('tier-1', 'd73a4a', 'Immediate priority '),
        live('type: bug', 'd73a4a', null),
        conformant[2] as LiveLabel,
      ],
      canon,
    );
    expect(drift.redefined).toEqual([
      { name: 'tier-1', description: true },
      { name: 'type: bug', description: true },
    ]);
  });

  it('flags a name inside a canonical namespace that is not in the canon (the space is part of the token)', () => {
    const drift = labelCanonDrift(
      [...conformant, live('scope: docs'), live('type:audit'), live('tier-4')],
      canon,
    );
    expect(drift.squatters).toEqual([
      { name: 'scope: docs', namespace: 'scope: ' },
      { name: 'tier-4', namespace: 'tier-' },
    ]);
    expect(drift.extra).toEqual(['type:audit']);
    expect(drift.conforming).toBe(false);
  });

  it('permits and reports labels outside every canonical namespace, sorted; a retired name is reported apart', () => {
    const drift = labelCanonDrift(
      [
        ...conformant,
        live('routine: weekly'),
        live('1.11.0'),
        live('disposition: done'),
        live('bug'),
      ],
      canon,
    );
    expect(drift.conforming).toBe(true);
    expect(drift.extra).toEqual(['1.11.0', 'disposition: done', 'routine: weekly']);
    expect(drift.retiredPresent).toEqual(['bug']);
  });
});

// ─── parseExpectedOptionSets ─────────────────────────────

describe('parseExpectedOptionSets (the row grammar)', () => {
  it('reads the pinned row text into the two governed sets, in clause order, ignoring the prose clause', () => {
    const sets = parseExpectedOptionSets(ROW_TEXT);
    expect([...sets.keys()]).toEqual(['Status', 'Priority']);
    expect(sets.get('Status')).toEqual(STATUS);
    expect(sets.get('Priority')).toEqual(PRIORITY);
  });

  // The PINNED doctrine row, not a mirrored literal (falsification pass 1, F4):
  // a doctrine reword that the grammar reads differently fails HERE instead of
  // darkening the sensor with a green suite. The pack is an optionalDependency
  // that never materializes on an unauthenticated install (mmnto-ai/totem#2289),
  // so the case is skipped, loudly by name, when the manifest is absent.
  const PINNED_MANIFEST = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../node_modules/@mmnto/strategy-doctrine/parity-manifest.yaml',
  );
  it.skipIf(!existsSync(PINNED_MANIFEST))(
    'reads the PINNED gh-project-vocabulary row (the installed doctrine manifest) into the two governed sets',
    () => {
      const parsed = parseParityManifest(readFileSync(PINNED_MANIFEST, 'utf8'));
      expect(parsed.status).toBe('ok');
      if (parsed.status !== 'ok') return;
      const row = parsed.manifest.contracts.find((c) => c.id === 'gh-project-vocabulary');
      expect(row).toBeDefined();
      if (row === undefined) return;
      const sets =
        row.expectedOptionSets !== undefined
          ? new Map(Object.entries(row.expectedOptionSets))
          : parseExpectedOptionSets(row.expectedValueOrDerivation);
      expect([...sets.keys()]).toEqual(['Status', 'Priority']);
      expect(sets.get('Status')).toEqual(STATUS);
      expect(sets.get('Priority')).toEqual(PRIORITY);
    },
  );

  it('yields an EMPTY map from text without a Field = a | b clause (never a hardcoded set)', () => {
    expect(parseExpectedOptionSets('').size).toBe(0);
    expect(parseExpectedOptionSets('extra fields permitted').size).toBe(0);
    expect(parseExpectedOptionSets('Status =').size).toBe(0);
    expect(parseExpectedOptionSets(' = Todo | Done').size).toBe(0);
  });

  it('trims whitespace around fields and options and drops empty options', () => {
    expect(parseExpectedOptionSets('  Status  =  Todo |  | Done ;')).toEqual(
      new Map([['Status', ['Todo', 'Done']]]),
    );
  });
});

// ─── optionSetsOfProjectFields + projectVocabularyDrift ─

describe('projectVocabularyDrift (§ 4b)', () => {
  const expected = parseExpectedOptionSets(ROW_TEXT);
  const field = (name: string, options: string[]) => ({
    name,
    options: options.map((o) => ({ name: o })),
  });

  it('conforms when both governed sets equal the canon; extra fields are reported as additions', () => {
    const actual = optionSetsOfProjectFields([
      field('Status', STATUS),
      field('Priority', PRIORITY),
      field('M', ['M0', 'M1']),
    ]);
    expect(projectVocabularyDrift(actual, expected)).toEqual({
      conforming: true,
      faults: [],
      orderDiffers: [],
      added: ['M'],
    });
  });

  it('treats a different option ORDER as information, never a fault', () => {
    const actual = optionSetsOfProjectFields([
      field('Status', [...STATUS].reverse()),
      field('Priority', PRIORITY),
    ]);
    const drift = projectVocabularyDrift(actual, expected);
    expect(drift.conforming).toBe(true);
    expect(drift.orderDiffers).toEqual(['Status']);
  });

  it('faults a missing option and an extra option on the same field, naming each', () => {
    const actual = optionSetsOfProjectFields([
      field('Status', [...STATUS.filter((o) => o !== 'Done'), 'Shipped']),
      field('Priority', PRIORITY),
    ]);
    const drift = projectVocabularyDrift(actual, expected);
    expect(drift.conforming).toBe(false);
    expect(drift.faults).toEqual([
      { field: 'Status', kind: 'option-set-differs', missing: ['Done'], extra: ['Shipped'] },
    ]);
  });

  it('faults an ABSENT governed field (its set is empty, which is not the canon)', () => {
    const actual = optionSetsOfProjectFields([field('Status', STATUS)]);
    const drift = projectVocabularyDrift(actual, expected);
    expect(drift.faults).toEqual([
      { field: 'Priority', kind: 'field-missing', missing: PRIORITY, extra: [] },
    ]);
  });
});

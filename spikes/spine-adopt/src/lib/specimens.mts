// ─── The specimen table, as data ─────────────────────────────────────────────
//
// One row per authored record source, transcribing the spec's amended
// § "The five specimens" table. Read by verify-records / facts / shipped-verdicts
// so the three harnesses cannot drift from each other.

import * as path from 'node:path';
import { RECORDS_DIR, REPO_ROOT } from './spike-env.mts';

/** The pinned test's own id + clock, so specimens (d)/(e) reproduce the pins EXACTLY. */
export const PINNED_RULE_ID = '0123456789abcdef';
export const PINNED_NOW = '2026-08-21T00:00:00.000Z';

export interface FixtureRef {
  /** `.totem/tests/<name>.md`, repo-relative. */
  file: string;
  /** Corpus F/P line counts quoted in the spec table — CORPUS DESCRIPTIONS, never verdict counts. */
  specFailLines: number;
  specPassLines: number;
}

export interface Specimen {
  id: string;
  class: 'regex' | 'flat ast-grep' | 'compound ast-grep' | 'requires (§ D8)' | 'exception';
  /** The record source, absolute. */
  recordFile: string;
  /**
   * The producer-minted rule id threaded into `compileRuleRecord`. For specimens
   * whose semantics come from a named legacy rule this IS that rule's hash, so the
   * artifacts stay traceable to the corpus row. For the two exemplar
   * transcriptions it is the PINNED test id, so § Invariants' "reproduces the
   * already-pinned `record-runtime.test.ts` verdicts" is a literal reproduction
   * rather than an id-substituted approximation.
   */
  ruleId: string;
  /** The legacy corpus rule the semantics were drawn from, or null for an exemplar transcription. */
  legacySource: string | null;
  /** The exported exemplar factory this record transcribes, or null. */
  exemplarFactory: 'design4ExemplarRecord' | 'design8ExemplarRecord' | null;
  /** Corpus fixture, when the table names one. */
  fixture: FixtureRef | null;
  /** In-scope virtual path for the record's own inline `examples[]`. */
  inlineFilePath: string;
  notes: string;
}

export const SPECIMENS: Specimen[] = [
  {
    id: 'a',
    class: 'regex',
    recordFile: path.join(RECORDS_DIR, 'a-regex-lessons-rm-guard.rule.yaml'),
    ruleId: '61dcb058bd1df15d',
    legacySource: '61dcb058bd1df15d',
    exemplarFactory: null,
    fixture: { file: '.totem/tests/test-61dcb058bd1df15d.md', specFailLines: 1, specPassLines: 1 },
    inlineFilePath: 'scripts/deploy.sh',
    notes: '5 `!`-negated legacy globs re-authored as excludeGlobs; 9 positives verbatim.',
  },
  {
    id: 'b',
    class: 'flat ast-grep',
    recordFile: path.join(RECORDS_DIR, 'b-astgrep-flat-empty-catch.rule.yaml'),
    ruleId: '2d962603591aa928',
    legacySource: '2d962603591aa928',
    exemplarFactory: null,
    fixture: { file: '.totem/tests/test-ast-empty-catch.md', specFailLines: 3, specPassLines: 5 },
    inlineFilePath: 'scripts/audit.ts',
    notes:
      "NARROWED to fileGlobs ['**/*.ts'] + language typescript; the legacy 4-extension set fails the § Design 6 language⇄glob floor.",
  },
  {
    id: 'c',
    class: 'compound ast-grep',
    recordFile: path.join(RECORDS_DIR, 'c-astgrep-compound-spawn-shell.rule.yaml'),
    ruleId: 'd0815b6769304e26',
    legacySource: 'd0815b6769304e26',
    exemplarFactory: null,
    fixture: { file: '.totem/tests/test-d0815b6769304e26.md', specFailLines: 3, specPassLines: 4 },
    inlineFilePath: 'packages/core/src/spawn-site.ts',
    notes: 'compound tree verbatim incl. the embedded Rust-regex `^shell$` (dual-dialect hazard).',
  },
  {
    id: 'c-supp',
    class: 'compound ast-grep',
    recordFile: path.join(RECORDS_DIR, 'c-supp-astgrep-compound-failopen-catch.rule.yaml'),
    ruleId: '87aff037d7de47a7',
    legacySource: '87aff037d7de47a7',
    exemplarFactory: null,
    fixture: { file: '.totem/tests/test-87aff037d7de47a7.md', specFailLines: 8, specPassLines: 20 },
    inlineFilePath: 'packages/core/src/catch-site.ts',
    notes:
      'supplementary richness arm; SAME matcher as specimen (e), isolating the exception axis.',
  },
  {
    id: 'd-line',
    class: 'requires (§ D8)',
    recordFile: path.join(RECORDS_DIR, 'd-requires-line.rule.yaml'),
    ruleId: PINNED_RULE_ID,
    legacySource: null,
    exemplarFactory: 'design8ExemplarRecord',
    fixture: null,
    inlineFilePath: 'scripts/x.sh',
    notes: 'verdicts pinned at record-runtime.test.ts:286-334.',
  },
  {
    id: 'd-file',
    class: 'requires (§ D8)',
    recordFile: path.join(RECORDS_DIR, 'd-requires-file.rule.yaml'),
    ruleId: PINNED_RULE_ID,
    legacySource: null,
    exemplarFactory: 'design8ExemplarRecord',
    fixture: null,
    inlineFilePath: 'scripts/x.sh',
    notes:
      'the pinned `scope: file` spread-variant (record-runtime.test.ts:358-361); verdicts pinned at 336-395.',
  },
  {
    id: 'e',
    class: 'exception',
    recordFile: path.join(RECORDS_DIR, 'e-exception-excludeglobs.rule.yaml'),
    ruleId: PINNED_RULE_ID,
    legacySource: null,
    exemplarFactory: 'design4ExemplarRecord',
    fixture: null,
    inlineFilePath: 'packages/core/src/a.ts',
    notes: '4 verdicts pinned at record-runtime.test.ts:397-433.',
  },
];

export function specimen(id: string): Specimen {
  const s = SPECIMENS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown specimen id: ${id}`);
  return s;
}

export function fixtureAbsPath(ref: FixtureRef): string {
  return path.join(REPO_ROOT, ref.file);
}

/** The record's repo-relative path, used as `parseRuleRecord`'s diagnostic filePath. */
export function recordRelPath(s: Specimen): string {
  return path.relative(REPO_ROOT, s.recordFile).split(path.sep).join('/');
}

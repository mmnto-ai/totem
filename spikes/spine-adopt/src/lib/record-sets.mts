// ─── The record-set loader (G1) ──────────────────────────────────────────────
//
// Spec `.totem/specs/seed20-apparatus.md` § G1: the pipeline's source of records
// is a LOADER, not the hardcoded `SPECIMENS` table. Two sets exist:
//
//   `specimens` (default)  today's seven authored specimens, byte-for-byte the
//                          same rows `src/lib/specimens.mts` has always exported,
//                          so every committed artifact, check and Go test holds
//                          unchanged.
//   `seed20`               the frozen R14 seed: the 22 `.totem/rules/r14-*.rule.yaml`
//                          at pin `2a7135762b6aedc9cd3099ab3f42e029ee34092e`, copied
//                          byte-identically under `seed/records/` (see `seed/PIN.md`).
//
// Selected by `SPIKE_RECORD_SET`. NOTHING here decides a verdict: the loader emits
// rows, and the § Lowering 4 / shipped-compile gates emit reject ROWS
// (`src/lib/records.mts`). Scoring is strategy's, at the pin, after the run of record.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { type FixtureRef, type Specimen, SPECIMENS } from './specimens.mts';
import { SPIKE_ROOT } from './spike-env.mts';

export type RecordSetId = 'specimens' | 'seed20' | 'control';

export const SEED_DIR = path.join(SPIKE_ROOT, 'seed');
export const SEED_RECORDS_DIR = path.join(SEED_DIR, 'records');
export const SEED_PIN_FILE = path.join(SEED_DIR, 'PIN.md');
/** `seed/controls/` — the K-control inputs, byte-pinned in the tree (spec § slice 2, constraint 4). */
export const SEED_CONTROLS_DIR = path.join(SEED_DIR, 'controls');
/**
 * The K5 control record: a byte-identical copy of `records/d-requires-file.rule.yaml`,
 * loaded as a 23rd row of the `seed20` set so the M3 null/empty split is minted
 * INSIDE the seed run (§ S3). Its identity to the sibling is checked by sha
 * equality at run time, never against a constant — a constant would only prove the
 * constant and the copy agree.
 */
export const K5_CONTROL_RECORD = path.join(SEED_CONTROLS_DIR, 'k5', 'd-requires-file.rule.yaml');
/** The sibling the K5 control copy must equal, byte for byte. */
export const K5_CONTROL_SIBLING = path.join(SPIKE_ROOT, 'records', 'd-requires-file.rule.yaml');
/** The two K8 § Design 5 rejection fixtures (strategy's `operations/310-seed20-target/fixtures/k8/`). */
export const K8_FIXTURES: readonly { id: string; file: string; expect: string; kind: string }[] = [
  {
    id: 'K8-unknown-key',
    file: path.join(SEED_CONTROLS_DIR, 'k8', 'k8-unknown-key.rule.yaml'),
    expect: 'REJECTED — the message names the unrecognized key `fileGlob`',
    kind: 'unknown-key',
  },
  {
    id: 'K8-missing-mandatory',
    file: path.join(SEED_CONTROLS_DIR, 'k8', 'k8-missing-mandatory.rule.yaml'),
    expect: 'REJECTED — the message names the absent mandatory field `message`',
    kind: 'missing-mandatory',
  },
];
/** The K3 target captures, taken from `044e114b`'s published lowering + chain. */
export const K3_CAPTURE_POLICY = path.join(SEED_CONTROLS_DIR, 'k3', 'k3-target.policy.rego');
export const K3_CAPTURE_CHAIN = path.join(SEED_CONTROLS_DIR, 'k3', 'k3-target.chain.json');
/** The package the K3 captures belong to — the seed's `87aff037` record. */
export const K3_CAPTURE_PACKAGE = 'r87aff037d7de47a7';

/** The frozen commit the `seed/records/` copies were taken from (`seed/PIN.md`). */
export const SEED_RECORD_PIN = '2a7135762b6aedc9cd3099ab3f42e029ee34092e';

/**
 * A loaded record row. `Specimen` unchanged, plus the three fields the seed set
 * needs and the specimens set answers with its historical values — so no consumer
 * has to branch on the record set to read a row.
 */
export interface RecordRow extends Specimen {
  /** G4's grouping label: the seed entry (the file stem's 8-hex), or null off the seed set. */
  seedEntry: string | null;
  /**
   * The LEGACY CORPUS rule this record transcribes, when it transcribes one.
   * Distinct from `legacySource`: on the seed set `legacySource` is the seed entry
   * (G1's wording) and there is no corpus row to compare against, so the
   * transcription-fidelity block in `src/verify-records.mts` keys off THIS field.
   */
  legacyCorpusRule: string | null;
  /**
   * The discriminator appended to a COLLIDING package name (§ Lowering 1 / note N1).
   * Specimens: the specimen id (three share the pinned exemplar id). Seed: the
   * record's declared `language` — the charter fixes `totem.spike.r<lessonHash>_<language>`
   * for BOTH records of a twinned rule.
   */
  packageDiscriminator: string;
  /**
   * (C5) TRUE only for a K-control row that is not part of the scored corpus —
   * today the K5 record (§ S3), which rides the `seed20` set so the M3 bundles are
   * minted inside the run, and the single row of the `control` set (§ S5).
   *
   * FALSE on every seed and specimen row, and the flag rides every row artifact the
   * pipeline emits, so the scorer never has to infer which rows it may count. The
   * split that matters to the scorer is the manifest's — `records[]` vs
   * `controlRecords[]` — and this flag on each row.
   */
  control: boolean;
}

// ─── The seed table ──────────────────────────────────────────────────────────

/**
 * The per-record data that is NOT derivable from the record file: the in-scope
 * virtual path its inline `examples[]` are served at (G2 — every seed record gets
 * one, and the two `language: javascript` twins get a `.js` path because ast
 * extraction dispatches on the extension, `src/facts.mts:59-61,83-91`), and the
 * corpus fixture when the seed names one.
 *
 * Everything else — `ruleId`, `seedEntry`, `packageDiscriminator` — is READ FROM
 * THE RECORD, so this table cannot drift from the pinned bytes.
 */
interface SeedEntryDecl {
  /** The record file's stem with the `r14-` prefix removed; this is the row's `id`. */
  id: string;
  inlineFilePath: string;
  fixture?: FixtureRef;
}

const SEED_ENTRIES: SeedEntryDecl[] = [
  {
    id: '0167a783-dynamic-import-utility-layer',
    inlineFilePath: 'packages/cli/src/adapters/loader.ts',
  },
  { id: '0e01112d-bare-new-error', inlineFilePath: 'src/errors.ts' },
  { id: '1a7080eb-inline-secrets-agent-config', inlineFilePath: '.mcp.json' },
  { id: '49dd9e4f-llm-character-counting', inlineFilePath: 'packages/core/src/prompt.ts' },
  { id: '54140f59-bare-issue-number-refs', inlineFilePath: 'packages/cli/src/commands/issue.ts' },
  {
    id: '5b85fe53-suppress-event-runtime-failure',
    inlineFilePath: 'packages/core/src/emit-site.ts',
  },
  { id: '5da43ea6-git-double-dash-separator', inlineFilePath: 'scripts/release.sh' },
  { id: '6467c351-dynamic-import-cli-entry', inlineFilePath: 'packages/cli/src/index.ts' },
  {
    id: '65ede9bf-dynamic-import-command-handlers',
    inlineFilePath: 'packages/cli/src/handlers/run.ts',
  },
  { id: '6b1890e2-empty-string-in-whitelist-js', inlineFilePath: 'scripts/branches.js' },
  { id: '6b1890e2-empty-string-in-whitelist', inlineFilePath: 'packages/core/src/branches.ts' },
  { id: '6b2b62eb-totem-error-log-tag', inlineFilePath: 'packages/core/src/log-site.ts' },
  { id: '71935fe9-string-cast-on-input-js', inlineFilePath: 'scripts/cast.js' },
  { id: '71935fe9-string-cast-on-input', inlineFilePath: 'packages/core/src/cast.ts' },
  {
    id: '87aff037-fail-open-catch-ban',
    inlineFilePath: 'packages/core/src/catch-site.ts',
    // The ONE seed record with a corpus fixture. The F/P counts are CORPUS
    // DESCRIPTIONS (`src/lib/specimens.mts` `FixtureRef`), never verdict counts;
    // they are the same fixture and the same counts specimen `c-supp` carries.
    fixture: { file: '.totem/tests/test-87aff037d7de47a7.md', specFailLines: 8, specPassLines: 20 },
  },
  { id: '89184bb5-bsd-sed-hex-escape', inlineFilePath: 'scripts/color.sh' },
  { id: 'aa7a588d-async-test-callbacks', inlineFilePath: 'packages/core/src/a.test.ts' },
  { id: 'b237bcf3-pwd-in-credential-regex', inlineFilePath: 'packages/cli/src/assets/patterns.ts' },
  {
    id: 'b9736096-orchestrator-test-timeout',
    inlineFilePath: 'packages/cli/src/orchestrators/shell-orchestrator.test.ts',
  },
  { id: 'be74c55c-actions-input-expansion', inlineFilePath: '.github/workflows/ci.yml' },
  { id: 'd5faa14c-absolute-claims-in-docs', inlineFilePath: 'docs/overview.md' },
  { id: 'd940b2c9-stdio-in-exec-options', inlineFilePath: 'packages/core/src/exec-site.ts' },
];

// ─── Reading the record's own identity out of the pinned bytes ───────────────

/**
 * The rule id a seed record is compiled under, read from its own
 * `curation.sourceLesson: 'lesson-<16 hex>'`.
 *
 * A § Design 4 record carries no `ruleId` key (it is producer-owned and
 * inexpressible), so the id has to come from somewhere; `sourceLesson` is the
 * record's own statement of which lesson it translates, and it is what makes the
 * two twinned rules share one `lessonHash` with their originals. FAILS LOUD when
 * it is absent — a guessed id would silently fork the twins apart.
 */
function ruleIdOf(yamlText: string, file: string): string {
  const m = /^ {2}sourceLesson: '(?:lesson-)?([0-9a-f]{16})'$/m.exec(yamlText);
  if (!m) {
    throw new Error(
      `seed record ${file} carries no \`curation.sourceLesson: 'lesson-<16 hex>'\` — the record's ` +
        `lessonHash is unreadable and the apparatus refuses to guess one (spec § G1).`,
    );
  }
  return m[1]!;
}

/** The record's declared `target.language`, or null for a regex record. */
function languageOf(yamlText: string): string | null {
  const m = /^ {2}language: ([A-Za-z][A-Za-z0-9_-]*)$/m.exec(yamlText);
  return m ? m[1]! : null;
}

/**
 * The number of `examples[]` pairs a record declares, read from its own bytes the
 * way `ruleIdOf` and `languageOf` read theirs.
 *
 * `  - bad:` at the two-space list indent under the top-level `examples:` key is the
 * only shape any record in this apparatus uses (all 30 at the pin). Zero is refused
 * loudly: `src/facts.mts` requires at least one pair, so a count of zero means the
 * scanner missed the block, not that the record has none.
 */
function examplePairCountOf(yamlText: string, file: string): number {
  const n = (yamlText.match(/^ {2}- bad:/gm) ?? []).length;
  if (n === 0) {
    throw new Error(
      `record ${file} declares no \`examples[]\` pair at the \`  - bad:\` indent — the manifest cannot ` +
        'name the fact bundles it will mint (§ S2 / fold 1 F5).',
    );
  }
  return n;
}

/** True when the record declares a top-level `requires:` block with `scope: file`. */
function requiresScopeFile(yamlText: string): boolean {
  const at = yamlText.search(/^requires:$/m);
  if (at < 0) return false;
  // Scan only the block: the next line at column 0 closes it, so a `scope: file`
  // belonging to some later key cannot be read as this one's.
  for (const line of yamlText.slice(at).split('\n').slice(1)) {
    if (/^\S/.test(line)) return false;
    if (/^ {2}scope: file$/.test(line)) return true;
  }
  return false;
}

/**
 * (fold 1 F5) The fact-bundle fixture ids a CONTROL row is declared to mint, named
 * at manifest time from the record's own bytes.
 *
 * The spellings are `src/facts.mts`'s, reproduced exactly:
 *
 *   inline    `<id>-inline<ordinal-when-more-than-one>-<bad|good>` per `examples[]` pair
 *   M3 fold   `<id>-control-unreadable` and `<id>-control-empty`, minted for the
 *             set's `requires.scope: file` record — which on `seed20` is the K5
 *             control itself
 *
 * `src/facts.mts` asserts after minting that the bundles carrying this row's
 * specimen id are EXACTLY this list. Declared here and measured there, deliberately:
 * a control whose bundles silently went missing would otherwise be an absence, and
 * an absence is the one thing a run cannot notice about itself.
 */
export function controlBundleFixtureIds(row: RecordRow): string[] {
  const yamlText = fs.readFileSync(row.recordFile, 'utf-8');
  const pairs = examplePairCountOf(yamlText, path.basename(row.recordFile));
  const ids: string[] = [];
  for (let i = 0; i < pairs; i++) {
    for (const arm of ['bad', 'good'] as const) {
      ids.push(`${row.id}-inline${pairs > 1 ? `${i}` : ''}-${arm}`);
    }
  }
  if (requiresScopeFile(yamlText)) {
    ids.push(`${row.id}-control-unreadable`, `${row.id}-control-empty`);
  }
  return ids;
}

// ─── The sets ────────────────────────────────────────────────────────────────

function specimensSet(): RecordRow[] {
  return SPECIMENS.map((s) => ({
    ...s,
    seedEntry: null,
    legacyCorpusRule: s.legacySource,
    packageDiscriminator: s.id,
    control: false,
  }));
}

/**
 * (§ S3) The K5 control row: the `d-file` specimen DECLARATION, re-pointed at the
 * byte-identical copy under `seed/controls/k5/`.
 *
 * It exists because the M3 fold's null/empty/content split is only constructible
 * from a `requires.scope: file` record, and the seed carries none — `5da43ea6` is
 * the seed's only `requires:` record and its scope is `line`. Without this row the
 * seed run would SKIP the split with a named reason (`src/facts.mts`), and K5 would
 * have no referent inside the run of record. The row flows through intake,
 * lowering, build, certification, facts and every arm exactly like a seed row; the
 * only thing that marks it is `control: true` and `seedEntry: null`.
 */
function k5ControlRow(): RecordRow {
  const d = SPECIMENS.find((s) => s.id === 'd-file');
  if (!d) {
    throw new Error(
      'the specimen table carries no `d-file` row, so the K5 control record cannot be built from its declaration (spec `.totem/specs/seed20-apparatus-slice2.md` § S3).',
    );
  }
  if (!fs.existsSync(K5_CONTROL_RECORD)) {
    throw new Error(
      `${K5_CONTROL_RECORD} is missing — the K5 control record is part of the apparatus (§ S3, constraint 4).`,
    );
  }
  return {
    id: d.id,
    class: d.class,
    recordFile: K5_CONTROL_RECORD,
    ruleId: d.ruleId,
    legacySource: d.legacySource,
    legacyCorpusRule: null,
    exemplarFactory: d.exemplarFactory,
    fixture: null,
    inlineFilePath: d.inlineFilePath,
    notes:
      'K5 CONTROL — a byte-identical copy of records/d-requires-file.rule.yaml, loaded as a control row so the M3 null/empty split is minted inside the seed run (§ S3). Not a scored record.',
    seedEntry: null,
    packageDiscriminator: d.id,
    control: true,
  };
}

/**
 * (§ S5, C11) The `control` set: exactly ONE row, named by `SPIKE_CONTROL_RECORD`
 * as a path relative to `spikes/spine-adopt/`, and it must be one of the seven
 * authored specimen records. Anything else is refused rather than loaded, because
 * the point of this set is a control-only REBUILD of a record whose chain is
 * already committed — a record with no committed chain has nothing to be a control
 * for.
 */
function controlSet(): RecordRow[] {
  const rel = controlRecordPath();
  if (rel === null) {
    throw new Error(
      'the `control` record set requires SPIKE_CONTROL_RECORD=<path relative to spikes/spine-adopt/> (§ S5).',
    );
  }
  const abs = path.join(SPIKE_ROOT, ...rel.split('/'));
  const match = SPECIMENS.find((s) => path.resolve(s.recordFile) === path.resolve(abs));
  if (!match) {
    throw new Error(
      `SPIKE_CONTROL_RECORD=${JSON.stringify(rel)} is not one of the ${SPECIMENS.length} authored specimen records; ` +
        `expected one of: ${SPECIMENS.map((s) => `records/${path.basename(s.recordFile)}`).join(', ')} (§ S5).`,
    );
  }
  return [
    {
      ...match,
      seedEntry: null,
      legacyCorpusRule: match.legacySource,
      packageDiscriminator: match.id,
      control: true,
      notes: `${match.notes} CONTROL-ONLY RUN (§ S5, K3 arm B): this record is rebuilt alone and its published chain is compared byte-for-byte against the committed one.`,
    },
  ];
}

function seed20Set(): RecordRow[] {
  if (!fs.existsSync(SEED_RECORDS_DIR)) {
    throw new Error(
      `${SEED_RECORDS_DIR} is missing — the frozen seed copies are part of the apparatus (see seed/PIN.md).`,
    );
  }
  const onDisk = fs
    .readdirSync(SEED_RECORDS_DIR)
    .filter((f) => f.endsWith('.rule.yaml'))
    .sort();
  const declared = SEED_ENTRIES.map((e) => `r14-${e.id}.rule.yaml`).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    throw new Error(
      `seed/records/ holds ${onDisk.length} record(s) but the seed table declares ${declared.length}. ` +
        `on disk only: ${JSON.stringify(onDisk.filter((f) => !declared.includes(f)))}; ` +
        `declared only: ${JSON.stringify(declared.filter((f) => !onDisk.includes(f)))}`,
    );
  }

  const seedRows = SEED_ENTRIES.map((e) => {
    const recordFile = path.join(SEED_RECORDS_DIR, `r14-${e.id}.rule.yaml`);
    const yamlText = fs.readFileSync(recordFile, 'utf-8');
    const ruleId = ruleIdOf(yamlText, `r14-${e.id}.rule.yaml`);
    const seedEntry = e.id.slice(0, 8);
    if (!ruleId.startsWith(seedEntry)) {
      throw new Error(
        `seed record r14-${e.id}.rule.yaml: the file stem's seed entry \`${seedEntry}\` is not the ` +
          `prefix of the lessonHash \`${ruleId}\` its own curation.sourceLesson names.`,
      );
    }
    const language = languageOf(yamlText);
    return {
      id: e.id,
      // The class is a LABEL on the row. The engine binding is decided by the
      // shipped `compileRuleRecord`, and `src/lower.mts` records the compiled
      // engine per record; this field only has to be one of the declared union
      // members, so it is derived from the authored target type rather than
      // guessed at a richness the seed table does not know.
      class: /^ {2}type: regex$/m.test(yamlText)
        ? ('regex' as const)
        : /^ {2}rule:$/m.test(yamlText)
          ? ('compound ast-grep' as const)
          : ('flat ast-grep' as const),
      recordFile,
      ruleId,
      legacySource: seedEntry,
      legacyCorpusRule: null,
      exemplarFactory: null,
      fixture: e.fixture ?? null,
      inlineFilePath: e.inlineFilePath,
      notes: `R14 seed-20 record, frozen at ${SEED_RECORD_PIN} (seed/PIN.md).`,
      seedEntry,
      packageDiscriminator: language ?? e.id,
      control: false,
    } satisfies RecordRow;
  });
  // (§ S3) The K5 control row is APPENDED, never interleaved: the 22 scored rows
  // keep their order and their indices, and a reader that wants the corpus alone
  // filters on `control`.
  return [...seedRows, k5ControlRow()];
}

/**
 * `SPIKE_CONTROL_RECORD`, as a forward-slashed path relative to
 * `spikes/spine-adopt/`, or `null` when unset. Recorded in the manifest.
 */
export function controlRecordPath(): string | null {
  const raw = process.env.SPIKE_CONTROL_RECORD;
  if (raw === undefined || raw === '') return null;
  return raw.split('\\').join('/');
}

/**
 * `SPIKE_RECORD_SET`, validated. Unset ⇒ `specimens`, so every existing run is
 * unchanged; `SPIKE_CONTROL_RECORD` selects `control` (C11).
 *
 * Setting `SPIKE_CONTROL_RECORD` together with `SPIKE_RECORD_SET` at anything but
 * `control` is a REFUSAL on both sides of the seam: the two would name different
 * corpora for one run, and whichever the reader happened to consult would be the
 * one it believed.
 */
export function activeRecordSet(): RecordSetId {
  const raw = process.env.SPIKE_RECORD_SET;
  const control = controlRecordPath();
  if (
    raw !== undefined &&
    raw !== '' &&
    raw !== 'specimens' &&
    raw !== 'seed20' &&
    raw !== 'control'
  ) {
    throw new Error(
      `SPIKE_RECORD_SET=${JSON.stringify(raw)} is not a record set; expected 'specimens', 'seed20' or 'control'.`,
    );
  }
  if (control !== null) {
    if (raw !== undefined && raw !== '' && raw !== 'control') {
      throw new Error(
        `SPIKE_CONTROL_RECORD=${JSON.stringify(control)} selects the \`control\` record set, but ` +
          `SPIKE_RECORD_SET=${JSON.stringify(raw)} names a different one — the run would have two corpora (C11). ` +
          'Unset one of them.',
      );
    }
    return 'control';
  }
  if (raw === 'control') {
    throw new Error(
      'SPIKE_RECORD_SET=control requires SPIKE_CONTROL_RECORD=<path relative to spikes/spine-adopt/> — the `control` set is exactly the record that variable names (§ S5).',
    );
  }
  if (raw === undefined || raw === '') return 'specimens';
  return raw;
}

/** The active record set's rows, in the set's declared order. */
export function loadRecordSet(setId: RecordSetId = activeRecordSet()): RecordRow[] {
  if (setId === 'seed20') return seed20Set();
  if (setId === 'control') return controlSet();
  return specimensSet();
}

/**
 * The (N1) collision, DECLARED per set — so `src/lower.mts` asserts a measurement
 * against a declaration rather than against itself. The seed pair is fixed by the
 * pin: `6b1890e2` and `71935fe9` each carry a `language: typescript` original and a
 * `language: javascript` twin under ONE `curation.sourceLesson`.
 *
 * The declaration also decides the PACKAGE SUFFIX: the charter fixes
 * `totem.spike.r<lessonHash>_<language>` for BOTH records of a twinned rule, so a
 * twin that failed to lower must not silently un-suffix its surviving sibling.
 */
export const DECLARED_TWINNED_IDS: Record<RecordSetId, readonly string[]> = {
  specimens: ['0123456789abcdef'],
  seed20: ['6b1890e2dbda3331', '71935fe9a742137b'],
  // (§ S5) The `control` set is one row, so nothing collides. Declared rather than
  // derived: a control run whose package name silently took a `_<specimen>` suffix
  // would publish a chain the committed set has no counterpart for, and K3 arm B
  // would compare against nothing.
  control: [],
};

/** The ids that ACTUALLY repeat across the loaded rows. */
export function measuredSharedIds(rows: readonly RecordRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.ruleId, (counts.get(r.ruleId) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();
}

/** The (N1) check's name, per set — the specimens wording is byte-stable evidence. */
export function sharedIdCheckName(setId: RecordSetId): string {
  if (setId === 'seed20') {
    return 'CONTRACT NOTE (N1) — `r<ruleId>` is not unique: each twinned rule shares one lessonHash across its per-language records';
  }
  if (setId === 'control') {
    return 'CONTRACT NOTE (N1) — the `control` set is ONE record, so no lessonHash collides and the package name is exactly `r<ruleId>`';
  }
  return 'CONTRACT NOTE (N1) — `r<ruleId>` is not unique: the pinned exemplar id is shared';
}

// ─── The shared scope-probe set (G2) ─────────────────────────────────────────

/**
 * The probe paths every record's globs are exercised against
 * (`src/lower.mts` § Lowering 5's fidelity assertion).
 *
 * SPLIT BY RECORD SET, deliberately. The probe list is serialised into each
 * record's `globs.json` (`scopeProbes` / `perGlobProbes`), whose sha256 is the
 * second component of the chain's `regoSha256` — so extending the SHARED list
 * would move `artifacts/chains/*.json` for the seven specimens and break the
 * spec's constraint 3 ("K3's chain sha holds"). The specimens list is therefore
 * frozen exactly as it was, and the seed set appends its own probes to it.
 */
export const SPECIMEN_PROBE_PATHS: readonly string[] = [
  'scripts/deploy.sh',
  'deploy.sh',
  'a/b/c/deploy.sh',
  'scripts/audit.ts',
  'audit.ts',
  'packages/core/src/a.ts',
  'packages/core/src/a.test.ts',
  'packages/core/src/a.spec.ts',
  'packages/src/example.ts',
  'src/example.sh',
  'scripts/x.sh',
  'deep/nest/x.cjs',
  'scripts/x.ts',
  '.claude/agents/foo.md',
  '.claude/x',
  '.totem/lessons.md',
  '.totem/lessons/lesson-cd27a5b0.md',
  '.totem/tests/test-x.md',
  'packages/cli/src/orchestrators/shell-orchestrator.ts',
  'packages\\core\\src\\a.ts',
  'notes.md',
  'README',
];

// ─── (§ S1) G2 is a GENERATOR, not a literal list ────────────────────────────
//
// The seed's probe paths used to be 38 hand-written literals. A literal list is
// evidence of nothing: it cannot be re-derived from the seed, it cannot say WHY a
// path is in it, and a glob added to the corpus leaves it silently short. The two
// rules below take a glob and produce a path that MUST match it and a twin that
// MUST NOT, and `seed/probe-pairs.json` pins what they produce at the pin.

export interface SeedGlobRow {
  kind: 'fileGlobs' | 'excludeGlobs';
  glob: string;
}

export interface SeedProbePair {
  glob: string;
  kind: SeedGlobRow['kind'];
  /** A path the glob MUST match. */
  probe: string;
  /** The same path with one literal changed, so the glob MUST NOT match it. */
  twin: string;
}

/**
 * Every `target.scope.{fileGlobs,excludeGlobs}` entry declared by the frozen seed,
 * in file order then declaration order.
 *
 * Read out of the YAML TEXT, exactly the way `ruleIdOf` and `languageOf` above
 * read their fields. This module must NOT import `core` — `src/lib/records.mts`
 * imports the barrel and imports this file, so a core import here would close a
 * cycle — and the shipped parser is not needed to answer "which globs does the
 * frozen text declare".
 */
export function seedGlobCensus(): SeedGlobRow[] {
  if (!fs.existsSync(SEED_RECORDS_DIR)) {
    throw new Error(
      `${SEED_RECORDS_DIR} is missing — the frozen seed copies are part of the apparatus (see seed/PIN.md).`,
    );
  }
  const rows: SeedGlobRow[] = [];
  for (const file of fs
    .readdirSync(SEED_RECORDS_DIR)
    .filter((f) => f.endsWith('.rule.yaml'))
    .sort()) {
    const lines = fs.readFileSync(path.join(SEED_RECORDS_DIR, file), 'utf-8').split('\n');
    let kind: SeedGlobRow['kind'] | null = null;
    for (const line of lines) {
      const key = /^ {4}(fileGlobs|excludeGlobs):$/.exec(line);
      if (key) {
        kind = key[1] as SeedGlobRow['kind'];
        continue;
      }
      if (kind === null) continue;
      // Only a 6-space list item under the key we are inside is a glob. Anything
      // else ends the block — `examples:`'s own `      - name:` items live at the
      // same indent in `be74c55c`, so the block must be CLOSED, not scanned past.
      const item = /^ {6}- '([^']*)'$/.exec(line) ?? /^ {6}- "([^"]*)"$/.exec(line);
      if (item) {
        rows.push({ kind, glob: item[1]! });
        continue;
      }
      kind = null;
    }
  }
  if (rows.length === 0) {
    throw new Error(
      `${SEED_RECORDS_DIR} declared no globs — the census read no \`fileGlobs:\`/\`excludeGlobs:\` block, which cannot be right for the frozen seed.`,
    );
  }
  return rows;
}

/**
 * The DISTINCT globs of the seed, one row each.
 *
 * A glob that appears as a `fileGlobs` entry anywhere is a positive glob (33 at
 * the pin: 30 positives, plus the 3 that appear ONLY as exclusions —
 * `packages/cli/src/commands/**\/*.ts`, `**\/*.test.*`, `**\/*.spec.*`).
 */
export function distinctSeedGlobs(): SeedGlobRow[] {
  const census = seedGlobCensus();
  const positives = new Set(census.filter((r) => r.kind === 'fileGlobs').map((r) => r.glob));
  const seen = new Set<string>();
  const out: SeedGlobRow[] = [];
  for (const r of census) {
    if (seen.has(r.glob)) continue;
    seen.add(r.glob);
    out.push({ kind: positives.has(r.glob) ? 'fileGlobs' : 'excludeGlobs', glob: r.glob });
  }
  return out;
}

/**
 * A path the glob MUST match.
 *
 * `**\/` → `k3b/` FIRST, then every remaining `*` → `probe`. The order matters:
 * rewriting `*` first would turn `**\/` into `probeprobe/`, which is a segment, not
 * a crossing. `?` and `{` are LITERALS in the record dialect (`src/lower.mts`
 * § Lowering 5, `optionalSyntax` is empty), so they are left alone.
 *
 * A bare `**` NOT followed by `/` lowers to `.*` and would cross segments in a
 * position this generator has no reading for — it is REFUSED loudly rather than
 * lowered to `probeprobe`. No seed glob carries one.
 */
export function matchingProbe(glob: string): string {
  if (/\*\*(?!\/)/.test(glob)) {
    throw new Error(
      `seed glob ${JSON.stringify(glob)} carries a bare \`**\` that is not followed by \`/\`; ` +
        'the probe generator has no reading for a segment-crossing wildcard in that position (§ S1). ' +
        'No seed glob at the pin carries one — if the corpus grew one, the RULE needs amending, not this call.',
    );
  }
  return glob.split('**/').join('k3b/').split('*').join('probe');
}

/**
 * The same path with the glob's LAST LITERAL character changed, so the glob must
 * NOT match it.
 *
 * "Literal" means a character the GLOB spells, excluding `*` and `/`; a character
 * a wildcard produced is not one. `_` is the replacement, `-` when the literal is
 * already `_`. Scanning right-to-left and changing exactly one character is what
 * makes the twin a NEAR miss: appending `.zz` fails on `**\/*.spec.*` and
 * `**\/*.test.*` (the trailing `*` swallows it) and prefixing a segment fails on
 * the 25 globs that begin `**\/`.
 *
 * A last segment with NO literal at all ("everything in that directory") has no
 * near miss to construct, so it THROWS rather than returning a path that might
 * match. No seed glob at the pin has one.
 */
export function nonMatchingProbe(glob: string): string {
  // Rebuild the probe while tracking which output characters came from a LITERAL
  // glob character, so the replacement lands on the right one even after `**/` and
  // `*` have expanded to text of their own.
  let out = '';
  const literalAt: boolean[] = [];
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      out += 'k3b/';
      for (let k = 0; k < 'k3b/'.length; k++) literalAt.push(false);
      i += 3;
      continue;
    }
    if (glob[i] === '*') {
      if (glob[i + 1] === '*') {
        // Refused by `matchingProbe`; re-raised here so either entry point is loud.
        return matchingProbe(glob);
      }
      out += 'probe';
      for (let k = 0; k < 'probe'.length; k++) literalAt.push(false);
      i += 1;
      continue;
    }
    const ch = glob[i]!;
    out += ch;
    literalAt.push(ch !== '/');
    i += 1;
  }
  const lastSlash = out.lastIndexOf('/');
  let at = -1;
  for (let k = out.length - 1; k > lastSlash; k--) {
    if (literalAt[k]) {
      at = k;
      break;
    }
  }
  if (at < 0) {
    throw new Error(
      `seed glob ${JSON.stringify(glob)} carries NO literal character in its last segment, so it matches ` +
        'everything in that directory and no single-character near miss exists (§ S1). ' +
        'No seed glob at the pin is of that shape.',
    );
  }
  const replacement = out[at] === '_' ? '-' : '_';
  return `${out.slice(0, at)}${replacement}${out.slice(at + 1)}`;
}

/**
 * One `{glob, kind, probe, twin}` row per distinct seed glob (33 at the pin).
 *
 * KEY ORDER IS LOAD-BEARING: `seed/probe-pairs.json` pins these rows and
 * `src/verify-records.mts` compares them with `Checks.eq`, which is a JSON-string
 * comparison. A reordered literal here would fail that check for no semantic
 * reason, so the order is the one the spec states.
 */
export function generatedSeedProbes(): SeedProbePair[] {
  return distinctSeedGlobs().map((r) => ({
    glob: r.glob,
    kind: r.kind,
    probe: matchingProbe(r.glob),
    twin: nonMatchingProbe(r.glob),
  }));
}

/** The one-line statement of the two rules, published in the manifest (§ S2). */
export const PROBE_GENERATION_RULE =
  "matching probe = every `**/` -> `k3b/` then every `*` -> `probe`; twin = that probe with the glob's LAST LITERAL character (right-to-left; `*` and `/` are not literals) replaced by `_`, or by `-` when it is already `_`.";

/** The pinned expectation the generator is asserted against (`seed/probe-pairs.json`). */
export const PROBE_PAIRS_FILE = path.join(SEED_DIR, 'probe-pairs.json');

let seed20ProbePathsCache: readonly string[] | null = null;

/**
 * The shared probe list for a record set.
 *
 * The specimens list is FROZEN — exactly the 22 `SPECIMEN_PROBE_PATHS`, in authored
 * order, because it is serialised into every specimen's `globs.json` and that file's
 * sha256 is a component of the committed chain digests (constraint 3). The `control`
 * set rebuilds one of those same specimens, so it takes the same frozen list.
 *
 * (fold 1 F4, `.totem/specs/seed20-apparatus-slice2-fold1.md` — the 19:23Z ruling
 * my record dropped) The seed set is that frozen list PLUS:
 *
 *   - every seed record's `inlineFilePath` — the path each record's own inline
 *     `examples[]` are served at, and therefore the one path the record is
 *     GUARANTEED to consider in scope. A probe set that omitted them swept the
 *     lowered scope over paths no record was authored against;
 *   - every seed record's corpus `fixture.file` (one at the pin: `87aff037`'s);
 *   - every generated probe and twin (§ S1).
 *
 * Deduped and sorted by CODEPOINT, so the list is a function of the corpus rather
 * than of an emission order.
 *
 * The K5 control row's `inlineFilePath` is deliberately NOT here: the control is not
 * a seed record, its path is not part of the scored corpus's scope question, and
 * `src/lower.mts` probes every row's own inline path per record anyway (`probePaths`
 * appends `s.inlineFilePath` to the shared list for the row being lowered). Adding
 * it to the SHARED list would sweep a control's path across all 23 packages.
 */
export function sharedProbePaths(setId: RecordSetId): readonly string[] {
  if (setId !== 'seed20') return SPECIMEN_PROBE_PATHS;
  // Memoised per process: `src/lower.mts` calls this once per record (and again in
  // each check name), and the seed corpus is frozen for the whole run — 22 record
  // reads plus the glob census per call would be pure re-work.
  if (seed20ProbePathsCache !== null) return seed20ProbePathsCache;
  const seedRows = loadRecordSet('seed20').filter((r) => !r.control);
  const inlinePaths = seedRows.map((r) => r.inlineFilePath);
  const fixtureFiles = seedRows.flatMap((r) => (r.fixture ? [r.fixture.file] : []));
  const generated = generatedSeedProbes().flatMap((p) => [p.probe, p.twin]);
  seed20ProbePathsCache = [
    ...new Set([...SPECIMEN_PROBE_PATHS, ...inlinePaths, ...fixtureFiles, ...generated]),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return seed20ProbePathsCache;
}

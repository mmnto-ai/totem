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

export type RecordSetId = 'specimens' | 'seed20';

export const SEED_DIR = path.join(SPIKE_ROOT, 'seed');
export const SEED_RECORDS_DIR = path.join(SEED_DIR, 'records');
export const SEED_PIN_FILE = path.join(SEED_DIR, 'PIN.md');

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

// ─── The sets ────────────────────────────────────────────────────────────────

function specimensSet(): RecordRow[] {
  return SPECIMENS.map((s) => ({
    ...s,
    seedEntry: null,
    legacyCorpusRule: s.legacySource,
    packageDiscriminator: s.id,
  }));
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

  return SEED_ENTRIES.map((e) => {
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
    } satisfies RecordRow;
  });
}

/** `SPIKE_RECORD_SET`, validated. Unset ⇒ `specimens`, so every existing run is unchanged. */
export function activeRecordSet(): RecordSetId {
  const raw = process.env.SPIKE_RECORD_SET;
  if (raw === undefined || raw === '') return 'specimens';
  if (raw === 'specimens' || raw === 'seed20') return raw;
  throw new Error(
    `SPIKE_RECORD_SET=${JSON.stringify(raw)} is not a record set; expected 'specimens' or 'seed20'.`,
  );
}

/** The active record set's rows, in the set's declared order. */
export function loadRecordSet(setId: RecordSetId = activeRecordSet()): RecordRow[] {
  return setId === 'seed20' ? seed20Set() : specimensSet();
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
  return setId === 'seed20'
    ? 'CONTRACT NOTE (N1) — `r<ruleId>` is not unique: each twinned rule shares one lessonHash across its per-language records'
    : 'CONTRACT NOTE (N1) — `r<ruleId>` is not unique: the pinned exemplar id is shared';
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

/**
 * The seed set's additions (G2): every glob any seed record declares gets at
 * least one MATCHING probe here, and the specimens list above already supplies
 * plenty of non-matching ones. Each record's own `inlineFilePath` is in the list
 * too, so the discriminating check (`src/lower.mts`) has an in-scope path for all
 * 22 rows — including the five that had none on the fixed list (`b9736096`,
 * `be74c55c`, `b237bcf3` and both `-js` twins).
 */
export const SEED20_EXTRA_PROBE_PATHS: readonly string[] = [
  // the 22 inline paths, so every record has at least one in-scope probe
  'packages/cli/src/adapters/loader.ts',
  'src/errors.ts',
  '.mcp.json',
  'packages/core/src/prompt.ts',
  'packages/cli/src/commands/issue.ts',
  'packages/core/src/emit-site.ts',
  'scripts/release.sh',
  'packages/cli/src/index.ts',
  'packages/cli/src/handlers/run.ts',
  'scripts/branches.js',
  'packages/core/src/branches.ts',
  'packages/core/src/log-site.ts',
  'scripts/cast.js',
  'packages/core/src/cast.ts',
  'packages/core/src/catch-site.ts',
  'scripts/color.sh',
  'packages/cli/src/assets/patterns.ts',
  'packages/cli/src/orchestrators/shell-orchestrator.test.ts',
  '.github/workflows/ci.yml',
  'docs/overview.md',
  'packages/core/src/exec-site.ts',
  // one matching path per remaining seed glob dialect
  'packages/web/src/App.tsx',
  'packages/web/src/App.jsx',
  'scripts/build.js',
  'tools/gen.py',
  'docs/notes.txt',
  'docs/guide.mdx',
  'docs/index.rst',
  'k8s/deploy.yaml',
  'scripts/lib.bash',
  'scripts/lib.zsh',
  'scripts/lib.ksh',
  'scripts/tool.mjs',
  'packages/cli/.mcp.json',
  '.gemini/settings.json',
  'mcp-servers.json',
  '.cursor/mcp.json',
  'apps/cli/src/main.ts',
];

/** The shared probe list for a record set. */
export function sharedProbePaths(setId: RecordSetId): readonly string[] {
  return setId === 'seed20'
    ? [...SPECIMEN_PROBE_PATHS, ...SEED20_EXTRA_PROBE_PATHS]
    : SPECIMEN_PROBE_PATHS;
}

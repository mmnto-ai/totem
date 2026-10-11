// ─── The serving writer: IO glue for `totem rule serve` (mmnto-ai/totem#3036) ──
//
// S6 step 2, B2. `totem rule serve <input.json>` lowers the records one input
// file names into `compiled-rules.json`, disposes of each floor rule's legacy row
// as the file says, archives the rows the file's `archive[]` names, refreshes the
// manifest and regenerates the agent exports. The decisions live in core's pure
// `planServingWrite`; this module reads everything, checks the writer's own
// invariant, and writes in a fixed order. A LIBRARY module (not a command), so it
// keeps static imports; the command wrapper `commands/rule-serve.ts` lazy-loads it.
//
// Every refusal fires before the first write. That includes an integrity check
// before planning (the serving file's hash must be the manifest's output_hash,
// else it was modified outside totem) and the preflight of every write: the
// records attestation and each export target rendered in memory with its
// sentinels checked. A changing run then writes the serving file, the manifest
// and every export target, in that order. A run whose plan changes no row writes
// nothing. The dry run reads everything, writes nothing and returns the same
// report a real run would.
//
// `--refresh` is the deliberate repair: it skips the integrity refusal and
// rewrites the manifest from the serving file as it is and every export, even
// when no row changes.
//
// Residual window: an IO error DURING the writes themselves (serving file, then
// manifest, then export targets) can leave a later step unwritten. `--refresh`
// is its repair.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assertServingInputSupported,
  attestRecordsHash,
  AUTHORING_LEDGER_DIR,
  AUTHORING_LEDGER_FILE,
  type CompiledRule,
  type CompileManifest,
  type ExportTargetResult,
  generateOutputHash,
  isRecordPathRule,
  isRecordsAttestationFresh,
  loadCompiledRulesFile,
  planServingWrite,
  readAllLessons,
  readAuthoringLedger,
  readCompileManifest,
  renderLessonExportsForRules,
  resolveGitRoot,
  safeExec,
  type ServingInput,
  ServingInputSchema,
  type ServingPlan,
  type ServingRecord,
  type ServingReport,
  TotemError,
  TotemParseError,
  writeCompileManifest,
  writeFileAtomicSync,
  writeRenderedExport,
} from '@mmnto/totem';

import { ingestRecord } from './authored-rule-intake.js';
import { loadConfig, resolveConfigPath } from './utils.js';

export interface ServingWriterOptions {
  /** The `serving-input/1` file, absolute or relative to the working directory. */
  inputPath: string;
  /** Read everything, write nothing, return the row-level report. */
  dryRun?: boolean;
  /**
   * The deliberate repair: skip the integrity refusal and rewrite the manifest
   * from the serving file as it is and regenerate every export, even when no
   * row changes.
   */
  refresh?: boolean;
}

export interface ServingWriterResult {
  report: ServingReport;
  /** True when this run wrote anything (never on a dry run). */
  written: boolean;
  dryRun: boolean;
  refresh: boolean;
  /**
   * What the run writes (on a dry run: would write). The serving file when the
   * plan changes a row; the manifest and every export target when the plan
   * changes a row or `--refresh` is passed; nothing otherwise.
   */
  writes: { servingFile: boolean; manifest: boolean; exports: string[] };
  /** The export targets written (on a dry run: that would be written). */
  exports: ExportTargetResult[];
  /** Informational lines (a no-change run never writes; these say what `--refresh` would repair). */
  notices: string[];
  /** The serving file, relative to the working directory. */
  rulesFile: string;
}

function serialize(row: unknown): string {
  return JSON.stringify(row, null, 2);
}

function inputInvalid(message: string, cause?: unknown): TotemError {
  return new TotemError(
    'SERVING_INPUT_INVALID',
    `${message}; nothing was written.`,
    'Fix the input file, then re-run.',
    cause,
  );
}

/**
 * Read and validate the input file (strict); returns it with the sha256 of its
 * text after CRLF to LF, so a CRLF checkout names the same run as an LF one (for
 * an LF file this equals the raw-bytes sha256).
 */
function readServingInput(
  inputAbs: string,
  inputRel: string,
): { input: ServingInput; sha256: string } {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(inputAbs);
  } catch (err) {
    throw inputInvalid(
      `The serving input ${inputRel} cannot be read (${(err as Error).message})`,
      err,
    );
  }
  const text = bytes.toString('utf-8').replace(/\r\n/g, '\n');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw inputInvalid(
      `The serving input ${inputRel} is not valid JSON (${(err as Error).message})`,
      err,
    );
  }
  const parsed = ServingInputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
      .join('; ');
    throw inputInvalid(
      `The serving input ${inputRel} is off its serving-input/1 schema: ${issues}`,
      parsed.error,
    );
  }
  return { input: parsed.data, sha256: createHash('sha256').update(text).digest('hex') };
}

const UNCOMMITTED_SHA = '0'.repeat(40);

/** The admission of one effective ledger row: its line, its commit, and that commit's instant. */
export interface LedgerAdmission {
  /** 1-based line of the effective row (the last line carrying its ruleId). */
  line: number;
  /** The commit that introduced the line; the all-zero hash when uncommitted. */
  commit: string;
  /** The commit's committer instant, ISO-8601 UTC; `null` when uncommitted. */
  admittedAt: string | null;
}

/**
 * Date each named rule's EFFECTIVE authoring-ledger row by the commit that
 * introduced its line: `git blame --line-porcelain -L <n>,<n>` from the
 * repository root, `committer-time` read as the admission instant
 * (`committer-tz` is the committer's offset and does not move the instant).
 *
 * The row's own `authoredAt` is not used: it is the author's declared date,
 * copied forward unchanged on a re-admission (mmnto-ai/totem#3045). A line git
 * attributes to the working tree (the all-zero hash) comes back with
 * `admittedAt: null`, which the planner refuses. Every git failure refuses
 * loudly with `GIT_FAILED`, never read as fresh: no repository, git absent, a
 * blame error, and a shallow clone (blame would date every line older than the
 * shallow boundary to the boundary commit). A rewrite of the ledger file
 * re-dates every row to the rewrite's commit; a regenerated floor is then owed.
 */
export function readLedgerAdmissions(
  totemDir: string,
  ruleIds: readonly string[],
): Map<string, LedgerAdmission> {
  const out = new Map<string, LedgerAdmission>();
  const ledgerPath = path.join(totemDir, AUTHORING_LEDGER_DIR, AUTHORING_LEDGER_FILE);
  const wanted = new Set(ruleIds);
  if (wanted.size === 0 || !fs.existsSync(ledgerPath)) return out;

  // The effective row is the LAST line per ruleId (foldEffectiveLedgerEntries).
  const lineOf = new Map<string, number>();
  fs.readFileSync(ledgerPath, 'utf-8')
    .split('\n')
    .forEach((text, i) => {
      if (text.trim().length === 0) return;
      const id = (JSON.parse(text) as { ruleId?: unknown }).ruleId;
      if (typeof id === 'string' && wanted.has(id)) lineOf.set(id, i + 1);
    });
  if (lineOf.size === 0) return out;

  const fail = (what: string, err?: unknown): TotemError =>
    new TotemError(
      'GIT_FAILED',
      `The floor records' admission instants cannot be dated: ${what}; nothing was written.`,
      'Run `totem rule serve` from a full (not shallow) git checkout of this repository with git on PATH; the admission instant of a floor record is the committer instant of the commit that introduced its ledger row.',
      err,
    );
  const message = (err: unknown): string =>
    err instanceof Error ? err.message.replace(/^\[Totem Error\]\s*/, '') : String(err);

  let root: string | null;
  try {
    root = resolveGitRoot(path.dirname(ledgerPath));
  } catch (err) {
    throw fail(`git could not resolve the repository (${message(err)})`, err);
  }
  if (root === null) {
    throw fail(`${ledgerPath} is not inside a git repository (not a git repository)`);
  }
  let shallow: string;
  try {
    shallow = safeExec('git', ['rev-parse', '--is-shallow-repository'], { cwd: root });
  } catch (err) {
    throw fail(`git rev-parse --is-shallow-repository failed (${message(err)})`, err);
  }
  if (shallow === 'true') {
    throw fail(
      'the repository is a shallow clone, so blame would date every line older than the shallow boundary to the boundary commit',
    );
  }

  const rel = path.relative(root, ledgerPath).split(path.sep).join('/');
  for (const [id, line] of lineOf) {
    let porcelain: string;
    try {
      porcelain = safeExec(
        'git',
        ['blame', '--line-porcelain', '-L', `${line},${line}`, '--', rel],
        {
          cwd: root,
        },
      );
    } catch (err) {
      throw fail(`git blame of ${rel} line ${line} (ruleId ${id}) failed (${message(err)})`, err);
    }
    const sha = /^([0-9a-f]{40}) /.exec(porcelain)?.[1];
    const time = /^committer-time (\d+)$/m.exec(porcelain)?.[1];
    if (sha === undefined || time === undefined) {
      throw fail(
        `git blame of ${rel} line ${line} (ruleId ${id}) returned no commit and committer-time`,
      );
    }
    out.set(id, {
      line,
      commit: sha,
      admittedAt: sha === UNCOMMITTED_SHA ? null : new Date(Number(time) * 1000).toISOString(),
    });
  }
  return out;
}

/**
 * The writer's own invariant: every row the plan does not touch is the SAME
 * object in the output and serializes exactly as it did before planning. A
 * failure is a bug in the planner, and it fires before any write.
 */
export function assertUntouchedRowsUnchanged(
  rows: readonly CompiledRule[],
  beforeTexts: readonly string[],
  plan: Pick<ServingPlan, 'rows' | 'report'>,
): void {
  const touched = new Set(plan.report.rows.map((r) => r.lessonHash));
  const output = new Set<CompiledRule>(plan.rows);
  rows.forEach((row, i) => {
    if (touched.has(row.lessonHash)) return;
    if (!output.has(row) || serialize(row) !== beforeTexts[i]) {
      throw new TotemError(
        'SERVING_INVARIANT_BROKEN',
        `The serving plan changed row ${row.lessonHash}, which it does not touch (its serialized text differs after planning, or it is missing from the result); nothing was written.`,
        'This is a bug in the serving writer; report it with the input file. The serving file, the manifest and the exports are as they were.',
      );
    }
  });
}

/**
 * Run the serving writer. Reads the config the way `totem rule promote` does
 * (`process.cwd()`, `loadConfig(resolveConfigPath(cwd))`).
 */
export async function runServingWriter(opts: ServingWriterOptions): Promise<ServingWriterResult> {
  const cwd = process.cwd();
  const config = await loadConfig(resolveConfigPath(cwd));
  const totemDir = path.join(cwd, config.totemDir);
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const manifestPath = path.join(totemDir, 'compile-manifest.json');
  const rulesRel = path.relative(cwd, rulesPath);
  const manifestRel = path.relative(cwd, manifestPath);
  const dryRun = opts.dryRun === true;
  const refresh = opts.refresh === true;

  // ── 1. The input ──
  const inputAbs = path.resolve(cwd, opts.inputPath);
  const { input, sha256: inputSha256 } = readServingInput(inputAbs, opts.inputPath);
  assertServingInputSupported(input);

  // ── 2. The serving file: validated by the loader, then read as PLAIN rows ──
  if (!fs.existsSync(rulesPath)) {
    throw new TotemParseError(
      `The serving file ${rulesRel} does not exist; nothing was written.`,
      'Run `totem lesson compile` to create it, or restore it from git, then re-run.',
    );
  }
  // The loader turns a read or JSON-parse failure into an `onWarn` call and an
  // EMPTY rule set; refuse it here (as the compile guard does) so an unreadable
  // file is never planned over. A schema failure throws from the loader itself.
  loadCompiledRulesFile(rulesPath, (detail) => {
    const cause = detail.replace(/^Could not load compiled rules:\s*/, '');
    throw new TotemParseError(
      `The serving file ${rulesRel} cannot be read or parsed as JSON (${cause}); nothing was written.`,
      `Repair ${rulesRel} first: resolve the merge conflict if there is one, otherwise restore it from git (\`git checkout -- ${rulesRel}\`), then re-run.`,
    );
  });
  // Plain objects, never re-shaped through the schema: untouched rows keep their bytes.
  const file = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as Record<string, unknown> & {
    rules: CompiledRule[];
  };
  const rows = file.rules;

  // ── 3. The ledger and the floor records (the intake's own content hash) ──
  const ledger = readAuthoringLedger(totemDir);
  // The admission instant of each floor record: the committer instant of the
  // commit that introduced its effective ledger row (git blame; mmnto-ai/totem#3045).
  const admissions = readLedgerAdmissions(
    totemDir,
    input.floor.flatMap((e) => e.records.map((r) => r.ruleId)),
  );
  const records: ServingRecord[] = [];
  for (const entry of input.floor) {
    for (const ref of entry.records) {
      let ingested;
      try {
        ingested = ingestRecord(totemDir, ref.path);
      } catch (err) {
        if (
          err instanceof TotemError &&
          (err.code === 'CONFIG_MISSING' || err.code === 'CONFIG_INVALID')
        ) {
          throw new TotemError(
            'SERVING_INPUT_INVALID',
            `Floor record ${ref.path} (ruleId ${ref.ruleId}) cannot be ingested: ${err.message.replace(/^\[Totem Error\]\s*/, '')}; nothing was written.`,
            'Fix the record path in the input file (the form is `<totemDir>/rules/<name>.rule.yaml`), or restore the record, then re-run.',
            err,
          );
        }
        throw err;
      }
      records.push({
        path: ref.path,
        ruleId: ref.ruleId,
        contentHash: ingested.contentHash,
        parsed: ingested.parsed,
        // A record with no ledger row has no admission; the planner refuses
        // it on the missing row first.
        admittedCommit: admissions.get(ref.ruleId)?.commit ?? UNCOMMITTED_SHA,
        admittedAt: admissions.get(ref.ruleId)?.admittedAt ?? null,
      });
    }
  }

  // ── 4. Preflight the manifest before anything is planned or written ──
  let manifest: CompileManifest;
  try {
    manifest = readCompileManifest(manifestPath);
  } catch (err) {
    if (!(err instanceof TotemParseError)) throw err;
    const recordManaged = rows.some(isRecordPathRule);
    throw new TotemParseError(
      `${err.message.replace(/^\[Totem Error\]\s*/, '')} (${manifestRel}); nothing was written.`,
      recordManaged
        ? `${rulesRel} holds record-managed rows, so a lesson compile is not the repair: restore ${manifestRel} from git (\`git checkout -- ${manifestRel}\`), then re-run.`
        : `${rulesRel} holds no record-managed rows yet: run \`totem lesson compile\` to regenerate ${manifestRel}, then re-run.`,
      err,
    );
  }

  // ── 5. Integrity: the serving file must be the one its manifest attests ──
  // A file whose hash is not the manifest's output_hash changed after the
  // manifest was written: by a hand edit, or by a totem verb that rewrites rules
  // without refreshing the manifest (doctor's stale-rule archive, a pack
  // install, the first-lint promotion). Planning over it would carry the change
  // into a fresh manifest and launder it past verify-manifest, so refuse unless
  // the operator asks for the deliberate repair (`--refresh`).
  if (!refresh && manifest.output_hash !== generateOutputHash(rulesPath)) {
    throw new TotemError(
      'SERVING_MANIFEST_STALE',
      `The serving file ${rulesRel} does not match its manifest ${manifestRel} (its hash is not the manifest's output_hash): the file changed after the manifest was written, by a hand edit or by a totem verb that rewrites rules without refreshing the manifest; nothing was written.`,
      `If the change is meant to stay, run one of the two deliberate repairs: \`totem rule serve ${opts.inputPath} --refresh\`, or \`totem lesson compile --refresh-manifest --allow-record-rows\`. If it is not meant, restore ${rulesRel} from git.`,
    );
  }

  // ── 6. Plan, then the writer's own invariant ──
  const beforeTexts = rows.map(serialize);
  const plan = planServingWrite({ rows, ledger, records, input, inputSha256 });
  assertUntouchedRowsUnchanged(rows, beforeTexts, plan);

  // A changing run writes the serving file, the manifest and EVERY export
  // target (as `lesson compile --export` and `lesson archive` do). A no-change
  // run writes nothing and compares no export; `--refresh` forces the manifest
  // and every export even then.
  const writeManifestAndExports = plan.changed || refresh;
  const notices: string[] = [];
  if (
    !writeManifestAndExports &&
    !isRecordsAttestationFresh(manifest.records_hash, totemDir, cwd)
  ) {
    notices.push(
      `The manifest's records_hash is not the current records attestation; run \`totem rule serve ${opts.inputPath} --refresh\` to rewrite it (nothing was written).`,
    );
  }

  // ── 7. Preflight every write before the first one ──
  // The records attestation reads every tracked record and can throw; every
  // export target is rendered in memory, its sentinels checked against its
  // current text. A failure here refuses with nothing written.
  const recordsHash = writeManifestAndExports ? attestRecordsHash(totemDir, cwd) : undefined;
  const rendered =
    writeManifestAndExports && config.exports && Object.keys(config.exports).length > 0
      ? renderLessonExportsForRules(readAllLessons(totemDir), plan.rows, config.exports, cwd)
      : [];

  const result: ServingWriterResult = {
    report: plan.report,
    written: false,
    dryRun,
    refresh,
    writes: {
      servingFile: plan.changed,
      manifest: writeManifestAndExports,
      exports: rendered.map((r) => r.filePath),
    },
    exports: rendered.map(({ name, filePath, count }) => ({ name, filePath, count })),
    notices,
    rulesFile: rulesRel,
  };
  if (dryRun || !writeManifestAndExports) return result;

  // ── 8. Write: the serving file, then the manifest, then every export ──
  // Residual window: an IO error DURING these writes (a full disk, a rename
  // refused over a locked target) can still leave a later step unwritten. The
  // repair is the deliberate `--refresh`, which rewrites the manifest from the
  // serving file as it is and regenerates every export.
  if (plan.changed) {
    writeFileAtomicSync(rulesPath, JSON.stringify({ ...file, rules: plan.rows }, null, 2) + '\n');
  }
  writeCompileManifest(manifestPath, {
    ...manifest,
    compiled_at: input.asOf,
    output_hash: generateOutputHash(rulesPath),
    // Computed in the preflight above whenever this write runs.
    records_hash: recordsHash ?? attestRecordsHash(totemDir, cwd),
    // The full compile's rule: every row in the file, archived rows included.
    rule_count: plan.rows.length,
  });
  for (const r of rendered) writeRenderedExport(r);
  result.written = true;
  return result;
}

/** The human-readable report, one line per entry (the command prints it to stderr). */
export function formatServingReport(result: ServingWriterResult): string[] {
  const r = result.report;
  const t = r.totals;
  const keptLegacy = t['floor-legacy'] - r.removed;
  const lines = [
    `input sha256 ${r.inputSha256} (of its text after CRLF to LF), asOf ${r.asOf}, legacyRow ${r.legacyRow}`,
    `serving file ${result.rulesFile}: ${r.rowsBefore} rows before, ${r.rowsAfter} after`,
    `classes: floor-legacy ${t['floor-legacy']}, lowered ${t.lowered}, archive ${t.archive}, already-archived ${t['already-archived']}, carried ${t.carried}`,
    `  before ${r.rowsBefore} = carried ${t.carried} + archive ${t.archive} + already-archived ${t['already-archived']} + floor-legacy ${t['floor-legacy']} + lowered already present ${r.loweredExisting}`,
    `  after ${r.rowsAfter} = carried ${t.carried} + archive ${t.archive} + already-archived ${t['already-archived']} + floor-legacy kept ${keptLegacy} + lowered ${t.lowered}`,
    `active ${r.active.before} -> ${r.active.after}, archived ${r.archived.before} -> ${r.archived.after}`,
    `blocking ${r.blocking.before.length} -> ${r.blocking.after.length}`,
    `  before: ${r.blocking.before.join(', ') || '(none)'}`,
    `  after: ${r.blocking.after.join(', ') || '(none)'}`,
    'rows:',
  ];
  for (const row of r.rows) {
    const ids = [
      row.legacyHash !== undefined && row.legacyHash !== row.lessonHash
        ? `legacy ${row.legacyHash}`
        : '',
      row.ruleId !== undefined && row.ruleId !== row.lessonHash ? `records ${row.ruleId}` : '',
      row.recordPath ?? '',
      row.changedFields !== undefined ? `fields ${row.changedFields.join(', ')}` : '',
    ]
      .filter((s) => s !== '')
      .join(', ');
    lines.push(`  ${row.class} ${row.action} ${row.lessonHash}${ids ? ` (${ids})` : ''}`);
  }
  const w = result.writes;
  const targets: string[] = [];
  if (w.servingFile) targets.push(result.rulesFile);
  if (w.manifest) targets.push('the manifest');
  for (const e of result.exports) targets.push(`${e.filePath} (${e.name}, ${e.count} lessons)`);
  const how = !w.servingFile && result.refresh ? ' (--refresh; no row changed)' : '';
  for (const n of result.notices) lines.push(n);
  if (targets.length === 0) {
    lines.push(
      result.dryRun
        ? 'DRY RUN: no row changes; nothing would be written.'
        : 'No row changes; nothing was written.',
    );
  } else if (result.dryRun) {
    lines.push(`DRY RUN: would write ${targets.join(', ')}${how}; nothing was written.`);
  } else {
    lines.push(`Wrote ${targets.join(', ')}${how}.`);
  }
  return lines;
}

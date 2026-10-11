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
// Every refusal fires before the first write. The dry run reads everything,
// writes nothing and returns the same report a real run would.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  assertServingInputSupported,
  attestRecordsHash,
  type CompiledRule,
  type CompileManifest,
  exportLessonsForRules,
  type ExportTargetResult,
  generateOutputHash,
  isRecordPathRule,
  loadCompiledRulesFile,
  planServingWrite,
  readAllLessons,
  readAuthoringLedger,
  readCompileManifest,
  type ServingInput,
  ServingInputSchema,
  type ServingPlan,
  type ServingRecord,
  type ServingReport,
  TotemError,
  TotemParseError,
  writeCompileManifest,
  writeFileAtomicSync,
} from '@mmnto/totem';

import { ingestRecord } from './authored-rule-intake.js';
import { loadConfig, resolveConfigPath } from './utils.js';

export interface ServingWriterOptions {
  /** The `serving-input/1` file, absolute or relative to the working directory. */
  inputPath: string;
  /** Read everything, write nothing, return the row-level report. */
  dryRun?: boolean;
}

export interface ServingWriterResult {
  report: ServingReport;
  /** True only when the serving file, the manifest and the exports were written. */
  written: boolean;
  dryRun: boolean;
  /** The export targets regenerated (empty when nothing was written or none is configured). */
  exports: ExportTargetResult[];
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

/** Read and validate the input file (strict); returns it with the sha256 of its bytes. */
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
  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf-8'));
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
  return { input: parsed.data, sha256: createHash('sha256').update(bytes).digest('hex') };
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

  // ── 5. Plan, then the writer's own invariant ──
  const beforeTexts = rows.map(serialize);
  const plan = planServingWrite({ rows, ledger, records, input, inputSha256 });
  assertUntouchedRowsUnchanged(rows, beforeTexts, plan);

  const result: ServingWriterResult = {
    report: plan.report,
    written: false,
    dryRun,
    exports: [],
    rulesFile: rulesRel,
  };
  if (dryRun || !plan.changed) return result;

  // ── 6. Write: the serving file, then the manifest, then the exports ──
  writeFileAtomicSync(rulesPath, JSON.stringify({ ...file, rules: plan.rows }, null, 2) + '\n');
  writeCompileManifest(manifestPath, {
    ...manifest,
    compiled_at: input.asOf,
    output_hash: generateOutputHash(rulesPath),
    records_hash: attestRecordsHash(totemDir, cwd),
    // The full compile's rule: every row in the file, archived rows included.
    rule_count: plan.rows.length,
  });
  if (config.exports && Object.keys(config.exports).length > 0) {
    result.exports = exportLessonsForRules(
      readAllLessons(totemDir),
      plan.rows,
      config.exports,
      cwd,
    );
  }
  result.written = true;
  return result;
}

/** The human-readable report, one line per entry (the command prints it to stderr). */
export function formatServingReport(result: ServingWriterResult): string[] {
  const r = result.report;
  const t = r.totals;
  const keptLegacy = t['floor-legacy'] - r.removed;
  const lines = [
    `input sha256 ${r.inputSha256}, asOf ${r.asOf}, legacyRow ${r.legacyRow}`,
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
    ]
      .filter((s) => s !== '')
      .join(', ');
    lines.push(`  ${row.class} ${row.action} ${row.lessonHash}${ids ? ` (${ids})` : ''}`);
  }
  if (result.dryRun) {
    lines.push(
      r.changed
        ? 'DRY RUN: nothing was written.'
        : 'DRY RUN: no change to write; nothing was written.',
    );
  } else if (!result.written) {
    lines.push('No change: the serving file already matches the input; nothing was written.');
  } else {
    const exported = result.exports
      .map((e) => `${e.filePath} (${e.name}, ${e.count} lessons)`)
      .join(', ');
    lines.push(
      `Wrote ${result.rulesFile}, refreshed the manifest${exported ? `, regenerated ${exported}` : ''}.`,
    );
  }
  return lines;
}

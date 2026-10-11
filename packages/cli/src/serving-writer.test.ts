import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import type { CompiledRule, ServingPlan } from '@mmnto/totem';
import {
  attestRecordsHash,
  compileRuleRecord,
  generateInputHash,
  generateOutputHash,
  hashLesson,
  parseRuleRecord,
  ServingInputSchema,
} from '@mmnto/totem';

import { verifyManifestCommand } from './commands/verify-manifest.js';
import { assertUntouchedRowsUnchanged, runServingWriter } from './serving-writer.js';
import { cleanTmpDir } from './test-utils.js';

// ─── The serving writer, end to end (B2 of mmnto-ai/totem#3036, S6 step 2) ───
//
// `totem rule serve <input.json>` lowers the records an input file names into
// compiled-rules.json, disposes of their legacy rows as the file says, archives
// the rows its archive[] names, refreshes the manifest and regenerates the
// exports. Every refusal fires before any write. The dry run writes nothing.

const AS_OF = '2026-10-10T02:18:13.000Z';
const RULE_A = '1111111111111111';
const RULE_N = '4444444444444444';

const LESSON_A = { heading: 'Avoid execSync', body: 'Use execFileSync, never execSync.' };
const LESSON_C = { heading: 'An old discard', body: 'A lesson the curation discarded.' };
const LESSON_E = { heading: 'A carried lesson', body: 'A lesson nothing touches.' };

const HASH_A = hashLesson(LESSON_A.heading, LESSON_A.body);
const HASH_C = hashLesson(LESSON_C.heading, LESSON_C.body);
const HASH_E = hashLesson(LESSON_E.heading, LESSON_E.body);
const HASH_D = 'dddddddddddddddd';

function lessonMarkdown(l: { heading: string; body: string }): string {
  return `## Lesson — ${l.heading}\n\n**Tags:** test\n\n${l.body}\n`;
}

function recordA(sourceLesson = `lesson-${HASH_A}`, severity = 'error'): string {
  return yamlStringify({
    schemaVersion: 1,
    severity,
    message: 'Use execFileSync instead of execSync',
    target: {
      type: 'ast-grep',
      language: 'typescript',
      pattern: 'execSync($$$ARGS)',
      scope: { fileGlobs: ['**/*.ts'] },
    },
    examples: [{ bad: "execSync('git status');", good: "execFileSync('git', ['status']);" }],
    curation: { sourceLesson },
  });
}

function recordN(sourceLesson?: string): string {
  return yamlStringify({
    schemaVersion: 1,
    severity: 'warning',
    message: 'A new regex rule',
    target: { type: 'regex', pattern: 'forbiddenCall', scope: { fileGlobs: ['**/*.ts'] } },
    examples: [{ bad: 'forbiddenCall();', good: 'allowedCall();' }],
    ...(sourceLesson !== undefined ? { curation: { sourceLesson } } : {}),
  });
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function ledgerLine(
  ruleId: string,
  recPath: string,
  text: string,
  authoredAt = '2026-09-23',
): string {
  return JSON.stringify({
    author: 'test-author',
    authoredAfterSplit: true,
    authoredAt,
    contentHash: `material-${ruleId}`,
    declaredEngine: 'ast-grep',
    heldOutNonInspectionAttestation: true,
    origin: { kind: 'from-scratch' },
    positiveFixturePrs: [1],
    record: { contentHash: sha256(text), path: recPath },
    ruleId,
    splitRef: 'test-split',
    structuralEligibility: {
      basis: 'whitelist:forbidden-callee-call',
      decidable: true,
      judgedBy: 'test-judge',
    },
    targetDefect: `defect ${ruleId}`,
  });
}

function legacyRow(
  lessonHash: string,
  heading: string,
  extra: Partial<CompiledRule> = {},
): CompiledRule {
  return {
    lessonHash,
    lessonHeading: heading,
    pattern: 'dummy-never-matches',
    message: heading,
    engine: 'regex',
    compiledAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

interface Workspace {
  root: string;
  totemDir: string;
  rulesPath: string;
  manifestPath: string;
  exportPath: string;
  ledgerPath: string;
  inputPath: string;
  recordAPath: string;
  input: Record<string, unknown>;
}

const REC_A_REF = '.totem/rules/a.rule.yaml';
const REC_N_REF = '.totem/rules/n.rule.yaml';

function writeInput(ws: Workspace, input: unknown): void {
  fs.writeFileSync(ws.inputPath, JSON.stringify(input, null, 2) + '\n', 'utf-8');
}

/**
 * A workspace with three lessons, a serving file of four rows (one in a
 * non-schema key order, one already archived), two records with their ledger
 * rows, a manifest that verifies, and one export target.
 */
function setupWorkspace(
  root: string,
  legacyDisposition: 'archive' | 'remove' = 'archive',
): Workspace {
  fs.writeFileSync(
    path.join(root, 'totem.config.ts'),
    [
      'export default {',
      '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
      '  totemDir: ".totem",',
      '  exports: { agents: "EXPORTED.md" },',
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );
  const totemDir = path.join(root, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  fs.writeFileSync(path.join(lessonsDir, 'a.md'), lessonMarkdown(LESSON_A), 'utf-8');
  fs.writeFileSync(path.join(lessonsDir, 'c.md'), lessonMarkdown(LESSON_C), 'utf-8');
  fs.writeFileSync(path.join(lessonsDir, 'e.md'), lessonMarkdown(LESSON_E), 'utf-8');

  const rulesDir = path.join(totemDir, 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  const textA = recordA();
  const textN = recordN();
  fs.writeFileSync(path.join(rulesDir, 'a.rule.yaml'), textA, 'utf-8');
  fs.writeFileSync(path.join(rulesDir, 'n.rule.yaml'), textN, 'utf-8');

  const spineDir = path.join(totemDir, 'spine');
  fs.mkdirSync(spineDir, { recursive: true });
  const ledgerPath = path.join(spineDir, 'authoring-ledger.ndjson');
  fs.writeFileSync(
    ledgerPath,
    ledgerLine(RULE_A, REC_A_REF, textA) + '\n' + ledgerLine(RULE_N, REC_N_REF, textN) + '\n',
    'utf-8',
  );

  // A row whose keys are deliberately NOT in schema order.
  const oddOrder = {
    message: LESSON_E.heading,
    lessonHash: HASH_E,
    engine: 'regex',
    lessonHeading: LESSON_E.heading,
    pattern: 'carried-never-matches',
    compiledAt: '2026-01-01T00:00:00Z',
  };
  const rows = [
    legacyRow(HASH_A, LESSON_A.heading),
    oddOrder,
    legacyRow(HASH_C, LESSON_C.heading),
    legacyRow(HASH_D, 'Archived already', {
      status: 'archived',
      archivedReason: 'Stage 4 silenced it',
      archivedAt: '2026-02-02T00:00:00Z',
    }),
  ];
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  fs.writeFileSync(
    rulesPath,
    JSON.stringify({ version: 1, rules: rows, nonCompilable: [] }, null, 2) + '\n',
    'utf-8',
  );

  const manifestPath = path.join(totemDir, 'compile-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        compiled_at: '2026-01-01T00:00:00.000Z',
        model: 'test-model',
        input_hash: generateInputHash(lessonsDir, root),
        output_hash: generateOutputHash(rulesPath),
        rule_count: rows.length,
        records_hash: attestRecordsHash(totemDir, root),
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  const input = {
    schema: 'serving-input/1',
    asOf: AS_OF,
    source: 'a test fixture',
    dispositions: { legacyRow: legacyDisposition, stamp: 'none' },
    floor: [
      { legacyHash: HASH_A, records: [{ path: REC_A_REF, ruleId: RULE_A }] },
      { records: [{ path: REC_N_REF, ruleId: RULE_N }] },
    ],
    archive: [
      { lessonHash: HASH_C, reason: 'no-intent', ref: 'curation row 7' },
      { lessonHash: HASH_D, reason: 'no-intent', ref: 'curation row 8' },
    ],
  };
  const ws: Workspace = {
    root,
    totemDir,
    rulesPath,
    manifestPath,
    exportPath: path.join(root, 'EXPORTED.md'),
    ledgerPath,
    inputPath: path.join(root, 'serve-input.json'),
    recordAPath: path.join(rulesDir, 'a.rule.yaml'),
    input,
  };
  writeInput(ws, input);
  return ws;
}

interface Snapshot {
  rules: Buffer | null;
  rulesMtime: number | null;
  manifest: Buffer | null;
  manifestMtime: number | null;
  exports: Buffer | null;
}

function backdate(ws: Workspace): void {
  const past = new Date('2026-01-01T00:00:00Z');
  for (const p of [ws.rulesPath, ws.manifestPath, ws.exportPath]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.utimesSync(p, past, past);
  }
}

function readOrNull(p: string): Buffer | null {
  return fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
}

function mtimeOrNull(p: string): number | null {
  return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
}

function snapshot(ws: Workspace): Snapshot {
  return {
    rules: readOrNull(ws.rulesPath),
    rulesMtime: mtimeOrNull(ws.rulesPath),
    manifest: readOrNull(ws.manifestPath),
    manifestMtime: mtimeOrNull(ws.manifestPath),
    exports: readOrNull(ws.exportPath),
  };
}

function expectUnchanged(ws: Workspace, before: Snapshot): void {
  const after = snapshot(ws);
  expect(after.rules?.equals(before.rules!) ?? before.rules === null).toBe(true);
  expect(after.rulesMtime).toBe(before.rulesMtime);
  expect(after.manifest?.equals(before.manifest!) ?? before.manifest === null).toBe(true);
  expect(after.manifestMtime).toBe(before.manifestMtime);
  expect(after.exports?.equals(before.exports!) ?? before.exports === null).toBe(true);
  // No stray atomic-write temp file beside the serving file.
  expect(fs.readdirSync(ws.totemDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
}

function readRows(ws: Workspace): Array<Record<string, unknown>> {
  return (
    JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as { rules: Array<Record<string, unknown>> }
  ).rules;
}

describe('runServingWriter (mmnto-ai/totem#3036 B2)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-serving-writer-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    // Config resolution must never reach the real home directory.
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllEnvs();
  });

  it('lowers a record into a row that deep-equals compileRuleRecord at asOf, with the ruleId as lessonHash', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    const rows = readRows(ws);
    const row = rows.find((r) => r['lessonHash'] === RULE_A);
    const expected = compileRuleRecord(parseRuleRecord(recordA(), REC_A_REF), {
      ruleId: RULE_A,
      now: AS_OF,
    });
    expect(expected.kind).toBe('compiled');
    expect(row).toEqual(JSON.parse(JSON.stringify((expected as { rule: unknown }).rule)));
  });

  it('keeps every untouched row byte-identical, including one in a non-schema key order, and the file round-trips', async () => {
    const ws = setupWorkspace(tmpDir);
    const before = readRows(ws);
    await runServingWriter({ inputPath: ws.inputPath });
    const text = fs.readFileSync(ws.rulesPath, 'utf-8');
    expect(JSON.stringify(JSON.parse(text), null, 2) + '\n').toBe(text);
    const after = readRows(ws);
    for (const hash of [HASH_E, HASH_D]) {
      const b = before.find((r) => r['lessonHash'] === hash)!;
      const a = after.find((r) => r['lessonHash'] === hash)!;
      expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
      expect(Object.keys(a)).toEqual(Object.keys(b));
    }
    expect(Object.keys(after.find((r) => r['lessonHash'] === HASH_E)!)[0]).toBe('message');
  });

  it('places rows as the disposition says: archive keeps the legacy row, remove replaces it', async () => {
    const ws = setupWorkspace(tmpDir, 'archive');
    await runServingWriter({ inputPath: ws.inputPath });
    expect(readRows(ws).map((r) => r['lessonHash'])).toEqual([
      HASH_A,
      RULE_A,
      HASH_E,
      HASH_C,
      HASH_D,
      RULE_N,
    ]);
    expect(readRows(ws)[0]).toMatchObject({
      status: 'archived',
      archivedReason: `served by record ${RULE_A}`,
      archivedAt: AS_OF,
    });

    const ws2 = setupWorkspace(fs.mkdtempSync(path.join(tmpDir, 'remove-')), 'remove');
    process.chdir(ws2.root);
    await runServingWriter({ inputPath: ws2.inputPath });
    expect(readRows(ws2).map((r) => r['lessonHash'])).toEqual([
      RULE_A,
      HASH_E,
      HASH_C,
      HASH_D,
      RULE_N,
    ]);
  });

  it('a second run with the same input reports no change and writes nothing', async () => {
    const ws = setupWorkspace(tmpDir);
    const first = await runServingWriter({ inputPath: ws.inputPath });
    expect(first.written).toBe(true);
    backdate(ws);
    const before = snapshot(ws);
    const second = await runServingWriter({ inputPath: ws.inputPath });
    expect(second.written).toBe(false);
    expect(second.report.changed).toBe(false);
    expectUnchanged(ws, before);
  });

  it('the dry run changes no file and reports the same counts and blocking sets a real run does', async () => {
    const ws = setupWorkspace(tmpDir);
    backdate(ws);
    const before = snapshot(ws);
    const dry = await runServingWriter({ inputPath: ws.inputPath, dryRun: true });
    expect(dry.written).toBe(false);
    expect(dry.dryRun).toBe(true);
    expectUnchanged(ws, before);

    const real = await runServingWriter({ inputPath: ws.inputPath });
    expect(real.written).toBe(true);
    for (const key of [
      'totals',
      'active',
      'archived',
      'blocking',
      'rowsBefore',
      'rowsAfter',
      'rows',
    ] as const) {
      expect(dry.report[key]).toEqual(real.report[key]);
    }
    // The ast-grep record at error joins the blocking set; the regex one does not.
    expect(real.report.blocking.before).toEqual([]);
    expect(real.report.blocking.after).toEqual([RULE_A]);
  });

  it('leaves a manifest that verifies with no further step', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    const manifest = JSON.parse(fs.readFileSync(ws.manifestPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(manifest['compiled_at']).toBe(AS_OF);
    expect(manifest['model']).toBe('test-model');
    expect(manifest['rule_count']).toBe(6);
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
  });

  it('regenerates the exports with the floor legacy row shown archived with the served-by-record reason', async () => {
    const ws = setupWorkspace(tmpDir);
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.exports).toEqual([{ name: 'agents', filePath: 'EXPORTED.md', count: 3 }]);
    const text = fs.readFileSync(ws.exportPath, 'utf-8');
    expect(text).toContain(`_(archived: served by record ${RULE_A})_`);
    expect(text).toContain('_(archived: no-intent (curation row 7))_');
  });

  it('a no-change run with a stale manifest refreshes only the manifest (falsification fold F1b)', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    const manifest = JSON.parse(fs.readFileSync(ws.manifestPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    fs.writeFileSync(
      ws.manifestPath,
      JSON.stringify({ ...manifest, output_hash: 'stale' }, null, 2) + '\n',
      'utf-8',
    );
    backdate(ws);
    const before = snapshot(ws);
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.report.changed).toBe(false);
    expect(result.written).toBe(true);
    expect(result.writes).toEqual({ servingFile: false, manifest: true, exports: [] });
    const after = snapshot(ws);
    expect(after.rules!.equals(before.rules!)).toBe(true);
    expect(after.rulesMtime).toBe(before.rulesMtime);
    expect(after.exports!.equals(before.exports!)).toBe(true);
    expect(fs.statSync(ws.exportPath).mtimeMs).toBe(new Date('2026-01-01T00:00:00Z').getTime());
    expect(after.manifest!.equals(before.manifest!)).toBe(false);
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
    // And the next run finds everything fresh.
    expect((await runServingWriter({ inputPath: ws.inputPath })).written).toBe(false);
  });

  it('a no-change run with a stale export regenerates only that export (falsification fold F1b)', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    const good = fs.readFileSync(ws.exportPath, 'utf-8');
    fs.writeFileSync(ws.exportPath, 'stale export\n', 'utf-8');
    backdate(ws);
    const before = snapshot(ws);
    const dry = await runServingWriter({ inputPath: ws.inputPath, dryRun: true });
    expect(dry.writes).toEqual({ servingFile: false, manifest: false, exports: ['EXPORTED.md'] });
    expectUnchanged(ws, before);
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.writes).toEqual({
      servingFile: false,
      manifest: false,
      exports: ['EXPORTED.md'],
    });
    const after = snapshot(ws);
    expect(after.rules!.equals(before.rules!)).toBe(true);
    expect(after.rulesMtime).toBe(before.rulesMtime);
    expect(after.manifest!.equals(before.manifest!)).toBe(true);
    expect(after.manifestMtime).toBe(before.manifestMtime);
    // A target with no sentinels gets the block appended, as exportLessons does.
    expect(fs.readFileSync(ws.exportPath, 'utf-8')).toBe(
      'stale export\n\n' + good.replace(/\n$/, '') + '\n',
    );
    expect((await runServingWriter({ inputPath: ws.inputPath })).written).toBe(false);
  });

  it('names a CRLF copy of the input by the same sha256 as the LF original (falsification fold F11)', async () => {
    const ws = setupWorkspace(tmpDir);
    const lfText = fs.readFileSync(ws.inputPath, 'utf-8');
    const lf = await runServingWriter({ inputPath: ws.inputPath, dryRun: true });
    expect(lf.report.inputSha256).toBe(sha256(lfText));
    fs.writeFileSync(ws.inputPath, lfText.replace(/\n/g, '\r\n'), 'utf-8');
    const crlf = await runServingWriter({ inputPath: ws.inputPath, dryRun: true });
    expect(crlf.report.inputSha256).toBe(lf.report.inputSha256);
  });
});

describe('runServingWriter refusals: each fires before any write (mmnto-ai/totem#3036 B2)', () => {
  let tmpDir: string;
  let originalCwd: string;
  let ws: Workspace;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-serving-refuse-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
    ws = setupWorkspace(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllEnvs();
  });

  async function expectRefusal(code: string, text: string | RegExp, hint?: string): Promise<void> {
    backdate(ws);
    const before = snapshot(ws);
    await expect(runServingWriter({ inputPath: ws.inputPath })).rejects.toMatchObject({
      code,
      message:
        typeof text === 'string' ? expect.stringContaining(text) : expect.stringMatching(text),
      ...(hint !== undefined ? { recoveryHint: expect.stringContaining(hint) } : {}),
    });
    expectUnchanged(ws, before);
  }

  it('refuses a missing serving file', async () => {
    fs.rmSync(ws.rulesPath);
    await expectRefusal('PARSE_FAILED', 'does not exist');
  });

  it('refuses a missing manifest of a file with record rows, naming the git restore and not the lesson compile', async () => {
    // A first real run makes the file record-managed.
    await runServingWriter({ inputPath: ws.inputPath });
    fs.rmSync(ws.manifestPath);
    await expectRefusal(
      'PARSE_FAILED',
      'compile-manifest.json',
      'holds record-managed rows, so a lesson compile is not the repair',
    );
  });

  it('refuses an export target with an unmatched sentinel before ANY write (falsification fold F1a)', async () => {
    fs.writeFileSync(
      ws.exportPath,
      '# Hand-written\n\n<!-- totem:generated:start -->\nstale block, no end marker\n',
      'utf-8',
    );
    await expectRefusal('PARSE_FAILED', /Export target EXPORTED\.md \(agents\).*without matching/);
  });

  it('refuses a missing input file', async () => {
    fs.rmSync(ws.inputPath);
    await expectRefusal('SERVING_INPUT_INVALID', 'serve-input.json');
  });

  it('refuses an unparsable input file', async () => {
    fs.writeFileSync(ws.inputPath, '{ not json', 'utf-8');
    await expectRefusal('SERVING_INPUT_INVALID', 'not valid JSON');
  });

  it('refuses an unknown key in the input', async () => {
    writeInput(ws, { ...ws.input, extra: true });
    await expectRefusal('SERVING_INPUT_INVALID', 'extra');
  });

  it('refuses an input with a disposition absent', async () => {
    writeInput(ws, { ...ws.input, dispositions: { legacyRow: 'archive' } });
    await expectRefusal('SERVING_INPUT_INVALID', 'stamp');
  });

  it('refuses stamp: advisory (the mode waits on the ADR-110 reading)', async () => {
    writeInput(ws, { ...ws.input, dispositions: { legacyRow: 'archive', stamp: 'advisory' } });
    await expectRefusal('SERVING_INPUT_INVALID', 'advisory');
  });

  it('refuses an unparsable serving file through the loader onWarn (PARSE_FAILED)', async () => {
    fs.writeFileSync(ws.rulesPath, '<<<<<<< HEAD\n{}', 'utf-8');
    await expectRefusal('PARSE_FAILED', 'compiled-rules.json');
  });

  it('refuses a serving file that fails its schema', async () => {
    fs.writeFileSync(
      ws.rulesPath,
      JSON.stringify({ version: 1, rules: [{ lessonHash: 1 }] }),
      'utf-8',
    );
    await expectRefusal('PARSE_FAILED', 'Invalid compiled-rules.json');
  });

  it('refuses a serving file with two rows for one lessonHash', async () => {
    const file = JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as { rules: unknown[] };
    file.rules.push(legacyRow(HASH_E, 'dup'));
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    await expectRefusal('PARSE_FAILED', HASH_E);
  });

  it('refuses a missing manifest, naming the lesson compile for a lesson-only file', async () => {
    fs.rmSync(ws.manifestPath);
    await expectRefusal(
      'PARSE_FAILED',
      'compile-manifest.json',
      'holds no record-managed rows yet: run `totem lesson compile`',
    );
  });

  it('refuses a corrupt manifest', async () => {
    fs.writeFileSync(ws.manifestPath, '{ corrupt', 'utf-8');
    await expectRefusal('PARSE_FAILED', 'compile-manifest.json');
  });

  it('refuses a floor record with no effective ledger row', async () => {
    fs.writeFileSync(ws.ledgerPath, ledgerLine(RULE_N, REC_N_REF, recordN()) + '\n', 'utf-8');
    await expectRefusal('SERVING_RECORD_MISMATCH', RULE_A);
  });

  it('refuses a record file edited after admission (content hash differs)', async () => {
    fs.writeFileSync(ws.recordAPath, recordA(`lesson-${HASH_A}`, 'warning'), 'utf-8');
    await expectRefusal('SERVING_RECORD_MISMATCH', 'content hash');
  });

  it('refuses a missing record file, naming the floor', async () => {
    fs.rmSync(ws.recordAPath);
    await expectRefusal('SERVING_INPUT_INVALID', 'a.rule.yaml');
  });

  it('refuses a floor record re-admitted after asOf (mmnto-ai/totem#3045)', async () => {
    fs.writeFileSync(
      ws.ledgerPath,
      ledgerLine(RULE_A, REC_A_REF, recordA(), '2026-10-11') +
        '\n' +
        ledgerLine(RULE_N, REC_N_REF, recordN()) +
        '\n',
      'utf-8',
    );
    await expectRefusal('SERVING_FLOOR_STALE', '2026-10-11');
  });

  it('refuses a legacyHash that is not in the serving file', async () => {
    // Record N's curation names the absent legacy hash, so the sourceLesson
    // check passes and the not-in-file refusal is the one that fires.
    const absent = 'abababababababab';
    const text = recordN(`lesson-${absent}`);
    fs.writeFileSync(path.join(ws.totemDir, 'rules', 'n.rule.yaml'), text, 'utf-8');
    fs.writeFileSync(
      ws.ledgerPath,
      ledgerLine(RULE_A, REC_A_REF, recordA()) + '\n' + ledgerLine(RULE_N, REC_N_REF, text) + '\n',
      'utf-8',
    );
    writeInput(ws, {
      ...ws.input,
      floor: [{ legacyHash: absent, records: [{ path: REC_N_REF, ruleId: RULE_N }] }],
    });
    await expectRefusal(
      'SERVING_INPUT_INVALID',
      `floor names legacyHash ${absent}, which is not in the serving file`,
    );
  });

  it('refuses a legacyHash that disagrees with the record curation.sourceLesson', async () => {
    writeInput(ws, {
      ...ws.input,
      floor: [{ legacyHash: HASH_E, records: [{ path: REC_A_REF, ruleId: RULE_A }] }],
    });
    await expectRefusal('SERVING_INPUT_INVALID', 'sourceLesson');
  });

  it('refuses a hash named in both lists', async () => {
    writeInput(ws, {
      ...ws.input,
      archive: [{ lessonHash: HASH_A, reason: 'no-intent', ref: 'x' }],
    });
    await expectRefusal('SERVING_INPUT_INVALID', 'both');
  });

  it('refuses a record-path row in the file that the floor does not name', async () => {
    const file = JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as { rules: unknown[] };
    file.rules.push({
      ...legacyRow('9999999999999999', 'Stray record row'),
      examples: [{ bad: 'x', good: 'y' }],
    });
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    await expectRefusal('SERVING_INPUT_INVALID', '9999999999999999');
  });

  it('refuses a record the lowering rejects, with the lowering reason', async () => {
    const text = yamlStringify({
      schemaVersion: 1,
      severity: 'error',
      message: 'Use execFileSync instead of execSync',
      target: {
        type: 'ast-grep',
        language: 'typescript',
        pattern: 'execSync($$$ARGS)',
        scope: { fileGlobs: ['**/*.ts'] },
      },
      requires: { pattern: 'execFileSync', scope: 'line' },
      examples: [{ bad: "execSync('git status');", good: "execFileSync('git', ['status']);" }],
      curation: { sourceLesson: `lesson-${HASH_A}` },
    });
    fs.writeFileSync(ws.recordAPath, text, 'utf-8');
    fs.writeFileSync(
      ws.ledgerPath,
      ledgerLine(RULE_A, REC_A_REF, text) + '\n' + ledgerLine(RULE_N, REC_N_REF, recordN()) + '\n',
      'utf-8',
    );
    await expectRefusal('COMPILE_FAILED', 'requires.scope');
  });
});

describe('assertUntouchedRowsUnchanged: the writer invariant (mmnto-ai/totem#3036 B2)', () => {
  it('refuses a plan in which an untouched row serializes differently than before planning', () => {
    const row = {
      lessonHash: 'eeeeeeeeeeeeeeee',
      lessonHeading: 'h',
      pattern: 'p',
      message: 'm',
      compiledAt: 'x',
    };
    const rows = [row] as unknown as CompiledRule[];
    const before = rows.map((r) => JSON.stringify(r, null, 2));
    const plan = { rows, report: { rows: [] } } as unknown as ServingPlan;
    expect(() => assertUntouchedRowsUnchanged(rows, before, plan)).not.toThrow();
    row.message = 'mutated';
    expect(() => assertUntouchedRowsUnchanged(rows, before, plan)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INVARIANT_BROKEN',
        message: expect.stringContaining('eeeeeeeeeeeeeeee'),
      }),
    );
  });

  it('refuses a plan that drops an untouched row', () => {
    const row = {
      lessonHash: 'eeeeeeeeeeeeeeee',
      lessonHeading: 'h',
      pattern: 'p',
      message: 'm',
      compiledAt: 'x',
    };
    const rows = [row] as unknown as CompiledRule[];
    const before = rows.map((r) => JSON.stringify(r, null, 2));
    const plan = { rows: [], report: { rows: [] } } as unknown as ServingPlan;
    expect(() => assertUntouchedRowsUnchanged(rows, before, plan)).toThrow(
      expect.objectContaining({ code: 'SERVING_INVARIANT_BROKEN' }),
    );
  });
});

describe('the file of record validates (mmnto-ai/totem#3036 B2)', () => {
  it('the fixture copy is the file of record (sha256) and passes the input schema', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const fixture = path.join(here, 'commands', 'fixtures', 'serving-input', 'floor-run16.json');
    const bytes = fs.readFileSync(fixture);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '24c3f953682880b30d9796785bca4b4d94bbbcf7ac6170f6125bcccdaeb4236d',
    );
    const parsed = ServingInputSchema.safeParse(JSON.parse(bytes.toString('utf-8')));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.floor).toHaveLength(24);
      expect(parsed.data.floor.flatMap((e) => e.records)).toHaveLength(28);
      expect(parsed.data.archive).toHaveLength(125);
    }
  });
});

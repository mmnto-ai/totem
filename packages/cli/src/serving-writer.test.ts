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
  safeExec,
  ServingInputSchema,
} from '@mmnto/totem';

import { verifyManifestCommand } from './commands/verify-manifest.js';
import {
  assertUntouchedRowsUnchanged,
  formatServingReport,
  readLedgerAdmissions,
  runServingWriter,
} from './serving-writer.js';
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
// ─── Scratch git repositories, isolated from the machine's git config ───────

const BEFORE_AS_OF = '2026-09-23T12:00:00Z';
const AFTER_AS_OF = '2026-10-11T09:30:00Z';

/** An empty file every scratch git command reads as its global and system config. */
const EMPTY_GITCONFIG = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'totem-serving-gitcfg-')),
  'empty.gitconfig',
);
fs.writeFileSync(EMPTY_GITCONFIG, '', 'utf-8');

function gitEnv(date?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG,
    GIT_CONFIG_SYSTEM: EMPTY_GITCONFIG,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    ...(date !== undefined ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
  };
}

function git(root: string, args: string[], date?: string): string {
  return safeExec('git', args, { cwd: root, env: gitEnv(date) });
}

function gitInit(root: string): void {
  git(root, ['init', '-q', '-b', 'main']);
}

function commitAll(root: string, date: string, message = 'commit'): string {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--no-gpg-sign', '-m', message], date);
  return git(root, ['rev-parse', 'HEAD']);
}

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
        // Over every file (no repo cwd): the workspace is committed whole just
        // below, so the tracked set the verifier reads is the same set, even
        // when this root is nested inside another scratch repository.
        input_hash: generateInputHash(lessonsDir),
        output_hash: generateOutputHash(rulesPath),
        rule_count: rows.length,
        records_hash: attestRecordsHash(totemDir),
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
  // The admission instant of a ledger row is the committer instant of the
  // commit that introduced its line, so the workspace is a git repository with
  // everything committed well before asOf.
  gitInit(root);
  commitAll(root, BEFORE_AS_OF);
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

/**
 * Re-attest the serving file in its manifest after a test edits it, so the
 * refusal under test fires rather than the integrity refusal (R2-F2a).
 */
function resealManifest(ws: Workspace): void {
  const manifest = JSON.parse(fs.readFileSync(ws.manifestPath, 'utf-8')) as Record<string, unknown>;
  manifest['output_hash'] = generateOutputHash(ws.rulesPath);
  fs.writeFileSync(ws.manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

/** An out-of-band edit: the carried row's pattern changes, the manifest does not. */
function tamperCarriedRow(ws: Workspace): void {
  const file = JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as {
    rules: Array<Record<string, unknown>>;
  };
  const row = file.rules.find((r) => r['lessonHash'] === HASH_E)!;
  row['pattern'] = 'tampered-by-hand';
  fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
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
    // The writer's own git calls must not read the machine's git config either.
    vi.stubEnv('GIT_CONFIG_GLOBAL', EMPTY_GITCONFIG);
    vi.stubEnv('GIT_CONFIG_SYSTEM', EMPTY_GITCONFIG);
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

  it('with --refresh, a tampered carried row is accepted: the manifest and every export are rewritten and reported (R2-F2b)', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    tamperCarriedRow(ws);
    backdate(ws);
    const before = snapshot(ws);
    const dry = await runServingWriter({ inputPath: ws.inputPath, dryRun: true, refresh: true });
    expect(dry.writes).toEqual({ servingFile: false, manifest: true, exports: ['EXPORTED.md'] });
    expectUnchanged(ws, before);
    const result = await runServingWriter({ inputPath: ws.inputPath, refresh: true });
    expect(result.report.changed).toBe(false);
    expect(result.written).toBe(true);
    expect(result.writes).toEqual({ servingFile: false, manifest: true, exports: ['EXPORTED.md'] });
    expect(formatServingReport(result).at(-1)).toBe(
      'Wrote the manifest, EXPORTED.md (agents, 3 lessons) (--refresh; no row changed).',
    );
    const after = snapshot(ws);
    expect(after.rules!.equals(before.rules!)).toBe(true);
    expect(after.rulesMtime).toBe(before.rulesMtime);
    expect(after.manifestMtime).not.toBe(before.manifestMtime);
    expect(fs.statSync(ws.exportPath).mtimeMs).not.toBe(new Date('2026-01-01T00:00:00Z').getTime());
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
    // And the next plain run writes nothing.
    expect((await runServingWriter({ inputPath: ws.inputPath })).written).toBe(false);
  });

  it('a no-change run after an export was reformatted inside its sentinel block writes nothing (R2-F1)', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    // The prettier shape: the block's text changes, the lesson set does not.
    const text = fs.readFileSync(ws.exportPath, 'utf-8');
    const reformatted = text.replace(/\n- /g, '\n\n- ');
    expect(reformatted).not.toBe(text);
    fs.writeFileSync(ws.exportPath, reformatted, 'utf-8');
    backdate(ws);
    const before = snapshot(ws);
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.written).toBe(false);
    expect(result.writes).toEqual({ servingFile: false, manifest: false, exports: [] });
    expect(formatServingReport(result).at(-1)).toBe('No row changes; nothing was written.');
    expectUnchanged(ws, before);
    expect(fs.readFileSync(ws.exportPath, 'utf-8')).toBe(reformatted);
  });

  it('a changing run writes every export target, including one whose text already equals the render (R2-F1)', async () => {
    // Workspace A yields the rendered export; workspace B starts with exactly that text.
    const a = setupWorkspace(fs.mkdtempSync(path.join(tmpDir, 'a-')));
    process.chdir(a.root);
    await runServingWriter({ inputPath: a.inputPath });
    const rendered = fs.readFileSync(a.exportPath, 'utf-8');
    const b = setupWorkspace(fs.mkdtempSync(path.join(tmpDir, 'b-')));
    process.chdir(b.root);
    fs.writeFileSync(b.exportPath, rendered, 'utf-8');
    backdate(b);
    const result = await runServingWriter({ inputPath: b.inputPath });
    expect(result.writes).toEqual({ servingFile: true, manifest: true, exports: ['EXPORTED.md'] });
    expect(fs.readFileSync(b.exportPath, 'utf-8')).toBe(rendered);
    expect(fs.statSync(b.exportPath).mtimeMs).not.toBe(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('a no-change run with a stale records attestation writes nothing and names --refresh on one line (R2-F2c)', async () => {
    const ws = setupWorkspace(tmpDir);
    await runServingWriter({ inputPath: ws.inputPath });
    fs.writeFileSync(path.join(ws.totemDir, 'rules', 'extra.rule.yaml'), recordN(), 'utf-8');
    // The records attestation covers TRACKED records only.
    commitAll(ws.root, BEFORE_AS_OF);
    backdate(ws);
    const before = snapshot(ws);
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.written).toBe(false);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toContain('--refresh');
    expect(formatServingReport(result)).toContain(result.notices[0]);
    expectUnchanged(ws, before);
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
    // The writer's own git calls must not read the machine's git config either.
    vi.stubEnv('GIT_CONFIG_GLOBAL', EMPTY_GITCONFIG);
    vi.stubEnv('GIT_CONFIG_SYSTEM', EMPTY_GITCONFIG);
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

  it('refuses a serving file its manifest does not attest (a tampered carried row) before planning (R2-F2a)', async () => {
    await runServingWriter({ inputPath: ws.inputPath });
    tamperCarriedRow(ws);
    await expectRefusal(
      'SERVING_MANIFEST_STALE',
      'does not match its manifest',
      'totem lesson compile --refresh-manifest --allow-record-rows',
    );
    await expect(runServingWriter({ inputPath: ws.inputPath, dryRun: true })).rejects.toMatchObject(
      { code: 'SERVING_MANIFEST_STALE', recoveryHint: expect.stringContaining('--refresh') },
    );
  });

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
    // The dry run refuses too: a real run would.
    const before = snapshot(ws);
    await expect(runServingWriter({ inputPath: ws.inputPath, dryRun: true })).rejects.toMatchObject(
      { code: 'PARSE_FAILED' },
    );
    expectUnchanged(ws, before);
  });

  it('refuses an export target holding only an end marker, dry and real, before any write (bot round, lone end sentinel)', async () => {
    fs.writeFileSync(
      ws.exportPath,
      '# Hand-written\n\nold block\n<!-- totem:generated:end -->\n',
      'utf-8',
    );
    backdate(ws);
    const before = snapshot(ws);
    const lone =
      /Export target EXPORTED\.md \(agents\): Found <!-- totem:generated:end --> without matching <!-- totem:generated:start -->/;
    await expect(runServingWriter({ inputPath: ws.inputPath, dryRun: true })).rejects.toMatchObject(
      { code: 'PARSE_FAILED', message: expect.stringMatching(lone) },
    );
    expectUnchanged(ws, before);
    await expectRefusal('PARSE_FAILED', lone);
  });

  it('inactive record row, route one: remove it by hand, the plain run refuses on integrity, --refresh lowers it afresh (bot round)', async () => {
    await runServingWriter({ inputPath: ws.inputPath });
    const file = JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as {
      rules: Array<Record<string, unknown>>;
    };
    const row = file.rules.find((r) => r['lessonHash'] === RULE_A)!;
    row['status'] = 'archived';
    row['archivedReason'] = 'silenced by a human';
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    resealManifest(ws);
    await expectRefusal(
      'SERVING_INPUT_INVALID',
      `${RULE_A}, which the floor names, is inactive (status: archived, archivedReason: silenced by a human)`,
      'To serve it again, remove the inactive row from compiled-rules.json deliberately and re-run with --refresh',
    );
    // Route one: the row removed by hand.
    file.rules = file.rules.filter((r) => r['lessonHash'] !== RULE_A);
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    await expectRefusal('SERVING_MANIFEST_STALE', 'does not match its manifest');
    const result = await runServingWriter({ inputPath: ws.inputPath, refresh: true });
    expect(result.written).toBe(true);
    expect(result.report.rows).toContainEqual(
      expect.objectContaining({ class: 'lowered', action: 'insert', lessonHash: RULE_A }),
    );
    const ids = readRows(ws).map((r) => r['lessonHash']);
    expect(ids.indexOf(RULE_A)).toBe(ids.indexOf(HASH_A) + 1);
    expect(readRows(ws).find((r) => r['lessonHash'] === RULE_A)!['status']).toBeUndefined();
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
  });

  it('inactive record row, route two under archive: the hint names totem lesson archive; the --refresh run passes with no row for that rule and the legacy row still names it (bot round, R4-F1/F3)', async () => {
    await runServingWriter({ inputPath: ws.inputPath });
    const file = JSON.parse(fs.readFileSync(ws.rulesPath, 'utf-8')) as {
      rules: Array<Record<string, unknown>>;
    };
    file.rules.find((r) => r['lessonHash'] === RULE_A)!['status'] = 'untested-against-codebase';
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    resealManifest(ws);
    await expectRefusal(
      'SERVING_INPUT_INVALID',
      'is inactive (status: untested-against-codebase)',
      `re-run with --refresh, then run \`totem lesson archive ${HASH_A} --reason <why>\``,
    );
    file.rules = file.rules.filter((r) => r['lessonHash'] !== RULE_A);
    fs.writeFileSync(ws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    writeInput(ws, {
      ...ws.input,
      floor: [{ records: [{ path: REC_N_REF, ruleId: RULE_N }] }],
    });
    const result = await runServingWriter({ inputPath: ws.inputPath, refresh: true });
    expect(result.written).toBe(true);
    expect(readRows(ws).map((r) => r['lessonHash'])).not.toContain(RULE_A);
    expect(readRows(ws).map((r) => r['lessonHash'])).toContain(RULE_N);
    // The legacy row keeps its served-by reason, naming the removed record,
    // until `totem lesson archive` re-reasons it.
    expect(readRows(ws).find((r) => r['lessonHash'] === HASH_A)).toMatchObject({
      status: 'archived',
      archivedReason: `served by record ${RULE_A}`,
    });
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
  });

  it('inactive record row, route one under remove: removing the row alone is refused on the absent legacy hash; dropping legacyHash too lowers the record at the end (R4-F1)', async () => {
    const rws = setupWorkspace(fs.mkdtempSync(path.join(tmpDir, 'remove-')), 'remove');
    process.chdir(rws.root);
    await runServingWriter({ inputPath: rws.inputPath });
    const file = JSON.parse(fs.readFileSync(rws.rulesPath, 'utf-8')) as {
      rules: Array<Record<string, unknown>>;
    };
    expect(file.rules.map((r) => r['lessonHash'])).not.toContain(HASH_A);
    const row = file.rules.find((r) => r['lessonHash'] === RULE_A)!;
    row['status'] = 'archived';
    row['archivedReason'] = 'silenced by a human';
    fs.writeFileSync(rws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    resealManifest(rws);
    await expect(runServingWriter({ inputPath: rws.inputPath })).rejects.toMatchObject({
      code: 'SERVING_INPUT_INVALID',
      recoveryHint: expect.stringContaining(
        `remove the inactive row from compiled-rules.json deliberately AND drop legacyHash ${HASH_A} from its floor[] entry`,
      ),
    });
    // Removing the row alone (the archive-route wording) is refused: the legacy
    // row is gone under remove, so the absent-legacy gate fires.
    file.rules = file.rules.filter((r) => r['lessonHash'] !== RULE_A);
    fs.writeFileSync(rws.rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    await expect(
      runServingWriter({ inputPath: rws.inputPath, refresh: true }),
    ).rejects.toMatchObject({
      code: 'SERVING_INPUT_INVALID',
      message: expect.stringContaining(
        `floor names legacyHash ${HASH_A}, which is not in the serving file`,
      ),
    });
    // The hint followed: legacyHash dropped from the entry too.
    writeInput(rws, {
      ...rws.input,
      floor: [
        { records: [{ path: REC_A_REF, ruleId: RULE_A }] },
        { records: [{ path: REC_N_REF, ruleId: RULE_N }] },
      ],
    });
    const result = await runServingWriter({ inputPath: rws.inputPath, refresh: true });
    expect(result.written).toBe(true);
    expect(result.report.rows).toContainEqual(
      expect.objectContaining({ class: 'lowered', action: 'insert', lessonHash: RULE_A }),
    );
    const ids = readRows(rws).map((r) => r['lessonHash']);
    expect(ids[ids.length - 1]).toBe(RULE_A);
    expect(readRows(rws).find((r) => r['lessonHash'] === RULE_A)!['status']).toBeUndefined();
    await expect(verifyManifestCommand()).resolves.toBeUndefined();
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
    resealManifest(ws);
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

  /** Re-admit record A: edit the record, append a new ledger row (authoredAt unchanged). */
  function readmitRecordA(): string {
    const text = recordA(`lesson-${HASH_A}`, 'warning');
    fs.writeFileSync(ws.recordAPath, text, 'utf-8');
    fs.appendFileSync(ws.ledgerPath, ledgerLine(RULE_A, REC_A_REF, text) + '\n', 'utf-8');
    return text;
  }

  it('the scratch git commands do not read the machine git config (probe)', () => {
    expect(() => git(ws.root, ['config', '--get', 'init.defaultBranch'])).toThrow();
  });

  it('refuses a record re-admitted by a commit after asOf, naming the instant and the commit, dry and real (mmnto-ai/totem#3045)', async () => {
    readmitRecordA();
    const sha = commitAll(ws.root, AFTER_AS_OF, 're-admit after asOf');
    backdate(ws);
    const before = snapshot(ws);
    const expected = {
      code: 'SERVING_FLOOR_STALE',
      message: expect.stringContaining(
        `admitted at 2026-10-11T09:30:00.000Z by commit ${sha}, after the serving input's asOf ${AS_OF}`,
      ),
    };
    await expect(runServingWriter({ inputPath: ws.inputPath, dryRun: true })).rejects.toMatchObject(
      expected,
    );
    expectUnchanged(ws, before);
    await expect(runServingWriter({ inputPath: ws.inputPath })).rejects.toMatchObject(expected);
    expectUnchanged(ws, before);
  });

  it('dates the re-admission by its own commit even when the git config names it in blame.ignoreRevsFile', async () => {
    readmitRecordA();
    const sha = commitAll(ws.root, AFTER_AS_OF, 're-admit after asOf');
    // A git config the writer's own git calls read, ignoring the re-admission
    // commit in blame: unneutralised, blame would hand the line to an earlier commit.
    const revs = path.join(tmpDir, 'ignore-revs.txt');
    fs.writeFileSync(revs, `${sha}\n`, 'utf-8');
    const cfg = path.join(tmpDir, 'ignore-revs.gitconfig');
    fs.writeFileSync(cfg, `[blame]\n\tignoreRevsFile = ${revs.replace(/\\/g, '/')}\n`, 'utf-8');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    // The config takes effect: an unneutralised blame attributes the line elsewhere.
    const ledgerLines = fs.readFileSync(ws.ledgerPath, 'utf-8').trimEnd().split('\n').length;
    const plain = safeExec(
      'git',
      [
        'blame',
        '--line-porcelain',
        '-L',
        `${ledgerLines},${ledgerLines}`,
        '--',
        '.totem/spine/authoring-ledger.ndjson',
      ],
      { cwd: ws.root },
    );
    expect(plain.startsWith(sha)).toBe(false);
    backdate(ws);
    await expectRefusal('SERVING_FLOOR_STALE', `by commit ${sha}, after the serving input's asOf`);
  });

  it('dates the re-admission by its own commit even when a replace ref points it at a backdated copy', async () => {
    readmitRecordA();
    const sha = commitAll(ws.root, AFTER_AS_OF, 're-admit after asOf');
    // A backdated copy of the same commit (same tree, same parent), and a local
    // replace ref pointing the re-admission at it.
    const copy = git(
      ws.root,
      ['commit-tree', `${sha}^{tree}`, '-p', `${sha}^`, '-m', 'backdated copy'],
      '2026-10-02T00:00:00Z',
    );
    git(ws.root, ['replace', sha, copy]);
    // Precondition: a plain blame follows the replace ref, reporting the
    // ORIGINAL sha with the copy's (backdated) committer-time.
    const ledgerLines = fs.readFileSync(ws.ledgerPath, 'utf-8').trimEnd().split('\n').length;
    const plain = git(ws.root, [
      'blame',
      '--line-porcelain',
      '-L',
      `${ledgerLines},${ledgerLines}`,
      '--',
      '.totem/spine/authoring-ledger.ndjson',
    ]);
    expect(plain.startsWith(sha)).toBe(true);
    expect(/^committer-time (\d+)$/m.exec(plain)?.[1]).toBe(
      String(Date.parse('2026-10-02T00:00:00Z') / 1000),
    );
    backdate(ws);
    await expectRefusal(
      'SERVING_FLOOR_STALE',
      `admitted at 2026-10-11T09:30:00.000Z by commit ${sha}, after the serving input's asOf`,
    );
  });

  it('dates the re-admission by its own commit even when a grafts file re-parents it onto a backdated copy', async () => {
    readmitRecordA();
    const sha = commitAll(ws.root, AFTER_AS_OF, 're-admit after asOf');
    // A backdated copy with the same tree, and a legacy grafts file making the
    // copy the re-admission's parent: blame then finds the line already in the
    // (backdated) parent.
    const copy = git(
      ws.root,
      ['commit-tree', `${sha}^{tree}`, '-p', `${sha}^`, '-m', 'backdated copy'],
      '2026-10-02T00:00:00Z',
    );
    const grafts = path.resolve(ws.root, git(ws.root, ['rev-parse', '--git-path', 'info/grafts']));
    fs.mkdirSync(path.dirname(grafts), { recursive: true });
    fs.writeFileSync(grafts, `${sha} ${copy}\n`, 'utf-8');
    // Precondition: a plain blame (replace refs off, as the writer runs it)
    // reports the copy's backdated committer-time.
    const ledgerLines = fs.readFileSync(ws.ledgerPath, 'utf-8').trimEnd().split('\n').length;
    const plain = git(ws.root, [
      '--no-replace-objects',
      'blame',
      '--line-porcelain',
      '-L',
      `${ledgerLines},${ledgerLines}`,
      '--',
      '.totem/spine/authoring-ledger.ndjson',
    ]);
    expect(/^committer-time (\d+)$/m.exec(plain)?.[1]).toBe(
      String(Date.parse('2026-10-02T00:00:00Z') / 1000),
    );
    backdate(ws);
    await expectRefusal(
      'SERVING_FLOOR_STALE',
      `admitted at 2026-10-11T09:30:00.000Z by commit ${sha}, after the serving input's asOf`,
    );
  });

  it('passes the same re-admission when its commit is before asOf', async () => {
    readmitRecordA();
    commitAll(ws.root, '2026-10-10T02:18:12Z', 're-admit before asOf');
    const result = await runServingWriter({ inputPath: ws.inputPath });
    expect(result.written).toBe(true);
    expect(readRows(ws).find((r) => r['lessonHash'] === RULE_A)!['severity']).toBe('warning');
  });

  it('refuses a re-admission whose ledger row is not committed', async () => {
    readmitRecordA();
    await expectRefusal('SERVING_FLOOR_STALE', `ruleId ${RULE_A}) is not committed`, 'Commit');
  });

  it('binds a floor record by content: a contentHash that matches passes, one that differs refuses', async () => {
    const withHash = (contentHash: string) => ({
      ...ws.input,
      floor: [
        { legacyHash: HASH_A, records: [{ path: REC_A_REF, ruleId: RULE_A, contentHash }] },
        { records: [{ path: REC_N_REF, ruleId: RULE_N }] },
      ],
    });
    writeInput(ws, withHash(sha256(recordA())));
    expect((await runServingWriter({ inputPath: ws.inputPath, dryRun: true })).dryRun).toBe(true);
    writeInput(ws, withHash('e'.repeat(64)));
    await expectRefusal(
      'SERVING_RECORD_MISMATCH',
      'the floor was built against another revision of this record',
    );
  });

  it('refuses loudly when the workspace is not a git repository, naming the git error', async () => {
    fs.rmSync(path.join(ws.root, '.git'), { recursive: true, force: true });
    await expectRefusal('GIT_FAILED', /cannot be dated.*not a git repository/i);
  });

  it('refuses a shallow clone, where blame would date lines to the shallow boundary', async () => {
    fs.writeFileSync(path.join(ws.root, 'second.txt'), 'x\n', 'utf-8');
    commitAll(ws.root, BEFORE_AS_OF, 'second');
    const clone = path.join(tmpDir, 'shallow');
    const fwd = ws.root.replace(/\\/g, '/');
    const url = fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`;
    git(tmpDir, ['clone', '-q', '--depth', '1', url, clone]);
    expect(git(clone, ['rev-parse', '--is-shallow-repository'])).toBe('true');
    process.chdir(clone);
    await expect(
      runServingWriter({ inputPath: path.join(clone, 'serve-input.json'), dryRun: true }),
    ).rejects.toMatchObject({ code: 'GIT_FAILED', message: expect.stringContaining('shallow') });
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
    commitAll(ws.root, BEFORE_AS_OF);
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
    resealManifest(ws);
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
    commitAll(ws.root, BEFORE_AS_OF);
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

  it("dates every floor record of the file of record by blaming this repository's own ledger: all at or before asOf, the three re-pinned rows at the re-pin commit", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, '..', '..', '..');
    const input = ServingInputSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(here, 'commands', 'fixtures', 'serving-input', 'floor-run16.json'),
          'utf-8',
        ),
      ),
    );
    const ruleIds = input.floor.flatMap((e) => e.records.map((r) => r.ruleId));
    const shallow =
      safeExec('git', ['rev-parse', '--is-shallow-repository'], { cwd: repoRoot }) === 'true';
    if (shallow) {
      // A shallow checkout dates every line to its boundary commit, so the
      // writer refuses rather than date a row wrongly.
      expect(() => readLedgerAdmissions(path.join(repoRoot, '.totem'), ruleIds)).toThrow(
        expect.objectContaining({
          code: 'GIT_FAILED',
          message: expect.stringContaining('shallow'),
        }),
      );
      return;
    }
    const admissions = readLedgerAdmissions(path.join(repoRoot, '.totem'), ruleIds);
    expect(admissions.size).toBe(28);
    const asOfMs = Date.parse(input.asOf);
    for (const a of admissions.values()) {
      expect(a.admittedAt).not.toBeNull();
      expect(Date.parse(a.admittedAt!)).toBeLessThanOrEqual(asOfMs);
    }
    for (const id of ['923841006dd9c024', '6e5b15c0ae7e2285', '312894688c167fb2']) {
      expect(admissions.get(id)!.admittedAt).toBe('2026-10-06T16:23:14.000Z');
    }
  });
});

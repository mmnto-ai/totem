import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledRule } from '@mmnto/totem';
import { hashLesson } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand, pruneStaleRules } from './compile.js';

// ─── The legacy-compile guard (B1 of mmnto-ai/totem#3036) ──────────────────
//
// A record-path row (one carrying `examples`, the `isRecordPathRule`
// discriminator) is managed by its record, not by a lesson, so its
// `lessonHash` never appears in the lesson set. Unguarded, both prune paths in
// `compileCommand` dropped it as "stale", and the compile wrote the result.
// The guard: both prune paths keep every record-path row, and the compile
// refuses a serving file that holds one unless `--allow-record-rows` is passed.

const RECORD_ROW_ID = 'rec-0001-record-managed-row';

function recordRow(): CompiledRule {
  return {
    lessonHash: RECORD_ROW_ID,
    lessonHeading: 'Record-managed rule',
    pattern: 'record-dummy-never-matches',
    message: 'Record-managed rule',
    engine: 'regex',
    compiledAt: '2026-10-01T00:00:00Z',
    examples: [{ bad: 'record-dummy-never-matches', good: 'fine' }],
  };
}

function legacyRow(lessonHash: string, heading: string): CompiledRule {
  return {
    lessonHash,
    lessonHeading: heading,
    pattern: 'dummy-never-matches',
    message: heading,
    engine: 'regex',
    compiledAt: '2026-10-01T00:00:00Z',
  };
}

function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

const HEADING = 'Use err in catch';
const BODY = 'Do not use the identifier "error" in catch blocks.';

interface Workspace {
  totemDir: string;
  rulesPath: string;
  manifestPath: string;
  exportPath: string;
}

/**
 * A Full-tier workspace (shell orchestrator, never invoked on these paths) with
 * one lesson and a serving file holding the given rows. No manifest is written,
 * so any manifest on disk after a run was written by that run. An export
 * target is configured so a run that reached the export phase leaves a file.
 */
function setupWorkspace(
  tmpDir: string,
  rows: CompiledRule[],
  lessons: Record<string, string>,
): Workspace {
  fs.writeFileSync(
    path.join(tmpDir, 'totem.config.ts'),
    [
      'export default {',
      '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
      '  totemDir: ".totem",',
      '  orchestrator: {',
      '    provider: "shell",',
      '    command: "echo should-never-run",',
      '    defaultModel: "test-model",',
      '  },',
      '  exports: { agents: "EXPORTED.md" },',
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );
  const totemDir = path.join(tmpDir, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  for (const [name, body] of Object.entries(lessons)) {
    fs.writeFileSync(path.join(lessonsDir, name), body, 'utf-8');
  }
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  fs.writeFileSync(
    rulesPath,
    JSON.stringify({ version: 1, rules: rows, nonCompilable: [] }, null, 2) + '\n',
    'utf-8',
  );
  return {
    totemDir,
    rulesPath,
    manifestPath: path.join(totemDir, 'compile-manifest.json'),
    exportPath: path.join(tmpDir, 'EXPORTED.md'),
  };
}

function rowIds(rulesPath: string): string[] {
  const file = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as {
    rules: Array<{ lessonHash: string }>;
  };
  return file.rules.map((r) => r.lessonHash);
}

// ─── The first prune path: the exported helper ──────────────────────────────

describe('pruneStaleRules keeps record-path rows (mmnto-ai/totem#3036 B1)', () => {
  it('keeps a record-path row whose id is not a lesson hash, and still drops a stale legacy row', async () => {
    const rec = recordRow();
    const kept = legacyRow('abc', 'Kept');
    const stale = legacyRow('stale', 'Stale');

    const result = await pruneStaleRules([kept, rec, stale], new Set(['abc']));

    expect(result.fresh).toEqual([kept, rec]);
    expect(result.fresh[1]).toBe(rec);
    expect(result.pruned).toBe(1);
  });
});

// ─── The refusal and the override, end to end ───────────────────────────────

describe('compileCommand on a record-managed serving file (mmnto-ai/totem#3036 B1)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-record-guard-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('refuses before any write, naming `totem rule serve`, and leaves the serving file byte- and mtime-identical', async () => {
    const lessonHash = hashLesson(HEADING, BODY);
    const ws = setupWorkspace(tmpDir, [legacyRow(lessonHash, HEADING), recordRow()], {
      'use-err.md': lessonMarkdown(HEADING, BODY),
    });
    // Back-date the mtime so a rewrite within the same clock tick still shows.
    const past = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(ws.rulesPath, past, past);
    const bytesBefore = fs.readFileSync(ws.rulesPath);
    const mtimeBefore = fs.statSync(ws.rulesPath).mtimeMs;

    await expect(compileCommand({ export: true })).rejects.toMatchObject({
      code: 'RECORD_MANAGED_SERVING_FILE',
      message: expect.stringContaining('totem rule serve'),
    });

    expect(fs.readFileSync(ws.rulesPath).equals(bytesBefore)).toBe(true);
    expect(fs.statSync(ws.rulesPath).mtimeMs).toBe(mtimeBefore);
    expect(fs.existsSync(ws.manifestPath)).toBe(false);
    expect(fs.existsSync(ws.exportPath)).toBe(false);
  });

  it('refuses the --force path too (it would re-enter every lesson and rewrite the file)', async () => {
    const lessonHash = hashLesson(HEADING, BODY);
    const ws = setupWorkspace(tmpDir, [legacyRow(lessonHash, HEADING), recordRow()], {
      'use-err.md': lessonMarkdown(HEADING, BODY),
    });
    const bytesBefore = fs.readFileSync(ws.rulesPath);

    await expect(compileCommand({ force: true })).rejects.toMatchObject({
      code: 'RECORD_MANAGED_SERVING_FILE',
    });

    expect(fs.readFileSync(ws.rulesPath).equals(bytesBefore)).toBe(true);
    expect(fs.existsSync(ws.manifestPath)).toBe(false);
  });

  it('with --allow-record-rows, the no-op prune path runs and keeps the record-path row', async () => {
    const lessonHash = hashLesson(HEADING, BODY);
    // A stale legacy row forces the no-op branch to prune and rewrite the file.
    const ws = setupWorkspace(
      tmpDir,
      [legacyRow(lessonHash, HEADING), recordRow(), legacyRow('stale-lesson', 'Removed lesson')],
      { 'use-err.md': lessonMarkdown(HEADING, BODY) },
    );

    await compileCommand({ allowRecordRows: true });

    expect(rowIds(ws.rulesPath)).toEqual([lessonHash, RECORD_ROW_ID]);
    expect(fs.existsSync(ws.manifestPath)).toBe(true);
  });

  it('with --allow-record-rows, the inline prune of the compile branch keeps the record-path row', async () => {
    // A lesson with no row puts the run in the compile branch, whose inline prune
    // runs before any lesson is compiled. The cloud seam (fetch stubbed, no
    // results) keeps the run hermetic: nothing is spawned, nothing is compiled,
    // and the pruned set is what gets written.
    vi.stubEnv('TOTEM_CLOUD_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [], stats: { elapsed_seconds: 0, succeeded: 0, failed: 0 } }),
      }),
    );
    const ws = setupWorkspace(tmpDir, [recordRow(), legacyRow('stale-lesson', 'Removed lesson')], {
      'use-err.md': lessonMarkdown(HEADING, BODY),
    });

    await compileCommand({ allowRecordRows: true, cloud: 'http://127.0.0.1:9' });

    expect(rowIds(ws.rulesPath)).toEqual([RECORD_ROW_ID]);
    expect(fs.existsSync(ws.manifestPath)).toBe(true);
  });
});

// ─── First compile: no serving file yet (fold round 2, mmnto-ai/totem#3036 B1) ──
//
// The guard reads the serving file on every run. A repository that has never
// compiled has none, and the guard must let that run through: the loader's
// missing-file case is an empty rule set, never a refusal.

describe('compileCommand with no serving file yet (mmnto-ai/totem#3036 B1)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-record-guard-first-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('is not refused by the guard and writes a serving file', async () => {
    // The cloud seam (fetch stubbed, no results) keeps the run hermetic.
    vi.stubEnv('TOTEM_CLOUD_TOKEN', 'test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [], stats: { elapsed_seconds: 0, succeeded: 0, failed: 0 } }),
      }),
    );
    const ws = setupWorkspace(tmpDir, [], { 'use-err.md': lessonMarkdown(HEADING, BODY) });
    fs.rmSync(ws.rulesPath);
    expect(fs.existsSync(ws.rulesPath)).toBe(false);

    let thrown: unknown;
    try {
      await compileCommand({ cloud: 'http://127.0.0.1:9' });
    } catch (err) {
      thrown = err;
    }

    const code = (thrown as { code?: string } | undefined)?.code;
    expect(code).not.toBe('PARSE_FAILED');
    expect(code).not.toBe('RECORD_MANAGED_SERVING_FILE');
    expect(thrown).toBeUndefined();
    expect(fs.existsSync(ws.rulesPath)).toBe(true);
  });
});

// ─── An unreadable serving file (fold round, mmnto-ai/totem#3036 B1) ────────
//
// The shared loader turns a JSON parse failure into an empty rule set. Read that
// way, a record-managed file with a conflict marker shows no record rows, the
// guard passes it, and the compile overwrites it without them. An unreadable
// file could hold record rows, so the guard refuses it, and the record-rows
// override does not lift that refusal.

describe('compileCommand on a serving file that cannot be parsed (mmnto-ai/totem#3036 B1)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-record-guard-unparsable-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  function conflictedWorkspace(): { ws: Workspace; bytesBefore: Buffer; mtimeBefore: number } {
    const lessonHash = hashLesson(HEADING, BODY);
    const ws = setupWorkspace(tmpDir, [legacyRow(lessonHash, HEADING), recordRow()], {
      'use-err.md': lessonMarkdown(HEADING, BODY),
    });
    const body = fs.readFileSync(ws.rulesPath, 'utf-8');
    fs.writeFileSync(ws.rulesPath, '<<<<<<< HEAD\n' + body, 'utf-8');
    const past = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(ws.rulesPath, past, past);
    return {
      ws,
      bytesBefore: fs.readFileSync(ws.rulesPath),
      mtimeBefore: fs.statSync(ws.rulesPath).mtimeMs,
    };
  }

  it('refuses before any write and leaves the file byte- and mtime-identical', async () => {
    const { ws, bytesBefore, mtimeBefore } = conflictedWorkspace();

    await expect(compileCommand({ export: true })).rejects.toMatchObject({
      code: 'PARSE_FAILED',
      message: expect.stringContaining('nothing was written'),
    });

    expect(fs.readFileSync(ws.rulesPath).equals(bytesBefore)).toBe(true);
    expect(fs.statSync(ws.rulesPath).mtimeMs).toBe(mtimeBefore);
    expect(fs.existsSync(ws.manifestPath)).toBe(false);
    expect(fs.existsSync(ws.exportPath)).toBe(false);
  });

  it('still refuses with --allow-record-rows (the override does not cover an unreadable file)', async () => {
    const { ws, bytesBefore, mtimeBefore } = conflictedWorkspace();

    await expect(compileCommand({ allowRecordRows: true, export: true })).rejects.toMatchObject({
      code: 'PARSE_FAILED',
      message: expect.stringContaining('--allow-record-rows'),
    });

    expect(fs.readFileSync(ws.rulesPath).equals(bytesBefore)).toBe(true);
    expect(fs.statSync(ws.rulesPath).mtimeMs).toBe(mtimeBefore);
    expect(fs.existsSync(ws.manifestPath)).toBe(false);
    expect(fs.existsSync(ws.exportPath)).toBe(false);
  });
});

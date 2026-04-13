import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateInputHash, hashLesson, readCompileManifest } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────
//
// These tests exercise the `toCompile.length === 0` no-op branch inside
// `compileCommand`. Full-tier config (shell orchestrator) is required so
// the branch is reachable, but because no lessons need compiling, the
// orchestrator command is never invoked.

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-noop-'));
}

/** Build a valid `## Lesson —` markdown block that readAllLessons can parse. */
function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

interface WorkspaceOptions {
  /** Lesson files to create under .totem/lessons/ (filename → markdown body) */
  lessons: Record<string, string>;
  /** Compiled rules to pre-populate in .totem/compiled-rules.json */
  rules: Array<{ lessonHash: string; lessonHeading: string }>;
  /**
   * If provided, `input_hash` in compile-manifest.json is set to this value
   * verbatim. Used to simulate drift (stale manifest) without touching the
   * lessonsDir between setup and the compileCommand call.
   */
  manifestInputHash?: string;
  /** If true, do NOT write compile-manifest.json at all (missing-file case). */
  omitManifest?: boolean;
}

function setupWorkspace(tmpDir: string, options: WorkspaceOptions): void {
  // Full-tier config with a shell orchestrator. The shell command is a harmless
  // no-op because `toCompile.length === 0` means it is never invoked, but its
  // presence is required so compileCommand enters the regex-compilation branch
  // rather than throwing CONFIG_MISSING.
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
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );

  const totemDir = path.join(tmpDir, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  for (const [name, body] of Object.entries(options.lessons)) {
    fs.writeFileSync(path.join(lessonsDir, name), body, 'utf-8');
  }

  // Pre-populate compiled-rules.json with the given rules. Keep the schema
  // shape minimal — compileCommand only reads lessonHash to skip the compile
  // loop and writes fresh entries back via pruneStaleRules.
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const now = '2026-04-11T00:00:00Z';
  fs.writeFileSync(
    rulesPath,
    JSON.stringify(
      {
        version: 1,
        rules: options.rules.map((r) => ({
          lessonHash: r.lessonHash,
          lessonHeading: r.lessonHeading,
          pattern: 'dummy-never-matches',
          message: r.lessonHeading,
          engine: 'regex',
          compiledAt: now,
        })),
        nonCompilable: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  if (!options.omitManifest) {
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    // input_hash can be overridden to simulate drift. output_hash / rule_count
    // are informational for these tests and not verified by the code path.
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          compiled_at: now,
          model: 'test-model',
          input_hash: options.manifestInputHash ?? generateInputHash(lessonsDir),
          output_hash: '0000000000000000000000000000000000000000000000000000000000000000',
          rule_count: options.rules.length,
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
  }
}

describe('compileCommand no-op manifest refresh (#1337)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('refreshes the manifest when input_hash has drifted even though no rules or non-compilable entries were pruned', async () => {
    // Scenario: every lesson on disk is already cached as a rule, so
    // toCompile.length === 0. Nothing gets pruned (rulesPruned === 0,
    // drained === 0). But the manifest was persisted with a DIFFERENT
    // input_hash — the exact trigger for #1337.
    //
    // This models the real-world bug: yesterday's #1338 rename PR required
    // manually deleting a rule from compiled-rules.json AND its matching
    // lesson file. After the deletion, every remaining lesson was still
    // cached, but the manifest's input_hash was stale. verify-manifest then
    // failed on git push, and the only recovery was `totem lesson compile
    // --force` (~19 minutes of non-deterministic LLM calls).
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: {
        'use-err.md': lessonMarkdown(heading, body),
      },
      rules: [{ lessonHash, lessonHeading: heading }],
      // Deliberate drift: the manifest was written before some earlier state
      // and the current input_hash of lessonsDir does NOT match this value.
      manifestInputHash: '00000000000000000000000000000000deadbeef00000000000000000000cafe',
    });

    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    // Snapshot the rules file mtime + contents BEFORE the command runs.
    // If the fix is surgical, a pure drift refresh must NOT rewrite the
    // rules file — only the manifest should change.
    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8');

    const expectedInputHash = generateInputHash(lessonsDir);
    expect(expectedInputHash).not.toBe(
      '00000000000000000000000000000000deadbeef00000000000000000000cafe',
    );

    await compileCommand({});

    // Manifest refreshed: input_hash is now the real current hash.
    const manifestAfter = readCompileManifest(manifestPath);
    expect(manifestAfter.input_hash).toBe(expectedInputHash);

    // Rules file untouched: a pure drift refresh must not rewrite
    // compiled-rules.json. Byte-for-byte equality is the strictest check.
    const rulesAfter = fs.readFileSync(rulesPath, 'utf-8');
    expect(rulesAfter).toBe(rulesBefore);
  });

  it('leaves the manifest alone when there is no drift and no pruning needed', async () => {
    // Baseline no-op: lessonsDir is in sync with the manifest, and every
    // lesson is already cached. The command should succeed without writing
    // to either compile-manifest.json or compiled-rules.json.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: {
        'use-err.md': lessonMarkdown(heading, body),
      },
      rules: [{ lessonHash, lessonHeading: heading }],
      // No manifestInputHash override → setupWorkspace computes the real one.
    });

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    await compileCommand({});

    const rulesAfter = fs.readFileSync(rulesPath, 'utf-8');
    const manifestAfter = fs.readFileSync(manifestPath, 'utf-8');
    expect(rulesAfter).toBe(rulesBefore);
    expect(manifestAfter).toBe(manifestBefore);
  });

  it('writes a fresh manifest when compile-manifest.json is missing entirely', async () => {
    // Edge case: some flows (manual rule edits, interrupted compiles) can
    // leave a workspace with a valid compiled-rules.json but no manifest.
    // The no-op branch must synthesize one rather than throwing.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: {
        'use-err.md': lessonMarkdown(heading, body),
      },
      rules: [{ lessonHash, lessonHeading: heading }],
      omitManifest: true,
    });

    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    expect(fs.existsSync(manifestPath)).toBe(false);

    await compileCommand({});

    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = readCompileManifest(manifestPath);
    expect(manifest.input_hash).toBe(generateInputHash(lessonsDir));
    expect(manifest.rule_count).toBe(1);
  });

  // ─── Fail-loud regression tests (GCA review on PR #1348) ───
  //
  // Tenet 4 (Fail Loud, Never Drift): the no-op branch must only
  // swallow the "manifest does not exist" case (ENOENT). Corrupted
  // manifests, schema-mismatched manifests, and permission errors must
  // propagate so the user sees a loud failure — silently overwriting
  // a broken file would hide the underlying problem.
  //
  // These tests lock in the distinction between "missing" (safely
  // synthesize a fresh manifest) and "broken in any other way"
  // (re-throw, let the command fail loud).

  it('propagates TotemParseError when compile-manifest.json is corrupted JSON', async () => {
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: {
        'use-err.md': lessonMarkdown(heading, body),
      },
      rules: [{ lessonHash, lessonHeading: heading }],
      omitManifest: true,
    });

    // Overwrite the manifest with malformed JSON AFTER setupWorkspace.
    const manifestPath = path.join(tmpDir, '.totem', 'compile-manifest.json');
    fs.writeFileSync(manifestPath, '{ this is: not valid json }', 'utf-8');

    // The command must propagate the parse failure rather than silently
    // overwriting the user's corrupt file — that would hide whatever
    // wrote the bad bytes and erase the user's chance to debug it.
    await expect(compileCommand({})).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });

    // The corrupt file must still be on disk — the command must not
    // have rewritten it.
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe('{ this is: not valid json }');
  });

  it('propagates TotemParseError when compile-manifest.json has a schema mismatch', async () => {
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: {
        'use-err.md': lessonMarkdown(heading, body),
      },
      rules: [{ lessonHash, lessonHeading: heading }],
      omitManifest: true,
    });

    // Write a manifest whose JSON is well-formed but fails schema
    // validation (required fields missing / wrong types).
    const manifestPath = path.join(tmpDir, '.totem', 'compile-manifest.json');
    const malformed = JSON.stringify(
      {
        // compiled_at, model, input_hash, output_hash, rule_count all missing
        some_unexpected_key: 'whatever',
      },
      null,
      2,
    );
    fs.writeFileSync(manifestPath, malformed, 'utf-8');

    await expect(compileCommand({})).rejects.toMatchObject({
      code: 'PARSE_FAILED',
    });

    // Corrupt file preserved verbatim.
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(malformed);
  });
});

// ─── ensureLessonsDir guard (#1350) ──────────────────
//
// The NO_LESSONS_DIR guard fires in the no-op branch when lessonsDir is
// absent or is not a directory at the time generateInputHash is called.
// The realistic trigger is a workspace that populates lessons from the
// legacy .totem/lessons.md file so readAllLessons returns non-empty, but
// has no .totem/lessons/ directory for generateInputHash to hash.
//
// The helper that writes the legacy file and config but skips lessons/:

function setupWorkspaceLegacyLessons(tmpDir: string, lessonMarkdownContent: string): void {
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
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );

  const totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });

  // Write lessons via the legacy .totem/lessons.md path so readAllLessons
  // returns non-empty without a lessons/ directory being present.
  fs.writeFileSync(path.join(totemDir, 'lessons.md'), lessonMarkdownContent, 'utf-8');

  // Pre-populate compiled-rules.json so every lesson is already "compiled"
  // (no actual compilation runs) and the no-op branch is entered.
  const now = '2026-04-13T00:00:00Z';
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify(
      {
        version: 1,
        rules: [],
        nonCompilable: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  // No compile-manifest.json and no lessons/ directory - the guard should
  // fire before generateInputHash attempts to hash a non-existent directory.
}

describe('ensureLessonsDir guard (#1350)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lessons-dir-guard-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('throws NO_LESSONS_DIR when lessons directory is missing during no-op compile', async () => {
    // Lessons come from the legacy lessons.md so readAllLessons returns
    // non-empty and the NO_LESSONS check is bypassed. The no-op branch is
    // entered (toCompile.length === 0 since all rules are pre-populated or
    // there are none to add). generateInputHash(lessonsDir) then hits the
    // ensureLessonsDir guard because .totem/lessons/ was never created.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonContent = `## Lesson - ${heading}\n\n**Tags:** test\n\n${body}\n`;

    setupWorkspaceLegacyLessons(tmpDir, lessonContent);

    // No .totem/lessons/ directory exists - guard must fire.
    const totemDir = path.join(tmpDir, '.totem');
    expect(fs.existsSync(path.join(totemDir, 'lessons'))).toBe(false);

    await expect(compileCommand({})).rejects.toMatchObject({
      code: 'NO_LESSONS_DIR',
      message: expect.stringContaining('Lessons directory not found'),
    });
  });
});

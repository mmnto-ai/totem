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
});

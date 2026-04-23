import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateOutputHash, hashLesson, readCompileManifest } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────
//
// These tests exercise the `--refresh-manifest` primitive (mmnto-ai/totem#1587).
// The flag must recompute output_hash from the current compiled-rules.json
// state without invoking the LLM or touching any lessons. It is the non-LLM
// complement to #1348's input-hash drift refresh, covering the postmerge
// inline-archive workflow where a rule's `status: 'archived'` field is set
// directly by a curation script.

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-refresh-manifest-'));
}

function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

interface WorkspaceOptions {
  lessons: Record<string, string>;
  rules: Array<{ lessonHash: string; lessonHeading: string; status?: 'archived' }>;
}

function setupWorkspace(tmpDir: string, options: WorkspaceOptions): void {
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

  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const now = '2026-04-22T00:00:00Z';
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
          ...(r.status ? { status: r.status } : {}),
        })),
        nonCompilable: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  // Write manifest with an output_hash that matches the rules file as written.
  // Tests that want drift will mutate the rules file AFTER setupWorkspace.
  const manifestPath = path.join(totemDir, 'compile-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        compiled_at: now,
        model: 'test-model',
        input_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        output_hash: generateOutputHash(rulesPath),
        rule_count: options.rules.length,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

describe('compileCommand --refresh-manifest (#1587)', () => {
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

  it('updates manifest output_hash without invoking compilation when --refresh-manifest is passed', async () => {
    // Scenario: a postmerge archive script mutates compiled-rules.json in
    // place (flipping status to 'archived'). The output_hash in the manifest
    // is now stale. `--refresh-manifest` must recompute it without running
    // the LLM or touching lessons.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: { 'use-err.md': lessonMarkdown(heading, body) },
      rules: [{ lessonHash, lessonHeading: heading }],
    });

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    const manifestBefore = readCompileManifest(manifestPath);
    const hashBefore = manifestBefore.output_hash;

    // Simulate the postmerge archive-in-place: mutate compiled-rules.json
    // directly (flip status to 'archived' on the only rule).
    const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    rulesJson.rules[0].status = 'archived';
    rulesJson.rules[0].archivedReason = 'test archive';
    rulesJson.rules[0].archivedAt = '2026-04-23T00:00:00Z';
    fs.writeFileSync(rulesPath, JSON.stringify(rulesJson, null, 2) + '\n', 'utf-8');

    const rulesFileHashAfterMutation = generateOutputHash(rulesPath);
    expect(rulesFileHashAfterMutation).not.toBe(hashBefore);

    await compileCommand({ refreshManifest: true });

    const manifestAfter = readCompileManifest(manifestPath);
    expect(manifestAfter.output_hash).toBe(rulesFileHashAfterMutation);
  });

  it('is a no-op when the manifest is already fresh', async () => {
    // Baseline: rules and manifest agree. `--refresh-manifest` must not
    // write the manifest back (no compiled_at bump, no byte change).
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: { 'use-err.md': lessonMarkdown(heading, body) },
      rules: [{ lessonHash, lessonHeading: heading }],
    });

    const totemDir = path.join(tmpDir, '.totem');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    const manifestBytesBefore = fs.readFileSync(manifestPath, 'utf-8');

    await compileCommand({ refreshManifest: true });

    const manifestBytesAfter = fs.readFileSync(manifestPath, 'utf-8');
    expect(manifestBytesAfter).toBe(manifestBytesBefore);
  });

  it('throws TotemConfigError when combined with --force', async () => {
    // Strict exclusivity: --refresh-manifest is a no-LLM primitive and
    // cannot combine with --force (an LLM-invoking regenerate). The combo
    // is incoherent; fail loud rather than pick a silent resolution.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: { 'use-err.md': lessonMarkdown(heading, body) },
      rules: [{ lessonHash, lessonHeading: heading }],
    });

    await expect(compileCommand({ refreshManifest: true, force: true })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('leaves the rules file untouched on a successful refresh', async () => {
    // The primitive must be read-only w.r.t. compiled-rules.json. Only the
    // manifest is written. Byte-for-byte equality is the strictest check.
    const heading = 'Use err in catch';
    const body = 'Do not use the identifier "error" in catch blocks.';
    const lessonHash = hashLesson(heading, body);

    setupWorkspace(tmpDir, {
      lessons: { 'use-err.md': lessonMarkdown(heading, body) },
      rules: [{ lessonHash, lessonHeading: heading, status: 'archived' }],
    });

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');

    // Mutate the rules file so there is drift to refresh against.
    const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    rulesJson.rules[0].archivedReason = 'test archive drift';
    fs.writeFileSync(rulesPath, JSON.stringify(rulesJson, null, 2) + '\n', 'utf-8');

    const rulesBytesBefore = fs.readFileSync(rulesPath, 'utf-8');

    await compileCommand({ refreshManifest: true });

    const rulesBytesAfter = fs.readFileSync(rulesPath, 'utf-8');
    expect(rulesBytesAfter).toBe(rulesBytesBefore);
  });
});

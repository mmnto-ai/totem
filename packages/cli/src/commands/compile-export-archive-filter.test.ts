import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateInputHash, hashLesson } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────
//
// These tests exercise the export path's archive filter. The fix ensures
// `totem lesson compile --export` does not emit lessons whose compiled
// rule is marked `status: archived`, closing the symmetric counterpart of
// the mmnto-ai/totem#1345 lint-path filter in loadCompiledRules.

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-export-archive-'));
}

function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

interface RuleSpec {
  lessonHash: string;
  lessonHeading: string;
  archived?: boolean;
  untestedAgainstCodebase?: boolean;
}

function setupWorkspace(
  tmpDir: string,
  lessons: Record<string, string>,
  rules: RuleSpec[],
  exportTargetPath: string,
): void {
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
      `  exports: { copilot: ${JSON.stringify(exportTargetPath)} },`,
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
  const now = '2026-04-16T00:00:00Z';
  fs.writeFileSync(
    rulesPath,
    JSON.stringify(
      {
        version: 1,
        rules: rules.map((r) => ({
          lessonHash: r.lessonHash,
          lessonHeading: r.lessonHeading,
          pattern: 'dummy-never-matches',
          message: r.lessonHeading,
          engine: 'regex',
          compiledAt: now,
          ...(r.archived
            ? { status: 'archived' as const, archivedReason: 'over-broad in test' }
            : r.untestedAgainstCodebase
              ? { status: 'untested-against-codebase' as const }
              : {}),
        })),
        nonCompilable: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  const manifestPath = path.join(totemDir, 'compile-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        compiled_at: now,
        model: 'test-model',
        input_hash: generateInputHash(lessonsDir),
        output_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        rule_count: rules.length,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

describe('compileCommand --export archive filter', () => {
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

  it('excludes lessons whose compiled rule is archived from the export', async () => {
    const liveHeading = 'Keep this guidance';
    const liveBody = 'Good advice that should always ship.';
    const archivedHeading = 'Suppress this guidance';
    const archivedBody = 'Over-broad pattern; archived post-compile.';

    setupWorkspace(
      tmpDir,
      {
        'live.md': lessonMarkdown(liveHeading, liveBody),
        'archived.md': lessonMarkdown(archivedHeading, archivedBody),
      },
      [
        { lessonHash: hashLesson(liveHeading, liveBody), lessonHeading: liveHeading },
        {
          lessonHash: hashLesson(archivedHeading, archivedBody),
          lessonHeading: archivedHeading,
          archived: true,
        },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    expect(exported).toContain(liveHeading);
    expect(exported).not.toContain(archivedHeading);
  });

  it("excludes lessons whose compiled rule is 'untested-against-codebase' from the export (CR mmnto-ai/totem#1757 R2)", async () => {
    // F6 made `loadCompiledRules` filter `'untested-against-codebase'`
    // alongside `'archived'`. The export-path predicate has to match or
    // agent-rendered guidance diverges from the runtime enforcement
    // surface — Stage 4 declared the rule's behavior unknown, so we
    // shouldn't be telling the AI agent to rely on it either.
    const liveHeading = 'Keep this guidance';
    const liveBody = 'Good advice that should always ship.';
    const untestedHeading = 'Stage 4 saw nothing';
    const untestedBody = 'Pattern never fired against the consumer codebase.';

    setupWorkspace(
      tmpDir,
      {
        'live.md': lessonMarkdown(liveHeading, liveBody),
        'untested.md': lessonMarkdown(untestedHeading, untestedBody),
      },
      [
        { lessonHash: hashLesson(liveHeading, liveBody), lessonHeading: liveHeading },
        {
          lessonHash: hashLesson(untestedHeading, untestedBody),
          lessonHeading: untestedHeading,
          untestedAgainstCodebase: true,
        },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    expect(exported).toContain(liveHeading);
    expect(exported).not.toContain(untestedHeading);
  });

  it('passes all lessons through when no rules are archived (no-op filter)', async () => {
    const h1 = 'First guidance';
    const b1 = 'Body one.';
    const h2 = 'Second guidance';
    const b2 = 'Body two.';

    setupWorkspace(
      tmpDir,
      {
        'a.md': lessonMarkdown(h1, b1),
        'b.md': lessonMarkdown(h2, b2),
      },
      [
        { lessonHash: hashLesson(h1, b1), lessonHeading: h1 },
        { lessonHash: hashLesson(h2, b2), lessonHeading: h2 },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    expect(exported).toContain(h1);
    expect(exported).toContain(h2);
  });
});

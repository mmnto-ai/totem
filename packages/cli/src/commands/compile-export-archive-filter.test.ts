import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateInputHash, hashLesson } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────
//
// These tests exercise the export path's inert-status filter. Post
// mmnto-ai/totem#1873, the filter no longer suppresses `status: archived`
// rules — Stage-4 archival concerns pattern-matching false positives,
// not lesson-prose validity, so the prose is still useful agent context.
// The filter continues to suppress `status: untested-against-codebase`
// rules per the CR mmnto-ai/totem#1757 R2 rationale: Stage 4 declared
// behavior unknown, so agent context shouldn't rely on it either.

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
  archivedReason?: string;
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
            ? {
                status: 'archived' as const,
                archivedReason: r.archivedReason ?? 'over-broad in test',
              }
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

  it('includes lessons whose compiled rule is archived, annotated with the archival reason (mmnto-ai/totem#1873)', async () => {
    // Stage-4 archival concerns pattern-matching false positives, not
    // lesson-prose validity. The export digest is the agent-facing
    // knowledge surface; archived lesson prose stays useful as agent
    // context even when the compiled regex is silenced at lint time.
    // The bullet carries an `_(archived: <reason>)_` suffix so a reading
    // agent can weight the guidance appropriately.
    const liveHeading = 'Keep this guidance';
    const liveBody = 'Good advice that should always ship.';
    const archivedHeading = 'Surface this guidance with annotation';
    const archivedBody = 'Over-broad pattern; archived but prose is still useful.';
    const archivedReason = 'over-broad in test';

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
          archivedReason,
        },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    expect(exported).toContain(liveHeading);
    expect(exported).toContain(archivedHeading);
    expect(exported).toContain(`_(archived: ${archivedReason})_`);
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

  it('re-running export over an already-archived rule produces an identical digest (mmnto-ai/totem#1873 Symptom B regression)', async () => {
    // Symptom B from mmnto-ai/totem#1873: running `compile --export`
    // twice over the same compiled-rules.json silently dropped the
    // archived rule on the second run. Verify the digest is identical
    // across two consecutive invocations on unchanged on-disk state.
    const liveHeading = 'Stable guidance';
    const liveBody = 'Always present.';
    const archivedHeading = 'Stable archived guidance';
    const archivedBody = 'Archived but still surfaced for agent context.';

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

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');

    await compileCommand({ export: true });
    const firstRun = fs.readFileSync(exportPath, 'utf-8');

    await compileCommand({ export: true });
    const secondRun = fs.readFileSync(exportPath, 'utf-8');

    expect(secondRun).toBe(firstRun);
    expect(firstRun).toContain(archivedHeading);
    expect(secondRun).toContain(archivedHeading);
  });

  it('archived rule with control bytes / markdown metachars in reason sanitizes the annotation (CR mmnto-ai/totem#1878 R1)', async () => {
    // A7 invariant: archivedReason is operator-provided free text (via
    // `--reason "..."`). Control bytes (CR/LF/TAB) MUST NOT break the
    // bullet shape, markdown metachars MUST be escaped, whitespace-only
    // input MUST fall back to a plain bullet.
    const archivedHeading = 'Archived with hostile reason';
    const archivedBody = 'Lesson body present.';
    // Embeds: newline, tab, asterisk, underscore — all of which would
    // distort the bullet if interpolated raw.
    const dirtyReason = 'broken*pattern_overlaps\nwith next line\twith tab';

    setupWorkspace(
      tmpDir,
      {
        'archived.md': lessonMarkdown(archivedHeading, archivedBody),
      },
      [
        {
          lessonHash: hashLesson(archivedHeading, archivedBody),
          lessonHeading: archivedHeading,
          archived: true,
          archivedReason: dirtyReason,
        },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    // Bullet survives intact on a single line — no embedded newlines
    // from the reason text reached the rendered output.
    const bulletLine = exported.split('\n').find((l) => l.includes(archivedHeading));
    expect(bulletLine).toBeTruthy();
    expect(bulletLine).toMatch(/_\(archived:.+\)_/);
    // Markdown metachars escaped, control bytes replaced with spaces.
    expect(bulletLine).not.toMatch(/[\x00-\x1F\x7F]/);
    expect(bulletLine).toContain('broken\\*pattern\\_overlaps');
  });

  it('archived rule rendered without archivedReason falls back to plain bullet (mmnto-ai/totem#1873 graceful degrade)', async () => {
    // A6 invariant: when archivedReason is missing/empty, the bullet
    // still renders — just without the annotation suffix. Tenet 4 spirit:
    // the rule appears loudly in the digest rather than silently
    // disappearing.
    const archivedHeading = 'Archived with no stated reason';
    const archivedBody = 'Lesson body present.';

    setupWorkspace(
      tmpDir,
      {
        'archived.md': lessonMarkdown(archivedHeading, archivedBody),
      },
      [
        {
          lessonHash: hashLesson(archivedHeading, archivedBody),
          lessonHeading: archivedHeading,
          archived: true,
          archivedReason: '',
        },
      ],
      'copilot-instructions.md',
    );

    await compileCommand({ export: true });

    const exportPath = path.join(tmpDir, 'copilot-instructions.md');
    const exported = fs.readFileSync(exportPath, 'utf-8');

    expect(exported).toContain(archivedHeading);
    expect(exported).not.toContain('_(archived:');
  });
});

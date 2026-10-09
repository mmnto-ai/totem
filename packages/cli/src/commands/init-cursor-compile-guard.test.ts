import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every prompt init raises takes its Enter default, which for the cursor ingest
// is "compile". A fake interface is the one seam: init builds its own.
const questions: string[] = [];
vi.mock('node:readline/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline/promises')>();
  return {
    ...actual,
    createInterface: () =>
      ({
        question: async (q: string) => {
          questions.push(q);
          return '';
        },
        close: () => {},
      }) as unknown as import('node:readline/promises').Interface,
  };
});

import { cleanTmpDir } from '../test-utils.js';
import { initCommand } from './init.js';

// ─── `init`'s cursor ingest meets the compile guard (B1 of mmnto-ai/totem#3036) ──
//
// The ingest calls `compileCommand({ fromCursor: true })`. On a serving file
// that holds a record-path row the compile refuses; init must REPORT that
// refusal (naming the right command), write nothing to the serving file, and
// carry on to its remaining phases rather than crash.

const RECORD_ROW_ID = 'rec-0001-record-managed-row';

describe('initCommand cursor ingest on a record-managed serving file (mmnto-ai/totem#3036 B1)', () => {
  let tmpDir: string;
  let originalCwd: string;
  const savedIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-init-guard-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    questions.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    Object.defineProperty(process.stdin, 'isTTY', { value: savedIsTTY, configurable: true });
  });

  it('reports the refusal, leaves the serving file untouched and completes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    fs.writeFileSync(
      path.join(tmpDir, 'totem.yaml'),
      'targets:\n  - glob: "**/*.ts"\n    type: code\n    strategy: typescript-ast\ntotemDir: .totem\n',
      'utf-8',
    );
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'lessons'), { recursive: true });
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          version: 1,
          rules: [
            {
              lessonHash: RECORD_ROW_ID,
              lessonHeading: 'Record-managed rule',
              pattern: 'record-dummy-never-matches',
              message: 'Record-managed rule',
              engine: 'regex',
              compiledAt: '2026-10-01T00:00:00Z',
              examples: [{ bad: 'record-dummy-never-matches', good: 'fine' }],
            },
          ],
          nonCompilable: [],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, '.cursorrules'),
      '# House rules\n\n- Never commit directly to main.\n',
      'utf-8',
    );
    const bytesBefore = fs.readFileSync(rulesPath);
    const stderr: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });

    await expect(initCommand({})).resolves.toBeUndefined();

    // The ingest was offered and taken (the Enter default).
    expect(questions.some((q) => q.includes('Compile into deterministic invariants'))).toBe(true);
    const output = stderr.join('\n');
    // The refusal is reported by name, and the success line never printed.
    expect(output).toContain('Could not compile cursor rules');
    expect(output).toContain('totem rule serve');
    expect(output).not.toContain('cursor rule(s) into invariants');
    // ...and init carried on through its remaining phases to its closing line.
    expect(output).toContain('Init complete.');
    // Nothing reached the serving file.
    expect(fs.readFileSync(rulesPath).equals(bytesBefore)).toBe(true);
  }, 60000);
});

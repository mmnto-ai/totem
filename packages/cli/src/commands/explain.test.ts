import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading (as rule.test.ts does) ───

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
  };
});

/** Strip ANSI escape codes for assertion matching (ESC built by code point, not an escape literal). */
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'); // totem-context: ANSI regex — not user input
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

/** Scaffold a .totem directory with config, lessons dir and one serving file holding `rules`. */
function scaffold(cwd: string, rules: Record<string, unknown>[]): void {
  const totemDir = path.join(cwd, '.totem');
  fs.mkdirSync(path.join(totemDir, 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};', 'utf-8');
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify({ version: 1, rules }),
    'utf-8',
  );
}

describe('explain (mmnto-ai/totem#3035)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-explain-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('displays the effective severity (error) for a row with no stored severity, as rule list and rule inspect do', async () => {
    scaffold(tmpDir, [
      {
        lessonHash: '5eee0000aaaa1111',
        lessonHeading: 'Row with no stored severity',
        pattern: 'foo',
        message: 'foo',
        engine: 'regex',
        compiledAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { explainCommand } = await import('./explain.js');
    await explainCommand('5eee0000');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    const line = output.split('\n').find((l) => l.includes('Severity:'));
    expect(line).toBeDefined();
    expect(line).toContain('Severity: error');
    expect(line).not.toContain('Severity: warning');
  });

  it('shows the stored severity when one is stored', async () => {
    scaffold(tmpDir, [
      {
        lessonHash: '6fff0000bbbb2222',
        lessonHeading: 'Row with a stored warning severity',
        pattern: 'bar',
        message: 'bar',
        engine: 'regex',
        severity: 'warning',
        compiledAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const { explainCommand } = await import('./explain.js');
    await explainCommand('6fff0000');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    const line = output.split('\n').find((l) => l.includes('Severity:'));
    expect(line).toContain('Severity: warning');
  });
});

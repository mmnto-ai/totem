import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading ───────────

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

// ─── Mock the core adapters (parallel agent is implementing these) ───

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    parseSemgrepRules: (content: string) => {
      // Minimal mock: parse YAML-like content and return rules
      const rules = [];
      const skipped = [];
      // Simple mock: look for "id:" lines to create rules
      const idMatches = content.match(/id:\s*(.+)/g);
      if (idMatches) {
        for (const match of idMatches) {
          const id = match.replace(/id:\s*/, '').trim();
          rules.push({
            lessonHash: `semgrep-${id}`,
            lessonHeading: `Semgrep: ${id}`,
            pattern: `mock-pattern-${id}`,
            message: `Semgrep rule ${id}`,
            engine: 'regex' as const,
            severity: 'warning' as const,
            compiledAt: new Date().toISOString(),
          });
        }
      }
      // Look for "skip:" lines to populate skipped
      const skipMatches = content.match(/skip:\s*(.+)/g);
      if (skipMatches) {
        for (const match of skipMatches) {
          const id = match.replace(/skip:\s*/, '').trim();
          skipped.push({ id, reason: 'not convertible' });
        }
      }
      return { rules, skipped };
    },
    parseEslintConfig: (content: string) => {
      const rules = [];
      const skipped = [];
      const json = JSON.parse(content) as {
        rules?: Record<string, unknown>;
        skipped?: { rule: string; reason: string }[];
      };
      if (json.rules) {
        for (const [rule, _config] of Object.entries(json.rules)) {
          rules.push({
            lessonHash: `eslint-${rule}`,
            lessonHeading: `ESLint: ${rule}`,
            pattern: `mock-pattern-${rule}`,
            message: `ESLint rule ${rule}`,
            engine: 'regex' as const,
            severity: 'warning' as const,
            compiledAt: new Date().toISOString(),
          });
        }
      }
      if (json.skipped) {
        for (const s of json.skipped) {
          skipped.push({ rule: s.rule, reason: s.reason });
        }
      }
      return { rules, skipped };
    },
  };
});

// ─── Helpers ────────────────────────────────────────────

/** Strip ANSI escape codes for assertion matching. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // totem-context: ANSI regex — not user input
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-import-'));
}

/** Scaffold a .totem directory with config and optional existing rules. */
function scaffold(cwd: string, rules?: Record<string, unknown>[]) {
  const totemDir = path.join(cwd, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};', 'utf-8');

  if (rules) {
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(rulesPath, JSON.stringify({ version: 1, rules }), 'utf-8');
  }
  return { totemDir };
}

function writeSemgrepYaml(dir: string, content: string): string {
  const filePath = path.join(dir, 'semgrep-rules.yaml');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function writeEslintJson(dir: string, content: object): string {
  const filePath = path.join(dir, '.eslintrc.json');
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  return filePath;
}

function readRulesFile(totemDir: string): { version: number; rules: Record<string, unknown>[] } {
  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  return JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as {
    version: number;
    rules: Record<string, unknown>[];
  };
}

// ─── Tests ──────────────────────────────────────────────

describe('import command', () => {
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
    vi.restoreAllMocks();
  });

  it('errors when no --from-* flag provided', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({});

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('At least one --from-semgrep or --from-eslint flag is required');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('errors when semgrep source file does not exist', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromSemgrep: 'nonexistent.yaml' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Semgrep rules file not found');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('errors when eslint source file does not exist', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromEslint: 'nonexistent.json' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('ESLint config file not found');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('imports rules from semgrep YAML', async () => {
    const { totemDir } = scaffold(tmpDir);
    const semgrepContent = 'rules:\n  - id: no-eval\n  - id: no-exec\n';
    writeSemgrepYaml(tmpDir, semgrepContent);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromSemgrep: 'semgrep-rules.yaml' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('2 imported');
    expect(output).toContain('0 skipped');

    const data = readRulesFile(totemDir);
    expect(data.rules).toHaveLength(2);
    expect(data.rules.map((r) => r['lessonHash'])).toContain('semgrep-no-eval');
    expect(data.rules.map((r) => r['lessonHash'])).toContain('semgrep-no-exec');
  });

  it('imports rules from eslint JSON', async () => {
    const { totemDir } = scaffold(tmpDir);
    writeEslintJson(tmpDir, { rules: { 'no-var': 'error', 'no-debugger': 'warn' } });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromEslint: '.eslintrc.json' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('2 imported');

    const data = readRulesFile(totemDir);
    expect(data.rules).toHaveLength(2);
    expect(data.rules.map((r) => r['lessonHash'])).toContain('eslint-no-var');
    expect(data.rules.map((r) => r['lessonHash'])).toContain('eslint-no-debugger');
  });

  it('dry-run does not write to disk', async () => {
    const { totemDir } = scaffold(tmpDir);
    writeEslintJson(tmpDir, { rules: { 'no-var': 'error' } });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromEslint: '.eslintrc.json', dryRun: true });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Dry run');
    expect(output).toContain('1 rule(s) would be imported');

    // compiled-rules.json should NOT exist
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    expect(fs.existsSync(rulesPath)).toBe(false);
  });

  it('merges with existing rules without duplicates', async () => {
    const existingRules = [
      {
        lessonHash: 'existing-hash-1',
        lessonHeading: 'Existing rule',
        pattern: 'existing-pattern',
        message: 'Existing message',
        engine: 'regex',
        severity: 'warning',
        compiledAt: '2026-01-01T00:00:00.000Z',
      },
      {
        lessonHash: 'eslint-no-var',
        lessonHeading: 'Old ESLint no-var',
        pattern: 'old-pattern',
        message: 'Old message',
        engine: 'regex',
        severity: 'error',
        compiledAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { totemDir } = scaffold(tmpDir, existingRules);
    writeEslintJson(tmpDir, { rules: { 'no-var': 'error', 'no-debugger': 'warn' } });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromEslint: '.eslintrc.json' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('2 imported');
    expect(output).toContain('3 total rules');

    const data = readRulesFile(totemDir);
    // existing-hash-1 + eslint-no-var (replaced) + eslint-no-debugger (new) = 3
    expect(data.rules).toHaveLength(3);

    // The eslint-no-var rule should be the new one, not the old one
    const noVarRule = data.rules.find((r) => r['lessonHash'] === 'eslint-no-var') as Record<
      string,
      unknown
    >;
    expect(noVarRule).toBeDefined();
    expect(noVarRule['lessonHeading']).toBe('ESLint: no-var');
    expect(noVarRule['message']).toBe('ESLint rule no-var');
  });

  it('imports from both semgrep and eslint simultaneously', async () => {
    const { totemDir } = scaffold(tmpDir);
    writeSemgrepYaml(tmpDir, 'rules:\n  - id: no-eval\n');
    writeEslintJson(tmpDir, { rules: { 'no-var': 'error' } });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromSemgrep: 'semgrep-rules.yaml', fromEslint: '.eslintrc.json' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('2 imported');

    const data = readRulesFile(totemDir);
    expect(data.rules).toHaveLength(2);
  });

  it('logs skipped rules from adapters', async () => {
    scaffold(tmpDir);
    const semgrepContent = 'rules:\n  - id: good-rule\nskip: bad-rule\n';
    writeSemgrepYaml(tmpDir, semgrepContent);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromSemgrep: 'semgrep-rules.yaml' });

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('1 rule(s) skipped');
    expect(output).toContain('bad-rule');
    expect(output).toContain('not convertible');
  });

  it('writes to custom output path with --out', async () => {
    scaffold(tmpDir);
    const customPath = path.join(tmpDir, 'custom-dir', 'rules.json');
    writeEslintJson(tmpDir, { rules: { 'no-var': 'error' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { importCommand } = await import('./import.js');
    await importCommand({ fromEslint: '.eslintrc.json', out: customPath });

    expect(fs.existsSync(customPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(customPath, 'utf-8')) as {
      rules: Record<string, unknown>[];
    };
    expect(data.rules).toHaveLength(1);
  });
});

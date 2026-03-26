import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosticResult } from './doctor.js';
import {
  BYPASS_THRESHOLD,
  checkCompiledRules,
  checkConfig,
  checkEmbeddingConfig,
  checkGitHooks,
  checkIndex,
  checkSecretLeaks,
  checkSecretsFileTracked,
  doctorCommand,
  MIN_EVENTS,
  runSelfHealing,
} from './doctor.js';

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-'));
}

// ─── Config check ───────────────────────────────────────

describe('checkConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pass when totem.config.ts exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};');
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('totem.config.ts');
  });

  it('returns pass when totem.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), 'targets: []');
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('totem.yaml');
  });

  it('returns fail when no config exists', () => {
    const result = checkConfig(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.remediation).toBe('totem init');
  });
});

// ─── Compiled rules check ───────────────────────────────

describe('checkCompiledRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pass with rule count when compiled-rules.json exists', () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [{ id: '1' }, { id: '2' }, { id: '3' }] }),
    );
    const result = checkCompiledRules(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('3 rules loaded');
  });

  it('returns warn when compiled-rules.json is missing', () => {
    const result = checkCompiledRules(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.remediation).toBe('totem compile');
  });
});

// ─── Git hooks check ────────────────────────────────────

describe('checkGitHooks', () => {
  it('returns skip when not a git repo', () => {
    const tmpDir = makeTmpDir();
    try {
      const result = checkGitHooks(tmpDir);
      expect(result.status).toBe('skip');
      expect(result.message).toBe('Not a git repository');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns warn when hooks are missing in a git repo', () => {
    const tmpDir = makeTmpDir();
    try {
      const { execSync } = require('node:child_process');
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      const result = checkGitHooks(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('missing');
      expect(result.remediation).toBe('totem hooks');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns pass when all hooks contain totem markers', () => {
    const tmpDir = makeTmpDir();
    try {
      const { execSync } = require('node:child_process');
      execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
      const hooksDir = path.join(tmpDir, '.git', 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const hooks = [
        { file: 'pre-commit', marker: '[totem] pre-commit hook' },
        { file: 'pre-push', marker: '[totem] pre-push hook' },
        { file: 'post-merge', marker: '[totem] post-merge hook' },
        { file: 'post-checkout', marker: '[totem] post-checkout hook' },
      ];
      for (const { file, marker } of hooks) {
        fs.writeFileSync(path.join(hooksDir, file), `#!/bin/sh\n# ${marker}\necho ok`);
      }
      const result = checkGitHooks(tmpDir);
      expect(result.status).toBe('pass');
      expect(result.message).toContain('All 4 hooks');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Secret leak check ─────────────────────────────────

describe('checkSecretLeaks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pass when no secrets are found', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\nNo secrets here.');
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No leaked keys detected');
  });

  it('returns fail when a real key pattern is found', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'Use this key: sk-abcdefghijklmnopqrstuvwxyz1234567890',
    );
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('does NOT flag placeholder strings as leaks', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Set your key: sk-your-key-here-placeholder');
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('returns pass when no files to scan exist', () => {
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No files to scan');
  });

  it('detects GitHub personal access tokens', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678a',
    );
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('detects Google API keys', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'key: AIzaSyA1234567890abcdefghijklmnopqrstuvw',
    );
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('scans lesson files in .totem/lessons/', () => {
    const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'secret-lesson.md'),
      'Do not use: sk-ant-abcdefghijklmnopqrstuvwxyz',
    );
    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });
});

// ─── Embedding config check ─────────────────────────────

describe('checkEmbeddingConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns skip when no config exists', () => {
    const result = checkEmbeddingConfig(tmpDir);
    expect(result.status).toBe('skip');
  });

  it('returns warn when no embedding is configured', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }] };",
    );
    const result = checkEmbeddingConfig(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('Lite tier');
  });
});

// ─── Index health check ─────────────────────────────────

describe('checkIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns skip when no embedding is configured (Lite tier)', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const result = checkIndex(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('Lite tier');
  });
});

// ─── doctorCommand integration ──────────────────────────

describe('doctorCommand', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Set up a minimal valid workspace
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs without throwing', async () => {
    const results = await doctorCommand();
    expect(results).toBeDefined();
    expect(results.length).toBe(7);
  });

  it('returns correct check names', async () => {
    const results = await doctorCommand();
    const names = results.map((r: DiagnosticResult) => r.name);
    expect(names).toContain('Config');
    expect(names).toContain('Compiled Rules');
    expect(names).toContain('Git Hooks');
    expect(names).toContain('Embedding');
    expect(names).toContain('Index');
    expect(names).toContain('Secret Scan');
    expect(names).toContain('Secrets File Security');
  });
});

// ─── Output format ──────────────────────────────────────

describe('doctorCommand output', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [{ id: '1' }] }),
    );

    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('outputs all check names in console output', async () => {
    await doctorCommand();
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Config');
    expect(output).toContain('Compiled Rules');
    expect(output).toContain('Git Hooks');
    expect(output).toContain('Embedding');
    expect(output).toContain('Index');
    expect(output).toContain('Secret Scan');
    expect(output).toContain('Secrets File Security');
  });

  it('outputs summary line with pass/warn/fail counts', async () => {
    await doctorCommand();
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toMatch(/\d+ passed/);
    expect(output).toMatch(/\d+ warnings/);
    expect(output).toMatch(/\d+ failures/);
  });
});

// ─── Secrets file tracking check ────────────────────────

describe('checkSecretsFileTracked', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails if secrets.json is tracked by git', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    // Create and track .totem/secrets.json
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'secrets.json'), JSON.stringify({ secrets: [] }));
    execSync('git add .totem/secrets.json', { cwd: tmpDir, stdio: 'ignore' });

    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.name).toBe('Secrets File Security');
    expect(result.message).toContain('tracked by git');
    expect(result.remediation).toContain('git rm --cached');
  });

  it('passes if secrets.json is not tracked', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('not tracked');
  });

  it('passes when not in a git repo', () => {
    // tmpDir is not a git repo — execSync will throw, which we catch
    const result = checkSecretsFileTracked(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── Custom secret scanning ────────────────────────────

describe('checkSecretLeaks with custom secrets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects custom literal secrets in lesson files', () => {
    // Create a custom secrets.json with a literal pattern
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'literal', value: 'SUPER_SECRET_TOKEN_1234' }],
      }),
    );

    // Create a lesson file that contains the literal secret
    fs.writeFileSync(
      path.join(lessonsDir, 'leaked-lesson.md'),
      '# Lesson\nDo not use SUPER_SECRET_TOKEN_1234 in production.',
    );

    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('detects custom regex pattern secrets in lesson files', () => {
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'pattern', value: 'CORP-[A-Z0-9]{10,}' }],
      }),
    );

    fs.writeFileSync(
      path.join(lessonsDir, 'corp-leak.md'),
      '# Lesson\nFound token: CORP-ABCDEF1234567890',
    );

    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('passes when custom secrets do not match any files', () => {
    const totemDir = path.join(tmpDir, '.totem');
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });

    fs.writeFileSync(
      path.join(totemDir, 'secrets.json'),
      JSON.stringify({
        secrets: [{ type: 'literal', value: 'UNIQUE_SECRET_WONT_MATCH' }],
      }),
    );

    fs.writeFileSync(path.join(lessonsDir, 'clean-lesson.md'), '# Lesson\nNothing sensitive here.');

    const result = checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── Self-healing helpers ───────────────────────────────

function makeLedgerEvent(ruleId: string, type: 'suppress' | 'override' = 'suppress'): string {
  return JSON.stringify({
    timestamp: '2026-03-25T12:00:00.000Z',
    type,
    ruleId,
    file: 'src/index.ts',
    justification: type === 'override' ? 'Legacy code' : '',
    source: 'lint',
  });
}

function writeLedger(totemDir: string, lines: string[]): void {
  const ledgerDir = path.join(totemDir, 'ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'events.ndjson'), lines.join('\n') + '\n', 'utf-8');
}

function writeMetrics(
  totemDir: string,
  rules: Record<string, { triggerCount: number; suppressCount: number }>,
): void {
  const cacheDir = path.join(totemDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const metricsData = {
    version: 1,
    rules: Object.fromEntries(
      Object.entries(rules).map(([id, counts]) => [
        id,
        {
          triggerCount: counts.triggerCount,
          suppressCount: counts.suppressCount,
          lastTriggeredAt: '2026-03-25T12:00:00.000Z',
          lastSuppressedAt: null,
        },
      ]),
    ),
  };
  fs.writeFileSync(
    path.join(cacheDir, 'rule-metrics.json'),
    JSON.stringify(metricsData, null, 2) + '\n',
    'utf-8',
  );
}

function makeCompiledRules(
  rules: Array<{
    lessonHash: string;
    lessonHeading: string;
    severity?: string;
    pattern?: string;
  }>,
): object {
  return {
    version: 1,
    rules: rules.map((r) => ({
      lessonHash: r.lessonHash,
      lessonHeading: r.lessonHeading,
      pattern: r.pattern ?? '\\bconsole\\.log\\b',
      message: `Violation: ${r.lessonHeading}`,
      engine: 'regex',
      compiledAt: '2026-03-25T12:00:00.000Z',
      ...(r.severity !== undefined ? { severity: r.severity } : {}),
    })),
  };
}

/**
 * Set up a minimal workspace for self-healing tests.
 * Returns the totemDir path (.totem inside cwd).
 */
function setupSelfHealingWorkspace(cwd: string): string {
  // Config file so resolveConfigPath succeeds (targets needs at least one entry)
  const config = {
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    totemDir: '.totem',
  };
  fs.writeFileSync(
    path.join(cwd, 'totem.yaml'),
    `targets:\n  - glob: "${config.targets[0].glob}"\n    type: ${config.targets[0].type}\n    strategy: ${config.targets[0].strategy}\ntotemDir: .totem\n`,
    'utf-8',
  );

  const totemDir = path.join(cwd, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  return totemDir;
}

// ─── Self-healing (runSelfHealing) ──────────────────────

describe('runSelfHealing', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Init a git repo so the git status check doesn't fail
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });

    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it('reports no data when ledger is empty', async () => {
    setupSelfHealingWorkspace(tmpDir);

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No ledger data');
  });

  it('reports healthy when no rules exceed threshold', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 1 bypass out of 10 total = 10% < 30% threshold
    writeLedger(totemDir, [makeLedgerEvent('rule-a')]);
    writeMetrics(totemDir, {
      'rule-a': { triggerCount: 9, suppressCount: 1 },
    });

    // Write compiled rules so the file exists
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-a', lessonHeading: 'Healthy rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No rules exceed the 30% bypass threshold');
  });

  it('downgrades rules exceeding 30% bypass rate', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 4 bypasses + 3 triggers = 7 total, rate = 4/7 ≈ 57%
    writeLedger(totemDir, [
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
      makeLedgerEvent('rule-noisy'),
    ]);
    writeMetrics(totemDir, {
      'rule-noisy': { triggerCount: 3, suppressCount: 4 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-noisy', lessonHeading: 'Noisy Rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit the rules file so git status --porcelain is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    // After runSelfHealing, it switches back to the original branch via `git checkout -`.
    // The downgraded file lives on the auto-downgrade branch.
    // Verify the downgrade through console output and the branch's committed content.
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Noisy Rule');
    expect(output).toContain('Downgraded 1 rule(s)');

    // Find the auto-downgrade branch and verify the committed file
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf-8' });
    expect(branches).toContain('totem/auto-downgrade-');

    // Check the committed file on the branch
    const branchName = branches
      .split('\n')
      .map((b: string) => b.trim())
      .find((b: string) => b.startsWith('totem/auto-downgrade-'));
    expect(branchName).toBeDefined();

    const showResult = spawnSync('git', ['show', `${branchName}:.totem/compiled-rules.json`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const committedContent = showResult.stdout ?? '';
    const committedRules = JSON.parse(committedContent);
    expect(committedRules.rules[0].severity).toBe('warning');
  });

  it('skips rules with fewer than MIN_EVENTS total events', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 2 bypasses + 1 trigger = 3 total events < MIN_EVENTS (5)
    // bypass rate = 2/3 ≈ 67% — exceeds threshold but too few events
    writeLedger(totemDir, [makeLedgerEvent('rule-tiny'), makeLedgerEvent('rule-tiny')]);
    writeMetrics(totemDir, {
      'rule-tiny': { triggerCount: 1, suppressCount: 2 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-tiny', lessonHeading: 'Tiny Sample Rule', severity: 'error' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    await runSelfHealing(tmpDir);

    // Rule should NOT be downgraded — still at error severity
    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('error');

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('No rules exceed the 30% bypass threshold');
  });

  it('skips rules already at warning severity', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // 4 bypasses + 2 triggers = 6 total, rate = 4/6 ≈ 67%
    writeLedger(totemDir, [
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
      makeLedgerEvent('rule-warn'),
    ]);
    writeMetrics(totemDir, {
      'rule-warn': { triggerCount: 2, suppressCount: 4 },
    });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-warn', lessonHeading: 'Already Warning', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so git status is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    // Rule should remain at warning — not modified
    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('warning');

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('already at warning');
    expect(output).toContain('All struggling rules already downgraded');
  });

  it('exports constants for testing', () => {
    expect(BYPASS_THRESHOLD).toBe(0.3);
    expect(MIN_EVENTS).toBe(5);
  });
});

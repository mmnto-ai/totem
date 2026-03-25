import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiagnosticResult } from './doctor.js';
import {
  checkCompiledRules,
  checkConfig,
  checkEmbeddingConfig,
  checkGitHooks,
  checkIndex,
  checkSecretLeaks,
  checkSecretsFileTracked,
  doctorCommand,
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

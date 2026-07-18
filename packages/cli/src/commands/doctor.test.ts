import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import type { DiagnosticResult } from './doctor.js';
import {
  AGENTS_MD_REDIRECT_PATTERN,
  BYPASS_THRESHOLD,
  checkAgentsMdCanonical,
  checkCompiledRules,
  checkConfig,
  checkEmbeddingConfig,
  checkFreezes,
  checkGitHooks,
  checkGrandfatheredRules,
  checkIndex,
  checkLinkedIndexes,
  checkOllama,
  checkSecretLeaks,
  checkSecretsFileTracked,
  checkStaleRules,
  checkStrategyRoot,
  checkUpgradeCandidates,
  CLAUDE_MD_REDIRECT_MAX_BYTES,
  doctorCommand,
  doctorGateFailed,
  findLegacyGrandfatheredRules,
  findStaleRules,
  MIN_CONTEXT_EVENTS,
  MIN_EVENTS,
  NON_CODE_THRESHOLD,
  resolveStrictTier,
  runSelfHealing,
  V_1_13_0_SHIP_DATE_ISO,
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
    cleanTmpDir(tmpDir);
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
    cleanTmpDir(tmpDir);
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
      cleanTmpDir(tmpDir);
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
      cleanTmpDir(tmpDir);
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
      cleanTmpDir(tmpDir);
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
    cleanTmpDir(tmpDir);
  });

  it('returns pass when no secrets are found', async () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\nNo secrets here.');
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No leaked keys detected');
  });

  it('returns fail when a real key pattern is found', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'Use this key: sk-abcdefghijklmnopqrstuvwxyz1234567890',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('does NOT flag placeholder strings as leaks', async () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), 'Set your key: sk-your-key-here-placeholder');
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('returns pass when no files to scan exist', async () => {
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toBe('No files to scan');
  });

  it('detects GitHub personal access tokens', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678a',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('detects Google API keys', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      'key: AIzaSyA1234567890abcdefghijklmnopqrstuvw',
    );
    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
  });

  it('scans lesson files in .totem/lessons/', async () => {
    const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'secret-lesson.md'),
      'Do not use: sk-ant-abcdefghijklmnopqrstuvwxyz',
    );
    const result = await checkSecretLeaks(tmpDir);
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
    cleanTmpDir(tmpDir);
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

  // mmnto-ai/totem#1908 — Missing env key is operator-setup state, not a
  // repo defect; classified as `warn` so `doctor --strict` doesn't gate on
  // CI environments that intentionally lack the key. Mirrors `checkOllama`
  // warn-on-unreachable. CI workflow `totem-doctor.yml` regression coverage.

  it('returns warn (not fail) when OpenAI configured but OPENAI_API_KEY missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [], embedding: { provider: 'openai' } };",
    );
    const originalKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const result = checkEmbeddingConfig(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('OPENAI_API_KEY missing');
      expect(result.remediation).toContain('OPENAI_API_KEY');
    } finally {
      if (originalKey !== undefined) process.env['OPENAI_API_KEY'] = originalKey;
    }
  });

  it('returns warn (not fail) when Gemini configured but API key missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      "export default { targets: [], embedding: { provider: 'gemini' } };",
    );
    const originalGemini = process.env['GEMINI_API_KEY'];
    const originalGoogle = process.env['GOOGLE_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    try {
      const result = checkEmbeddingConfig(tmpDir);
      expect(result.status).toBe('warn');
      expect(result.message).toContain('API key missing');
      expect(result.remediation).toContain('GEMINI_API_KEY');
    } finally {
      if (originalGemini !== undefined) process.env['GEMINI_API_KEY'] = originalGemini;
      if (originalGoogle !== undefined) process.env['GOOGLE_API_KEY'] = originalGoogle;
    }
  });
});

// ─── Ollama probe (mmnto-ai/totem#1851) ─────────────────

describe('checkOllama', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'pass' when Ollama is reachable at the default URL", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );

    const result = await checkOllama();
    expect(result.name).toBe('Ollama');
    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://localhost:11434');
  });

  it("returns 'warn' with floor recommendation when Ollama is not reachable", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const result = await checkOllama();
    expect(result.name).toBe('Ollama');
    expect(result.status).toBe('warn');
    expect(result.message).toContain('not reachable');
    expect(result.message).toContain('floor not satisfied');
    expect(result.remediation).toBeDefined();
    expect(result.remediation).toContain('https://ollama.com');
    expect(result.remediation).toContain('ollama pull nomic-embed-text');
  });

  it("returns 'warn' when probe times out (no hang, no throw)", async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    const result = await checkOllama();
    expect(result.status).toBe('warn');
  });

  it("honors custom baseUrl from config when provider is 'ollama'", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request): Promise<Response> => {
        calls.push(typeof url === 'string' ? url : url.toString());
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    );

    const result = await checkOllama({
      embedding: { provider: 'ollama', baseUrl: 'http://ollama.internal:9999' },
    });

    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://ollama.internal:9999');
    expect(calls.some((u) => u.includes('http://ollama.internal:9999/api/tags'))).toBe(true);
  });

  it("ignores embedding.baseUrl when provider is not 'ollama'", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: string | URL | Request): Promise<Response> => {
        calls.push(typeof url === 'string' ? url : url.toString());
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    );

    // Defensive: even if a non-ollama config carries a stray baseUrl-shaped
    // field (it can't via the discriminated union, but checkOllama receives
    // a widened narrow shape), the probe must use the default URL.
    const result = await checkOllama({
      embedding: { provider: 'gemini', baseUrl: 'http://wrong.example:9999' },
    });

    expect(result.status).toBe('pass');
    expect(result.message).toContain('http://localhost:11434');
    expect(calls.some((u) => u.includes('http://localhost:11434/api/tags'))).toBe(true);
    expect(calls.every((u) => !u.includes('http://wrong.example:9999'))).toBe(true);
  });
});

// ─── Index health check ─────────────────────────────────

describe('checkIndex', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns skip when no embedding is configured (Lite tier)', () => {
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const result = checkIndex(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('Lite tier');
  });
});

// ─── doctorCommand integration ──────────────────────────

// Single source of truth for both the diagnostic count and the per-name
// enumeration in this suite. Add a check to `doctorCommand` → add the name
// here. Drift between count and name list is impossible by construction.
const EXPECTED_DIAGNOSTIC_NAMES = [
  'Config',
  'Compiled Rules',
  'Git Hooks',
  'Prepare Wrapper',
  'Embedding',
  'Ollama',
  'Index',
  'Linked Indexes',
  'Strategy Root',
  'Secret Scan',
  'Secrets File Security',
  'AGENTS.md Canonical',
  'Upgrade Candidates',
  'Stale Rules',
  'Grandfathered Rules',
  'Freeze state',
] as const;

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

    // checkOllama transitively probes http://localhost:11434/api/tags via the
    // exported isOllamaAvailable. Force it to resolve `false` deterministically
    // so this integration suite stays environment-independent and doesn't pay
    // the 3s AbortSignal timeout in CI (mmnto-ai/totem#1860 CR R1).
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('runs without throwing', async () => {
    const results = await doctorCommand();
    expect(results).toBeDefined();
    expect(results).toHaveLength(EXPECTED_DIAGNOSTIC_NAMES.length);
  });

  it('returns correct check names', async () => {
    const results = await doctorCommand();
    const names = results.map((r: DiagnosticResult) => r.name);
    expect(names).toEqual(expect.arrayContaining([...EXPECTED_DIAGNOSTIC_NAMES]));
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

    // See sibling describe's beforeEach (mmnto-ai/totem#1860 CR R1).
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('outputs all check names in console output', async () => {
    await doctorCommand();
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Config');
    expect(output).toContain('Compiled Rules');
    expect(output).toContain('Git Hooks');
    expect(output).toContain('Embedding');
    expect(output).toContain('Ollama');
    expect(output).toContain('Index');
    expect(output).toContain('Linked Indexes');
    expect(output).toContain('Secret Scan');
    expect(output).toContain('Secrets File Security');
    expect(output).toContain('Upgrade Candidates');
    expect(output).toContain('Stale Rules');
  });

  it('outputs summary line with pass/warn/fail counts', async () => {
    await doctorCommand();
    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toMatch(/\d+ passed/);
    expect(output).toMatch(/\d+ warnings/);
    expect(output).toMatch(/\d+ failures/);
  });
});

// ─── Strict mode contract (mmnto-ai/totem#1908) ─────────
//
// `doctorCommand` itself is unchanged — it returns `DiagnosticResult[]` and
// does NOT touch `process.exit` / `process.exitCode`. The exit-code decision
// lives at the CLI edge (`packages/cli/src/index.ts` doctor action handler).
// These tests lock that contract: the function stays composable and the
// strict flag does not introduce process-exit side effects deep in the call
// graph (Tenet 4 / process-exit-masking trap from spec § Edge Cases).

describe('doctorCommand strict mode contract', () => {
  let tmpDir: string;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    originalExitCode = process.exitCode;

    // Minimal workspace (matches sibling describes).
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default { targets: [] };');
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [] }),
    );

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('does not modify process.exitCode when strict is true (CLI edge owns gating)', async () => {
    // Seed a guaranteed failure: no config means checkConfig returns `fail`.
    fs.unlinkSync(path.join(tmpDir, 'totem.config.ts'));
    process.exitCode = undefined;

    const results = await doctorCommand({ strict: true });

    expect(results.some((r: DiagnosticResult) => r.status === 'fail')).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not call process.exit regardless of strict flag', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_: number) => {
      throw new Error('process.exit should not be called by doctorCommand');
    }) as never);

    await doctorCommand({ strict: true });
    await doctorCommand({ strict: false });
    await doctorCommand();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('returns the same DiagnosticResult[] shape regardless of strict flag', async () => {
    const resultsStrict = await doctorCommand({ strict: true });
    const resultsLoose = await doctorCommand({ strict: false });

    expect(resultsStrict.map((r: DiagnosticResult) => r.name)).toEqual(
      resultsLoose.map((r: DiagnosticResult) => r.name),
    );
  });
});

// ─── Strict-warn tier (mmnto-ai/totem#2385) ─────────────
//
// `--strict=warn` upgrades the CLI-edge gate so warn-class diagnostics also
// exit non-zero — the machine-checkable all-wiring oracle. These helpers are
// pure; the exit-code mapping itself stays at the CLI edge.

describe('resolveStrictTier', () => {
  it('returns undefined when strict mode is off', async () => {
    await expect(resolveStrictTier(undefined)).resolves.toBeUndefined();
    await expect(resolveStrictTier(false)).resolves.toBeUndefined();
  });

  it('maps the bare flag and the explicit fail tier to fail', async () => {
    await expect(resolveStrictTier(true)).resolves.toBe('fail');
    await expect(resolveStrictTier('fail')).resolves.toBe('fail');
  });

  it('maps the warn tier', async () => {
    await expect(resolveStrictTier('warn')).resolves.toBe('warn');
  });

  it('throws fail-loud on an unknown tier', async () => {
    await expect(resolveStrictTier('banana')).rejects.toThrow('Unknown --strict tier "banana"');
    await expect(resolveStrictTier('')).rejects.toThrow('Unknown --strict tier');
  });
});

describe('doctorGateFailed', () => {
  const clean: DiagnosticResult[] = [
    { name: 'A', status: 'pass', message: '' },
    { name: 'B', status: 'skip', message: '' },
  ];
  const withWarn: DiagnosticResult[] = [...clean, { name: 'C', status: 'warn', message: '' }];
  const withFail: DiagnosticResult[] = [...clean, { name: 'D', status: 'fail', message: '' }];

  it('fail tier gates on fail only (pre-#2385 contract)', () => {
    expect(doctorGateFailed(clean, 'fail')).toBe(false);
    expect(doctorGateFailed(withWarn, 'fail')).toBe(false);
    expect(doctorGateFailed(withFail, 'fail')).toBe(true);
  });

  it('warn tier gates on warn and fail (all-wiring oracle)', () => {
    expect(doctorGateFailed(clean, 'warn')).toBe(false);
    expect(doctorGateFailed(withWarn, 'warn')).toBe(true);
    expect(doctorGateFailed(withFail, 'warn')).toBe(true);
  });

  it('skip never gates in either tier', () => {
    const onlySkip: DiagnosticResult[] = [{ name: 'S', status: 'skip', message: '' }];
    expect(doctorGateFailed(onlySkip, 'fail')).toBe(false);
    expect(doctorGateFailed(onlySkip, 'warn')).toBe(false);
  });
});

// ─── Secrets file tracking check ────────────────────────

describe('checkSecretsFileTracked', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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

// ─── AGENTS.md canonical redirect check (Proposal 272 § 6.7 / #1905) ──

describe('checkAgentsMdCanonical', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function makeProjectRoot(): void {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"fixture"}');
  }

  function canonicalRedirect(repoSlug = 'mmnto-ai/fixture'): string {
    return [
      '# Fixture: Claude Code Entry Point',
      '',
      'The canonical agent instructions for this repository live in [`AGENTS.md`](AGENTS.md).',
      '',
      `Per [Totem ADR-038 "AGENTS.md Standard Adoption"](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-038-agents-md-standard.md), \`${repoSlug}\` uses a single \`AGENTS.md\` as the source of truth for how all AI coding agents (Claude Code, Gemini CLI, Cursor, etc.) should behave here. This file exists only so Claude Code finds its way to \`AGENTS.md\`.`,
      '',
      'Read `AGENTS.md` before doing anything else.',
      '',
    ].join('\n');
  }

  it('skips non-project directories', () => {
    // No package.json, no .git
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('not a project root');
  });

  it('passes when CLAUDE.md is absent', () => {
    makeProjectRoot();
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no CLAUDE.md');
  });

  it('passes for a canonical cohort redirect (under threshold)', () => {
    makeProjectRoot();
    const redirect = canonicalRedirect();
    expect(Buffer.byteLength(redirect, 'utf-8')).toBeLessThanOrEqual(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), redirect);
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'canonical');

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('redirect');
  });

  it('fails when CLAUDE.md is fat and does not match the redirect pattern', () => {
    makeProjectRoot();
    const fat = `# Project Rules\n\n${'Some load-bearing rule that should live in AGENTS.md. '.repeat(20)}`;
    expect(Buffer.byteLength(fat, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), fat);

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('not a redirect');
    expect(result.remediation).toContain('AGENTS.md');
  });

  it('passes for a verbose redirect (over threshold but matches pattern) with AGENTS.md present', () => {
    makeProjectRoot();
    // Pad the redirect with an extra paragraph above the threshold while
    // keeping the canonical phrase + link intact.
    const verbose =
      canonicalRedirect() +
      '\n\n## Local addendum\n\n' +
      'Long-form addendum for a downstream consumer that needs vendor-specific notes. '.repeat(4);
    expect(Buffer.byteLength(verbose, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), verbose);
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'canonical');

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('verbose redirect');
  });

  it('fails when CLAUDE.md is a verbose redirect but AGENTS.md is missing', () => {
    makeProjectRoot();
    const verbose =
      canonicalRedirect() +
      '\n\n## Addendum\n\n' +
      'Long-form addendum for a downstream consumer. '.repeat(8);
    expect(Buffer.byteLength(verbose, 'utf-8')).toBeGreaterThan(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), verbose);
    // No AGENTS.md

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('AGENTS.md does not exist');
    expect(result.remediation).toContain('Create AGENTS.md');
  });

  it('fails when a small CLAUDE.md matches the redirect pattern but AGENTS.md is missing', () => {
    // Defends against the template-copied-but-AGENTS.md-not-authored case.
    // The AGENTS.md existence requirement is independent of file size.
    makeProjectRoot();
    const redirect = canonicalRedirect();
    expect(Buffer.byteLength(redirect, 'utf-8')).toBeLessThanOrEqual(CLAUDE_MD_REDIRECT_MAX_BYTES);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), redirect);
    // No AGENTS.md — the test surface

    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('AGENTS.md does not exist');
  });

  it('recognizes a bare .git directory as a project root', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    // No package.json, no CLAUDE.md — should pass (nothing to enforce)
    const result = checkAgentsMdCanonical(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no CLAUDE.md');
  });

  it('redirect pattern is case-insensitive on the canonical phrase', () => {
    expect(
      AGENTS_MD_REDIRECT_PATTERN.test(
        'The Canonical Agent Instructions for this repository live in [`AGENTS.md`](AGENTS.md).',
      ),
    ).toBe(true);
  });

  it('redirect pattern rejects content that mentions AGENTS.md without the canonical delegation phrase', () => {
    expect(AGENTS_MD_REDIRECT_PATTERN.test('See [`AGENTS.md`](AGENTS.md) for more info.')).toBe(
      false,
    );
  });
});

// ─── Custom secret scanning ────────────────────────────

describe('checkSecretLeaks with custom secrets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('detects custom literal secrets in lesson files', async () => {
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

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('detects custom regex pattern secrets in lesson files', async () => {
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

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('fail');
    expect(result.message).toContain('potential leaked key');
  });

  it('passes when custom secrets do not match any files', async () => {
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

    const result = await checkSecretLeaks(tmpDir);
    expect(result.status).toBe('pass');
  });
});

// ─── Upgrade-candidate helpers (#1131) ─────────────────

interface UpgradeMetricInput {
  triggerCount?: number;
  suppressCount?: number;
  contextCounts?: {
    code?: number;
    string?: number;
    comment?: number;
    regex?: number;
    unknown?: number;
  };
}

function writeUpgradeMetrics(totemDir: string, rules: Record<string, UpgradeMetricInput>): void {
  const cacheDir = path.join(totemDir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const out: Record<string, unknown> = {};
  for (const [hash, m] of Object.entries(rules)) {
    const entry: Record<string, unknown> = {
      triggerCount: m.triggerCount ?? 0,
      suppressCount: m.suppressCount ?? 0,
      lastTriggeredAt: '2026-04-06T12:00:00.000Z',
      lastSuppressedAt: null,
    };
    if (m.contextCounts) {
      entry.contextCounts = {
        code: m.contextCounts.code ?? 0,
        string: m.contextCounts.string ?? 0,
        comment: m.contextCounts.comment ?? 0,
        regex: m.contextCounts.regex ?? 0,
        unknown: m.contextCounts.unknown ?? 0,
      };
    }
    out[hash] = entry;
  }
  fs.writeFileSync(
    path.join(cacheDir, 'rule-metrics.json'),
    JSON.stringify({ version: 1, rules: out }, null, 2) + '\n',
    'utf-8',
  );
}

interface UpgradeRuleInput {
  lessonHash: string;
  lessonHeading?: string;
  /** Override to produce a manual-rule shape (lessonHeading === message). */
  message?: string;
  /** Set true to mark rule as Pipeline 1 manual (#1265) — preferred over heading=message heuristic. */
  manual?: boolean;
  engine?: 'regex' | 'ast' | 'ast-grep';
  pattern?: string;
  astQuery?: string;
  astGrepPattern?: string;
}

function writeUpgradeRules(totemDir: string, rules: UpgradeRuleInput[]): void {
  fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify(
      {
        version: 1,
        rules: rules.map((r) => {
          const engine = r.engine ?? 'regex';
          const base = {
            lessonHash: r.lessonHash,
            lessonHeading: r.lessonHeading ?? r.lessonHash,
            message: r.message ?? `Violation: ${r.lessonHeading ?? r.lessonHash}`,
            engine,
            compiledAt: '2026-04-06T12:00:00.000Z',
            ...(r.manual === true ? { manual: true } : {}),
          };
          if (engine === 'regex') {
            return { ...base, pattern: r.pattern ?? '\\bconsole\\.log\\b' };
          }
          if (engine === 'ast') {
            return {
              ...base,
              pattern: '',
              astQuery: r.astQuery ?? '(call_expression) @violation',
            };
          }
          // ast-grep
          return {
            ...base,
            pattern: '',
            astGrepPattern: r.astGrepPattern ?? 'console.log($ARG)',
          };
        }),
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

// ─── checkUpgradeCandidates (#1131) ────────────────────

describe('checkUpgradeCandidates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('exposes the constants that govern flagging', () => {
    expect(NON_CODE_THRESHOLD).toBe(0.2);
    expect(MIN_CONTEXT_EVENTS).toBe(5);
  });

  it('skips when compiled-rules.json is missing', async () => {
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('missing');
  });

  it('passes when no metrics exist', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'rule-empty', lessonHeading: 'Empty rule' }]);
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('flags a rule with 40% non-code matches (3 code + 2 string)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'noisy-rule', lessonHeading: 'Noisy regex' }]);
    writeUpgradeMetrics(totemDir, {
      'noisy-rule': {
        triggerCount: 5,
        contextCounts: { code: 3, string: 2 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('noisy-rule');
    expect(result.message).toContain('40%');
    expect(result.remediation).toContain('totem lesson compile --upgrade noisy-rule');
  });

  it('does NOT flag a rule at exactly 20% non-code (strict greater-than)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'boundary-rule', lessonHeading: 'Boundary' }]);
    writeUpgradeMetrics(totemDir, {
      'boundary-rule': {
        triggerCount: 5,
        // 4 code + 1 string = 5 total, 1/5 = 20% non-code (NOT > 20%)
        contextCounts: { code: 4, string: 1 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips rules with fewer than MIN_CONTEXT_EVENTS total matches', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'low-volume', lessonHeading: 'Low volume rule' }]);
    writeUpgradeMetrics(totemDir, {
      'low-volume': {
        triggerCount: 4,
        // 100% non-code, but only 4 events → below MIN_CONTEXT_EVENTS
        contextCounts: { code: 0, string: 4 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips ast-grep rules regardless of telemetry', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'astgrep-rule',
        lessonHeading: 'Already structural',
        engine: 'ast-grep',
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'astgrep-rule': {
        triggerCount: 10,
        contextCounts: { code: 1, string: 9 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips rules without contextCounts telemetry silently', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [{ lessonHash: 'no-telemetry', lessonHeading: 'No telemetry' }]);
    writeUpgradeMetrics(totemDir, {
      'no-telemetry': {
        triggerCount: 100,
        // No contextCounts at all (legacy metric)
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips legacy ast-engine rules because their telemetry lands in unknown', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      { lessonHash: 'ast-noisy', lessonHeading: 'Noisy AST', engine: 'ast' },
    ]);
    writeUpgradeMetrics(totemDir, {
      'ast-noisy': {
        triggerCount: 10,
        contextCounts: { code: 2, comment: 8 },
      },
    });

    // Legacy `ast` (Tree-sitter) rules do not populate `astContext`, so their
    // context distribution is not trustworthy. checkUpgradeCandidates scopes to
    // `engine === 'regex'` only.
    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips manual regex rules (message === lessonHeading) — legacy heuristic', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    // Pre-#1265 manual rule: message === lessonHeading. This was the only signal
    // available for identifying Pipeline 1 rules before the explicit `manual: true`
    // flag landed. Old compiled-rules.json files don't have the flag, so the doctor
    // must continue to support this heuristic for backward compatibility.
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'manual-rule',
        lessonHeading: 'No console.log',
        message: 'No console.log',
        engine: 'regex',
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'manual-rule': {
        triggerCount: 20,
        contextCounts: { code: 2, string: 18, comment: 0, regex: 0, unknown: 0 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips manual regex rules with rich messages via the manual flag (#1265)', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    // Post-#1265 manual rule: message DIFFERS from lessonHeading because Pipeline 1
    // now supports a **Message:** field. The legacy heading=message heuristic would
    // FAIL to skip this rule, but the explicit `manual: true` flag set by
    // buildManualRule provides a reliable signal. Without this fix, doctor would
    // try to upgrade the rule via Pipeline 2, burning LLM cycles to produce the
    // same hand-written manual pattern that takes Pipeline 1 priority on next compile.
    writeUpgradeRules(totemDir, [
      {
        lessonHash: 'manual-rule-with-message',
        lessonHeading: 'No console.log',
        message:
          'Use the structured logger (logger.info) instead of console.log so production output stays filterable.',
        engine: 'regex',
        manual: true,
      },
    ]);
    writeUpgradeMetrics(totemDir, {
      'manual-rule-with-message': {
        triggerCount: 20,
        contextCounts: { code: 2, string: 18, comment: 0, regex: 0, unknown: 0 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('skips the unknown bucket when computing non-code ratio', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeUpgradeRules(totemDir, [
      { lessonHash: 'mostly-historical', lessonHeading: 'Historical', engine: 'regex' },
    ]);
    writeUpgradeMetrics(totemDir, {
      'mostly-historical': {
        triggerCount: 100,
        // 100 historical hits + 5 recent classified: 5 code, 0 non-code.
        // Old math: (0 + 100) / 105 = 95% "non-code" → false positive.
        // New math: 0 / 5 = 0% → pass.
        contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 100 },
      },
    });

    const result = await checkUpgradeCandidates(tmpDir);
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
    // Configure git user for CI environments where global config is missing
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });

    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
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
    expect(branches).toContain('totem/auto-healing-');

    // Check the committed file on the branch
    const branchName = branches
      .split('\n')
      .map((b: string) => b.trim())
      .find((b: string) => b.startsWith('totem/auto-healing-'));
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
  });

  it('exports constants for testing', () => {
    expect(BYPASS_THRESHOLD).toBe(0.3);
    expect(MIN_EVENTS).toBe(5);
  });

  it('runs the upgrade phase without crashing when no candidates exist (mmnto/totem#1131)', async () => {
    // No metrics → no candidates → upgrade phase should print "no rules flagged"
    const totemDir = setupSelfHealingWorkspace(tmpDir);
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'rule-clean', lessonHeading: 'Clean rule', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so the working tree is clean (upgrade phase is skipped via gitDirty guard)
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Checking for ast-grep upgrade candidates');
    expect(output).toContain('No rules flagged for upgrade');
  });

  it('detects upgrade candidates and reports them in the upgrade phase (mmnto/totem#1131)', async () => {
    const totemDir = setupSelfHealingWorkspace(tmpDir);

    // Write a regex rule with telemetry showing 60% non-code matches
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify(
        makeCompiledRules([
          { lessonHash: 'noisy-regex', lessonHeading: 'Noisy regex rule', severity: 'warning' },
        ]),
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    const cacheDir = path.join(totemDir, 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, 'rule-metrics.json'),
      JSON.stringify(
        {
          version: 1,
          rules: {
            'noisy-regex': {
              triggerCount: 10,
              suppressCount: 0,
              lastTriggeredAt: '2026-04-06T12:00:00.000Z',
              lastSuppressedAt: null,
              contextCounts: { code: 4, string: 6, comment: 0, regex: 0, unknown: 0 },
            },
          },
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Commit so the working tree is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    // The phase should detect the candidate and attempt to upgrade it.
    // The actual `pnpm exec totem compile --upgrade` call will likely fail in the test
    // sandbox (no orchestrator config / no LLM) — that's expected. We're just verifying
    // the candidate was detected and the phase ran end-to-end.
    expect(output).toContain('Checking for ast-grep upgrade candidates');
    expect(output).toContain('Found 1 upgrade candidate');
  });

  it('archives stale rules with zero triggers during self-healing', async () => {
    // Set up workspace with GC enabled
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });

    // Config with garbageCollection enabled
    fs.writeFileSync(
      path.join(tmpDir, 'totem.yaml'),
      [
        'targets:',
        '  - glob: "**/*.ts"',
        '    type: code',
        '    strategy: typescript-ast',
        'totemDir: .totem',
        'garbageCollection:',
        '  enabled: true',
        '  minAgeDays: 90',
        '  exemptCategories:',
        '    - security',
      ].join('\n') + '\n',
      'utf-8',
    );

    // Create an old rule (compiledAt 120 days ago)
    const oldDate = new Date('2026-03-30T00:00:00.000Z');
    oldDate.setDate(oldDate.getDate() - 120);
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          version: 1,
          rules: [
            {
              lessonHash: 'stale-rule',
              lessonHeading: 'Stale Rule',
              pattern: '\\bconsole\\.log\\b',
              message: 'Violation: Stale Rule',
              engine: 'regex',
              compiledAt: oldDate.toISOString(),
              status: 'active',
            },
          ],
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );

    // Write metrics with zero activity for the rule
    writeMetrics(totemDir, {
      'stale-rule': { triggerCount: 0, suppressCount: 0 },
    });

    // Commit so git status is clean
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await runSelfHealing(tmpDir);

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    expect(output).toContain('Archived 1 stale rule(s)');

    // Verify the rule was archived — the function switches back to original branch,
    // but the GC changes are committed on a healing branch.
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf-8' });
    const healingBranch = branches
      .split('\n')
      .map((b: string) => b.trim())
      .find((b: string) => b.startsWith('totem/auto-healing-'));
    expect(healingBranch).toBeDefined();

    // Verify committed file on the branch
    const showResult = spawnSync('git', ['show', `${healingBranch}:.totem/compiled-rules.json`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const committedRules = JSON.parse(showResult.stdout ?? '');
    expect(committedRules.rules[0].status).toBe('archived');
    expect(committedRules.rules[0].archivedReason).toMatch(/after \d+ days/);
  });
});

// ─── Linked indexes health check (#1308) ────────────────

describe('checkLinkedIndexes (#1308)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns skip when no linkedIndexes configured', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
};`,
    );
    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.name).toBe('Linked Indexes');
  });

  it('returns skip when host has no embedding provider', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  linkedIndexes: ['../other-repo'],
};`,
    );
    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('Lite tier');
  });

  it('returns pass when linked index is reachable', () => {
    const linkedDir = makeTmpDir();
    try {
      // Set up the linked repo with a config and .lancedb
      fs.writeFileSync(
        path.join(linkedDir, 'totem.config.ts'),
        `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
};`,
      );
      const lanceDir = path.join(linkedDir, '.lancedb');
      fs.mkdirSync(lanceDir, { recursive: true });
      fs.writeFileSync(path.join(lanceDir, 'data.lance'), 'placeholder');

      // Escape backslashes for Windows paths in the config template
      const escapedPath = linkedDir.replace(/\\/g, '\\\\');
      fs.writeFileSync(
        path.join(tmpDir, 'totem.config.ts'),
        `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
  linkedIndexes: ['${escapedPath}'],
};`,
      );

      const result = checkLinkedIndexes(tmpDir);
      expect(result.status).toBe('pass');
      expect(result.name).toBe('Linked Indexes');
      expect(result.message).toContain('1 configured');
      expect(result.message).toContain('1 reachable');
    } finally {
      cleanTmpDir(linkedDir);
    }
  });

  it('returns warn when linked index path does not exist', () => {
    const nonExistentPath = path.join(tmpDir, 'no-such-repo');
    const escapedPath = nonExistentPath.replace(/\\/g, '\\\\');
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      `export default {
  targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
  totemDir: '.totem',
  embedding: { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 },
  linkedIndexes: ['${escapedPath}'],
};`,
    );

    const result = checkLinkedIndexes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.name).toBe('Linked Indexes');
    expect(result.remediation).toContain('does not exist');
  });
});

// ─── Strategy root (mmnto-ai/totem#1710) ──────────────────

describe('checkStrategyRoot (mmnto-ai/totem#1710)', () => {
  let tmpDir: string;
  let prevEnvPrimary: string | undefined;
  let prevEnvAlias: string | undefined;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    prevEnvPrimary = process.env.TOTEM_STRATEGY_ROOT;
    prevEnvAlias = process.env.STRATEGY_ROOT;
    delete process.env.TOTEM_STRATEGY_ROOT;
    delete process.env.STRATEGY_ROOT;
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    // Symmetric restore: when prev was undefined, the env var was unset
    // before this suite ran — DELETE rather than leak the test's value.
    if (prevEnvPrimary === undefined) delete process.env.TOTEM_STRATEGY_ROOT;
    else process.env.TOTEM_STRATEGY_ROOT = prevEnvPrimary;
    if (prevEnvAlias === undefined) delete process.env.STRATEGY_ROOT;
    else process.env.STRATEGY_ROOT = prevEnvAlias;
  });

  it('returns warn (NOT fail) when no strategy root resolves', async () => {
    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.name).toBe('Strategy Root');
    expect(result.remediation).toMatch(/describe_project|proposal|federated/);
  });

  it('returns pass when TOTEM_STRATEGY_ROOT points to a real directory', async () => {
    const target = path.join(tmpDir, 'elsewhere');
    fs.mkdirSync(target, { recursive: true });
    process.env.TOTEM_STRATEGY_ROOT = target;

    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.name).toBe('Strategy Root');
    expect(result.message).toMatch(/^env →/);
  });

  it('strips ANSI/CR/newline/tab control bytes from diagnostic strings (R4/R6 — terminal injection)', async () => {
    // Hostile env value with embedded ANSI + CR + newlines + tabs.
    // Without sanitization the unresolved-path diagnostic would echo
    // these bytes through `log.warn` and rewind the cursor / spoof colors
    // when `totem doctor` rendered it. R6 also flattens \n/\t to prevent
    // forged extra log lines (`sanitizeForTerminal` deliberately preserves
    // \n/\t for multi-line content; the doctor caller flattens).
    process.env.TOTEM_STRATEGY_ROOT = `${tmpDir}/missing\x1b[31mEVIL\x1b[0m\r\n\n[fake] OK\tTAB`;

    const result = await checkStrategyRoot(tmpDir);
    expect(result.status).toBe('warn');
    // Message itself is the static string — the env value flows into
    // `remediation` via `status.reason`.
    expect(result.remediation).toBeDefined();
    expect(result.remediation).not.toMatch(/\x1b\[/);
    expect(result.remediation).not.toMatch(/\r/);
    expect(result.remediation).not.toMatch(/\n/);
    expect(result.remediation).not.toMatch(/\t/);
  });
});

// ─── Stale rules (mmnto-ai/totem#1483) ──────────────────

describe('findStaleRules + checkStaleRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // Seed a 5-rule fixture exercising every branch of findStaleRules:
  //   A: fresh (evaluationCount < window) — should be ignored
  //   B: stale standard (evaluationCount >= window, 0 code hits) — flagged warn
  //   C: stale security via category=security — flagged severe
  //   D: healthy (evaluationCount >= window, code hits > 0) — ignored
  //   E: stale security via immutable=true (no category) — flagged severe
  function seedFixture(tmpDir: string, options: { window: number } = { window: 10 }): void {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });

    const compiledRulesFile = {
      version: 1,
      rules: [
        {
          lessonHash: 'rule-A-fresh',
          lessonHeading: 'Rule A (fresh)',
          pattern: 'foo',
          message: 'A',
          engine: 'regex',
          compiledAt: '2026-04-01T00:00:00.000Z',
          createdAt: '2026-04-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-B-stale',
          lessonHeading: 'Rule B (stale standard)',
          pattern: 'bar',
          message: 'B',
          engine: 'regex',
          compiledAt: '2026-03-01T00:00:00.000Z',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-C-stale-security',
          lessonHeading: 'Rule C (stale security)',
          pattern: 'baz',
          message: 'C',
          engine: 'regex',
          compiledAt: '2026-02-01T00:00:00.000Z',
          createdAt: '2026-02-01T00:00:00.000Z',
          category: 'security' as const,
        },
        {
          lessonHash: 'rule-D-healthy',
          lessonHeading: 'Rule D (healthy)',
          pattern: 'qux',
          message: 'D',
          engine: 'regex',
          compiledAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          lessonHash: 'rule-E-stale-immutable',
          lessonHeading: 'Rule E (stale immutable)',
          pattern: 'zot',
          message: 'E',
          engine: 'regex',
          compiledAt: '2026-02-15T00:00:00.000Z',
          createdAt: '2026-02-15T00:00:00.000Z',
          immutable: true,
        },
      ],
      nonCompilable: [],
    };
    fs.writeFileSync(path.join(totemDir, 'compiled-rules.json'), JSON.stringify(compiledRulesFile));

    const metricsFile = {
      version: 1,
      rules: {
        'rule-A-fresh': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: Math.max(0, options.window - 1),
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-B-stale': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 5,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-C-stale-security': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 2,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-D-healthy': {
          triggerCount: 5,
          suppressCount: 0,
          lastTriggeredAt: '2026-03-15T00:00:00.000Z',
          lastSuppressedAt: null,
          evaluationCount: options.window + 5,
          contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
        'rule-E-stale-immutable': {
          triggerCount: 0,
          suppressCount: 0,
          lastTriggeredAt: null,
          lastSuppressedAt: null,
          evaluationCount: options.window + 3,
          contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
        },
      },
    };
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify(metricsFile),
    );
  }

  it('returns null when compiled-rules.json is missing', async () => {
    const result = await findStaleRules(tmpDir);
    expect(result).toBeNull();
  });

  it('flags stale standard and stale security rules; ignores fresh + healthy', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    expect(result).not.toBeNull();
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toContain('rule-B-stale');
    expect(hashes).toContain('rule-C-stale-security');
    expect(hashes).toContain('rule-E-stale-immutable');
    expect(hashes).not.toContain('rule-A-fresh');
    expect(hashes).not.toContain('rule-D-healthy');
  });

  it('assigns severity "security" to category=security and immutable=true rules, ordering them first', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    expect(result).not.toBeNull();
    // Both security rules come before any standard rule. Among the two
    // security rules, E (evaluationCount 13) sorts ahead of C (12) by the
    // evaluationCount-desc tiebreaker.
    expect(result![0]!.lessonHash).toBe('rule-E-stale-immutable');
    expect(result![0]!.severity).toBe('security');
    expect(result![0]!.flags.immutable).toBe(true);
    expect(result![1]!.lessonHash).toBe('rule-C-stale-security');
    expect(result![1]!.severity).toBe('security');
    expect(result![1]!.flags.category).toBe('security');
    expect(result![2]!.lessonHash).toBe('rule-B-stale');
    expect(result![2]!.severity).toBe('standard');
  });

  it('never recommends archival for security rules (category=security or immutable=true)', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const securityRules = result!.filter((c) => c.severity === 'security');
    expect(securityRules.length).toBe(2);
    for (const security of securityRules) {
      expect(security.recommendation).not.toContain('archived');
      expect(security.recommendation).toContain('Do not archive');
      expect(security.recommendation).toContain('totem compile --upgrade');
    }
  });

  it('recommends either upgrade or archive for standard stale rules', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const standard = result!.find((c) => c.severity === 'standard')!;
    expect(standard.recommendation).toContain('totem compile --upgrade');
    expect(standard.recommendation).toContain('archived');
  });

  it('respects a custom staleRuleWindow threshold passed through the call', async () => {
    // Rule B has evaluationCount 15, Rule C has 12, Rule E has 13. Push the
    // window up to 14 so only Rule B qualifies.
    seedFixture(tmpDir, { window: 10 });
    const result = await findStaleRules(tmpDir, '.totem', { staleRuleWindow: 14 });
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-B-stale']);
  });

  it('flags rules whose evaluationCount exactly equals staleRuleWindow', async () => {
    // Boundary test for the >= semantics at the staleness check site. A rule
    // with evaluationCount === staleRuleWindow and zero code hits must flag.
    // Guards against an off-by-one regression that would flip the check to >.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-boundary',
            lessonHeading: 'exact window',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-boundary': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 10,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir, '.totem', { staleRuleWindow: 10 });
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-boundary']);
  });

  it('never flags rules below staleRuleWindow regardless of zero hits', async () => {
    // Seed a fresh rule with evaluationCount = 0 explicitly; should never
    // flag even after infinite runs.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-zero',
            lessonHeading: 'zero',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-zero': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 0,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips archived rules', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-archived',
            lessonHeading: 'already archived',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'archived',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-archived': {
            triggerCount: 0,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 100,
            contextCounts: { code: 0, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await findStaleRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('checkStaleRules returns pass when no rules are stale', async () => {
    // Only seed a healthy rule.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({
        version: 1,
        rules: [
          {
            lessonHash: 'rule-healthy',
            lessonHeading: 'healthy',
            pattern: 'x',
            message: 'x',
            engine: 'regex',
            compiledAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        nonCompilable: [],
      }),
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify({
        version: 1,
        rules: {
          'rule-healthy': {
            triggerCount: 5,
            suppressCount: 0,
            lastTriggeredAt: null,
            lastSuppressedAt: null,
            evaluationCount: 20,
            contextCounts: { code: 5, string: 0, comment: 0, regex: 0, unknown: 0 },
          },
        },
      }),
    );
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('checkStaleRules returns warn with candidate details when stale rules exist', async () => {
    seedFixture(tmpDir);
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('warn');
    // Structured count check: seedFixture produces 2 security + 1 standard
    // stale rule. Match explicit "N security" / "N standard" phrasing so a
    // renderer change that drops the category split fails loud rather than
    // passing on any digit that happens to appear anywhere in the message.
    expect(result.message).toMatch(/\b2\s+security\b/i);
    expect(result.message).toMatch(/\b1\s+standard\b/i);
    expect(result.remediation).toContain('totem compile --upgrade');
  });

  it('checkStaleRules returns skip when compiled-rules.json is missing', async () => {
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('skip');
  });
});

// ─── Grandfathered rules (mmnto-ai/totem#1603) ──────────

describe('findLegacyGrandfatheredRules + checkGrandfatheredRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function writeRules(tmpDir: string, rules: unknown[]): void {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules, nonCompilable: [] }),
    );
  }

  // Post-1.13.0 timestamp used to neutralize the vintage reason in tests
  // that target a single reason code in isolation.
  const POST_1_13_0 = '2026-04-08T00:00:00.000Z';
  const PRE_1_13_0 = '2026-02-01T00:00:00.000Z';

  it('returns null when compiled-rules.json is missing', async () => {
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toBeNull();
  });

  it('flags a rule for vintage-pre-1.13.0 in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-vintage',
        lessonHeading: 'vintage only',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        badExample: 'bad snippet',
        goodExample: 'good snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-vintage',
        reasons: ['vintage-pre-1.13.0'],
      }),
    ]);
  });

  it('flags a rule for no-badExample in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-bad',
        lessonHeading: 'missing bad',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        goodExample: 'good snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-no-bad',
        reasons: ['no-badExample'],
      }),
    ]);
  });

  it('flags a rule for no-goodExample in isolation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-good',
        lessonHeading: 'missing good',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad snippet',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([
      expect.objectContaining({
        lessonHash: 'rule-no-good',
        reasons: ['no-goodExample'],
      }),
    ]);
  });

  it('treats whitespace-only substrate snippets as absent', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-whitespace',
        lessonHeading: 'whitespace snippets',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: '   ',
        goodExample: '\n\t',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons.sort()).toEqual(['no-badExample', 'no-goodExample']);
  });

  it('aggregates multiple reasons on a single rule', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-all-three',
        lessonHeading: 'full legacy',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons).toEqual(['vintage-pre-1.13.0', 'no-badExample', 'no-goodExample']);
  });

  it('skips archived rules', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-archived',
        lessonHeading: 'archived legacy',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        status: 'archived',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('skips rules with unverified: true (post zero-trust cohort)', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-unverified',
        lessonHeading: 'zero-trust marker present',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
        unverified: true,
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('omits rules that satisfy all three substrate checks', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-substrate-complete',
        lessonHeading: 'fully verified',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('treats vintage at the exact 1.13.0 ship date as NOT pre-1.13.0', async () => {
    // Boundary test: `<` semantics, not `<=`. A rule whose createdAt equals
    // V_1_13_0_SHIP_DATE_ISO shipped with 1.13.0 and carries the substrate
    // expectation forward, so it does not count as vintage.
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-at-boundary',
        lessonHeading: 'boundary',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: V_1_13_0_SHIP_DATE_ISO,
        createdAt: V_1_13_0_SHIP_DATE_ISO,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result).toEqual([]);
  });

  it('falls back to compiledAt when createdAt is absent', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-no-createdat',
        lessonHeading: 'no createdAt',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    expect(result!.length).toBe(1);
    expect(result![0]!.reasons).toEqual(['vintage-pre-1.13.0']);
    expect(result![0]!.vintage).toBe(PRE_1_13_0);
  });

  it('sorts worst-off first, then oldest vintage first', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-one-reason-new',
        lessonHeading: 'one reason, newer vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
      },
      {
        lessonHash: 'rule-all-three-newer',
        lessonHeading: 'three reasons, newer vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: '2026-03-15T00:00:00.000Z',
        createdAt: '2026-03-15T00:00:00.000Z',
      },
      {
        lessonHash: 'rule-all-three-older',
        lessonHeading: 'three reasons, older vintage',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const result = await findLegacyGrandfatheredRules(tmpDir);
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-all-three-older', 'rule-all-three-newer', 'rule-one-reason-new']);
  });

  it('checkGrandfatheredRules returns skip when compiled-rules.json is missing', async () => {
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('skip');
  });

  it('checkGrandfatheredRules returns pass when no rules are grandfathered', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-verified',
        lessonHeading: 'verified',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
        goodExample: 'good',
      },
    ]);
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('pass');
  });

  it('checkGrandfatheredRules returns warn with per-reason counts and ADR-091 remediation', async () => {
    writeRules(tmpDir, [
      {
        lessonHash: 'rule-a',
        lessonHeading: 'A',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: PRE_1_13_0,
        createdAt: PRE_1_13_0,
      },
      {
        lessonHash: 'rule-b',
        lessonHeading: 'B',
        pattern: 'x',
        message: 'x',
        engine: 'regex',
        compiledAt: POST_1_13_0,
        createdAt: POST_1_13_0,
        badExample: 'bad',
      },
    ]);
    const result = await checkGrandfatheredRules(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/2 grandfathered rule\(s\)/);
    expect(result.message).toMatch(/1 vintage-pre-1\.13\.0/);
    expect(result.message).toMatch(/1 no-badExample/);
    expect(result.message).toMatch(/2 no-goodExample/);
    expect(result.remediation).toContain('ADR-091 Stage 4');
    expect(result.remediation).toContain('mmnto-ai/totem#1504');
  });
});

// ─── checkFreezes (#2167 — sensor-only freeze surfacing) ────────────────

describe('checkFreezes', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-freeze-'));
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function installSnapshot(freeze: unknown): void {
    const pkgDir = path.join(tmpDir, 'node_modules', '@mmnto', 'strategy-doctrine');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@mmnto/strategy-doctrine', version: '0.2.0' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'freeze.json'),
      typeof freeze === 'string' ? freeze : JSON.stringify(freeze),
    );
  }

  it('passes with the not-adopted channel note when nothing is frozen anywhere', async () => {
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('No active freezes');
    expect(result.message).toContain('not adopted');
  });

  it('warns (never fails) with provenance tags when freezes are active', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.totem', 'freeze.json'),
      JSON.stringify({ frozen: [{ subsystem: 'embedder', scope: 'local' }] }),
    );
    installSnapshot({
      frozen: [{ subsystem: 'rule-compilation (legacy)', id: 'rule-compilation', scope: 'cohort' }],
    });
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('"embedder" [local]');
    expect(result.message).toContain('[cohort@0.2.0]');
  });

  it('warns on a corrupt distributed snapshot — sensor-only, never a fail status', async () => {
    installSnapshot('{ not json');
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('CORRUPT');
  });

  it('warns (not fail) when the LOCAL freeze file is corrupt — doctor reports, the gate layer gates', async () => {
    fs.writeFileSync(path.join(tmpDir, '.totem', 'freeze.json'), '{ corrupt');
    const result = await checkFreezes(tmpDir);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('underivable');
  });
});

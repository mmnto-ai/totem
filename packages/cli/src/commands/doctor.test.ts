import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import type { DiagnosticResult } from './doctor.js';
import {
  BYPASS_THRESHOLD,
  checkCompiledRules,
  checkConfig,
  checkEmbeddingConfig,
  checkGitHooks,
  checkIndex,
  checkLinkedIndexes,
  checkSecretLeaks,
  checkSecretsFileTracked,
  checkStaleRules,
  checkUpgradeCandidates,
  doctorCommand,
  findStaleRules,
  MIN_CONTEXT_EVENTS,
  MIN_EVENTS,
  NON_CODE_THRESHOLD,
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
    cleanTmpDir(tmpDir);
  });

  it('runs without throwing', async () => {
    const results = await doctorCommand();
    expect(results).toBeDefined();
    expect(results.length).toBe(10);
  });

  it('returns correct check names', async () => {
    const results = await doctorCommand();
    const names = results.map((r: DiagnosticResult) => r.name);
    expect(names).toContain('Config');
    expect(names).toContain('Compiled Rules');
    expect(names).toContain('Git Hooks');
    expect(names).toContain('Embedding');
    expect(names).toContain('Index');
    expect(names).toContain('Linked Indexes');
    expect(names).toContain('Secret Scan');
    expect(names).toContain('Secrets File Security');
    expect(names).toContain('Upgrade Candidates');
    expect(names).toContain('Stale Rules');
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
    cleanTmpDir(tmpDir);
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
    expect(output).toContain('Linked Indexes');
    expect(output).toContain('Secret Scan');
    expect(output).toContain('Secrets File Security');
    expect(output).toContain('Upgrade Candidates');
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

// ─── Stale rules (mmnto-ai/totem#1483) ──────────────────

describe('findStaleRules + checkStaleRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // Seed the 4-rule fixture described in the design doc's test directive:
  //   A: fresh (evaluationCount < minRunsToEvaluate) — should be ignored
  //   B: stale standard (evaluationCount >= window, 0 code hits) — flagged warn
  //   C: stale security (same conditions + category security) — flagged severe
  //   D: healthy (evaluationCount >= window, code hits > 0) — ignored
  function seedFixture(
    tmpDir: string,
    options: { window: number; floor: number } = { window: 10, floor: 3 },
  ): void {
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
          evaluationCount: Math.max(0, options.floor - 1),
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
    expect(hashes).not.toContain('rule-A-fresh');
    expect(hashes).not.toContain('rule-D-healthy');
  });

  it('assigns severity "security" to category=security rules and orders them first', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    expect(result).not.toBeNull();
    // Security first, standard second.
    expect(result![0]!.lessonHash).toBe('rule-C-stale-security');
    expect(result![0]!.severity).toBe('security');
    expect(result![1]!.lessonHash).toBe('rule-B-stale');
    expect(result![1]!.severity).toBe('standard');
  });

  it('never recommends archival for security rules', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const security = result!.find((c) => c.severity === 'security')!;
    expect(security.recommendation).not.toContain('archived');
    expect(security.recommendation).toContain('Do not archive');
    expect(security.recommendation).toContain('totem compile --upgrade');
  });

  it('recommends either upgrade or archive for standard stale rules', async () => {
    seedFixture(tmpDir);
    const result = await findStaleRules(tmpDir);
    const standard = result!.find((c) => c.severity === 'standard')!;
    expect(standard.recommendation).toContain('totem compile --upgrade');
    expect(standard.recommendation).toContain('archived');
  });

  it('respects custom thresholds passed through the call', async () => {
    // Rule B has evaluationCount = 15, Rule C has 12. Push the window up to 13
    // so only Rule B qualifies.
    seedFixture(tmpDir, { window: 10, floor: 3 });
    const result = await findStaleRules(tmpDir, '.totem', {
      staleRuleWindow: 13,
      minRunsToEvaluate: 3,
    });
    const hashes = result!.map((c) => c.lessonHash);
    expect(hashes).toEqual(['rule-B-stale']);
  });

  it('never flags rules below minRunsToEvaluate regardless of zero hits', async () => {
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
    expect(result.message).toContain('2');
    expect(result.message).toContain('security');
    expect(result.message).toContain('standard');
    expect(result.remediation).toContain('totem compile --upgrade');
  });

  it('checkStaleRules returns skip when compiled-rules.json is missing', async () => {
    const result = await checkStaleRules(tmpDir);
    expect(result.status).toBe('skip');
  });
});

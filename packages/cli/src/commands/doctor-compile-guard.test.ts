import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { runSelfHealing } from './doctor.js';

// ─── `doctor --pr`'s upgrade phase meets the compile guard (B1 of mmnto-ai/totem#3036) ──
//
// The upgrade phase calls `compileCommand({ upgradeBatch })`. On a serving file
// that holds a record-path row the compile refuses; the phase must REPORT that
// refusal (naming the right command) and the run must carry on to its later
// phases rather than crash.

const RECORD_ROW_ID = 'rec-0001-record-managed-row';

function ledgerEvent(ruleId: string): string {
  return JSON.stringify({
    timestamp: '2026-03-25T12:00:00.000Z',
    type: 'suppress',
    ruleId,
    file: 'src/index.ts',
    justification: '',
    source: 'lint',
  });
}

describe('runSelfHealing upgrade phase on a record-managed serving file (mmnto-ai/totem#3036 B1)', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-guard-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    stderrSpy.mockRestore();
  });

  it('reports the refusal and carries on to the branch phase, with the record-path row intact', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'totem.yaml'),
      'targets:\n  - glob: "**/*.ts"\n    type: code\n    strategy: typescript-ast\ntotemDir: .totem\n',
      'utf-8',
    );
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(path.join(totemDir, 'ledger'), { recursive: true });
    fs.mkdirSync(path.join(totemDir, 'cache'), { recursive: true });

    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    fs.writeFileSync(
      rulesPath,
      JSON.stringify(
        {
          version: 1,
          rules: [
            // Downgrade candidate: 4 bypasses of 7 events, above the 30% threshold.
            {
              lessonHash: 'rule-noisy',
              lessonHeading: 'Noisy Rule',
              pattern: '\\bconsole\\.log\\b',
              message: 'Violation: Noisy Rule',
              engine: 'regex',
              compiledAt: '2026-03-25T12:00:00.000Z',
              severity: 'error',
            },
            // Upgrade candidate: 60% of classified matches in non-code contexts.
            {
              lessonHash: 'noisy-regex',
              lessonHeading: 'Noisy regex rule',
              pattern: '\\bconsole\\.log\\b',
              message: 'Violation: Noisy regex rule',
              engine: 'regex',
              compiledAt: '2026-03-25T12:00:00.000Z',
              severity: 'warning',
            },
            // The record-path row the compile guard protects.
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
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(totemDir, 'ledger', 'events.ndjson'),
      [1, 2, 3, 4].map(() => ledgerEvent('rule-noisy')).join('\n') + '\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(totemDir, 'cache', 'rule-metrics.json'),
      JSON.stringify(
        {
          version: 1,
          rules: {
            'rule-noisy': {
              triggerCount: 3,
              suppressCount: 4,
              lastTriggeredAt: '2026-03-25T12:00:00.000Z',
              lastSuppressedAt: null,
            },
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
    execSync('git add .', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });

    await expect(runSelfHealing(tmpDir)).resolves.toBeUndefined();

    const output = stderrSpy.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');
    // The upgrade phase ran, met the refusal, and reported it by name.
    expect(output).toContain('Found 1 upgrade candidate');
    expect(output).toContain('totem rule serve');
    // ...and the run carried on past it: the branch phase committed the downgrade.
    const branches = execSync('git branch', { cwd: tmpDir, encoding: 'utf-8' });
    const healingBranch = branches
      .split('\n')
      .map((b: string) => b.replace('*', '').trim())
      .find((b: string) => b.startsWith('totem/auto-healing-'));
    expect(healingBranch).toBeDefined();
    const shown = spawnSync('git', ['show', `${healingBranch}:.totem/compiled-rules.json`], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    const committed = JSON.parse(shown.stdout ?? '') as {
      rules: Array<{ lessonHash: string; severity?: string }>;
    };
    expect(committed.rules.find((r) => r.lessonHash === 'rule-noisy')?.severity).toBe('warning');
    expect(committed.rules.map((r) => r.lessonHash)).toContain(RECORD_ROW_ID);
  }, 60000);
});

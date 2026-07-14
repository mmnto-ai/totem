import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveRuleCompilationFrozen, isRootHelpInvocation } from './help-freeze.js';

describe('deriveRuleCompilationFrozen (mmnto-ai/totem#2336 D2.4 freeze badge)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'totem-help-freeze-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Isolate to the LOCAL freeze read — a non-resolvable snapshot package name
  // means the cohort channel never contributes, so the fixture freeze.json is
  // the sole input regardless of what's installed in the test environment.
  const ISOLATE = { packageName: '@mmnto/totem-nonexistent-doctrine-fixture' };

  function writeFreeze(entries: unknown[]): void {
    mkdirSync(join(dir, '.totem'), { recursive: true });
    writeFileSync(join(dir, '.totem', 'freeze.json'), JSON.stringify({ frozen: entries }));
  }

  it('returns true when a rule-compilation freeze is visible', async () => {
    writeFreeze([
      {
        subsystem: 'rule-compilation (legacy lesson-compile path)',
        id: 'rule-compilation',
        scope: 'local',
      },
    ]);
    expect(await deriveRuleCompilationFrozen(dir, ISOLATE)).toBe(true);
  });

  it('returns false when no freeze.json exists (plain help)', async () => {
    expect(await deriveRuleCompilationFrozen(dir, ISOLATE)).toBe(false);
  });

  it('returns false when a freeze exists but not for rule-compilation', async () => {
    writeFreeze([{ subsystem: 'something-else', id: 'something-else', scope: 'local' }]);
    expect(await deriveRuleCompilationFrozen(dir, ISOLATE)).toBe(false);
  });

  it('resolves the doctrine pin package by default without throwing', async () => {
    // Exercises the default packageName path (imports init-doctrine's
    // DOCTRINE_PIN_PACKAGE). The temp dir resolves no snapshot, so the local
    // fixture freeze is the sole input.
    writeFreeze([{ subsystem: 'rc', id: 'rule-compilation', scope: 'local' }]);
    expect(await deriveRuleCompilationFrozen(dir)).toBe(true);
  });
});

describe('isRootHelpInvocation (freeze read fires only on root help)', () => {
  it('is true for bare root help', () => {
    expect(isRootHelpInvocation(['--help'])).toBe(true);
    expect(isRootHelpInvocation(['-h'])).toBe(true);
  });

  it('is true for root help alongside global flags', () => {
    expect(isRootHelpInvocation(['--all', '--help'])).toBe(true);
    expect(isRootHelpInvocation(['--debug', '-h'])).toBe(true);
  });

  it('is false for subcommand help (no freeze read → corrupt freeze.json cannot break it)', () => {
    expect(isRootHelpInvocation(['lint', '--help'])).toBe(false);
    expect(isRootHelpInvocation(['review', '-h'])).toBe(false);
    expect(isRootHelpInvocation(['lesson', 'compile', '--help'])).toBe(false);
  });

  it('is false when no help flag is present', () => {
    expect(isRootHelpInvocation([])).toBe(false);
    expect(isRootHelpInvocation(['lint'])).toBe(false);
    expect(isRootHelpInvocation(['--all'])).toBe(false);
  });
});

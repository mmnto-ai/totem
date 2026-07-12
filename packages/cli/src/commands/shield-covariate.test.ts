/**
 * CLI-level `totem review --covariate` short-circuit test (Prop 304 R2 rev-6 item 7).
 *
 * `--covariate` is a READ-ONLY, zero-LLM transport verb: it must short-circuit BEFORE
 * the pre-push hook upgrade, the engine bootstrap, the fan / every invoker, and any
 * stamp-bearing side effect. This drives the real `shieldCommand({ covariate: true })`
 * and asserts none of those write/side-effect paths run.
 *
 * Lives in its own file to avoid mock contamination: it mocks the heavy dependencies
 * (config load, engine bootstrap, hook installer, git diff) so the covariate branch is
 * exercised deterministically without a real repo, a real config, or a network invoke.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';

// ── Spies for the post-covariate work that MUST NOT run on the read-only path ──
const bootstrapEngineSpy = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const upgradePrePushHookSpy = vi.fn((..._args: unknown[]): boolean => false);
const getDiffForReviewSpy = vi.fn(async (..._args: unknown[]) => null);

const TEST_CONFIG = {
  totemDir: '.totem',
  review: { sourceExtensions: ['.ts'] },
} as unknown as TotemConfig;

// Engine bootstrap: a spy so we can assert it is NEVER reached under --covariate.
vi.mock('../utils/bootstrap-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/bootstrap-engine.js')>();
  return { ...actual, bootstrapEngine: bootstrapEngineSpy };
});

// Pre-push hook installer: a spy so we can assert the hook-upgrade write is skipped.
vi.mock('./install-hooks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install-hooks.js')>();
  return { ...actual, upgradePrePushHookIfNeeded: upgradePrePushHookSpy };
});

// Config load: return a minimal in-memory config so no real config file / jiti is needed.
vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    loadEnv: vi.fn(),
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: vi.fn(async () => TEST_CONFIG),
  };
});

// Git diff: null (no diff) so the covariate path resolves no lineage and needs no git.
vi.mock('../git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git.js')>();
  return { ...actual, getDiffForReview: getDiffForReviewSpy };
});

describe('shieldCommand --covariate short-circuit (rev-6 item 7)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-covariate-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    bootstrapEngineSpy.mockClear();
    upgradePrePushHookSpy.mockClear();
    getDiffForReviewSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  it('skips the hook-upgrade write, engine bootstrap, all invokers, and stamps nothing', async () => {
    const { shieldCommand } = await import('./shield.js');
    // ShieldOptions is a wide options bag; only `covariate` is set on the read-only path.
    await expect(
      shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]),
    ).resolves.toBeUndefined();

    // Read-only verb: the pre-push hook upgrade is guarded behind `!options.covariate`.
    expect(upgradePrePushHookSpy).not.toHaveBeenCalled();
    // The short-circuit returns BEFORE engine boot, the fan, and every invoker.
    expect(bootstrapEngineSpy).not.toHaveBeenCalled();
    // It DID take the covariate branch (getDiffForReview was consulted read-only).
    expect(getDiffForReviewSpy).toHaveBeenCalledTimes(1);

    // Nothing was stamped — this verb authorizes no push.
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash'))).toBe(
      false,
    );
    // No verdict artifacts were written (no fan ran).
    expect(fs.existsSync(path.join(tmpDir, '.totem', 'artifacts', 'verdicts'))).toBe(false);
    // No pre-push hook file was created.
    expect(fs.existsSync(path.join(tmpDir, '.git', 'hooks', 'pre-push'))).toBe(false);
  });
});

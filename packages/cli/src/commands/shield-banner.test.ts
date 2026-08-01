/**
 * CLI-level `totem review` run-start banner test (mmnto-ai/totem#2536).
 *
 * The billing truth-up moved the honest description of `totem review` into the
 * template and the docs prompt; this pins the third surface — the line the
 * command itself emits at run start, where stale muscle memory actually gets
 * corrected. It must state the advisory role and the known limits, and it must
 * NOT fire on the read-only `--covariate` transport verb, which short-circuits
 * before any review work.
 *
 * Lives in its own file to avoid mock contamination (same harness shape as
 * `shield-covariate.test.ts`): the heavy seams (config, engine bootstrap, hook
 * installer, git diff) are mocked so the run-start path is exercised without a
 * real repo, config, or network invoke.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';

const bootstrapEngineSpy = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const upgradePrePushHookSpy = vi.fn((..._args: unknown[]): boolean => false);
const getDiffForReviewSpy = vi.fn(async (..._args: unknown[]) => null);

const TEST_CONFIG = {
  totemDir: '.totem',
  review: { sourceExtensions: ['.ts'] },
} as unknown as TotemConfig;

vi.mock('../utils/bootstrap-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/bootstrap-engine.js')>();
  return { ...actual, bootstrapEngine: bootstrapEngineSpy };
});

vi.mock('./install-hooks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install-hooks.js')>();
  return { ...actual, upgradePrePushHookIfNeeded: upgradePrePushHookSpy };
});

vi.mock('../utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils.js')>();
  return {
    ...actual,
    loadEnv: vi.fn(),
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: vi.fn(async () => TEST_CONFIG),
  };
});

vi.mock('../git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../git.js')>();
  return { ...actual, getDiffForReview: getDiffForReviewSpy };
});

describe('`totem review` run-start self-description (#2536)', () => {
  let tmpDir: string;
  let emitted: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-banner-'));
    emitted = [];
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      emitted.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      emitted.push(args.map(String).join(' '));
    });
    bootstrapEngineSpy.mockClear();
    upgradePrePushHookSpy.mockClear();
    getDiffForReviewSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      cleanTmpDir(tmpDir);
    } catch {
      // Best-effort cleanup; the OS reclaims the temp dir.
    }
  });

  it('declares the advisory role and the known limits at run start', async () => {
    const { shieldCommand } = await import('./shield.js');
    // ShieldOptions is a wide options bag; a bare run takes the ordinary path.
    await shieldCommand({} as Parameters<typeof shieldCommand>[0]);

    const output = emitted.join('\n');
    expect(output).toMatch(/advisory/i);
    expect(output).toMatch(/not a merge gate/i);
    expect(output).toMatch(/truncation/i);
    expect(output).toMatch(/non-code files skipped/i);
  });

  it('does not fire on the read-only --covariate transport verb', async () => {
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);

    expect(emitted.join('\n')).not.toMatch(/not a merge gate/i);
  });
});

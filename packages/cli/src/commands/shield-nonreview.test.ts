/**
 * CLI-level deterministic-skip NON-REVIEW tests (mmnto-ai/totem#2466).
 *
 * `totem review` has three deterministic skip paths that drop the ENTIRE diff
 * without examining it: all-non-code, no-code-after-filtering, and all-generated.
 * Each used to call `writeReviewedContentHash(...)` before returning, minting the
 * `.reviewed-content-hash` push-gate stamp for content nothing reviewed.
 *
 * The danger is not uniform, which is why all three are pinned here rather than
 * only the reported one:
 *
 *   - all-non-code / filtered-empty fire only when no code file is in the diff,
 *     so the hash is unchanged and the stamp was a no-op. The defect is the
 *     dishonest clean-pass surface (Tenets 4/13).
 *   - all-generated can drop a TRACKED, HASHED source file, because
 *     `.gitattributes linguist-generated` can mark a `.ts` as generated. There the
 *     stamp genuinely authorized never-reviewed code — a push-gate bypass.
 *
 * Mirrors `shield-covariate.test.ts`: its own file to avoid mock contamination,
 * mocking the heavy seams (config, engine bootstrap, hook installer, git diff) so
 * the skip branches are exercised without a real repo, config, or network invoke.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';

// ── Seams that MUST NOT run once a skip path is taken ──
const bootstrapEngineSpy = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const upgradePrePushHookSpy = vi.fn((..._args: unknown[]): boolean => false);
const getDiffForReviewSpy = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);

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

/** A minimal single-file diff section for `file`. */
function diffFor(file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1 +1 @@',
    '-old',
    '+new',
  ].join('\n');
}

describe('deterministic skip paths are NON-REVIEWS and never stamp (#2466)', () => {
  let tmpDir: string;
  let warnings: string[];

  const stampPath = () => path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-nonreview-'));
    warnings = [];
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    bootstrapEngineSpy.mockClear();
    getDiffForReviewSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // The non-skip case (mixed diff) runs into the LLM path and aborts on the
    // unmocked embedding config, which can leave a handle open under the temp
    // dir — Windows then EPERMs the recursive remove. That is a harness artifact
    // of driving the real command, not a product behavior, and it must not fail
    // a suite whose assertions are all about the stamp and the emitted output.
    try {
      cleanTmpDir(tmpDir);
    } catch {
      // Best-effort cleanup; the OS reclaims the temp dir.
    }
  });

  /**
   * Drive the real command with a diff whose files are all `files`.
   *
   * A run that does NOT take a skip path continues into the LLM review path and
   * throws on the unmocked embedding config. That throw is expected and is itself
   * evidence the skip did not fire, so it is swallowed here — every assertion
   * below is made on the stamp and the emitted output, never on resolution.
   */
  async function runWithDiff(files: string[]): Promise<void> {
    await runWithDiffRaw(files.map(diffFor).join('\n'), files);
  }

  /**
   * Lower-level driver for cases where the diff BODY and the changed-file LIST
   * must differ — the filtered-empty path needs a code file present in the list
   * whose hunks are absent from the diff (a mode-only change has this shape).
   */
  async function runWithDiffRaw(diff: string, changedFiles: string[]): Promise<void> {
    getDiffForReviewSpy.mockResolvedValueOnce({ diff, changedFiles });
    const { shieldCommand } = await import('./shield.js');
    try {
      await shieldCommand({} as Parameters<typeof shieldCommand>[0]);
    } catch {
      // See doc comment — a non-skip run is expected to fail downstream.
    }
  }

  it('all-non-code: does not stamp, and says so', async () => {
    await runWithDiff(['docs/plan.md', 'README.md']);

    // The load-bearing assertion: no push authorization was minted.
    expect(fs.existsSync(stampPath())).toBe(false);
    // And the skip is LOUD — a caller cannot read it as a clean review.
    expect(warnings.join('\n')).toMatch(/NON-REVIEW/);
    expect(warnings.join('\n')).toMatch(/does not authorize a push/);
  });

  it('all-generated: does not stamp — the path that could authorize real code', async () => {
    // A lockfile is generated by default glob, so the whole diff drops.
    await runWithDiff(['pnpm-lock.yaml']);

    expect(fs.existsSync(stampPath())).toBe(false);
    expect(warnings.join('\n')).toMatch(/NON-REVIEW/);
    expect(warnings.join('\n')).toMatch(/does not authorize a push/);
  });

  it('all-generated via .gitattributes on a TRACKED .ts: does not stamp (the bypass case)', async () => {
    // The scenario the default-glob lockfile test does NOT reach, and the only
    // one where the old stamp could authorize genuinely-changed, hashed source:
    // `linguist-generated` marks a real `.ts`, so the file is dropped from review
    // while still counting toward the content hash the push gate compares.
    fs.writeFileSync(
      path.join(tmpDir, '.gitattributes'),
      'src/generated-client.ts linguist-generated\n',
    );

    await runWithDiff(['src/generated-client.ts']);

    expect(fs.existsSync(stampPath())).toBe(false);
    // Assert the GENERATED-path wording specifically. A bare /NON-REVIEW/ match
    // would also pass if this fell through to the all-non-code branch, which
    // would mean the test proves nothing about the bypass it exists to cover.
    expect(warnings.join('\n')).toMatch(/every changed file is a generated artifact/);
    expect(warnings.join('\n')).toMatch(/does not authorize a push/);
  });

  it('filtered-empty: does not stamp when no code hunks survive filtering', async () => {
    // Stage 2 fires when the diff is neither all-code nor all-non-code and the
    // code side contributes no hunks — a mode-only change on a tracked source
    // file has exactly this shape: listed as changed, absent from the diff body.
    await runWithDiffRaw(diffFor('docs/plan.md'), ['docs/plan.md', 'src/index.ts']);

    expect(fs.existsSync(stampPath())).toBe(false);
    // Stage-2 wording specifically — distinguishes this from the Stage-1
    // all-non-code branch, which a generic NON-REVIEW match would not.
    expect(warnings.join('\n')).toMatch(/no code changes remain after filtering/);
    expect(warnings.join('\n')).toMatch(/does not authorize a push/);
  });

  it('mixed code + prose does NOT take a skip path (the skip must not over-fire)', async () => {
    // Guards the inverse error: tightening the skip must not start skipping real
    // code. A surviving `.ts` file means this is a review, not a non-review.
    await runWithDiff(['docs/plan.md', 'src/index.ts']);

    expect(warnings.join('\n')).not.toMatch(/NON-REVIEW/);
    // It also must not stamp here — this run never completed a review either.
    expect(fs.existsSync(stampPath())).toBe(false);
  });
});

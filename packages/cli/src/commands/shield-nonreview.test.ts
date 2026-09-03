/**
 * CLI-level deterministic-skip tests (mmnto-ai/totem#2466 → #2473).
 *
 * `totem review` has four deterministic skip paths that drop the ENTIRE diff
 * without examining it: no-diff, all-non-code, filtered-empty, all-generated.
 * Since #2473 each is an ADMISSION verdict through the single emission path:
 * one machine-readable admission record + ONE calm info-level disposition line
 * — and never a stamp. The no-diff arm is the sharpest regression here: it
 * used to be a "trivial pass" that STAMPED `.reviewed-content-hash`, minting
 * push authorization for a tree no reviewer saw.
 *
 * The all-generated danger remains non-uniform (why every path is pinned):
 * `.gitattributes linguist-generated` can mark a `.ts` as generated, so that
 * skip can drop a TRACKED, HASHED source file — the old stamp there genuinely
 * authorized never-reviewed code.
 *
 * Mirrors `shield-covariate.test.ts`: its own file to avoid mock contamination,
 * mocking the heavy seams (config, engine bootstrap, hook installer, git diff) so
 * the skip branches are exercised without a real repo, config, or network invoke.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LEG_DEPOSIT_SCHEMA_VERSION, saveLegDeposit, type TotemConfig } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { log } from '../ui.js';

// ── Seams that MUST NOT run once a skip path is taken ──
const bootstrapEngineSpy = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const upgradePrePushHookSpy = vi.fn((..._args: unknown[]): boolean => false);
const getDiffForReviewSpy = vi.fn(async (..._args: unknown[]): Promise<unknown> => null);

const TEST_CONFIG = {
  totemDir: '.totem',
  review: { sourceExtensions: ['.ts'] },
} as unknown as TotemConfig;

// Per-test config override (the malformed-lanes precedence test); reset in
// beforeEach. The loadConfig mock closes over this holder.
let currentConfig: TotemConfig = TEST_CONFIG;

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
    loadConfig: vi.fn(async () => currentConfig),
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

describe('deterministic skips are not-applicable ADMISSIONS: record + calm line, never a stamp (#2473)', () => {
  let tmpDir: string;
  let output: string[];
  let infoLines: string[];
  let warnLines: string[];

  const stampPath = () => path.join(tmpDir, '.totem', 'cache', '.reviewed-content-hash');
  const admissionsDir = () => path.join(tmpDir, '.totem', 'artifacts', 'admissions');

  /** The store's records, parsed. */
  function admissionRecords(): Array<Record<string, unknown>> {
    if (!fs.existsSync(admissionsDir())) return [];
    return fs
      .readdirSync(admissionsDir())
      .map((f) => JSON.parse(fs.readFileSync(path.join(admissionsDir(), f), 'utf-8')));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shield-nonreview-'));
    output = [];
    infoLines = [];
    warnLines = [];
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(' '));
    });
    // Level-lock spies (the calm-line invariant): the disposition line is
    // info-level, never WARN-class — it prints on every docs-only run in every
    // consumer repo and must not read as a warning wall (#2473 consumer datum).
    vi.spyOn(log, 'info').mockImplementation((_tag: string, msg: string) => {
      infoLines.push(msg);
    });
    vi.spyOn(log, 'warn').mockImplementation((_tag: string, msg: string) => {
      warnLines.push(msg);
    });
    bootstrapEngineSpy.mockClear();
    upgradePrePushHookSpy.mockClear();
    getDiffForReviewSpy.mockClear();
    getDiffForReviewSpy.mockReset();
    // The production resolver shape: a no-changes resolution is a discriminated
    // empty carrying the RESOLVED scope (conformance note 1), never null.
    getDiffForReviewSpy.mockResolvedValue({ empty: true, source: 'branch-vs-base', base: 'main' });
    currentConfig = TEST_CONFIG;
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

  /** The single calm disposition line for `reason`, asserted info-level and one-line. */
  function expectCalmLine(reason: string): string {
    const matching = infoLines.filter((l) => l.includes(`not-applicable (${reason})`));
    expect(matching).toHaveLength(1);
    const line = matching[0]!;
    expect(line).not.toContain('\n');
    expect(line).toMatch(/does not authorize a push/);
    // Never WARN-class — the level lock.
    expect(warnLines.filter((l) => l.includes('not-applicable ('))).toHaveLength(0);
    return line;
  }

  /** The store's single record, asserted against the expected identity fields. */
  function expectSingleRecord(reason: string, skippedFileCount: number): Record<string, unknown> {
    const records = admissionRecords();
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record['disposition']).toBe('not-applicable');
    expect(record['reason']).toBe(reason);
    expect(record['skippedFileCount']).toBe(skippedFileCount);
    expect(record['schemaVersion']).toMatch(/^1\.\d+\.\d+$/);
    expect(record['inputHash']).toMatch(/^[0-9a-f]{64}$/);
    expect(record['projectionPolicyHash']).toMatch(/^[0-9a-f]{64}$/);
    return record;
  }

  /**
   * Drive the real command with a diff whose files are all `files`.
   *
   * A run that does NOT take a skip path continues into the LLM review path and
   * throws on the unmocked embedding config. That throw is expected and is itself
   * evidence the skip did not fire, so it is swallowed here — every assertion
   * below is made on the stamp, the store, and the emitted output.
   */
  async function runWithDiff(
    files: string[],
    options: Record<string, unknown> = {},
  ): Promise<void> {
    await runWithDiffRaw(files.map(diffFor).join('\n'), files, options);
  }

  /**
   * Lower-level driver for cases where the diff BODY and the changed-file LIST
   * must differ — the filtered-empty path needs a code file present in the list
   * whose hunks are absent from the diff (a mode-only change has this shape).
   */
  async function runWithDiffRaw(
    diff: string,
    changedFiles: string[],
    options: Record<string, unknown> = {},
  ): Promise<void> {
    getDiffForReviewSpy.mockResolvedValue({ diff, changedFiles, source: 'uncommitted' });
    const { shieldCommand } = await import('./shield.js');
    try {
      await shieldCommand(options as Parameters<typeof shieldCommand>[0]);
    } catch {
      // See doc comment — a non-skip run is expected to fail downstream.
    }
  }

  it('no-diff: does NOT stamp (the removed trivial-pass), records the RESOLVED empty scope', async () => {
    // getDiffForReview resolves the scoped empty (the beforeEach default) —
    // the arm that used to write `.reviewed-content-hash` as a "trivial pass".
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({} as Parameters<typeof shieldCommand>[0]);

    expect(fs.existsSync(stampPath())).toBe(false);
    expectCalmLine('no-diff');
    const record = expectSingleRecord('no-diff', 0);
    // Conformance note 1: the record binds the resolver's RESOLVED terminal
    // scope; the requested selector fills the selector slot.
    expect(record['scope']).toEqual({
      source: 'branch-vs-base',
      base: 'main',
      head: null,
      selectorForm: '(default-chain)',
    });
    // A skip never boots the engine (phase ordering).
    expect(bootstrapEngineSpy).not.toHaveBeenCalled();
  });

  it('a malformed lane config never preempts a not-applicable disposition (conformance note 2)', async () => {
    // Fan configuration is downstream of admission: with a docs-only diff and
    // a lanes value that would hard-error validation, the run still resolves
    // to the calm disposition — the config error is an ADMITTED-branch error.
    currentConfig = {
      ...(TEST_CONFIG as object),
      review: { sourceExtensions: ['.ts'], lanes: 12345 },
    } as unknown as TotemConfig;
    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted',
    });
    const { shieldCommand } = await import('./shield.js');
    await expect(shieldCommand({} as Parameters<typeof shieldCommand>[0])).resolves.toBeUndefined();
    expectCalmLine('all-non-code');
  });

  it('all-non-code: does not stamp, records, and says so calmly', async () => {
    await runWithDiff(['docs/plan.md', 'README.md']);

    // The load-bearing assertion: no push authorization was minted.
    expect(fs.existsSync(stampPath())).toBe(false);
    const line = expectCalmLine('all-non-code');
    // Exact rendered count (leg MINOR 4): the count measures files in scope
    // after generated-artifact exclusion, and the wording names that scope.
    expect(line).toContain('every file in scope (2) is non-code');
    expectSingleRecord('all-non-code', 2);
    expect(bootstrapEngineSpy).not.toHaveBeenCalled();
  });

  it('mixed generated + prose: the count is the POST-STRIP in-scope total, not the changed-file total (re-arm MINOR 3)', async () => {
    // 3 changed files, 1 generated (stripped), 2 prose in scope: the rendered
    // count must be 2 — a fixture where keptFiles === changedFiles cannot
    // distinguish the two candidate semantics, so this one CAN.
    await runWithDiff(['pnpm-lock.yaml', 'docs/plan.md', 'README.md']);

    expect(fs.existsSync(stampPath())).toBe(false);
    const line = expectCalmLine('all-non-code');
    expect(line).toContain('every file in scope (2) is non-code');
    expectSingleRecord('all-non-code', 2);
  });

  it('all-generated: does not stamp — the path that could authorize real code', async () => {
    // A lockfile is generated by default glob, so the whole diff drops.
    await runWithDiff(['pnpm-lock.yaml']);

    expect(fs.existsSync(stampPath())).toBe(false);
    expectCalmLine('all-generated');
    expectSingleRecord('all-generated', 1);
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
    // Assert the GENERATED-path wording specifically. A bare not-applicable
    // match would also pass if this fell through to the all-non-code branch,
    // which would mean the test proves nothing about the bypass it covers.
    const line = expectCalmLine('all-generated');
    expect(line).toMatch(/is a generated artifact/);
    expectSingleRecord('all-generated', 1);
  });

  it('filtered-empty: does not stamp when no code hunks survive filtering', async () => {
    // Stage 2 fires when the diff is neither all-code nor all-non-code and the
    // code side contributes no hunks — a mode-only change on a tracked source
    // file has exactly this shape: listed as changed, absent from the diff body.
    await runWithDiffRaw(diffFor('docs/plan.md'), ['docs/plan.md', 'src/index.ts']);

    expect(fs.existsSync(stampPath())).toBe(false);
    const line = expectCalmLine('filtered-empty');
    // Stage-2 wording, with the EXACT rendered count (leg MINOR 4): the count
    // is the in-scope file total, and the wording says so — never "N non-code
    // file(s)" for a number that counts something else.
    expect(line).toContain(
      'no code diff remains after filtering non-code files from 2 file(s) in scope',
    );
    expectSingleRecord('filtered-empty', 2);
  });

  it('--fail-on cannot reach an admission skip: docs-only + --fail-on critical resolves clean (regression)', async () => {
    // Codex regression lock: every skip returns before `runReviewFan`, so the
    // fan's `!cacheEligible` arm can never convert a skip into SHIELD_FAILED.
    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted',
    });
    const { shieldCommand } = await import('./shield.js');
    await expect(
      shieldCommand({ failOn: 'critical' } as Parameters<typeof shieldCommand>[0]),
    ).resolves.toBeUndefined();
    expectCalmLine('all-non-code');
  });

  it('--gate maps a known not-applicable admission to a clean pass (the hook form)', async () => {
    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted',
    });
    const { shieldCommand } = await import('./shield.js');
    await expect(
      shieldCommand({ gate: true } as Parameters<typeof shieldCommand>[0]),
    ).resolves.toBeUndefined();
    expectCalmLine('all-non-code');
    expect(fs.existsSync(stampPath())).toBe(false);
  });

  it('--gate + --fail-on is CONFIG_INVALID, validated BEFORE the hook-upgrade side effect', async () => {
    const { shieldCommand } = await import('./shield.js');
    await expect(
      shieldCommand({ gate: true, failOn: 'critical' } as Parameters<typeof shieldCommand>[0]),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    // Codex amendment: an invalid command must not mutate the hook on its way
    // to CONFIG_INVALID.
    expect(upgradePrePushHookSpy).not.toHaveBeenCalled();
  });

  it('a failed record write degrades to a loud warning — the line still prints, exit unchanged', async () => {
    // A FILE at the admissions-dir path makes mkdirSync/writeFileSync fail.
    fs.mkdirSync(path.join(tmpDir, '.totem', 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.totem', 'artifacts', 'admissions'), 'not a dir');

    await runWithDiff(['docs/plan.md']);

    expect(fs.existsSync(stampPath())).toBe(false);
    const line = expectCalmLine('all-non-code');
    expect(line).not.toContain('recorded');
    expect(warnLines.some((l) => l.includes('Admission record write failed'))).toBe(true);
  });

  it('covariate resolves the exact-identity admission record (and warns loud when absent)', async () => {
    const docsDiff = {
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted' as const,
    };
    getDiffForReviewSpy.mockResolvedValue(docsDiff);
    const { shieldCommand } = await import('./shield.js');

    // Absent: LOUD no-current-record sensor, never a fallback.
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);
    expect(warnLines.some((l) => l.includes('no admission record exists'))).toBe(true);
    expect(admissionRecords()).toHaveLength(0);

    // Record it, then resolve it by exact identity.
    await shieldCommand({} as Parameters<typeof shieldCommand>[0]);
    const record = expectSingleRecord('all-non-code', 1);
    output.length = 0;
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);
    const lane = output.find((l) => l.startsWith('local-lane:'));
    // Format v1.2 (mmnto-ai/totem#2698): the v1.1 admission text is byte-
    // unchanged and the leg field is APPENDED. No deposit store here, so the
    // field is `leg: none` — the whole line, byte-for-byte.
    expect(lane).toBe(
      `local-lane: not-applicable (all-non-code) recorded=${String(
        fs.readdirSync(admissionsDir())[0],
      ).slice(0, 8)} at=${String(record['createdAt'])} leg: none`,
    );
  });

  it('the admission form carries the leg field resolved from a REAL deposit at HEAD (v1.2)', async () => {
    // A real repo with one commit: the admission path resolves HEAD through the
    // production git runner (no seam to inject), so the deposit must be keyed by
    // the sha git actually reports — the wiring this test exists to prove.
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    git('init');
    git('commit', '--allow-empty', '-m', 'leg-fixture');
    const head = git('rev-parse', 'HEAD');

    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted' as const,
    });
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({} as Parameters<typeof shieldCommand>[0]); // record the admission
    const record = expectSingleRecord('all-non-code', 1);

    saveLegDeposit(path.join(tmpDir, '.totem'), {
      schemaVersion: LEG_DEPOSIT_SCHEMA_VERSION,
      diffSha: head,
      readAt: '2026-09-03T04:00:00.000Z',
      findings: [
        {
          id: 'b1',
          severity: 'BLOCKING',
          file: 'docs/plan.md',
          line: 0,
          claim: 'the claim',
          counterexample: '',
        },
        {
          id: 'n1',
          severity: 'MINOR',
          file: 'docs/plan.md',
          line: 0,
          claim: 'a minor claim',
          counterexample: '',
        },
      ],
      folded: ['b1'],
      verdict: 'read the docs-only diff; the blocking claim was folded',
    });

    output.length = 0;
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);
    const lane = output.find((l) => l.startsWith('local-lane:'));
    // `minor` is deliberately absent from the field; the folded BLOCKING counts
    // in BOTH buckets, so `blocking=1 folded=1` reads "addressed".
    expect(lane).toBe(
      `local-lane: not-applicable (all-non-code) recorded=${String(
        fs.readdirSync(admissionsDir())[0],
      ).slice(
        0,
        8,
      )} at=${String(record['createdAt'])} leg: ${head.slice(0, 8)} blocking=1 material=0 folded=1`,
    );
  });

  // The v1.2 DEPOSIT-ONLY head on the ADMISSION arm (mmnto-ai/totem#2698 fold
  // 2, MATERIAL). `printCovariateLine` shipped this shape for the verdict arm;
  // the admission arm's no-record branch logged its sensor and returned, so a
  // not-applicable diff whose head a leg HAD read still printed nothing — the
  // mmnto-ai/totem#2694 exhibit, reached by the other door.
  it('the admission arm prints the deposit-only head when no record exists but a leg read HEAD (v1.2)', async () => {
    const git = (...args: string[]): string =>
      execFileSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: tmpDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    git('init');
    git('commit', '--allow-empty', '-m', 'leg-fixture');
    const head = git('rev-parse', 'HEAD');

    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted' as const,
    });
    const { shieldCommand } = await import('./shield.js');

    // No deposit and no record: today's behavior is preserved exactly — the
    // sensor names the missing record and NOTHING reaches stdout.
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);
    expect(warnLines.some((l) => l.includes('no admission record exists'))).toBe(true);
    expect(output.some((l) => l.startsWith('local-lane:'))).toBe(false);

    // Now a leg has read this head — still no admission record.
    saveLegDeposit(path.join(tmpDir, '.totem'), {
      schemaVersion: LEG_DEPOSIT_SCHEMA_VERSION,
      diffSha: head,
      readAt: '2026-09-03T05:00:00.000Z',
      findings: [
        {
          id: 'm1',
          severity: 'MATERIAL',
          file: 'docs/plan.md',
          line: 0,
          claim: 'the plan overstates the floor',
          counterexample: 'the gate reads no severities',
        },
      ],
      folded: [],
      verdict: 'read the docs-only diff; one material finding stands',
    });

    output.length = 0;
    warnLines.length = 0;
    await shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]);

    // The sensor STAYS — it names the record that is missing, which is still
    // true; the deposit line is additional evidence, not a substitute.
    expect(warnLines.some((l) => l.includes('no admission record exists'))).toBe(true);
    const lane = output.find((l) => l.startsWith('local-lane:'));
    expect(lane).toBe(`local-lane: none leg: ${head.slice(0, 8)} blocking=0 material=1 folded=0`);
    // Still not-applicable: no admission record was written by a read-only verb.
    expect(admissionRecords()).toHaveLength(0);
  });

  it('covariate falls back LOUD on a corrupt exact-identity record — never a stale line (leg MINOR 7)', async () => {
    getDiffForReviewSpy.mockResolvedValue({
      diff: diffFor('docs/plan.md'),
      changedFiles: ['docs/plan.md'],
      source: 'uncommitted',
    });
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({} as Parameters<typeof shieldCommand>[0]); // record it
    const recordFile = fs.readdirSync(admissionsDir())[0]!;
    fs.writeFileSync(path.join(admissionsDir(), recordFile), '{ not json', 'utf-8');

    output.length = 0;
    warnLines.length = 0;
    await expect(
      shieldCommand({ covariate: true } as Parameters<typeof shieldCommand>[0]),
    ).resolves.toBeUndefined();
    // The corrupt load routed to the sensor AND the loud no-current-record
    // warn fired — and no local-lane line printed (never a stale fallback).
    expect(warnLines.some((l) => l.startsWith('Sensor:'))).toBe(true);
    expect(warnLines.some((l) => l.includes('no admission record exists'))).toBe(true);
    expect(output.some((l) => l.startsWith('local-lane:'))).toBe(false);
  });

  it('mixed code + prose does NOT take a skip path (the skip must not over-fire)', async () => {
    // Guards the inverse error: tightening the skip must not start skipping real
    // code. A surviving `.ts` file means this is a review, not a non-review.
    await runWithDiff(['docs/plan.md', 'src/index.ts']);

    expect(infoLines.filter((l) => l.includes('not-applicable ('))).toHaveLength(0);
    expect(admissionRecords()).toHaveLength(0);
    // It also must not stamp here — this run never completed a review either.
    expect(fs.existsSync(stampPath())).toBe(false);
  });
});

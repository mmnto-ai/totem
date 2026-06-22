import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CompiledRule, deriveLabelsFromDispositions, type ResolvedPrDiff } from '@mmnto/totem';

import { deriveLabelsCommand } from './spine-derive-labels.js';
import { buildCertifyingFirings } from './spine-windtunnel.js';

const SHA40 = (n: number): string => n.toString(16).padStart(40, '0');

/** A regex rule firing on `forbiddenCall(` (a made-up token — won't trip totem's own lint). */
function forbiddenCallRule(): CompiledRule {
  return {
    lessonHash: 'rule-fc',
    lessonHeading: 'No forbiddenCall',
    pattern: 'forbiddenCall\\(',
    message: 'forbidden call',
    engine: 'regex',
    compiledAt: '2026-06-22T00:00:00.000Z',
  };
}

/** A unified diff that ADDS the given lines to `file` from line 1. */
function diffAdding(lines: string[], file: string): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join('\n');
}

// ─── Equivalence: deriver labelIds ⊆ the run's buildFirings labelIds (panel) ──
//
// Both the certifying run and the deriver enumerate firings via the SAME
// `buildCertifyingFirings` — so the answer-key labelIds the deriver mints are the
// ones the run looks up. This proves the join end-to-end over REAL firings (zero
// network: an in-memory readStrategy stub) + the determinism of the shared path.

describe('5d-iii equivalence — buildCertifyingFirings ↔ deriveLabelsFromDispositions', () => {
  const rules = [forbiddenCallRule()];
  const prDiffs: ResolvedPrDiff[] = [
    { pr: 7, diff: diffAdding(['forbiddenCall()'], 'src/x.ts'), controlKind: 'corpus' },
  ];
  const readStrategy = async (): Promise<string | null> => 'forbiddenCall()\n';

  it('enumerates ≥1 firing and the deriver keys ONLY on real firing labelIds', async () => {
    const built = await buildCertifyingFirings({
      rules,
      prDiffs,
      readStrategy,
      logPrefix: '[Test]',
    });
    expect(built.firings.length).toBeGreaterThan(0);

    const firingLabelIds = new Set(built.firings.map((f) => f.labelId));
    const firing = built.firings[0]!;
    const dispositions = [
      {
        pr: 7,
        mergeCommitSha: SHA40(7),
        threads: [
          {
            path: 'src/x.ts',
            // bind by the firing's own added content (what GitHub's diffHunk would carry).
            diffHunk: `@@ -0,0 +1,1 @@\n+${firing.matchedLine}`,
            isResolved: false,
            isOutdated: false,
            comments: [{ author: 'Jane', body: 'fixed' }],
          },
        ],
      },
    ];

    const { labels } = deriveLabelsFromDispositions(built.firings, dispositions);
    // every emitted labelId is a real firing labelId the run will look up (⊆).
    for (const id of Object.keys(labels)) {
      expect(firingLabelIds.has(id)).toBe(true);
    }
    expect(labels[firing.labelId]).toBe('TP');
  });

  it('is deterministic — two runs of the shared firing-setup mint identical labelIds', async () => {
    const a = await buildCertifyingFirings({ rules, prDiffs, readStrategy, logPrefix: '[Test]' });
    const b = await buildCertifyingFirings({ rules, prDiffs, readStrategy, logPrefix: '[Test]' });
    expect(b.firings.map((f) => f.labelId).sort()).toEqual(a.firings.map((f) => f.labelId).sort());
  });
});

// ─── Integrity gates (command-level; no git needed — the gate fires first) ────

function writeLockFixture(dir: string, integrity: Record<string, string>): void {
  const lock = {
    schema: 'windtunnel.lock.v1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    gate: 'gate-1',
    phase: 'certifying',
    corpus: {
      repo: 'mmnto-ai/liquid-city',
      selectionRule: {
        state: 'merged',
        predicate: 'code-touching',
        window: { type: 'all' },
        asOfCommit: 'a'.repeat(40),
        codePathClassifier: { includeGlobs: ['**/*.ts'], excludeGlobs: [] },
      },
      resolvedPrs: [3, 5].map((n) => ({
        pr: n,
        mergeCommit: SHA40(n),
        baseSha: 'b'.repeat(40),
        headSha: 'd'.repeat(40),
      })),
    },
    fpDefinition: { rubricRef: 'r', groundTruthRef: 'g', adjudicator: 'a', precisionFloor: 1.0 },
    controls: {
      positiveRef: 'controls/positive/',
      negativeRef: 'controls/negative/',
      integrity: { mechanism: 'sha', fixtureSha: 'e'.repeat(40), ...integrity },
    },
    cullRateThreshold: 0.5,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
  };
  fs.writeFileSync(path.join(dir, 'windtunnel.lock.json'), JSON.stringify(lock, null, 2));
}

describe('deriveLabelsCommand — integrity gates', () => {
  let dir: string;
  let savedLcDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-derive-'));
    // The no-lc-dir guard reads TOTEM_LC_DIR — neutralize the ambient env for tests.
    savedLcDir = process.env['TOTEM_LC_DIR'];
    delete process.env['TOTEM_LC_DIR'];
  });
  afterEach(() => {
    if (savedLcDir === undefined) delete process.env['TOTEM_LC_DIR'];
    else process.env['TOTEM_LC_DIR'] = savedLcDir;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('fails loud when no lc clone is provided (the answer key would be silently empty)', async () => {
    writeLockFixture(dir, { corpusDispositionsSha: 'f'.repeat(64) });
    await expect(
      deriveLabelsCommand({ lockPath: path.join(dir, 'windtunnel.lock.json'), cwd: dir }),
    ).rejects.toThrow(/no lc clone/i);
  });

  it('hard-fails when the lock is missing corpusDispositionsSha (un-gated provenance)', async () => {
    writeLockFixture(dir, {}); // no corpusDispositionsSha stamped
    await expect(
      deriveLabelsCommand({
        lockPath: path.join(dir, 'windtunnel.lock.json'),
        lcDir: dir, // a real dir; the gate fires before any git use
        cwd: dir,
      }),
    ).rejects.toThrow(/corpusDispositionsSha/);
  });

  it('hard-fails when corpus-dispositions.json does not match the stamped digest', async () => {
    writeLockFixture(dir, { corpusDispositionsSha: 'a'.repeat(64) }); // a digest the file won't match
    fs.writeFileSync(path.join(dir, 'corpus-dispositions.json'), '[]\n', 'utf-8');
    await expect(
      deriveLabelsCommand({
        lockPath: path.join(dir, 'windtunnel.lock.json'),
        lcDir: dir,
        cwd: dir,
      }),
    ).rejects.toThrow(/integrity FAILED/i);
  });
});

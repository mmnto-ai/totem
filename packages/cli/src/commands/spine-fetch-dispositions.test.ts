import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CorpusDisposition } from '@mmnto/totem';

import {
  type CorpusDispositionSource,
  corpusHeldOutPrs,
  corpusWindowPrs,
  fetchDispositionsCommand,
} from './spine-fetch-dispositions.js';

describe('corpusHeldOutPrs', () => {
  it('is heldOut minus the positive/negative controls, sorted ascending', () => {
    expect(
      corpusHeldOutPrs({
        heldOutPrs: [9, 3, 7, 5, 11],
        positiveControlPrs: [7],
        negativeControlPrs: [11],
      }),
    ).toEqual([3, 5, 9]);
  });

  it('is empty when every held-out PR is a control', () => {
    expect(
      corpusHeldOutPrs({ heldOutPrs: [7, 11], positiveControlPrs: [7], negativeControlPrs: [11] }),
    ).toEqual([]);
  });
});

describe('corpusWindowPrs (D2.6 authored window)', () => {
  it('is (train ∪ heldOut) minus controls, deduped + ascending', () => {
    expect(
      corpusWindowPrs({
        trainPrs: [3, 5],
        heldOutPrs: [3, 7, 9, 11], // 3 also in train → deduped
        positiveControlPrs: [7],
        negativeControlPrs: [11],
      }),
    ).toEqual([3, 5, 9]);
  });

  it('keeps a TRAIN-side non-control PR that corpusHeldOutPrs drops (the D2.6 reason)', () => {
    const split = {
      trainPrs: [3],
      heldOutPrs: [5, 7, 9],
      positiveControlPrs: [7],
      negativeControlPrs: [9],
    };
    expect(corpusWindowPrs(split)).toEqual([3, 5]); // window keeps the train-side 3
    expect(corpusHeldOutPrs(split)).toEqual([5]); // held-out-only drops it
  });

  it('excludes a train PR that is itself a control', () => {
    expect(
      corpusWindowPrs({
        trainPrs: [7],
        heldOutPrs: [5],
        positiveControlPrs: [7],
        negativeControlPrs: [],
      }),
    ).toEqual([5]);
  });
});

// ─── Command integration (temp gate-1 dir, injected fake source) ─────────────

const SHA40 = (n: number): string => n.toString(16).padStart(40, '0');

function writeFixtures(dir: string): void {
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
      resolvedPrs: [3, 5, 7, 9].map((n) => ({
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
      integrity: { mechanism: 'sha', fixtureSha: 'e'.repeat(40) },
    },
    cullRateThreshold: 0.5,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
  };
  const split = {
    asOfCommit: 'a'.repeat(40),
    trainPrs: [3],
    heldOutPrs: [5, 7, 9],
    excludedPrs: [],
    positiveControlPrs: [7],
    negativeControlPrs: [9],
    splitRule: { predicate: 'code-touching', cutIndex: 1 },
  };
  fs.writeFileSync(path.join(dir, 'windtunnel.lock.json'), JSON.stringify(lock, null, 2));
  fs.writeFileSync(path.join(dir, 'split.json'), JSON.stringify(split, null, 2));
}

/** A fake source: one thread per PR, deterministic content. */
const fakeSource: CorpusDispositionSource = {
  async fetch(pr: number): Promise<CorpusDisposition> {
    return {
      pr,
      mergeCommitSha: SHA40(pr),
      threads: [
        {
          threadId: `T${pr}`,
          path: `src/pr${pr}.ts`,
          line: pr,
          originalLine: pr - 1,
          diffHunk: `@@ pr${pr} @@\n+line`,
          isResolved: true,
          isOutdated: false,
          comments: [{ commentId: pr, author: 'coderabbitai[bot]', body: 'finding' }],
        },
      ],
    };
  },
};

describe('fetchDispositionsCommand', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-fetch-disp-'));
    writeFixtures(dir);
  });
  afterEach(() => {
    // maxRetries/retryDelay: the repo convention for temp-dir teardown — guards the
    // Windows file-lock ENOTEMPTY flake (describe.test.ts / doctor.test.ts pattern).
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('freezes corpus-dispositions.json for the corpus held-out PRs only (5, not 7/9)', async () => {
    await fetchDispositionsCommand({
      lockPath: path.join(dir, 'windtunnel.lock.json'),
      cwd: dir,
      source: fakeSource,
    });
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, 'corpus-dispositions.json'), 'utf-8'),
    );
    // heldOut [5,7,9], controls {7,9} → only PR 5 is a corpus disposition.
    expect(written.map((d: CorpusDisposition) => d.pr)).toEqual([5]);
    expect(written[0].threads[0].diffHunk).toBe('@@ pr5 @@\n+line');
  });

  it('an AUTHORED lock freezes WINDOW-WIDE dispositions (train ∪ held-out non-control: 3 and 5)', async () => {
    // Flip the fixture lock to producerKind:authored (fetch-dispositions reads only the kind).
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'windtunnel.lock.json'), 'utf-8'));
    lock.producerKind = 'authored';
    lock.authored = { expectedSplitRef: 'split-cert-1' };
    fs.writeFileSync(path.join(dir, 'windtunnel.lock.json'), JSON.stringify(lock, null, 2));
    await fetchDispositionsCommand({
      lockPath: path.join(dir, 'windtunnel.lock.json'),
      cwd: dir,
      source: fakeSource,
    });
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, 'corpus-dispositions.json'), 'utf-8'),
    );
    // split train [3] ∪ heldOut [5,7,9] minus controls {7,9} → [3,5] (mined would be [5]).
    expect(written.map((d: CorpusDisposition) => d.pr)).toEqual([3, 5]);
  });

  it('stamps corpusDispositionsSha = sha256 of the exact on-disk bytes', async () => {
    await fetchDispositionsCommand({
      lockPath: path.join(dir, 'windtunnel.lock.json'),
      cwd: dir,
      source: fakeSource,
    });
    const bytes = fs.readFileSync(path.join(dir, 'corpus-dispositions.json'), 'utf-8');
    const expected = createHash('sha256').update(bytes, 'utf-8').digest('hex');
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'windtunnel.lock.json'), 'utf-8'));
    expect(lock.controls.integrity.corpusDispositionsSha).toBe(expected);
    expect(bytes.endsWith('\n')).toBe(true); // trailing newline (canonical)
  });

  it('is deterministic — a second run reproduces the identical digest', async () => {
    const opts = { lockPath: path.join(dir, 'windtunnel.lock.json'), cwd: dir, source: fakeSource };
    await fetchDispositionsCommand(opts);
    const sha1 = JSON.parse(fs.readFileSync(path.join(dir, 'windtunnel.lock.json'), 'utf-8'))
      .controls.integrity.corpusDispositionsSha;
    await fetchDispositionsCommand(opts);
    const sha2 = JSON.parse(fs.readFileSync(path.join(dir, 'windtunnel.lock.json'), 'utf-8'))
      .controls.integrity.corpusDispositionsSha;
    expect(sha2).toBe(sha1);
  });

  it('fails loud when the split has no held-out corpus PRs', async () => {
    // Rewrite the split so every held-out PR is a control.
    const split = JSON.parse(fs.readFileSync(path.join(dir, 'split.json'), 'utf-8'));
    split.heldOutPrs = [7, 9];
    split.positiveControlPrs = [7];
    split.negativeControlPrs = [9];
    fs.writeFileSync(path.join(dir, 'split.json'), JSON.stringify(split, null, 2));
    await expect(
      fetchDispositionsCommand({
        lockPath: path.join(dir, 'windtunnel.lock.json'),
        cwd: dir,
        source: fakeSource,
      }),
    ).rejects.toThrow(/no held-out CORPUS PRs/i);
  });

  it('rejects a non-"owner/name" lock repo before any fetch (greptile #2231)', async () => {
    // A 3-part repo ("github.com/owner/name") must fail at parse, not slip through
    // as owner="github.com". No injected source → the live repo-parse path runs.
    const lock = JSON.parse(fs.readFileSync(path.join(dir, 'windtunnel.lock.json'), 'utf-8'));
    lock.corpus.repo = 'github.com/mmnto-ai/liquid-city';
    fs.writeFileSync(path.join(dir, 'windtunnel.lock.json'), JSON.stringify(lock, null, 2));
    await expect(
      fetchDispositionsCommand({ lockPath: path.join(dir, 'windtunnel.lock.json'), cwd: dir }),
    ).rejects.toThrow(/is not "owner\/name"/i);
  });
});

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  canonicalStringify,
  safeExec,
  SplitArtifactSchema,
  WindtunnelLockSchema,
} from '@mmnto/totem';

import { materializeCommand, resolvePrGit } from './spine-cert-materialize.js';
import { assertCorpusCompleteness, verifyControlIntegrity } from './spine-windtunnel.js';

// ─── Programmatic git fixture (agy's substrate: real `git init`, pinned dates) ──

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Dev',
  GIT_AUTHOR_EMAIL: 'dev@example.com',
  GIT_COMMITTER_NAME: 'Dev',
  GIT_COMMITTER_EMAIL: 'dev@example.com',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf-8' });
}

interface CommitSpec {
  subject: string;
  files: Record<string, string>;
  /** Build the commit body from the SHAs of already-created commits (e.g. revert refs). */
  body?: (shas: string[]) => string;
}

/** Build a synthetic squash-merge history; returns each commit's SHA in order. */
function makeRepo(dir: string, commits: CommitSpec[]): { headSha: string; shas: string[] } {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'commit.gpgsign', 'false');
  const shas: string[] = [];
  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
      git(dir, 'add', '--', rel);
    }
    const body = c.body ? c.body(shas) : '';
    git(dir, 'commit', '-q', '-m', body ? `${c.subject}\n\n${body}` : c.subject);
    shas.push(git(dir, 'rev-parse', 'HEAD').trim());
  }
  return { headSha: shas[shas.length - 1]!, shas };
}

/**
 * The standard matrix history. An initial non-PR root provides a parent for #1.
 * Corpus = code-touching, non-bot, non-revert PRs = [1, 2, 5, 6, 7] —
 *   #3 is docs-only (excluded), the bare `chore: direct bump` has no `(#N)` (skipped).
 */
const STANDARD_COMMITS: CommitSpec[] = [
  { subject: 'chore: init repo', files: { 'base.txt': 'seed\n' } },
  { subject: 'feat: a (#1)', files: { 'packages/core/src/a.ts': 'export const a = 1;\n' } },
  { subject: 'feat: b (#2)', files: { 'packages/core/src/b.ts': 'export const b = 2;\n' } },
  { subject: 'docs: c (#3)', files: { 'README.md': '# docs only\n' } },
  { subject: 'chore: direct bump', files: { 'packages/core/src/z.ts': 'export const z = 0;\n' } },
  { subject: 'feat: d (#5)', files: { 'packages/core/src/d.ts': 'export const d = 5;\n' } },
  {
    subject: 'feat: e (#6)',
    files: { 'packages/core/src/e.ts': 'export const e = 6;\n', 'docs/e.md': '# e\n' },
  },
  { subject: 'feat: f (#7)', files: { 'packages/core/src/f.ts': 'export const f = 7;\n' } },
];

function seedObject(
  asOfCommit: string,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    gate: 'gate-1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    repo: 'mmnto-ai/liquid-city',
    phase: 'certifying',
    selectionRule: {
      state: 'merged',
      predicate: 'code-touching non-bot non-revert',
      window: { type: 'all' },
      asOfCommit,
      codePathClassifier: { includeGlobs: ['packages/**'], excludeGlobs: ['**/*.md'] },
      excludeRevertPairs: true,
      excludeBotPrs: true,
    },
    split: { cutIndex: 2, excludedPrs: [] },
    controls: {
      positiveRef: '.totem/spine/gate-1/controls/positive',
      negativeRef: '.totem/spine/gate-1/controls/negative',
      mechanism: 'git-hash-object',
      positive: [{ pr: 6, targetRuleId: 'rule-x' }],
      negative: [7],
    },
    fpDefinition: { rubricRef: 'rubric', groundTruthRef: 'gt', adjudicator: 'disposition-derived' },
    cullRateThreshold: 0.1,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 1 },
    },
    ...overrides,
  };
}

function writeSeed(repoRoot: string, seed: Record<string, unknown>): string {
  const p = path.join(repoRoot, 'seed.json');
  fs.writeFileSync(p, JSON.stringify(seed, null, 2), 'utf-8');
  return p;
}

const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(p, 'utf-8'));
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

describe('materializeCommand', () => {
  let tmp: string;
  let lcDir: string;
  let gate1: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-corpus-'));
    lcDir = path.join(tmp, 'lc');
    gate1 = path.join(tmp, '.totem/spine/gate-1');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('materializes the 4 fixtures; output PASSES the real freeze gate (S4 + C6)', async () => {
    const { headSha } = makeRepo(lcDir, STANDARD_COMMITS);
    await materializeCommand({
      cwd: tmp,
      lcDir,
      manifestPath: writeSeed(tmp, seedObject(headSha)),
    });

    const lock = WindtunnelLockSchema.parse(readJson(path.join(gate1, 'windtunnel.lock.json')));
    const split = SplitArtifactSchema.parse(readJson(path.join(gate1, 'split.json')));
    const prDiffs = readJson(path.join(gate1, 'pr-diffs.json')) as Array<{
      pr: number;
      controlKind: string;
      targetRuleId?: string;
      diff: string;
    }>;

    // Corpus membership: docs-only #3 + the no-`(#N)` direct commit are excluded.
    expect(lock.corpus.resolvedPrs.map((p) => p.pr)).toEqual([1, 2, 5, 6, 7]);
    expect(split.trainPrs).toEqual([1, 2]);
    expect(split.heldOutPrs).toEqual([5, 6, 7]);

    // pr-diffs covers the held-out (scored) slice, controls tagged within it.
    expect(prDiffs.map((d) => d.pr)).toEqual([5, 6, 7]);
    expect(prDiffs.find((d) => d.pr === 5)!.controlKind).toBe('corpus');
    expect(prDiffs.find((d) => d.pr === 6)).toMatchObject({
      controlKind: 'positive',
      targetRuleId: 'rule-x',
    });
    expect(prDiffs.find((d) => d.pr === 7)!.controlKind).toBe('negative');
    expect(prDiffs.find((d) => d.pr === 5)!.diff).toContain('packages/core/src/d.ts');
    // A 'corpus'/'negative' row must NOT carry a targetRuleId (strict write-side, fold-1).
    expect(prDiffs.find((d) => d.pr === 7)!.targetRuleId).toBeUndefined();

    // Two-phase sealed lock: producer leaves llmReplaySha unstamped; integrity shas present.
    expect(lock.controls.integrity.llmReplaySha).toBeUndefined();
    expect(lock.controls.integrity.fixtureSha).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.controls.integrity.prDiffsSha).toMatch(/^[0-9a-f]{64}$/);

    // Control dirs: one <pr>.diff per control PR (single-source from the same diff).
    expect(fs.existsSync(path.join(gate1, 'controls/positive/6.diff'))).toBe(true);
    expect(fs.existsSync(path.join(gate1, 'controls/negative/7.diff'))).toBe(true);
    expect(fs.existsSync(path.join(gate1, 'controls/positive/5.diff'))).toBe(false);

    // END-TO-END: the produced lock passes the actual freeze checks unchanged.
    await assertCorpusCompleteness(lock, lcDir, tmp, safeExec);
    verifyControlIntegrity(
      [path.join(tmp, lock.controls.positiveRef), path.join(tmp, lock.controls.negativeRef)],
      lock.controls.integrity.fixtureSha,
      tmp,
      safeExec,
    );

    // fold-2 digest is the sha256 of the EXACT on-disk pr-diffs.json bytes — so a
    // freeze/run enforcer can hash the file directly (greptile/GCA panel).
    expect(sha256(fs.readFileSync(path.join(gate1, 'pr-diffs.json'), 'utf-8'))).toBe(
      lock.controls.integrity.prDiffsSha,
    );
  });

  it('is byte-deterministic — re-running yields identical fixture bytes', async () => {
    const { headSha } = makeRepo(lcDir, STANDARD_COMMITS);
    const manifest = writeSeed(tmp, seedObject(headSha));
    const files = [
      'windtunnel.lock.json',
      'split.json',
      'pr-diffs.json',
      'controls/positive/6.diff',
      'controls/negative/7.diff',
    ];

    await materializeCommand({ cwd: tmp, lcDir, manifestPath: manifest });
    const first = files.map((f) => fs.readFileSync(path.join(gate1, f)));

    await materializeCommand({ cwd: tmp, lcDir, manifestPath: manifest });
    const second = files.map((f) => fs.readFileSync(path.join(gate1, f)));

    files.forEach((f, i) => expect(second[i]!.equals(first[i]!), `${f} drifted`).toBe(true));
  });

  it('C6 red: tampering a control .diff breaks fixtureSha integrity (fail-loud)', async () => {
    const { headSha } = makeRepo(lcDir, STANDARD_COMMITS);
    await materializeCommand({
      cwd: tmp,
      lcDir,
      manifestPath: writeSeed(tmp, seedObject(headSha)),
    });
    const lock = WindtunnelLockSchema.parse(readJson(path.join(gate1, 'windtunnel.lock.json')));
    const controlDirs = [
      path.join(tmp, lock.controls.positiveRef),
      path.join(tmp, lock.controls.negativeRef),
    ];

    // baseline passes
    verifyControlIntegrity(controlDirs, lock.controls.integrity.fixtureSha, tmp, safeExec);
    // tamper one byte
    fs.appendFileSync(path.join(gate1, 'controls/positive/6.diff'), '\n// tampered\n');
    expect(() =>
      verifyControlIntegrity(controlDirs, lock.controls.integrity.fixtureSha, tmp, safeExec),
    ).toThrow(/control fixtures changed|integrity/i);
  });

  it('fold-2 red: tampering a pr-diffs row breaks the prDiffsSha digest', async () => {
    const { headSha } = makeRepo(lcDir, STANDARD_COMMITS);
    await materializeCommand({
      cwd: tmp,
      lcDir,
      manifestPath: writeSeed(tmp, seedObject(headSha)),
    });
    const lock = WindtunnelLockSchema.parse(readJson(path.join(gate1, 'windtunnel.lock.json')));

    // the digest = sha256 of the on-disk bytes, so reading the file back matches...
    const onDisk = fs.readFileSync(path.join(gate1, 'pr-diffs.json'), 'utf-8');
    expect(sha256(onDisk)).toBe(lock.controls.integrity.prDiffsSha);
    // ...a tampered control row (re-serialized the same way) does NOT (the hole
    // fixtureSha alone leaves open).
    const prDiffs = JSON.parse(onDisk) as Array<Record<string, unknown>>;
    const tampered = prDiffs.map((d) =>
      d.pr === 7 ? { ...d, diff: `${d.diff as string}// x` } : d,
    );
    expect(sha256(`${canonicalStringify(tampered, 2)}\n`)).not.toBe(
      lock.controls.integrity.prDiffsSha,
    );
  });

  it('fold-3: resolvePrGit throws on an empty diff for a code-touching PR', () => {
    // The guard `diff.trim().length === 0` in resolvePrGit isn't reachable via the
    // matrix repo (the only empty-diff PRs are non-code → excluded before resolve),
    // so exercise it directly: git succeeds (non-empty rev-parse) but the diff is
    // empty — must fail loud, not silently emit an empty frozen fixture.
    const fakeExec = ((_cmd: string, args: readonly string[]): string =>
      args[0] === 'rev-parse' ? '0'.repeat(40) : '') as Parameters<typeof resolvePrGit>[2];
    expect(() => resolvePrGit('/lc', 'a'.repeat(40), fakeExec)).toThrow(/EMPTY diff/);
  });

  it('fails loud on a malformed `(#abc)` merge subject (no silent shrink)', async () => {
    const { headSha } = makeRepo(lcDir, [
      { subject: 'chore: init', files: { 'base.txt': 'x\n' } },
      { subject: 'feat: a (#1)', files: { 'packages/core/src/a.ts': 'export const a = 1;\n' } },
      { subject: 'feat: bad (#abc)', files: { 'packages/core/src/b.ts': 'export const b = 2;\n' } },
    ]);
    await expect(
      materializeCommand({ cwd: tmp, lcDir, manifestPath: writeSeed(tmp, seedObject(headSha)) }),
    ).rejects.toThrow();
  });

  it('excludes a revert pair from the corpus (selectionRule reuse)', async () => {
    const { headSha } = makeRepo(lcDir, [
      { subject: 'chore: init', files: { 'base.txt': 'x\n' } },
      { subject: 'feat: a (#1)', files: { 'packages/core/src/a.ts': 'export const a = 1;\n' } },
      { subject: 'feat: b (#2)', files: { 'packages/core/src/b.ts': 'export const b = 2;\n' } },
      {
        subject: 'revert: b (#3)',
        files: { 'packages/core/src/b.ts': 'export const b = 2; // reverted\n' },
        body: (shas) => `This reverts commit ${shas[2]}.`, // shas[2] = #2
      },
      { subject: 'feat: d (#4)', files: { 'packages/core/src/d.ts': 'export const d = 4;\n' } },
      { subject: 'feat: e (#5)', files: { 'packages/core/src/e.ts': 'export const e = 5;\n' } },
    ]);
    const seed = seedObject(headSha, {
      split: { cutIndex: 1, excludedPrs: [] },
      controls: {
        positiveRef: '.totem/spine/gate-1/controls/positive',
        negativeRef: '.totem/spine/gate-1/controls/negative',
        mechanism: 'git-hash-object',
        positive: [{ pr: 4, targetRuleId: 'rule-y' }],
        negative: [5],
      },
    });
    await materializeCommand({ cwd: tmp, lcDir, manifestPath: writeSeed(tmp, seed) });

    const lock = WindtunnelLockSchema.parse(readJson(path.join(gate1, 'windtunnel.lock.json')));
    // #2 (reverted target) + #3 (the revert) both dropped.
    expect(lock.corpus.resolvedPrs.map((p) => p.pr)).toEqual([1, 4, 5]);
  });
});

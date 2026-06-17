import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WindtunnelLock } from '@mmnto/totem';
import { safeExec, WindtunnelLockSchema } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  assertCorpusCompleteness,
  buildReadStrategy,
  computeFixtureSha,
  isCommitAncestor,
  verifyControlIntegrity,
  verifyFreezeProof,
} from './spine-windtunnel.js';

// ─── Fixtures ────────────────────────────────────────────

const HEX40 = /^[0-9a-f]{40}$/;
const FAKE_SHA = 'a'.repeat(40);

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    cleanTmpDir(createdDirs.pop()!);
  }
});

/** Create an isolated temp dir tracked for afterEach cleanup. */
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-spine-wt-'));
  createdDirs.push(dir);
  return dir;
}

/** Initialize a throwaway git repo with a deterministic identity. */
function makeTmpRepo(): string {
  const dir = makeTmpDir();
  safeExec('git', ['init'], { cwd: dir });
  safeExec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  safeExec('git', ['config', 'user.name', 'Totem Test'], { cwd: dir });
  safeExec('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

/** Stage everything and commit; returns the new commit SHA. */
function commitAll(dir: string, message: string): string {
  safeExec('git', ['add', '-A'], { cwd: dir });
  safeExec('git', ['commit', '-m', message], { cwd: dir });
  return safeExec('git', ['rev-parse', 'HEAD'], { cwd: dir });
}

/** Build a schema-valid lock pinned to `asOfCommit`. */
function makeLock(asOfCommit: string): WindtunnelLock {
  return WindtunnelLockSchema.parse({
    schema: 'windtunnel.lock.v1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    gate: 'gate-1',
    phase: 'harness',
    corpus: {
      repo: 'mmnto-ai/liquid-city',
      selectionRule: {
        state: 'merged',
        predicate: 'code-touching',
        window: { type: 'all' },
        asOfCommit,
      },
      resolvedPrs: [
        { pr: 1, mergeCommit: 'b'.repeat(40), baseSha: 'c'.repeat(40), headSha: 'd'.repeat(40) },
      ],
    },
    fpDefinition: {
      rubricRef: '.totem/spine/gate-1/fp-rubric.md',
      groundTruthRef: '.totem/spine/gate-1/ground-truth-labels.json',
      adjudicator: 'frozen-ground-truth+operator-tiebreak',
      precisionFloor: 1.0,
    },
    controls: {
      positiveRef: '.totem/spine/gate-1/controls/positive/',
      negativeRef: '.totem/spine/gate-1/controls/negative/',
      integrity: { mechanism: '.wind-tunnel-sha', fixtureSha: 'e'.repeat(40) },
    },
    cullRateThreshold: 0.5,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
  });
}

// ─── verifyFreezeProof (C3) ──────────────────────────────

describe('verifyFreezeProof (C3 — git-derived freeze proof)', () => {
  it('throws when the lock has never been committed (repo has history, lock does not)', () => {
    const repo = makeTmpRepo();
    // The repo has commits, but the lock file itself was never committed —
    // git log succeeds and returns zero commits for the lock path.
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
    commitAll(repo, 'initial');
    const lockPath = path.join(repo, 'windtunnel.lock.json');
    fs.writeFileSync(lockPath, '{"a":1}\n');
    expect(() => verifyFreezeProof(lockPath, repo, safeExec)).toThrow(/never been committed/);
  });

  it('passes when the lock is committed and unchanged (CRLF/newline immune)', () => {
    const repo = makeTmpRepo();
    const lockPath = path.join(repo, 'windtunnel.lock.json');
    // Trailing newline present — a raw string compare against `git show` would
    // spuriously fail here; the hash-based proof must pass.
    fs.writeFileSync(lockPath, '{"a":1}\n');
    commitAll(repo, 'freeze lock');
    expect(() => verifyFreezeProof(lockPath, repo, safeExec)).not.toThrow();
  });

  it('throws when the lock was modified after freeze (tamper)', () => {
    const repo = makeTmpRepo();
    const lockPath = path.join(repo, 'windtunnel.lock.json');
    fs.writeFileSync(lockPath, '{"a":1}\n');
    commitAll(repo, 'freeze lock');
    fs.writeFileSync(lockPath, '{"a":2}\n'); // post-freeze tamper
    expect(() => verifyFreezeProof(lockPath, repo, safeExec)).toThrow(
      /differs from the committed blob/,
    );
  });
});

// ─── isCommitAncestor ────────────────────────────────────

describe('isCommitAncestor', () => {
  it('returns true for a genuine ancestor', () => {
    const repo = makeTmpRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    const c1 = commitAll(repo, 'c1');
    fs.writeFileSync(path.join(repo, 'b.txt'), '2');
    const c2 = commitAll(repo, 'c2');
    expect(isCommitAncestor(c1, c2, repo, safeExec)).toBe(true);
  });

  it('returns false for a non-ancestor (exit 1 is a clean boolean, not an error)', () => {
    const repo = makeTmpRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    const c1 = commitAll(repo, 'c1');
    fs.writeFileSync(path.join(repo, 'b.txt'), '2');
    const c2 = commitAll(repo, 'c2');
    expect(isCommitAncestor(c2, c1, repo, safeExec)).toBe(false);
  });

  it('re-throws on a bad ref rather than masking it as false', () => {
    const repo = makeTmpRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), '1');
    commitAll(repo, 'c1');
    expect(() => isCommitAncestor(FAKE_SHA, 'HEAD', repo, safeExec)).toThrow();
  });
});

// ─── buildReadStrategy (C2) ──────────────────────────────

describe('buildReadStrategy (C2 — post-image blob, throw on missing)', () => {
  it('returns null for every file when no lc clone is provided', async () => {
    const readStrategy = buildReadStrategy(undefined, FAKE_SHA, safeExec);
    expect(await readStrategy('any/file.ts')).toBeNull();
  });

  it('resolves the post-image blob from the lc clone at asOfCommit', async () => {
    const repo = makeTmpRepo();
    fs.writeFileSync(path.join(repo, 'src.ts'), 'export const x = 1;\n');
    const sha = commitAll(repo, 'add src');
    const readStrategy = buildReadStrategy(repo, sha, safeExec);
    expect(await readStrategy('src.ts')).toContain('export const x = 1;');
  });

  it('throws on an unresolvable blob — never a silent no-match (corpus shrinkage)', async () => {
    const repo = makeTmpRepo();
    fs.writeFileSync(path.join(repo, 'src.ts'), 'x\n');
    const sha = commitAll(repo, 'add src');
    const readStrategy = buildReadStrategy(repo, sha, safeExec);
    await expect(readStrategy('does-not-exist.ts')).rejects.toThrow(/unresolvable/);
  });
});

// ─── computeFixtureSha (integrity) ───────────────────────

describe('computeFixtureSha (gate-1-scoped integrity hash)', () => {
  it('returns null for an empty control dir', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    expect(computeFixtureSha(ctrl, repo, safeExec)).toBeNull();
  });

  it('returns a stable aggregate hash for a populated control dir', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    fs.writeFileSync(path.join(ctrl, 'a.diff'), 'aaa\n');
    fs.writeFileSync(path.join(ctrl, 'b.diff'), 'bbb\n');
    const first = computeFixtureSha(ctrl, repo, safeExec);
    const second = computeFixtureSha(ctrl, repo, safeExec);
    expect(first).toMatch(HEX40);
    expect(second).toBe(first);
  });

  it('changes when a control file changes (tamper-evident)', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    fs.writeFileSync(path.join(ctrl, 'a.diff'), 'aaa\n');
    const before = computeFixtureSha(ctrl, repo, safeExec);
    fs.writeFileSync(path.join(ctrl, 'a.diff'), 'CHANGED\n');
    const after = computeFixtureSha(ctrl, repo, safeExec);
    expect(after).not.toBe(before);
  });

  it('is stable across nested subdirectories (recursive + separator-normalized)', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(path.join(ctrl, 'positive'), { recursive: true });
    fs.mkdirSync(path.join(ctrl, 'negative'), { recursive: true });
    fs.writeFileSync(path.join(ctrl, 'positive', 'p1.diff'), 'p\n');
    fs.writeFileSync(path.join(ctrl, 'negative', 'n1.diff'), 'n\n');
    const first = computeFixtureSha(ctrl, repo, safeExec);
    const second = computeFixtureSha(ctrl, repo, safeExec);
    expect(first).toMatch(HEX40);
    expect(second).toBe(first);
  });
});

// ─── verifyControlIntegrity (C6 / §5) ────────────────────

describe('verifyControlIntegrity (C6 / §5 — mandatory, fail-loud)', () => {
  it('throws when the control dir is missing (no silent skip)', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls'); // never created
    expect(() => verifyControlIntegrity(ctrl, FAKE_SHA, repo, safeExec)).toThrow(/missing/);
  });

  it('throws when the control dir is empty', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    expect(() => verifyControlIntegrity(ctrl, FAKE_SHA, repo, safeExec)).toThrow(/empty/);
  });

  it('throws on a fixtureSha mismatch (tamper)', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    fs.writeFileSync(path.join(ctrl, 'a.diff'), 'aaa\n');
    expect(() => verifyControlIntegrity(ctrl, 'f'.repeat(40), repo, safeExec)).toThrow(/expected/);
  });

  it('passes when the control hash matches the declared fixtureSha', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    fs.writeFileSync(path.join(ctrl, 'a.diff'), 'aaa\n');
    const sha = computeFixtureSha(ctrl, repo, safeExec)!;
    expect(() => verifyControlIntegrity(ctrl, sha, repo, safeExec)).not.toThrow();
  });
});

// ─── assertCorpusCompleteness (S4) ───────────────────────

describe('assertCorpusCompleteness (S4 — loud on inaccessible clone)', () => {
  it('throws when the lc clone is inaccessible', async () => {
    const repo = makeTmpRepo();
    const missing = path.join(repo, 'no-such-clone');
    const lock = makeLock(FAKE_SHA);
    await expect(assertCorpusCompleteness(lock, missing, repo, safeExec)).rejects.toThrow(
      /cannot access lc clone/,
    );
  });

  it('resolves when the lc clone is accessible and includes asOfCommit', async () => {
    const lcRepo = makeTmpRepo();
    fs.writeFileSync(path.join(lcRepo, 'x.ts'), '1');
    const sha = commitAll(lcRepo, 'lc c1');
    const repo = makeTmpRepo();
    const lock = makeLock(sha);
    await expect(assertCorpusCompleteness(lock, lcRepo, repo, safeExec)).resolves.toBeUndefined();
  });
});

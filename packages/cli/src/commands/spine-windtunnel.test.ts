import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WindtunnelLock } from '@mmnto/totem';
import {
  isBotIdentity,
  parsePrNumber,
  parseRevertSha,
  safeExec,
  WindtunnelLockSchema,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  assertCorpusCompleteness,
  buildReadStrategy,
  computeFixtureSha,
  enumeratePrMetas,
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

/** Create populated positive + negative control dirs; returns [positive, negative]. */
function makeControlDirs(repo: string): [string, string] {
  const positive = path.join(repo, 'controls', 'positive');
  const negative = path.join(repo, 'controls', 'negative');
  fs.mkdirSync(positive, { recursive: true });
  fs.mkdirSync(negative, { recursive: true });
  fs.writeFileSync(path.join(positive, 'p1.diff'), 'positive control\n');
  fs.writeFileSync(path.join(negative, 'n1.diff'), 'negative control\n');
  return [positive, negative];
}

describe('computeFixtureSha (gate-1-scoped integrity hash)', () => {
  it('returns null when no control dir has files', () => {
    const repo = makeTmpRepo();
    const ctrl = path.join(repo, 'controls');
    fs.mkdirSync(ctrl, { recursive: true });
    expect(computeFixtureSha([ctrl], repo, safeExec)).toBeNull();
  });

  it('returns a stable aggregate hash across positive + negative dirs', () => {
    const repo = makeTmpRepo();
    const dirs = makeControlDirs(repo);
    const first = computeFixtureSha(dirs, repo, safeExec);
    const second = computeFixtureSha(dirs, repo, safeExec);
    expect(first).toMatch(HEX40);
    expect(second).toBe(first);
  });

  it('changes when a POSITIVE control file changes (tamper-evident)', () => {
    const repo = makeTmpRepo();
    const dirs = makeControlDirs(repo);
    const before = computeFixtureSha(dirs, repo, safeExec);
    fs.writeFileSync(path.join(dirs[0], 'p1.diff'), 'CHANGED\n');
    expect(computeFixtureSha(dirs, repo, safeExec)).not.toBe(before);
  });

  it('changes when a NEGATIVE control file changes (negative controls are protected too)', () => {
    const repo = makeTmpRepo();
    const dirs = makeControlDirs(repo);
    const before = computeFixtureSha(dirs, repo, safeExec);
    fs.writeFileSync(path.join(dirs[1], 'n1.diff'), 'CHANGED\n');
    expect(computeFixtureSha(dirs, repo, safeExec)).not.toBe(before);
  });
});

// ─── verifyControlIntegrity (C6 / §5) ────────────────────

describe('verifyControlIntegrity (C6 / §5 — mandatory, fail-loud)', () => {
  it('throws when a control dir is missing (no silent skip)', () => {
    const repo = makeTmpRepo();
    const [positive] = makeControlDirs(repo);
    const missingNegative = path.join(repo, 'controls', 'gone');
    expect(() =>
      verifyControlIntegrity([positive, missingNegative], FAKE_SHA, repo, safeExec),
    ).toThrow(/missing/);
  });

  it('throws when the control dirs are empty', () => {
    const repo = makeTmpRepo();
    const positive = path.join(repo, 'controls', 'positive');
    const negative = path.join(repo, 'controls', 'negative');
    fs.mkdirSync(positive, { recursive: true });
    fs.mkdirSync(negative, { recursive: true });
    expect(() => verifyControlIntegrity([positive, negative], FAKE_SHA, repo, safeExec)).toThrow(
      /empty/,
    );
  });

  it('throws on a fixtureSha mismatch (tamper)', () => {
    const repo = makeTmpRepo();
    const dirs = makeControlDirs(repo);
    expect(() => verifyControlIntegrity(dirs, 'f'.repeat(40), repo, safeExec)).toThrow(/expected/);
  });

  it('passes when the aggregate hash matches the declared fixtureSha', () => {
    const repo = makeTmpRepo();
    const dirs = makeControlDirs(repo);
    const sha = computeFixtureSha(dirs, repo, safeExec)!;
    expect(() => verifyControlIntegrity(dirs, sha, repo, safeExec)).not.toThrow();
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

// ─── S4 selectionRule resolver (#2189 item 2, mocked git) ───

const F = '\x1f';
const R = '\x1e';
const HELPERS = { parsePrNumber, parseRevertSha, isBotIdentity };
const CLASSIFIER = { includeGlobs: ['packages/**/*.ts', 'src/**'], excludeGlobs: ['**/*.md'] };

interface LogRecord {
  sha: string;
  author: string;
  subject: string;
  body?: string;
  files?: string[];
}

/**
 * Build a `git log --name-only --format=%x1e…` stream: a record separator leads
 * each commit, the format fields follow, then the changed-file list — matching
 * the single-call shape `enumeratePrMetas` parses.
 */
function buildLog(records: LogRecord[], eol: '\n' | '\r\n' = '\n'): string {
  const stream = records
    .map(
      (r) =>
        `${R}${r.sha}${F}${r.author}${F}${r.subject}${F}${r.body ?? ''}${F}\n${(r.files ?? []).join('\n')}\n`,
    )
    .join('');
  return eol === '\r\n' ? stream.replace(/\n/g, '\r\n') : stream;
}

/** Mock safeExec routing the git calls the resolver makes (single `git log`). */
function mockSafeExec(opts: {
  headSha: string;
  isAncestor: boolean;
  log: string;
}): typeof safeExec {
  return ((file: string, args: string[]) => {
    if (file !== 'git') throw new Error(`unexpected exec: ${file}`);
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return opts.headSha;
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (opts.isAncestor) return '';
      const err = new Error('not an ancestor') as Error & { status: number };
      err.status = 1;
      throw err;
    }
    if (args[0] === 'log') return opts.log;
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  }) as unknown as typeof safeExec;
}

const sha40 = (n: number): string => `${n}`.padStart(40, '0');

function makeCertLock(
  asOfCommit: string,
  prNums: number[],
  classifier: unknown = CLASSIFIER,
): WindtunnelLock {
  return WindtunnelLockSchema.parse({
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
        asOfCommit,
        ...(classifier != null ? { codePathClassifier: classifier } : {}),
      },
      resolvedPrs: prNums.map((n) => ({
        pr: n,
        mergeCommit: sha40(n),
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
  });
}

// Scenario: git derives [534, 535]; #536 is docs-only → excluded.
const SCENARIO_RECORDS: LogRecord[] = [
  {
    sha: sha40(534),
    author: 'Jane <j@x.com>',
    subject: 'feat: a (#534)',
    files: ['packages/core/src/a.ts'],
  },
  { sha: sha40(535), author: 'Jane <j@x.com>', subject: 'fix: b (#535)', files: ['src/b.ts'] },
  { sha: sha40(536), author: 'Jane <j@x.com>', subject: 'docs: c (#536)', files: ['README.md'] },
];

describe('enumeratePrMetas (mocked git)', () => {
  it('parses PRs, skips no-ref commits, and is CRLF-immune (log + changed files)', () => {
    const records: LogRecord[] = [
      {
        sha: sha40(534),
        author: 'Jane <j@x.com>',
        subject: 'feat: alpha (#534)',
        files: ['packages/core/src/a.ts', 'packages/core/src/b.ts'],
      },
      {
        sha: sha40(535),
        author: 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', // real git %an <%ae>
        subject: 'chore(deps): bump (#535)',
        files: ['package.json'],
      },
      {
        sha: sha40(700),
        author: 'Bot Op <o@x.com>',
        subject: 'chore(deps): straight to main 1.66.0',
        files: ['x.ts'],
      },
      {
        sha: sha40(536),
        author: 'Jane <j@x.com>',
        subject: 'fix: revert it (#536)',
        body: `This reverts commit ${sha40(534)}`,
        files: ['src/x.ts'],
      },
    ];
    const lf = enumeratePrMetas(
      'aof',
      'lc',
      mockSafeExec({ headSha: 'h'.repeat(40), isAncestor: true, log: buildLog(records, '\n') }),
      HELPERS,
    );
    const crlf = enumeratePrMetas(
      'aof',
      'lc',
      mockSafeExec({ headSha: 'h'.repeat(40), isAncestor: true, log: buildLog(records, '\r\n') }),
      HELPERS,
    );
    expect(lf).toEqual(crlf); // CRLF hygiene: identical metas + clean file paths regardless of EOL
    expect(lf.map((m) => m.pr)).toEqual([534, 535, 536]); // direct-to-main (#700-slot) skipped
    expect(lf.find((m) => m.pr === 535)!.isBotAuthor).toBe(true);
    expect(lf.find((m) => m.pr === 536)!.revertsSha).toBe(sha40(534));
    expect(lf.find((m) => m.pr === 534)!.changedFiles).toEqual([
      'packages/core/src/a.ts',
      'packages/core/src/b.ts',
    ]); // no \r leaked
  });

  it('enumerates in ANCESTRY order via `git log --topo-order` (§6 ancestry-not-timestamp)', () => {
    // A `bounded` window takes "the N most recent qualifying PRs" off the FRONT of
    // this list, so the git emission order must be ancestry (topological), never
    // commit-date — dates are non-monotonic/rewritable and would make the window's
    // membership non-deterministic (ADR-110 §6; strategy-claude 2026-06-18 ruling).
    let logArgs: string[] | undefined;
    const capturing = ((file: string, args: string[]) => {
      if (file === 'git' && args[0] === 'log') {
        logArgs = args;
        return buildLog(SCENARIO_RECORDS);
      }
      throw new Error(`unexpected git call: ${file} ${args.join(' ')}`);
    }) as unknown as typeof safeExec;
    enumeratePrMetas('aof', 'lc', capturing, HELPERS);
    expect(logArgs).toContain('--topo-order');
    // Must be a walk option (before the `--end-of-options`/ref boundary) so it
    // actually governs ordering rather than being parsed as a pathspec.
    expect(logArgs!.indexOf('--topo-order')).toBeLessThan(logArgs!.indexOf('--end-of-options'));
  });

  it('propagates a malformed trailing ref as a throw (never silent)', () => {
    const records: LogRecord[] = [
      { sha: sha40(1), author: 'Jane <j@x.com>', subject: 'bad (#abc)', files: ['src/x.ts'] },
    ];
    expect(() =>
      enumeratePrMetas(
        'aof',
        'lc',
        mockSafeExec({ headSha: 'h'.repeat(40), isAncestor: true, log: buildLog(records) }),
        HELPERS,
      ),
    ).toThrow(/Malformed PR ref/);
  });

  it('throws on a truncated/malformed git record (<5 fields) — never silent (CodeRabbit)', () => {
    const truncated = `${R}${sha40(1)}${F}Jane <j@x.com>${F}feat: x (#5)`; // only 3 fields
    expect(() =>
      enumeratePrMetas(
        'aof',
        'lc',
        mockSafeExec({ headSha: 'h'.repeat(40), isAncestor: true, log: truncated }),
        HELPERS,
      ),
    ).toThrow(/malformed git log record/);
  });
});

describe('assertCorpusCompleteness (S4, mocked git)', () => {
  const asOf = 'f'.repeat(40);
  const exec = (isAncestor = true): typeof safeExec =>
    mockSafeExec({ headSha: 'h'.repeat(40), isAncestor, log: buildLog(SCENARIO_RECORDS) });

  it('harness phase is warn-only — never throws even on a count mismatch', async () => {
    const lock = makeLock(asOf); // phase: harness, resolvedPrs: [#1]
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', exec())).resolves.toBeUndefined();
  });

  it('certifying phase passes when resolvedPrs ≡ selectionRule', async () => {
    const lock = makeCertLock(asOf, [534, 535]);
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', exec())).resolves.toBeUndefined();
  });

  it('certifying phase throws naming missing + extra on divergence', async () => {
    const lock = makeCertLock(asOf, [534, 999]); // missing 535, extra 999
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', exec())).rejects.toThrow(
      /Missing from manifest.*535[\s\S]*Extra in manifest.*999/,
    );
  });

  it('certifying phase throws when codePathClassifier is absent', async () => {
    const lock = makeCertLock(asOf, [534, 535], null);
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', exec())).rejects.toThrow(
      /codePathClassifier is required/,
    );
  });

  it('certifying phase throws when asOfCommit is not an ancestor of lc HEAD', async () => {
    const lock = makeCertLock(asOf, [534, 535]);
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', exec(false))).rejects.toThrow(
      /not an ancestor/,
    );
  });

  it('certifying phase wraps a malformed-ref parse error as a TotemError (greptile P2)', async () => {
    const lock = makeCertLock(asOf, [534, 535]);
    const badExec = mockSafeExec({
      headSha: 'h'.repeat(40),
      isAncestor: true,
      log: buildLog([
        { sha: sha40(1), author: 'Jane <j@x.com>', subject: 'bad (#abc)', files: ['src/x.ts'] },
      ]),
    });
    await expect(assertCorpusCompleteness(lock, 'lc', 'repo', badExec)).rejects.toThrow(
      /Wind-tunnel freeze \(S4\):.*Malformed PR ref/,
    );
  });

  it('rejects a codePathClassifier with empty includeGlobs at parse (greptile P2)', () => {
    expect(() => makeCertLock(asOf, [534], { includeGlobs: [], excludeGlobs: [] })).toThrow(
      /at least one glob/,
    );
  });
});

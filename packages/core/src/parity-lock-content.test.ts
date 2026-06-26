/**
 * Tests for the strategy-doctrine lock-content parity detector (mmnto-ai/totem#2107,
 * strategy#754). Covers the §6 normalizer's byte-for-byte parity with the publisher,
 * the lock-schema boundary parser, the two-layer (self-consistency + vs-canonical)
 * honest-absent taxonomy via injected seams, plus a real-lock integration check + the
 * current-local-drift exhibit when a `../totem-strategy` sibling resolves.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type DetectLockContentContext,
  detectLockContentContract,
  hashLockArtifact,
  normalizeLockArtifact,
  parseStrategyDoctrineLock,
  type StrategyDoctrineLock,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';
import { resolveStrategyRoot, type StrategyRootStatus } from './strategy-resolver.js';

// ─── Fixtures ───────────────────────────────────────────

const CONTRACT_ID = 'strategy-doctrine-lock-content';

function makeContract(overrides: Partial<ParityContract> = {}): ParityContract {
  return {
    id: CONTRACT_ID,
    dimension: 'doctrine-distribution',
    canonicalSource: 'mmnto-ai/totem-strategy',
    detectionMethod: 'sha256(normalize(content)) == lock content-hash',
    expectedValueOrDerivation: 'every artifact recompute equals its lock content-hash',
    tractability: 'mechanical',
    trackingIssue: 'mmnto-ai/totem#2107',
    package: '@mmnto/strategy-doctrine',
    manifestation: 'content-hash',
    consumers: ['totem', 'totem-status', 'liquid-city'],
    ...overrides,
  };
}

const PKG_DIR = path.resolve('lock-content-test-pkg');
const STRATEGY_DIR = path.resolve('lock-content-test-strategy');
const LOCK_PATH = path.join(PKG_DIR, 'strategy-doctrine.lock');

/** Build a content-hash lock JSON string from artifact specs. */
function buildLockJson(
  artifacts: Array<{ path: string; canonicalSource: string; contentHash: string; sha?: string }>,
): string {
  return JSON.stringify(
    {
      'schema-version': 1,
      package: '@mmnto/strategy-doctrine',
      version: '0.1.13',
      published: '2026-06-25T22:18:55.324Z',
      artifacts: artifacts.map((a) => ({
        path: a.path,
        'canonical-source': a.canonicalSource,
        'content-hash': a.contentHash,
        'last-published-sha': a.sha ?? '74816d869922d847680dd956896c47388e9833d6',
      })),
    },
    null,
    2,
  );
}

/** A context whose every fs/git seam is injected (no disk, no git). */
function seamCtx(
  files: Record<string, string>,
  opts: {
    dirs?: string[];
    sibling?: StrategyRootStatus;
    repoId?: string;
    gitObjectExists?: boolean;
  } = {},
): DetectLockContentContext {
  const dirSet = new Set(opts.dirs ?? [PKG_DIR]);
  return {
    repoId: opts.repoId ?? 'totem',
    packageDir: PKG_DIR,
    gitRoot: path.resolve('lock-content-test-root'),
    readFile: (p) => (p in files ? files[p] : undefined),
    dirExists: (p) => dirSet.has(p),
    resolveStrategyRootFn: () =>
      opts.sibling ?? { resolved: false, reason: 'no sibling (test default)' },
    gitObjectExists: () => opts.gitObjectExists ?? false,
  };
}

// ─── normalizeLockArtifact + hashLockArtifact (golden) ──

describe('normalizeLockArtifact — §6 byte-for-byte parity', () => {
  it('golden: trailing tabs/spaces + MULTIPLE trailing blanks + CRLF → fixed hash', () => {
    const raw = 'line one \t\r\nline two\t \r\n\r\n\r\n';
    const normalized = normalizeLockArtifact(raw);
    expect(normalized).toBe('line one\nline two\n');
    // Hard-pasted precomputed digest — drift in the normalizer flips this.
    expect(hashLockArtifact(normalized)).toBe(
      'sha256:e9024f1a07d29d52ad3aa5e1a18e94db1f3a9fd32b89e39d47c472cd99071e13',
    );
  });

  it('pops ALL trailing blank lines and adds EXACTLY one terminal LF', () => {
    expect(normalizeLockArtifact('a\n\n\n\n')).toBe('a\n');
    expect(normalizeLockArtifact('a')).toBe('a\n');
    expect(normalizeLockArtifact('a\n')).toBe('a\n');
    // An all-blank input collapses to a single terminal LF (never empty).
    expect(normalizeLockArtifact('\r\n  \n\t\n')).toBe('\n');
  });

  it('preserves LEADING blank lines (DISTINCT from normalizeManagedBlock)', () => {
    expect(normalizeLockArtifact('\n\nbody\n')).toBe('\n\nbody\n');
  });

  it('CRLF determinism: LF / CRLF / mixed CR produce identical digests', () => {
    const lf = 'alpha\nbeta\ngamma\n';
    const crlf = 'alpha\r\nbeta\r\ngamma\r\n';
    const mixed = 'alpha\r\nbeta\ngamma\r';
    const h = (s: string): string => hashLockArtifact(normalizeLockArtifact(s));
    expect(h(crlf)).toBe(h(lf));
    expect(h(mixed)).toBe(h(lf));
  });

  it('is idempotent — re-normalizing an already-normalized string is a no-op', () => {
    const once = normalizeLockArtifact('x \ny\t\n\n');
    expect(normalizeLockArtifact(once)).toBe(once);
  });

  it('matches Node crypto directly (no hidden encoding)', () => {
    const norm = normalizeLockArtifact('hello\n');
    const expected = 'sha256:' + crypto.createHash('sha256').update(norm, 'utf-8').digest('hex');
    expect(hashLockArtifact(norm)).toBe(expected);
  });
});

// ─── parseStrategyDoctrineLock ──────────────────────────

describe('parseStrategyDoctrineLock', () => {
  it('parses a valid lock → ok with camelCase artifacts', () => {
    const json = buildLockJson([
      {
        path: 'a.yaml',
        canonicalSource: 'mmnto-ai/totem-strategy:doctrine/a.yaml',
        contentHash: 'sha256:aa',
      },
    ]);
    const r = parseStrategyDoctrineLock(json);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const lock: StrategyDoctrineLock = r.lock;
    expect(lock.artifacts[0]).toEqual({
      path: 'a.yaml',
      canonicalSource: 'mmnto-ai/totem-strategy:doctrine/a.yaml',
      contentHash: 'sha256:aa',
      lastPublishedSha: '74816d869922d847680dd956896c47388e9833d6',
    });
  });

  it('invalid JSON → unparseable (never throws)', () => {
    const r = parseStrategyDoctrineLock('{not json');
    expect(r.status).toBe('unparseable');
  });

  it('non-1 schema-version → unsupported-schema', () => {
    const r = parseStrategyDoctrineLock(JSON.stringify({ 'schema-version': 2, artifacts: [] }));
    expect(r).toEqual({ status: 'unsupported-schema', schemaVersion: 2 });
  });

  it('missing numeric schema-version → unparseable', () => {
    const r = parseStrategyDoctrineLock(JSON.stringify({ package: 'x', artifacts: [] }));
    expect(r.status).toBe('unparseable');
  });

  it('malformed artifact row → unparseable (Zod boundary)', () => {
    const r = parseStrategyDoctrineLock(
      JSON.stringify({
        'schema-version': 1,
        package: 'x',
        version: '1',
        published: 't',
        artifacts: [{ path: 'a' }],
      }),
    );
    expect(r.status).toBe('unparseable');
  });
});

// ─── detectLockContentContract — applicability + top-level honest-absent ──

describe('detectLockContentContract — applicability / top-level', () => {
  it('not a consumer → single skip line', () => {
    const lines = detectLockContentContract(makeContract(), seamCtx({}, { repoId: 'other-repo' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.verdict.status).toBe('skip');
    expect(lines[0]!.verdict.message).toContain('cohort permits absence');
  });

  it('repo id unresolvable under a scoped contract → skip', () => {
    const ctx = seamCtx({});
    delete (ctx as { repoId?: string }).repoId;
    const lines = detectLockContentContract(makeContract(), ctx);
    expect(lines[0]!.verdict.status).toBe('skip');
    expect(lines[0]!.verdict.message).toContain('repo id unresolvable');
  });

  it('package not installed → skip (the currency row senses the pin)', () => {
    const lines = detectLockContentContract(makeContract(), seamCtx({}, { dirs: [] }));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.verdict.status).toBe('skip');
    expect(lines[0]!.verdict.message).toContain('not installed');
  });

  it('package present but lock absent → warn (structurally incomplete)', () => {
    const lines = detectLockContentContract(makeContract(), seamCtx({}));
    expect(lines).toHaveLength(1);
    expect(lines[0]!.verdict.status).toBe('warn');
    expect(lines[0]!.verdict.message).toContain('structurally incomplete');
  });

  it('lock unparseable → warn', () => {
    const lines = detectLockContentContract(makeContract(), seamCtx({ [LOCK_PATH]: '{broken' }));
    expect(lines[0]!.verdict.status).toBe('warn');
    expect(lines[0]!.verdict.message).toContain('unparseable');
  });

  it('lock unsupported-schema → warn', () => {
    const lines = detectLockContentContract(
      makeContract(),
      seamCtx({ [LOCK_PATH]: JSON.stringify({ 'schema-version': 99, artifacts: [] }) }),
    );
    expect(lines[0]!.verdict.status).toBe('warn');
    expect(lines[0]!.verdict.message).toContain('schema-version 99');
  });

  it('lock with empty artifacts[] → warn', () => {
    const lines = detectLockContentContract(
      makeContract(),
      seamCtx({ [LOCK_PATH]: buildLockJson([]) }),
    );
    expect(lines[0]!.verdict.status).toBe('warn');
    expect(lines[0]!.verdict.message).toContain('no artifacts');
  });
});

// ─── detectLockContentContract — the two layers ──

describe('detectLockContentContract — self-consistency + vs-canonical layers', () => {
  const artifactPath = 'parity-manifest.yaml';
  const canonicalSource = 'mmnto-ai/totem-strategy:doctrine/parity-manifest.yaml';
  const goodContent = 'reviews:\n  profile: assertive\n';
  const goodHash = hashLockArtifact(normalizeLockArtifact(goodContent));
  const artFile = path.resolve(PKG_DIR, artifactPath);

  it('self pass + vs-canonical skip when no sibling resolves', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([{ path: artifactPath, canonicalSource, contentHash: goodHash }]),
      [artFile]: goodContent,
    };
    const lines = detectLockContentContract(makeContract(), seamCtx(files));
    expect(lines).toHaveLength(2);
    const self = lines.find((l) => l.lineName.includes('· self'))!;
    const vs = lines.find((l) => l.lineName.includes('· vs-canonical'))!;
    expect(self.verdict.status).toBe('pass');
    expect(self.verdict.message).toContain('intact');
    expect(self.verdict.message).toContain('last-published-sha');
    expect(vs.verdict.status).toBe('skip');
    expect(vs.verdict.message).toContain('never a fetch');
  });

  it('self warn on hash mismatch (integrity drift)', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([
        { path: artifactPath, canonicalSource, contentHash: 'sha256:deadbeef' },
      ]),
      [artFile]: goodContent,
    };
    const self = detectLockContentContract(makeContract(), seamCtx(files)).find((l) =>
      l.lineName.includes('· self'),
    )!;
    expect(self.verdict.status).toBe('warn');
    expect(self.verdict.message).toContain('integrity drift');
  });

  it('self warn when the packaged artifact file is absent', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([{ path: artifactPath, canonicalSource, contentHash: goodHash }]),
    };
    const self = detectLockContentContract(makeContract(), seamCtx(files)).find((l) =>
      l.lineName.includes('· self'),
    )!;
    expect(self.verdict.status).toBe('warn');
    expect(self.verdict.message).toContain('absent');
  });

  it('vs-canonical pass when the sibling canonical matches', () => {
    const canonFile = path.resolve(STRATEGY_DIR, 'doctrine/parity-manifest.yaml');
    const files = {
      [LOCK_PATH]: buildLockJson([{ path: artifactPath, canonicalSource, contentHash: goodHash }]),
      [artFile]: goodContent,
      [canonFile]: goodContent,
    };
    const vs = detectLockContentContract(
      makeContract(),
      seamCtx(files, {
        sibling: { resolved: true, path: STRATEGY_DIR, source: 'sibling' },
        gitObjectExists: true,
      }),
    ).find((l) => l.lineName.includes('· vs-canonical'))!;
    expect(vs.verdict.status).toBe('pass');
    expect(vs.verdict.message).toContain('strategy-canonical');
    expect(vs.verdict.message).toContain('resolvable in sibling');
  });

  it('vs-canonical warn (currency drift) when the sibling canonical advanced', () => {
    const canonFile = path.resolve(STRATEGY_DIR, 'doctrine/parity-manifest.yaml');
    const files = {
      [LOCK_PATH]: buildLockJson([{ path: artifactPath, canonicalSource, contentHash: goodHash }]),
      [artFile]: goodContent,
      [canonFile]: 'reviews:\n  profile: chill\n', // advanced canonical
    };
    const vs = detectLockContentContract(
      makeContract(),
      seamCtx(files, { sibling: { resolved: true, path: STRATEGY_DIR, source: 'sibling' } }),
    ).find((l) => l.lineName.includes('· vs-canonical'))!;
    expect(vs.verdict.status).toBe('warn');
    expect(vs.verdict.message).toContain('currency drift');
  });

  it('vs-canonical warn when the canonical-source path is absent in the sibling', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([{ path: artifactPath, canonicalSource, contentHash: goodHash }]),
      [artFile]: goodContent,
    };
    const vs = detectLockContentContract(
      makeContract(),
      seamCtx(files, { sibling: { resolved: true, path: STRATEGY_DIR, source: 'sibling' } }),
    ).find((l) => l.lineName.includes('· vs-canonical'))!;
    expect(vs.verdict.status).toBe('warn');
    expect(vs.verdict.message).toContain('absent under the resolved sibling');
  });

  it('vs-canonical skip when canonical-source is not a totem-strategy ref', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([
        { path: artifactPath, canonicalSource: 'some-other/repo:x.yaml', contentHash: goodHash },
      ]),
      [artFile]: goodContent,
    };
    const vs = detectLockContentContract(
      makeContract(),
      seamCtx(files, { sibling: { resolved: true, path: STRATEGY_DIR, source: 'sibling' } }),
    ).find((l) => l.lineName.includes('· vs-canonical'))!;
    expect(vs.verdict.status).toBe('skip');
    expect(vs.verdict.message).toContain('unprovable this slice');
  });

  it('emits one line per artifact × per layer; never fail/throw', () => {
    const a2 = 'freeze.json';
    const c2 = 'mmnto-ai/totem-strategy:.totem/freeze.json';
    const body2 = '{"frozen":[]}\n';
    const files = {
      [LOCK_PATH]: buildLockJson([
        { path: artifactPath, canonicalSource, contentHash: goodHash },
        {
          path: a2,
          canonicalSource: c2,
          contentHash: hashLockArtifact(normalizeLockArtifact(body2)),
        },
      ]),
      [artFile]: goodContent,
      [path.resolve(PKG_DIR, a2)]: body2,
    };
    const lines = detectLockContentContract(makeContract(), seamCtx(files));
    expect(lines).toHaveLength(4); // 2 artifacts × 2 layers
    expect(lines.every((l) => l.verdict.status !== 'fail')).toBe(true);
  });

  it('a path-escaping artifact entry is refused, never read out of dir', () => {
    const files = {
      [LOCK_PATH]: buildLockJson([
        { path: '../../escape.txt', canonicalSource, contentHash: goodHash },
      ]),
    };
    const self = detectLockContentContract(makeContract(), seamCtx(files)).find((l) =>
      l.lineName.includes('· self'),
    )!;
    expect(self.verdict.status).toBe('warn');
    expect(self.verdict.message).toContain('escapes the package dir');
  });
});

// ─── Real-lock integration + current-local-drift exhibit ──

/** Walk up from this test file to locate the installed @mmnto/strategy-doctrine dir. */
function findStrategyDoctrineDir(): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'node_modules', '@mmnto', 'strategy-doctrine');
    if (fs.existsSync(path.join(candidate, 'strategy-doctrine.lock'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

describe('detectLockContentContract — real installed lock (integration)', () => {
  const pkgDir = findStrategyDoctrineDir();

  it.skipIf(pkgDir === undefined)(
    'every packaged artifact self-consistently matches its own lock content-hash',
    () => {
      const lockText = fs.readFileSync(path.join(pkgDir!, 'strategy-doctrine.lock'), 'utf-8');
      const parsed = parseStrategyDoctrineLock(lockText);
      expect(parsed.status).toBe('ok');
      if (parsed.status !== 'ok') return;
      for (const artifact of parsed.lock.artifacts) {
        const raw = fs.readFileSync(path.join(pkgDir!, artifact.path), 'utf-8');
        expect(hashLockArtifact(normalizeLockArtifact(raw))).toBe(artifact.contentHash);
      }
    },
  );

  it.skipIf(pkgDir === undefined)('self layer all-pass against the real package', () => {
    const lines = detectLockContentContract(makeContract(), {
      repoId: 'totem',
      packageDir: pkgDir!,
      gitRoot: path.resolve('.'),
      // Keep this hermetic: no sibling resolution, no git shell-out.
      resolveStrategyRootFn: () => ({ resolved: false, reason: 'pinned off for integration test' }),
      gitObjectExists: () => false,
    });
    const selfLines = lines.filter((l) => l.lineName.includes('· self'));
    expect(selfLines.length).toBeGreaterThanOrEqual(3);
    expect(selfLines.every((l) => l.verdict.status === 'pass')).toBe(true);
  });

  it.skipIf(pkgDir === undefined)(
    'current-local-drift exhibit: when a ../totem-strategy sibling resolves, self all-pass + vs-canonical ran (no skip, pass|warn only)',
    () => {
      // The repo root is the parent of node_modules/@mmnto/strategy-doctrine.
      const repoRoot = path.resolve(pkgDir!, '..', '..', '..');
      const sibling = resolveStrategyRoot(repoRoot, { gitRoot: repoRoot });
      if (!sibling.resolved) return; // no local sibling in this environment → exhibit n/a
      const lines = detectLockContentContract(makeContract(), {
        repoId: 'totem',
        packageDir: pkgDir!,
        gitRoot: repoRoot,
        gitObjectExists: () => true, // pin the provenance note so a git shell-out can't flake the assert
      });
      const selfLines = lines.filter((l) => l.lineName.includes('· self'));
      const vsLines = lines.filter((l) => l.lineName.includes('· vs-canonical'));
      // Self-consistency is environment-independent: the shipped snapshot is intact.
      expect(selfLines.every((l) => l.verdict.status === 'pass')).toBe(true);
      // The sibling resolved, so vs-canonical actually RAN — never skip. A `warn` is the
      // expected current-local-drift exhibit (the local canonical advanced past the pin);
      // a `pass` is a freshly-published bundle. Both are legitimate; `skip` would mean the
      // honest-absent branch fired despite a resolved sibling (a bug).
      expect(vsLines.length).toBe(selfLines.length);
      expect(vsLines.every((l) => l.verdict.status === 'pass' || l.verdict.status === 'warn')).toBe(
        true,
      );
    },
  );
});

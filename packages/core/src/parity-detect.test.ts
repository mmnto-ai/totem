/**
 * Tests for the version-pinned parity drift detector (PR-1,
 * mmnto-ai/totem#2069 on top of skeleton #2070).
 *
 * The detector is pure + side-effect-free: every filesystem / git seam is
 * injectable so these tests drive it against synthetic fixtures, NOT the live
 * cohort. Each invariant from the spec's "Invariants to lock via tests" list
 * gets a case: pass / warn / fail-under-blocking+strict (the fail-promotion is a
 * CLI-edge concern — the detector itself only ever returns warn here) / skip on
 * not-declared / skip on not-a-consumer / skip on floor-unresolved /
 * no-throw-on-read-failure / never-networks / claim-class-bound (pin currency
 * only, never content equality).
 *
 * Mirrors the temp-file + discriminated-union style of `parity-manifest.test.ts`
 * and the injected-seam style of `strategy-resolver.test.ts`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  deriveCohortRepoId,
  type DetectGeneratedArtifactContext,
  detectGeneratedArtifactContract,
  type DetectMechanicalContext,
  detectMechanicalContract,
  type DetectVersionPinnedContext,
  detectVersionPinnedContract,
  extractManagedBlock,
  hashManagedBlock,
  normalizeManagedBlock,
  packageNameForContract,
  parseForkMarker,
  resolveCohortFloor,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-parity-detect-'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// ─── Fixture builders ───────────────────────────────────

/** Build a minimal version-pinned deps contract for one of the 4 PR-1 ids. */
function depsContract(over: Partial<ParityContract> = {}): ParityContract {
  return {
    id: 'mmnto-totem-version',
    dimension: 'dependency-cohort',
    canonicalSource: 'mmnto-ai/totem',
    detectionMethod: 'consumer package.json caret range + resolved install vs floor',
    expectedValueOrDerivation: 'consumer pin resolves to the current published @mmnto/totem',
    tractability: 'version-pinned',
    trackingIssue: 'mmnto-ai/totem-strategy#482',
    ...over,
  };
}

/** Write a `packages/<dir>/package.json` with the given name + version. */
function writePackage(rootDir: string, dir: string, name: string, version: string): void {
  const pkgDir = path.join(rootDir, 'packages', dir);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name, version }, null, 2),
    'utf-8',
  );
}

/**
 * Write a self-in-tree totem monorepo at `rootDir` carrying `@mmnto/totem` at
 * `version`, plus a marker package so the glob has more than one entry.
 */
function writeSelfInTree(rootDir: string, version: string): void {
  writePackage(rootDir, 'totem', '@mmnto/totem', version);
  writePackage(rootDir, 'cli', '@mmnto/cli', version);
}

/** Build a base context with all seams pointed at the temp consumer repo. */
function baseCtx(over: Partial<DetectVersionPinnedContext> = {}): DetectVersionPinnedContext {
  return {
    cwd: tmpRoot,
    gitRoot: tmpRoot,
    repoId: 'totem-status',
    ...over,
  };
}

/** Write the consumer's package.json declaring `name` in `dependencies`. */
function writeConsumerPkg(
  rootDir: string,
  deps: Record<string, string>,
  field: 'dependencies' | 'devDependencies' | 'optionalDependencies' = 'dependencies',
): void {
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'consumer-repo', [field]: deps }, null, 2),
    'utf-8',
  );
}

/** Write `node_modules/<pkg>/package.json#version` so install resolution wins. */
function writeInstalled(rootDir: string, pkg: string, version: string): void {
  const dir = path.join(rootDir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: pkg, version }, null, 2),
    'utf-8',
  );
}

// ─── packageNameForContract ─────────────────────────────

describe('packageNameForContract', () => {
  it('derives @mmnto/<x> from an `mmnto-<x>-version` id with no path locator', () => {
    expect(packageNameForContract(depsContract({ id: 'mmnto-totem-version' }))).toBe(
      '@mmnto/totem',
    );
    expect(packageNameForContract(depsContract({ id: 'mmnto-mcp-version' }))).toBe('@mmnto/mcp');
    expect(packageNameForContract(depsContract({ id: 'mmnto-cli-version' }))).toBe('@mmnto/cli');
    expect(
      packageNameForContract(depsContract({ id: 'mmnto-pack-rust-architecture-version' })),
    ).toBe('@mmnto/pack-rust-architecture');
  });

  it('prefers the canonical-source package.json `name` when a path locator is present', () => {
    writePackage(tmpRoot, 'cli', '@mmnto/cli', '1.0.0');
    const contract = depsContract({
      id: 'mmnto-cli-version',
      canonicalSource: 'mmnto-ai/totem:packages/cli/package.json#version',
    });
    expect(packageNameForContract(contract, tmpRoot)).toBe('@mmnto/cli');
  });

  it('returns undefined for ids that are not deps-version contracts', () => {
    expect(packageNameForContract(depsContract({ id: 'governance-doctrine' }))).toBeUndefined();
    expect(packageNameForContract(depsContract({ id: 'agent-memory-doctrine' }))).toBeUndefined();
    expect(packageNameForContract(depsContract({ id: 'gate-config' }))).toBeUndefined();
  });

  it('prefers an explicit package: field over the id convention (derive-not-guess, strategy#517)', () => {
    // Vendor name + a non-conventional id: only the package: field can resolve it.
    expect(
      packageNameForContract(
        depsContract({ id: 'google-genai-coupling', package: '@google/genai' }),
      ),
    ).toBe('@google/genai');
    // package: wins even when the id convention WOULD match (no silent divergence).
    expect(
      packageNameForContract(depsContract({ id: 'mmnto-totem-version', package: '@mmnto/totem' })),
    ).toBe('@mmnto/totem');
  });
});

// ─── deriveCohortRepoId ─────────────────────────────────

describe('deriveCohortRepoId', () => {
  it('extracts <name> from an mmnto-ai/<name> git origin remote (ssh + https, .git suffix)', () => {
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'git@github.com:mmnto-ai/totem-status.git' }),
    ).toBe('totem-status');
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'https://github.com/mmnto-ai/totem.git' }),
    ).toBe('totem');
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'https://github.com/mmnto-ai/liquid-city' }),
    ).toBe('liquid-city');
  });

  it('falls back to package.json name basename (scope stripped) when no remote', () => {
    writeConsumerPkg(tmpRoot, {});
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ name: '@mmnto/totem-status' }, null, 2),
      'utf-8',
    );
    expect(deriveCohortRepoId(tmpRoot, { remoteUrl: undefined, gitRoot: tmpRoot })).toBe(
      'totem-status',
    );
  });

  it('falls back to the git-root dir basename when neither remote nor package name resolve', () => {
    const named = path.join(tmpRoot, 'my-cohort-repo');
    fs.mkdirSync(named, { recursive: true });
    expect(deriveCohortRepoId(named, { remoteUrl: undefined, gitRoot: named })).toBe(
      'my-cohort-repo',
    );
  });

  it('never networks / never throws on a git failure (returns a fallback or undefined)', () => {
    // A remote-reader that throws must not propagate — the helper degrades.
    expect(() =>
      deriveCohortRepoId(tmpRoot, {
        readRemote: () => {
          throw new Error('git exploded');
        },
        gitRoot: tmpRoot,
      }),
    ).not.toThrow();
  });
});

// ─── resolveCohortFloor ─────────────────────────────────

describe('resolveCohortFloor', () => {
  it('resolves self-in-tree when the current git root IS the canonical-source repo', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    const result = resolveCohortFloor('@mmnto/totem', tmpRoot);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.version).toBe('1.53.3');
      expect(result.source).toBe('self-in-tree');
    }
  });

  it('resolves a sibling ../totem checkout when not self-in-tree', () => {
    // gitRoot is the consumer; the floor lives in a sibling totem checkout.
    const consumer = path.join(tmpRoot, 'totem-status');
    const sibling = path.join(tmpRoot, 'totem');
    fs.mkdirSync(consumer, { recursive: true });
    writeSelfInTree(sibling, '2.0.0');
    const result = resolveCohortFloor('@mmnto/totem', consumer);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.version).toBe('2.0.0');
      expect(result.source).toBe('sibling');
    }
  });

  it('is honest-absent (resolved:false + reason) when no floor is reachable + NEVER networks', () => {
    const consumer = path.join(tmpRoot, 'lonely');
    fs.mkdirSync(consumer, { recursive: true });
    const result = resolveCohortFloor('@mmnto/totem', consumer);
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toMatch(/not locally determinable|sibling/i);
    }
  });

  it('does not throw when a package.json in the glob is unreadable/corrupt', () => {
    const pkgDir = path.join(tmpRoot, 'packages', 'totem');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{ not valid json', 'utf-8');
    expect(() => resolveCohortFloor('@mmnto/totem', tmpRoot)).not.toThrow();
  });
});

// ─── detectVersionPinnedContract ────────────────────────

describe('detectVersionPinnedContract', () => {
  it('PASS — installed ≥ floor, consumer declares the pin (sensor reports pass)', () => {
    writeSelfInTree(tmpRoot, '1.50.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.53.3');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
  });

  it('WARN — installed < floor (stale pin); message carries declared/installed/floor', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('warn');
    expect(verdict.message).toContain('1.40.0'); // installed
    expect(verdict.message).toContain('1.53.3'); // floor
  });

  it('detector NEVER emits fail — even a blocking contract returns warn (CLI promotes)', () => {
    // Claim-class + layering invariant: fail-promotion is a CLI-edge concern.
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(
      depsContract({ blocking: true }),
      baseCtx({ repoId: 'totem' }),
    );
    expect(verdict.status).toBe('warn');
    expect(verdict.status).not.toBe('fail');
  });

  it('SKIP (distinct) — applicable consumer missing an expected pin is expected-but-absent, NOT cohort-permitted', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { 'unrelated-dep': '^1.0.0' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toMatch(/expected but not declared|applicable consumer/i);
    // Must stay DISTINCT from the not-a-consumer skip — else the consumers field
    // does nothing for the missing case (strategy design-call 3).
    expect(verdict.message).not.toMatch(/permits absence|not in consumers/i);
  });

  it('SKIP — consumers present and current repo not listed (not-a-consumer)', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract({ consumers: ['totem-strategy', 'liquid-city'] }),
      baseCtx({ repoId: 'totem-status' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('SKIP — consumers present but repo id unresolvable: surface it, do NOT silently apply (Greptile P1)', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract({ consumers: ['totem-strategy'] }),
      baseCtx({ repoId: undefined }),
    );
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toMatch(/cannot determine applicability|repo id unresolvable/i);
  });

  it('resolves an installed version hoisted to a PARENT node_modules (monorepo, GCA-1)', () => {
    // Floor 2.0.0 self-in-tree at the git root; the consumer cwd is a nested
    // subdir whose dep is hoisted to the root node_modules, not its own.
    writeSelfInTree(tmpRoot, '2.0.0');
    const sub = path.join(tmpRoot, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
    writeConsumerPkg(sub, { '@mmnto/totem': '^2.0.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '2.0.0'); // hoisted at the root, not in sub
    const verdict = detectVersionPinnedContract(
      depsContract(),
      baseCtx({ cwd: sub, gitRoot: tmpRoot, repoId: 'totem' }),
    );
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('2.0.0');
  });

  it('SKIP — floor unresolvable (no self-in-tree, no sibling); reason in message, no throw', () => {
    const consumer = path.join(tmpRoot, 'lonely');
    fs.mkdirSync(consumer, { recursive: true });
    writeConsumerPkg(consumer, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract(),
      baseCtx({ cwd: consumer, gitRoot: consumer, repoId: 'totem-status' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('SKIP — id resolves no deps package name (doctrine pin handed back to CLI as skip)', () => {
    const verdict = detectVersionPinnedContract(
      depsContract({ id: 'governance-doctrine' }),
      baseCtx({ repoId: 'totem' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('no-throw on a corrupt consumer package.json — degrades to skip/warn', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{ broken', 'utf-8');
    writeSelfInTree(tmpRoot, '1.53.3');
    expect(() =>
      detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' })),
    ).not.toThrow();
  });

  it('falls back to semver.minVersion(range) when node_modules is absent', () => {
    // No install — minVersion('^1.53.0') = 1.53.0, equals floor → pass.
    writeSelfInTree(tmpRoot, '1.53.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.53.0' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
  });

  it('SKIP (never throws) on an invalid declared range — claim guarded', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': 'not-a-range' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('skip');
  });

  it('claim-class bound — the verdict is pin-currency only, never a content-equality verdict', () => {
    // A version-pinned contract must never assert content drift. We assert the
    // message is framed around versions/pins, not file content equality.
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.message).not.toMatch(/content|file|hash|byte/i);
    expect(verdict.message).toMatch(/version|pin|floor|install/i);
  });
});

// ─── Mechanical content-equality detector (mmnto-ai/totem#2073) ──

const MARKERS = { start: '<!-- totem:skill-start -->', end: '<!-- totem:skill-end -->' };

/**
 * Build a distributed skill artifact: a managed block between the markers, with
 * an optional `fork` marker placed AFTER the end marker (user-customization
 * territory — outside the compared block, so the marker itself never drifts).
 */
function skillFile(body: string, opts: { fork?: string } = {}): string {
  const trailer = opts.fork !== undefined ? `\n${opts.fork}\n` : '';
  return `---\nname: x\n---\n\n${MARKERS.start}\n${body}\n${MARKERS.end}\n${trailer}`;
}

/** Write a consumer artifact at `<tmpRoot>/<rel>`; returns the absolute path. */
function writeArtifact(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

/** Base mechanical context; canonicalBlock + consumerPath default to a known artifact. */
function mechCtx(over: Partial<DetectMechanicalContext> = {}): DetectMechanicalContext {
  return {
    canonicalBlock: 'CANONICAL BODY\nline two',
    consumerPath: path.join(tmpRoot, '.claude/skills/x/SKILL.md'),
    markers: MARKERS,
    ...over,
  };
}

describe('normalizeManagedBlock', () => {
  it('collapses CRLF and lone CR to LF', () => {
    expect(normalizeManagedBlock('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('strips trailing whitespace per line and trims surrounding blank lines', () => {
    expect(normalizeManagedBlock('\n\na  \nb\t\n\n')).toBe('a\nb');
  });
});

describe('extractManagedBlock', () => {
  it('returns the content between the first start and the following end marker', () => {
    expect(extractManagedBlock(`pre ${MARKERS.start}INNER${MARKERS.end} post`, MARKERS)).toBe(
      'INNER',
    );
  });

  it('returns undefined when either marker is absent', () => {
    expect(extractManagedBlock(`only ${MARKERS.start} no end`, MARKERS)).toBeUndefined();
    expect(extractManagedBlock('no markers at all', MARKERS)).toBeUndefined();
  });
});

describe('parseForkMarker', () => {
  it('parses reason/owner/attested, whitespace-tolerant', () => {
    expect(
      parseForkMarker('<!--  totem:fork   reason="x y"  owner="me" attested="2026-06-03" -->'),
    ).toEqual({ reason: 'x y', owner: 'me', attested: '2026-06-03' });
  });

  it('returns an empty object for a bare marker, undefined when absent', () => {
    expect(parseForkMarker('<!-- totem:fork -->')).toEqual({});
    expect(parseForkMarker('no marker here')).toBeUndefined();
  });

  it('matches a fork marker authored across multiple lines (dotAll)', () => {
    expect(parseForkMarker('<!-- totem:fork\n  reason="multi line"\n  owner="me"\n-->')).toEqual({
      reason: 'multi line',
      owner: 'me',
    });
  });
});

describe('detectMechanicalContract', () => {
  it('pass — consumer block equals canonical after normalization', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two'),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — CRLF consumer vs LF canonical, otherwise identical (win32 guard, req #3)', () => {
    const crlf = skillFile('CANONICAL BODY\nline two').replace(/\n/g, '\r\n');
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', crlf);
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — a trailing-whitespace-only difference normalizes equal', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY  \nline two\t'),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('warn — drift with no fork marker, reporting the consumer content-hash', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile('DRIFTED BODY'));
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
    expect(v.message).toContain(hashManagedBlock(normalizeManagedBlock('DRIFTED BODY')));
  });

  it('info — drift WITH a fork marker is an attested intentional fork, never warn (req #7)', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('DRIFTED BODY', {
        fork: '<!-- totem:fork reason="local override" owner="satur8d" attested="2026-06-03" -->',
      }),
    );
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
    expect(v.message).toContain('2026-06-03');
  });

  it('pass — a fork marker present but content actually matching is still pass (no false fork)', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two', { fork: '<!-- totem:fork reason="x" -->' }),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('unknown — an unresolvable canonical is never rendered pass (Stale-Doctor-Paradox guard)', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile('whatever'));
    const v = detectMechanicalContract(mechCtx({ consumerPath, canonicalBlock: undefined }));
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('pass');
  });

  it('pass — a legitimately EMPTY canonical block is compared, not conflated with unknown', () => {
    // Markers present but no content on both sides → equal → pass, NOT unknown
    // (empty `''` is distinct from an unresolvable `undefined`).
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile(''));
    const v = detectMechanicalContract(mechCtx({ consumerPath, canonicalBlock: '' }));
    expect(v.status).toBe('pass');
  });

  it('skip — consumer artifact absent (cohort permits absence), distinct from drift', () => {
    const v = detectMechanicalContract(
      mechCtx({ consumerPath: path.join(tmpRoot, 'nope/SKILL.md') }),
    );
    expect(v.status).toBe('skip');
  });

  it('warn — a present file with markers stripped is unmanaged drift, not pass', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', 'no markers, just text');
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/markers absent|unmanaged/i);
  });

  it('info — a marker-stripped file carrying a totem:fork marker is an intentional fork, not drift', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      'heavily customized, no skill markers\n<!-- totem:fork reason="full rewrite" attested="2026-06-03" -->',
    );
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('never emits fail and degrades a missing read to skip (detector invariant)', () => {
    const v = detectMechanicalContract(mechCtx({ readFile: () => undefined }));
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('fail');
  });

  it('binary self-report (req #5) — names the resolving @mmnto/cli in the verdict', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two'),
    );
    const v = detectMechanicalContract(
      mechCtx({ consumerPath, binary: { version: '1.53.5', path: '/usr/local/bin/totem' } }),
    );
    expect(v.message).toContain('@mmnto/cli@1.53.5');
  });
});

// ─── Generated-artifact (git-hooks) content-equality detector (mmnto-ai/totem#2073) ──

const PREPUSH_MARKER = '[totem] pre-push hook';
const POSTMERGE_MARKER = '[totem] post-merge hook';
const POSTMERGE_END = '[totem] end post-merge';

/** A totem-OWNED whole-file hook (pre-push style — start marker only, no end). */
function ownedPrePush(body: string): string {
  return `#!/bin/sh\n# ${PREPUSH_MARKER} — stateless enforcement.\n${body}\n`;
}

/** A totem-OWNED whole-file hook with start + end markers (post-merge style). */
function ownedPostMerge(body: string): string {
  return `#!/bin/sh\n# ${POSTMERGE_MARKER} — background re-index.\n${body}\n# ${POSTMERGE_END}\n`;
}

/** A user's own hook with the totem block APPENDED (shebang stripped, post-merge style). */
function appendedPostMerge(userBody: string, totemBody: string): string {
  return `#!/usr/bin/env bash\n${userBody}\n\n# ${POSTMERGE_MARKER} — background re-index.\n${totemBody}\n# ${POSTMERGE_END}\n`;
}

/** A user's own hook with the totem block APPENDED (pre-push style — no end marker). */
function appendedPrePush(userBody: string, totemBody: string): string {
  return `#!/usr/bin/env bash\n${userBody}\n\n# ${PREPUSH_MARKER} — stateless enforcement.\n${totemBody}\n`;
}

/** Base context for a pre-push (no end marker) artifact at `.git/hooks/pre-push`. */
function genCtx(
  over: Partial<DetectGeneratedArtifactContext> = {},
): DetectGeneratedArtifactContext {
  return {
    canonicalContent: ownedPrePush('echo current'),
    consumerPath: path.join(tmpRoot, '.git/hooks/pre-push'),
    ownershipMarker: PREPUSH_MARKER,
    ...over,
  };
}

describe('detectGeneratedArtifactContract', () => {
  it('pass — totem-owned hook equals the regenerated canonical', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    expect(detectGeneratedArtifactContract(genCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — CRLF consumer vs LF canonical, otherwise identical (win32 checkout guard)', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      ownedPrePush('echo current').replace(/\n/g, '\r\n'),
    );
    expect(detectGeneratedArtifactContract(genCtx({ consumerPath })).status).toBe('pass');
  });

  it('warn — a hook frozen at an older generator (stale pre-#2053 resolve order) is drift (the mmnto-ai/totem#1854 keystone)', () => {
    // The detection half of mmnto-ai/totem#1854: a consumer sitting on an old hook the
    // current generator would no longer emit MUST surface as drift, not a false pass.
    const stale = ownedPrePush('if command -v totem; then TOTEM_CMD="totem"; fi');
    const current = ownedPrePush('if [ -f node_modules/@mmnto/cli/dist/index.js ]; then :; fi');
    const consumerPath = writeArtifact('.git/hooks/pre-push', stale);
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath, canonicalContent: current }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
  });

  it('pass — parameterized canonical: an npm-flavored hook matches an npm-flavored canonical (no false drift)', () => {
    // The detector compares against a canonical regenerated with THIS repo's package
    // manager (npx), so an npm consumer never reads as drift against a pnpm canonical.
    const npm = ownedPrePush('TOTEM_CMD="npx @mmnto/cli"');
    const consumerPath = writeArtifact('.git/hooks/pre-push', npm);
    expect(
      detectGeneratedArtifactContract(genCtx({ consumerPath, canonicalContent: npm })).status,
    ).toBe('pass');
  });

  it('info — an owned hook that drifted but carries a totem:fork marker is an attested fork, not warn', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      ownedPrePush(
        'echo drifted\n# <!-- totem:fork reason="local gate" owner="satur8d" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
    expect(v.message).toContain('2026-06-04');
  });

  it('skip — hook absent (cohort permits absence), distinct from drift', () => {
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath: path.join(tmpRoot, '.git/hooks/nope') }),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/not installed|permits absence/i);
  });

  it('skip — a present hook with NO totem marker is a pure user hook, not drift (presence semantics)', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', '#!/bin/sh\necho my own hook\n');
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/not totem-managed|permits absence/i);
    // Must NOT be a warn — totem simply is not installed here.
    expect(v.status).not.toBe('warn');
  });

  it('unknown — an unregenerable canonical is never rendered pass (Stale-Doctor-Paradox guard)', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath, canonicalContent: undefined }),
    );
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('pass');
  });

  it('pass — appended post-merge: totem region current within a user-managed hook (diff is user content)', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge('echo user pre-step', 'sync incremental'),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync incremental'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('pass');
    expect(v.message).toMatch(/totem block current/i);
  });

  it('warn — appended post-merge: the totem region itself drifted', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge('echo user pre-step', 'sync OLD'),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
  });

  it('unknown — totem block appended in a user pre-push hook (no end marker) cannot be isolated', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      appendedPrePush('echo user pre-step', 'echo current'),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('unknown');
    expect(v.message).toMatch(/cannot isolate|embedded/i);
    // Never a false warn — claim-class-tight.
    expect(v.status).not.toBe('warn');
  });

  it('info — an appended (no-end-marker) hook carrying a totem:fork marker is an attested fork, not unknown', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      appendedPrePush(
        'echo user',
        'echo custom\n# <!-- totem:fork reason="vendored" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('never emits fail and degrades a missing read to skip (detector invariant)', () => {
    const v = detectGeneratedArtifactContract(genCtx({ readFile: () => undefined }));
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('fail');
  });

  it('binary self-report (req #5) — names the resolving @mmnto/cli in the verdict', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath, binary: { version: '1.53.5', path: '/usr/local/bin/totem' } }),
    );
    expect(v.message).toContain('@mmnto/cli@1.53.5');
  });

  it('warn — a fork marker in the USER preamble does NOT suppress totem-block drift (region-scoped, Greptile)', () => {
    // Appended post-merge: the totem region drifted, but the fork marker sits in the
    // user's OWN preamble (outside the totem block) — it must not demote warn → info.
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge(
        'echo user step\n# <!-- totem:fork reason="my own preamble" owner="someone" -->',
        'sync OLD',
      ),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('warn');
    expect(v.status).not.toBe('info');
  });

  it('info — a fork marker INSIDE the totem region is a genuine attestation', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge(
        'echo user step',
        'sync OLD\n# <!-- totem:fork reason="vendored sync" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('unknown — endMarker set but the canonical lacks its end marker is unprovable, never a false warn (Greptile)', () => {
    // A regenerated canonical missing its own end marker (generator/marker misconfig)
    // must not fall through to an owned-file `warn` — the comparison is unprovable.
    const canonicalNoEnd = `#!/bin/sh\n# ${POSTMERGE_MARKER} — background re-index.\nsync\n`;
    const consumerPath = writeArtifact('.git/hooks/post-merge', ownedPostMerge('sync'));
    const v = detectGeneratedArtifactContract({
      canonicalContent: canonicalNoEnd,
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('warn');
    expect(v.message).toMatch(/canonical hook region|unprovable/i);
  });
});

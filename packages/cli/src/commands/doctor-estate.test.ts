/**
 * Render + artifact tests for `totem doctor --estate` (mmnto-ai/totem#2580).
 *
 * Git is injected (canned porcelain), so these assert the SURFACE — which rows
 * render, what the artifact contains, and that the two never share a stream —
 * rather than the local git install. The husk fixture is a real temp tree
 * because husk evidence is literally a filesystem shape.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstateExecFn, TotemRegistry } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { doctorEstateCliCommand } from './doctor-estate.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const COMMIT_10_DAYS_AGO = Math.floor((NOW - 10 * 86_400_000) / 1000);

/**
 * Strip ANSI so assertions are colour-independent regardless of whether
 * picocolors decides this environment supports colour. Constructed via
 * `String.fromCharCode(27)` so no raw ESC control byte is authored into source.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

let root: string;
let lines: string[];
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-estate-cli-')));
  lines = [];
  errSpy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
    lines.push(String(msg).replace(ANSI, ''));
  });
});

afterEach(() => {
  errSpy.mockRestore();
  cleanTmpDir(root);
});

function output(): string {
  return lines.join('\n');
}

function fold(p: string): string {
  return process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
}

function mkdir(...segments: string[]): string {
  const dir = path.join(root, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function registryOf(...paths: string[]): TotemRegistry {
  return Object.fromEntries(
    paths.map((p) => [
      p,
      { path: p, chunkCount: 1, lastSync: '2026-08-01T00:00:00.000Z', embedder: 'test' },
    ]),
  );
}

/**
 * One repo whose worktree list carries a stale (merged) branch, an
 * indeterminate (clean, unmerged) branch, and nothing else.
 */
function fixtureEstate(): { repo: string; exec: EstateExecFn } {
  const repo = mkdir('repo');
  const stale = mkdir('repo-stale');
  const open = mkdir('repo-open');
  const husk = mkdir('zzz-husk');
  fs.writeFileSync(
    path.join(husk, '.git'),
    `gitdir: ${path.join(root, 'gone', '.git', 'worktrees', 'zzz-husk').split(path.sep).join('/')}\n`,
    'utf-8',
  );

  const listing = [
    `worktree ${repo.split(path.sep).join('/')}`,
    `HEAD ${'a'.repeat(40)}`,
    'branch refs/heads/main',
    '',
    `worktree ${stale.split(path.sep).join('/')}`,
    `HEAD ${'b'.repeat(40)}`,
    'branch refs/heads/2401-done',
    '',
    `worktree ${open.split(path.sep).join('/')}`,
    `HEAD ${'c'.repeat(40)}`,
    'branch refs/heads/2580-estate-sensor',
    '',
  ].join('\n');

  const exec: EstateExecFn = (command: string, args: string[] = []): string => {
    const cwd = fold(args[1] ?? '');
    const verb = args.slice(2);
    if (verb[0] === 'worktree') {
      if (cwd !== fold(repo)) throw Object.assign(new Error('not a repo'), { status: 128 });
      return listing;
    }
    if (verb[0] === 'rev-parse') return 'origin/main';
    if (verb[0] === 'status') return '';
    if (verb[0] === 'log') return String(COMMIT_10_DAYS_AGO);
    if (verb[0] === 'merge-base') {
      if (verb[2] === 'refs/heads/2401-done') return '';
      throw Object.assign(new Error(''), { status: 1 });
    }
    throw Object.assign(new Error(`unexpected verb ${verb.join(' ')}`), { status: 1 });
  };

  return { repo, exec };
}

describe('doctorEstateCliCommand — degenerate registry', () => {
  it('renders a named SKIP line and never throws when nothing is registered', async () => {
    await expect(
      doctorEstateCliCommand({ registryForTest: {}, nowForTest: NOW, cwdForTest: root }),
    ).resolves.toBeUndefined();
    expect(output()).toContain('SKIP');
    expect(output()).toContain('no registered repos');
    expect(output()).toContain('totem sync');
  });

  it('emits a valid degenerate artifact under --json (empty registry-status, zeroed summary)', async () => {
    const chunks: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
      });
    try {
      await doctorEstateCliCommand({
        json: true,
        registryForTest: {},
        nowForTest: NOW,
        cwdForTest: root,
      });
    } finally {
      stdout.mockRestore();
    }
    const artifact = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(artifact['estate-schema-version']).toBe(1);
    expect(artifact['registry-status']).toBe('empty');
    expect(artifact['derived-at']).toBe('2026-08-05T12:00:00.000Z');
    expect(artifact['swept-roots']).toEqual([]);
    expect(artifact['excluded-roots']).toEqual([]);
    expect(artifact['summary']).toMatchObject({ repos: 0, worktrees: 0, 'husk-candidates': 0 });
    expect(lines).toEqual([]);
  });

  it('reports an unreadable registry as `unreadable`, warning on stderr only (T6)', async () => {
    // The registry is read through `os.homedir()`, so the fixture is a temp
    // HOME carrying a corrupt registry file — the one path that makes
    // `readRegistry` warn and return {} rather than silently returning {} on a
    // missing file.
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(home, '.totem', 'registry.json'), '{ not json', 'utf-8');
    const originalHome = process.env['HOME'];
    const originalUserProfile = process.env['USERPROFILE'];

    const chunks: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
      });
    try {
      process.env['HOME'] = home;
      process.env['USERPROFILE'] = home;
      await doctorEstateCliCommand({ json: true, nowForTest: NOW, cwdForTest: root });
    } finally {
      stdout.mockRestore();
      if (originalHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = originalHome;
      if (originalUserProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = originalUserProfile;
    }

    const artifact = JSON.parse(chunks.join('')) as Record<string, unknown>;
    expect(artifact['registry-status']).toBe('unreadable');
    expect(artifact['summary']).toMatchObject({ repos: 0, worktrees: 0 });
    // The warning rides stderr; stdout carries the artifact and nothing else.
    expect(output()).toContain('Cannot read registry');
    expect(chunks).toHaveLength(1);
    expect(() => JSON.parse(chunks[0]!)).not.toThrow();
  });
});

describe('doctorEstateCliCommand — human render', () => {
  it('renders a stale row, an indeterminate row, and a husk row with their evidence', async () => {
    const { repo, exec } = fixtureEstate();
    await doctorEstateCliCommand({
      registryForTest: registryOf(repo),
      execForTest: exec,
      nowForTest: NOW,
      cwdForTest: root,
    });
    const text = output();

    expect(text).toContain('stale');
    expect(text).toContain('[2401-done]');
    expect(text).toContain('is an ancestor of origin/main');

    expect(text).toContain('indeterminate');
    expect(text).toContain('[2580-estate-sensor]');
    expect(text).toContain('squash-merged');

    expect(text).toContain('husk');
    expect(text).toContain('[dangling-gitdir-pointer]');
    expect(text).toContain('zzz-husk');

    // Summary + the two disclosure lines (criteria, and what indeterminate means).
    expect(text).toContain('2 worktree(s): 0 active · 1 stale · 1 indeterminate');
    expect(text).toContain('husk criteria');
    expect(text).toContain('Report-only');
  });

  it('renders a MISSING row for a registry path that no longer exists', async () => {
    const { repo, exec } = fixtureEstate();
    const gone = path.join(root, 'vanished');
    await doctorEstateCliCommand({
      registryForTest: registryOf(repo, gone),
      execForTest: exec,
      nowForTest: NOW,
      cwdForTest: root,
    });
    expect(output()).toContain('[MISSING]');
    expect(output()).toContain('vanished');
  });

  it('sweeps a relative --root against the cwd', async () => {
    const { repo, exec } = fixtureEstate();
    mkdir('extra-sweep');
    await doctorEstateCliCommand({
      registryForTest: registryOf(repo),
      execForTest: exec,
      nowForTest: NOW,
      cwdForTest: root,
      roots: ['extra-sweep'],
    });
    expect(output()).toContain(path.join(root, 'extra-sweep'));
  });
});

describe('doctorEstateCliCommand — the --json artifact owns stdout (invariant 8)', () => {
  it('writes exactly one JSON document and renders no human line', async () => {
    const { repo, exec } = fixtureEstate();
    const chunks: string[] = [];
    const stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
      });
    try {
      await doctorEstateCliCommand({
        json: true,
        registryForTest: registryOf(repo),
        execForTest: exec,
        nowForTest: NOW,
        cwdForTest: root,
      });
    } finally {
      stdout.mockRestore();
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.endsWith('\n')).toBe(true);
    expect(lines).toEqual([]);

    const artifact = JSON.parse(chunks[0]!) as Record<string, unknown>;
    expect(Object.keys(artifact)).toEqual([
      'estate-schema-version',
      'registry-status',
      'derived-at',
      'swept-roots',
      'excluded-roots',
      'repos',
      'worktrees',
      'husk-candidates',
      'unscannable',
      'summary',
    ]);
    expect(artifact['registry-status']).toBe('ok');

    const worktrees = artifact['worktrees'] as Array<Record<string, unknown>>;
    const stale = worktrees.find((w) => w['branch'] === '2401-done')!;
    const open = worktrees.find((w) => w['branch'] === '2580-estate-sensor')!;
    expect(stale['class']).toBe('registered-stale');
    expect(stale['ancestry-merged']).toBe(true);
    expect(stale['age-days']).toBe(10);
    expect(open['class']).toBe('registered-indeterminate');
    expect(open['ancestry-merged']).toBe(false);
    // Presence-only optionals: a clean worktree carries no `dirty` key at all.
    expect('dirty' in open).toBe(false);
    expect('locked' in open).toBe(false);

    const husks = artifact['husk-candidates'] as Array<Record<string, unknown>>;
    expect(husks).toHaveLength(1);
    expect(husks[0]!['evidence']).toBe('dangling-gitdir-pointer');
    expect(artifact['summary']).toMatchObject({
      repos: 1,
      worktrees: 2,
      stale: 1,
      indeterminate: 1,
      'husk-candidates': 1,
    });
  });
});

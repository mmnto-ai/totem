import { beforeEach, describe, expect, it, vi } from 'vitest';

type Resolution =
  | {
      ok: true;
      entry: string;
      version?: string;
      tier: 'workspace' | 'pinned' | 'global';
      unverified?: string[];
    }
  | { ok: false; looked: string[]; unverified: string[] };

const LOOKED = [
  'a workspace build at packages/cli/dist/index.js, walking up from /repo',
  'a pinned install at node_modules/@mmnto/cli/dist/index.js, walking up from /repo',
  'an npm-layout global install of @mmnto/cli on PATH',
];

let mockResolve: () => Resolution;

vi.mock('@mmnto/totem/cli-resolve', () => ({
  resolveTotemCli: vi.fn(() => mockResolve()),
}));

const { resolveCliSpawn } = await import('./cli-spawn.js');

describe('resolveCliSpawn (mmnto-ai/totem#3008)', () => {
  beforeEach(() => {
    mockResolve = () => ({ ok: false, looked: LOOKED, unverified: [] });
  });

  it('returns node plus the resolved entry, labelled with version and tier', () => {
    mockResolve = () => ({ ok: true, entry: '/repo/x/index.js', version: '9.9.9', tier: 'pinned' });
    const target = resolveCliSpawn('/repo');
    expect(target).toEqual({
      ok: true,
      cmd: process.execPath,
      entry: '/repo/x/index.js',
      label: '@mmnto/cli@9.9.9, pinned',
    });
  });

  it('labels without a version when the package.json was unreadable', () => {
    mockResolve = () => ({ ok: true, entry: '/g/index.js', tier: 'global' });
    const target = resolveCliSpawn('/repo');
    expect(target.ok && target.label).toBe('@mmnto/cli, global');
  });

  it('says so in the label when an unverified totem earlier on PATH was skipped', () => {
    mockResolve = () => ({
      ok: true,
      entry: '/g/index.js',
      version: '9.9.9',
      tier: 'global',
      unverified: ['/shims/totem'],
    });
    const target = resolveCliSpawn('/repo');
    expect(target.ok && target.label).toBe(
      '@mmnto/cli@9.9.9, global (skipped an unverified totem earlier on PATH: /shims/totem)',
    );
  });

  it('refuses with the three places looked and the cure when nothing resolves', () => {
    const target = resolveCliSpawn('/repo');
    expect(target.ok).toBe(false);
    const message = target.ok ? '' : target.message;
    expect(message).toContain(`(1) ${LOOKED[0]}; (2) ${LOOKED[1]}; (3) ${LOOKED[2]}.`);
    expect(message).toContain('npm i -g @mmnto/cli');
    expect(message).not.toContain('was found on PATH');
  });

  it('names a totem found on PATH that could not be verified', () => {
    mockResolve = () => ({ ok: false, looked: LOOKED, unverified: ['/shims/totem'] });
    const target = resolveCliSpawn('/repo');
    const message = target.ok ? '' : target.message;
    expect(message).toContain(
      'A totem executable was found on PATH at /shims/totem but is not an npm-layout install of @mmnto/cli, so it was not run.',
    );
  });

  it('turns a resolver read failure into a refusal that names the error', () => {
    mockResolve = () => {
      throw new Error('EACCES: permission denied, open /repo/packages/cli/package.json');
    };
    const target = resolveCliSpawn('/repo');
    expect(target.ok).toBe(false);
    const message = target.ok ? '' : target.message;
    expect(message).toContain('Totem CLI could not be resolved: EACCES: permission denied');
    expect(message).toContain('Nothing was run.');
    expect(message).toContain('npm i -g @mmnto/cli');
  });
});

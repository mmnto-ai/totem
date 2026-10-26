import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// The repository's own `prepare` script (`node tools/install-hooks.js`) copies
// tools/{pre-commit,pre-push,post-merge} into the hooks dir git resolves for the
// checkout. In a LINKED worktree that dir is the one every worktree shares, so a
// `pnpm install` in a worktree on an older branch would install that branch's
// templates for the main worktree too, and nothing at push time would say so
// (mmnto-ai/totem#3122). The script is copied into a throwaway repository's
// tools/ and run THERE: its rootDir is its own parent, so it resolves that
// repository and never this one.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'install-hooks.js');
const HOOKS = ['pre-commit', 'pre-push', 'post-merge'] as const;

function git(args: string[], cwd: string): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** Plant a copy of the script and three stamped hook templates under `<checkout>/tools`. */
function plantScript(checkout: string, stamp: string): void {
  const tools = path.join(checkout, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(tools, 'install-hooks.js'));
  for (const hook of HOOKS) {
    fs.writeFileSync(path.join(tools, hook), `#!/bin/sh\n# ${stamp} ${hook}\n`);
  }
}

function runScript(checkout: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(checkout, 'tools', 'install-hooks.js')], {
    cwd: checkout,
    encoding: 'utf-8',
    env: { ...process.env, TOTEM_HOOKS_FORCE: '', ...env },
  });
}

function installedHook(main: string, hook: string): string {
  return fs.readFileSync(path.join(main, '.git', 'hooks', hook), 'utf-8');
}

describe('tools/install-hooks.js from a linked worktree (mmnto-ai/totem#3122)', () => {
  let tmpDir: string;
  let main: string;
  let linked: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-tools-hooks-'));
    main = path.join(tmpDir, 'main');
    fs.mkdirSync(main, { recursive: true });
    // The script is ESM; the planted copy needs a module-typed package next to it.
    fs.writeFileSync(path.join(main, 'package.json'), '{ "type": "module" }\n');
    git(['init', '-q'], main);
    git(['add', 'package.json'], main);
    git(['commit', '-q', '-m', 'init'], main);
    linked = path.join(tmpDir, 'linked');
    git(['worktree', 'add', '-q', '-b', 'topic', linked], main);
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('the main worktree writes the shared hooks', () => {
    plantScript(main, 'main');
    const run = runScript(main);
    expect(run.status).toBe(0);
    for (const hook of HOOKS) expect(installedHook(main, hook)).toContain(`main ${hook}`);
  });

  it('a linked worktree leaves the shared hooks alone, exits 0 and says why', () => {
    plantScript(main, 'main');
    expect(runScript(main).status).toBe(0);
    plantScript(linked, 'topic');

    const run = runScript(linked);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Linked worktree');
    expect(run.stdout).toContain('TOTEM_HOOKS_FORCE=1');
    for (const hook of HOOKS) expect(installedHook(main, hook)).toContain(`main ${hook}`);
  });

  it('TOTEM_HOOKS_FORCE=1 writes the shared hooks from the linked worktree', () => {
    plantScript(main, 'main');
    expect(runScript(main).status).toBe(0);
    plantScript(linked, 'topic');

    const run = runScript(linked, { TOTEM_HOOKS_FORCE: '1' });

    expect(run.status).toBe(0);
    for (const hook of HOOKS) expect(installedHook(main, hook)).toContain(`topic ${hook}`);
  });

  it('a worktree of a BARE repository writes the shared hooks: nothing else owns them', () => {
    const bare = path.join(tmpDir, 'repo.git');
    git(['clone', '-q', '--bare', main, bare], tmpDir);
    const checkout = path.join(tmpDir, 'bare-wt');
    git(['-C', bare, 'worktree', 'add', '-q', checkout, 'HEAD'], tmpDir);
    plantScript(checkout, 'bare');

    const run = runScript(checkout);

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain('Linked worktree');
    for (const hook of HOOKS) {
      expect(fs.readFileSync(path.join(bare, 'hooks', hook), 'utf-8')).toContain(`bare ${hook}`);
    }
  });

  it('a bare repository whose flag lives in config.worktree, spelled yes, still writes', () => {
    const bare = path.join(tmpDir, 'repo.git');
    git(['clone', '-q', '--bare', main, bare], tmpDir);
    const checkout = path.join(tmpDir, 'bare-wt');
    git(['-C', bare, 'worktree', 'add', '-q', checkout, 'HEAD'], tmpDir);
    // What `git sparse-checkout` does on a bare repository's worktree, with one of the
    // other boolean spellings git accepts.
    git(['-C', bare, 'config', 'core.repositoryformatversion', '1'], tmpDir);
    git(['-C', bare, 'config', 'extensions.worktreeConfig', 'true'], tmpDir);
    git(['-C', bare, 'config', '--worktree', 'core.bare', 'yes'], tmpDir);
    git(['-C', bare, 'config', '--unset', 'core.bare'], tmpDir);
    plantScript(checkout, 'bare');

    const run = runScript(checkout);

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain('Linked worktree');
    for (const hook of HOOKS) {
      expect(fs.readFileSync(path.join(bare, 'hooks', hook), 'utf-8')).toContain(`bare ${hook}`);
    }
  });
});

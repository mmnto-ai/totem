// ─── Porcelain pins on every patch-producing git diff (mmnto-ai/totem#3113) ──
//
// A user's or repository's git config rewrites the text the diff parsers
// assume: `diff.external` replaces the patch with a tool's output, `color.ui
// always` wraps it in escape sequences, and the prefix settings change the
// `a/` and `b/` labels the header parsers read as the repository path. These
// tests run REAL git in a throwaway repository with each setting applied and
// assert the readers still see the porcelain; on the code before the pins each
// one fails the way the issue measured. The census at the end keeps every
// patch-producing `git diff` spawn in the three packages on the shared list.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { getGitBranchDiffResult, getGitDiff, getGitDiffRange, getGitDiffStat } from './git.js';

const ESC = String.fromCharCode(27);

let tmp: string;

/** Run git in the throwaway repository, failing loudly (these are fixtures, not probes). */
function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: tmp,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), content, 'utf-8');
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-porcelain-'));
  // Isolate BOTH the fixtures' git and the readers' git (which inherit
  // process.env through safeExec) from this machine's global and system
  // config, so only the setting each test applies is in force.
  const emptyGlobal = path.join(tmp, '.gitconfig-empty');
  fs.writeFileSync(emptyGlobal, '', 'utf-8');
  vi.stubEnv('GIT_CONFIG_GLOBAL', emptyGlobal);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'porcelain@example.com');
  git('config', 'user.name', 'porcelain');
  git('config', 'commit.gpgsign', 'false');
  write('src/v.ts', 'export const a = 1;\n');
  write('b/x.ts', 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  write('src/v.ts', 'export const a = 1;\nconsole.log(1);\n');
  write('b/x.ts', 'x\ny\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
});

afterEach(() => {
  vi.unstubAllEnvs();
  cleanTmpDir(tmp);
});

describe('porcelain pins under a rewriting git config (mmnto-ai/totem#3113)', () => {
  it('diff.external: the range reader gets the patch, not the external tool output', () => {
    git('config', 'diff.external', 'echo EXTERNAL-TOOL');
    const diff = getGitDiffRange(tmp, 'HEAD~1..HEAD');
    expect(diff).not.toContain('EXTERNAL-TOOL');
    expect(diff).toContain('diff --git a/src/v.ts b/src/v.ts');
    expect(diff).toContain('+console.log(1);');
  });

  it('color.ui always: the working-tree reader and the stat reader carry no escape sequence', () => {
    git('config', 'color.ui', 'always');
    write('src/v.ts', 'export const a = 1;\nconsole.log(1);\nconsole.log(2);\n');
    const diff = getGitDiff('all', tmp);
    expect(diff).not.toContain(ESC);
    expect(diff).toContain('+console.log(2);');
    const stat = getGitDiffStat(tmp);
    expect(stat).not.toContain(ESC);
    expect(stat).toContain('src/v.ts');
  });

  it('diff.mnemonicPrefix: the staged reader labels the file b/, not i/', () => {
    git('config', 'diff.mnemonicPrefix', 'true');
    write('src/v.ts', 'export const a = 1;\nconsole.log(1);\nconsole.log(3);\n');
    git('add', 'src/v.ts');
    const diff = getGitDiff('staged', tmp);
    expect(diff).toContain('+++ b/src/v.ts');
    expect(diff).not.toContain('+++ i/');
  });

  it('diff.noprefix with a top-level directory named b: the branch reader keeps a/ and b/ on the header', () => {
    git('config', 'diff.noprefix', 'true');
    git('checkout', '-q', '-b', 'feat');
    write('b/x.ts', 'x\ny\nz\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat');
    const { diff, resolvedBase } = getGitBranchDiffResult(tmp, 'main');
    expect(resolvedBase).toBe('main');
    expect(diff).toContain('diff --git a/b/x.ts b/b/x.ts');
    expect(diff).toContain('+++ b/b/x.ts');
    expect(diff).not.toContain('diff --git b/x.ts b/x.ts');
  });

  it('diff.dstPrefix: the range reader labels the file b/, not the configured prefix', () => {
    git('config', 'diff.dstPrefix', 'y/');
    git('config', 'diff.srcPrefix', 'x/');
    const diff = getGitDiffRange(tmp, 'HEAD~1..HEAD');
    expect(diff).toContain('--- a/src/v.ts');
    expect(diff).toContain('+++ b/src/v.ts');
    expect(diff).not.toContain('+++ y/');
  });
});

// ─── Census: every patch-producing `git diff` spawn carries the list ────────
//
// The list-form diffs (`--name-only`, `--name-status`, `--numstat`,
// `--shortstat`, `-z`) were measured untouched by every setting above and are
// exempt by their flag; every other `git diff` argv, and every `git log -p`
// argv, must spread GIT_DIFF_PORCELAIN_ARGS as the element after the
// subcommand, before any ref, option or `--`.

const LIST_FORM_FLAGS = ['--name-only', '--name-status', '--numstat', '--shortstat'];

function listTsSources(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      listTsSources(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
}

/** `file:line` of every git diff / git log -p argv that lacks the pins. */
function unpinnedGitDiffSpawns(repoRoot: string): string[] {
  const sources: string[] = [];
  for (const pkg of ['core', 'cli', 'mcp']) {
    listTsSources(path.join(repoRoot, 'packages', pkg, 'src'), sources);
  }
  const violations: string[] = [];
  const argv = /\[\s*'(diff|log)'\s*,([^\]]*)\]/g;
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(argv)) {
      const [whole, subcommand, rest] = match as unknown as [string, string, string];
      const tokens = rest.split(',').map((token) => token.trim());
      if (subcommand === 'log' && !tokens.includes("'-p'")) continue;
      if (subcommand === 'diff' && LIST_FORM_FLAGS.some((flag) => tokens.includes(`'${flag}'`))) {
        continue;
      }
      if (tokens[0] === '...GIT_DIFF_PORCELAIN_ARGS') continue;
      const line = text.slice(0, match.index ?? 0).split('\n').length;
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      violations.push(`${rel}:${line} ${whole.replace(/\s+/g, ' ')}`);
    }
  }
  return violations;
}

describe('census: patch-producing git diff spawns spread GIT_DIFF_PORCELAIN_ARGS (mmnto-ai/totem#3113)', () => {
  it('finds no git diff or git log -p argv without the pins in core, cli and mcp sources', () => {
    const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    expect(fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))).toBe(true);
    expect(unpinnedGitDiffSpawns(repoRoot)).toEqual([]);
  });

  it('names an unpinned spawn and lets a list-form spawn through (the detector reads both)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-census-'));
    try {
      for (const pkg of ['core', 'cli', 'mcp'])
        fs.mkdirSync(path.join(dir, 'packages', pkg, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'packages', 'core', 'src', 'x.ts'),
        [
          "safeExec('git', ['diff', 'HEAD']);",
          "safeExec('git', ['diff', ...GIT_DIFF_PORCELAIN_ARGS, 'HEAD']);",
          "safeExec('git', ['diff', '--name-only', '-z', ref]);",
          "exec('git', ['log', '-p', range]);",
          "exec('git', ['log', '-1', '--format=%H']);",
        ].join('\n'),
        'utf-8',
      );
      expect(unpinnedGitDiffSpawns(dir)).toEqual([
        "packages/core/src/x.ts:1 ['diff', 'HEAD']",
        "packages/core/src/x.ts:4 ['log', '-p', range]",
      ]);
    } finally {
      cleanTmpDir(dir);
    }
  });
});

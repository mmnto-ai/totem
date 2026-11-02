// ─── Porcelain pins on every patch-producing git diff (mmnto-ai/totem#3113) ──
//
// A user's or repository's git config rewrites the text the diff parsers
// assume: `diff.external` replaces the patch with a tool's output, `color.ui
// always` wraps it in escape sequences, the prefix settings change the `a/` and
// `b/` labels the header parsers read as the repository path, `diff.relative`
// strips the path and drops changes outside the working directory,
// `diff.context` hides the unchanged line a directive sits on, and a textconv
// driver shows converted text where the blob readers see bytes. These tests run
// REAL git in a throwaway repository with each setting applied and assert the
// readers still see the porcelain; on the code before the pins each one fails
// the way the issue measured. The census at the end keeps every patch- or
// stat-producing `git diff` spawn in the three packages on the shared list.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractAddedLines } from '../diff-parser.js';
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

  it('diff.relative from a subdirectory: the range reader keeps repository paths and the changes outside the directory', () => {
    git('config', 'diff.relative', 'true');
    const diff = getGitDiffRange(path.join(tmp, 'b'), 'HEAD~1..HEAD');
    expect(diff).toContain('diff --git a/b/x.ts b/b/x.ts');
    expect(diff).toContain('diff --git a/src/v.ts b/src/v.ts');
    expect(diff).not.toContain('diff --git a/x.ts b/x.ts');
  });

  it('diff.context 0: the range reader keeps the three context lines a next-line directive needs', () => {
    git('config', 'diff.context', '0');
    const diff = getGitDiffRange(tmp, 'HEAD~1..HEAD');
    expect(diff).toMatch(/^@@ -1 \+1,2 @@/m);
    const added = extractAddedLines(diff).filter((a) => a.file === 'src/v.ts');
    expect(added).toEqual([
      {
        file: 'src/v.ts',
        line: 'console.log(1);',
        lineNumber: 2,
        precedingLine: 'export const a = 1;',
      },
    ]);
  });

  it('a textconv driver: the range reader shows the bytes the blob readers see, not the converted text', () => {
    write('.gitattributes', '*.txt diff=up\n');
    write('f.txt', 'abcd\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'txt');
    write('f.txt', 'abcd\nabce\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'txt2');
    git('config', 'diff.up.textconv', 'sed y/abcd/ABCD/');
    const diff = getGitDiffRange(tmp, 'HEAD~1..HEAD');
    expect(diff).toContain('+abce');
    expect(diff).not.toContain('ABCE');
  });

  it('diff.suppressBlankEmpty (no flag exists): the parser counts the empty context line, so numbers and the directive lookup hold', () => {
    write('src/s.ts', '// totem-ignore-next-line\n\n');
    git('add', '-A');
    git('commit', '-q', '-m', 's');
    write('src/s.ts', '// totem-ignore-next-line\n\nconsole.log(1);\n');
    git('add', '-A');
    git('commit', '-q', '-m', 's2');
    git('config', 'diff.suppressBlankEmpty', 'true');
    const diff = getGitDiffRange(tmp, 'HEAD~1..HEAD');
    // The setting is in force: the blank context line is an empty string.
    expect(diff).toMatch(/\n\n\+console\.log\(1\);/);
    expect(extractAddedLines(diff)).toEqual([
      { file: 'src/s.ts', line: 'console.log(1);', lineNumber: 3, precedingLine: '' },
    ]);
  });
});

// ─── Census: every patch- or stat-producing git spawn carries the list ──────
//
// The list-form diffs (`--name-only`, `--name-status`, `--numstat`,
// `--shortstat`) were measured untouched by every setting above and are
// exempt by that flag, unless the same argv also asks for a patch or a stat
// (`--stat` beside `--numstat` is coloured). `-z` on its own is not a list
// form (it only changes the terminators of those four outputs, and alone it
// still prints a patch), so an argv carrying `-z` without one of the four is
// held to the rule. Every other `git diff` argv, and every `git log` argv that
// prints a patch or a stat (`-p`, `-u`, `--patch`, `--stat`,
// `--patch-with-stat`, `--cc`), must spread GIT_DIFF_PORCELAIN_ARGS as the
// element directly after the subcommand, before any ref, option or `--`. The
// scanner reads array literals with balanced brackets and either quote style,
// splits them at top-level commas, and finds the subcommand wherever it sits
// (after a `'-C', dir` pair too), so a spawn written in any of the repository's
// idioms is read.

const LIST_FORM_FLAGS = ['--name-only', '--name-status', '--numstat', '--shortstat'];
const PATCH_OR_STAT_FLAGS = ['-p', '-u', '--patch', '--stat', '--patch-with-stat', '--cc'];
const PINS_TOKEN = '...GIT_DIFF_PORCELAIN_ARGS';

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

/** Every array literal in `text`, as its start offset and its top-level tokens (trimmed). */
function arrayLiterals(text: string): Array<{ start: number; tokens: string[] }> {
  const out: Array<{ start: number; tokens: string[] }> = [];
  const quotes = new Set(["'", '"', '`']);
  // Open array literals, innermost last; each tracks its own depth of nested
  // brackets and parentheses so a top-level comma is told from a nested one.
  const open: Array<{ start: number; depth: number; tokenStart: number; tokens: string[] }> = [];
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    // A comment's apostrophes ("git's", "don't") would otherwise open a quote
    // that swallows the next array literal: skip `//` to the line end and
    // `/* … */` whole.
    if (ch === '/' && text[i + 1] === '/') {
      const eol = text.indexOf('\n', i);
      i = eol < 0 ? text.length : eol;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (quotes.has(ch)) {
      quote = ch;
      continue;
    }
    const top = open.at(-1);
    if (ch === '[') {
      if (top !== undefined) top.depth++;
      open.push({ start: i, depth: 0, tokenStart: i + 1, tokens: [] });
      continue;
    }
    if (top === undefined) continue;
    if (ch === '(' || ch === '{') top.depth++;
    else if (ch === ')' || ch === '}') top.depth--;
    else if (ch === ',' && top.depth === 0) {
      top.tokens.push(text.slice(top.tokenStart, i).trim());
      top.tokenStart = i + 1;
    } else if (ch === ']') {
      if (top.depth > 0) {
        top.depth--;
        continue;
      }
      const last = text.slice(top.tokenStart, i).trim();
      if (last.length > 0) top.tokens.push(last);
      open.pop();
      out.push({ start: top.start, tokens: top.tokens });
      const parent = open.at(-1);
      if (parent !== undefined) parent.depth--;
    }
  }
  return out;
}

const unquote = (token: string): string | null => {
  const m = token.match(/^(['"])(.*)\1$/);
  return m ? m[2]! : null;
};

/**
 * `file:line argv` for every git diff / patch-printing git log argv that lacks
 * the pins, plus how many git diff / log argv the scanner saw at all, so a
 * scanner that desynchronised and saw nothing cannot pass as a clean tree.
 */
function unpinnedGitDiffSpawns(repoRoot: string): { violations: string[]; seen: number } {
  const sources: string[] = [];
  for (const pkg of ['core', 'cli', 'mcp']) {
    listTsSources(path.join(repoRoot, 'packages', pkg, 'src'), sources);
  }
  const violations: string[] = [];
  let seen = 0;
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const { start, tokens } of arrayLiterals(text)) {
      const literals = tokens.map(unquote);
      const at = literals.findIndex((t) => t === 'diff' || t === 'log');
      if (at < 0) continue;
      // The word is git's subcommand only when everything before it is a git
      // global option (`-C <dir>`, `-c <key=value>`, `--no-pager`, …); a
      // `gh pr diff …` argv carries `diff` after `pr` and is not git's.
      let isGitSubcommand = true;
      for (let i = 0; i < at; i++) {
        const option = literals[i];
        if (option === null || !option.startsWith('-')) {
          isGitSubcommand = false;
          break;
        }
        if (option === '-C' || option === '-c') i++;
      }
      if (!isGitSubcommand) continue;
      seen++;
      const subcommand = literals[at]!;
      const rest = literals.slice(at + 1);
      const printsPatchOrStat = rest.some((t) => t !== null && PATCH_OR_STAT_FLAGS.includes(t));
      if (subcommand === 'log' && !printsPatchOrStat) continue;
      const listForm = rest.some((t) => t !== null && LIST_FORM_FLAGS.includes(t));
      if (subcommand === 'diff' && listForm && !printsPatchOrStat) continue;
      if (tokens[at + 1] === PINS_TOKEN) continue;
      const line = text.slice(0, start).split('\n').length;
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      violations.push(`${rel}:${line} [${tokens.join(', ')}]`);
    }
  }
  return { violations, seen };
}

describe('census: patch-producing git spawns spread GIT_DIFF_PORCELAIN_ARGS (mmnto-ai/totem#3113)', () => {
  it('finds no git diff or patch-printing git log argv without the pins in core, cli and mcp sources', () => {
    const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
    expect(fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))).toBe(true);
    const { violations, seen } = unpinnedGitDiffSpawns(repoRoot);
    expect(violations).toEqual([]);
    // The tree carries well over twenty git diff / log argv (the pinned sites,
    // the list forms, the metadata logs); a scanner that saw fewer has lost
    // its place and its empty violation list proves nothing.
    expect(seen).toBeGreaterThanOrEqual(20);
  });

  it('names every unpinned shape and lets the exempt shapes through (the detector reads both)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-census-'));
    try {
      for (const pkg of ['core', 'cli', 'mcp']) {
        fs.mkdirSync(path.join(dir, 'packages', pkg, 'src'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(dir, 'packages', 'core', 'src', 'x.ts'),
        [
          "safeExec('git', ['diff', 'HEAD']);", // 1 unpinned
          "safeExec('git', ['diff', ...GIT_DIFF_PORCELAIN_ARGS, 'HEAD']);", // 2 pinned
          "safeExec('git', ['diff', '--name-only', '-z', ref]);", // 3 list form, exempt
          "exec('git', ['log', '-p', range]);", // 4 unpinned log -p
          "exec('git', ['log', '-1', '--format=%H']);", // 5 metadata log, exempt
          "safeExec('git', ['diff']);", // 6 a bare diff is a patch
          'safeExec("git", ["diff", "--stat", ref]);', // 7 double quotes
          "safeExec('git', ['-C', dir, 'diff', `${base}...HEAD`]);", // 8 the -C idiom
          "exec('git', ['log', refs[0], '--patch']);", // 9 a nested ] and another spelling
          "safeExec('git', ['diff', '--stat', '--numstat', ref]);", // 10 a stat beside a list flag
          "safeExec('git', ['diff', '-z', ref]);", // 11 -z alone is a patch
          "safeExec('git', ['-C', dir, 'diff', ...GIT_DIFF_PORCELAIN_ARGS, '--stat']);", // 12 pinned after -C
          "safeExec('git', ['log', '--format=%H', '--', 'a]b.ts']);", // 13 a ] inside a string
          "// a comment with git's apostrophe, which must not swallow the next line",
          "safeExec('git', ['diff', '--cached']);", // 14 unpinned, after the comment
          "safeExec('gh', ['pr', 'diff', String(num), '--', ...files]);", // not git's diff: unseen
        ].join('\n'),
        'utf-8',
      );
      const { violations, seen } = unpinnedGitDiffSpawns(dir);
      expect(seen).toBe(14);
      expect(violations).toEqual([
        "packages/core/src/x.ts:1 ['diff', 'HEAD']",
        "packages/core/src/x.ts:4 ['log', '-p', range]",
        "packages/core/src/x.ts:6 ['diff']",
        'packages/core/src/x.ts:7 ["diff", "--stat", ref]',
        "packages/core/src/x.ts:8 ['-C', dir, 'diff', `${base}...HEAD`]",
        "packages/core/src/x.ts:9 ['log', refs[0], '--patch']",
        "packages/core/src/x.ts:10 ['diff', '--stat', '--numstat', ref]",
        "packages/core/src/x.ts:11 ['diff', '-z', ref]",
        "packages/core/src/x.ts:15 ['diff', '--cached']",
      ]);
    } finally {
      cleanTmpDir(dir);
    }
  });
});

/**
 * Exit-code contract for `totem hook install` (`hooksCommand`) + the managed
 * session-hook bounded drift-repair (mmnto-ai/totem#2410 PR-A, slices 2+3).
 *
 * This is the dedicated falsifying test for the contract #2406 stabilized and
 * strategy#894 froze (Tenet 19). It locks:
 *   - exit 0 ⟺ {fresh install, already-current, bounded drift-repair (git hook AND
 *     session hook), declared skips (not-a-git-repo, hook-manager-detected)};
 *   - exit ≠0 ⟺ genuine failure (a hook write throws → propagates → handleError);
 *   - `--check` is exactly 0/1 (all-present-with-marker vs missing/markerless);
 *   - a bare install never mutates a non-bounded file (git hook OR session hook);
 *     `--force` is the only unbounded write; a legacy markerless-end session hook is
 *     never bare-repaired; a no-marker user file is never touched even under --force;
 *   - regenerated artifacts always carry marker + end marker (so they self-repair);
 *   - the two `overwritten` messages are distinct ("Drift-repaired…" vs
 *     "Force-overwritten…").
 *
 * `hooksCommand` reads `process.cwd()` and gates via `process.exit` on `--check`
 * failure, so the exit-code cases drive it under `process.chdir` + a `process.exit`
 * spy (the doctor.test.ts idiom); the session-hook matrix drives the pure
 * `regenerateManagedSessionHooks(cwd, force)` seam directly.
 */
import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  CLAUDE_PREWRITESHIELD,
  CLAUDE_SESSION_START,
  GEMINI_SESSION_START,
  MANAGED_SESSION_HOOKS,
  TOTEM_FILE_END,
  TOTEM_FILE_MARKER,
} from './init-templates.js';
import {
  hooksCommand,
  installHooksNonInteractive,
  regenerateManagedSessionHooks,
  resolveHooksDir,
  TOTEM_PREPUSH_END,
  TOTEM_PREPUSH_MARKER,
} from './install-hooks.js';

// ─── Roster invariant (locked contract, mmnto-ai/totem#2410) ─────────

describe('MANAGED_SESSION_HOOKS roster invariant', () => {
  it('every entry embeds its own marker AND end marker (so regenerated artifacts self-repair)', () => {
    expect(MANAGED_SESSION_HOOKS.length).toBeGreaterThan(0);
    for (const { rel, content, marker, endMarker } of MANAGED_SESSION_HOOKS) {
      expect(content.includes(marker), `${rel} content is missing its marker`).toBe(true);
      expect(content.includes(endMarker), `${rel} content is missing its end marker`).toBe(true);
      // The marker must OPEN the file (only whitespace before it) — the ownership
      // precondition for bounded drift-repair.
      expect(content.trimStart().startsWith(marker), `${rel} marker must open the file`).toBe(true);
      // The end marker must CLOSE the region (nothing but whitespace after it).
      const endIdx = content.indexOf(endMarker);
      expect(content.slice(endIdx + endMarker.length).trim()).toBe('');
    }
  });

  it('covers the six distributed managed artifacts (incl. the PR-B prepare wrapper)', () => {
    const rels = MANAGED_SESSION_HOOKS.map((h) => h.rel).sort();
    expect(rels).toEqual(
      [
        '.claude/hooks/PreWriteShield.cjs',
        '.claude/hooks/SessionStart.cjs',
        '.claude/hooks/gate-wrapper.cjs',
        '.gemini/hooks/BeforeTool.js',
        '.gemini/hooks/SessionStart.js',
        '.totem/prepare.cjs',
      ].sort(),
    );
  });
});

// ─── Managed session-hook bounded drift-repair (slice 3) ─────────────

describe('regenerateManagedSessionHooks — bounded drift-repair matrix', () => {
  let tmpDir: string;
  const CLAUDE_SS = '.claude/hooks/SessionStart.cjs';

  function writeHook(rel: string, content: string): string {
    const p = path.join(tmpDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
    return p;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410-sess-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('does NOT create a missing session hook (regenerate-only-if-present)', async () => {
    const results = await regenerateManagedSessionHooks(tmpDir);
    expect(results).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, ...CLAUDE_SS.split('/')))).toBe(false);
  });

  it('returns exists for a present, byte-identical session hook (already current)', async () => {
    writeHook(CLAUDE_SS, CLAUDE_SESSION_START);
    const results = await regenerateManagedSessionHooks(tmpDir);
    const r = results.find((x) => x.file === CLAUDE_SS)!;
    expect(r.action).toBe('exists');
    expect(fs.readFileSync(path.join(tmpDir, ...CLAUDE_SS.split('/')), 'utf-8')).toBe(
      CLAUDE_SESSION_START,
    );
  });

  it('bare drift-repairs a bounded totem-owned session hook (overwritten, no force)', async () => {
    const p = writeHook(CLAUDE_SS, `${TOTEM_FILE_MARKER}\nstale body\n${TOTEM_FILE_END}\n`);
    const results = await regenerateManagedSessionHooks(tmpDir);
    const r = results.find((x) => x.file === CLAUDE_SS)!;
    expect(r.action).toBe('overwritten');
    // Regenerated to canonical — and canonical carries marker + end marker.
    const written = fs.readFileSync(p, 'utf-8');
    expect(written).toBe(CLAUDE_SESSION_START);
    expect(written.includes(TOTEM_FILE_MARKER)).toBe(true);
    expect(written.includes(TOTEM_FILE_END)).toBe(true);
  });

  it('does NOT bare-repair a legacy marker-headed session hook missing the end marker', async () => {
    const legacy = `${TOTEM_FILE_MARKER} — Claude Code SessionStart hook\nstale legacy body\n`;
    const p = writeHook(CLAUDE_SS, legacy);
    const results = await regenerateManagedSessionHooks(tmpDir);
    const r = results.find((x) => x.file === CLAUDE_SS)!;
    expect(r.action).toBe('declined');
    // Untouched — takes one `totem hook install --force`.
    expect(fs.readFileSync(p, 'utf-8')).toBe(legacy);
  });

  it('--force overwrites a legacy markerless-end session hook (the migration path)', async () => {
    const legacy = `${TOTEM_FILE_MARKER} — Claude Code SessionStart hook\nstale legacy body\n`;
    const p = writeHook(CLAUDE_SS, legacy);
    const results = await regenerateManagedSessionHooks(tmpDir, true);
    const r = results.find((x) => x.file === CLAUDE_SS)!;
    expect(r.action).toBe('overwritten');
    expect(fs.readFileSync(p, 'utf-8')).toBe(CLAUDE_SESSION_START);
  });

  it('does NOT repair a bounded hook with user content AFTER the end marker (bare declines)', async () => {
    const withTrailingUser = `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\nconsole.log("mine");\n`;
    const p = writeHook(CLAUDE_SS, withTrailingUser);
    const results = await regenerateManagedSessionHooks(tmpDir);
    expect(results.find((x) => x.file === CLAUDE_SS)!.action).toBe('declined');
    expect(fs.readFileSync(p, 'utf-8')).toBe(withTrailingUser);
  });

  it('never touches a user-owned file with NO totem marker, even under --force (skipped)', async () => {
    const userOwned = '// my own SessionStart hook\nconsole.log("mine");\n';
    const p = writeHook(CLAUDE_SS, userOwned);

    const bare = await regenerateManagedSessionHooks(tmpDir);
    expect(bare.find((x) => x.file === CLAUDE_SS)!.action).toBe('skipped');
    expect(fs.readFileSync(p, 'utf-8')).toBe(userOwned);

    const forced = await regenerateManagedSessionHooks(tmpDir, true);
    expect(forced.find((x) => x.file === CLAUDE_SS)!.action).toBe('skipped');
    expect(fs.readFileSync(p, 'utf-8')).toBe(userOwned);
  });

  it('never touches a user file that merely QUOTES the marker (marker not at start), even under --force', async () => {
    // A user-owned hook that quotes the marker string in a comment/string is NOT
    // marker-headed (positional gate, mmnto-ai/totem#2413). The old `includes(marker)`
    // gate would treat it as owned and let --force clobber it.
    const quotesMarker = `// my own hook\n// I copied this line: ${TOTEM_FILE_MARKER}\nconsole.log("mine");\n`;
    const p = writeHook(CLAUDE_SS, quotesMarker);

    const bare = await regenerateManagedSessionHooks(tmpDir);
    expect(bare.find((x) => x.file === CLAUDE_SS)!.action).toBe('skipped');
    expect(fs.readFileSync(p, 'utf-8')).toBe(quotesMarker);

    const forced = await regenerateManagedSessionHooks(tmpDir, true);
    expect(forced.find((x) => x.file === CLAUDE_SS)!.action).toBe('skipped');
    expect(fs.readFileSync(p, 'utf-8')).toBe(quotesMarker);
  });

  it('repairs each vendor family independently (claude + gemini)', async () => {
    writeHook(
      '.claude/hooks/PreWriteShield.cjs',
      `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\n`,
    );
    writeHook('.gemini/hooks/SessionStart.js', GEMINI_SESSION_START); // already current
    const results = await regenerateManagedSessionHooks(tmpDir);

    expect(results.find((x) => x.file === '.claude/hooks/PreWriteShield.cjs')!.action).toBe(
      'overwritten',
    );
    expect(
      fs.readFileSync(path.join(tmpDir, '.claude', 'hooks', 'PreWriteShield.cjs'), 'utf-8'),
    ).toBe(CLAUDE_PREWRITESHIELD);
    expect(results.find((x) => x.file === '.gemini/hooks/SessionStart.js')!.action).toBe('exists');
  });
});

// ─── hooksCommand exit-code contract (slice 2) ───────────────────────

describe('hooksCommand exit-code contract', () => {
  let tmpDir: string;
  let originalCwd: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const hooksDir = () => path.join(tmpDir, '.git', 'hooks');
  const errorOutput = (): string =>
    errorSpy.mock.calls
      .map((c: unknown[]) => c.map((a: unknown) => String(a)).join(' '))
      .join('\n');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410-cmd-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A throwing process.exit surfaces a --check failure as a rejection (the CLI
    // edge would exit non-zero); the install path must never reach it.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  // ── exit 0 classes ──────────────────────────────────────────────

  it('exit 0: fresh install (no throw, no process.exit)', async () => {
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(hooksDir(), 'pre-push'))).toBe(true);
  });

  it('exit 0: already-current (second install is a no-op)', async () => {
    await hooksCommand({});
    errorSpy.mockClear();
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorOutput()).toContain('already installed');
  });

  it('exit 0: bare git-hook drift-repair prints "Drift-repaired", not "Force-overwritten"', async () => {
    await hooksCommand({});
    // Corrupt pre-push to a stale-but-bounded totem-owned whole file.
    fs.writeFileSync(
      path.join(hooksDir(), 'pre-push'),
      `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER}\nstale\n# ${TOTEM_PREPUSH_END}\n`,
    );
    errorSpy.mockClear();
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    const out = errorOutput();
    expect(out).toContain('Drift-repaired pre-push hook (totem-owned bounded region).');
    expect(out).not.toContain('Force-overwritten pre-push');
  });

  it('exit 0: bare session-hook drift-repair prints "Drift-repaired"', async () => {
    fs.mkdirSync(path.join(tmpDir, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'hooks', 'SessionStart.cjs'),
      `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\n`,
    );
    errorSpy.mockClear();
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorOutput()).toContain(
      'Drift-repaired .claude/hooks/SessionStart.cjs session hook (totem-owned bounded region).',
    );
    expect(
      fs.readFileSync(path.join(tmpDir, '.claude', 'hooks', 'SessionStart.cjs'), 'utf-8'),
    ).toBe(CLAUDE_SESSION_START);
  });

  it('exit 0: declared skip — not a git repository', async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410-nogit-'));
    process.chdir(nonGit);
    try {
      await expect(hooksCommand({})).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
      expect(errorOutput()).toContain('Not a git repository');
    } finally {
      process.chdir(tmpDir);
      cleanTmpDir(nonGit);
    }
  });

  it('exit 0: declared skip — hook manager detected', async () => {
    fs.mkdirSync(path.join(tmpDir, '.husky'), { recursive: true });
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('hook-manager repo STILL drift-repairs an existing bounded session hook (lc#806 guard)', async () => {
    // A git-hook manager (husky) means git hooks are the manager's job — a declared
    // skip for the git side. But the session hooks are Claude/Gemini artifacts,
    // independent of the manager, so they must still be regenerated: the fix for the
    // hook-manager early-return that otherwise recreates the lc#806 stale class.
    fs.mkdirSync(path.join(tmpDir, '.husky'), { recursive: true });
    const ssPath = path.join(tmpDir, '.claude', 'hooks', 'SessionStart.cjs');
    fs.mkdirSync(path.dirname(ssPath), { recursive: true });
    fs.writeFileSync(ssPath, `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\n`);
    errorSpy.mockClear();

    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    // The bounded session hook is drift-repaired even though git hooks were skipped.
    expect(fs.readFileSync(ssPath, 'utf-8')).toBe(CLAUDE_SESSION_START);
    expect(errorOutput()).toContain(
      'Drift-repaired .claude/hooks/SessionStart.cjs session hook (totem-owned bounded region).',
    );
  });

  // ── exit ≠0: genuine failure ────────────────────────────────────

  it('exit ≠0: a genuine hook-write failure propagates as a thrown error', async () => {
    // Make the first-installed hook PATH a directory: the installer's read/write of it
    // throws EISDIR — a genuine FS failure that must PROPAGATE (fail-loud, Tenet 4),
    // not be swallowed into a false `installed`. (A directory-at-path fault is
    // cross-platform, unlike an ESM fs spy — vitest cannot redefine fs namespace exports.)
    fs.mkdirSync(path.join(hooksDir(), 'pre-commit'), { recursive: true });
    await expect(hooksCommand({})).rejects.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // ── --check: exactly 0/1 ────────────────────────────────────────

  it('--check exit 0: all hooks present with markers', async () => {
    await hooksCommand({});
    errorSpy.mockClear();
    await expect(hooksCommand({ check: true })).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorOutput()).toContain('All hooks installed');
  });

  it('--check exit 1: hooks missing (and the remedy names `totem hook install`)', async () => {
    await expect(hooksCommand({ check: true })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const out = errorOutput();
    expect(out).toContain('Some hooks are missing');
    expect(out).toContain('totem hook install');
    expect(out).not.toContain('Run `totem hooks`');
  });

  it('--check exit 1: hook present but missing the Totem marker', async () => {
    // Install, then strip the marker from one hook (markerless → not counted).
    await hooksCommand({});
    fs.writeFileSync(path.join(hooksDir(), 'pre-push'), '#!/bin/sh\necho "no marker"\n');
    await expect(hooksCommand({ check: true })).rejects.toThrow('process.exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('--check is read-only: it does NOT mutate a drifted session hook', async () => {
    // Install git hooks so --check passes on the git side (exit 0), then plant a
    // drifted-but-bounded session hook. --check is a verify-only path and returns
    // before session-hook regeneration, so the drifted hook must be left untouched.
    await hooksCommand({});
    const ssPath = path.join(tmpDir, '.claude', 'hooks', 'SessionStart.cjs');
    fs.mkdirSync(path.dirname(ssPath), { recursive: true });
    const drifted = `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\n`;
    fs.writeFileSync(ssPath, drifted);

    await expect(hooksCommand({ check: true })).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(ssPath, 'utf-8')).toBe(drifted);
  });

  // ── the two `overwritten` messages are distinct ─────────────────

  it('bare drift-repair and --force overwrite print DISTINCT messages', async () => {
    await hooksCommand({});
    const staleBounded = `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER}\nstale\n# ${TOTEM_PREPUSH_END}\n`;

    // Bare (no --force) bounded drift-repair.
    fs.writeFileSync(path.join(hooksDir(), 'pre-push'), staleBounded);
    errorSpy.mockClear();
    await hooksCommand({});
    const bareMsg = errorOutput()
      .split('\n')
      .find((l) => l.includes('pre-push hook'))!;

    // --force overwrite of the same stale-bounded file.
    fs.writeFileSync(path.join(hooksDir(), 'pre-push'), staleBounded);
    errorSpy.mockClear();
    await hooksCommand({ force: true });
    const forceMsg = errorOutput()
      .split('\n')
      .find((l) => l.includes('pre-push hook'))!;

    expect(bareMsg).toContain('Drift-repaired');
    expect(forceMsg).toContain('Force-overwritten');
    expect(bareMsg).not.toBe(forceMsg);
  });

  // ── bare install never mutates a non-bounded git hook ───────────

  it('bare install never mutates a user hook with an appended totem block (non-bounded)', async () => {
    const userThenTotem = `#!/bin/sh\nrun_my_tests\n# ${TOTEM_PREPUSH_MARKER}\nstale\n# ${TOTEM_PREPUSH_END}\n`;
    fs.mkdirSync(hooksDir(), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(), 'pre-push'), userThenTotem);
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    // User content preserved — only --force may overwrite an unbounded file.
    expect(fs.readFileSync(path.join(hooksDir(), 'pre-push'), 'utf-8')).toBe(userThenTotem);
  });
});

// ─── sanity: installHooksNonInteractive still classifies a fresh repo ─

describe('installHooksNonInteractive (contract sanity)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410-ni-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns null outside a git repo (declared skip, exit 0 at the command edge)', () => {
    expect(installHooksNonInteractive(tmpDir)).toBeNull();
  });
});

// ─── Worktree + gitdir-pointer resolution (mmnto-ai/totem#2418) ──────
//
// In a linked worktree `.git` is a FILE (`gitdir: <path>` pointer), so the
// pre-fix blind `mkdir '.git/hooks'` crashed ENOTDIR and failed the consumer's
// whole `pnpm install` through the prepare wrapper. The contract names the
// worktree/submodule pointer cases: resolvable → install into the SHARED hooks
// dir (what git actually executes); unparseable → declared skip, exit 0.

describe('hooksCommand in a linked worktree (mmnto-ai/totem#2418)', () => {
  let mainDir: string;
  let wtParent: string;
  let wtDir: string;
  let originalCwd: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const sharedHooksDir = () => path.join(mainDir, '.git', 'hooks');
  const errorOutput = (): string =>
    errorSpy.mock.calls
      .map((c: unknown[]) => c.map((a: unknown) => String(a)).join(' '))
      .join('\n');

  beforeEach(() => {
    mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2418-main-'));
    execSync('git init', { cwd: mainDir, stdio: 'ignore' });
    // `git worktree add` needs a commit to branch from.
    execSync(
      'git -c user.name=totem -c user.email=totem@test.invalid commit --allow-empty -m init',
      { cwd: mainDir, stdio: 'ignore' },
    );
    wtParent = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2418-wt-'));
    wtDir = path.join(wtParent, 'wt');
    // Arg-array spawn — no shell, so the tmp path is never shell-interpreted.
    execFileSync('git', ['worktree', 'add', wtDir], { cwd: mainDir, stdio: 'ignore' });

    originalCwd = process.cwd();
    process.chdir(wtDir);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    cleanTmpDir(wtParent);
    cleanTmpDir(mainDir);
  });

  it('resolveHooksDir follows the gitdir pointer to the SHARED hooks dir', () => {
    // The worktree's `.git` is a pointer FILE, not a directory.
    expect(fs.statSync(path.join(wtDir, '.git')).isFile()).toBe(true);
    const resolved = resolveHooksDir(wtDir);
    expect(resolved).not.toBeNull();
    // realpathSync.native both sides: git prints the LONG form while os.tmpdir()
    // can carry a Windows 8.3 alias (RUNNER~1 on GH runners) or a symlinked
    // tmpdir (macOS /var → /private/var); only the native variant expands both.
    expect(fs.realpathSync.native(resolved!)).toBe(fs.realpathSync.native(sharedHooksDir()));
  });

  it('resolveHooksDir in a plain checkout stays .git/hooks', () => {
    const resolved = resolveHooksDir(mainDir);
    expect(resolved).not.toBeNull();
    expect(fs.realpathSync.native(resolved!)).toBe(fs.realpathSync.native(sharedHooksDir()));
  });

  it('exit 0: install from the worktree lands in the shared hooks dir (no ENOTDIR)', async () => {
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    for (const hook of ['pre-commit', 'pre-push', 'post-merge', 'post-checkout']) {
      expect(
        fs.existsSync(path.join(sharedHooksDir(), hook)),
        `${hook} missing from the shared hooks dir`,
      ).toBe(true);
    }
    // The pointer file survives untouched — nothing tried to mkdir through it.
    expect(fs.statSync(path.join(wtDir, '.git')).isFile()).toBe(true);
  });

  it('--check from the worktree sees the shared hooks (exit 0)', async () => {
    await hooksCommand({});
    errorSpy.mockClear();
    await expect(hooksCommand({ check: true })).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorOutput()).toContain('All hooks installed');
  });

  it('installHooksNonInteractive from the worktree classifies all four hooks', () => {
    const result = installHooksNonInteractive(wtDir);
    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');
    expect(result!.postCheckout).toBe('installed');
  });
});

describe('hooksCommand with an unparseable .git pointer file (declared skip)', () => {
  let tmpDir: string;
  let originalCwd: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2418-badptr-'));
    // A `.git` FILE whose content is not a `gitdir:` pointer — git reports
    // `fatal: invalid gitfile format` for it.
    fs.writeFileSync(path.join(tmpDir, '.git'), 'not a gitdir pointer\n');
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    cleanTmpDir(tmpDir);
  });

  it('exit 0: install declares the skip instead of crashing prepare', async () => {
    await expect(hooksCommand({})).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    const out = errorSpy.mock.calls
      .map((c: unknown[]) => c.map((a: unknown) => String(a)).join(' '))
      .join('\n');
    expect(out).toContain('not a directory or a resolvable gitdir pointer');
  });

  it('resolveHooksDir returns null for the unparseable pointer (never a blind join)', () => {
    expect(resolveHooksDir(tmpDir)).toBeNull();
  });
});

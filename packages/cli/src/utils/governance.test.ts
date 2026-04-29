import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

function makeTmpDir(prefix = 'totem-gov-'): string {
  // Canonicalize via `realpathSync.native` so the tmp path collapses to the
  // same form `git rev-parse --show-toplevel` returns. `.native` is required
  // because plain `realpathSync` resolves POSIX symlinks (macOS `/tmp ->
  // /private/tmp`) but NOT Windows 8.3 short names (`C:\Users\RUNNER~1\...`
  // → `C:\Users\runneradmin\...`). Without `.native`, path-equality
  // assertions fail on windows-latest CI while passing on macos and ubuntu.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function initGit(dir: string): void {
  // Minimal git scaffold to satisfy `git rev-parse --show-toplevel`.
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
  fs.writeFileSync(
    path.join(dir, '.git', 'config'),
    '[core]\n\trepositoryformatversion = 0\n',
    'utf-8',
  );
  fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git', 'refs', 'heads'), { recursive: true });
}

describe('resolveGovernancePaths', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('resolves submodule strategy path when `.strategy/` exists alongside cwd', async () => {
    initGit(tmpDir);
    const strategyDir = path.join(tmpDir, '.strategy');
    fs.mkdirSync(path.join(strategyDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(strategyDir, 'adr'), { recursive: true });

    const { resolveGovernancePaths } = await import('./governance.js');
    const paths = resolveGovernancePaths(tmpDir, 'proposal');

    expect(paths.rootDir).toBe(path.normalize(strategyDir));
    expect(paths.targetDir).toBe(path.normalize(path.join(strategyDir, 'proposals', 'active')));
    expect(paths.dashboardFile).toBe(path.normalize(path.join(strategyDir, 'README.md')));
    expect(paths.templatePath).toBe(
      path.normalize(path.join(strategyDir, 'templates', 'proposal.md')),
    );
  });

  it('resolves standalone strategy path when submodule prefix is missing', async () => {
    initGit(tmpDir);
    // Standalone strategy repo — `adr/` lives at the git root, no `.strategy/` prefix.
    // `templates/` sentinel at the root distinguishes a real strategy repo from a
    // consumer repo that happens to ship a top-level `adr/` docs folder.
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const { resolveGovernancePaths } = await import('./governance.js');
    const paths = resolveGovernancePaths(tmpDir, 'adr');

    expect(paths.rootDir).toBe(path.normalize(tmpDir));
    expect(paths.targetDir).toBe(path.normalize(path.join(tmpDir, 'adr')));
    expect(paths.dashboardFile).toBe(path.normalize(path.join(tmpDir, 'README.md')));
    expect(paths.templatePath).toBe(path.normalize(path.join(tmpDir, 'templates', 'adr.md')));
  });

  it('rejects standalone false-positive when a consumer repo has only adr/ without templates/', async () => {
    initGit(tmpDir);
    // Consumer repo with a top-level `adr/` docs folder but NO `templates/`
    // and NO sibling/submodule strategy. Pre-tightening, this would have
    // false-positively scaffolded into the consumer's adr/ folder.
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });

    const { resolveGovernancePaths } = await import('./governance.js');
    expect(() => resolveGovernancePaths(tmpDir, 'adr')).toThrow(/strategy/i);
  });

  it('throws TotemError when cwd is not inside a git repository', async () => {
    // tmpDir has no `.git/`; resolveGitRoot returns null.
    const { resolveGovernancePaths } = await import('./governance.js');
    expect(() => resolveGovernancePaths(tmpDir, 'proposal')).toThrow(/not inside a git repo/i);
  });

  it('throws TotemError when no strategy layout is found', async () => {
    initGit(tmpDir);
    // Neither `.strategy/proposals/` nor top-level `proposals/`.
    const { resolveGovernancePaths } = await import('./governance.js');
    expect(() => resolveGovernancePaths(tmpDir, 'proposal')).toThrow(/strategy/i);
  });

  it('error message names the canonical sibling clone path and env var (mmnto-ai/totem#1710)', async () => {
    initGit(tmpDir);
    const { resolveGovernancePaths } = await import('./governance.js');
    let caught: unknown;
    try {
      resolveGovernancePaths(tmpDir, 'proposal');
    } catch (err) {
      caught = err;
    }
    const totemErr = caught as { message?: string; recoveryHint?: string };
    const combined = `${totemErr.message ?? ''}\n${totemErr.recoveryHint ?? ''}`;
    expect(combined).toMatch(/totem-strategy/i);
    expect(combined).toMatch(/TOTEM_STRATEGY_ROOT/);
  });

  it('resolves sibling strategy path via the resolver when ../totem-strategy exists (mmnto-ai/totem#1710)', async () => {
    // Layout:
    //   <parent>/repo/.git/   ← gitRoot (created via initGit)
    //   <parent>/totem-strategy/proposals/active/
    const repo = path.join(tmpDir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    initGit(repo);

    const sibling = path.join(tmpDir, 'totem-strategy');
    fs.mkdirSync(path.join(sibling, 'proposals', 'active'), { recursive: true });

    const { resolveGovernancePaths } = await import('./governance.js');
    const paths = resolveGovernancePaths(repo, 'proposal');

    expect(paths.rootDir).toBe(path.normalize(sibling));
    expect(paths.targetDir).toBe(path.normalize(path.join(sibling, 'proposals', 'active')));
  });

  it('resolves env-driven strategy path when TOTEM_STRATEGY_ROOT is set (mmnto-ai/totem#1710)', async () => {
    initGit(tmpDir);
    const elsewhere = path.join(tmpDir, 'elsewhere-strategy');
    fs.mkdirSync(path.join(elsewhere, 'proposals', 'active'), { recursive: true });

    const prev = process.env.TOTEM_STRATEGY_ROOT;
    process.env.TOTEM_STRATEGY_ROOT = elsewhere;
    try {
      const { resolveGovernancePaths } = await import('./governance.js');
      const paths = resolveGovernancePaths(tmpDir, 'proposal');
      expect(paths.rootDir).toBe(path.normalize(elsewhere));
    } finally {
      if (prev === undefined) delete process.env.TOTEM_STRATEGY_ROOT;
      else process.env.TOTEM_STRATEGY_ROOT = prev;
    }
  });
});

describe('getNextArtifactId', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir('totem-gov-id-');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns 001 when target directory is empty', async () => {
    const { getNextArtifactId } = await import('./governance.js');
    expect(getNextArtifactId(tmpDir)).toBe('001');
  });

  it('returns 001 when target directory does not exist', async () => {
    const missing = path.join(tmpDir, 'never-created');
    const { getNextArtifactId } = await import('./governance.js');
    expect(getNextArtifactId(missing)).toBe('001');
  });

  it('calculates correct next id when numerical gaps exist in directory', async () => {
    // Seed with 001 and 003 — next must be 004, NOT 002 (gap logic).
    fs.writeFileSync(path.join(tmpDir, '001-a.md'), '# A\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '003-b.md'), '# B\n', 'utf-8');
    const { getNextArtifactId } = await import('./governance.js');
    expect(getNextArtifactId(tmpDir)).toBe('004');
  });

  it('ignores files that do not match the NNN-title.md pattern', async () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# R\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'x', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '42-not-padded.md'), '# x\n', 'utf-8');
    fs.writeFileSync(path.join(tmpDir, '010-valid.md'), '# v\n', 'utf-8');
    const { getNextArtifactId } = await import('./governance.js');
    expect(getNextArtifactId(tmpDir)).toBe('011');
  });

  it('throws when NNN-prefix space is saturated (>999)', async () => {
    fs.writeFileSync(path.join(tmpDir, '999-final.md'), '# x\n', 'utf-8');
    const { getNextArtifactId } = await import('./governance.js');
    expect(() => getNextArtifactId(tmpDir)).toThrow(/saturated|overflow|999/i);
  });
});

describe('formatArtifactFilename', () => {
  it('produces kebab-case with NNN- prefix', async () => {
    const { formatArtifactFilename } = await import('./governance.js');
    expect(formatArtifactFilename('001', 'Feature Branch Workflow')).toBe(
      '001-feature-branch-workflow.md',
    );
  });

  it('sanitizes special characters into hyphens', async () => {
    const { formatArtifactFilename } = await import('./governance.js');
    expect(formatArtifactFilename('042', 'LLM caching (v2) / Verifier')).toBe(
      '042-llm-caching-v2-verifier.md',
    );
  });

  it('is deterministic across runs for the same title', async () => {
    const { formatArtifactFilename } = await import('./governance.js');
    const a = formatArtifactFilename('007', 'Totem Ingestion Pipeline');
    const b = formatArtifactFilename('007', 'Totem Ingestion Pipeline');
    expect(a).toBe(b);
    expect(a).toBe('007-totem-ingestion-pipeline.md');
  });

  it('throws when title sanitization produces an empty slug', async () => {
    const { formatArtifactFilename } = await import('./governance.js');
    expect(() => formatArtifactFilename('001', '!!!---???')).toThrow(/empty slug/i);
  });

  it('collapses runs of hyphens and trims leading/trailing hyphens', async () => {
    const { formatArtifactFilename } = await import('./governance.js');
    expect(formatArtifactFilename('050', '  ---Alpha   Beta---  ')).toBe('050-alpha-beta.md');
  });
});

describe('sanitizeArtifactTitle', () => {
  it('replaces newlines, tabs, and other C0 control characters with spaces', async () => {
    const { sanitizeArtifactTitle } = await import('./governance.js');
    expect(sanitizeArtifactTitle('Fix\n## Fake Heading')).toBe('Fix ## Fake Heading');
    expect(sanitizeArtifactTitle('Multi\tline\rtext')).toBe('Multi line text');
    expect(sanitizeArtifactTitle('bellecho')).toBe('bell echo');
  });

  it('strips DEL (0x7F)', async () => {
    const { sanitizeArtifactTitle } = await import('./governance.js');
    expect(sanitizeArtifactTitle('helloworld')).toBe('hello world');
  });

  it('collapses runs of whitespace and trims edges', async () => {
    const { sanitizeArtifactTitle } = await import('./governance.js');
    expect(sanitizeArtifactTitle('   multiple    spaces    ')).toBe('multiple spaces');
  });

  it('preserves `#` and other markdown-meaningful characters that stay single-line-safe', async () => {
    const { sanitizeArtifactTitle } = await import('./governance.js');
    // `#` inside a single-line heading is still part of the h1, so we don't strip it.
    expect(sanitizeArtifactTitle('Add # char support')).toBe('Add # char support');
    // Same for `$`, `{`, `}` — the template renderer uses a keyed replacer so
    // these cannot inject further substitutions.
    expect(sanitizeArtifactTitle('Handle $foo and {{X}}')).toBe('Handle $foo and {{X}}');
  });
});

describe('renderArtifactTemplate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir('totem-gov-tpl-');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('generates fallback template when physical template file is missing', async () => {
    const missingTemplate = path.join(tmpDir, 'templates', 'proposal.md');
    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'proposal',
      id: '005',
      title: 'Ingestion Pipeline',
      templatePath: missingTemplate,
      date: '2026-04-21',
    });

    // Exact heading form for Proposals per ADR-091 — space separator.
    expect(rendered).toContain('# Proposal 005: Ingestion Pipeline');
    expect(rendered).toContain('**Status:** Draft');
    expect(rendered).toContain('**Date:** 2026-04-21');
  });

  it('emits `# ADR NNN: Title` heading with space separator for adr type', async () => {
    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'adr',
      id: '091',
      title: 'Five-Stage Ingestion',
      templatePath: path.join(tmpDir, 'nonexistent.md'),
      date: '2026-04-21',
    });

    expect(rendered).toContain('# ADR 091: Five-Stage Ingestion');
    // Defensive: must NOT use a hyphen separator (common GPT-style slip).
    expect(rendered).not.toContain('# ADR-091');
    expect(rendered).not.toContain('# ADR 091 -');
    expect(rendered).toContain('**Status:** Draft');
    expect(rendered).toContain('**Date:** 2026-04-21');
  });

  it('reads from disk and substitutes {{TITLE}} and {{DATE}} when template exists', async () => {
    const tplDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(tplDir, { recursive: true });
    const tplPath = path.join(tplDir, 'proposal.md');
    fs.writeFileSync(
      tplPath,
      '# Proposal: {{TITLE}}\n\n**Date:** {{DATE}}\n\nBody here.\n',
      'utf-8',
    );

    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'proposal',
      id: '012',
      title: 'Example',
      templatePath: tplPath,
      date: '2026-04-21',
    });

    expect(rendered).toContain('# Proposal: Example');
    expect(rendered).toContain('**Date:** 2026-04-21');
    expect(rendered).not.toContain('{{TITLE}}');
    expect(rendered).not.toContain('{{DATE}}');
  });

  it('replaces ALL occurrences of template variables', async () => {
    const tplDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(tplDir, { recursive: true });
    const tplPath = path.join(tplDir, 'adr.md');
    fs.writeFileSync(tplPath, '{{TITLE}} / {{TITLE}} / {{DATE}} / {{DATE}}\n', 'utf-8');

    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'adr',
      id: '001',
      title: 'X',
      templatePath: tplPath,
      date: '2026-04-21',
    });

    // Both occurrences of each variable should be substituted.
    expect(rendered).toBe('X / X / 2026-04-21 / 2026-04-21\n');
  });

  it('renders titles containing `$` characters literally (no back-reference interpretation)', async () => {
    // `String.prototype.replace` interprets `$&`, `$1`, etc. in the
    // replacement string as back-references. Titles can legitimately
    // contain `$` (prices, shell variable names, etc.) and must not be
    // mangled. The implementation uses a replacer-function form to dodge
    // this trap; see PR #1429 for the canonical bug class.
    const tplDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(tplDir, { recursive: true });
    const tplPath = path.join(tplDir, 'proposal.md');
    fs.writeFileSync(tplPath, '# {{TITLE}}\n', 'utf-8');

    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'proposal',
      id: '001',
      title: 'Fix $foo and $& and $1 in ledger',
      templatePath: tplPath,
      date: '2026-04-22',
    });

    expect(rendered).toBe('# Fix $foo and $& and $1 in ledger\n');
  });

  it('resists template-token injection from user-provided title (single-pass)', async () => {
    // A naive sequential-replace implementation substitutes `{{DATE}}` from
    // the title in pass 1, then the pass-2 DATE regex matches the freshly-
    // inserted `{{DATE}}` and swaps in the date value. GCA caught this on
    // PR #1615. Single-pass regex with keyed lookup eliminates the class.
    const tplDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(tplDir, { recursive: true });
    const tplPath = path.join(tplDir, 'adr.md');
    fs.writeFileSync(tplPath, '{{TITLE}} / {{DATE}}\n', 'utf-8');

    const { renderArtifactTemplate } = await import('./governance.js');
    const rendered = renderArtifactTemplate({
      type: 'adr',
      id: '001',
      title: '{{DATE}}',
      templatePath: tplPath,
      date: '2026-04-22',
    });

    // Title stays literal. The `{{DATE}}` in the template body resolves;
    // the `{{DATE}}` inside the title does NOT.
    expect(rendered).toBe('{{DATE}} / 2026-04-22\n');
  });
});

describe('runPostScaffoldHooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir('totem-gov-hooks-');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('runs docs:inject then git add on the two target paths', async () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const exec = (cmd: string, args: string[], cwdArg?: string): void => {
      calls.push({ cmd, args, cwd: cwdArg });
    };

    const { runPostScaffoldHooks } = await import('./governance.js');
    const result = runPostScaffoldHooks({
      rootDir: tmpDir,
      newFilePath: path.join(tmpDir, 'proposals', 'active', '001-x.md'),
      dashboardFile: path.join(tmpDir, 'README.md'),
      exec,
    });

    expect(result.dashboardRefreshed).toBe(true);
    expect(result.staged).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.cmd).toBe('pnpm');
    expect(calls[0]!.args).toEqual(['run', 'docs:inject']);
    expect(calls[0]!.cwd).toBe(tmpDir);
    expect(calls[1]!.cmd).toBe('git');
    // git add must stage ONLY the two specific paths, never `-A` or `.`.
    expect(calls[1]!.args[0]).toBe('add');
    expect(calls[1]!.args.slice(1)).toEqual([
      path.join(tmpDir, 'proposals', 'active', '001-x.md'),
      path.join(tmpDir, 'README.md'),
    ]);
    expect(calls[1]!.args).not.toContain('-A');
    expect(calls[1]!.args).not.toContain('.');
  });

  it('stages artifact and readme without crashing if docs:inject fails', async () => {
    const warnings: string[] = [];
    const origWarn = console.error;
    console.error = (msg: unknown) => {
      warnings.push(String(msg));
    };

    try {
      const calls: Array<{ cmd: string; args: string[] }> = [];
      const exec = (cmd: string, args: string[]): void => {
        calls.push({ cmd, args });
        if (cmd === 'pnpm' && args.includes('docs:inject')) {
          throw new Error('Command failed: pnpm run docs:inject\nMissing script: docs:inject');
        }
      };

      const { runPostScaffoldHooks } = await import('./governance.js');
      const result = runPostScaffoldHooks({
        rootDir: tmpDir,
        newFilePath: path.join(tmpDir, 'proposals', 'active', '001-x.md'),
        dashboardFile: path.join(tmpDir, 'README.md'),
        exec,
      });

      expect(result.dashboardRefreshed).toBe(false);
      // git add still ran despite docs:inject failure (the artifact exists).
      expect(result.staged).toBe(true);
      const gitCall = calls.find((c) => c.cmd === 'git');
      expect(gitCall).toBeDefined();
      expect(gitCall!.args[0]).toBe('add');
      // A warning surfaced about the missing script.
      const combined = warnings.join('\n');
      expect(combined).toMatch(/docs:inject/i);
    } finally {
      console.error = origWarn;
    }
  });

  it('reports staged:false when git add fails but does not throw', async () => {
    const warnings: string[] = [];
    const origWarn = console.error;
    console.error = (msg: unknown) => {
      warnings.push(String(msg));
    };

    try {
      const exec = (cmd: string, args: string[]): void => {
        if (cmd === 'git' && args[0] === 'add') {
          throw new Error('fatal: pathspec did not match any files');
        }
      };

      const { runPostScaffoldHooks } = await import('./governance.js');
      const result = runPostScaffoldHooks({
        rootDir: tmpDir,
        newFilePath: path.join(tmpDir, 'proposals', 'active', '001-x.md'),
        dashboardFile: path.join(tmpDir, 'README.md'),
        exec,
      });

      expect(result.dashboardRefreshed).toBe(true);
      expect(result.staged).toBe(false);
      expect(warnings.join('\n')).toMatch(/stage|git add/i);
    } finally {
      console.error = origWarn;
    }
  });
});

describe('scaffoldGovernanceArtifact (orchestrator)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir('totem-gov-orch-');
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('creates file on disk with proposal heading and default Status/Date', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const calls: Array<{ cmd: string; args: string[] }> = [];
    const exec = (cmd: string, args: string[]): void => {
      calls.push({ cmd, args });
    };

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    const result = scaffoldGovernanceArtifact(
      {
        type: 'proposal',
        title: 'Feature Branch Workflow',
        cwd: tmpDir,
      },
      { exec, date: '2026-04-21' },
    );

    expect(result.filename).toBe('001-feature-branch-workflow.md');
    expect(result.id).toBe('001');
    expect(result.dashboardRefreshed).toBe(true);
    expect(result.staged).toBe(true);

    const written = fs.readFileSync(result.filePath, 'utf-8');
    expect(written).toContain('# Proposal 001: Feature Branch Workflow');
    expect(written).toContain('**Status:** Draft');
    expect(written).toContain('**Date:** 2026-04-21');

    // git add ran with exactly the two paths.
    const gitCall = calls.find((c) => c.cmd === 'git');
    expect(gitCall!.args).toEqual(['add', result.filePath, path.join(tmpDir, 'README.md')]);
  });

  it('creates file on disk with adr heading (space separator)', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'adr'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const exec = (): void => {};

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    const result = scaffoldGovernanceArtifact(
      { type: 'adr', title: 'Database Sharding', cwd: tmpDir },
      { exec, date: '2026-04-21' },
    );

    expect(result.filename).toBe('001-database-sharding.md');
    const written = fs.readFileSync(result.filePath, 'utf-8');
    // ADR-091 heading form with SPACE separator.
    expect(written).toContain('# ADR 001: Database Sharding');
    expect(written).not.toContain('# ADR-001');
  });

  it('sanitizes titles carrying newlines or control characters before templating', async () => {
    // Caught by CodeRabbit on PR #1615. A title with embedded newlines
    // would otherwise inject fresh markdown blocks into the scaffolded
    // artifact. Orchestrator sanitizes at the entry so both filename and
    // template body see the cleaned form.
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const exec = (): void => {};

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    const result = scaffoldGovernanceArtifact(
      {
        type: 'proposal',
        title: 'Fix the thing\n## Injected Fake Heading\n- Not a real list',
        cwd: tmpDir,
      },
      { exec, date: '2026-04-22' },
    );

    const written = fs.readFileSync(result.filePath, 'utf-8');
    // Heading is a single line; no injected newline-bounded blocks.
    const lines = written.split('\n');
    expect(lines[0]).toBe(
      '# Proposal 001: Fix the thing ## Injected Fake Heading - Not a real list',
    );
    // Ensure no fresh `##` heading or `-` list item appears at line-start
    // anywhere in the body above the template's own `## Problem Statement`.
    const bodyLines = lines.slice(
      0,
      lines.findIndex((l) => l === '## Problem Statement'),
    );
    const injectedHeading = bodyLines.find((l, i) => i > 0 && l.startsWith('## '));
    expect(injectedHeading).toBeUndefined();
  });

  it('creates file on disk even when docs:inject is missing', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const origWarn = console.error;
    console.error = () => {};
    try {
      const exec = (cmd: string, args: string[]): void => {
        if (cmd === 'pnpm' && args.includes('docs:inject')) {
          throw new Error('Missing script: "docs:inject"');
        }
      };

      const { scaffoldGovernanceArtifact } = await import('./governance.js');
      const result = scaffoldGovernanceArtifact(
        { type: 'proposal', title: 'Test', cwd: tmpDir },
        { exec, date: '2026-04-21' },
      );

      expect(result.dashboardRefreshed).toBe(false);
      // File must still be on disk despite docs:inject failing.
      expect(fs.existsSync(result.filePath)).toBe(true);
    } finally {
      console.error = origWarn;
    }
  });

  it('respects gap numbering when seeding 001 + 003 (next is 004)', async () => {
    initGit(tmpDir);
    const target = path.join(tmpDir, 'proposals', 'active');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });
    fs.writeFileSync(path.join(target, '001-alpha.md'), '# a\n', 'utf-8');
    fs.writeFileSync(path.join(target, '003-beta.md'), '# b\n', 'utf-8');

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    const result = scaffoldGovernanceArtifact(
      { type: 'proposal', title: 'Gamma', cwd: tmpDir },
      { exec: () => {}, date: '2026-04-21' },
    );

    expect(result.id).toBe('004');
    expect(result.filename).toBe('004-gamma.md');
  });

  it('throws TotemError on exact filename collision without overwriting', async () => {
    initGit(tmpDir);
    const target = path.join(tmpDir, 'proposals', 'active');
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });
    // Seed with the exact filename the scaffolder would generate for this title:
    // id=001 + slug='collide' ⇒ '001-collide.md'. We force this by ALSO seeding a
    // higher-numbered file so getNextArtifactId returns 002, then we seed 002-collide.md
    // so the collision path fires. Simpler: seed 001-keep-slot.md then 002-collide.md
    // and ask for title 'Collide' — next id is 003, no collision. To force one, we
    // patch the target so 001 is empty-of-slug but we put a pre-existing file at
    // the exact next path:
    const existingPath = path.join(target, '001-collide.md');
    fs.writeFileSync(existingPath, 'ORIGINAL CONTENT — DO NOT OVERWRITE\n', 'utf-8');
    // Drop a higher-numbered file so `getNextArtifactId` yields 002, NOT 001.
    // Wait — this test is about EXACT collision. Reset: we want the computed
    // filename to equal an existing file. The way to force that is to mock
    // `getNextArtifactId` — but we don't have DI there. Instead, we seed:
    //   001-collide.md  (existing, will collide)
    // and DELETE other files so next id would also be 001? No — next id is
    // always max+1. So for exact collision we need the slug AND id to match
    // a pre-existing file. Since id is always new, collision only happens if
    // a NNN-slug.md with the same slug as our title already exists at the
    // computed id. That can't happen via getNextArtifactId alone — UNLESS
    // we allow the test to reach in via the `forceId` seam (test-only).
    //
    // Expose an optional `forceId` injection for deterministic collision tests.
    fs.writeFileSync(path.join(target, '002-other.md'), '# other\n', 'utf-8');

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    expect(() =>
      scaffoldGovernanceArtifact(
        { type: 'proposal', title: 'Collide', cwd: tmpDir },
        { exec: () => {}, date: '2026-04-21', forceId: '001' },
      ),
    ).toThrow(/already exists/i);

    // Original content preserved.
    expect(fs.readFileSync(existingPath, 'utf-8')).toBe('ORIGINAL CONTENT — DO NOT OVERWRITE\n');
  });

  it('throws TotemError BEFORE touching disk when title sanitizes to empty', async () => {
    initGit(tmpDir);
    fs.mkdirSync(path.join(tmpDir, 'proposals', 'active'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'templates'), { recursive: true });

    const execCalls: string[] = [];
    const exec = (cmd: string): void => {
      execCalls.push(cmd);
    };

    const { scaffoldGovernanceArtifact } = await import('./governance.js');
    expect(() =>
      scaffoldGovernanceArtifact(
        { type: 'proposal', title: '???', cwd: tmpDir },
        { exec, date: '2026-04-21' },
      ),
    ).toThrow(/empty slug/i);

    // No hooks ran — failure fired before exec seam was reached.
    expect(execCalls).toEqual([]);
    // No files written.
    const entries = fs.readdirSync(path.join(tmpDir, 'proposals', 'active'));
    expect(entries).toEqual([]);
  });
});

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Executed regression cases for tools/release-train-shape.sh — the legs-gate CI
// arm's one exemption (mmnto-ai/totem#2779). The workflow pins the script's
// invocation (tools-hook-parity.test.ts); this file runs the script against a
// throwaway git repository and reads what it writes to $GITHUB_OUTPUT, so the
// rule "exempt only when the diff is exactly the release train's work" is
// proven by execution, case by case, including the bypass Greptile named on
// mmnto-ai/totem#2780: deleting a pending changeset without consuming them all.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = path.join(REPO_ROOT, 'tools', 'release-train-shape.sh');

// A POSIX bash that is not WSL (a WSL bash cannot run against a Windows temp
// path; the ubuntu and macos legs of the matrix run these cases regardless).
function bashUsable(): boolean {
  const probe = spawnSync('bash', ['-c', 'uname -r'], { encoding: 'utf-8', timeout: 5000 });
  if (probe.status !== 0) return false;
  return !/microsoft/i.test(probe.stdout);
}
const BASH_OK = bashUsable();

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(cwd: string, rel: string, content: string): void {
  const abs = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

interface ShapeResult {
  status: number | null;
  exempt: string;
  log: string;
}

/**
 * Run the script with HEAD at `cwd`'s checkout against `base`; read
 * $GITHUB_OUTPUT. The output file lives OUTSIDE the fixture repository, or the
 * next scenario's `git add -A` would commit it and read it as a changed path.
 */
function shape(cwd: string, base: string): ShapeResult {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gh-output-')), 'out');
  fs.writeFileSync(outFile, '', 'utf-8');
  const r = spawnSync('bash', [SCRIPT, base], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GITHUB_OUTPUT: outFile },
  });
  return { status: r.status, exempt: fs.readFileSync(outFile, 'utf-8').trim(), log: r.stdout };
}

describe.skipIf(!BASH_OK)('tools/release-train-shape.sh (mmnto-ai/totem#2779)', () => {
  let repo = '';

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-release-train-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'test@example.invalid');
    git(repo, 'config', 'user.name', 'test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    git(repo, 'config', 'core.autocrlf', 'false');
    // The base: two pending changesets, the README and config beside them, one
    // workspace package with a CHANGELOG, one without (its first release ADDS
    // one), the private root package.json, an owed doctrine file, and a path
    // carrying whitespace.
    write(repo, '.changeset/README.md', 'readme');
    write(repo, '.changeset/config.json', '{}');
    write(repo, '.changeset/a.md', 'a');
    write(repo, '.changeset/b.md', 'b');
    write(repo, 'packages/x/package.json', '{"version":"1.0.0"}');
    write(repo, 'packages/x/CHANGELOG.md', '# x');
    write(repo, 'packages/y/package.json', '{"version":"0.0.0"}');
    write(repo, 'package.json', '{"private":true}');
    write(repo, 'doctrine/d.md', 'd');
    write(repo, 'packages/x/CHANGELOG.md more', 'space');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'branch', 'base');
    // A second base with nothing pending.
    git(repo, 'checkout', '-q', '-b', 'base-empty');
    fs.rmSync(path.join(repo, '.changeset/a.md'));
    fs.rmSync(path.join(repo, '.changeset/b.md'));
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base-empty');
    git(repo, 'checkout', '-q', 'base');
  });

  afterAll(() => {
    if (repo.length > 0) fs.rmSync(repo, { recursive: true, force: true });
  });

  let caseNo = 0;
  /** Branch from `from`, apply `mutate`, commit, and run the script against `from`. */
  function scenario(from: string, mutate: () => void): ShapeResult {
    caseNo += 1;
    git(repo, 'checkout', '-q', '-b', `case-${caseNo}`, from);
    mutate();
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '--allow-empty', '-m', `case ${caseNo}`);
    return shape(repo, from);
  }
  const consumeAll = (): void => {
    fs.rmSync(path.join(repo, '.changeset/a.md'));
    fs.rmSync(path.join(repo, '.changeset/b.md'));
  };
  const renderX = (): void => {
    write(repo, 'packages/x/CHANGELOG.md', '# x\n\n## 1.1.0');
    write(repo, 'packages/x/package.json', '{"version":"1.1.0"}');
  };

  it('the release train: every pending changeset consumed, CHANGELOG and package.json rendered — exempt', () => {
    const r = scenario('base', () => {
      consumeAll();
      renderX();
    });
    expect(r.status).toBe(0);
    expect(r.exempt).toBe('exempt=true');
    expect(r.log).toContain('::notice title=totem legs gate SKIPPED::');
  });

  it("a new package's first release ADDS its CHANGELOG (mmnto-ai/totem#2514) — exempt", () => {
    const r = scenario('base', () => {
      consumeAll();
      write(repo, 'packages/y/CHANGELOG.md', '# y\n\n## 0.1.0');
      write(repo, 'packages/y/package.json', '{"version":"0.1.0"}');
    });
    expect(r.status).toBe(0);
    expect(r.exempt).toBe('exempt=true');
  });

  it('deleting a SUBSET of the pending changesets (the bypass Greptile named) — not exempt', () => {
    const r = scenario('base', () => {
      fs.rmSync(path.join(repo, '.changeset/a.md'));
      renderX();
    });
    expect(r.status).toBe(0);
    expect(r.exempt).toBe('exempt=false');
    expect(r.log).toContain('not exactly the pending set');
  });

  it('deletions only, nothing rendered — not exempt', () => {
    const r = scenario('base', consumeAll);
    expect(r.status).toBe(0);
    expect(r.exempt).toBe('exempt=false');
    expect(r.log).toContain('no CHANGELOG rendered');
  });

  it('deleting .changeset/README.md beside the train — not exempt', () => {
    const r = scenario('base', () => {
      consumeAll();
      renderX();
      fs.rmSync(path.join(repo, '.changeset/README.md'));
    });
    expect(r.exempt).toBe('exempt=false');
  });

  it('the train plus an added owed doctrine file — not exempt', () => {
    const r = scenario('base', () => {
      consumeAll();
      renderX();
      write(repo, 'doctrine/new-rule.md', 'new');
    });
    expect(r.exempt).toBe('exempt=false');
    expect(r.log).toContain('doctrine/new-rule.md');
  });

  it('the train plus the private root package.json — not exempt', () => {
    const r = scenario('base', () => {
      consumeAll();
      renderX();
      write(repo, 'package.json', '{"private":true,"x":1}');
    });
    expect(r.exempt).toBe('exempt=false');
  });

  it('the train plus a path carrying whitespace — not exempt', () => {
    const r = scenario('base', () => {
      consumeAll();
      renderX();
      write(repo, 'packages/x/CHANGELOG.md more', 'changed');
    });
    expect(r.exempt).toBe('exempt=false');
  });

  it('an empty diff while changesets are pending — not exempt', () => {
    const r = scenario('base', () => undefined);
    expect(r.exempt).toBe('exempt=false');
  });

  it('an empty diff with nothing pending — exempt (nothing to judge)', () => {
    const r = scenario('base-empty', () => undefined);
    expect(r.status).toBe(0);
    expect(r.exempt).toBe('exempt=true');
  });

  it('a base ref that does not resolve — the derivation fails, nothing is written (fail-closed)', () => {
    const r = shape(repo, 'no-such-ref');
    expect(r.status).not.toBe(0);
    expect(r.exempt).toBe('');
  });
});

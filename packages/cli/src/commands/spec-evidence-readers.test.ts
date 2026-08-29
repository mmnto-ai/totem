/**
 * The spec-evidence rule (mmnto-ai/totem#2690) has two real readers that
 * cannot share code: the `node -e` script embedded in the managed git
 * pre-commit hook (`buildPreCommitHook`, byte-mirrored into `tools/pre-commit`)
 * and the repo's legacy, unregistered `.gemini/hooks/BeforeTool.js` (a
 * self-contained Gemini hook file that must not import from `packages/`).
 * Nothing structural keeps them in step, so this differential test does:
 * both readers run against the SAME temp checkouts and must agree on every
 * evidence state — and each must reach the verdict the rule names.
 *
 * States: no evidence · a spec run artifact · a `review` artifact that CARRIES
 * a `{caller: "spec"}` object below the top level (the substring hazard) · the
 * legacy marker · a torn artifact beside a valid one. Executed, not string-
 * matched: the hook under `sh`, the Gemini file via a node child whose cwd is
 * the temp repo (it runs `git rev-parse` there).
 */
import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { buildPreCommitHook } from './install-hooks.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const BEFORE_TOOL = path.join(REPO_ROOT, '.gemini', 'hooks', 'BeforeTool.js');

const shellOk =
  spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;
const geminiFileOk = fs.existsSync(BEFORE_TOOL);

type Verdict = 'pass' | 'block';

describe('spec-evidence readers agree — git hook vs .gemini/hooks/BeforeTool.js (mmnto-ai/totem#2690)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-spec-evidence-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    // A real HEAD: BeforeTool.js fails CLOSED when `git rev-parse` cannot
    // resolve the branch (an unborn repo), which is its own documented rule,
    // not an evidence verdict — the fixture must not conflate the two.
    execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', {
      cwd: tmpDir,
      stdio: 'ignore',
    });
    // A feature branch: the hook's protected-branch block and BeforeTool's
    // main/master/hotfix/docs exemption must both stay out of the way.
    execSync('git checkout -q -b feat/evidence', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pre-commit'), buildPreCommitHook('standard'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function hookVerdict(): Verdict {
    const r = spawnSync('sh', ['./pre-commit'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
    });
    return r.status === 0 ? 'pass' : 'block';
  }

  function geminiVerdict(): Verdict {
    // The legacy file exports `beforeTool(toolName, toolInput)` and THROWS on a
    // blocked commit. A node child with cwd = the temp repo exercises the real
    // path (its own `git rev-parse` calls included) without chdir-ing vitest.
    const script = [
      `const hook = require(${JSON.stringify(BEFORE_TOOL)});`,
      `try { hook('run_shell_command', 'git commit -m x'); process.exit(0); }`,
      `catch (err) { process.stderr.write(String(err && err.message)); process.exit(3); }`,
    ].join('\n');
    const r = spawnSync(process.execPath, ['-e', script], { cwd: tmpDir, encoding: 'utf-8' });
    if (r.status === 0) return 'pass';
    // Only the evidence gate's own throw counts as a block. Any other failure
    // (a git error, a require failure, a crash) is a fixture or reader defect
    // and must surface as one, never as a plausible-looking verdict.
    if (r.status === 3 && r.stderr.includes('BLOCKED')) return 'block';
    throw new Error(
      `BeforeTool.js child failed for a non-evidence reason (status ${r.status}): ${r.stderr}`,
    );
  }

  function writeRun(name: string, artifact: Record<string, unknown> | string): void {
    const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, name),
      typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2),
    );
  }

  function expectBoth(expected: Verdict): void {
    const hook = hookVerdict();
    const gemini = geminiVerdict();
    expect({ hook, gemini }).toEqual({ hook: expected, gemini: expected });
  }

  const run = it.skipIf(!shellOk || !geminiFileOk);

  run('no evidence at all → both BLOCK', () => {
    expectBoth('block');
  });

  run('a spec run artifact → both PASS', () => {
    writeRun('spec.json', {
      admission: { runMetadata: { caller: 'spec' } },
      createdAt: new Date().toISOString(),
    });
    expectBoth('pass');
  });

  run('a review artifact carrying a caller:spec OBJECT below the top level → both BLOCK', () => {
    writeRun('review.json', {
      admission: { runMetadata: { caller: 'review' } },
      inputBundle: { runMetadata: { caller: 'spec' } },
      createdAt: new Date().toISOString(),
    });
    // Mutation check on the control: the substring form WOULD match this file.
    const bytes = fs.readFileSync(path.join(tmpDir, '.totem/artifacts/runs/review.json'), 'utf-8');
    expect(/"caller": *"spec"/.test(bytes)).toBe(true);
    expectBoth('block');
  });

  run('the legacy marker alone → both PASS', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.totem', 'cache', '.spec-completed'), '');
    expectBoth('pass');
  });

  run('a torn artifact beside a valid one → both PASS; torn alone → both BLOCK', () => {
    writeRun('torn.json', '{"admission": {"runMetadata": {"caller": "spec"');
    expectBoth('block');
    writeRun('ok.json', {
      admission: { runMetadata: { caller: 'spec' } },
      createdAt: new Date().toISOString(),
    });
    expectBoth('pass');
  });

  it('the Gemini file is present and still unregistered (the inert-until-armed disclosure holds)', () => {
    // If a future slice registers BeforeTool in .gemini/settings.json, this
    // test's premise changes: the reader becomes live and the disclosure in
    // the file header must be updated with it.
    if (!geminiFileOk) return;
    const settingsPath = path.join(REPO_ROOT, '.gemini', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as {
      hooks?: Record<string, unknown>;
    };
    expect(Object.keys(settings.hooks ?? {})).not.toContain('BeforeTool');
    expect(fs.readFileSync(BEFORE_TOOL, 'utf-8')).toContain('not');
  });
});

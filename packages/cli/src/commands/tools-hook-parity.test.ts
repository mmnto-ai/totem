import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  getFallbackCommand,
} from './install-hooks.js';

// Bind the repo-local `tools/{pre-commit,pre-push,post-merge}` hook scripts — which
// `package.json`'s `prepare` (`node tools/install-hooks.js`) copies into `.git/hooks`
// on every install — to the CLI template builders that `totem hook install --force`
// uses. If a template changes without regenerating tools/, the copied scripts silently
// re-drift from the CLI-canonical hooks and stomp them on the next `pnpm install`
// (mmnto-ai/totem#2404). A failure here means tools/ must be regenerated in lockstep
// (byte-for-byte) with the builders before merging the template change.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOOLS_DIR = path.join(REPO_ROOT, 'tools');

// This repo pins no `hooks.tier` in totem.config.ts, so the installer's effective tier
// is the default 'standard'. The fallback command derives from the repo's lockfile
// exactly as the installer and doctor do (getFallbackCommand).
const TIER = 'standard' as const;
// This repo pins no `totemDir` either, so the installer's effective directory is the
// schema default `.totem` — the value mmnto-ai/totem#2692 C3 pins these bytes at.
const TOTEM_DIR = '.totem';
const FALLBACK_CMD = getFallbackCommand(REPO_ROOT);
const RENDER = { tier: TIER, totemDir: TOTEM_DIR, fallbackCmd: FALLBACK_CMD };

function readTool(hook: string): string {
  return fs.readFileSync(path.join(TOOLS_DIR, hook), 'utf-8');
}

function readLintWorkflow(): string {
  return fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'lint.yml'), 'utf-8');
}

/**
 * The legs-gate step's YAML, from its `- name:` to the next step's, comment
 * lines dropped: the NEXT step's leading comment sits inside the slice and
 * legitimately discusses `continue-on-error`; only YAML keys count. (The
 * newline is built, never authored as an escape — the banked heredoc decode
 * trap.) Empty when the workflow carries no gate step at all.
 */
function gateStepOf(workflow: string): string {
  const gateIdx = workflow.indexOf('node packages/cli/dist/index.js legs gate');
  if (gateIdx === -1) return '';
  const stepStart = workflow.lastIndexOf('- name:', gateIdx);
  const nextStep = workflow.indexOf('- name:', gateIdx);
  return dropComments(workflow.slice(stepStart, nextStep === -1 ? workflow.length : nextStep));
}

/**
 * The `lint` job's header — from its key to its `steps:` — comment lines
 * dropped, so an assertion on the job-level env predicate reads YAML keys and
 * never a `#` decoy carrying the same text (the leg's F3 on
 * mmnto-ai/totem#2780). Empty when the job or its steps key is missing.
 */
function lintJobHeaderOf(workflow: string): string {
  const LF = String.fromCharCode(10);
  const jobIdx = workflow.indexOf(LF + '  lint:' + LF);
  if (jobIdx === -1) return '';
  const stepsIdx = workflow.indexOf(LF + '    steps:', jobIdx);
  if (stepsIdx === -1) return '';
  return dropComments(workflow.slice(jobIdx, stepsIdx));
}

function dropComments(yaml: string): string {
  const LF = String.fromCharCode(10);
  return yaml
    .split(LF)
    .filter((line) => !line.trim().startsWith('#'))
    .join(LF);
}

describe('tools/ hook scripts match the CLI template builders (mmnto-ai/totem#2404)', () => {
  it('resolves the pnpm-based fallback command for this repo', () => {
    expect(FALLBACK_CMD).toBe('pnpm dlx @mmnto/cli');
  });

  it('tools/pre-commit is byte-identical to buildPreCommitHook output', () => {
    expect(readTool('pre-commit')).toBe(buildPreCommitHook(RENDER));
  });

  it('tools/pre-push is byte-identical to buildPrePushHook output', () => {
    expect(readTool('pre-push')).toBe(buildPrePushHook(RENDER));
  });

  it('tools/post-merge is byte-identical to buildHookContent output', () => {
    expect(readTool('post-merge')).toBe(buildHookContent(RENDER));
  });
});

// The repo's own legs-gate CI arm (mmnto-ai/totem#2771; the `legs-gate` parity
// row, arm (a)). Two things the arm depends on that nothing else asserts: the
// artifacts ignore must RE-INCLUDE the deposit directory, or every deposit is
// unstageable and the required `Totem Lint` check goes permanently red; and
// the workflow step must invoke the BUILT entry before the lint step's
// `--depth=1` fetch, which shallows the checkout. Both are read from the repo's
// files, so an edit that narrows the ignore or moves the step fails here first.
describe("the repo's own legs-gate CI arm posture (mmnto-ai/totem#2771)", () => {
  const gitOk = spawnSync('git', ['--version'], { encoding: 'utf-8' }).status === 0;
  const checkIgnore = (relPath: string): number | null =>
    spawnSync('git', ['check-ignore', '-q', relPath], { cwd: REPO_ROOT, encoding: 'utf-8' }).status;

  it.skipIf(!gitOk)(
    '.gitignore re-includes .totem/artifacts/legs/ and keeps its siblings ignored',
    () => {
      // check-ignore: 0 = ignored, 1 = not ignored. A deposit path must be stageable.
      expect(checkIgnore('.totem/artifacts/legs/' + 'a'.repeat(40) + '.json')).toBe(1);
      expect(checkIgnore('.totem/artifacts/runs/x.json')).toBe(0);
      expect(checkIgnore('.totem/artifacts/panels/x.json')).toBe(0);
      expect(checkIgnore('.totem/artifacts/verdicts/x.json')).toBe(0);
    },
  );

  it("this repo's config never softens the CI arm: hooks.legsOwed.enforce is not 'advisory' here", () => {
    // The gate reads the knob in CI too, so `enforce: 'advisory'` would turn the
    // hard step into a green no-op while the row's presence checks still read
    // arm (a) as adopted (the leg's F5; Greptile on mmnto-ai/totem#2772). A repo
    // adopting the CI arm leaves the knob unset or sets 'block'; this pins ours.
    const config = fs.readFileSync(path.join(REPO_ROOT, 'totem.config.ts'), 'utf-8');
    expect(config).not.toMatch(/enforce\s*:\s*['"]advisory['"]/);
  });

  it('the lint workflow runs the built gate as a hard step before the --depth=1 fetch', () => {
    const workflow = readLintWorkflow();
    const gateIdx = workflow.indexOf('node packages/cli/dist/index.js legs gate');
    // The fetch COMMAND, not the flag: the gate step's own comment names
    // `--depth=1` while explaining why it runs first.
    const shallowIdx = workflow.indexOf('git fetch origin "$BASE_REF" --depth=1');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(shallowIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(shallowIdx);
    // The bin-shim form cannot resolve in a job that builds the CLI it calls.
    expect(workflow).not.toContain('pnpm exec totem legs gate');
    // The WHOLE step, from its name to the next step's: the base fetch precedes
    // the gate inside it, and no continue-on-error sits anywhere in it — a
    // trailing one after `run:` would soften the step just as well.
    const step = gateStepOf(workflow);
    const baseFetchIdx = step.indexOf('git fetch origin "$BASE_REF"');
    expect(baseFetchIdx).toBeGreaterThan(-1);
    expect(baseFetchIdx).toBeLessThan(step.indexOf('node packages/cli/dist/index.js legs gate'));
    expect(step).not.toContain('--depth=1');
    expect(step).not.toContain('continue-on-error');
    // The run block is EXACTLY the base fetch and the bare gate: a `|| true`, a
    // `;` or a trailing `&&` on the gate line would neuter it while every
    // assertion above still passes (the leg's F7 on mmnto-ai/totem#2780).
    const LF = String.fromCharCode(10);
    const runIdx = step.indexOf('run: |');
    expect(runIdx).toBeGreaterThan(-1);
    const runLines = step
      .slice(runIdx + 'run: |'.length)
      .split(LF)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(runLines).toEqual([
      'git fetch origin "$BASE_REF"',
      'node packages/cli/dist/index.js legs gate',
    ]);
  });

  it('the gate step is skipped ONLY for the release train — exact branch name AND same repository — and the skip is announced (mmnto-ai/totem#2779)', () => {
    const workflow = readLintWorkflow();
    // The predicate is defined ONCE, at job level, and the assertion reads the
    // job header with comments dropped — a `#` decoy carrying the same text
    // must not satisfy it. Both halves are load-bearing: the exact name (a
    // prefix test is widenable by any author; GitHub's `==` and `startsWith`
    // are both case-insensitive, so case is not the distinction) and the same
    // repository (a fork's `head_ref` is the bare branch name).
    const header = lintJobHeaderOf(workflow);
    expect(header).not.toBe('');
    expect(header).toContain(
      "LEGS_GATE_RELEASE_TRAIN: ${{ github.event.pull_request.head.repo.full_name == github.repository && github.head_ref == 'changeset-release/main' }}",
    );
    const step = gateStepOf(workflow);
    expect(step).not.toBe('');
    const LF = String.fromCharCode(10);
    const ifLines = step.split(LF).filter((line) => line.trim().startsWith('if:'));
    // Exactly one `if:` on the gate step, and it is the predicate's negation.
    // Any other condition — a prefix match, `if: false`, a value the PR author
    // controls — softens the floor while `Totem Lint` stays green, which the
    // `continue-on-error` assertion above cannot see.
    expect(ifLines.map((line) => line.trim())).toEqual([
      "if: ${{ env.LEGS_GATE_RELEASE_TRAIN != 'true' }}",
    ]);
    expect(step).not.toContain('startsWith(');
    // Never-skip-silently: a notice step gated on the SAME predicate precedes
    // the gate, so a green job on the release train says why the floor did not
    // run.
    const noticeIdx = workflow.indexOf('- name: release-train notice');
    expect(noticeIdx).toBeGreaterThan(-1);
    expect(noticeIdx).toBeLessThan(workflow.indexOf('node packages/cli/dist/index.js legs gate'));
    expect(workflow).toContain("if: ${{ env.LEGS_GATE_RELEASE_TRAIN == 'true' }}");
    expect(workflow).toContain('::notice title=totem legs gate SKIPPED::');
  });
});

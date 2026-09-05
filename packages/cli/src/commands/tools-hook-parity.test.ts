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

// Named once: the newline is BUILT, never authored as an escape (the banked
// heredoc decode trap), and `indexOf`'s -1 reads as a sentinel only by
// convention (CodeRabbit on mmnto-ai/totem#2780).
const LF = String.fromCharCode(10);
const NOT_FOUND = -1;
const GATE_STEP_NAME = 'totem legs gate (HARD';
const RELEASE_TRAIN_STEP_NAME = 'release-train check';

function readLintWorkflow(): string {
  return fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'lint.yml'), 'utf-8');
}

/**
 * ONE step's YAML — from the `- name:` line whose name starts with `namePrefix`
 * to the next step's `- name:` — comment lines dropped: the NEXT step's leading
 * comment sits inside the slice and legitimately discusses `continue-on-error`;
 * only YAML keys count. Empty when no step carries that name. Every assertion
 * on a step's own `if:` / `id:` / `run:` reads its slice, never the whole
 * workflow, so a decoy elsewhere cannot satisfy it (Greptile P2 and CodeRabbit
 * on mmnto-ai/totem#2780).
 */
function stepNamed(workflow: string, namePrefix: string): string {
  // Comments go FIRST, so a `#` line carrying `- name: …` earlier in the file
  // cannot anchor the slice (the leg's F7 on mmnto-ai/totem#2780).
  const clean = dropComments(workflow);
  const stepStart = clean.indexOf('- name: ' + namePrefix);
  if (stepStart === NOT_FOUND) return '';
  const nextStep = clean.indexOf('- name:', stepStart + 1);
  return clean.slice(stepStart, nextStep === NOT_FOUND ? clean.length : nextStep);
}

/** The non-empty, trimmed lines of a step's `run: |` block, in order. */
function runLinesOf(step: string): string[] {
  const runIdx = step.indexOf('run: |');
  if (runIdx === NOT_FOUND) return [];
  return step
    .slice(runIdx + 'run: |'.length)
    .split(LF)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function gateStepOf(workflow: string): string {
  return stepNamed(workflow, GATE_STEP_NAME);
}

/** The `if:` lines of one step slice, trimmed — exactly one is the contract. */
function ifLinesOf(step: string): string[] {
  return step
    .split(LF)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('if:'));
}

/**
 * The `lint` job's header — from its key to its `steps:` — comment lines
 * dropped, so an assertion on the job-level env predicate reads YAML keys and
 * never a `#` decoy carrying the same text (the leg's F3 on
 * mmnto-ai/totem#2780). Empty when the job or its steps key is missing.
 */
function lintJobHeaderOf(workflow: string): string {
  const clean = dropComments(workflow);
  const jobIdx = clean.indexOf(LF + '  lint:' + LF);
  if (jobIdx === NOT_FOUND) return '';
  const stepsIdx = clean.indexOf(LF + '    steps:', jobIdx);
  if (stepsIdx === NOT_FOUND) return '';
  return clean.slice(jobIdx, stepsIdx);
}

function dropComments(yaml: string): string {
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
    expect(gateIdx).toBeGreaterThan(NOT_FOUND);
    expect(shallowIdx).toBeGreaterThan(NOT_FOUND);
    expect(gateIdx).toBeLessThan(shallowIdx);
    // The bin-shim form cannot resolve in a job that builds the CLI it calls.
    expect(workflow).not.toContain('pnpm exec totem legs gate');
    // The WHOLE step, from its name to the next step's: the base fetch precedes
    // the gate inside it, and no continue-on-error sits anywhere in it — a
    // trailing one after `run:` would soften the step just as well.
    const step = gateStepOf(workflow);
    const baseFetchIdx = step.indexOf('git fetch origin "$BASE_REF"');
    expect(baseFetchIdx).toBeGreaterThan(NOT_FOUND);
    expect(baseFetchIdx).toBeLessThan(step.indexOf('node packages/cli/dist/index.js legs gate'));
    expect(step).not.toContain('--depth=1');
    expect(step).not.toContain('continue-on-error');
    // The run block is EXACTLY the base fetch and the bare gate: a `|| true`, a
    // `;` or a trailing `&&` on the gate line would neuter it while every
    // assertion above still passes (the leg's F7 on mmnto-ai/totem#2780).
    expect(runLinesOf(step)).toEqual([
      'git fetch origin "$BASE_REF"',
      'node packages/cli/dist/index.js legs gate',
    ]);
  });

  it('the gate step is skipped ONLY for the release train — exact branch name AND same repository AND the release-train diff shape — and either outcome is announced (mmnto-ai/totem#2779)', () => {
    const workflow = readLintWorkflow();
    // The branch SELECTOR is defined ONCE, at job level, and the assertion reads
    // the job header with comments dropped — a `#` decoy carrying the same text
    // must not satisfy it. Both halves are load-bearing: the exact name (a
    // prefix test is widenable by any author; GitHub's `==` and `startsWith`
    // are both case-insensitive, so case is not the distinction) and the same
    // repository (a fork's `head_ref` is the bare branch name).
    const header = lintJobHeaderOf(workflow);
    expect(header).not.toBe('');
    expect(header).toContain(
      "LEGS_GATE_RELEASE_TRAIN: ${{ github.event.pull_request.head.repo.full_name == github.repository && github.head_ref == 'changeset-release/main' }}",
    );
    // The selector only picks the branch. The check step, gated on it, derives
    // the diff's SHAPE and exempts only what the action writes — a deleted
    // .changeset/*.md (never its README), an added or modified CHANGELOG.md (a
    // new package's first release ADDS one: mmnto-ai/totem#2514), a modified
    // package.json — so a writer who pushes anything else onto the release
    // branch meets the gate (Greptile's P1 on mmnto-ai/totem#2780). Every
    // assertion reads the check step's own slice, and the run block is pinned
    // EXACTLY, in order: which branch writes `exempt=true` is the mechanism
    // (swapping the branches passed a looser test — the leg's F3), `set -euo
    // pipefail` under `shell: bash` is what makes a failed diff abort instead
    // of reading as an empty, in-shape list (F2), and the whole-line anchors
    // are what keep a whitespace-carrying path out of shape (F4).
    const check = stepNamed(workflow, RELEASE_TRAIN_STEP_NAME);
    expect(check).not.toBe('');
    expect(check).toContain('id: release_train');
    expect(check).toContain('shell: bash');
    expect(ifLinesOf(check)).toEqual(["if: ${{ env.LEGS_GATE_RELEASE_TRAIN == 'true' }}"]);
    expect(runLinesOf(check)).toEqual([
      'set -euo pipefail',
      'git fetch origin "$BASE_REF"',
      'diff=$(git diff --name-status "origin/$BASE_REF...HEAD")',
      `other=$(echo "$diff" | grep -v -E '^D[[:space:]]+[.]changeset/[^/]+[.]md$|^[AM][[:space:]]+([^[:space:]]*/)?CHANGELOG[.]md$|^M[[:space:]]+([^[:space:]]*/)?package[.]json$' || true)`,
      `if echo "$diff" | grep -q -E '^D[[:space:]]+[.]changeset/README[.]md$'; then other="$other D .changeset/README.md"; fi`,
      `other=$(echo "$other" | grep -v -E '^[[:space:]]*$' | paste -sd ' ' - || true)`,
      'if [ -n "$other" ]; then',
      'echo "::warning title=totem legs gate NOT skipped::changeset-release/main carries paths outside the release-train shape, so the review-leg floor applies (mmnto-ai/totem#2779): $other"',
      'echo "exempt=false" >> "$GITHUB_OUTPUT"',
      'else',
      'echo "::notice title=totem legs gate SKIPPED::changeset-release/main is the release train — its diff is only consumed changesets, CHANGELOG.md and package.json, and it authors nothing, so the review-leg floor does not apply (mmnto-ai/totem#2779). The totem lint step still runs."',
      'echo "exempt=true" >> "$GITHUB_OUTPUT"',
      'fi',
    ]);
    expect(check).not.toContain('continue-on-error');
    // The gate reads the check's OUTPUT, and exactly that: a skipped check
    // writes no output and '' != 'true' runs the gate — fail-closed. Any other
    // condition — a prefix match, `if: false`, a value the PR author controls —
    // softens the floor while `Totem Lint` stays green, which the
    // `continue-on-error` assertion above cannot see.
    const step = gateStepOf(workflow);
    expect(step).not.toBe('');
    expect(ifLinesOf(step)).toEqual(["if: ${{ steps.release_train.outputs.exempt != 'true' }}"]);
    expect(step).not.toContain('startsWith(');
    // The check precedes the gate — an output read before it is written is ''.
    const checkIdx = workflow.indexOf('- name: ' + RELEASE_TRAIN_STEP_NAME);
    expect(checkIdx).toBeGreaterThan(NOT_FOUND);
    expect(checkIdx).toBeLessThan(workflow.indexOf('- name: ' + GATE_STEP_NAME));
  });
});

import { execFileSync, execSync, spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GROUNDING_ANCHOR_FREE_TEXT,
  GROUNDING_ANCHOR_ISSUE,
  GROUNDING_ANCHOR_MIXED,
  GROUNDING_ANCHOR_RECORD,
  PROMPT_SOURCE_BUILTIN,
  PROMPT_SOURCE_OVERRIDE,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RunArtifactSchema,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildHookContent,
  buildPostCheckoutHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  buildResolveBlock,
  checkHooksInstalled,
  detectTotemPrefix,
  generateHookHelpers,
  getFallbackCommand,
  installGitHook,
  installHooksNonInteractive,
  TOTEM_HOOK_END,
  TOTEM_HOOK_MARKER,
  TOTEM_PRECOMMIT_END,
  TOTEM_PRECOMMIT_MARKER,
  TOTEM_PREPUSH_END,
  TOTEM_PREPUSH_MARKER,
  upgradePrePushHookIfNeeded,
} from './install-hooks.js';
import { SPEC_REQUIRED_SECTIONS, SPEC_SYSTEM_PROMPT } from './spec-templates.js';

// The default render options every pre-#2692 positional call implied
// (mmnto-ai/totem#2692 C2 — the builders take a REQUIRED options object now, so
// each site states the tier/totemDir/fallbackCmd it always assumed). Spread and
// override the one field a case actually varies.
const RENDER = {
  tier: 'standard' as const,
  totemDir: '.totem',
  fallbackCmd: 'pnpm dlx @mmnto/cli',
};

// ─── Anchored-evidence fixtures (mmnto-ai/totem#2700) ───
//
// Since #2700 an artifact is evidence only when it is ANCHORED and its SUBJECT
// carries a shape. These build the smallest artifact that satisfies each arm,
// so a test that means to exercise something else (age, newest-wins, torn
// files) does not accidentally exercise the shape check.

/** A draft that satisfies the TEMPLATE shape: every required heading with a body. */
const TEMPLATE_DRAFT = SPEC_REQUIRED_SECTIONS.map(
  (heading) => `${heading}\n\nA non-blank body under ${heading}.\n`,
).join('\n');

/** A draft that satisfies only the looser DOCUMENT shape — one heading with a body. */
const DOCUMENT_DRAFT = '## A hand-shaped section\n\nA body under it.\n';

/** The minimal ISSUE-anchored, template-shaped run artifact the gate accepts. */
function specEvidenceArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    admission: { runMetadata: { caller: 'spec', promptSource: PROMPT_SOURCE_BUILTIN } },
    grounding: { anchor: { kind: GROUNDING_ANCHOR_ISSUE, ref: '#2700' } },
    output: { content: TEMPLATE_DRAFT },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * The fixture wrapped in the fields every run artifact must carry and the
 * reader never touches — so the whole thing can be parsed by the REAL schema.
 */
function asRunArtifact(fixture: Record<string, unknown>): Record<string, unknown> {
  const grounding = fixture['grounding'] as Record<string, unknown>;
  const output = fixture['output'] as Record<string, unknown>;
  return {
    ...fixture,
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'the masked prompt' },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only:1', ...grounding },
    backend: {
      provider: 'gemini',
      model: 'gemini-3-flash-preview',
      qualifiedModel: 'gemini:gemini-3-flash-preview',
      admissionClass: 'completion_only',
      taskProfile: 'Spec',
    },
    output: { metrics: { durationMs: 500 }, ...output },
  };
}

// The hook's reader is a rendered `node -e` string: it walks the artifact by
// HAND-SPELLED paths (`grounding.anchor`, `admission.runMetadata.promptSource`,
// `output.content`) that no type checker sees. These tests bind the PASS
// fixtures those paths are exercised against to the real core schema, so a
// rename or a shape change on the writer's side breaks a test here rather than
// silently leaving the hook reading a field that no longer exists.
describe('the anchored-evidence fixtures parse as real run artifacts (mmnto-ai/totem#2700)', () => {
  it('the issue-anchored PASS fixture round-trips through RunArtifactSchema with its three read paths intact', () => {
    const parsed = RunArtifactSchema.parse(asRunArtifact(specEvidenceArtifact()));
    expect(parsed.grounding.anchor).toEqual({ kind: GROUNDING_ANCHOR_ISSUE, ref: '#2700' });
    expect(parsed.admission?.runMetadata?.promptSource).toBe(PROMPT_SOURCE_BUILTIN);
    expect(parsed.output.content).toBe(TEMPLATE_DRAFT);
  });

  it('the record-anchored PASS fixture round-trips, sha256 and all', () => {
    const sha256 = 'a'.repeat(64);
    const parsed = RunArtifactSchema.parse(
      asRunArtifact(
        specEvidenceArtifact({
          grounding: {
            anchor: { kind: GROUNDING_ANCHOR_RECORD, ref: '.totem/specs/2700.md', sha256 },
          },
        }),
      ),
    );
    expect(parsed.grounding.anchor).toEqual({
      kind: GROUNDING_ANCHOR_RECORD,
      ref: '.totem/specs/2700.md',
      sha256,
    });
  });

  it('the override-prompt PASS fixture round-trips with promptSource "override"', () => {
    const parsed = RunArtifactSchema.parse(
      asRunArtifact(
        specEvidenceArtifact({
          admission: { runMetadata: { caller: 'spec', promptSource: PROMPT_SOURCE_OVERRIDE } },
          output: { content: DOCUMENT_DRAFT },
        }),
      ),
    );
    expect(parsed.admission?.runMetadata?.promptSource).toBe(PROMPT_SOURCE_OVERRIDE);
    expect(parsed.output.content).toBe(DOCUMENT_DRAFT);
  });
});

describe('detectTotemPrefix', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-detect-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pnpm exec when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('pnpm exec totem');
  });

  it('returns yarn when yarn.lock exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('yarn totem');
  });

  it('returns bunx when bun.lockb exists (legacy)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('bunx totem');
  });

  it('returns bunx when bun.lock exists (Bun >= 1.2)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('bunx totem');
  });

  it('falls back to npx when no lockfile exists', () => {
    expect(detectTotemPrefix(tmpDir)).toBe('npx totem');
  });

  it('prefers pnpm over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('pnpm exec totem');
  });

  it('prefers yarn over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(detectTotemPrefix(tmpDir)).toBe('yarn totem');
  });
});

describe('getFallbackCommand', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-fallback-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns pnpm dlx when pnpm-lock.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    expect(getFallbackCommand(tmpDir)).toBe('pnpm dlx @mmnto/cli');
  });

  it('returns yarn dlx when yarn.lock exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('yarn dlx @mmnto/cli');
  });

  it('returns bunx when bun.lockb exists (legacy)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(getFallbackCommand(tmpDir)).toBe('bunx @mmnto/cli');
  });

  it('returns bunx when bun.lock exists (Bun >= 1.2)', () => {
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('bunx @mmnto/cli');
  });

  it('returns npx when only package.json exists (no lockfile)', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(getFallbackCommand(tmpDir)).toBe('npx @mmnto/cli');
  });

  it('returns bare totem when no lockfile and no package.json exist', () => {
    expect(getFallbackCommand(tmpDir)).toBe('totem');
  });

  it('prefers pnpm over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lock'), '');
    expect(getFallbackCommand(tmpDir)).toBe('pnpm dlx @mmnto/cli');
  });

  it('prefers yarn over bun when both lockfiles exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    expect(getFallbackCommand(tmpDir)).toBe('yarn dlx @mmnto/cli');
  });
});

describe('buildResolveBlock', () => {
  it('uses command -v (not which) to check for totem', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('command -v totem');
    expect(block).not.toContain('which');
  });

  it('sets TOTEM_CMD to totem when found on PATH', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD="totem"');
  });

  it('falls back to provided command when package.json exists', () => {
    const block = buildResolveBlock('yarn dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD="yarn dlx @mmnto/cli"');
  });

  it('sets TOTEM_CMD="" when unavailable — never exits early or blocks chained hooks', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('TOTEM_CMD=""');
    expect(block).not.toContain('exit 0');
    expect(block).not.toContain('exit 1');
  });

  it('prints a warning to stderr when totem is not found', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('>&2');
    expect(block).toContain('[Totem]');
  });

  it('checks for package.json before falling back', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('[ -f package.json ]');
  });

  it('prefers pnpm exec totem in workspace before dlx fallback', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    expect(block).toContain('pnpm-workspace.yaml');
    expect(block).toContain('TOTEM_CMD="pnpm exec totem"');
    const workspaceIdx = block.indexOf('pnpm-workspace.yaml');
    const dlxIdx = block.indexOf('pnpm dlx @mmnto/cli');
    expect(workspaceIdx).toBeLessThan(dlxIdx);
  });

  it('prioritizes workspace HEAD over local and global binaries in resolve block (mmnto-ai/totem#2053)', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    const workspaceHead = block.indexOf('node packages/cli/dist/index.js');
    const localBin = block.indexOf('node_modules/@mmnto/cli/dist/index.js');
    const pnpmExec = block.indexOf('pnpm exec totem');
    const pathGlobal = block.indexOf('command -v totem');
    const fallback = block.indexOf('pnpm dlx @mmnto/cli');
    // Every tier is present.
    for (const idx of [workspaceHead, localBin, pnpmExec, pathGlobal, fallback]) {
      expect(idx).toBeGreaterThan(-1);
    }
    // Strict precedence: pinned / in-tree beats the volatile ambient PATH global (Tenet 14).
    expect(workspaceHead).toBeLessThan(localBin);
    expect(localBin).toBeLessThan(pnpmExec);
    expect(pnpmExec).toBeLessThan(pathGlobal);
    expect(pathGlobal).toBeLessThan(fallback);
  });

  it('identity-guards every pinned tier on @mmnto/cli, never a bare totem bin name (mmnto-ai/totem#2053)', () => {
    const block = buildResolveBlock('pnpm dlx @mmnto/cli');
    // Tier-1 requires BOTH the built dist and the @mmnto/cli package name (no consumer false-match).
    expect(block).toContain('packages/cli/dist/index.js');
    expect(block).toContain('"name": *"@mmnto/cli"');
    // Tier-2 points at @mmnto/cli's own entry (identity-guaranteed), not the bare `.bin/totem`
    // shim — which a colliding package could shadow, and which carries a Windows -x/-f quirk.
    expect(block).toContain('[ -f node_modules/@mmnto/cli/dist/index.js ]');
    expect(block).not.toContain('node_modules/.bin/totem');
  });
});

describe('buildPreCommitHook', () => {
  it('contains the marker for idempotency', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('blocks main and master branches', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('"main"');
    expect(hook).toContain('"master"');
  });

  it('prints a helpful error message with override instructions', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('git checkout -b feat/my-feature');
    expect(hook).toContain('git commit --no-verify');
  });

  it('starts with a shebang', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('exits with code 1 when on protected branch', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('exit 1');
  });
});

describe('buildPrePushHook', () => {
  it('contains the marker for idempotency', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('starts with a shebang', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('does not advertise --no-verify escape hatch', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).not.toContain('--no-verify');
  });

  it('contains verify-manifest check', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('verify-manifest');
    expect(hook).toContain('compile manifest is stale');
  });

  it('contains $TOTEM_CMD lint', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('$TOTEM_CMD lint');
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('contains $TOTEM_CMD verify-badges (mmnto-ai/totem#1926)', () => {
    const hook = buildPrePushHook(RENDER);
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD verify-badges');
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('gates verify-badges on README.md existing', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toMatch(/-f "README\.md".*verify-badges/s);
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('contains $TOTEM_CMD verify-lockfile-sync (mmnto-ai/totem#1961)', () => {
    const hook = buildPrePushHook(RENDER);
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD verify-lockfile-sync');
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('gates verify-lockfile-sync on pnpm-lock.yaml existing', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toMatch(/-f "pnpm-lock\.yaml".*verify-lockfile-sync/s);
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('slots verify-lockfile-sync before claim-discipline in the pre-push sequence', () => {
    const hook = buildPrePushHook(RENDER);
    // Assert presence with toContain (precise matcher); index comparison is
    // safe only because both substrings are guaranteed present by the
    // toContain assertions above.
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD verify-lockfile-sync');
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD doctor --claim-discipline');
    const lockfileIdx = hook.indexOf('$TOTEM_CMD verify-lockfile-sync');
    const claimDisciplineIdx = hook.indexOf('$TOTEM_CMD doctor --claim-discipline');
    expect(lockfileIdx).toBeLessThan(claimDisciplineIdx);
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('contains $TOTEM_CMD doctor --claim-discipline --strict (Proposal 279 Q3)', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('$TOTEM_CMD doctor --claim-discipline --strict');
  });

  // totem-context: hook-content assertion (mmnto-ai/totem#2002 — diff-scope narrowing)
  it('contains --scope-to-diff on the claim-discipline invocation (mmnto-ai/totem#2002)', () => {
    const hook = buildPrePushHook(RENDER);
    // The flag must appear on the same `doctor --claim-discipline` line so the
    // hook narrows the WWND scan to diff-touched files. Standing-gate full scan
    // produced N=8 false-positive bypasses in <24hr on a pre-existing surface
    // warning at docs/wiki/governing-ai-agents.md before this change landed.
    expect(hook).toContain('$TOTEM_CMD doctor --claim-discipline --strict --scope-to-diff');
  });

  // totem-context: hook-content assertion (mmnto-ai/totem#2002 — bootstrap defensive degrade)
  it('defensively degrades --scope-to-diff when CLI predates 1.47.0 (cohort bootstrap safety)', () => {
    const hook = buildPrePushHook(RENDER);
    // The hook MUST detect --scope-to-diff support via --help and fall back to
    // standing-scan when the resolved CLI doesn't carry the flag. Required so a
    // cohort agent whose global @mmnto/cli predates 1.47.0 doesn't fail commander
    // option-parse on every push during the publish-and-update window.
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD doctor --claim-discipline --help');
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain("grep -q -- '--scope-to-diff'");
    // Fallback branch must invoke the standing scan (no flag) so the gate still
    // fires on older CLIs — the protection envelope is preserved, just at the
    // pre-#2002 false-positive cost. The trailing `;` (vs ` --scope-to-diff;`)
    // distinguishes this fallback invocation from the flagged-path invocation.
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('$TOTEM_CMD doctor --claim-discipline --strict;');
    // User-visible hint nudges contributors to upgrade for the full defense.
    // totem-context: substring match on hook script content (not secret masking) — toContain is correct here
    expect(hook).toContain('compat mode (CLI <1.47.0)');
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('gates claim-discipline on at-least-one in-scope public surface existing', () => {
    const hook = buildPrePushHook(RENDER);
    // The gate fires when any of README.md, AGENTS.md, design-tenets.md, or docs/wiki/ exists
    expect(hook).toMatch(
      /-f "README\.md".*-f "AGENTS\.md".*-f "design-tenets\.md".*-d "docs\/wiki"/s,
    );
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('slots claim-discipline after verify-badges in the pre-push sequence', () => {
    const hook = buildPrePushHook(RENDER);
    const verifyBadgesIdx = hook.indexOf('$TOTEM_CMD verify-badges');
    const claimDisciplineIdx = hook.indexOf('$TOTEM_CMD doctor --claim-discipline');
    expect(verifyBadgesIdx).toBeGreaterThan(-1);
    expect(claimDisciplineIdx).toBeGreaterThan(-1);
    expect(claimDisciplineIdx).toBeGreaterThan(verifyBadgesIdx);
  });

  // totem-context: hook-content assertion (not an orchestrator test, no LLM calls — default vitest timeout is sufficient)
  it('mentions TOTEM_GATE_BYPASS_JUSTIFICATION as the bypass mechanism (Proposal 279 Q3 standardized convention)', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('TOTEM_GATE_BYPASS_JUSTIFICATION');
  });

  it('does NOT contain old flag-file references', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).not.toContain('.lint-passed');
    expect(hook).not.toContain('.shield-passed');
    expect(hook).not.toContain('.target-globs');
  });

  it('does NOT contain merge-base (no ancestry checks)', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).not.toContain('merge-base');
  });

  it('uses the resolve block', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('TOTEM_CMD=');
    expect(hook).toContain('command -v totem');
  });

  it('uses POSIX-compatible syntax only', () => {
    const hook = buildPrePushHook(RENDER);
    // Must use [ ] not [[ ]]
    expect(hook).not.toContain('[[');
    expect(hook).not.toContain(']]');
  });

  it('embeds the provided fallback command', () => {
    const hook = buildPrePushHook({ ...RENDER, fallbackCmd: 'yarn dlx @mmnto/cli' });
    expect(hook).toContain('yarn dlx @mmnto/cli');
  });

  it('includes format:check before push', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('format:check');
    expect(hook).toContain('Formatting check failed');
  });
});

describe('installGitHook', () => {
  let tmpDir: string;
  let hooksDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-'));
    hooksDir = path.join(tmpDir, '.git', 'hooks');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates a new hook file when none exists', () => {
    const content = buildPreCommitHook(RENDER);
    const result = installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);

    expect(result).toBe('installed');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    const written = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
    expect(written).toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('creates parent directories as needed', () => {
    expect(fs.existsSync(hooksDir)).toBe(false);

    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(RENDER), TOTEM_PRECOMMIT_MARKER);

    expect(fs.existsSync(hooksDir)).toBe(true);
  });

  it('returns exists when marker is already present (idempotent)', () => {
    const content = buildPreCommitHook(RENDER);
    installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);

    const result = installGitHook(hooksDir, 'pre-commit', content, TOTEM_PRECOMMIT_MARKER);
    expect(result).toBe('exists');
  });

  it('appends to existing hook without marker (preserves user hooks)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    const userHook = '#!/bin/sh\necho "user hook"\n';
    fs.writeFileSync(hookPath, userHook);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toContain('echo "user hook"');
    expect(written).toContain(TOTEM_PRECOMMIT_MARKER);
    // Should not duplicate shebang when appending
    expect((written.match(/^#!\/bin\/sh$/gm) ?? []).length).toBe(1);
  });

  it('does not clobber existing hook content', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const userHook = '#!/bin/sh\nrun_my_tests\n';
    fs.writeFileSync(hookPath, userHook);

    installGitHook(hooksDir, 'pre-push', buildPrePushHook(RENDER), TOTEM_PREPUSH_MARKER);

    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toContain('run_my_tests');
    expect(written).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('is idempotent — double install does not duplicate', () => {
    const content = buildPrePushHook(RENDER);
    installGitHook(hooksDir, 'pre-push', content, TOTEM_PREPUSH_MARKER);
    installGitHook(hooksDir, 'pre-push', content, TOTEM_PREPUSH_MARKER);

    const written = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    const matches = written.match(new RegExp(TOTEM_PREPUSH_MARKER.replace(/[[\]]/g, '\\$&'), 'g'));
    expect(matches).toHaveLength(1);
  });

  it('returns skipped-non-shell for Node hook (does not corrupt file)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    const nodeHook = '#!/usr/bin/env node\nconsole.log("lint");\n'; // totem-ignore — test fixture, not real logging
    fs.writeFileSync(hookPath, nodeHook);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('skipped-non-shell');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toBe(nodeHook); // File untouched
  });

  it('returns skipped-non-shell for Python hook', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const pythonHook = '#!/usr/bin/env python3\nimport subprocess\n';
    fs.writeFileSync(hookPath, pythonHook);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook(RENDER),
      TOTEM_PREPUSH_MARKER,
    );

    expect(result).toBe('skipped-non-shell');
    const written = fs.readFileSync(hookPath, 'utf-8');
    expect(written).toBe(pythonHook); // File untouched
  });

  it('appends normally to sh hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends normally to bash hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/bash\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends normally to env bash hooks', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/usr/bin/env bash\necho "existing"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('appends to hooks without a shebang (plain text)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(hookPath, 'echo "no shebang"\n');

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
    );

    expect(result).toBe('appended');
  });

  it('handles pre-commit and pre-push independently', () => {
    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(RENDER), TOTEM_PRECOMMIT_MARKER);
    installGitHook(hooksDir, 'pre-push', buildPrePushHook(RENDER), TOTEM_PREPUSH_MARKER);

    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);

    const preCommit = fs.readFileSync(path.join(hooksDir, 'pre-commit'), 'utf-8');
    const prePush = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    expect(preCommit).toContain(TOTEM_PRECOMMIT_MARKER);
    expect(preCommit).not.toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).not.toContain(TOTEM_PRECOMMIT_MARKER);
  });

  it('overwrites existing hook when force is true', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    // Write an old-format hook with the marker
    fs.writeFileSync(hookPath, `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER}\n$TOTEM_CMD lint\n`);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook(RENDER),
      TOTEM_PREPUSH_MARKER,
      true, // force
    );

    expect(result).toBe('overwritten');
    const content = fs.readFileSync(hookPath, 'utf-8');
    expect(content).toContain('verify-manifest'); // new format
    expect(content).not.toContain('$TOTEM_CMD lint\n'); // old format gone (trailing newline distinguishes bare line)
  });

  it('returns exists when on-disk content already matches canonical (idempotent)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const canonical = buildPrePushHook(RENDER);
    fs.writeFileSync(hookPath, canonical);

    const result = installGitHook(hooksDir, 'pre-push', canonical, TOTEM_PREPUSH_MARKER);

    expect(result).toBe('exists');
  });

  it('drift-repairs a stale totem-owned pre-push (WITH end marker) without force (mmnto-ai/totem#2138)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    // A totem-owned whole file frozen at an older generator's output — but it carries
    // the bounded end marker, so drift-repair may upgrade it in place without --force.
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER}\n$TOTEM_CMD lint\n# ${TOTEM_PREPUSH_END}\n`,
    );
    const canonical = buildPrePushHook(RENDER);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      canonical,
      TOTEM_PREPUSH_MARKER,
      false,
      TOTEM_PREPUSH_END,
    );

    expect(result).toBe('overwritten');
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(canonical);
  });

  it('drift-repairs a stale totem-owned pre-commit (WITH end marker) without force', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    fs.writeFileSync(
      hookPath,
      `#!/bin/sh\n# ${TOTEM_PRECOMMIT_MARKER}\nstale body\n# ${TOTEM_PRECOMMIT_END}\n`,
    );
    const canonical = buildPreCommitHook(RENDER);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      canonical,
      TOTEM_PRECOMMIT_MARKER,
      false,
      TOTEM_PRECOMMIT_END,
    );

    expect(result).toBe('overwritten');
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(canonical);
  });

  it('does NOT drift-repair a LEGACY totem pre-commit missing the end marker (takes one --force)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    // A hook written by an OLD template that predates the pre-commit end marker: the
    // start marker opens it and the body has drifted, but there is no in-file end
    // marker → the region cannot be bounded → drift-repair declines (legacy path).
    const legacy = `#!/bin/sh\n# ${TOTEM_PRECOMMIT_MARKER}\nstale legacy body\n`;
    fs.writeFileSync(hookPath, legacy);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
      false,
      TOTEM_PRECOMMIT_END,
    );

    expect(result).toBe('exists');
    // Left untouched — the legacy hook takes one `totem hook install --force`.
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(legacy);
  });

  it('does not drift-repair a user hook with an appended totem block without force', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    // User content precedes the totem block → NOT an owned whole file, even though the
    // block is bounded by an end marker.
    const userThenTotem = `#!/bin/sh\nrun_my_tests\n# ${TOTEM_PREPUSH_MARKER}\nold content\n# ${TOTEM_PREPUSH_END}\n`;
    fs.writeFileSync(hookPath, userThenTotem);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook(RENDER),
      TOTEM_PREPUSH_MARKER,
      false,
      TOTEM_PREPUSH_END,
    );

    expect(result).toBe('exists');
    // Left untouched — the user's hook is preserved verbatim.
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(userThenTotem);
  });

  it('does not drift-repair a pre-commit with user content AFTER the end marker (protected)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-commit');
    // Stale totem region, but the user appended content AFTER the end marker — a
    // whole-file overwrite would clobber it, so the end-marker guard must decline.
    const staleWithTrailingUser = `#!/bin/sh\n# ${TOTEM_PRECOMMIT_MARKER}\nstale body\n# ${TOTEM_PRECOMMIT_END}\necho "my pre-commit notice"\n`;
    fs.writeFileSync(hookPath, staleWithTrailingUser);

    const result = installGitHook(
      hooksDir,
      'pre-commit',
      buildPreCommitHook(RENDER),
      TOTEM_PRECOMMIT_MARKER,
      false,
      TOTEM_PRECOMMIT_END,
    );

    expect(result).toBe('exists');
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(staleWithTrailingUser);
  });

  it('does not drift-repair a pre-push with user content AFTER the end marker (protected)', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'pre-push');
    const staleWithTrailingUser = `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER}\nstale body\n# ${TOTEM_PREPUSH_END}\necho "my pre-push notice"\n`;
    fs.writeFileSync(hookPath, staleWithTrailingUser);

    const result = installGitHook(
      hooksDir,
      'pre-push',
      buildPrePushHook(RENDER),
      TOTEM_PREPUSH_MARKER,
      false,
      TOTEM_PREPUSH_END,
    );

    expect(result).toBe('exists');
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(staleWithTrailingUser);
  });

  it('does not drift-repair a post-merge hook with user content after the end marker', () => {
    fs.mkdirSync(hooksDir, { recursive: true });
    const hookPath = path.join(hooksDir, 'post-merge');
    // Stale totem region, but the user appended content AFTER the end marker — a
    // whole-file overwrite would clobber it, so the end-marker guard must decline.
    const staleWithTrailingUser = `#!/bin/sh\n# ${TOTEM_HOOK_MARKER}\nstale body\n# ${TOTEM_HOOK_END}\necho "my deploy notice"\n`;
    fs.writeFileSync(hookPath, staleWithTrailingUser);

    const result = installGitHook(
      hooksDir,
      'post-merge',
      buildHookContent(RENDER),
      TOTEM_HOOK_MARKER,
      false,
      TOTEM_HOOK_END,
    );

    expect(result).toBe('exists');
    expect(fs.readFileSync(hookPath, 'utf-8')).toBe(staleWithTrailingUser);
  });
});

// ─── generateHookHelpers ────────────────────────────

describe('generateHookHelpers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-helpers-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates .totem/hooks/ directory and writes all 4 .sh files', () => {
    generateHookHelpers(tmpDir, RENDER);

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push.sh'))).toBe(true);
  });

  it('generated scripts contain expected content', () => {
    generateHookHelpers(tmpDir, RENDER);

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    const postMerge = fs.readFileSync(path.join(hooksDir, 'post-merge.sh'), 'utf-8');
    expect(postMerge).toContain('command -v totem');
    expect(postMerge).toContain('$TOTEM_CMD');

    const prePush = fs.readFileSync(path.join(hooksDir, 'pre-push.sh'), 'utf-8');
    expect(prePush).toContain(TOTEM_PREPUSH_MARKER);
    expect(prePush).toContain('verify-manifest');
  });

  it('is idempotent — calling twice does not error', () => {
    generateHookHelpers(tmpDir, RENDER);
    generateHookHelpers(tmpDir, RENDER);

    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
  });
});

// ─── installHooksNonInteractive ─────────────────────

describe('installHooksNonInteractive', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-ni-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns null when not a git repo', async () => {
    const result = await installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();
  });

  it('installs all four hooks in a git repo', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    const result = await installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');
    expect(result!.postCheckout).toBe('installed');

    // Verify files exist
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout'))).toBe(true);
  });

  it('is idempotent — second call returns exists for all hooks', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    await installHooksNonInteractive(tmpDir);
    const result = await installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('exists');
    expect(result!.prePush).toBe('exists');
    expect(result!.postMerge).toBe('exists');
    expect(result!.postCheckout).toBe('exists');
  });

  it('returns null and generates helper scripts when hook manager is detected', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.mkdirSync(path.join(tmpDir, '.husky'), { recursive: true });

    const result = await installHooksNonInteractive(tmpDir);
    expect(result).toBeNull();

    // Verify helper scripts were generated
    const hooksDir = path.join(tmpDir, '.totem', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'post-merge.sh'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push.sh'))).toBe(true);
  });

  it('installs hooks at git root when run from a subdirectory', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    const result = await installHooksNonInteractive(subDir);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('installed');
    expect(result!.prePush).toBe('installed');
    expect(result!.postMerge).toBe('installed');
    expect(result!.postCheckout).toBe('installed');

    // Hooks should be at git root, not in the subdirectory
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    expect(fs.existsSync(path.join(hooksDir, 'pre-commit'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'pre-push'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-merge'))).toBe(true);
    expect(fs.existsSync(path.join(hooksDir, 'post-checkout'))).toBe(true);
    expect(fs.existsSync(path.join(subDir, '.git'))).toBe(false);
  });

  it('check passes from subdirectory after install', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const subDir = path.join(tmpDir, 'packages', 'cli');
    fs.mkdirSync(subDir, { recursive: true });

    await installHooksNonInteractive(subDir);
    expect(checkHooksInstalled(subDir)).toBe(true);
  });

  it('appends to existing hooks without clobbering', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\nrun_my_tests\n');

    const result = await installHooksNonInteractive(tmpDir);

    expect(result!.prePush).toBe('appended');
    const content = fs.readFileSync(path.join(tmpDir, '.git', 'hooks', 'pre-push'), 'utf-8');
    expect(content).toContain('run_my_tests');
    expect(content).toContain(TOTEM_PREPUSH_MARKER);
  });

  it('force-overwrites all hooks when force is true', async () => {
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');

    // First install — creates hooks
    await installHooksNonInteractive(tmpDir);

    // Second install with force — overwrites all hooks
    const result = await installHooksNonInteractive(tmpDir, true);

    expect(result).not.toBeNull();
    expect(result!.preCommit).toBe('overwritten');
    expect(result!.prePush).toBe('overwritten');
    expect(result!.postMerge).toBe('overwritten');
    expect(result!.postCheckout).toBe('overwritten');
  });
});

// ─── checkHooksInstalled ────────────────────────────

describe('checkHooksInstalled', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-check-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns false when no hooks are installed', () => {
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });

  it('returns true when all hooks are installed', async () => {
    await installHooksNonInteractive(tmpDir);
    expect(checkHooksInstalled(tmpDir)).toBe(true);
  });

  it('returns false when only some hooks are installed', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    installGitHook(hooksDir, 'pre-commit', buildPreCommitHook(RENDER), TOTEM_PRECOMMIT_MARKER);
    // Missing pre-push and post-merge
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });

  it('returns false when hook file exists but missing marker', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "no marker"\n');
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/sh\necho "no marker"\n');
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), '#!/bin/sh\necho "no marker"\n');
    fs.writeFileSync(path.join(hooksDir, 'post-checkout'), '#!/bin/sh\necho "no marker"\n');
    expect(checkHooksInstalled(tmpDir)).toBe(false);
  });
});

// ─── post-merge hook content (conditional diff-tree) ─

describe('post-merge hook content', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-pm-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('generates post-merge hook with git diff-tree lesson check', async () => {
    await installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('ORIG_HEAD');
    expect(content).toContain('grep -q');
    expect(content).toContain('.totem/lessons/');
    expect(content).toContain('if ');
    expect(content).toContain('fi');
    expect(content).toContain('[totem] post-merge hook');
    expect(content).toContain('[totem] end post-merge');
  });

  it('passes quiet flag to sync command in post-merge hook', async () => {
    await installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-merge');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('--quiet');
  });

  it('preserves existing hooks when appending post-merge block', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'post-merge'), '#!/bin/sh\necho "my custom hook"\n');

    await installHooksNonInteractive(tmpDir);

    const content = fs.readFileSync(path.join(hooksDir, 'post-merge'), 'utf-8');
    expect(content).toContain('echo "my custom hook"');
    expect(content).toContain('[totem] post-merge hook');
    expect(content).toContain('ORIG_HEAD');
    expect(content).toContain('fi');
  });
});

// ─── post-checkout hook content (branch switch guard) ─

describe('post-checkout hook content', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-pc-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('generates post-checkout hook with branch switch guard', async () => {
    await installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('$3');
    expect(content).toContain('exit 0');
    expect(content).toContain('[totem] post-checkout hook');
    expect(content).toContain('[totem] end post-checkout');
  });

  it('handles null SHA for initial checkout', () => {
    const hook = buildPostCheckoutHookContent(RENDER);

    expect(hook).toContain('0000000000000000000000000000000000000000');
    expect(hook).toContain('.totem');
  });

  it('uses quiet sync command', async () => {
    await installHooksNonInteractive(tmpDir);

    const hookPath = path.join(tmpDir, '.git', 'hooks', 'post-checkout');
    const content = fs.readFileSync(hookPath, 'utf-8');

    expect(content).toContain('--quiet');
  });

  it('includes post-checkout in non-interactive install', async () => {
    const result = await installHooksNonInteractive(tmpDir);

    expect(result).not.toBeNull();
    expect(result!.postCheckout).toBe('installed');
  });
});

// ─── worktree-safe sync-log path (mmnto-ai/totem#2376) ─

// ─── totem-status refresh-gh wiring (mmnto-ai/totem#2556) ─

describe('post-merge hook fires totem-status refresh-gh', () => {
  it('invokes refresh-gh presence-gated and backgrounded (mmnto-ai/totem-status#127 C3)', () => {
    const hook = buildHookContent(RENDER);

    // Presence gate (absent binary = zero noise) AND primary-checkout gate: in a
    // linked worktree .git is a pointer FILE and a backgrounded child inheriting
    // the worktree cwd holds a Windows directory lock that breaks worktree removal.
    expect(hook).toContain('if [ -d .git ] && command -v totem-status >/dev/null 2>&1; then');
    // Spawn-and-forget: backgrounded subshell — the merge never waits. The
    // blind-firing form survives as the fallback when the log is unwritable.
    expect(hook).toContain('(totem-status refresh-gh >/dev/null 2>&1 &)');
    // The bounded owned region stays intact: end marker still terminates the file.
    expect(hook.trimEnd().endsWith(`# ${TOTEM_HOOK_END}`)).toBe(true);
  });

  it('#2570: stamps each firing and hands the child the same log (observability leg)', () => {
    const hook = buildHookContent(RENDER);

    // Repo-local log inside .git; the stamp carries the firing site, cwd, and
    // WHICH binary resolved (shell search order can be shadowed by a
    // checkout-local exe on Windows).
    expect(hook).toContain('TS_REFRESH_LOG=".git/totem-status-refresh-hook.log"');
    expect(hook).toContain('post-merge spawn cwd=%s bin=%s');
    // Path-derived fields are control-character-scrubbed before logging
    // (terminal-injection guideline, #2572 CR round).
    expect(hook).toContain("$(command -v totem-status | tr -d '[:cntrl:]')");
    // The 2>/dev/null PRECEDES the append: redirections apply left to right,
    // so the open failure of an unwritable log is itself silent (falsification
    // round, MAJOR 1).
    expect(hook).toContain('2>/dev/null >> "$TS_REFRESH_LOG"');
    // The children append to the SAME log so their output lands after the
    // stamps. Narrowed once a second verb joined the block: child output is
    // unlabelled and interleaves, so a silent tail attributes only to the LAST
    // verb stamped — not per child.
    expect(hook).toContain('(totem-status refresh-gh >> "$TS_REFRESH_LOG" 2>&1 &)');
  });

  // ── slice-two residual: refresh-obligation-store beside refresh-gh ──
  // (mmnto-ai/totem-status#127; sibling of mmnto-ai/totem#2556.) The durable
  // obligation store gets the same post-merge moment as the GH snapshot.
  it('also fires refresh-obligation-store under the SAME gate and log (mmnto-ai/totem-status#127)', () => {
    const hook = buildHookContent(RENDER);

    // One gate, not two: both verbs live inside the single presence +
    // primary-checkout `if`, so a worktree/non-adopter skips BOTH.
    const gateIdx = hook.indexOf('if [ -d .git ] && command -v totem-status >/dev/null 2>&1; then');
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    // Anchor on the EXECUTABLE form, not the banner prose above the gate: a
    // mutant that relocates the invocation outside the gate but leaves the
    // comment in place must fail here.
    expect(hook.indexOf('(totem-status refresh-obligation-store')).toBeGreaterThan(gateIdx);
    // …and it stays inside the block, ahead of the gate's closing `fi`.
    expect(hook.indexOf('(totem-status refresh-obligation-store')).toBeLessThan(
      hook.indexOf('# Only sync when lessons changed'),
    );
    // Both arms of the log-writability branch mirror the refresh-gh pair: the
    // logged form, and the blind fallback when the log cannot be opened.
    expect(hook).toContain('(totem-status refresh-obligation-store >> "$TS_REFRESH_LOG" 2>&1 &)');
    expect(hook).toContain('(totem-status refresh-obligation-store >/dev/null 2>&1 &)');
    // The stamp NAMES the verb, so the log records which verbs fired and in
    // what order (it does not restore per-child reap attribution — child
    // output is unlabelled).
    expect(hook).toContain('post-merge spawn cwd=%s bin=%s verb=%s');
    expect(hook).toContain('"$(command -v totem-status | tr -d \'[:cntrl:]\')" refresh-gh');
    expect(hook).toContain(
      '"$(command -v totem-status | tr -d \'[:cntrl:]\')" refresh-obligation-store',
    );
    // The bounded owned region stays intact after the addition.
    expect(hook.trimEnd().endsWith(`# ${TOTEM_HOOK_END}`)).toBe(true);
  });
});

// Behavioral coverage of BOTH gate branches (falsification-leg round 1: the string
// assertions above are satisfiable without the behavior). POSIX-only: the stub
// sidecar is a shell script on PATH, which Windows CreateProcess cannot resolve —
// the ubuntu/macos CI legs carry this coverage.
describe.skipIf(process.platform === 'win32')('post-merge refresh-gh behavior (POSIX)', () => {
  let tmpDir: string;
  let binDir: string;
  let markerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-refresh-sh-'));
    binDir = path.join(tmpDir, 'stub-bin');
    fs.mkdirSync(binDir);
    markerPath = path.join(tmpDir, 'refresh-fired.marker');
    // APPEND, not truncate: the gate now fires TWO verbs from one block and the
    // backgrounded children land in whatever order they finish — a `>` stub
    // would race them into a last-writer-wins single line.
    fs.writeFileSync(
      path.join(binDir, 'totem-status'),
      `#!/bin/sh\necho "$1" >> "${markerPath}"\n`,
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** The verbs the stub sidecar has been invoked with so far, sorted. Reading
   *  CONTENT (not existence) still guards the stub's open-then-write window
   *  (observed as a CI flake: `expected '' to be 'refresh-gh'`). */
  function firedVerbs(): string[] {
    try {
      if (!fs.existsSync(markerPath)) return [];
      return fs
        .readFileSync(markerPath, 'utf-8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort();
      // totem-context: intentional [] on a read race (marker mid-write) — the poll loop retries
    } catch {
      return [];
    }
  }

  /** Both verbs must land: refresh-gh AND the slice-two refresh-obligation-store. */
  const BOTH_VERBS = ['refresh-gh', 'refresh-obligation-store'];

  function markerReady(): boolean {
    return firedVerbs().length === BOTH_VERBS.length;
  }

  async function markerAppears(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (markerReady()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return markerReady();
  }

  it(
    'fires the stub sidecar in a primary checkout (backgrounded child lands the marker)',
    { timeout: 15000 },
    async () => {
      const repo = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      const hookPath = path.join(repo, 'post-merge');
      fs.writeFileSync(hookPath, buildHookContent(RENDER), { mode: 0o755 });

      execSync('sh ./post-merge', {
        cwd: repo,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
        stdio: 'ignore',
      });

      expect(await markerAppears(5000)).toBe(true);
      // BOTH verbs fired from the one gate, and nothing else did.
      expect(firedVerbs()).toEqual(BOTH_VERBS);

      // #2570 observability leg: the firing left a stamp in the repo-local
      // .git log before the child ran, and bin= carries the RESOLVED path.
      const logPath = path.join(repo, '.git', 'totem-status-refresh-hook.log');
      expect(fs.existsSync(logPath)).toBe(true);
      const logText = fs.readFileSync(logPath, 'utf-8');
      expect(logText).toContain('post-merge spawn cwd=');
      expect(logText).toMatch(/bin=\S*totem-status/);
      // Each stamp NAMES its verb, so the log records which verbs fired and in
      // what order — the attribution the unlabelled child output cannot give.
      expect(logText).toContain('verb=refresh-gh');
      expect(logText).toContain('verb=refresh-obligation-store');
    },
  );

  it(
    '#2570: an unwritable log falls back to blind firing with zero stderr noise',
    { timeout: 15000 },
    async () => {
      const repo = path.join(tmpDir, 'repo');
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      // A DIRECTORY at the log path makes both the stamp and the child
      // redirect fail — the sidecar must still fire (else branch) and the
      // open failure itself must stay silent (2>/dev/null precedes the
      // append; falsification round, MAJOR 1).
      fs.mkdirSync(path.join(repo, '.git', 'totem-status-refresh-hook.log'), { recursive: true });
      const hookPath = path.join(repo, 'post-merge');
      fs.writeFileSync(hookPath, buildHookContent(RENDER), { mode: 0o755 });

      const result = spawnSync('sh', ['./post-merge'], {
        cwd: repo,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
        encoding: 'utf-8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr ?? '').not.toContain('totem-status-refresh-hook.log');

      expect(await markerAppears(5000)).toBe(true);
      // The blind fallback carries BOTH verbs, not just the first.
      expect(firedVerbs()).toEqual(BOTH_VERBS);
    },
  );

  it(
    'skips the sidecar when .git is not a directory (worktree/non-git guard)',
    { timeout: 15000 },
    async () => {
      const repo = path.join(tmpDir, 'repo');
      fs.mkdirSync(repo, { recursive: true });
      // Linked-worktree shape: .git is a pointer FILE, not a directory.
      fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
      const hookPath = path.join(repo, 'post-merge');
      fs.writeFileSync(hookPath, buildHookContent(RENDER), { mode: 0o755 });

      execSync('sh ./post-merge', {
        cwd: repo,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
        stdio: 'ignore',
      });

      expect(await markerAppears(500)).toBe(false);
      // The gate covers BOTH verbs — a partial leak (either one firing) is a
      // failure here, not a pass by way of "fewer than two".
      expect(firedVerbs()).toEqual([]);
    },
  );
});

describe('sync-log redirect resolves the git dir (worktree-safe)', () => {
  it('post-merge hook derives the log path from git rev-parse --git-dir', () => {
    const hook = buildHookContent(RENDER);

    expect(hook).toContain('GIT_DIR_RESOLVED=$(git rev-parse --git-dir 2>/dev/null || echo .git)');
    expect(hook).toContain('> "$GIT_DIR_RESOLVED/totem-sync.log"');
    // The hardcoded `.git/`-as-directory redirect must be gone (ENOTDIR in a worktree).
    expect(hook).not.toContain('> .git/totem-sync.log');
  });

  it('post-checkout hook derives the log path from git rev-parse --git-dir on both branches', () => {
    const hook = buildPostCheckoutHookContent(RENDER);

    expect(hook).toContain('GIT_DIR_RESOLVED=$(git rev-parse --git-dir 2>/dev/null || echo .git)');
    // Both the null-SHA and the branch-diff redirect use the resolved dir.
    expect(hook.match(/> "\$GIT_DIR_RESOLVED\/totem-sync\.log"/g)).toHaveLength(2);
    expect(hook).not.toContain('> .git/totem-sync.log');
  });
});

// ─── upgradePrePushHookIfNeeded ───────────────────────

describe('upgradePrePushHookIfNeeded', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hooks-upgrade-'));
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    // Pin the repo-local render options: since mmnto-ai/totem#2692 the upgrade
    // path resolves `hooks.tier` from config, and a config-less temp repo would
    // fall through to the developer's global `~/.totem/` profile — a global
    // `hooks.tier: strict` would then break the standard-tier expectation below
    // (CodeRabbit on mmnto-ai/totem#2701).
    fs.writeFileSync(
      path.join(tmpDir, 'totem.yaml'),
      'targets:\n  - glob: "docs/*.md"\n    type: lesson\n    strategy: markdown-heading\nhooks:\n  tier: standard\n',
      'utf-8',
    );
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * Helper: extract the totem block from a hook file and compare it against
   * the canonical output of buildPrePushHook(RENDER) (shebang stripped, trimmed).
   * Catches stale shell fragments or splice boundary bugs that toContain would miss.
   * The stateless format is now bounded by the pre-push end marker, so the block is the
   * span from the start-marker comment through the end-marker comment line inclusive —
   * a missing/misplaced end marker (a splice-boundary bug) fails the equality check.
   */
  function extractTotemBlock(hookContent: string): string {
    const markerIdx = hookContent.indexOf(`# ${TOTEM_PREPUSH_MARKER}`);
    if (markerIdx === -1) return '';
    const endMarkerLine = `# ${TOTEM_PREPUSH_END}`;
    const endIdx = hookContent.indexOf(endMarkerLine, markerIdx);
    if (endIdx === -1) return '';
    return hookContent.slice(markerIdx, endIdx + endMarkerLine.length).trim();
  }

  /** Canonical totem block: shebang stripped, trimmed — the expected upgrade output. */
  function expectedTotemBlock(): string {
    return buildPrePushHook({ ...RENDER, fallbackCmd: getFallbackCommand(tmpDir) })
      .replace(/^#!\/bin\/sh\n/, '')
      .trim();
  }

  it('upgrades old command-executing hook to stateless format', async () => {
    // Install an old-style hook that executes $TOTEM_CMD lint
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toContain('verify-manifest');
    expect(content).toContain('$TOTEM_CMD lint');
    expect(content).toContain(TOTEM_PREPUSH_MARKER);
    expect(content).not.toContain('.lint-passed');
    expect(content).not.toContain('.target-globs');

    // Full block comparison: extracted totem block must match canonical output
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('skips hook without totem marker', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const userHook = '#!/bin/sh\necho "user hook"\n';
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), userHook);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(false);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toBe(userHook); // File untouched
  });

  it('skips hook that already uses stateless format', async () => {
    // Install the current-version hook via non-interactive installer
    await installHooksNonInteractive(tmpDir);

    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    const beforeContent = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(false);
    const afterContent = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(afterContent).toBe(beforeContent); // File untouched
  });

  it('returns false when no pre-push hook exists', async () => {
    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);
    expect(upgraded).toBe(false);
  });

  it('returns false when not a git repo', async () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-no-git-'));
    try {
      const upgraded = await upgradePrePushHookIfNeeded(nonGitDir);
      expect(upgraded).toBe(false);
    } finally {
      cleanTmpDir(nonGitDir);
    }
  });

  it('preserves user-appended content when upgrading', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Simulate an old totem hook with user content appended after it
    const oldTotemBlock = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    const userAppended =
      '\n# My custom deploy notification\ncurl -X POST https://hooks.example.com/deploy\n';
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldTotemBlock + userAppended);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    // New totem block should use stateless format
    expect(content).toContain('verify-manifest');
    expect(content).toContain('$TOTEM_CMD lint');
    expect(content).not.toContain('.lint-passed');
    // User content should be preserved
    expect(content).toContain('curl -X POST https://hooks.example.com/deploy');
    expect(content).toContain('My custom deploy notification');

    // Full block comparison: extracted totem block must match canonical output
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('preserves user-appended if/fi blocks without corrupting them', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Old totem block (needs upgrade) PLUS user content that contains its own if/fi structures
    const oldTotemBlock = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    const userIfFiBlock = `
# Custom deploy guard with nested if/fi
if [ -f ".deploy-lock" ]; then
  echo "Deploy locked, skipping notification"
  if [ "$FORCE_DEPLOY" = "1" ]; then
    echo "Force deploy override"
    curl -X POST https://hooks.example.com/force-deploy
  fi
else
  curl -X POST https://hooks.example.com/deploy
fi

# Another independent if block
if [ -n "$SLACK_WEBHOOK" ]; then
  curl -X POST "$SLACK_WEBHOOK" -d '{"text":"pushing..."}'
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldTotemBlock + userIfFiBlock);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    // Totem block must match canonical output exactly
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());

    // User if/fi structures must survive intact — check exact fragments
    expect(content).toContain('if [ -f ".deploy-lock" ]; then');
    expect(content).toContain('if [ "$FORCE_DEPLOY" = "1" ]; then');
    expect(content).toContain('curl -X POST https://hooks.example.com/force-deploy');
    expect(content).toContain('curl -X POST https://hooks.example.com/deploy');
    expect(content).toContain('if [ -n "$SLACK_WEBHOOK" ]; then');
    expect(content).toContain('curl -X POST "$SLACK_WEBHOOK"');

    // The user block should appear AFTER the totem block, not interleaved
    const totemBlockEnd = content.indexOf(actual) + actual.length;
    const userBlockStart = content.indexOf('# Custom deploy guard');
    expect(userBlockStart).toBeGreaterThan(totemBlockEnd);
  });

  it('leaves no stale fi or orphaned shell fragments after upgrade', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    $TOTEM_CMD lint
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    await upgradePrePushHookIfNeeded(tmpDir);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');

    // Count if/fi balance: every `if` must have a matching `fi`.
    // Inline `if ... fi` on a single line are self-balanced and excluded from both counts.
    const contentLines = content.split('\n');
    const multiLineIfs = contentLines.filter((l) => /^\s*if\s/.test(l) && !/;\s*fi\s*$/.test(l));
    const standaloneFis = contentLines.filter((l) => /^\s*fi\s*$/.test(l));
    expect(multiLineIfs.length).toBe(standaloneFis.length);

    // No duplicate markers — upgrade must not leave the old marker behind
    const markerPattern = new RegExp(TOTEM_PREPUSH_MARKER.replace(/[[\]]/g, '\\$&'), 'g');
    const markerHits = content.match(markerPattern) ?? [];
    expect(markerHits.length).toBe(1);

    // Full block comparison as final sanity check
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('upgrades old flag-checking hook to stateless format', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Simulate the previous flag-checking format that used .lint-passed
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — fast read-only checkpoint.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  if [ ! -f ".totem/cache/.lint-passed" ]; then
    echo "[totem] Push blocked: lint has not passed." >&2
    exit 1
  fi
  LINT_SHA=$(cat .totem/cache/.lint-passed 2>/dev/null | tr -d '[:space:]')
  HEAD_SHA=$(git rev-parse HEAD 2>/dev/null)
  if [ "$LINT_SHA" != "$HEAD_SHA" ]; then
    exit 1
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toContain('verify-manifest');
    expect(content).toContain('$TOTEM_CMD lint');
    expect(content).not.toContain('.lint-passed');
    // Full block comparison
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });

  it('upgrades hook with auto-refresh and $TOTEM_CMD to stateless format', async () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // Simulate a hook with the auto-refresh logic still using $TOTEM_CMD
    const oldHook = `#!/bin/sh
# ${TOTEM_PREPUSH_MARKER} — run compiled rules before push.
# Override with: git push --no-verify

if [ -f ".totem/compiled-rules.json" ]; then
  TOTEM_CMD="totem"
  if [ -n "$TOTEM_CMD" ]; then
    if ! $TOTEM_CMD lint; then
      exit 1
    fi
  fi

  if [ -f ".totem/cache/.shield-passed" ] && [ -n "$TOTEM_CMD" ]; then
    SHIELD_SHA=$(cat .totem/cache/.shield-passed | tr -d '[:space:]')
    HEAD_SHA=$(git rev-parse HEAD)
    if [ "$SHIELD_SHA" != "$HEAD_SHA" ]; then
      echo "[totem] Shield flag stale. Auto-refreshing..."
      if ! $TOTEM_CMD review; then
        echo "[totem] Review auto-refresh failed. Fix issues and retry."
        exit 1
      fi
    fi
  fi
fi
`;
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), oldHook);

    const upgraded = await upgradePrePushHookIfNeeded(tmpDir);

    expect(upgraded).toBe(true);
    const content = fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf-8');
    expect(content).toContain('verify-manifest');
    expect(content).toContain('$TOTEM_CMD lint');
    expect(content).not.toContain('.lint-passed');
    expect(content).not.toContain('.shield-passed');
    // Full block comparison
    const actual = extractTotemBlock(content);
    expect(actual).toBe(expectedTotemBlock());
  });
});

// ─── Enforcement tier: agent detection & strict mode ──

describe('buildPreCommitHook agent detection', () => {
  it('includes agent detection snippet', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('is_agent=0');
    expect(hook).toContain('is_agent=1');
    expect(hook).toContain('CLAUDE_CODE_AGENT');
    expect(hook).toContain('CLAUDE_VERSION');
    expect(hook).toContain('CURSOR_TRACE_ID');
    // GEMINI_API_KEY intentionally excluded — human devs export it for Totem's embedding provider
  });

  it('includes TOTEM_HOOK_TIER variable', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('TOTEM_HOOK_TIER="standard"');
  });

  it('sets TOTEM_HOOK_TIER to strict when tier is strict', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('TOTEM_HOOK_TIER="strict"');
  });
});

describe('buildPreCommitHook with strict tier', () => {
  it('gates on spec evidence and never on the retired hand-set marker', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    // The former `.totem/cache/.spec-completed` sentinel (mmnto-ai/totem#2690)
    // may be NAMED in a comment that says it is not honored, but no test-able
    // path may read it.
    expect(hook).not.toMatch(/-f\s+"?\.totem\/cache\/\.spec-completed/);
    expect(hook).toContain("Run 'totem spec <issue>' before committing (strict mode)");
  });

  it('gates spec check on agent detection or strict tier', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('$is_agent');
    expect(hook).toContain('$TOTEM_HOOK_TIER');
  });

  it('gates on the totem spec run artifact, JSON-aware — the only evidence', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('.totem/artifacts/runs');
    expect(hook).toContain('admission.runMetadata.caller');
    expect(hook).toContain('spec evidence:');
    expect(hook).not.toContain('(legacy marker)');
  });

  // mmnto-ai/totem#2700 — the reader's vocabulary is RENDERED from the one
  // canonical constant, never re-spelled in the hook text, so a change to the
  // writer's spelling can never leave the gate reading a stale word.
  it('renders SPEC_REQUIRED_SECTIONS and the anchor vocabulary as JSON literals', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain(`const REQUIRED = ${JSON.stringify(SPEC_REQUIRED_SECTIONS)};`);
    expect(hook).toContain(`const KIND_ISSUE = ${JSON.stringify(GROUNDING_ANCHOR_ISSUE)};`);
    expect(hook).toContain(`const KIND_RECORD = ${JSON.stringify(GROUNDING_ANCHOR_RECORD)};`);
    expect(hook).toContain(`const PROMPT_OVERRIDE = ${JSON.stringify(PROMPT_SOURCE_OVERRIDE)};`);
  });

  it('carries the exit-3 arm distinctly from the exit-2 and reader-failure arms', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('elif [ "$reader_status" = "3" ]; then');
    // printf, not echo (mmnto-ai/totem#2737 fold 3): `dash` — /bin/sh on Debian
    // and Ubuntu — expands backslash escapes in `echo`, so a literal `\n` in an
    // artifact value forged a second [Totem] line there while staying inert
    // under bash. The two sinks that carry $spec_evidence print literally.
    const bs = String.fromCharCode(0x5c);
    expect(hook).toContain(
      `printf '%s${bs}n' "[Totem] BLOCKED: $spec_evidence — run 'totem spec <issue>' or 'totem spec --from <record>' (add --fresh if the response is cached) (strict mode)"`,
    );
    expect(hook).toContain(`printf '%s${bs}n' "[Totem] spec evidence: $spec_evidence"`);
    expect(hook).not.toContain('echo "[Totem] spec evidence:');
    expect(hook).not.toContain('echo "[Totem] BLOCKED: $spec_evidence');
    // The two pre-existing arms keep their exact text.
    expect(hook).toContain('no totem spec run artifact under .totem/artifacts/runs/');
    expect(hook).toContain('the spec-evidence reader could not run (node exit status');
  });

  it('the reader body carries no single quote (it lives inside a single-quoted node -e word)', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    const reader = hook.split("node -e '")[1]?.split("\n' 2>/dev/null)")[0] ?? '';
    expect(reader.length).toBeGreaterThan(0);
    expect(reader).not.toContain("'");
  });
});

// The strict block EXECUTED under sh (mmnto-ai/totem#2690): the string checks
// above pin the text; these pin the behavior the gate exists for. `git init` +
// a feature branch so the protected-branch block does not fire; the agent
// env var arms the strict tier the way an agent commit does.
describe('buildPreCommitHook strict evidence — executed under sh (mmnto-ai/totem#2690)', () => {
  const shellOk =
    spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-evidence-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git checkout -q -b feat/evidence', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pre-commit'), buildPreCommitHook(RENDER));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(): { status: number | null; stdout: string } {
    const r = spawnSync('sh', ['./pre-commit'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
    });
    return { status: r.status, stdout: r.stdout };
  }

  function writeRun(name: string, artifact: Record<string, unknown> | string): void {
    const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, name),
      typeof artifact === 'string' ? artifact : JSON.stringify(artifact, null, 2),
    );
  }

  // A `node` shim that fails: first on PATH, so the hook's reader cannot run.
  // Exercises the reader-failure arm without touching the real runtime.
  function shimNodeExiting(status: number): NodeJS.ProcessEnv {
    const shimDir = path.join(tmpDir, 'node-shim');
    fs.mkdirSync(shimDir, { recursive: true });
    fs.writeFileSync(path.join(shimDir, 'node'), `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
    return {
      ...process.env,
      CLAUDE_CODE_AGENT: '1',
      PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ''}`,
    };
  }

  function runHookWith(env: NodeJS.ProcessEnv): { status: number | null; stdout: string } {
    const r = spawnSync('sh', ['./pre-commit'], { cwd: tmpDir, encoding: 'utf-8', env });
    return { status: r.status, stdout: r.stdout };
  }

  it.skipIf(!shellOk)(
    'reports a reader that cannot run DISTINCTLY from missing evidence, and still fails closed',
    () => {
      const r = runHookWith(shimNodeExiting(5));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        '[Totem] BLOCKED: the spec-evidence reader could not run (node exit status 5',
      );
      expect(r.stdout).not.toContain('no totem spec run artifact');
    },
  );

  it.skipIf(!shellOk)(
    'a hand-set marker does not rescue a reader that cannot run — still the distinct failure, still closed',
    () => {
      fs.mkdirSync(path.join(tmpDir, '.totem', 'cache'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.totem', 'cache', '.spec-completed'), '');
      const r = runHookWith(shimNodeExiting(127));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('the spec-evidence reader could not run (node exit status 127');
      expect(r.stdout).not.toContain('legacy');
    },
  );

  it.skipIf(!shellOk)('blocks when this checkout carries no evidence at all', () => {
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "[Totem] BLOCKED: Run 'totem spec <issue>' before committing (strict mode)",
    );
    expect(r.stdout).toContain('no totem spec run artifact under .totem/artifacts/runs/');
  });

  it.skipIf(!shellOk)(
    'passes on a spec run artifact and prints the evidence line with its age',
    () => {
      writeRun('a.json', specEvidenceArtifact());
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('[Totem] spec evidence: .totem/artifacts/runs/a.json (');
      expect(r.stdout).toContain('0 days old');
    },
  );

  it.skipIf(!shellOk)(
    'does NOT pass on a review artifact that merely CARRIES a caller:spec object below the top level (the substring hazard)',
    () => {
      // A substring read of the run store would match this file: the key
      // spelling appears verbatim, as a carried OBJECT under inputBundle (the
      // shape a review over run metadata produces). Only the TOP-LEVEL
      // admission.runMetadata.caller is evidence. (Carried TEXT — a prompt that
      // quotes the key — is JSON-escaped on disk and never matches either read;
      // the carried-object form is the real hazard, so it is the control.)
      writeRun('r.json', {
        admission: { runMetadata: { caller: 'review' } },
        inputBundle: { runMetadata: { caller: 'spec' } },
        createdAt: new Date().toISOString(),
      });
      const onDisk = fs.readFileSync(path.join(tmpDir, '.totem/artifacts/runs/r.json'), 'utf-8');
      // Mutation check on the control itself: the naive pattern WOULD match.
      expect(/"caller": *"spec"/.test(onDisk)).toBe(true);
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('BLOCKED');
    },
  );

  it.skipIf(!shellOk)('ignores the retired hand-set marker — a marker alone is BLOCKED', () => {
    // No CLI path ever wrote `.totem/cache/.spec-completed`; honoring it would be
    // compatibility with a hand hack, not with a user (operator ruling
    // 2026-08-29, mmnto-ai/totem#2690).
    fs.mkdirSync(path.join(tmpDir, '.totem', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.totem', 'cache', '.spec-completed'), '');
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('no totem spec run artifact under .totem/artifacts/runs/');
    expect(r.stdout).not.toContain('spec evidence:');
  });

  it.skipIf(!shellOk)(
    'skips a torn (unparseable) artifact and still passes on a valid one beside it',
    () => {
      writeRun('torn.json', '{"admission": {"runMetadata": {"caller": "spec"');
      writeRun('ok.json', specEvidenceArtifact());
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('.totem/artifacts/runs/ok.json');
    },
  );

  it.skipIf(!shellOk)('blocks when the only artifact is torn', () => {
    writeRun('torn.json', '{"admission": {"runMetadata": {"caller": "spec"');
    const r = runHook();
    expect(r.status).toBe(1);
  });

  it.skipIf(!shellOk)('names the NEWEST spec artifact by its own createdAt', () => {
    writeRun('old.json', specEvidenceArtifact({ createdAt: '2026-01-01T00:00:00.000Z' }));
    writeRun('new.json', specEvidenceArtifact());
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('.totem/artifacts/runs/new.json');
    expect(r.stdout).not.toContain('old.json');
  });
});

// The mmnto-ai/totem#2700 arm, EXECUTED: an artifact is evidence only when it
// is ANCHORED (issue | record) and its SUBJECT carries a shape. Every negation
// must BLOCK with its OWN named reason — never with the "no artifact" line and
// never as a reader failure — because the reason is the whole cure.
describe('buildPreCommitHook anchored evidence — executed under sh (mmnto-ai/totem#2700)', () => {
  const shellOk =
    spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;
  /**
   * Whether this platform (and this account) can make a symlink — a Windows
   * account without SeCreateSymbolicLinkPrivilege cannot. Probed ONCE, outside
   * any test, so the skip is a real capability check rather than a swallowed
   * failure inside the assertion.
   */
  const symlinkable = ((): boolean => {
    const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-link-probe-'));
    const target = path.join(probeDir, 'target');
    fs.writeFileSync(target, 'probe');
    let ok = false;
    try {
      fs.symlinkSync(target, path.join(probeDir, 'sym'));
      ok = true;
    } catch (err) {
      void err;
      ok = false;
    }
    cleanTmpDir(probeDir);
    return ok;
  })();
  let tmpDir: string;
  /** A directory OUTSIDE the worktree — the target of the escaping-symlink case. */
  let outsideDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-anchor-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-outside-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git checkout -q -b feat/anchored', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pre-commit'), buildPreCommitHook(RENDER));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    cleanTmpDir(outsideDir);
  });

  function runHook(): { status: number | null; stdout: string } {
    const r = spawnSync('sh', ['./pre-commit'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
    });
    return { status: r.status, stdout: r.stdout };
  }

  function writeRun(name: string, artifact: Record<string, unknown>): void {
    const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(artifact, null, 2));
  }

  /** Write a bound record at a repo-relative path and return its sha256. */
  function writeRecord(relPath: string, body: string): string {
    const abs = path.join(tmpDir, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf-8');
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  }

  /** Every BLOCKED arm must be distinguishable from the other two arms. */
  function expectDistinctBlock(stdout: string): void {
    expect(stdout).not.toContain('no totem spec run artifact');
    expect(stdout).not.toContain('the spec-evidence reader could not run');
  }

  // ── The migration invariant ──

  it.skipIf(!shellOk)(
    'a PRE-EXISTING artifact (no grounding.anchor) BLOCKS with the `predates` reason, not the no-artifact line',
    () => {
      writeRun('legacy.json', {
        admission: { runMetadata: { caller: 'spec' } },
        output: { content: TEMPLATE_DRAFT },
        createdAt: new Date().toISOString(),
      });
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('predates the anchored-evidence rule (no grounding.anchor)');
      expect(r.stdout).toContain('.totem/artifacts/runs/legacy.json');
      expectDistinctBlock(r.stdout);
    },
  );

  // ── The unanchored kinds ──

  it.skipIf(!shellOk)('a `free-text` anchor BLOCKS, naming the kind and the topic', () => {
    writeRun(
      'ft.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'a loose slug' } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`is anchored ${GROUNDING_ANCHOR_FREE_TEXT} (a loose slug)`);
    expect(r.stdout).toContain('not gate evidence');
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a `mixed` anchor BLOCKS, naming the kind and the ref', () => {
    writeRun(
      'mx.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_MIXED, ref: '#2700 | a loose slug' } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`is anchored ${GROUNDING_ANCHOR_MIXED} (#2700 | a loose slug)`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('both cures are named on every BLOCKED arm', () => {
    writeRun(
      'ft.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'slug' } },
      }),
    );
    const r = runHook();
    expect(r.stdout).toContain("run 'totem spec <issue>' or 'totem spec --from <record>'");
  });

  // ── The TEMPLATE shape (issue anchor, built-in prompt) ──

  it.skipIf(!shellOk)(
    'the one-token draft (a lone newline) BLOCKS on the first missing heading',
    () => {
      writeRun('thin.json', specEvidenceArtifact({ output: { content: '\n' } }));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('is missing heading ### Problem Statement');
      expectDistinctBlock(r.stdout);
    },
  );

  it.skipIf(!shellOk)(
    'a promised heading present over an EMPTY body BLOCKS, naming the empty heading',
    () => {
      writeRun(
        'empty.json',
        specEvidenceArtifact({
          output: { content: '### Problem Statement\n\n### Implementation Tasks\n' },
        }),
      );
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('has an empty heading ### Problem Statement');
      expectDistinctBlock(r.stdout);
    },
  );

  it.skipIf(!shellOk)('a LATER required heading left empty BLOCKS, naming THAT heading', () => {
    // Every heading the promise names BEFORE `### Implementation Tasks` gets a
    // body, so the reader reaches it rather than blocking earlier on a missing
    // one: the assertion is about which heading is NAMED, and it can only be
    // about that if the draft is well-formed right up to the mutation
    // (mmnto-ai/totem#2737 extended the promise from two headings to nine).
    writeRun(
      'half.json',
      specEvidenceArtifact({
        output: {
          content: SPEC_REQUIRED_SECTIONS.map((heading) =>
            heading === '### Implementation Tasks'
              ? `${heading}\n`
              : `${heading}\n\nA real body.\n`,
          ).join('\n'),
        },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('has an empty heading ### Implementation Tasks');
  });

  it.skipIf(!shellOk)(
    'both required headings with bodies PASS, and the evidence line carries the anchor and the shape',
    () => {
      writeRun('ok.json', specEvidenceArtifact());
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('[Totem] spec evidence: .totem/artifacts/runs/ok.json (');
      expect(r.stdout).toContain(`· anchor ${GROUNDING_ANCHOR_ISSUE} #2700`);
      expect(r.stdout).toContain('· shape TEMPLATE');
    },
  );

  it.skipIf(!shellOk)('a non-string draft on an issue anchor BLOCKS as not-text', () => {
    writeRun('nt.json', specEvidenceArtifact({ output: { content: { nested: true } } }));
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('the draft is not text');
    expectDistinctBlock(r.stdout);
  });

  // ── The DOCUMENT shape (override prompt on an issue anchor) ──

  it.skipIf(!shellOk)(
    'an OVERRIDE-prompt draft without the template headings PASSES on one heading with a body',
    () => {
      writeRun(
        'ov.json',
        specEvidenceArtifact({
          admission: {
            runMetadata: { caller: 'spec', promptSource: PROMPT_SOURCE_OVERRIDE },
          },
          output: { content: DOCUMENT_DRAFT },
        }),
      );
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('· shape DOCUMENT');
    },
  );

  it.skipIf(!shellOk)('an OVERRIDE-prompt draft with no heading at all BLOCKS', () => {
    writeRun(
      'ovbad.json',
      specEvidenceArtifact({
        admission: { runMetadata: { caller: 'spec', promptSource: PROMPT_SOURCE_OVERRIDE } },
        output: { content: 'just prose, no heading\n' },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('has no heading with a body');
    expect(r.stdout).toContain('custom prompt');
    expectDistinctBlock(r.stdout);
  });

  // ── The record arm: the SUBJECT is the record's bytes ──

  function recordArtifact(ref: string, sha256: string, draft = TEMPLATE_DRAFT) {
    return specEvidenceArtifact({
      grounding: { anchor: { kind: GROUNDING_ANCHOR_RECORD, ref, sha256 } },
      output: { content: draft },
    });
  }

  it.skipIf(!shellOk)(
    'a present record with a heading and a body PASSES, reporting `record sha256 matches`',
    () => {
      const sha = writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      writeRun('rec.json', recordArtifact('.totem/specs/2700.md', sha));
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`· anchor ${GROUNDING_ANCHOR_RECORD} .totem/specs/2700.md`);
      expect(r.stdout).toContain('· shape DOCUMENT');
      expect(r.stdout).toContain('· record sha256 matches');
    },
  );

  it.skipIf(!shellOk)(
    'a REVISED record still PASSES — the digest is a SENSOR, never a gate',
    () => {
      const bound = writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      writeRun('rec.json', recordArtifact('.totem/specs/2700.md', bound));
      const now = writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract, folded.\n');
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        `record revised since binding (bound ${bound.slice(0, 8)}, now ${now.slice(0, 8)})`,
      );
    },
  );

  it.skipIf(!shellOk)('a MISSING record BLOCKS, naming the path it was bound at', () => {
    writeRun('rec.json', recordArtifact('.totem/specs/gone.md', 'b'.repeat(64)));
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('the bound record is missing at .totem/specs/gone.md');
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a record with NO heading-with-a-body BLOCKS', () => {
    const sha = writeRecord('.totem/specs/2700.md', 'prose with no heading\n');
    writeRun('rec.json', recordArtifact('.totem/specs/2700.md', sha));
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      'the bound record at .totem/specs/2700.md has no heading with a body',
    );
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)(
    'a record whose heading has no body BLOCKS (a heading alone is not a document)',
    () => {
      const sha = writeRecord('.totem/specs/2700.md', '# Heading only\n\n## Another heading\n');
      writeRun('rec.json', recordArtifact('.totem/specs/2700.md', sha));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('has no heading with a body');
    },
  );

  it.skipIf(!shellOk)(
    'a THIN draft with a rich record PASSES — the reader never reads output.content on a record anchor',
    () => {
      const sha = writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      writeRun('rec.json', recordArtifact('.totem/specs/2700.md', sha, '\n'));
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('· record sha256 matches');
    },
  );

  it.skipIf(!shellOk)(
    'a RICH draft with a missing record BLOCKS — the record is the subject, not the draft',
    () => {
      writeRun('rec.json', recordArtifact('.totem/specs/gone.md', 'c'.repeat(64), TEMPLATE_DRAFT));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('the bound record is missing at');
    },
  );

  // ── The body-line boundary is a HEADING, not a leading "#" ──
  //
  // `#2700 is the issue.` is prose about an issue number, not a heading: no
  // space follows the hashes. Reading it as a boundary made a real body look
  // empty — the exact sentence a totem design record is most likely to open a
  // section with.

  it.skipIf(!shellOk)('a body line starting with `#2700` is a BODY on the TEMPLATE arm', () => {
    const draft = SPEC_REQUIRED_SECTIONS.map(
      (heading) => `${heading}\n\n#2700 is the issue.\n`,
    ).join('\n');
    writeRun('hashbody.json', specEvidenceArtifact({ output: { content: draft } }));
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('· shape TEMPLATE');
  });

  it.skipIf(!shellOk)('a body line starting with `#2700` is a BODY on the DOCUMENT arm', () => {
    const sha = writeRecord('.totem/specs/2700.md', '# Record\n\n#2700 is the issue.\n');
    writeRun('hashrec.json', recordArtifact('.totem/specs/2700.md', sha));
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('· record sha256 matches');
  });

  // ── The DOCUMENT shape tolerates two ordinary authoring bytes ──

  it.skipIf(!shellOk)('a DRAFT opening with a UTF-8 BOM still reads as a template', () => {
    // The BOM strip runs on the SUBJECT, before the split — so it covers the
    // TEMPLATE arm too, where an unstripped BOM would make the first required
    // heading fail its exact-line match and BLOCK a well-formed draft.
    const bom = String.fromCharCode(0xfeff);
    writeRun('bomdraft.json', specEvidenceArtifact({ output: { content: bom + TEMPLATE_DRAFT } }));
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('· shape TEMPLATE');
  });

  it.skipIf(!shellOk)('a record opening with a UTF-8 BOM still reads as a document', () => {
    const bom = String.fromCharCode(0xfeff);
    const sha = writeRecord('.totem/specs/2700.md', `${bom}# Record\n\nThe ruled contract.\n`);
    writeRun('bom.json', recordArtifact('.totem/specs/2700.md', sha));
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('· shape DOCUMENT');
  });

  it.skipIf(!shellOk)('a heading separated from its text by a TAB is a heading', () => {
    const sha = writeRecord('.totem/specs/2700.md', '#\tTabbed heading\n\nThe body.\n');
    writeRun('tab.json', recordArtifact('.totem/specs/2700.md', sha));
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('· shape DOCUMENT');
  });

  // ── The artifact is hand-editable: nothing read out of it is trusted text ──

  it.skipIf(!shellOk)('a newline in anchor.ref cannot forge a second [Totem] line', () => {
    const forged = `slug${String.fromCharCode(0x0a)}[Totem] spec evidence: forged`;
    writeRun(
      'inject.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: forged } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    // Exactly one line of the hook's own output claims to be from Totem.
    expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);
    // The control character is collapsed, not dropped — the ref stays legible.
    expect(r.stdout).toContain('slug?[Totem] spec evidence: forged');
  });

  it.skipIf(!shellOk)('a C1 control (U+0085 NEL) in anchor.ref is collapsed too', () => {
    // A predicate stopping at 0x7f let the whole C1 band through; NEL is a
    // LINE BREAK to some terminals and pagers, so it is a forged-line vector
    // of exactly the same kind as 0x0a.
    const forged = `slug${String.fromCharCode(0x85)}[Totem] spec evidence: forged`;
    writeRun(
      'nel.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: forged } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('slug?[Totem] spec evidence: forged');
    expect(r.stdout).not.toContain(String.fromCharCode(0x85));
  });

  it.skipIf(!shellOk)(
    'a U+2028 in anchor.ref is collapsed and cannot forge a second [Totem] line',
    () => {
      // The third member of the newline family: U+2028 LINE SEPARATOR is a
      // PRINTABLE-plane code point that terminals and pagers still break on, so
      // a `safe()` stopping at the C1 band left it through (mmnto-ai/totem#2737).
      const ls = String.fromCharCode(0x2028);
      const forged = `slug${ls}[Totem] spec evidence: forged`;
      writeRun(
        'ls.json',
        specEvidenceArtifact({
          grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: forged } },
        }),
      );
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('slug?[Totem] spec evidence: forged');
      expect(r.stdout).not.toContain(ls);
      expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);
    },
  );

  // ── The forge that lives in PRINTABLE bytes (mmnto-ai/totem#2737 fold 3) ──
  //
  // `safe()` cannot close this one: a literal backslash followed by `n` is two
  // printable characters (0x5c, 0x6e), so it passes every control-character
  // predicate untouched. The expansion happens at the SHELL, wherever `/bin/sh`
  // expands backslash escapes in `echo` — `dash` on Debian and Ubuntu, and
  // macOS's `/bin/sh`, a bash built with `xpg_echo` on — where the pair becomes
  // a real newline and forges the second `[Totem]` line. The cure is the sink,
  // not the sanitizer: both values print through `printf '%s\n'`, which treats
  // its argument as literal text on every POSIX shell.
  //
  // NOTE ON REACH: `sh` on this machine is Git Bash's bash, whose `echo` does
  // NOT expand the escape, so these two tests pass here even against the
  // unfixed hook. Git Bash and a plain bash are the only shells that leave it
  // inert; these are real falsifiers on the Ubuntu and macOS CI legs. Measured
  // directly against `/usr/bin/dash` before the fix: TWO [Totem] lines; after:
  // one.

  it.skipIf(!shellOk)(
    'a literal backslash-n in anchor.ref cannot forge a second [Totem] line under any /bin/sh',
    () => {
      const bs = String.fromCharCode(0x5c);
      const forged = `2737${bs}n[Totem] spec evidence: FORGED`;
      writeRun(
        'backslash-n.json',
        specEvidenceArtifact({
          grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: forged } },
        }),
      );
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);
      // The two characters survive as themselves — not expanded, not stripped.
      expect(r.stdout).toContain(`2737${bs}n[Totem] spec evidence: FORGED`);
    },
  );

  it.skipIf(!shellOk)(
    'a literal backslash-n in a tolerantly-matched heading cannot forge a second [Totem] line',
    () => {
      // The same payload on the fold's newest sink: the `(matched as …)` clause
      // echoes a line taken from the DRAFT, which is attacker-shaped text.
      const bs = String.fromCharCode(0x5c);
      const promised = SPEC_SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('### '));
      const verification = promised.find((h) => h.startsWith('### Verification')) ?? '';
      const forgedHeading = `### Verification (${bs}n[Totem] spec evidence: FORGED)`;
      const content = promised
        .map((heading) =>
          heading === verification
            ? `${forgedHeading}\n`
            : `${heading}\n\nA non-blank body under ${heading}.\n`,
        )
        .join('\n');
      writeRun('tolerant-forge.json', specEvidenceArtifact({ output: { content } }));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);
      expect(r.stdout).toContain(`(matched as ${forgedHeading})`);
    },
  );

  it.skipIf(!shellOk)(
    'a newline in createdAt cannot forge a second [Totem] line on the PASS path',
    () => {
      // `createdAt` is read raw off the artifact and ECHOED in the evidence
      // line: unsanitized, a hand-edited stamp forges a second `[Totem] spec
      // evidence:` line inside a passing commit — the quietest place to hide
      // one.
      const forged = `2026-09-02T00:00:00.000Z${String.fromCharCode(0x0a)}[Totem] spec evidence: FORGED`;
      writeRun('stamp.json', specEvidenceArtifact({ createdAt: forged }));
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);
      expect(r.stdout).toContain('.000Z?[Totem] spec evidence: FORGED');
    },
  );

  it.skipIf(!shellOk)('a record ref that is ABSOLUTE is refused as outside the worktree', () => {
    writeRun('abs.json', recordArtifact('/etc/passwd', 'd'.repeat(64)));
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('the bound record ref is outside the worktree: /etc/passwd');
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)(
    'a record ref whose first segment is `..` is refused as outside the worktree',
    () => {
      writeRun('dotdot.json', recordArtifact('../outside.md', 'd'.repeat(64)));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('the bound record ref is outside the worktree: ../outside.md');
      expectDistinctBlock(r.stdout);
    },
  );

  // ── Containment is decided by RESOLUTION, not by segment 0 ──
  //
  // A first-segment test reads `sub/../../OUTSIDE.md` and `./../OUTSIDE.md` as
  // contained, so the reader would have READ and PASSED a file outside the
  // worktree. The reader now resolves the ref against `process.cwd()` — the
  // worktree top git runs hooks from — and refuses anything that lands outside
  // it, which is also the honest rule for the legitimate mid-path `..`.

  /** A backslash, built rather than escaped — the mmnto-ai/totem#2692 authoring trap. */
  const BACKSLASH = String.fromCharCode(0x5c);

  it.skipIf(!shellOk).each([
    ['sub/../../OUTSIDE.md', 'a `..` past segment 0'],
    ['./../OUTSIDE.md', 'a `.` first segment hiding a `..`'],
    [
      `a${BACKSLASH}..${BACKSLASH}..${BACKSLASH}OUTSIDE.md`,
      'the same escape spelled with backslashes',
    ],
  ])('refuses %s as outside the worktree (%s)', (ref) => {
    writeRun('escape.json', recordArtifact(ref, 'd'.repeat(64)));
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`the bound record ref is outside the worktree: ${ref}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)(
    'a mid-path `..` that stays INSIDE the worktree still PASSES — containment, not a segment ban',
    () => {
      // `a/` must exist for POSIX path resolution to reach `a/../b.md`.
      fs.mkdirSync(path.join(tmpDir, 'a'), { recursive: true });
      const sha = writeRecord('b.md', '# Record\n\nThe ruled contract.\n');
      writeRun('inside.json', recordArtifact('a/../b.md', sha));
      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('· record sha256 matches');
    },
  );

  it.skipIf(!shellOk)(
    'a record anchor with NO sha256 BLOCKS — a binding without bytes is not a binding',
    () => {
      writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      writeRun(
        'nosha.json',
        specEvidenceArtifact({
          grounding: { anchor: { kind: GROUNDING_ANCHOR_RECORD, ref: '.totem/specs/2700.md' } },
        }),
      );
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('the record anchor carries no sha256 — not evidence');
      expectDistinctBlock(r.stdout);
    },
  );

  it.skipIf(!shellOk)(
    'a record anchor whose sha256 is MALFORMED BLOCKS with its OWN reason, not the absent one',
    () => {
      // "No digest" and "a digest that is not a digest" are different repairs:
      // the first says re-bind, the second says the artifact was edited. One
      // shared message would send both to the wrong cure.
      writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      writeRun('badsha.json', recordArtifact('.totem/specs/2700.md', 'not-a-digest'));
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        'the record anchor sha256 is not a 64-hex digest (not-a-digest) — not evidence',
      );
      expect(r.stdout).not.toContain('carries no sha256');
      expectDistinctBlock(r.stdout);
    },
  );

  // ── Containment sees THROUGH a link (mmnto-ai/totem#2700) ──
  //
  // A symlink inside the worktree is LEXICALLY contained, so the resolve-based
  // test above reads it as legal — and the reader would open, hash and judge a
  // file outside the tree. The realpath pair is compared once the ref is known
  // to exist and BEFORE its bytes are read.

  it.skipIf(!shellOk || !symlinkable)(
    'a record ref that is a SYMLINK to OUTSIDE the worktree BLOCKS, naming both spellings',
    () => {
      const target = path.join(outsideDir, 'record.md');
      fs.writeFileSync(target, '# Outside\n\nThe ruled contract.\n', 'utf-8');
      const sha = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      fs.symlinkSync(target, path.join(tmpDir, 'linked.md'));
      // A CORRECT digest, so the block cannot be the sha256 arm firing early.
      writeRun('symlink-out.json', recordArtifact('linked.md', sha));

      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('the bound record resolves outside the worktree: linked.md -> ');
      expect(r.stdout).toContain(fs.realpathSync.native(target));
      expectDistinctBlock(r.stdout);
    },
  );

  it.skipIf(!shellOk || !symlinkable)(
    'a record ref that is a SYMLINK to an IN-worktree file PASSES — containment, not a link ban',
    () => {
      const sha = writeRecord('.totem/specs/2700.md', '# Record\n\nThe ruled contract.\n');
      fs.symlinkSync(
        path.join(tmpDir, '.totem', 'specs', '2700.md'),
        path.join(tmpDir, 'linked.md'),
      );
      writeRun('symlink-in.json', recordArtifact('linked.md', sha));

      const r = runHook();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('· record sha256 matches');
    },
  );

  // ── The cure names the cache (mmnto-ai/totem#2700 m11) ──

  it.skipIf(!shellOk)(
    'the BLOCKED cure names --fresh — a cached response mints no artifact',
    () => {
      writeRun(
        'ft.json',
        specEvidenceArtifact({
          grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'slug' } },
        }),
      );
      const r = runHook();
      expect(r.stdout).toContain('(add --fresh if the response is cached)');
    },
  );

  // ── The other arms stay distinct ──

  it.skipIf(!shellOk)('exit 3 is NEVER reported as a reader failure', () => {
    writeRun(
      'ft.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'slug' } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('node exit status');
  });

  it.skipIf(!shellOk)(
    'the carried-object substring control still BLOCKS with the no-artifact line',
    () => {
      // Only the TOP-LEVEL caller counts: a review artifact that carries a
      // `caller: spec` object below the top level is not a spec artifact at all,
      // so the gate reports "none found", not "not evidence".
      writeRun('r.json', {
        admission: { runMetadata: { caller: 'review' } },
        inputBundle: { runMetadata: { caller: 'spec' } },
        createdAt: new Date().toISOString(),
      });
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('no totem spec run artifact');
    },
  );

  it.skipIf(!shellOk)('the retired hand-set marker still rescues nothing', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem', 'cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.totem', 'cache', '.spec-completed'), '');
    writeRun(
      'ft.json',
      specEvidenceArtifact({
        grounding: { anchor: { kind: GROUNDING_ANCHOR_FREE_TEXT, ref: 'slug' } },
      }),
    );
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('spec evidence:');
  });
});

// The mmnto-ai/totem#2692 keystone, EXECUTED: under a custom `totemDir` the
// hook's reader and `totem spec`'s writer must name the SAME tree. The fixture
// writes where the WRITER writes (`<totemDir>/artifacts/runs`, the
// `path.join(configRoot, config.totemDir)/artifacts/runs` the run store uses) and
// the hook is rendered at that same totemDir — so a pass here is the two halves
// agreeing, and the control below is the pre-fix behavior (evidence under
// `.totem/` while the hook reads `knowledge/`) still failing closed.
describe('buildPreCommitHook strict evidence under a CUSTOM totemDir — executed under sh (mmnto-ai/totem#2692)', () => {
  const shellOk =
    spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;
  const CUSTOM_TOTEM_DIR = 'knowledge';
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-customdir-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git checkout -q -b feat/evidence', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(
      path.join(tmpDir, 'pre-commit'),
      buildPreCommitHook({ ...RENDER, totemDir: CUSTOM_TOTEM_DIR }),
    );
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(): { status: number | null; stdout: string } {
    const r = spawnSync('sh', ['./pre-commit'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
    });
    return { status: r.status, stdout: r.stdout };
  }

  /** Write a run artifact where the WRITER writes it, for an arbitrary totemDir. */
  function writeRunUnder(totemDir: string, name: string, artifact: Record<string, unknown>): void {
    const dir = path.join(tmpDir, ...totemDir.split('/'), 'artifacts', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(artifact, null, 2));
  }

  const specArtifact = (): Record<string, unknown> => specEvidenceArtifact();

  it.skipIf(!shellOk)('PASSES on evidence written under the configured totemDir', () => {
    writeRunUnder(CUSTOM_TOTEM_DIR, 'a.json', specArtifact());
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `[Totem] spec evidence: ${CUSTOM_TOTEM_DIR}/artifacts/runs/a.json (`,
    );
  });

  it.skipIf(!shellOk)(
    'the pre-fix control: evidence under .totem/ does NOT satisfy a hook rendered for knowledge/',
    () => {
      // This is the mmnto-ai/totem#2692 defect, inverted: before the fix the hook
      // ALWAYS read `.totem/artifacts/runs` while the writer used the configured
      // dir, so the gate failed closed forever. With the hook rendered at the
      // configured dir, evidence in the WRONG tree is correctly not evidence.
      writeRunUnder('.totem', 'a.json', specArtifact());
      const r = runHook();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        `no totem spec run artifact under ${CUSTOM_TOTEM_DIR}/artifacts/runs/`,
      );
    },
  );

  it.skipIf(!shellOk)('blocks with a message naming the configured directory', () => {
    const r = runHook();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "[Totem] BLOCKED: Run 'totem spec <issue>' before committing (strict mode)",
    );
    expect(r.stdout).toContain(`under ${CUSTOM_TOTEM_DIR}/artifacts/runs/`);
    expect(r.stdout).not.toContain('.totem');
  });

  it.skipIf(!shellOk)('a nested totemDir survives the same round trip', () => {
    const nested = 'var/totem-state';
    fs.writeFileSync(
      path.join(tmpDir, 'pre-commit'),
      buildPreCommitHook({ ...RENDER, totemDir: nested }),
    );
    writeRunUnder(nested, 'a.json', specArtifact());
    const r = runHook();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`[Totem] spec evidence: ${nested}/artifacts/runs/a.json (`);
  });
});

describe('buildPreCommitHook with standard tier', () => {
  it('includes the spec-evidence check guarded by agent/tier condition', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('.totem/artifacts/runs');
    expect(hook).toContain('is_agent');
    expect(hook).toContain('TOTEM_HOOK_TIER="standard"');
  });

  // Pre-mmnto-ai/totem#2692 this read "defaults to standard tier when no tier
  // specified". There is no default any more — the options object is required and
  // the RESOLVER supplies 'standard' — so the surviving intent is that the
  // standard-tier render still names the run store the resolver hands it.
  it('renders the run store at the options it was given', () => {
    const hook = buildPreCommitHook(RENDER);
    expect(hook).toContain('TOTEM_HOOK_TIER="standard"');
    expect(hook).toContain('.totem/artifacts/runs');
  });
});

describe('buildPrePushHook with strict tier', () => {
  it('includes shield gate', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('review');
    expect(hook).toContain('shield gate (strict mode)');
  });

  it('includes TOTEM_HOOK_TIER set to strict', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('TOTEM_HOOK_TIER="strict"');
  });

  it('includes agent detection snippet', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('is_agent=0');
    expect(hook).toContain('CLAUDE_CODE_AGENT');
  });

  // mmnto-ai/totem#1908 — doctor --strict is wired into the strict-tier
  // shieldBlock alongside the existing `totem review` gate. Repo-state
  // checks (like checkAgentsMdCanonical) now block push when they fail.
  it('includes $TOTEM_CMD doctor --strict in the shield block', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    expect(hook).toContain('$TOTEM_CMD doctor --strict');
    expect(hook).toContain('doctor --strict (repo-state gate)');
  });

  it('gates doctor --strict on the agent/strict guard (does NOT fire unconditionally)', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    // Find the position of the doctor --strict invocation and the surrounding
    // guard; assert the invocation lives INSIDE the agent-or-tier block.
    const doctorIdx = hook.indexOf('$TOTEM_CMD doctor --strict');
    // Anchored on the guard that ENCLOSES this invocation: since
    // mmnto-ai/totem#2698 the pre-push hook carries more than one agent/strict
    // guard (the review-leg floor arm has its own, and it is rendered first),
    // so a bare first-match lookup would measure the wrong block.
    const guardIdx = hook.lastIndexOf(
      'if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]',
      doctorIdx,
    );
    // Anchored to a LINE, not a substring: a bare `fi` also matches the one
    // inside "findings" in the shield block's comment, which sits between the
    // invocation and the real closing `fi` (CodeRabbit on PR mmnto-ai/totem#2745).
    const fiCloseIdx = hook.indexOf(`${String.fromCharCode(10)}  fi`, doctorIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(doctorIdx).toBeGreaterThan(guardIdx);
    expect(doctorIdx).toBeLessThan(fiCloseIdx);
  });
});

describe('buildPrePushHook with standard tier', () => {
  it('includes shield gate guarded by agent/tier condition', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('shield gate');
    expect(hook).toContain('is_agent');
    expect(hook).toContain('TOTEM_HOOK_TIER="standard"');
  });

  // Pre-mmnto-ai/totem#2692 this read "defaults to standard tier when no tier
  // specified" — the builders take a REQUIRED options object now, so the
  // surviving intent is that a standard-tier render stamps the standard tier.
  it('stamps the standard tier it was given', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('TOTEM_HOOK_TIER="standard"');
    expect(hook).toContain('shield gate');
  });

  it('still includes agent detection', () => {
    const hook = buildPrePushHook(RENDER);
    expect(hook).toContain('is_agent=0');
  });

  // mmnto-ai/totem#1908 — even in standard tier, the doctor --strict line
  // is emitted inside the same agent/strict guard so an agent (detected via
  // CLAUDE_CODE_AGENT etc.) still gets the gate. Standard-tier human
  // operators bypass it because their `is_agent=0` and `TOTEM_HOOK_TIER` is
  // standard, so the guard branch never enters.
  it('emits doctor --strict gated by agent/strict guard (no unconditional fire in standard tier)', () => {
    const hook = buildPrePushHook(RENDER);
    const doctorIdx = hook.indexOf('$TOTEM_CMD doctor --strict');
    // Anchored on the guard that ENCLOSES this invocation: since
    // mmnto-ai/totem#2698 the pre-push hook carries more than one agent/strict
    // guard (the review-leg floor arm has its own, and it is rendered first),
    // so a bare first-match lookup would measure the wrong block.
    const guardIdx = hook.lastIndexOf(
      'if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]',
      doctorIdx,
    );
    // Anchored to a LINE, not a substring: a bare `fi` also matches the one
    // inside "findings" in the shield block's comment, which sits between the
    // invocation and the real closing `fi` (CodeRabbit on PR mmnto-ai/totem#2745).
    const fiCloseIdx = hook.indexOf(`${String.fromCharCode(10)}  fi`, doctorIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(doctorIdx).toBeGreaterThan(guardIdx);
    expect(doctorIdx).toBeLessThan(fiCloseIdx);
  });
});

describe('agent detection uses POSIX syntax', () => {
  it('pre-commit hook has no bashisms', () => {
    const hook = buildPreCommitHook({ ...RENDER, tier: 'strict' });
    // Must use [ ] not [[ ]]
    expect(hook).not.toContain('[[');
    expect(hook).not.toContain(']]');
    // Must use = not ==
    expect(hook).not.toMatch(/[^!]==/);
    // Must use test or [ ], not bash-only constructs
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });

  it('pre-push hook has no bashisms', () => {
    const hook = buildPrePushHook({ ...RENDER, tier: 'strict' });
    // Must use [ ] not [[ ]]
    expect(hook).not.toContain('[[');
    expect(hook).not.toContain(']]');
    // Must use = not ==
    expect(hook).not.toMatch(/[^!]==/);
    // Must use #!/bin/sh
    expect(hook).toMatch(/^#!\/bin\/sh\n/);
  });
});

// ─── The strict pre-push review-leg floor arm (mmnto-ai/totem#2698) ──────────

describe('buildPrePushHook — the review-leg floor arm (mmnto-ai/totem#2698)', () => {
  const hook = buildPrePushHook(RENDER);

  it("probes the VERB's own help for an option only that verb has", () => {
    expect(hook).toContain(
      `if $TOTEM_CMD legs gate --help 2>/dev/null | grep -q -- '--advisory'; then`,
    );
    // NOT the group's help for the word `gate` (mmnto-ai/totem#2698 fold 2): a
    // CLI predating `totem legs` answers any `legs …` with its curated
    // TOP-LEVEL help and exits 0, so that grep reads a moving surface and the
    // queued `merge-gate` verb (mmnto-ai/totem#2708) would satisfy it.
    expect(hook).not.toContain(`$TOTEM_CMD legs --help`);
  });

  it('invokes the bare gate on strict and the advisory form otherwise', () => {
    expect(hook).toContain('$TOTEM_CMD legs gate\n');
    expect(hook).toContain('$TOTEM_CMD legs gate --advisory');
    expect(hook).toContain('legs_status=$?');
  });

  it('blocks on exit 3 and on any other non-zero with DISTINCT lines', () => {
    expect(hook).toContain(
      `echo "[Totem] BLOCKED: this push is legs-owed and carries no fresh falsification-leg deposit — run the leg, then 'totem legs deposit --sha HEAD --from <findings.json>' (mmnto-ai/totem#2698, strict mode)"`,
    );
    expect(hook).toContain(
      'echo "[Totem] BLOCKED: the legs gate could not derive (totem legs gate exit status $legs_status) — fix the checkout and retry (strict mode)"',
    );
    expect(hook).toContain('if [ "$legs_status" = "3" ]; then');
    expect(hook).toContain('elif [ "$legs_status" != "0" ]; then');
  });

  it('FAILS CLOSED on strict when the resolved CLI lacks the verb, compat-opens otherwise', () => {
    // The OPPOSITE of the `--gate` / `--scope-to-diff` precedent, by ruling
    // (mmnto-ai/totem#2698 OQ2): those flags degrade to a form that still runs;
    // an absent VERB has no degraded form, so strict blocks with the cure.
    expect(hook).toContain(
      `echo "[Totem] BLOCKED: this hook expects 'totem legs gate' (mmnto-ai/totem#2698) but the resolved CLI lacks it — 'npm i -g @mmnto/cli@latest' (strict mode)" >&2`,
    );
    expect(hook).toContain(
      `echo "[totem] Hook running without the legs gate (CLI predates 'totem legs'); 'npm i -g @mmnto/cli@latest' enables it." >&2`,
    );
  });

  it('runs BEFORE the shield block and inside the $TOTEM_CMD guard', () => {
    const cmdGuardIdx = hook.indexOf('if [ -n "$TOTEM_CMD" ]; then');
    const legsIdx = hook.indexOf('$TOTEM_CMD legs gate --help');
    const shieldIdx = hook.indexOf('Running shield gate (strict mode)');
    expect(cmdGuardIdx).toBeGreaterThan(-1);
    expect(legsIdx).toBeGreaterThan(cmdGuardIdx);
    // Slotted first so a legs-owed push is not paid for with the slow review gate.
    expect(legsIdx).toBeLessThan(shieldIdx);
  });

  it('gates the blocking arms on the agent/strict guard', () => {
    const legsIdx = hook.indexOf('$TOTEM_CMD legs gate --help');
    const guardIdx = hook.indexOf(
      'if [ "$is_agent" = "1" ] || [ "$TOTEM_HOOK_TIER" = "strict" ]',
      legsIdx,
    );
    const gateIdx = hook.indexOf('$TOTEM_CMD legs gate\n');
    expect(guardIdx).toBeGreaterThan(legsIdx);
    expect(gateIdx).toBeGreaterThan(guardIdx);
  });
});

// The arm, EXECUTED. String assertions alone are satisfiable without the
// behavior, and the exit-code mapping IS the contract here. The stub `totem` is
// the FIRST entry on an isolated PATH and records its argv, so every case
// proves the hook actually reached it — an un-isolated PATH or a stub on the
// wrong stream is the false-green shape this suite exists to exclude.
describe('the review-leg floor arm executed under sh (mmnto-ai/totem#2698)', () => {
  const shellOk = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf-8' }).status === 0;
  let tmpDir: string;
  let repoDir: string;
  let binDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-hook-'));
    repoDir = path.join(tmpDir, 'repo');
    binDir = path.join(tmpDir, 'stub-bin');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(binDir);
    // Forward slashes: the stub is read by `sh`, and a Windows path's
    // backslashes would not survive the shell's quoting.
    logPath = path.join(tmpDir, 'totem-invocations.log').split(path.sep).join('/');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * A stub `totem` that records every invocation, answers the `legs --help`
   * probe with the given help text, and exits `gateExit` for `legs gate`. The
   * bare repo dir clears every earlier hook gate (no manifest, no compiled
   * rules, no lockfile, no package.json), so the legs arm and the shield block
   * are the only live ones.
   */
  function writeStub(params: { helpText: string; helpExit?: number; gateExit?: number }): void {
    const stub = [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> "${logPath}"`,
      // The help arm is tested FIRST and on THREE words: since
      // mmnto-ai/totem#2698 fold 2 the probe is `legs gate --help`, which also
      // matches the gate arm's first two.
      'if [ "$1" = "legs" ] && [ "$2" = "gate" ] && [ "$3" = "--help" ]; then',
      "  cat <<'TOTEM_STUB_HELP'",
      params.helpText,
      'TOTEM_STUB_HELP',
      `  exit ${params.helpExit ?? 0}`,
      'fi',
      'if [ "$1" = "legs" ] && [ "$2" = "gate" ]; then',
      '  echo "[Totem] legs: stub gate line"',
      `  exit ${params.gateExit ?? 0}`,
      'fi',
      'exit 0',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(binDir, 'totem'), stub, { mode: 0o755 });
  }

  /**
   * The verb's OWN help, and the top-level help an older CLI answers with.
   *
   * The unsupported fixture is a HOSTILE VARIANT of the 1.122.0 shape, not
   * that shape verbatim: the measured seven-command top-level help contains no
   * `gate` at all, so today's probe does not false-pass on it. This fixture
   * INJECTS a `merge-gate` entry (mmnto-ai/totem#2708 is queued for that list),
   * so the OLD group-level grep would false-pass and the verb-specific probe
   * must not. The defect it guards is latent, and this is what keeps it so.
   */
  const HELP_WITH_GATE =
    'Usage: totem legs gate [options]\n\nOptions:\n  --advisory  Print the same lines for every state\n  -h, --help  display help for command';
  const HELP_WITHOUT_GATE =
    'Totem: local-first toolkit\n\nUsage: totem [command]\n\nCommands:\n  init         Initialize Totem\n  lint         Run compiled rules\n  merge-gate   Gate a merge';

  function runHook(options: { tier: 'strict' | 'standard'; agent: boolean }): {
    status: number | null;
    stdout: string;
    stderr: string;
  } {
    fs.writeFileSync(
      path.join(repoDir, 'pre-push'),
      buildPrePushHook({ ...RENDER, tier: options.tier }),
    );
    // Every agent-detection variable is cleared explicitly: this suite runs
    // inside an agent session, and an inherited CLAUDE_CODE_AGENT would make
    // the standard-tier cases silently exercise the strict arm.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [binDir, process.env['PATH'] ?? ''].join(path.delimiter),
    };
    delete env['CLAUDE_CODE_AGENT'];
    delete env['CLAUDE_VERSION'];
    delete env['CURSOR_TRACE_ID'];
    if (options.agent) env['CLAUDE_CODE_AGENT'] = '1';
    const result = spawnSync('sh', ['./pre-push'], { cwd: repoDir, env, encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  /** Every recorded stub invocation, in order. Empty when it was never reached. */
  const invocations = (): string[] => {
    const native = logPath.split('/').join(path.sep);
    return fs.existsSync(native) ? fs.readFileSync(native, 'utf-8').trim().split('\n') : [];
  };

  it.skipIf(!shellOk)('probe UNSUPPORTED + strict: blocks with the upgrade line', () => {
    writeStub({ helpText: HELP_WITHOUT_GATE });
    const r = runHook({ tier: 'strict', agent: false });
    expect(invocations()).toContain('legs gate --help');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("this hook expects 'totem legs gate'");
    expect(r.stderr).toContain('npm i -g @mmnto/cli@latest');
    // Fail-closed means the gate was never invoked, not that it passed.
    expect(invocations()).not.toContain('legs gate');
  });

  it.skipIf(!shellOk)('probe UNSUPPORTED + standard: passes with the compat line on stderr', () => {
    writeStub({ helpText: HELP_WITHOUT_GATE });
    const r = runHook({ tier: 'standard', agent: false });
    expect(invocations()).toContain('legs gate --help');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("Hook running without the legs gate (CLI predates 'totem legs')");
  });

  it.skipIf(!shellOk)('gate exit 3 + strict: blocks with the legs-owed line and the cure', () => {
    writeStub({ helpText: HELP_WITH_GATE, gateExit: 3 });
    const r = runHook({ tier: 'strict', agent: false });
    expect(invocations()).toContain('legs gate');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[Totem] BLOCKED: this push is legs-owed');
    expect(r.stdout).toContain('totem legs deposit --sha HEAD --from <findings.json>');
    // The gate's own line is not swallowed.
    expect(r.stdout).toContain('[Totem] legs: stub gate line');
  });

  it.skipIf(!shellOk)('gate exit 2 + strict: blocks with the DISTINCT not-derived line', () => {
    writeStub({ helpText: HELP_WITH_GATE, gateExit: 2 });
    const r = runHook({ tier: 'strict', agent: false });
    expect(invocations()).toContain('legs gate');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('the legs gate could not derive (totem legs gate exit status 2)');
    expect(r.stdout).not.toContain('this push is legs-owed');
  });

  it.skipIf(!shellOk)('gate exit 0 + strict: the hook proceeds PAST the arm', () => {
    writeStub({ helpText: HELP_WITH_GATE, gateExit: 0 });
    const r = runHook({ tier: 'strict', agent: false });
    expect(invocations()).toContain('legs gate');
    // The shield block sits after the arm — reaching it proves the arm passed.
    expect(invocations()).toContain('doctor --strict');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('BLOCKED');
  });

  it.skipIf(!shellOk)('an AGENT on the standard tier still takes the strict arm', () => {
    writeStub({ helpText: HELP_WITH_GATE, gateExit: 3 });
    const r = runHook({ tier: 'standard', agent: true });
    expect(invocations()).toContain('legs gate');
    expect(invocations()).not.toContain('legs gate --advisory');
    expect(r.status).toBe(1);
  });

  it.skipIf(!shellOk)(
    'standard tier, no agent: --advisory is passed and exit 3 does NOT block',
    () => {
      writeStub({ helpText: HELP_WITH_GATE, gateExit: 3 });
      const r = runHook({ tier: 'standard', agent: false });
      // Read from the recorded argv, not from the hook text: the flag has to
      // have reached the CLI, not merely appear in the template.
      expect(invocations()).toContain('legs gate --advisory');
      expect(invocations()).not.toContain('legs gate');
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('BLOCKED');
    },
  );
});

// The arm COMPOSED with the real gate (mmnto-ai/totem#2698 fold 2, MATERIAL).
//
// The stub suite above proves the hook's exit MAPPING — it scripts the gate's
// status, so the gate's own derivation is never exercised through the hook, and
// a gate that stopped returning 3 for an owed-and-unanswered push would leave
// every one of those tests green. This suite closes that: the shim on the
// isolated PATH DELEGATES `legs` to the real built CLI, so each case runs the
// whole composition — predicate, store, ancestry, exit code, hook arm, hook
// line. Everything after the arm (the shield block's `doctor --strict` and
// `review --gate`) is a different gate with its own coverage and stays stubbed,
// so this suite's verdict never depends on state it does not control.
//
// COVERAGE DECLARATION (Q5). It needs `packages/cli/dist/index.js`, which
// exists after this repo's CI builds before it tests (`pnpm -r build` precedes
// the test run); when it does not, every case SKIPS rather than passing
// vacuously, and the skip is visible in the reporter. It runs wherever `sh`
// resolves: win32 through git-bash, plus the ubuntu and macos CI legs. The stub
// suite above is retained and carries the mapping, including the states this
// suite cannot reach through a real CLI (a build that predates the verb).
//
// One case inside it is POSIX-only, and says so at its own site: a quote- and
// backslash-bearing owed path cannot exist on NTFS. Every other case, the
// non-ASCII one included, runs on win32 too.
describe('the review-leg floor arm COMPOSED with the real gate (mmnto-ai/totem#2698)', () => {
  /** Built, never authored as an escape (the banked decode trap). */
  const NL = String.fromCharCode(10);
  /**
   * A NON-ASCII owed path (mmnto-ai/totem#2698 fold 4). git C-quotes this name
   * on BOTH surfaces the gate reads, in two different ways, so an un-normalized
   * pair reports a covering leg as covering nothing. Driven here through the
   * REAL CLI, where the argv and the quoting actually happen.
   */
  const ACCENTED = `docs/caf${String.fromCharCode(0xe9)}.md`;
  /** The two-character sequence `printf` needs in the shim, likewise built. */
  const BACKSLASH_N = String.fromCharCode(92) + 'n';

  const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/index.js');
  const shellOk = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf-8' }).status === 0;
  const composedOk = shellOk && fs.existsSync(DIST);

  /**
   * The REAL working directory, restored after each case: `cross-spawn` (which
   * the CLI's `safeExec` goes through) chdirs into a child's cwd and restores
   * with `process.cwd()`, which on Windows would otherwise leave this process
   * holding the temp repo open and fail teardown.
   */
  const realCwd = process.cwd();
  let tmpDir: string;
  let repoDir: string;
  let binDir: string;
  let logPath: string;
  let baseSha: string;
  let ancestorSha: string;
  let headSha: string;

  function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf-8' });
  }

  beforeEach(() => {
    if (!composedOk) return;
    tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-composed-')));
    repoDir = path.join(tmpDir, 'repo');
    binDir = path.join(tmpDir, 'stub-bin');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(binDir);
    logPath = path.join(tmpDir, 'totem-invocations.log').split(path.sep).join('/');

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'leg@example.test');
    git('config', 'user.name', 'Leg');
    // The minimal config the schema accepts, declaring ONE glob so the
    // owed / not-owed axis of this suite is unambiguous.
    fs.writeFileSync(
      path.join(repoDir, 'totem.config.ts'),
      [
        'export default {',
        "  targets: [{ glob: 'docs/**/*.md', type: 'spec', strategy: 'markdown-heading' }],",
        "  hooks: { legsOwed: { globs: ['docs/**'] } },",
        '};',
        '',
      ].join(NL),
    );
    fs.writeFileSync(path.join(repoDir, 'src.ts'), 'export const a = 1;' + NL);
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    baseSha = git('rev-parse', 'HEAD').trim();

    // The branch under test: it touches the declared glob, so it is legs-owed.
    git('checkout', '-q', '-b', 'feat/owed');
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs', 'note.md'), '# a judgment-dense page' + NL);
    fs.writeFileSync(path.join(repoDir, ...ACCENTED.split('/')), '# an accented page' + NL);
    git('add', '-A', 'docs');
    git('commit', '-q', '-m', 'a docs change');
    // C1 — the head a leg could read, and an ANCESTOR of the head being pushed.
    ancestorSha = git('rev-parse', 'HEAD').trim();
    // C2 — one commit further, touching nothing owed, so the owed set is still
    // C1's two docs pages and a deposit at C1 covers all of them. Without it
    // that deposit would be EXACT, credited by construction, and the reach
    // probe this suite exists to exercise would never run.
    fs.writeFileSync(path.join(repoDir, 'src.ts'), 'export const a = 2;' + NL);
    git('add', 'src.ts');
    git('commit', '-q', '-m', 'a code-only change');
    headSha = git('rev-parse', 'HEAD').trim();

    // The shim IS the real CLI for `legs`, recorded either way. First on PATH,
    // so the hook's resolve block finds it as a plain `totem` (the temp repo has
    // no package.json, no node_modules and no workspace file, so no earlier
    // resolution tier can win).
    fs.writeFileSync(
      path.join(binDir, 'totem'),
      [
        '#!/bin/sh',
        `printf '%s${BACKSLASH_N}' "$*" >> "${logPath}"`,
        'if [ "$1" = "legs" ]; then',
        `  exec node "${DIST.split(path.sep).join('/')}" "$@"`,
        'fi',
        'exit 0',
        '',
      ].join(NL),
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    if (!composedOk) return;
    process.chdir(realCwd);
    cleanTmpDir(tmpDir);
  });

  function runHook(): { status: number | null; stdout: string; stderr: string } {
    fs.writeFileSync(
      path.join(repoDir, 'pre-push'),
      buildPrePushHook({ ...RENDER, tier: 'strict' }),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: [binDir, process.env['PATH'] ?? ''].join(path.delimiter),
    };
    delete env['CLAUDE_CODE_AGENT'];
    delete env['CLAUDE_VERSION'];
    delete env['CURSOR_TRACE_ID'];
    const result = spawnSync('sh', ['./pre-push'], { cwd: repoDir, env, encoding: 'utf-8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  const invocations = (): string[] => {
    const native = logPath.split('/').join(path.sep);
    return fs.existsSync(native) ? fs.readFileSync(native, 'utf-8').trim().split(NL) : [];
  };

  /** Deposit through the REAL writer, at `sha`. */
  function deposit(sha: string): void {
    fs.writeFileSync(
      path.join(repoDir, 'findings.json'),
      JSON.stringify({
        readAt: new Date().toISOString(),
        findings: [
          {
            id: 'f1',
            severity: 'MATERIAL',
            file: 'docs/note.md',
            line: 1,
            claim: 'the page overstates the floor',
            counterexample: 'the gate never reads severities',
          },
        ],
        folded: ['f1'],
        verdict: 'one material finding, folded',
      }),
    );
    const result = spawnSync(
      'node',
      [DIST, 'legs', 'deposit', '--sha', sha, '--from', 'findings.json'],
      { cwd: repoDir, encoding: 'utf-8' },
    );
    // Anchored, with the writer's own stderr as the failure message: the
    // previous `toContain('0:')` also passed on a status of 10 or 130.
    expect(result.status, result.stderr ?? '').toBe(0);
  }

  it.skipIf(!composedOk)(
    'OWED with no deposit: the hook blocks, and BOTH lines are present',
    () => {
      const r = runHook();
      expect(invocations()).toContain('legs gate');
      expect(r.status).toBe(1);
      // The GATE's own line, derived end to end from the real predicate + store.
      // Both owed paths are named, the accented one spelled as it is on disk.
      expect(r.stdout).toContain(
        `[Totem] BLOCKED: this push is legs-owed (docs/** → ${ACCENTED}, docs/** → docs/note.md)`,
      );
      expect(r.stdout).toContain(`for head ${headSha.slice(0, 8)}`);
      // And the HOOK's own cure line, which only the strict arm emits.
      expect(r.stdout).toContain(
        "run the leg, then 'totem legs deposit --sha HEAD --from <findings.json>'",
      );
    },
  );

  it.skipIf(!composedOk)(
    'OWED with an ANCESTOR deposit that covers the owed set: the hook passes',
    () => {
      deposit(ancestorSha);
      const r = runHook();
      expect(invocations()).toContain('legs gate');
      expect(r.stdout).toContain('[Totem] legs evidence: .totem/artifacts/legs/');
      // ANCESTOR, so the reach probe actually RAN: this is the only composed
      // state that drives `git diff --name-only -z base...<deposit>` end to
      // end. Depositing at the head took core's exact branch, which credits
      // coverage by construction and never probes (mmnto-ai/totem#2698 fold 5).
      expect(r.stdout).toContain(
        `· head ${headSha.slice(0, 8)} · nearest ancestor, +1 commits since the leg read ·`,
      );
      // 2/2 with an accented owed path among them: the measured result of
      // reading both sides raw.
      expect(r.stdout).toContain('· covers 2/2 owed paths ·');
      expect(r.stdout).toContain('blocking=0 material=1 folded=1');
      expect(r.stdout).not.toContain('BLOCKED');
      expect(r.status).toBe(0);
    },
  );

  it.skipIf(!composedOk)(
    'OWED with a deposit on a SIBLING branch: the hook blocks and the gate calls it stale',
    () => {
      // A commit that is not an ancestor of HEAD: a second branch off the base.
      git('checkout', '-q', '-b', 'feat/sibling', baseSha);
      fs.writeFileSync(path.join(repoDir, 'other.ts'), 'export const b = 2;' + NL);
      git('add', 'other.ts');
      git('commit', '-q', '-m', 'a sibling commit');
      const siblingSha = git('rev-parse', 'HEAD').trim();
      git('checkout', '-q', 'feat/owed');
      deposit(siblingSha);

      const r = runHook();
      expect(invocations()).toContain('legs gate');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        `[Totem] legs: stale deposit ${siblingSha.slice(0, 8)}: not an ancestor of head`,
      );
      expect(r.stdout).toContain('[Totem] BLOCKED: this push is legs-owed');
    },
  );

  it.skipIf(!composedOk)(
    'OWED with a MERGE-BASE deposit: ancestor, but it covers none of the owed paths',
    () => {
      // The fold-3 exhibit, end to end: a deposit at the base is a real
      // ancestor one commit behind, so ancestry alone passed it — while the leg
      // that wrote it saw none of the diff this push proposes.
      deposit(baseSha);
      const r = runHook();
      expect(invocations()).toContain('legs gate');
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        `[Totem] legs: stale deposit ${baseSha.slice(0, 8)}: covers none of the owed paths (the deposit predates every owed change)`,
      );
      expect(r.stdout).toContain('[Totem] BLOCKED: this push is legs-owed');
      // And it is NOT reported as an ancestry failure — the reason is the cure.
      expect(r.stdout).not.toContain('not an ancestor of head');
    },
  );

  // POSIX-only, and only for these two names: NTFS refuses a double quote and a
  // backslash in a filename, while Linux and macOS — where the strict-tier
  // population runs — allow both, and git C-quotes both in the `diff --git`
  // headers the owed set used to be parsed from. This drives them through the
  // REAL CLI and the generated hook (mmnto-ai/totem#2698 fold 5).
  it.skipIf(!composedOk || process.platform === 'win32')(
    'OWED on quote- and backslash-bearing paths: the hook names them as they are on disk',
    () => {
      const quoted = `docs/a${String.fromCharCode(34)}quoted${String.fromCharCode(34)}.md`;
      const backslashed = `docs/back${String.fromCharCode(92)}slash.md`;
      fs.writeFileSync(path.join(repoDir, ...quoted.split('/')), '# quoted' + NL);
      fs.writeFileSync(path.join(repoDir, ...backslashed.split('/')), '# backslashed' + NL);
      git('add', '-A', 'docs');
      git('commit', '-q', '-m', 'the hostile pages');

      const r = runHook();
      expect(invocations()).toContain('legs gate');
      expect(r.status).toBe(1);
      // Raw in the basis. Escaped names here would be the fold-4 defect, and
      // the decoder that fold shipped could not have reached either of these.
      expect(r.stdout).toContain(quoted);
      expect(r.stdout).toContain(backslashed);
      expect(r.stdout).not.toContain(String.fromCharCode(92) + '"');
    },
  );

  it.skipIf(!composedOk)('NOT OWED: the hook passes and the gate says what it judged', () => {
    // A branch whose only change misses the one declared glob.
    git('checkout', '-q', '-b', 'feat/not-owed', baseSha);
    fs.writeFileSync(path.join(repoDir, 'src.ts'), 'export const a = 2;' + NL);
    git('add', 'src.ts');
    git('commit', '-q', '-m', 'a code-only change');
    const r = runHook();
    expect(invocations()).toContain('legs gate');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      '[Totem] legs: not owed — no changed path matched hooks.legsOwed.globs (1 globs; head',
    );
    expect(r.stdout).not.toContain('BLOCKED');
  });
});

// ─── The frozen mutation suite (mmnto-ai/totem#2737) ─────
//
// Authored against the FINAL contract — all NINE promised headings — and run
// once against the UNCHANGED reader before either predicate moved, then frozen:
// never edited by the commits that follow it. The RED/GREEN pattern it printed
// on the unchanged reader is what makes each case evidence of a predicate
// rather than a transcription of whatever the implementation happened to do.
//
// The nine come off SPEC_SYSTEM_PROMPT, not SPEC_REQUIRED_SECTIONS: the
// constant still named two headings when this was frozen, and reading the
// prompt keeps the suite byte-identical across all three commits. It is also
// how no case here ever retypes the em dash in `### Verification (MANDATORY —
// do not skip)` (the mmnto-ai/totem#2692 authoring trap). After the extension
// the two surfaces are the same nine strings in the same order.
describe('buildPreCommitHook spec-gate reader — frozen mutation suite (mmnto-ai/totem#2737)', () => {
  const shellOk =
    spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;

  /** The nine `### ` lines of the built-in prompt, in prompt order. */
  const PROMISED = SPEC_SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('### '));

  /** Pick a promised heading by an ASCII prefix — never retype the em dash. */
  function promised(prefix: string): string {
    const found = PROMISED.find((heading) => heading.startsWith(prefix));
    if (found === undefined) throw new Error(`no promised heading starts with ${prefix}`);
    return found;
  }

  const PROBLEM_STATEMENT = promised('### Problem Statement');
  const FILES_TO_EXAMINE = promised('### Files to Examine');
  const EDGE_CASES = promised('### Edge Cases');
  const IMPLEMENTATION_TASKS = promised('### Implementation Tasks');
  const EXECUTION_FLOW = promised('### Execution Flow');
  const VERIFICATION = promised('### Verification');
  const TEST_PLAN = promised('### Test Plan');

  /** A TAB, built rather than escaped (the mmnto-ai/totem#2692 authoring trap). */
  const TAB = String.fromCharCode(9);

  /**
   * All nine promised headings, each over one plain body line. An override
   * replaces exactly ONE heading's whole block, so each case changes one thing;
   * an empty override DROPS that heading from the draft entirely.
   */
  function nineBodied(overrides: Record<string, string> = {}): string {
    return PROMISED.map((heading) => {
      const override = overrides[heading];
      return override === undefined
        ? `${heading}\n\nA non-blank body under ${heading}.\n`
        : override;
    })
      .filter((block) => block.length > 0)
      .join('\n');
  }

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-2737-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git checkout -q -b feat/frozen-suite', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pre-commit'), buildPreCommitHook(RENDER));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(): { status: number | null; stdout: string } {
    const r = spawnSync('sh', ['./pre-commit'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
    });
    return { status: r.status, stdout: r.stdout };
  }

  function writeRun(name: string, artifact: Record<string, unknown>): void {
    const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(artifact, null, 2));
  }

  /** Every BLOCKED arm must be distinguishable from the other two arms. */
  function expectDistinctBlock(stdout: string): void {
    expect(stdout).not.toContain('no totem spec run artifact');
    expect(stdout).not.toContain('the spec-evidence reader could not run');
  }

  /** Judge one draft written under the BUILT-IN prompt on an ISSUE anchor. */
  function judge(content: string): { status: number | null; stdout: string } {
    writeRun('draft.json', specEvidenceArtifact({ output: { content } }));
    return runHook();
  }

  // ── Positive mutations: each must PASS ──

  it.skipIf(!shellOk)('a section that opens with a deeper heading is not empty', () => {
    const r = judge(
      nineBodied({
        [IMPLEMENTATION_TASKS]: `${IMPLEMENTATION_TASKS}\n#### 1. Sub\nA step under the sub-heading.\n`,
      }),
    );
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('· shape TEMPLATE');
  });

  it.skipIf(!shellOk)(
    'a promised heading with its parenthetical dropped matches and is named',
    () => {
      const r = judge(
        nineBodied({
          [EXECUTION_FLOW]: '### Execution Flow\n\nA body under the shortened heading.\n',
          [VERIFICATION]: '### Verification\n\nA body under the shortened heading.\n',
        }),
      );
      expect(r.status, r.stdout).toBe(0);
      expect(r.stdout).toContain(`· tolerated ${EXECUTION_FLOW} ~ ### Execution Flow`);
      expect(r.stdout).toContain(`${VERIFICATION} ~ ### Verification`);
    },
  );

  it.skipIf(!shellOk)('trailing whitespace on a heading line is tolerated silently', () => {
    const r = judge(
      nineBodied({
        [PROBLEM_STATEMENT]: `${PROBLEM_STATEMENT}   ${TAB}\n\nA body under it.\n`,
      }),
    );
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('· shape TEMPLATE');
    expect(r.stdout).not.toContain('· tolerated');
  });

  it.skipIf(!shellOk)('a different trailing parenthetical matches and is named', () => {
    const r = judge(
      nineBodied({ [VERIFICATION]: '### Verification (required)\n\nA body under it.\n' }),
    );
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('· tolerated');
    expect(r.stdout).toContain(`${VERIFICATION} ~ ### Verification (required)`);
  });

  // ── Negative mutations: each must BLOCK, by name ──

  it.skipIf(!shellOk)('a genuinely absent promised heading blocks by name', () => {
    const r = judge(nineBodied({ [TEST_PLAN]: '' }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`is missing heading ${TEST_PLAN}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a genuinely empty section blocks by name', () => {
    const r = judge(nineBodied({ [PROBLEM_STATEMENT]: PROBLEM_STATEMENT }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`has an empty heading ${PROBLEM_STATEMENT}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a whitespace-only body is empty', () => {
    const r = judge(
      nineBodied({ [FILES_TO_EXAMINE]: `${FILES_TO_EXAMINE}\n   \n${TAB}${TAB}\n\n` }),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`has an empty heading ${FILES_TO_EXAMINE}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a deeper heading with nothing under it is not a body', () => {
    const r = judge(nineBodied({ [EDGE_CASES]: `${EDGE_CASES}\n#### none` }));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`has an empty heading ${EDGE_CASES}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('a shallower heading ends the section', () => {
    const r = judge(
      nineBodied({
        [IMPLEMENTATION_TASKS]: `${IMPLEMENTATION_TASKS}\n## Notes\nProse under the shallower heading.\n`,
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`has an empty heading ${IMPLEMENTATION_TASKS}`);
    expectDistinctBlock(r.stdout);
  });

  it.skipIf(!shellOk)('the heading level is exact', () => {
    const r = judge(
      nineBodied({ [PROBLEM_STATEMENT]: '## Problem Statement\n\nA body under it.\n' }),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`is missing heading ${PROBLEM_STATEMENT}`);
    expectDistinctBlock(r.stdout);
  });

  // ── The ruled falsifier (operator ruling 2026-09-03) ──
  //
  // The denominator is all SEVEN drafts the R3 probe actually recorded, and the
  // claim is that none is blocked; the mutated negatives above carry the "flags
  // the defective" half. The four schema-constrained runs carry the promised
  // headings BYTE-IDENTICAL, em dash included, so they must match on the EXACT
  // pass and name no tolerance — which makes this test the executed proof, on
  // every CI OS, that the em-dash heading round-trips through JSON.stringify,
  // the single-quoted `node -e` word, sh and node without drift.

  /** The recorded R3 fixture directory, found by walking up to the repo root. */
  function resolveR3FixtureDir(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(dir, '.totem', 'fixtures', 'spec-runs-2026-09-02');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return '';
  }

  /** The ORIGINAL run's draft: the artifacts.ndjson row whose id starts e5a15c9c. */
  function readOriginalDraft(dir: string): string {
    const ndjson = fs.readFileSync(path.join(dir, 'artifacts.ndjson'), 'utf-8');
    for (const line of ndjson.split('\n')) {
      if (line.trim().length === 0) continue;
      let row: { id?: unknown; output?: { content?: unknown } };
      try {
        row = JSON.parse(line) as { id?: unknown; output?: { content?: unknown } };
      } catch (err) {
        void err;
        continue;
      }
      if (typeof row.id === 'string' && row.id.startsWith('e5a15c9c')) {
        const content = row.output?.content;
        if (typeof content === 'string') return content;
      }
    }
    return '';
  }

  it.skipIf(!shellOk)(
    'the extended reader blocks none of the seven recorded R3 drafts and names the tolerance on the three that dropped parentheticals',
    () => {
      const dir = resolveR3FixtureDir();
      expect(
        dir,
        'the recorded R3 drafts (.totem/fixtures/spec-runs-2026-09-02/) are not in this checkout — the ruled falsifier cannot run',
      ).not.toBe('');

      const original = readOriginalDraft(dir);
      expect(
        original.length,
        'the original R3 draft (artifacts.ndjson row id e5a15c9c…) was not found',
      ).toBeGreaterThan(0);

      const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf-8');
      const drafts: Array<{ name: string; content: string; tolerated: boolean }> = [
        {
          name: 'the original artifact (artifacts.ndjson row id e5a15c9c…)',
          content: original,
          tolerated: true,
        },
        {
          name: 'r3-unconstrained-run1.md',
          content: read('r3-unconstrained-run1.md'),
          tolerated: true,
        },
        {
          name: 'r3-unconstrained-run2.md',
          content: read('r3-unconstrained-run2.md'),
          tolerated: true,
        },
        {
          name: 'r3-responseSchema-run1.md',
          content: read('r3-responseSchema-run1.md'),
          tolerated: false,
        },
        {
          name: 'r3-responseSchema-run2.md',
          content: read('r3-responseSchema-run2.md'),
          tolerated: false,
        },
        {
          name: 'r3-responseJsonSchema-minLength1-run1.md',
          content: read('r3-responseJsonSchema-minLength1-run1.md'),
          tolerated: false,
        },
        {
          name: 'r3-responseJsonSchema-minLength1-run2.md',
          content: read('r3-responseJsonSchema-minLength1-run2.md'),
          tolerated: false,
        },
      ];
      // The denominator is ruled: all seven, or the claim is a different one.
      expect(drafts).toHaveLength(7);

      for (const draft of drafts) {
        const r = judge(draft.content);
        expect(r.status, `${draft.name} was BLOCKED: ${r.stdout}`).toBe(0);
        expect(r.stdout, `${draft.name} did not read as TEMPLATE`).toContain('· shape TEMPLATE');
        if (draft.tolerated) {
          expect(
            r.stdout,
            `${draft.name} dropped a promised parenthetical but the evidence line named no tolerance`,
          ).toContain('· tolerated');
        } else {
          expect(
            r.stdout,
            `${draft.name} carries the promised headings verbatim but the evidence line named a tolerance`,
          ).not.toContain('· tolerated');
        }
      }
    },
  );
});

// A tolerantly-matched heading that then blocks for an empty body used to name
// a string the draft does not contain: the seat reads `has an empty heading
// ### Verification (MANDATORY — do not skip)`, searches the draft for it, finds
// nothing, and cannot see that the reader matched `### Verification` and judged
// THAT section. The block now carries both spellings. Outside the frozen block
// (mmnto-ai/totem#2737 fold round) — the suite above was run against the
// unchanged reader and is not edited after.
describe('buildPreCommitHook spec-gate reader — tolerance disclosure on the block path (mmnto-ai/totem#2737 fold)', () => {
  const shellOk =
    spawnSync('sh', ['-c', 'command -v node >/dev/null 2>&1'], { encoding: 'utf-8' }).status === 0;

  const PROMISED = SPEC_SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('### '));
  const VERIFICATION = PROMISED.find((heading) => heading.startsWith('### Verification')) ?? '';

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-2737-fold-'));
    execSync('git init -q', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git checkout -q -b feat/fold', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'pre-commit'), buildPreCommitHook(RENDER));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it.skipIf(!shellOk)(
    'an EMPTY section under a tolerantly-matched heading names both the promised and the matched line',
    () => {
      // Every promised heading bodied except Verification, which appears with
      // its parenthetical dropped AND no body — so the reader must reach the
      // empty-body block by way of the tolerant pass.
      const content = PROMISED.map((heading) =>
        heading === VERIFICATION
          ? '### Verification\n'
          : `${heading}\n\nA non-blank body under ${heading}.\n`,
      ).join('\n');
      const dir = path.join(tmpDir, '.totem', 'artifacts', 'runs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'tolerant-empty.json'),
        JSON.stringify(specEvidenceArtifact({ output: { content } }), null, 2),
      );

      const r = spawnSync('sh', ['./pre-commit'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(
        `has an empty heading ${VERIFICATION} (matched as ### Verification)`,
      );
      // Still distinguishable from the other two BLOCKED arms.
      expect(r.stdout).not.toContain('no totem spec run artifact');
      expect(r.stdout).not.toContain('the spec-evidence reader could not run');
      // The new clause echoes a DRAFT line, so it is a forged-line sink like
      // every other value that reaches stdout.
      expect(r.stdout.split('\n').filter((line) => line.startsWith('[Totem]'))).toHaveLength(1);

      // …and the matched line passes through `safe()`: a C1 control inside the
      // heading is collapsed rather than echoed into the block message.
      const nel = String.fromCharCode(0x85);
      const forgedHeading = `### Verification (a${nel}b)`;
      const forgedContent = PROMISED.map((heading) =>
        heading === VERIFICATION
          ? `${forgedHeading}\n`
          : `${heading}\n\nA non-blank body under ${heading}.\n`,
      ).join('\n');
      fs.writeFileSync(
        path.join(dir, 'tolerant-empty.json'),
        JSON.stringify(specEvidenceArtifact({ output: { content: forgedContent } }), null, 2),
      );
      const forgedRun = spawnSync('sh', ['./pre-commit'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        env: { ...process.env, CLAUDE_CODE_AGENT: '1' },
      });
      expect(forgedRun.status).toBe(1);
      expect(forgedRun.stdout).toContain(
        `has an empty heading ${VERIFICATION} (matched as ### Verification (a?b))`,
      );
      expect(forgedRun.stdout).not.toContain(nel);
      expect(
        forgedRun.stdout.split('\n').filter((line) => line.startsWith('[Totem]')),
      ).toHaveLength(1);
    },
  );
});

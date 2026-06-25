/**
 * Tests for the `totem doctor --parity` sensor (mmnto-ai/totem-strategy#448,
 * PR-1 mmnto-ai/totem#2069).
 *
 * Drives `checkParity` against real temp dirs with a YAML totem config so the
 * config-resolution → manifest-resolution → parse → DiagnosticResult mapping is
 * exercised end-to-end (no mocking of `loadConfig`). Each test writes a local
 * `totem.yaml` so `resolveConfigPath` never falls through to the global
 * `~/.totem/` profile (which would make the not-configured case nondeterministic).
 *
 * The version-pinned wiring tests write a self-in-tree fixture (`packages/*​/
 * package.json`) under the temp dir so the core detector's cohort-floor probe
 * resolves locally (NEVER networks — the temp dir is not a git repo, so the
 * origin-remote read fails fast + degrades to the dir/name fallbacks).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { checkParity, doctorParityCliCommand } from './doctor-parity.js';
import {
  CLAUDE_SESSION_START,
  DISTRIBUTED_CLAUDE_SKILLS,
  GEMINI_SESSION_START,
  SESSION_START_MARKER,
  SKILL_MARKER_START,
} from './init-templates.js';
import {
  buildHookContent,
  buildPostCheckoutHookContent,
  buildPreCommitHook,
  buildPrePushHook,
  getFallbackCommand,
  TOTEM_PREPUSH_MARKER,
} from './install-hooks.js';

// Minimal valid totem config — `targets` is the only required array; everything
// else defaults. `orient.parityManifest` is added per-test as needed.
const BASE_CONFIG = `targets:
  - glob: "**/*.ts"
    type: code
    strategy: typescript-ast
`;

// A small manifest mirroring the real shape (version-pinned + null source-note +
// optional title/blocking/consumers), reused across the success-path tests.
const VALID_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: session-start-orientation
    dimension: orientation
    canonical-source: mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#SessionStart
    detection-method: SessionStart hook present
    expected-value-or-derivation: hook managed-block matches distributed template
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#438
  - id: mmnto-cli-version
    dimension: toolchain-version
    canonical-source: mmnto-ai/totem:packages/cli/package.json#version
    detection-method: consumer package.json caret range
    expected-value-or-derivation: consumer pin resolves to current @mmnto/cli
    tractability: version-pinned
    tracking-issue: mmnto-ai/totem-strategy#482
  - id: mcp-corpus-indexing
    dimension: knowledge-index
    canonical-source: null
    source-note: consumer-local capability; no external canonical source
    detection-method: .lancedb index present
    expected-value-or-derivation: index present + fresh
    tractability: mechanical
    tracking-issue: mmnto-ai/totem#2018
  - id: gate-config
    dimension: enforcement
    title: Canonical gate set
    canonical-source: mmnto-ai/totem
    detection-method: installed gates vs canonical gate set
    expected-value-or-derivation: consumer installed gates == canonical
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#482
    blocking: false
    consumers:
      - mmnto-ai/totem
`;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-parity-'));
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

function writeConfig(body: string): void {
  fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), body, 'utf-8');
}

function writeManifest(relPath: string, yamlText: string): void {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, yamlText, 'utf-8');
}

describe('checkParity — honest-absent', () => {
  it('emits exactly one skip line when orient.parityManifest is absent (no throw)', async () => {
    writeConfig(BASE_CONFIG);
    const { results } = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
    expect(results[0]!.message).toContain('no parity manifest configured');
  });

  it('treats a config-less repo as not-configured (skip, no throw)', async () => {
    // No totem config at all → resolveConfigPath either throws (caught,
    // best-effort) or resolves the GLOBAL ~/.totem profile, which checkParity
    // explicitly ignores for repo-scoping (isGlobalConfigPath). Either way the
    // result is a deterministic skip, regardless of any global orient.parityManifest.
    const { results } = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
  });
});

describe('checkParity — configured-but-missing', () => {
  it('warns (no throw) when the configured manifest path does not exist', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    const { results } = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('warn');
    expect(results[0]!.message).toContain('not found');
  });
});

describe('checkParity — unparseable / unsupported-schema', () => {
  it('warns (never crashes) on unparseable YAML', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: bad.yaml\n`);
    writeManifest('bad.yaml', 'schema-version: 1\ncontracts: [unclosed');
    const { results } = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('warn');
    expect(results[0]!.message).toContain('unreadable');
  });

  it('warns (never crashes) on a Zod-invalid manifest', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: bad.yaml\n`);
    writeManifest(
      'bad.yaml',
      `schema-version: 1
status: scaffold
contracts:
  - id: broken
    dimension: orientation
    canonical-source: null
    detection-method: x
    tractability: mechanical
`,
    );
    const { results } = await checkParity(tmpDir);
    expect(results[0]!.status).toBe('warn');
  });

  it('warns and does NOT parse contracts on an unsupported schema-version', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: future.yaml\n`);
    writeManifest(
      'future.yaml',
      VALID_MANIFEST_YAML.replace('schema-version: 1', 'schema-version: 2'),
    );
    const { results } = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('warn');
    expect(results[0]!.message).toContain('schema v2 unsupported');
  });
});

describe('checkParity — success', () => {
  it('emits a summary line + one line per contract on a valid manifest', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    writeManifest('doctrine/parity-manifest.yaml', VALID_MANIFEST_YAML);

    const { results } = await checkParity(tmpDir);
    // 1 summary + 5 per-contract lines: session-start-orientation is now WIRED and
    // expands to TWO artifacts (claude + gemini) — no longer a stub — plus the three
    // single-line contracts (mmnto-cli-version, mcp-corpus-indexing, gate-config).
    expect(results).toHaveLength(6);

    const summary = results[0]!;
    expect(summary.status).toBe('pass');
    expect(summary.message).toContain('4 contract(s) loaded');

    const perContract = results.slice(1);
    // session-start-orientation is wired to the two whole-file SessionStart hooks;
    // neither is installed here, so both are skip (cohort permits absence), NOT the
    // old "not yet implemented" stub.
    const orientationLines = perContract.filter((r) =>
      r.name.startsWith('Parity: session-start-orientation'),
    );
    expect(orientationLines).toHaveLength(2);
    for (const line of orientationLines) {
      expect(line.status).toBe('skip');
      expect(line.message).not.toContain('not yet implemented');
    }
    // The version-pinned deps contract (mmnto-cli-version) now runs the
    // detector — with no consumer pin declared here it lands on a `skip`
    // (cohort permits absence), NOT the old "not yet implemented" stub.
    const cliVersion = perContract.find((r) => r.name === 'Parity: mmnto-cli-version')!;
    expect(cliVersion.status).toBe('skip');
    expect(cliVersion.message).not.toContain('not yet implemented');
  });

  it('never emits a fail status by default (sensor-not-gate)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    writeManifest('doctrine/parity-manifest.yaml', VALID_MANIFEST_YAML);
    const { results } = await checkParity(tmpDir);
    expect(results.some((r) => r.status === 'fail')).toBe(false);
  });
});

// ─── version-pinned detection wiring (PR-1) ─────────────

/** A manifest with a single deps version-pinned contract (no consumers = applies). */
const DEPS_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: mmnto-totem-version
    dimension: dependency-cohort
    canonical-source: mmnto-ai/totem
    detection-method: consumer package.json caret range + resolved install vs floor
    expected-value-or-derivation: consumer pin resolves to the current published @mmnto/totem
    tractability: version-pinned
    tracking-issue: mmnto-ai/totem-strategy#482
`;

/** Same contract marked blocking — exercises the --strict fail-promotion edge. */
const BLOCKING_DEPS_MANIFEST_YAML = DEPS_MANIFEST_YAML.replace(
  'tracking-issue: mmnto-ai/totem-strategy#482\n',
  'tracking-issue: mmnto-ai/totem-strategy#482\n    blocking: true\n',
);

/** Write a self-in-tree `packages/<dir>/package.json` so the cohort floor resolves locally. */
function writeFloorPackage(dir: string, name: string, version: string): void {
  const pkgDir = path.join(tmpDir, 'packages', dir);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name, version }, null, 2),
    'utf-8',
  );
}

/** Write the consumer's root package.json declaring a dependency pin. */
function writeConsumerDeps(deps: Record<string, string>): void {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ name: 'consumer-repo', dependencies: deps }, null, 2),
    'utf-8',
  );
}

/** Write `node_modules/<pkg>/package.json#version` so installed-version resolution wins. */
function writeInstalled(pkg: string, version: string): void {
  const dir = path.join(tmpDir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: pkg, version }, null, 2),
    'utf-8',
  );
}

describe('checkParity — version-pinned wiring', () => {
  it('PASS — installed @mmnto/totem >= the self-in-tree cohort floor', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.50.0'); // floor
    writeConsumerDeps({ '@mmnto/totem': '^1.50.0' });
    writeInstalled('@mmnto/totem', '1.53.3'); // installed >= floor

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: mmnto-totem-version')!;
    expect(line.status).toBe('pass');
    expect(blockingDriftIds).toHaveLength(0);
  });

  it('WARN — installed @mmnto/totem < the cohort floor (stale pin), no blocking promotion', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3'); // floor
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0'); // installed < floor

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: mmnto-totem-version')!;
    expect(line.status).toBe('warn');
    expect(line.message).toContain('1.53.3'); // floor surfaced
    // Non-blocking contract → not eligible for --strict promotion.
    expect(blockingDriftIds).toHaveLength(0);
  });

  it('a blocking contract drift tags blockingDriftIds (the --strict promotion seam)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', BLOCKING_DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3');
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0');

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: mmnto-totem-version')!;
    // The CHECK still returns warn — fail-promotion is the CLI edge's job.
    expect(line.status).toBe('warn');
    expect(blockingDriftIds).toEqual(['mmnto-totem-version']);
  });
});

// ─── value-equality detection wiring (strategy#738 Slice A) ─────────

/** A manifest with the cr-profile value-equality contract (no consumers = applies). */
const VALUE_EQUALITY_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: cr-profile
    dimension: bot-review-configs
    canonical-source: mmnto-ai/totem-strategy:.coderabbit.yaml#reviews.profile
    detection-method: file-value-equality
    expected-value-or-derivation: assertive
    tractability: mechanical
    manifestation: value-equality
    tracking-issue: mmnto-ai/totem-strategy#501
`;

/** Same row marked blocking — exercises the --strict promotion seam through value-equality routing. */
const BLOCKING_VALUE_EQUALITY_MANIFEST_YAML = VALUE_EQUALITY_MANIFEST_YAML.replace(
  'tracking-issue: mmnto-ai/totem-strategy#501\n',
  'tracking-issue: mmnto-ai/totem-strategy#501\n    blocking: true\n',
);

/** A value-equality manifest naming an id the registry does not handle → routing stub. */
const UNHANDLED_VALUE_EQUALITY_MANIFEST_YAML = VALUE_EQUALITY_MANIFEST_YAML.replace(
  'id: cr-profile',
  'id: not-a-real-bot-row',
);

/** Write a `.coderabbit.yaml` with a given reviews.profile scalar. */
function writeCoderabbit(profile: string): void {
  fs.writeFileSync(
    path.join(tmpDir, '.coderabbit.yaml'),
    `reviews:\n  profile: ${profile}\n`,
    'utf-8',
  );
}

describe('checkParity — value-equality wiring (strategy#738 Slice A)', () => {
  it('PASS — on-disk scalar matches the manifest expected', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', VALUE_EQUALITY_MANIFEST_YAML);
    writeCoderabbit('assertive');

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: cr-profile')!;
    expect(line.status).toBe('pass');
    expect(blockingDriftIds).toHaveLength(0);
  });

  it('WARN — scalar drift, no blocking promotion on a non-blocking row', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', VALUE_EQUALITY_MANIFEST_YAML);
    writeCoderabbit('chill');

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: cr-profile')!;
    expect(line.status).toBe('warn');
    expect(line.message).toContain('assertive'); // expected surfaced
    expect(blockingDriftIds).toHaveLength(0);
  });

  it('a blocking value-equality drift tags blockingDriftIds (the --strict seam)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', BLOCKING_VALUE_EQUALITY_MANIFEST_YAML);
    writeCoderabbit('chill');

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: cr-profile')!;
    expect(line.status).toBe('warn'); // the check itself never fails
    expect(blockingDriftIds).toEqual(['cr-profile']);
  });

  it('SKIP — file wholly absent is the applicable-but-missing scaffold skip', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', VALUE_EQUALITY_MANIFEST_YAML);
    // No .coderabbit.yaml written.

    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: cr-profile')!;
    expect(line.status).toBe('skip');
  });

  it('an unhandled value-equality row id → routing stub, not a crash', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', UNHANDLED_VALUE_EQUALITY_MANIFEST_YAML);

    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: not-a-real-bot-row')!;
    expect(line.status).toBe('skip');
    expect(line.message).toMatch(/not yet implemented/i);
  });

  it('SKIP — not a consumer comes from the core self-guard (no CLI consumersSkip)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    // Scope the row to a different repo; this tmpDir repo is not in `consumers`.
    const scoped = VALUE_EQUALITY_MANIFEST_YAML.replace(
      'tracking-issue: mmnto-ai/totem-strategy#501\n',
      'tracking-issue: mmnto-ai/totem-strategy#501\n    consumers:\n      - some-other-repo\n',
    );
    writeManifest('m.yaml', scoped);
    writeCoderabbit('chill'); // would be a drift warn if this repo were a consumer

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === 'Parity: cr-profile')!;
    expect(line.status).toBe('skip');
    expect(line.message).toMatch(/not in consumers|repo id unresolvable/i);
    expect(blockingDriftIds).toHaveLength(0);
  });
});

// ─── mechanical skills detection wiring (#2073) ─────────

/** A manifest with the claude-skills mechanical contract (all distributed skills). */
const SKILLS_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: claude-skills
    dimension: skills
    canonical-source: mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#DISTRIBUTED_CLAUDE_SKILLS
    detection-method: managed-block content equality per distributed skill
    expected-value-or-derivation: consumer skill managed-blocks match distributed source
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#497
`;

/** Write a consumer skill artifact at `.claude/skills/<name>/SKILL.md`. */
function writeSkill(name: string, content: string): void {
  const abs = path.join(tmpDir, '.claude', 'skills', name, 'SKILL.md');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('checkParity — mechanical skills wiring (#2073)', () => {
  it('emits one line per distributed skill; PASS when each consumer block matches canonical', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', SKILLS_MANIFEST_YAML);
    // Install every distributed skill verbatim → each block matches its canonical.
    for (const s of DISTRIBUTED_CLAUDE_SKILLS) writeSkill(s.name, s.content);

    const { results } = await checkParity(tmpDir);
    const skillLines = results.filter((r) => r.name.startsWith('Parity: claude-skills'));
    expect(skillLines).toHaveLength(DISTRIBUTED_CLAUDE_SKILLS.length);
    expect(skillLines.every((r) => r.status === 'pass')).toBe(true);
  });

  it('WARN on a drifted skill block with no fork marker', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', SKILLS_MANIFEST_YAML);
    const first = DISTRIBUTED_CLAUDE_SKILLS[0]!;
    // Inject drift INSIDE the managed block (right after the start marker).
    writeSkill(
      first.name,
      first.content.replace(SKILL_MARKER_START, `${SKILL_MARKER_START}\nDRIFT INJECTED`),
    );

    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === `Parity: claude-skills (${first.name})`)!;
    expect(line.status).toBe('warn');
    expect(line.message).toMatch(/drift/i);
  });

  it('INFO (not warn) when a drifted skill carries a totem:fork marker', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', SKILLS_MANIFEST_YAML);
    const first = DISTRIBUTED_CLAUDE_SKILLS[0]!;
    const drifted = first.content.replace(
      SKILL_MARKER_START,
      `${SKILL_MARKER_START}\nDRIFT INJECTED`,
    );
    writeSkill(
      first.name,
      `${drifted}\n<!-- totem:fork reason="local override" owner="satur8d" attested="2026-06-03" -->\n`,
    );

    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name === `Parity: claude-skills (${first.name})`)!;
    expect(line.status).toBe('info');
    expect(line.message).toMatch(/intentional fork/i);
  });

  it('SKIP when a skill artifact is not installed (cohort permits absence), never fail', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', SKILLS_MANIFEST_YAML);
    // Install nothing → every skill line is a skip.

    const { results } = await checkParity(tmpDir);
    const skillLines = results.filter((r) => r.name.startsWith('Parity: claude-skills'));
    expect(skillLines.length).toBeGreaterThan(0);
    expect(skillLines.every((r) => r.status === 'skip')).toBe(true);
    expect(results.some((r) => r.status === 'fail')).toBe(false);
  });

  it('tags a blocking multi-artifact contract id ONCE even when several artifacts drift', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest(
      'm.yaml',
      SKILLS_MANIFEST_YAML.replace(
        'tracking-issue: mmnto-ai/totem-strategy#497\n',
        'tracking-issue: mmnto-ai/totem-strategy#497\n    blocking: true\n',
      ),
    );
    // Drift EVERY distributed skill → multiple warns under the one blocking
    // contract; its id must appear exactly once in blockingDriftIds.
    for (const s of DISTRIBUTED_CLAUDE_SKILLS) {
      writeSkill(s.name, s.content.replace(SKILL_MARKER_START, `${SKILL_MARKER_START}\nDRIFT`));
    }

    const { blockingDriftIds } = await checkParity(tmpDir);
    expect(blockingDriftIds).toEqual(['claude-skills']);
  });
});

// ─── mechanical git-hooks detection wiring (#2073 hooks slice) ──

/** A manifest with the git-hooks mechanical contract. */
const HOOKS_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: git-hooks
    dimension: lifecycle-wiring
    canonical-source: mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#hooks
    detection-method: presence + content equality of post-checkout / post-merge / pre-commit / pre-push
    expected-value-or-derivation: installed hooks match distributed templates at pinned @mmnto/cli
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#482
`;

/** Write a git hook fixture at `<tmpDir>/.git/hooks/<name>`. */
function writeGitHook(name: string, content: string): void {
  const abs = path.join(tmpDir, '.git', 'hooks', name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** Install every git hook VERBATIM from the running generator (the clean PASS case). */
function installCurrentHooks(): void {
  const fallbackCmd = getFallbackCommand(tmpDir);
  writeGitHook('pre-commit', buildPreCommitHook('standard'));
  writeGitHook('pre-push', buildPrePushHook(fallbackCmd, 'standard'));
  writeGitHook('post-merge', buildHookContent(fallbackCmd));
  writeGitHook('post-checkout', buildPostCheckoutHookContent(fallbackCmd));
}

describe('checkParity — mechanical git-hooks wiring (#2073)', () => {
  it('emits one line per git hook; all SKIP when no hooks are installed (presence)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', HOOKS_MANIFEST_YAML);

    const { results } = await checkParity(tmpDir);
    const hookLines = results.filter((r) => r.name.startsWith('Parity: git-hooks'));
    expect(hookLines).toHaveLength(4);
    expect(hookLines.every((r) => r.status === 'skip')).toBe(true);
  });

  it('PASS on every hook when each matches the per-repo regenerated canonical', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', HOOKS_MANIFEST_YAML);
    installCurrentHooks();

    const { results } = await checkParity(tmpDir);
    const hookLines = results.filter((r) => r.name.startsWith('Parity: git-hooks'));
    expect(hookLines).toHaveLength(4);
    expect(hookLines.every((r) => r.status === 'pass')).toBe(true);
  });

  it('WARN — a pre-push frozen at an older generator is drift (the mmnto-ai/totem#1854 keystone)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', HOOKS_MANIFEST_YAML);
    // Owned hook (starts with the totem shebang + marker) but stale body → drift.
    writeGitHook(
      'pre-push',
      `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER} — stateless enforcement.\nif command -v totem; then TOTEM_CMD="totem"; fi\n`,
    );

    const { results } = await checkParity(tmpDir);
    const prePush = results.find((r) => r.name === 'Parity: git-hooks (pre-push)')!;
    expect(prePush.status).toBe('warn');
    expect(prePush.message).toMatch(/drift/i);
  });

  it('SKIP — a present non-totem hook is a pure user hook, never warn (presence semantics)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', HOOKS_MANIFEST_YAML);
    writeGitHook('pre-push', '#!/bin/sh\necho my own pre-push hook\n');

    const { results } = await checkParity(tmpDir);
    const prePush = results.find((r) => r.name === 'Parity: git-hooks (pre-push)')!;
    expect(prePush.status).toBe('skip');
  });

  it('WARN — tier drift: a standard hook under a strict-configured repo (tier-aware canonical)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\nhooks:\n  tier: strict\n`);
    writeManifest('m.yaml', HOOKS_MANIFEST_YAML);
    // Install the STANDARD pre-push, but the repo is configured strict → drift.
    writeGitHook('pre-push', buildPrePushHook(getFallbackCommand(tmpDir), 'standard'));

    const { results } = await checkParity(tmpDir);
    const prePush = results.find((r) => r.name === 'Parity: git-hooks (pre-push)')!;
    expect(prePush.status).toBe('warn');
  });

  it('a blocking git-hooks drift tags the contract id ONCE (the --strict promotion seam)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest(
      'm.yaml',
      HOOKS_MANIFEST_YAML.replace(
        'tracking-issue: mmnto-ai/totem-strategy#482\n',
        'tracking-issue: mmnto-ai/totem-strategy#482\n    blocking: true\n',
      ),
    );
    // Drift two owned hooks → multiple warns under the one blocking contract.
    writeGitHook(
      'pre-push',
      `#!/bin/sh\n# ${TOTEM_PREPUSH_MARKER} — stateless enforcement.\nSTALE\n`,
    );
    writeGitHook('pre-commit', `#!/bin/sh\n# [totem] pre-commit hook\nSTALE\n`);

    const { blockingDriftIds } = await checkParity(tmpDir);
    expect(blockingDriftIds).toEqual(['git-hooks']);
  });

  it('SKIP — a git-hooks contract scoped to OTHER consumers does not run here (honors consumers)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', `${HOOKS_MANIFEST_YAML}    consumers:\n      - some-other-repo\n`);
    // Even with the current hooks installed, an out-of-scope contract must not run
    // (no per-artifact drift, no --strict fail) — mirrors the version-pinned guard.
    installCurrentHooks();

    const { results } = await checkParity(tmpDir);
    const hookLines = results.filter((r) => r.name.startsWith('Parity: git-hooks'));
    // ONE skip line for the whole contract — not four per-artifact verdicts.
    expect(hookLines).toHaveLength(1);
    expect(hookLines[0]!.status).toBe('skip');
    expect(hookLines[0]!.message).toMatch(/not in consumers|permits absence|cannot determine/i);
  });
});

describe('doctorParityCliCommand — --strict fail-promotion', () => {
  it('throws PARITY_DRIFT_DETECTED when a blocking contract drifted under --strict', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', BLOCKING_DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3');
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0');

    await expect(doctorParityCliCommand({ strict: true, cwdForTest: tmpDir })).rejects.toThrow(
      /PARITY_DRIFT_DETECTED|blocking drift/i,
    );
  });

  it('does NOT throw for the same blocking drift without --strict (sensor-not-gate)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', BLOCKING_DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3');
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0');

    await expect(
      doctorParityCliCommand({ strict: false, cwdForTest: tmpDir }),
    ).resolves.toBeUndefined();
  });

  it('throws under --strict when a blocking MECHANICAL contract drifts across multiple artifacts', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest(
      'm.yaml',
      SKILLS_MANIFEST_YAML.replace(
        'tracking-issue: mmnto-ai/totem-strategy#497\n',
        'tracking-issue: mmnto-ai/totem-strategy#497\n    blocking: true\n',
      ),
    );
    for (const s of DISTRIBUTED_CLAUDE_SKILLS) {
      writeSkill(s.name, s.content.replace(SKILL_MARKER_START, `${SKILL_MARKER_START}\nDRIFT`));
    }
    await expect(doctorParityCliCommand({ strict: true, cwdForTest: tmpDir })).rejects.toThrow(
      /PARITY_DRIFT_DETECTED|blocking drift/i,
    );
  });

  it('does NOT throw under --strict when drift is NON-blocking (only blocking gates)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', DEPS_MANIFEST_YAML); // non-blocking
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3');
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0');

    await expect(
      doctorParityCliCommand({ strict: true, cwdForTest: tmpDir }),
    ).resolves.toBeUndefined();
  });
});

// ─── manual-attestation detection wiring (mmnto-ai/totem#2073 manual-attestation slice) ──

/**
 * A manifest carrying both manual-attestation sub-classes: two doctrine rows
 * (no package, cross-repo canonical) + two vendor-SDK couplings (package set),
 * one of the latter scoped to a consumer this repo is NOT, to exercise the skip.
 */
const MANUAL_ATTEST_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: governance-doctrine
    dimension: doctrine
    canonical-source: mmnto-ai/totem-strategy:AGENTS.md
    detection-method: doctor surfaces last attested and flags staleness only
    expected-value-or-derivation: tracked for doctrine-currency visibility
    tractability: manual-attestation
    tracking-issue: mmnto-ai/totem-strategy#511
  - id: google-genai-coupling
    dimension: dependency-cohort
    canonical-source: null
    package: '@google/genai'
    detection-method: doctor surfaces each consumer's pin + last-attested; flags staleness only
    expected-value-or-derivation: tracked for coupling visibility
    tractability: manual-attestation
    tracking-issue: mmnto-ai/totem#2018
  - id: anthropic-sdk-coupling
    dimension: dependency-cohort
    canonical-source: null
    package: '@anthropic-ai/sdk'
    detection-method: doctor surfaces each consumer's pin + last-attested; flags staleness only
    expected-value-or-derivation: tracked for coupling visibility
    tractability: manual-attestation
    tracking-issue: mmnto-ai/totem-strategy#482
    consumers:
      - liquid-city
`;

describe('checkParity — manual-attestation wiring', () => {
  it('routes both sub-classes off the stub: doctrine → info surface, vendor-SDK → info pin, scoped-out → skip', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', MANUAL_ATTEST_MANIFEST_YAML);
    // The consumer declares @google/genai so its coupling surfaces a pin; this
    // repo is not `liquid-city`, so the anthropic coupling lands on a scope skip.
    writeConsumerDeps({ '@google/genai': '^0.3.0' });

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const perContract = results.slice(1);

    const doctrine = perContract.find((r) => r.name === 'Parity: governance-doctrine')!;
    expect(doctrine.status).toBe('info');
    expect(doctrine.message).toContain('mmnto-ai/totem-strategy:AGENTS.md');
    expect(doctrine.message).toContain('mmnto-ai/totem-strategy#511');
    expect(doctrine.message).not.toContain('not yet implemented');

    const genai = perContract.find((r) => r.name === 'Parity: google-genai-coupling')!;
    expect(genai.status).toBe('info');
    expect(genai.message).toContain('@google/genai');
    expect(genai.message).toContain('^0.3.0');

    const anthropic = perContract.find((r) => r.name === 'Parity: anthropic-sdk-coupling')!;
    expect(anthropic.status).toBe('skip');
    expect(anthropic.message).toMatch(/cohort permits absence/i);
    expect(anthropic.message).not.toContain('not yet implemented');

    // No manual-attestation contract is rendered as the old stub, fail, or warn.
    expect(perContract.every((r) => !r.message.includes('not yet implemented'))).toBe(true);
    expect(results.some((r) => r.status === 'fail' || r.status === 'warn')).toBe(false);
    expect(blockingDriftIds).toHaveLength(0);
  });

  it('passes last-attested through to the detector — dated rows render the date, undated stay honest-absent (mmnto-ai/totem#2125)', async () => {
    // strategy#540 shipped `last-attested:` in the manifest; the reserved
    // `attested?:` seam gets its producer. Message refinement ONLY — the
    // verdict stays `info` regardless (the never-fails keystone).
    const datedManifest = MANUAL_ATTEST_MANIFEST_YAML.replace(
      "    package: '@google/genai'\n",
      "    package: '@google/genai'\n    last-attested: '2026-06-08'\n",
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', datedManifest);
    writeConsumerDeps({ '@google/genai': '^0.3.0' });

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const perContract = results.slice(1);

    const genai = perContract.find((r) => r.name === 'Parity: google-genai-coupling')!;
    expect(genai.status).toBe('info'); // date refines the message, never the status
    expect(genai.message).toContain('last attested 2026-06-08');

    const doctrine = perContract.find((r) => r.name === 'Parity: governance-doctrine')!;
    expect(doctrine.status).toBe('info');
    expect(doctrine.message).toMatch(/last attested: not recorded/i); // undated row stays honest-absent

    expect(blockingDriftIds).toHaveLength(0);
  });

  it('manual-attestation is structurally non-gating: a blocking:true contract never enters blockingDriftIds', async () => {
    // Even marked blocking, an info verdict (the manual-attestation ceiling) never
    // promotes — the contract cannot fail even under --strict.
    const blockingManifest = MANUAL_ATTEST_MANIFEST_YAML.replace(
      'tracking-issue: mmnto-ai/totem-strategy#511\n',
      'tracking-issue: mmnto-ai/totem-strategy#511\n    blocking: true\n',
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', blockingManifest);
    writeConsumerDeps({ '@google/genai': '^0.3.0' });

    const { blockingDriftIds } = await checkParity(tmpDir);
    expect(blockingDriftIds).toHaveLength(0);

    // And the CLI command resolves (no throw) under --strict.
    await expect(
      doctorParityCliCommand({ strict: true, cwdForTest: tmpDir }),
    ).resolves.toBeUndefined();
  });
});

// ─── session-start-orientation detection wiring (mmnto-ai/totem#2073 orientation slice) ──

/** A manifest with the single session-start-orientation mechanical contract. */
const SESSION_START_MANIFEST_YAML = `schema-version: 1
status: scaffold
contracts:
  - id: session-start-orientation
    dimension: orientation
    canonical-source: mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#SessionStart
    detection-method: SessionStart hook present and invokes totem orient --session
    expected-value-or-derivation: hook matches the distributed template at pinned @mmnto/cli
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#438
`;

/** Write a repo file at a nested relative path under the temp consumer repo. */
function writeRepoFile(relPath: string, content: string): void {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('checkParity — session-start-orientation wiring', () => {
  it('both SessionStart templates open with SESSION_START_MARKER (single-source-of-truth contract)', () => {
    expect(GEMINI_SESSION_START.startsWith(SESSION_START_MARKER)).toBe(true);
    expect(CLAUDE_SESSION_START.startsWith(SESSION_START_MARKER)).toBe(true);
  });

  it('routes to two lines (claude + gemini); a verbatim gemini hook → pass, absent claude → skip', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', SESSION_START_MANIFEST_YAML);
    // Gemini hook installed verbatim → pass; Claude hook absent here → skip.
    writeRepoFile('.gemini/hooks/SessionStart.js', GEMINI_SESSION_START);

    const { results } = await checkParity(tmpDir);
    const perContract = results.slice(1);
    expect(perContract).toHaveLength(2);

    const gemini = perContract.find(
      (r) => r.name === 'Parity: session-start-orientation (gemini)',
    )!;
    expect(gemini.status).toBe('pass');
    const claude = perContract.find(
      (r) => r.name === 'Parity: session-start-orientation (claude)',
    )!;
    expect(claude.status).toBe('skip');
    expect(perContract.every((r) => !r.message.includes('not yet implemented'))).toBe(true);
  });

  it('a drifted owned gemini SessionStart → warn (NOT unknown); blocking promotes to a --strict throw', async () => {
    const blocking = SESSION_START_MANIFEST_YAML.replace(
      'tracking-issue: mmnto-ai/totem-strategy#438\n',
      'tracking-issue: mmnto-ai/totem-strategy#438\n    blocking: true\n',
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', blocking);
    // Still owned (the marker opens the file), but the body drifted → warn, not unknown.
    writeRepoFile('.gemini/hooks/SessionStart.js', `${GEMINI_SESSION_START}\n// local drift\n`);

    const { results, blockingDriftIds } = await checkParity(tmpDir);
    const gemini = results.find((r) => r.name === 'Parity: session-start-orientation (gemini)')!;
    expect(gemini.status).toBe('warn');
    expect(gemini.status).not.toBe('unknown');
    expect(blockingDriftIds).toContain('session-start-orientation');

    await expect(doctorParityCliCommand({ strict: true, cwdForTest: tmpDir })).rejects.toThrow();
  });
});

// ─── S0: --strict parity fold (#2085, mmnto-ai/totem-strategy#545 Half 2) ──

describe('checkParity — configured flag (#2085)', () => {
  it('configured: false when no orient.parityManifest is set (honest-absent)', async () => {
    writeConfig(BASE_CONFIG);
    const { configured } = await checkParity(tmpDir);
    expect(configured).toBe(false);
  });

  it('configured: false for a config-less repo (a global profile never leaks in)', async () => {
    // No totem config at all → resolveConfigPath resolves the GLOBAL profile,
    // which isGlobalConfigPath excludes — so `configured` stays false and the
    // strict fold no-ops (a global orient.parityManifest must not leak into the gate).
    const { configured } = await checkParity(tmpDir);
    expect(configured).toBe(false);
  });

  it('configured: true when the field is set even if the manifest file is missing', async () => {
    // "Configured" means the field is present, NOT that the file loaded — a broken
    // manifest must still run under --strict to surface the error, not silently no-op.
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: nope.yaml\n`);
    const { configured } = await checkParity(tmpDir);
    expect(configured).toBe(true);
  });

  it('configured: true on a valid configured manifest', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', VALID_MANIFEST_YAML);
    const { configured } = await checkParity(tmpDir);
    expect(configured).toBe(true);
  });
});

describe('doctorParityCliCommand — onlyWhenConfigured fold (#2085)', () => {
  it('no-op (renders nothing, no throw) when unconfigured under the fold', async () => {
    writeConfig(BASE_CONFIG); // no orient.parityManifest
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        doctorParityCliCommand({ strict: true, onlyWhenConfigured: true, cwdForTest: tmpDir }),
      ).resolves.toBeUndefined();
      // Byte-identical to a --strict run that never touched parity (satur8d's
      // zero-churn condition): zero parity lines for a non-adopter repo.
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('standalone (no onlyWhenConfigured) STILL renders the honest-absent SKIP', async () => {
    writeConfig(BASE_CONFIG);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await doctorParityCliCommand({ strict: true, cwdForTest: tmpDir });
      // onlyWhenConfigured defaults off → the explicit `doctor --parity` SKIP line
      // is unchanged for the "I asked for parity" case.
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('runs + gates (throws) under the fold when a configured blocking contract drifts', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', BLOCKING_DEPS_MANIFEST_YAML);
    writeFloorPackage('totem', '@mmnto/totem', '1.53.3');
    writeConsumerDeps({ '@mmnto/totem': '^1.40.0' });
    writeInstalled('@mmnto/totem', '1.40.0');

    await expect(
      doctorParityCliCommand({ strict: true, onlyWhenConfigured: true, cwdForTest: tmpDir }),
    ).rejects.toThrow(/PARITY_DRIFT_DETECTED|blocking drift/i);
  });

  it('runs (no throw) under the fold on a configured manifest with no blocking drift', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: m.yaml\n`);
    writeManifest('m.yaml', VALID_MANIFEST_YAML);
    await expect(
      doctorParityCliCommand({ strict: true, onlyWhenConfigured: true, cwdForTest: tmpDir }),
    ).resolves.toBeUndefined();
  });

  it('RENDERS (does not no-op) under the fold when configured but the manifest file is missing', async () => {
    // The fold gates on the field being SET (configured), not on the file loading —
    // a configured-but-broken manifest must surface its WARN, never silently no-op.
    // Guards the exact refactor hazard of flipping the early-return guard to
    // `onlyWhenConfigured && configured` (which would swallow broken-manifest output).
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: missing.yaml\n`);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(
        doctorParityCliCommand({ strict: true, onlyWhenConfigured: true, cwdForTest: tmpDir }),
      ).resolves.toBeUndefined(); // not-found is a non-blocking WARN → renders, no throw
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });
});

// === Capability-probe routing (mmnto-ai/totem#2140) ===

const PROBE_MANIFEST_YAML = `schema-version: 1
status: active
contracts:
  - id: knowledge-search-access
    dimension: knowledge-index
    canonical-source: null
    detection-method: capability probe, two rungs
    expected-value-or-derivation: at least one working query path per agent surface
    tractability: mechanical
    manifestation: capability-probe
    senses: usable
    vendor-adapter: [claude]
    tracking-issue: mmnto-ai/totem#2140
  - id: claude-settings-minimum-capability
    dimension: vendor-agent-surface
    canonical-source: null
    detection-method: JSON file-read of .claude/settings.json
    expected-value-or-derivation: governance floor capabilities enabled-or-unsuppressed
    tractability: mechanical
    manifestation: capability-probe
    senses: present
    vendor-adapter: [claude]
    tracking-issue: mmnto-ai/totem#2140
`;

describe('checkParity - capability-probe routing (mmnto-ai/totem#2140)', () => {
  it('routes manifestation: capability-probe BEFORE tractability (mechanical rows do not stub)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', PROBE_MANIFEST_YAML);
    const { results } = await checkParity(tmpDir);
    const probeLines = results.filter(
      (r) =>
        r.name.includes('knowledge-search-access') ||
        r.name.includes('claude-settings-minimum-capability'),
    );
    expect(probeLines).toHaveLength(2);
    for (const line of probeLines) {
      expect(line.message).not.toContain('not yet implemented');
    }
  });

  it('knowledge-search-access with a registered totem server caps at UNKNOWN (declares usable, probe proves present)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', PROBE_MANIFEST_YAML);
    fs.writeFileSync(
      path.join(tmpDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'totem-dev': { command: 'node', args: ['mcp.js'] } } }),
      'utf-8',
    );
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('knowledge-search-access'))!;
    expect(line.status).toBe('unknown');
    expect(line.message).toMatch(/usable/i);
  });

  it('knowledge-search-access WARNs when no .mcp.json exists', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', PROBE_MANIFEST_YAML);
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('knowledge-search-access'))!;
    expect(line.status).toBe('warn');
  });

  it('claude-settings-minimum-capability PASSes with no settings file (floor = not suppressed)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', PROBE_MANIFEST_YAML);
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('claude-settings-minimum-capability'))!;
    expect(line.status).toBe('pass');
    expect(line.message).toContain('present'); // names the probed level
  });

  it('a capability-probe row with no registered probe gets an honest skip stub', async () => {
    const unknownRow = PROBE_MANIFEST_YAML.replace(
      'id: knowledge-search-access',
      'id: some-future-probe-row',
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', unknownRow);
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('some-future-probe-row'))!;
    expect(line.status).toBe('skip');
    expect(line.message).toMatch(/probe not yet implemented|not yet implemented/i);
  });

  it('an UNRECOGNIZED manifestation value renders a loud per-row stub carrying the verbatim value', async () => {
    const future = PROBE_MANIFEST_YAML.replace(
      'manifestation: capability-probe\n    senses: usable',
      'manifestation: quantum-entanglement\n    senses: usable',
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', future);
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('knowledge-search-access'))!;
    expect(line.status).toBe('skip');
    expect(line.message).toContain('quantum-entanglement');
  });

  it('honors the consumers scope on probe rows (cohort permits absence)', async () => {
    const scoped = PROBE_MANIFEST_YAML.replace(
      'id: knowledge-search-access',
      'id: knowledge-search-access\n    consumers: [some-other-repo]',
    );
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: parity-manifest.yaml\n`);
    writeManifest('parity-manifest.yaml', scoped);
    const { results } = await checkParity(tmpDir);
    const line = results.find((r) => r.name.includes('knowledge-search-access'))!;
    expect(line.status).toBe('skip');
    expect(line.message).toMatch(/permits absence|not in consumers/i);
  });
});

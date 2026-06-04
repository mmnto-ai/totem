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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { checkParity, doctorParityCliCommand } from './doctor-parity.js';
import { DISTRIBUTED_CLAUDE_SKILLS, SKILL_MARKER_START } from './init-templates.js';

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
    // 1 summary + 4 per-contract lines.
    expect(results).toHaveLength(5);

    const summary = results[0]!;
    expect(summary.status).toBe('pass');
    expect(summary.message).toContain('4 contract(s) loaded');

    const perContract = results.slice(1);
    // The mechanical contracts keep the skip stub.
    const orientation = perContract.find((r) => r.name === 'Parity: session-start-orientation')!;
    expect(orientation.status).toBe('skip');
    expect(orientation.message).toContain('mechanical');
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

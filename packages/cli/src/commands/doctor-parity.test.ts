/**
 * Tests for the `totem doctor --parity` sensor skeleton
 * (mmnto-ai/totem-strategy#448).
 *
 * Drives `checkParity` against real temp dirs with a YAML totem config so the
 * config-resolution → manifest-resolution → parse → DiagnosticResult mapping is
 * exercised end-to-end (no mocking of `loadConfig`). Each test writes a local
 * `totem.yaml` so `resolveConfigPath` never falls through to the global
 * `~/.totem/` profile (which would make the not-configured case nondeterministic).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { checkParity } from './doctor-parity.js';

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
    const results = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
    expect(results[0]!.message).toContain('no parity manifest configured');
  });

  it('treats a config-less repo as not-configured (skip, no throw)', async () => {
    // No totem config at all → loadConfig path is best-effort honest-absent.
    // (resolveConfigPath may fall to the global profile; either way the field
    // is absent, so the sensor must skip, never throw.)
    const results = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('skip');
  });
});

describe('checkParity — configured-but-missing', () => {
  it('warns (no throw) when the configured manifest path does not exist', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    const results = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('warn');
    expect(results[0]!.message).toContain('not found');
  });
});

describe('checkParity — unparseable / unsupported-schema', () => {
  it('warns (never crashes) on unparseable YAML', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: bad.yaml\n`);
    writeManifest('bad.yaml', 'schema-version: 1\ncontracts: [unclosed');
    const results = await checkParity(tmpDir);
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
    const results = await checkParity(tmpDir);
    expect(results[0]!.status).toBe('warn');
  });

  it('warns and does NOT parse contracts on an unsupported schema-version', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: future.yaml\n`);
    writeManifest(
      'future.yaml',
      VALID_MANIFEST_YAML.replace('schema-version: 1', 'schema-version: 2'),
    );
    const results = await checkParity(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('warn');
    expect(results[0]!.message).toContain('schema v2 unsupported');
  });
});

describe('checkParity — success', () => {
  it('emits a summary line + one skip stub per contract on a valid manifest', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    writeManifest('doctrine/parity-manifest.yaml', VALID_MANIFEST_YAML);

    const results = await checkParity(tmpDir);
    // 1 summary + 4 per-contract stubs.
    expect(results).toHaveLength(5);

    const summary = results[0]!;
    expect(summary.status).toBe('pass');
    expect(summary.message).toContain('4 contract(s) loaded');

    // Per-contract lines are skip stubs (drift detection deferred — never fail).
    const perContract = results.slice(1);
    expect(perContract.every((r) => r.status === 'skip')).toBe(true);
    expect(perContract.some((r) => r.name === 'Parity: mmnto-cli-version')).toBe(true);
    expect(perContract.some((r) => r.message.includes('version-pinned'))).toBe(true);
  });

  it('never emits a fail status in the skeleton (sensor-not-gate)', async () => {
    writeConfig(`${BASE_CONFIG}orient:\n  parityManifest: doctrine/parity-manifest.yaml\n`);
    writeManifest('doctrine/parity-manifest.yaml', VALID_MANIFEST_YAML);
    const results = await checkParity(tmpDir);
    expect(results.some((r) => r.status === 'fail')).toBe(false);
  });
});

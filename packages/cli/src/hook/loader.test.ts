import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCompiledHooks } from './loader.js';

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-loader-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function writeManifest(content: unknown): string {
  const manifestPath = path.join(workDir, 'compiled-hooks.json');
  fs.writeFileSync(manifestPath, JSON.stringify(content), 'utf8');
  return manifestPath;
}

const validRule = {
  id: 'r1',
  packId: '@mmnto/pack-bot-coderabbit',
  trigger: { tool: 'bash', pattern: '.*' },
  check: { pattern: 'x', type: 'reject-if-match' },
  message: 'm',
};

describe('loadCompiledHooks', () => {
  it('returns an empty result when the manifest file does not exist (fresh repo)', () => {
    const result = loadCompiledHooks({
      manifestPath: path.join(workDir, 'missing.json'),
      installedPackVersions: {},
    });
    expect(result.hooks).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('records a structural error on invalid JSON', () => {
    const manifestPath = path.join(workDir, 'compiled-hooks.json');
    fs.writeFileSync(manifestPath, '{ not valid json', 'utf8');
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {},
    });
    expect(result.hooks).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('not valid JSON');
  });

  it('warns and skips when schemaVersion is higher than the runner supports', () => {
    const manifestPath = writeManifest({
      schemaVersion: 2,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: {},
      hooks: [],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {},
    });
    expect(result.hooks).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('[totem:hook-schema]');
    expect(result.warnings[0]).toContain('schemaVersion 2');
  });

  it('warns and skips when schemaVersion is missing', () => {
    const manifestPath = writeManifest({
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: {},
      hooks: [],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {},
    });
    expect(result.hooks).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('[totem:hook-schema]');
  });

  it('records a structural error when the supported-version manifest fails schema validation', () => {
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: 'not-a-real-date',
      sourcePackVersions: {},
      hooks: [],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {},
    });
    expect(result.hooks).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('schema validation');
  });

  it('returns hooks with no warnings when installed pack versions match compiled versions', () => {
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
      hooks: [validRule],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
    });
    expect(result.hooks).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('emits a staleness warning when the installed pack version differs from compiled', () => {
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
      hooks: [validRule],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: { '@mmnto/pack-bot-coderabbit': '1.1.0' },
    });
    expect(result.hooks).toHaveLength(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('[totem:hook-stale]');
    expect(result.warnings[0]).toContain('@mmnto/pack-bot-coderabbit');
    expect(result.warnings[0]).toContain('compiled against 1.0.0, installed 1.1.0');
  });

  it('emits a staleness warning when a compiled-against pack is not installed at all', () => {
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
      hooks: [validRule],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {},
    });
    expect(result.hooks).toHaveLength(1);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('not currently installed');
  });

  it('ignores extra installed packs not in sourcePackVersions (no warning)', () => {
    // A pack installed after the last `totem sync` is benign — its hooks
    // are not yet active, but that is not staleness in the compiled set.
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
      hooks: [validRule],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {
        '@mmnto/pack-bot-coderabbit': '1.0.0',
        '@mmnto/pack-bot-gemini-code-assist': '1.0.0',
      },
    });
    expect(result.warnings).toEqual([]);
  });

  it('emits one staleness warning per drifting pack', () => {
    const manifestPath = writeManifest({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: {
        '@mmnto/pack-bot-coderabbit': '1.0.0',
        '@mmnto/pack-bot-gemini-code-assist': '2.0.0',
      },
      hooks: [validRule],
    });
    const result = loadCompiledHooks({
      manifestPath,
      installedPackVersions: {
        '@mmnto/pack-bot-coderabbit': '1.1.0',
        '@mmnto/pack-bot-gemini-code-assist': '2.0.1',
      },
    });
    expect(result.warnings.length).toBe(2);
  });
});

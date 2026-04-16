import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CompiledRulesFileSchema, readJsonSafe } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');

describe('@totem/pack-agent-security structure', () => {
  it('compiled-rules.json matches canonical schema with empty rules array at scaffold time', () => {
    const manifest = readJsonSafe(
      path.join(PACK_ROOT, 'compiled-rules.json'),
      CompiledRulesFileSchema,
    );
    expect(manifest.version).toBe(1);
    expect(manifest.rules).toEqual([]);
    // Scaffold PR must ship an empty pack; rule content lands in follow-up PRs (#1486-#1490).
    // If this assertion fails, someone added rules to the scaffolding PR — reject.
  });

  it('.totemignore contains the four required path exemptions', () => {
    const content = fs.readFileSync(path.join(PACK_ROOT, '.totemignore'), 'utf-8');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const required = ['scripts/', '.github/**', '**/*.test.*', '**/*.spec.*'];
    for (const pattern of required) {
      expect(lines, `missing required .totemignore entry: ${pattern}`).toContain(pattern);
    }
  });

  it('package.json exports declares root plus both data assets with explicit ./ prefixes', () => {
    const pkg = readJsonSafe<{
      exports?: Record<string, string>;
      files?: string[];
      dependencies?: Record<string, string>;
    }>(path.join(PACK_ROOT, 'package.json'));

    expect(pkg.exports).toBeDefined();
    // Root export points at package.json so bare `require.resolve('@totem/pack-agent-security')`
    // works in strict ESM contexts. GCA catch on #1503.
    expect(pkg.exports?.['.']).toBe('./package.json');
    expect(pkg.exports?.['./compiled-rules.json']).toBe('./compiled-rules.json');
    expect(pkg.exports?.['./.totemignore']).toBe('./.totemignore');
  });

  it('package.json files array lists exactly the three shippable artifacts', () => {
    const pkg = readJsonSafe<{ files?: string[] }>(path.join(PACK_ROOT, 'package.json'));
    expect(pkg.files).toBeDefined();
    // Exact set (not arrayContaining) so that an accidentally-added file to the
    // publish surface trips this test. CR catch on #1503.
    expect(pkg.files).toHaveLength(3);
    expect(new Set(pkg.files)).toEqual(
      new Set(['compiled-rules.json', '.totemignore', 'README.md']),
    );
  });

  it('package.json declares no runtime dependencies (pure data pack, no circular graph)', () => {
    const pkg = readJsonSafe<{ dependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    // Absent dependencies field is fine. Present-and-empty is fine. Present-with-entries is not.
    const deps = pkg.dependencies ?? {};
    expect(Object.keys(deps)).toEqual([]);
  });
});

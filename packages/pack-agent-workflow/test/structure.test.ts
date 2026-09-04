import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CompiledRulesFileSchema,
  loadInstalledPacks,
  readJsonSafe,
  resolveEngineVersion,
  type LoadedPack,
} from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');

describe('@mmnto/pack-agent-workflow structure', () => {
  it('compiled-rules.json matches canonical schema', () => {
    const manifest = readJsonSafe(
      path.join(PACK_ROOT, 'compiled-rules.json'),
      CompiledRulesFileSchema,
    );
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.rules)).toBe(true);
  });

  // The scaffold-era emptiness guard was retired when the nine entries landed.
  // Non-empty is now the invariant: an empty pack that loads clean is the
  // vacuous-pass shape mmnto-ai/totem#2499 closed in lint.
  it('ships a non-empty rule set', () => {
    const manifest = readJsonSafe(
      path.join(PACK_ROOT, 'compiled-rules.json'),
      CompiledRulesFileSchema,
    );
    expect(manifest.rules).not.toEqual([]);
  });

  it('.totemignore deliberately does NOT exclude .github or scripts', () => {
    const content = fs.readFileSync(path.join(PACK_ROOT, '.totemignore'), 'utf-8');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Load-bearing divergence from @mmnto/pack-agent-security, asserted rather
    // than left to convention. The fail-open-gate rule's second detector targets
    // `continue-on-error` / `|| true` masking in workflow YAML, which lives in
    // .github/workflows/. Excluding .github/** would make that rule dead on
    // arrival — the mmnto-ai/totem#2453 dead-glob class, created at birth.
    // Same reasoning for scripts/: a fail-open gate in a build script is
    // precisely the defect the rule targets.
    expect(lines).not.toContain('.github/**');
    expect(lines).not.toContain('scripts/');

    // Test files legitimately swallow errors and assert on failure paths.
    expect(lines).toContain('**/*.test.*');
    expect(lines).toContain('**/*.spec.*');
  });

  it('package.json exports declares root plus every data asset with explicit ./ prefixes', () => {
    const pkg = readJsonSafe<{ exports?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );

    expect(pkg.exports).toBeDefined();
    // Root export points at package.json so bare require.resolve() works in
    // strict ESM contexts (pack-agent-security precedent, GCA catch on #1503).
    expect(pkg.exports?.['.']).toBe('./package.json');
    expect(pkg.exports?.['./compiled-rules.json']).toBe('./compiled-rules.json');
    expect(pkg.exports?.['./.totemignore']).toBe('./.totemignore');
  });

  it('package.json files array lists exactly the three shippable artifacts', () => {
    const pkg = readJsonSafe<{ files?: string[] }>(path.join(PACK_ROOT, 'package.json'));
    expect(pkg.files).toBeDefined();
    // Exact set (not arrayContaining) so an accidental addition to the publish
    // surface trips this test. No domain-blocklist.json here — that asset is
    // specific to pack-agent-security's network-exfil family.
    expect(pkg.files).toHaveLength(3);
    expect(new Set(pkg.files)).toEqual(
      new Set(['compiled-rules.json', '.totemignore', 'README.md']),
    );
  });

  it('package.json declares no runtime dependencies (pure data pack, no circular graph)', () => {
    const pkg = readJsonSafe<{ dependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    const deps = pkg.dependencies ?? {};
    expect(Object.keys(deps)).toEqual([]);
  });

  it('package.json engines declares @mmnto/totem with a non-empty semver range (ADR-097 § Q6)', () => {
    const pkg = readJsonSafe<{ engines?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    expect(pkg.engines).toBeDefined();
    const range = pkg.engines?.['@mmnto/totem'];
    expect(typeof range).toBe('string');
    expect(range).not.toBe('');
  });

  it('the declared engine range admits the engine this workspace ships — the boot cross-check run for real (mmnto-ai/totem#2727)', () => {
    // ADR-097 § 11 makes `engines['@mmnto/totem']` deliberately immune to the
    // changesets fixed-group bump — which is exactly how a MAJOR cut carries
    // the engine past a caret range nobody rewrote. The presence assertion
    // above stays green while `pack-discovery.ts:assertEngineRangeSatisfied`
    // throws at boot for every consumer with this pack installed (the
    // mmnto-ai/totem#2758 leg's F1). So run the production predicate itself,
    // through the same `loadInstalledPacks` path `bootstrap-engine.ts` takes,
    // against the version the workspace resolves (`resolveEngineVersion()`
    // reads packages/core/package.json — the file the cut bumps). A Version
    // Packages PR re-runs this at the bumped version: a range the cut walks out
    // of goes red there, not in a consumer's terminal.
    const pkg = readJsonSafe<{ name: string; engines?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    const range = pkg.engines?.['@mmnto/totem'];
    expect(typeof range).toBe('string');
    const pack: LoadedPack = {
      name: pkg.name,
      resolvedPath: PACK_ROOT,
      declaredEngineRange: range as string,
    };
    const inMemoryPacks = [{ pack, callback: () => {} }];

    // Negative control first: the predicate is live and names the mismatch in
    // the production message. A range violation throws BEFORE the engine
    // seals, so the positive call below still runs in this process.
    expect(() => loadInstalledPacks({ inMemoryPacks, engineVersion: '0.0.1' })).toThrow(
      `Pack '${pkg.name}' requires @mmnto/totem '${range}' but the running engine is 0.0.1`,
    );

    // Positive: the range admits the engine version this workspace ships.
    const engineVersion = resolveEngineVersion();
    expect(engineVersion).not.toBe('0.0.0'); // the resolver's own could-not-read sentinel
    const loaded = loadInstalledPacks({ inMemoryPacks });
    expect(loaded.map((p) => p.name)).toEqual([pkg.name]);
  });
});

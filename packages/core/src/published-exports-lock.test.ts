/**
 * Published-package `./package.json` subpath lock (mmnto-ai/totem#2917).
 *
 * Every public workspace package exposes its own manifest through its exports
 * map, so `require('@mmnto/<pkg>/package.json')` and
 * `import.meta.resolve('@mmnto/<pkg>/package.json')` resolve instead of
 * throwing ERR_PACKAGE_PATH_NOT_EXPORTED. Two consumers measured the throw
 * on 2.9.1 before this lock existed (strategy's leg charters, and every
 * cohort pin-sync's installed-version check) and fell back to reading the
 * file by path.
 *
 * The lock reads the WORKSPACE manifests, not a packed tarball, and proves
 * the subpath two ways: the map carries the self-referential key, and Node's
 * own resolver reaches the manifest through that map. The second half uses
 * package self-referencing (a package may import itself by name when it
 * declares `exports`), which is a real exports-map resolution against the
 * source manifest with no install step. Private workspace packages are not
 * published and are out of scope.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_ROOT = path.resolve(HERE, '..', '..');

interface WorkspaceManifest {
  name: string;
  private?: boolean;
  exports?: Record<string, unknown>;
}

interface PublicPackage {
  dir: string;
  manifestPath: string;
  manifest: WorkspaceManifest;
}

/** Every workspace package under packages/ that is published (not private). */
function publicPackages(): PublicPackage[] {
  return fs
    .readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(PACKAGES_ROOT, entry.name);
      const manifestPath = path.join(dir, 'package.json');
      if (!fs.existsSync(manifestPath)) return undefined;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as WorkspaceManifest;
      return { dir, manifestPath, manifest };
    })
    .filter((pkg): pkg is PublicPackage => pkg !== undefined && pkg.manifest.private !== true);
}

describe('published packages expose ./package.json through their exports map (mmnto-ai/totem#2917)', () => {
  const packages = publicPackages();

  it('finds exactly the published workspace packages', () => {
    // The exact set, not a containment: a published package marked private by
    // mistake would otherwise drop out of the two loops below unnoticed, and
    // this guard is what makes their passes non-vacuous.
    const names = packages.map((pkg) => pkg.manifest.name).sort();
    expect(names).toEqual([
      '@mmnto/cli',
      '@mmnto/mcp',
      '@mmnto/pack-rust-architecture',
      '@mmnto/totem',
    ]);
  });

  it('carries a self-referential "./package.json" key in every published exports map', () => {
    for (const pkg of packages) {
      expect(pkg.manifest.exports, `${pkg.manifest.name} declares an exports map`).toBeDefined();
      expect(
        pkg.manifest.exports?.['./package.json'],
        `${pkg.manifest.name} exports["./package.json"]`,
      ).toBe('./package.json');
    }
  });

  it('resolves <name>/package.json through the exports map with the Node resolver (self-reference)', () => {
    for (const pkg of packages) {
      const require = createRequire(pkg.manifestPath);
      const specifier = `${pkg.manifest.name}/package.json`;
      let resolved: string;
      try {
        resolved = require.resolve(specifier);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
        throw new Error(`${specifier} did not resolve through the exports map (${code})`);
      }
      // realpathSync.native on both sides: path.resolve does not case-fold, so a
      // drive-letter case difference on win32, or a junction in the checkout
      // path, would otherwise fail a correct resolution.
      expect(fs.realpathSync.native(resolved)).toBe(fs.realpathSync.native(pkg.manifestPath));
      const loaded = require(specifier) as { name?: string };
      expect(loaded.name, `${specifier} loads the manifest`).toBe(pkg.manifest.name);
    }
  });
});

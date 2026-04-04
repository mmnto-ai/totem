#!/usr/bin/env node
/**
 * Publish workspace packages via npm with OIDC trusted publishing.
 *
 * Uses pnpm pack (resolves workspace: protocols) then npm publish (OIDC auth).
 * pnpm publish doesn't support OIDC (pnpm/pnpm#9812), and npm publish
 * doesn't resolve workspace: protocols — so we need both.
 *
 * Publishes in topological order: core before cli/mcp.
 * Skips already-published versions for idempotent CI retries.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Topological order: core has no workspace deps, cli and mcp depend on core.
const pkgOrder = ['core', 'cli', 'mcp'];
const pkgDirs = pkgOrder.map((d) => path.join('packages', d));

// Safety check: fail if a new package was added but not listed here
const discovered = fs
  .readdirSync('packages')
  .filter((d) => fs.existsSync(path.join('packages', d, 'package.json')));
const missing = discovered.filter((d) => !pkgOrder.includes(d));
if (missing.length > 0) {
  console.error(
    `[Totem Error] Packages not in pkgOrder: ${missing.join(', ')}. Update tools/publish-oidc.js`,
  );
  process.exitCode = 1;
  process.exit();
}

let published = 0;
let skipped = 0;

for (const dir of pkgDirs) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  if (pkg.private) continue;

  // Check if this version is already on npm
  const check = spawnSync('npm', ['view', `${pkg.name}@${pkg.version}`, 'version'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (check.status === 0 && check.stdout.trim() === pkg.version) {
    console.log(`skip: ${pkg.name}@${pkg.version} already published`);
    skipped++;
    continue;
  }

  // Pack with pnpm to resolve workspace: protocols into real version ranges
  console.log(`Packing ${pkg.name}@${pkg.version}...`);
  const pack = spawnSync('pnpm', ['pack'], {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (pack.status !== 0) {
    console.error(`[Totem Error] Failed to pack ${pkg.name} (exit ${pack.status})`);
    console.error(pack.stderr);
    process.exitCode = 1;
    break;
  }
  const tarball = pack.stdout.trim().split('\n').pop();
  if (!tarball || !fs.existsSync(path.join(dir, tarball))) {
    console.error(`[Totem Error] Failed to identify tarball for ${pkg.name}`);
    process.exitCode = 1;
    break;
  }

  // Publish the tarball with npm for OIDC auth + provenance
  console.log(`Publishing ${pkg.name}@${pkg.version}...`);
  const result = spawnSync('npm', ['publish', tarball, '--access', 'public', '--provenance'], {
    cwd: dir,
    stdio: 'inherit',
  });

  // Clean up tarball
  try {
    fs.unlinkSync(path.join(dir, tarball));
  } catch (_err) {
    // best-effort cleanup — tarball left behind is harmless
  }

  if (result.status !== 0) {
    console.error(
      `[Totem Error] Failed to publish ${pkg.name}@${pkg.version} (exit ${result.status})`,
    );
    process.exitCode = 1;
    break;
  }
  published++;
  console.log(`Published ${pkg.name}@${pkg.version}`);
}

console.log(`\nDone: ${published} published, ${skipped} skipped`);

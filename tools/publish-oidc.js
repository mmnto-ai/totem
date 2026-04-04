#!/usr/bin/env node
/**
 * Publish workspace packages via pnpm with OIDC provenance.
 * Skips already-published versions for idempotent CI retries.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pkgDirs = fs.readdirSync('packages').map((d) => path.join('packages', d));
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

  console.log(`Publishing ${pkg.name}@${pkg.version}...`);
  const result = spawnSync(
    'pnpm',
    ['publish', '--access', 'public', '--no-git-checks', '--provenance'],
    {
      cwd: dir,
      stdio: 'inherit',
    },
  );
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

#!/usr/bin/env node
/**
 * Publishes workspace packages to npm via OIDC trusted publishing.
 *
 * Mechanism:
 *   1. `pnpm pack` to produce a tarball with `workspace:*` deps resolved
 *      to concrete version ranges
 *   2. `npm publish <tarball> --provenance` to upload via OIDC
 *
 * Why this script exists:
 *   - `changeset publish` doesn't propagate OIDC tokens to pnpm child
 *     processes (changesets/action#515)
 *   - `pnpm publish` itself doesn't support OIDC (pnpm/pnpm#9812)
 *   - `npm publish` supports OIDC natively (npm 11.5+ on Node 22+) but
 *     doesn't resolve `workspace:*` protocols
 *   - Combining `pnpm pack` (resolves workspace) with `npm publish`
 *     (does OIDC) gives both.
 *
 * Preconditions when run in CI:
 *   - Workflow grants `permissions: id-token: write`
 *   - Trusted publishers configured on npm.com for each non-private package
 *   - No `NPM_TOKEN`/`NODE_AUTH_TOKEN` env (those would short-circuit OIDC)
 *   - No `.npmrc` written by `actions/setup-node`'s `registry-url`
 *
 * Outputs:
 *   - `published`: "true" if at least one package was published, else "false"
 *   - `published_packages`: newline-separated `name@version` list
 *
 * Side effects:
 *   - Creates local git tags `<name>@<version>` for each published package
 *   - Creates a GitHub release per tag with CHANGELOG section as body
 *
 * Idempotency: skips packages already published at the same version on npm.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

// Topological order: @mmnto/totem (packages/core) has no workspace deps among
// published packages; cli + mcp depend on it; pack-rust-architecture is
// independent. Private packages (pack-agent-security) are skipped at runtime
// by the `pkg.private` check, but must still appear in PKG_ORDER so the
// "new unknown package" guard below trips when packages are added.
const PKG_ORDER = ['core', 'cli', 'mcp', 'pack-agent-security', 'pack-rust-architecture'];

// Guard: fail loudly if a new package is added to packages/ but not listed
// above, so the publish order is reviewed instead of silently fallen-through.
const discovered = readdirSync(PACKAGES_DIR).filter((d) =>
  existsSync(join(PACKAGES_DIR, d, 'package.json')),
);
const unknown = discovered.filter((d) => !PKG_ORDER.includes(d));
if (unknown.length > 0) {
  console.error(`[publish-oidc] Unknown packages in packages/: ${unknown.join(', ')}`);
  console.error(
    '[publish-oidc] Add them to PKG_ORDER in tools/publish-oidc.mjs and pick a position based on workspace deps.',
  );
  process.exit(1);
}

const isAlreadyOnNpm = (name, version) => {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.status === 0 && result.stdout.trim() === version;
};

const extractChangelogSection = (pkgDir, version) => {
  const changelogPath = join(pkgDir, 'CHANGELOG.md');
  if (!existsSync(changelogPath)) return null;
  const content = readFileSync(changelogPath, 'utf-8');
  // Split on `## ` headings; sections[0] is preamble before any heading,
  // sections[1..] each start with `<version>\n<body>...`
  const sections = content.split(/^## /m);
  for (const section of sections.slice(1)) {
    const newlineIdx = section.indexOf('\n');
    const heading = (newlineIdx === -1 ? section : section.slice(0, newlineIdx)).trim();
    // Heading may be just the version or `<version> <date>` etc — match the leading token
    const headingVersion = heading.split(/\s+/)[0];
    if (headingVersion === version) {
      return newlineIdx === -1 ? '' : section.slice(newlineIdx + 1).trim();
    }
  }
  return null;
};

const published = [];

for (const dir of PKG_ORDER) {
  const pkgDir = join(PACKAGES_DIR, dir);
  const pkgJsonPath = join(pkgDir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    console.log(`[publish-oidc] Skip ${dir}: no package.json`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  if (pkg.private) {
    console.log(`[publish-oidc] Skip ${pkg.name}: private package`);
    continue;
  }

  if (isAlreadyOnNpm(pkg.name, pkg.version)) {
    console.log(`[publish-oidc] Skip ${pkg.name}@${pkg.version}: already published`);
    continue;
  }

  console.log(`[publish-oidc] Packing ${pkg.name}@${pkg.version}`);
  const packResult = spawnSync('pnpm', ['pack'], {
    cwd: pkgDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (packResult.status !== 0) {
    console.error(`[publish-oidc] pnpm pack failed for ${pkg.name} (exit ${packResult.status})`);
    console.error(packResult.stderr);
    process.exit(1);
  }
  // pnpm pack writes the tarball name to the last line of stdout; in some
  // configurations it may be an absolute path rather than a relative filename.
  // basename() normalizes both cases to the bare filename so join() stays sane.
  const tarballLine = packResult.stdout.trim().split('\n').pop();
  const tarballName = tarballLine ? basename(tarballLine) : '';
  const tarballPath = join(pkgDir, tarballName);
  if (!tarballName || !existsSync(tarballPath)) {
    console.error(`[publish-oidc] Couldn't locate tarball after pnpm pack for ${pkg.name}`);
    console.error(`stdout: ${packResult.stdout}`);
    process.exit(1);
  }

  console.log(`[publish-oidc] Publishing ${pkg.name}@${pkg.version} via OIDC`);
  const publishResult = spawnSync(
    'npm',
    ['publish', tarballName, '--provenance', '--access', 'public'],
    {
      cwd: pkgDir,
      stdio: 'inherit',
    },
  );

  try {
    unlinkSync(tarballPath);
  } catch {
    // best-effort cleanup
  }

  if (publishResult.status !== 0) {
    console.error(`[publish-oidc] npm publish failed for ${pkg.name}@${pkg.version}`);
    console.error(
      '[publish-oidc] If this is E404 on a previously-published package: verify trusted publishers configured on npm.com for this package match repo=mmnto-ai/totem workflow=release.yml.',
    );
    process.exit(1);
  }

  published.push({ name: pkg.name, version: pkg.version, dir: pkgDir });
}

// Tag + GitHub release per published package.
for (const { name, version, dir } of published) {
  const tag = `${name}@${version}`;

  // Tag may already exist from a prior partial run; skip silently.
  const tagExists = spawnSync('git', ['rev-parse', tag], { stdio: 'ignore' }).status === 0;
  if (!tagExists) {
    spawnSync('git', ['tag', tag], { stdio: 'inherit' });
    console.log(`[publish-oidc] Tagged ${tag}`);
  }

  const releaseExists = spawnSync('gh', ['release', 'view', tag], { stdio: 'ignore' }).status === 0;
  if (releaseExists) {
    console.log(`[publish-oidc] GitHub release ${tag} already exists, skipping`);
    continue;
  }

  const notes = extractChangelogSection(dir, version) ?? `Released ${name}@${version}`;
  const releaseResult = spawnSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--title',
      `${name}@${version}`,
      '--notes',
      notes,
      '--target',
      'main',
    ],
    { stdio: 'inherit' },
  );
  if (releaseResult.status !== 0) {
    console.error(
      `[publish-oidc] gh release create failed for ${tag} (continuing — publish itself succeeded)`,
    );
  }
}

const publishedFlag = published.length > 0 ? 'true' : 'false';
const publishedList = published.map((p) => `${p.name}@${p.version}`).join('\n');
console.log(`[publish-oidc] Done: ${published.length} published`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `published=${publishedFlag}\n`);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `published_packages<<EOF_PUBLISHED\n${publishedList}\nEOF_PUBLISHED\n`,
  );
}

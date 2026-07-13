/**
 * Packed-tarball supported-subpath contract (mmnto-ai/totem#2336).
 *
 * These tests exercise the PUBLISHED package shape, not the workspace source
 * graph: they `pnpm pack` the core package, extract the tarball into an
 * isolated `node_modules/@mmnto/totem` sandbox, and then resolve every
 * supported subpath (`./config`, `./lessons`, `./artifacts`, `./packs`)
 * through the exports map — as Node ESM at runtime AND as TypeScript type
 * resolution — plus an ADR-097 synchronous-CJS `register.cjs` pack proving
 * registration works through that published shape.
 *
 * The sandbox lives under core's own `node_modules/` for two reasons: it is
 * git- and prettier-ignored there, and the extracted package's transitive
 * deps (`zod`, `remark-*`, `semver`, …) resolve via core's `node_modules`
 * ancestor without a network install.
 *
 * Windows-CI note: no test here spawns real `git`; the only child processes
 * are `tsc` (core build), `pnpm pack`, `tar`, and `node`/`tsc` over the
 * sandbox — none touch a git seam.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(HERE, '..');
const INTEGRATION_TIMEOUT_MS = 180_000;

/** The supported (curated, semver-tracked) subpaths minted by #2336. */
const SUPPORTED_SUBPATHS = ['./config', './lessons', './artifacts', './packs'] as const;

/** Absolute path to the workspace `tsc` (typescript is a core dependency). */
const TSC_BIN = require.resolve('typescript/bin/tsc');

let sandbox = '';
let installedPkgDir = '';

/** Run a child process, failing loud (never fail-open) with captured output. */
function run(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string },
): { stdout: string; stderr: string } {
  // Node 24 on win32 refuses to spawn `.cmd` shims (e.g. `pnpm`) without a
  // shell, and `node.exe` itself lives under a path with a space ("Program
  // Files"). Route win32 through the shell with manual quoting; posix spawns
  // directly so no shell quoting is involved.
  const res =
    process.platform === 'win32'
      ? spawnSync(
          [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' '),
          { cwd: opts.cwd, encoding: 'utf-8', shell: true },
        )
      : spawnSync(cmd, [...args], { cwd: opts.cwd, encoding: 'utf-8', shell: false });
  if (res.error) {
    throw new Error(`spawn failed for \`${cmd}\`: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(' ')}\` exited ${String(res.status)}\n` +
        `stdout:\n${res.stdout ?? ''}\nstderr:\n${res.stderr ?? ''}`,
    );
  }
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeAll(() => {
  // 1. Require a current build. Turbo's `test` task `dependsOn: ["build"]`, so
  //    dist is fresh before tests run; the gate flow (`pnpm -r build` first)
  //    guarantees the same. We assert rather than rebuild here so this test
  //    never races a concurrent `tsc -p core` from a sibling package's test.
  for (const rel of [
    'dist/index.js',
    'dist/config.js',
    'dist/lessons.js',
    'dist/artifacts.js',
    'dist/packs.js',
  ]) {
    if (!fs.existsSync(path.join(CORE_ROOT, rel))) {
      throw new Error(
        `core dist/${rel} is missing — build core first (\`pnpm -r build\`; turbo builds before test in CI).`,
      );
    }
  }

  // 2. Isolated sandbox under core's node_modules (git/prettier-ignored;
  //    transitive deps resolve via the core node_modules ancestor).
  sandbox = fs.mkdtempSync(path.join(CORE_ROOT, 'node_modules', '.totem-packtest-'));

  // 3. Pack the core package into the sandbox.
  const packDest = path.join(sandbox, 'tgz');
  fs.mkdirSync(packDest, { recursive: true });
  run('pnpm', ['pack', '--pack-destination', packDest], { cwd: CORE_ROOT });
  const tarball = fs
    .readdirSync(packDest)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => path.join(packDest, f))[0];
  if (!tarball) {
    throw new Error(`pnpm pack produced no .tgz in ${packDest}`);
  }

  // 4. Extract into node_modules/@mmnto/totem (strip the `package/` prefix).
  //    Pass RELATIVE, forward-slash paths with cwd=sandbox so no drive-letter
  //    colon reaches tar — GNU tar (MSYS) otherwise reads `D:\…` as a remote
  //    `host:path`, and bsdtar rejects `--force-local`, so relative paths are
  //    the only form both accept.
  installedPkgDir = path.join(sandbox, 'node_modules', '@mmnto', 'totem');
  fs.mkdirSync(installedPkgDir, { recursive: true });
  const tarballRel = path.relative(sandbox, tarball).replace(/\\/g, '/');
  run('tar', ['-xzf', tarballRel, '-C', 'node_modules/@mmnto/totem', '--strip-components=1'], {
    cwd: sandbox,
  });
});

afterAll(() => {
  if (sandbox) {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
  }
});

describe('@mmnto/totem packaged subpath exports (#2336)', () => {
  it(
    'declares every supported subpath in the packed exports map with existing targets',
    () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(installedPkgDir, 'package.json'), 'utf-8'),
      ) as { exports?: Record<string, { import?: string; types?: string }> };
      const exportsMap = pkg.exports ?? {};

      // The legacy root barrel stays present and byte-compatible.
      expect(exportsMap['.']).toEqual({
        import: './dist/index.js',
        types: './dist/index.d.ts',
      });

      for (const subpath of SUPPORTED_SUBPATHS) {
        const entry = exportsMap[subpath];
        expect(entry, `exports["${subpath}"] present`).toBeDefined();
        expect(entry?.import, `${subpath} import condition`).toMatch(/^\.\/dist\/.+\.js$/);
        expect(entry?.types, `${subpath} types condition`).toMatch(/^\.\/dist\/.+\.d\.ts$/);
        expect(
          fs.existsSync(path.join(installedPkgDir, entry?.import ?? '')),
          `${subpath} import target exists in tarball`,
        ).toBe(true);
        expect(
          fs.existsSync(path.join(installedPkgDir, entry?.types ?? '')),
          `${subpath} types target exists in tarball`,
        ).toBe(true);
      }
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'imports every supported subpath from the packed artifact as Node ESM (via the package specifier)',
    () => {
      const consumer = path.join(sandbox, 'esm-consumer.mjs');
      fs.writeFileSync(
        consumer,
        [
          "import * as config from '@mmnto/totem/config';",
          "import * as lessons from '@mmnto/totem/lessons';",
          "import * as artifacts from '@mmnto/totem/artifacts';",
          "import * as packs from '@mmnto/totem/packs';",
          'const report = {',
          '  config: typeof config.TotemConfigSchema !== "undefined" && typeof config.getConfigTier === "function",',
          '  lessons: typeof lessons.lessonFileName === "function" && typeof lessons.LessonRoleSchema !== "undefined",',
          '  artifacts: typeof artifacts.VerdictArtifactSchema !== "undefined" && artifacts.VERDICT_ARTIFACT_SCHEMA_VERSION === "1.0.0",',
          '  packs: typeof packs.loadInstalledPacks === "function" && typeof packs.isEngineSealed === "function" && typeof packs.InstalledPacksManifestSchema !== "undefined",',
          '};',
          'process.stdout.write(JSON.stringify(report));',
          '',
        ].join('\n'),
      );

      const { stdout } = run(process.execPath, [consumer], { cwd: sandbox });
      const report = JSON.parse(stdout) as Record<string, boolean>;
      expect(report).toEqual({
        config: true,
        lessons: true,
        artifacts: true,
        packs: true,
      });
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'resolves every supported subpath through the packed types condition (tsc node16)',
    () => {
      fs.writeFileSync(
        path.join(sandbox, 'type-consumer.ts'),
        [
          "import type { TotemConfig } from '@mmnto/totem/config';",
          "import type { LessonRole, LessonFrontmatter } from '@mmnto/totem/lessons';",
          "import type { VerdictArtifact } from '@mmnto/totem/artifacts';",
          "import type { PackRegistrationAPI, InstalledPacksManifest } from '@mmnto/totem/packs';",
          '// Referencing the imported types forces full type resolution through',
          '// the exports map; an unresolved specifier fails tsc with TS2307.',
          'export type Probe = [',
          '  TotemConfig,',
          '  LessonRole,',
          '  LessonFrontmatter,',
          '  VerdictArtifact,',
          '  PackRegistrationAPI,',
          '  InstalledPacksManifest,',
          '];',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(sandbox, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              module: 'node16',
              moduleResolution: 'node16',
              target: 'ES2022',
              strict: true,
              noEmit: true,
              skipLibCheck: true,
              types: [],
            },
            files: ['type-consumer.ts'],
          },
          null,
          2,
        ),
      );

      // Exits 0 only if all four supported subpaths resolve their `types`
      // condition through the packed exports map.
      run(process.execPath, [TSC_BIN, '-p', 'tsconfig.json'], { cwd: sandbox });
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'registers a synchronous CJS register.cjs pack through the published /packs shape (ADR-097)',
    () => {
      // Fixture pack: a synchronous CommonJS `register.cjs` exporting the
      // ADR-097 CJS-friendly named `register` callback.
      const fixtureDir = path.join(sandbox, 'fixture-pack');
      fs.mkdirSync(fixtureDir, { recursive: true });
      const registerCjs = path.join(fixtureDir, 'register.cjs');
      fs.writeFileSync(
        registerCjs,
        [
          '// Synchronous CJS pack registration entry (ADR-097 § 5 Q5).',
          'module.exports.register = function register(api) {',
          "  api.registerChunkStrategy('adr097-cjs-fixture', class FixtureChunker {});",
          '};',
          '',
        ].join('\n'),
      );

      // installed-packs.json pointing at the fixture's absolute register.cjs.
      const projectRoot = path.join(sandbox, 'project');
      fs.mkdirSync(path.join(projectRoot, '.totem'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, '.totem', 'installed-packs.json'),
        JSON.stringify(
          {
            version: 1,
            packs: [
              {
                name: 'adr097-cjs-fixture-pack',
                resolvedPath: registerCjs,
                declaredEngineRange: '*',
              },
            ],
          },
          null,
          2,
        ),
      );

      // Load through the PUBLISHED package specifier (not workspace src).
      const consumer = path.join(sandbox, 'adr097-consumer.mjs');
      fs.writeFileSync(
        consumer,
        [
          "import { loadInstalledPacks } from '@mmnto/totem/packs';",
          `const loaded = loadInstalledPacks(${JSON.stringify({
            projectRoot,
            totemDir: '.totem',
            engineVersion: '1.0.0',
          })});`,
          'process.stdout.write(JSON.stringify(loaded.map((p) => p.name)));',
          '',
        ].join('\n'),
      );

      const { stdout } = run(process.execPath, [consumer], { cwd: sandbox });
      const names = JSON.parse(stdout) as string[];
      expect(names).toContain('adr097-cjs-fixture-pack');
    },
    INTEGRATION_TIMEOUT_MS,
  );
});

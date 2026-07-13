/**
 * `build:lite` gate (mmnto-ai/totem#2336).
 *
 * The lite binary is an esbuild bundle of `src/index-lite.ts` with native/WASM
 * deps aliased to shims (`@ast-grep/napi` → WASM shim, `@lancedb/lancedb` →
 * stub). Those aliases are resolver-sensitive, so any change to the core
 * package's module/exports shape can silently break the bundle. This test
 * asserts the lite artifact still builds green and emits a non-empty bundle.
 *
 * Windows-CI note: no git seam is touched — the only child process is
 * `node build/esbuild-lite.mjs`.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(HERE, '..');
const CORE_ROOT = path.resolve(CLI_ROOT, '..', 'core');
const LITE_BUILD_TIMEOUT_MS = 180_000;

/** Run a child process, failing loud with captured output. */
function run(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string },
): { stdout: string; stderr: string; status: number } {
  // win32/Node 24: route through the shell with manual quoting (node.exe lives
  // under a path with a space); posix spawns directly.
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
  return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', status: res.status ?? -1 };
}

describe('build:lite gate (#2336)', () => {
  it(
    'bundles the lite binary green with the core exports shape',
    () => {
      // The lite bundle resolves `@mmnto/totem` to core's built dist, so core
      // must be built first. Turbo's `test` task `dependsOn: ["build"]` (and
      // the gate flow `pnpm -r build`) guarantees this; assert rather than
      // rebuild to avoid racing a sibling package's concurrent core build.
      if (!fs.existsSync(path.join(CORE_ROOT, 'dist', 'index.js'))) {
        throw new Error(
          'core dist/index.js is missing — build core first (`pnpm -r build`; turbo builds before test in CI).',
        );
      }

      const res = run(process.execPath, ['build/esbuild-lite.mjs'], { cwd: CLI_ROOT });
      expect(
        res.status,
        `build:lite exited non-zero\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
      ).toBe(0);

      const bundle = path.join(CLI_ROOT, 'dist', 'lite', 'totem-lite.mjs');
      expect(fs.existsSync(bundle), 'lite bundle emitted').toBe(true);
      expect(fs.statSync(bundle).size, 'lite bundle non-empty').toBeGreaterThan(0);
    },
    LITE_BUILD_TIMEOUT_MS,
  );
});

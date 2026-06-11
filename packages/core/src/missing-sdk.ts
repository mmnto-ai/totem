/**
 * Context-correct remediation for missing externalized LLM SDKs
 * (mmnto-ai/totem#2018 L2).
 *
 * The LLM SDKs (`@google/genai`, `@anthropic-ai/sdk`, `openai`) are optional
 * peer dependencies by design (mmnto-ai/totem#2018 / the `google-genai-coupling`
 * parity contract): they must resolve from the CONSUMING PROJECT, never from
 * this package. That design has a sharp edge: a globally-installed `totem`
 * binary can never resolve them — and installing the SDK globally does not fix
 * it either (verified empirically on mmnto-ai/totem#2018). The remediation
 * therefore has to branch on context, or it sends the user down a dead end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Walk up from `start`, returning the first dir for which `probe` hits. */
function findUp(start: string, probe: (dir: string) => boolean): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    if (probe(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** True when `pkg` is physically present under `dir/node_modules`. */
function hasLocalInstall(dir: string, pkg: string): boolean {
  return fs.existsSync(path.join(dir, 'node_modules', ...pkg.split('/'), 'package.json'));
}

/** True when `dir` is the totem monorepo root (the dogfood checkout). */
function isTotemWorkspaceRoot(dir: string): boolean {
  const cliPkg = path.join(dir, 'packages', 'cli', 'package.json');
  if (!fs.existsSync(cliPkg)) return false;
  // Probe-grade match, no JSON.parse: this only needs to RECOGNIZE the totem
  // monorepo, and parsing would force a fail-open catch around content that a
  // detection probe must treat as "not the workspace" anyway.
  return /"name"\s*:\s*"@mmnto\/cli"/.test(fs.readFileSync(cliPkg, 'utf-8'));
}

/**
 * Detect the active package manager from `npm_config_user_agent` (set by
 * npm/pnpm/yarn/bun when running scripts). Falls back to pnpm — the case with
 * no user agent is a direct global-binary invocation, where the hint's
 * `exec totem` phrasing is pnpm-flavored anyway. Mirrors the CLI's
 * `detectPackageManager` (core cannot import from the CLI package).
 */
function detectPackageManagerFromEnv(): string {
  const ua = process.env['npm_config_user_agent'] ?? '';
  if (ua.startsWith('npm')) return 'npm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'pnpm';
}

/**
 * Build the recovery hint for a failed SDK import, branched on what is
 * actually true on disk:
 *
 * 1. The cwd is inside the totem monorepo → point at the workspace build.
 *    Checked FIRST: in the workspace the SDK may ALSO sit in node_modules
 *    (sibling devDependency), and the project-local-CLI hint is wrong there
 *    (`exec totem` re-routes to the same unresolvable binary).
 * 2. The SDK IS installed in the project but this binary couldn't resolve it
 *    → the binary is the problem (global install) — point at the
 *    project-local CLI, never at another install.
 * 3. Otherwise → project-local install hint, with the externalized-by-design
 *    context and an explicit warning away from global installs.
 */
export function buildMissingSdkHint(
  pkg: string,
  opts?: { cwd?: string; packageManager?: string },
): string {
  const cwd = opts?.cwd ?? process.cwd();
  const pm = opts?.packageManager ?? detectPackageManagerFromEnv();

  const workspaceRoot = findUp(cwd, isTotemWorkspaceRoot);
  if (workspaceRoot !== undefined) {
    return (
      `This is a totem workspace checkout — run the workspace build, which resolves the SDKs: ` +
      `node packages/cli/dist/index.js <command> (from ${workspaceRoot}), after ${pm} install + ${pm} run build.`
    );
  }

  const installRoot = findUp(cwd, (dir) => hasLocalInstall(dir, pkg));
  if (installRoot !== undefined) {
    return (
      `${pkg} IS installed in this project (${installRoot}), but the running totem binary cannot resolve it — ` +
      'you are likely on a globally-installed totem, which never sees project dependencies ' +
      '(installing the SDK globally does not fix this either). ' +
      `Run the project-local CLI instead: ${pm} exec totem <command>`
    );
  }

  return (
    `Install it in the project where totem runs: ${pm} add ${pkg}. ` +
    'The LLM SDKs are optional peer dependencies by design (mmnto-ai/totem#2018) — they resolve from YOUR project, ' +
    'so a globally-installed totem cannot use them; prefer a project-local totem install.'
  );
}

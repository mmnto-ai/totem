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
  try {
    const parsed = JSON.parse(fs.readFileSync(cliPkg, 'utf-8')) as { name?: string };
    return parsed.name === '@mmnto/cli';
  } catch (err) {
    // totem-context: intentional cleanup — best-effort detection probe inside error-message construction: an unreadable/invalid package.json means "not the totem workspace" (a valid negative outcome); throwing would mask the REAL error (the missing SDK) this hint exists to explain.
    void err;
    return false;
  }
}

/**
 * Build the recovery hint for a failed SDK import, branched on what is
 * actually true on disk:
 *
 * 1. The SDK IS installed in the project but this binary couldn't resolve it
 *    → the binary is the problem (global install) — point at the
 *    project-local CLI, never at another install.
 * 2. The cwd is inside the totem monorepo → point at the workspace build.
 * 3. Otherwise → project-local install hint, with the externalized-by-design
 *    context and an explicit warning away from global installs.
 */
export function buildMissingSdkHint(
  pkg: string,
  opts?: { cwd?: string; packageManager?: string },
): string {
  const cwd = opts?.cwd ?? process.cwd();
  const pm = opts?.packageManager ?? 'pnpm';

  const installRoot = findUp(cwd, (dir) => hasLocalInstall(dir, pkg));
  if (installRoot !== undefined) {
    return (
      `${pkg} IS installed in this project (${installRoot}), but the running totem binary cannot resolve it — ` +
      'you are likely on a globally-installed totem, which never sees project dependencies ' +
      '(installing the SDK globally does not fix this either). ' +
      `Run the project-local CLI instead: ${pm} exec totem <command>`
    );
  }

  const workspaceRoot = findUp(cwd, isTotemWorkspaceRoot);
  if (workspaceRoot !== undefined) {
    return (
      `This is a totem workspace checkout — run the workspace build, which resolves the SDKs: ` +
      `node packages/cli/dist/index.js <command> (from ${workspaceRoot}), after ${pm} install + ${pm} run build.`
    );
  }

  return (
    `Install it in the project where totem runs: ${pm} add ${pkg}. ` +
    'The LLM SDKs are optional peer dependencies by design (mmnto-ai/totem#2018) — they resolve from YOUR project, ' +
    'so a globally-installed totem cannot use them; prefer a project-local totem install.'
  );
}

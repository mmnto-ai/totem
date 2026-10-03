import { resolveTotemCli } from '@mmnto/totem/cli-resolve';

/**
 * What a spawning tool runs (mmnto-ai/totem#3008): `node` (this server's own
 * `process.execPath`) plus a resolved, identity-checked CLI entry, never a
 * package-manager command and never a shell. `label` names which CLI ran.
 */
export type CliSpawnTarget =
  | { ok: true; cmd: string; entry: string; label: string }
  | { ok: false; message: string };

/**
 * Turn a project root into a spawn target, or a refusal that names the places
 * looked and the cure. No local and no npm-layout global CLI means refuse,
 * never fetch.
 */
export function resolveCliSpawn(projectRoot: string): CliSpawnTarget {
  const resolved = resolveTotemCli(projectRoot);
  if (resolved.ok) {
    const name = resolved.version !== undefined ? `@mmnto/cli@${resolved.version}` : '@mmnto/cli';
    return {
      ok: true,
      cmd: process.execPath,
      entry: resolved.entry,
      label: `${name}, ${resolved.tier}`,
    };
  }

  const [workspace, pinned, onPath] = resolved.looked;
  let message =
    `Totem CLI not found. Looked for: (1) ${workspace}; (2) ${pinned}; (3) ${onPath}. ` +
    'Add @mmnto/cli to the project (for example pnpm add -D @mmnto/cli) or install it globally with npm (npm i -g @mmnto/cli).';
  if (resolved.unverified.length > 0) {
    message += ` A totem executable was found on PATH at ${resolved.unverified.join(', ')} but is not an npm-layout install of @mmnto/cli, so it was not run.`;
  }
  return { ok: false, message };
}

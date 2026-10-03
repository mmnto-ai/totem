import { type CliResolution, resolveTotemCli } from '@mmnto/totem/cli-resolve';

const CURE =
  'Add @mmnto/cli to the project (for example pnpm add -D @mmnto/cli) or install it globally with npm (npm i -g @mmnto/cli).';

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
 * never fetch. A read failure inside the resolver (an unreadable package.json
 * mid-walk) is a refusal too: it names the error, and nothing is spawned.
 */
export function resolveCliSpawn(projectRoot: string): CliSpawnTarget {
  let resolved: CliResolution;
  // totem-context: intentional conversion, not a swallow — the catch below does
  // not rethrow by design (mmnto-ai/totem#3008): a resolver read failure becomes
  // a loud refusal that names the error, so a tool call never dies on a raw I/O
  // stack and `add_lesson` never reports a saved lesson as a failed write.
  try {
    resolved = resolveTotemCli(projectRoot);
    // totem-context: intentional conversion — see directive above the try; placed on the line before the catch keyword, where the rule reads it.
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Totem CLI could not be resolved: ${detail}. Nothing was run. ${CURE}`,
    };
  }
  if (resolved.ok) {
    const name = resolved.version !== undefined ? `@mmnto/cli@${resolved.version}` : '@mmnto/cli';
    // A `totem` earlier on PATH that could not be verified was skipped: the CLI
    // that runs is not the one the user's shell would run, so the label says so.
    const skipped =
      resolved.unverified !== undefined && resolved.unverified.length > 0
        ? ` (skipped an unverified totem earlier on PATH: ${resolved.unverified.join(', ')})`
        : '';
    return {
      ok: true,
      cmd: process.execPath,
      entry: resolved.entry,
      label: `${name}, ${resolved.tier}${skipped}`,
    };
  }

  const [workspace, pinned, onPath] = resolved.looked;
  let message =
    `Totem CLI not found. Looked for: (1) ${workspace}; (2) ${pinned}; (3) ${onPath}. ` + CURE;
  if (resolved.unverified.length > 0) {
    message += ` A totem executable was found on PATH at ${resolved.unverified.join(', ')} but could not be verified as an npm-layout install of @mmnto/cli, so it was not run.`;
  }
  return { ok: false, message };
}

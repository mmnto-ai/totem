import fs from 'node:fs';
import path from 'node:path';

import { loadCompiledHooks } from '../hook/loader.js';
import { evaluateHook, formatRejection, type ToolCallPayload } from '../hook/runtime.js';

/**
 * `totem hook run --tool <name> --args <args>` — the PreToolUse runtime
 * entrypoint (ADR-104 § Decisions 1, 2, 3 + § Convergence).
 *
 * Loads `.totem/compiled-hooks.json`, evaluates each compiled hook against
 * the tool-call payload, and emits a structured `[totem:hook-block]`
 * rejection to stderr (exit code 2) on the first match. Allow path is exit
 * code 0 with no output.
 *
 * The runtime is deterministic Node.js — no LLM calls in this path
 * (Tenet 15 corollary, ADR-103 § 8). The engine bootstrap (AST/language
 * registration via `loadInstalledPacks`) is intentionally NOT invoked here
 * because hook evaluation is regex-only in V1 and the bootstrap pulls
 * heavy runtime deps that we cannot afford on every tool call.
 *
 * Failure modes are best-effort per ADR-104 § Decision 3 + Tenet 4 carve-out:
 * - Missing manifest (fresh repo, no installed pack hooks): exit 0 silently.
 * - Stale pack versions, schemaVersion mismatch, corrupt JSON: emit
 *   structured warnings/errors to stderr, allow the tool call.
 * - Only an explicit `reject` decision from `evaluateHook` blocks.
 */

export interface HookRunCommandOptions {
  tool: string;
  args: string;
}

/**
 * Side-effect-free result for the command driver. Returns the exit code
 * the CLI wrapper should propagate, plus the stderr lines that should
 * accompany it. Keeps `executeHookRun` testable without spying on
 * `process.exit` or `console.error`.
 */
export interface HookRunResult {
  exitCode: 0 | 2;
  stderr: string[];
}

/**
 * Injectable inputs for `executeHookRun`. The CLI wrapper resolves these
 * from the working directory; tests construct them directly to avoid
 * touching the real filesystem or `process.cwd()`.
 */
export interface HookRunInputs {
  manifestPath: string;
  installedPackVersions: Record<string, string>;
  payload: ToolCallPayload;
}

const PRE_TOOL_USE_BLOCK_EXIT_CODE = 2 as const;

export async function hookRunCommand(opts: HookRunCommandOptions): Promise<void> {
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const configRoot = path.dirname(configPath);
  const manifestPath = path.join(configRoot, config.totemDir, 'compiled-hooks.json');
  const installedPackVersions = resolveInstalledPackVersions(configRoot);

  const result = executeHookRun({
    manifestPath,
    installedPackVersions,
    payload: { tool: opts.tool, args: opts.args },
  });

  for (const line of result.stderr) {
    console.error(line);
  }
  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

/**
 * Pure synchronous core. Given resolved inputs, returns the exit code and
 * stderr lines the wrapper should emit. No process state is touched.
 *
 * Two-phase contract:
 * 1. Load + emit diagnostics (warnings, structured errors) regardless of
 *    whether any hooks loaded successfully.
 * 2. Walk loaded hooks until the first reject; allow when none reject.
 *
 * Order in `stderr` is preserved: load-time diagnostics come before any
 * rejection line, so an operator inspecting stderr sees the staleness or
 * schema-mismatch context that may explain why a rejection fired.
 */
export function executeHookRun(inputs: HookRunInputs): HookRunResult {
  const { hooks, warnings, errors } = loadCompiledHooks({
    manifestPath: inputs.manifestPath,
    installedPackVersions: inputs.installedPackVersions,
  });

  const stderr: string[] = [];
  for (const w of warnings) stderr.push(w);
  for (const e of errors) stderr.push(`[totem:hook-error] ${e.message}`);

  for (const rule of hooks) {
    const decision = evaluateHook(rule, inputs.payload);
    if (decision.decision === 'reject') {
      stderr.push(formatRejection(decision));
      return { exitCode: PRE_TOOL_USE_BLOCK_EXIT_CODE, stderr };
    }
  }

  return { exitCode: 0, stderr };
}

/**
 * Scan `<projectRoot>/node_modules/@mmnto/pack-*` and read each pack's
 * `package.json` version field. Returns a `packName → version` map for
 * the compiled-hooks loader's staleness check.
 *
 * Bounded cost: one `readdirSync` plus N `readFileSync` calls (N = number
 * of installed `@mmnto/pack-*` packages, typically <5). All failures
 * are silently dropped — the loader emits `[totem:hook-stale]` warnings
 * for packs referenced in the manifest but missing from this map, which
 * is the correct signal for an operator who has uninstalled a pack but
 * not re-run `totem sync`.
 *
 * Workspace setups (pnpm workspace, yarn workspaces) symlink the pack
 * directory into `node_modules/@mmnto/`, so the `readdirSync` + JSON
 * read traverses the symlink transparently and reads the source-of-truth
 * `package.json`. No special case needed.
 */
export function resolveInstalledPackVersions(projectRoot: string): Record<string, string> {
  const result: Record<string, string> = {};
  const scopeDir = path.join(projectRoot, 'node_modules', '@mmnto');

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scopeDir, { withFileTypes: true });
    // totem-context: intentional — scope dir may not exist when no @mmnto packs are installed; valid fresh-repo state
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('pack-')) continue;
    const packName = `@mmnto/${entry.name}`;
    try {
      const pkgRaw = fs.readFileSync(path.join(scopeDir, entry.name, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as { version?: unknown };
      if (typeof pkg.version === 'string') {
        result[packName] = pkg.version;
      }
      // totem-context: intentional — individual pack metadata read failures are non-fatal; loader emits a stale warning when a pack referenced in the manifest is absent from this map
    } catch {
      continue;
    }
  }

  return result;
}

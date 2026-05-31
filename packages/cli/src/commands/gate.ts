import * as path from 'node:path';

import { isGlobalConfigPath, loadConfig, resolveConfigPath } from '../utils.js';
import { type GateTier, installGates } from './gate-install.js';

/**
 * Command-specific log tag for non-error output (log.success / log.dim).
 * `log.error` keeps the mandatory fixed literal `'Totem Error'` tag per the
 * repo styleguide (command-specific tags for info/success/dim, the unified
 * error tag for log.error).
 */
const TAG = 'Gate';

export interface GateCheckCommandOptions {
  event: string;
  payload: string;
}

export interface GateInstallCommandOptions {
  /** Install every known gate (`knownGateEvents()`). */
  all?: boolean;
  /** Install a single named gate (validated against `knownGateEvents()`). */
  name?: string;
  /**
   * Install under the advisory pilot tier (deny → exit 0 + stderr). Default
   * (omitted) bakes `--strict` (deny → exit 2), so a default install is
   * enforcement-immune. `--strict` may be passed for explicitness.
   */
  pilot?: boolean;
  /** Explicit strict tier (the default; accepted for symmetry with `--pilot`). */
  strict?: boolean;
}

/** Derive the install-time tier from the CLI options (default strict). */
function resolveTier(opts: { pilot?: boolean }): GateTier {
  return opts.pilot ? 'pilot' : 'strict';
}

/**
 * Resolve + validate the gate events to install from the CLI options. The
 * `knownGateEvents()` registry is the single source of truth: `--all`
 * enumerates it, and a named gate must be a member or we throw (mirror the
 * engine's no-default-allow — never silently install nothing).
 */
export async function resolveGateEvents(opts: GateInstallCommandOptions): Promise<string[]> {
  const { knownGateEvents, TotemError } = await import('@mmnto/totem');
  const known = knownGateEvents();

  if (opts.all) {
    return known;
  }

  const name = opts.name?.trim();
  if (!name) {
    throw new TotemError(
      'GATE_INVALID',
      'No gate selected: pass --all or --<name>.',
      `Use --all or one of: ${known.join(', ')}.`,
    );
  }

  if (!known.includes(name)) {
    throw new TotemError(
      'GATE_INVALID',
      `Unknown gate "${name}". Known gates: ${known.join(', ')}.`,
      'Use --all or one of the known gate names.',
    );
  }

  return [name];
}

/**
 * `totem gate install [--all | --<name>]`
 *
 * Idempotently merges one PreToolUse entry per selected gate into committed
 * `.claude/settings.json` and scaffolds the shared parameterized wrapper to
 * `.claude/hooks/gate-wrapper.cjs`. Thin caller of the shared `installGates`
 * merger (the same path `init --gates=` routes through) — no second copy of
 * the merge logic. Fails loud on an unknown `--<name>` (no default-install).
 */
export async function gateInstallCommand(opts: GateInstallCommandOptions): Promise<void> {
  const events = await resolveGateEvents(opts);
  const { log } = await import('../ui.js');

  const cwd = process.cwd();
  const tier = resolveTier(opts);
  const results = installGates(cwd, events, tier);

  for (const result of results) {
    if (result.err) {
      log.error('Totem Error', `Gate install failed for ${result.file}: ${result.err}`);
      continue;
    }
    const label = result.event ? `${result.file} (${result.event})` : result.file;
    if (result.action === 'created') {
      log.success(TAG, `Scaffolded ${label}`);
    } else if (result.action === 'merged') {
      log.success(TAG, `Installed gate entry into ${label}`);
    } else if (result.action === 'updated') {
      // Tier switch: the one existing entry's command was rewritten in place.
      log.success(TAG, `Updated ${result.event ?? result.file} tier to ${tier}`);
    } else {
      // Genuine same-tier no-op — the ONLY case that prints "no change".
      log.dim(TAG, `${label} already present — no change`);
    }
  }
}

/**
 * `totem gate check --event <type> --payload <json>`
 *
 * Evaluates a gate against deterministic state and writes the raw `GateVerdict`
 * JSON to stdout. The command is host-agnostic: it does NOT map the disposition
 * onto an exit code — the calling PreToolUse wrapper does that. Exit is 0 on a
 * successful evaluation (any disposition); a non-zero exit means the evaluation
 * itself failed (unknown event, bad payload, unparseable source) — never a
 * silent default-allow.
 */
export async function gateCheckCommand(opts: GateCheckCommandOptions): Promise<void> {
  // Lazy-load @mmnto/totem inside the handler (ADR-072 §3) so the heavy core
  // module never loads on unrelated CLI invocations (e.g. `totem --help`).
  const { evaluateGate, TotemError } = await import('@mmnto/totem');

  let payload: unknown;
  try {
    payload = JSON.parse(opts.payload);
  } catch (err) {
    throw new TotemError(
      'GATE_INVALID',
      'Invalid --payload JSON',
      'Pass valid JSON, e.g. --payload \'{"subsystem":"rule-compilation"}\'.',
      err,
    );
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const configRoot = isGlobalConfigPath(configPath) ? cwd : path.dirname(configPath);
  const totemDir = path.join(configRoot, config.totemDir);

  const verdict = evaluateGate(opts.event, payload, totemDir);
  process.stdout.write(JSON.stringify(verdict) + '\n');
}

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { isGlobalConfigPath, loadConfig, resolveConfigPath } from '../utils.js';
import {
  bashMatchedGateDisclosure,
  type GateInstallSpec,
  type GateTier,
  installGates,
  pilotTierCliFloorDisclosure,
} from './gate-install.js';
// The tier vocabulary is ONE string union, imported above: the install-time
// bake and the check-time `--tier` argument cannot drift apart. `GateTier` is
// spelled locally in gate-install.ts so that module imports nothing from core
// (ADR-072 §3).

/**
 * Command-specific log tag for non-error output (log.success / log.dim).
 * `log.error` keeps the mandatory fixed literal `'Totem Error'` tag per the
 * repo styleguide (command-specific tags for info/success/dim, the unified
 * error tag for log.error).
 */
const TAG = 'Gate';

export interface GateCheckCommandOptions {
  event: string;
  /** The gate's JSON payload, or `-` to read the JSON from stdin (the wrapper's channel; no argv limit). */
  payload: string;
  /**
   * Enforcement tier for the evaluated gate's UNEVALUABLE class
   * (mmnto-ai/totem#2800 R1). Default `strict`. The wrapper passes the tier it
   * was installed with, so a `--pilot` install reaches the engine. It NEVER
   * softens a predicate that actually failed (the wrapper's disposition map
   * owns that), and gates that do not read it — freeze-check, transport-shield
   * — are unaffected: freeze-check fails closed at every tier.
   */
  tier?: string;
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
 * Resolve + validate the gates to install from the CLI options, as
 * `{ event, matcher }` pairs. The core registry is the single source of truth
 * for BOTH halves (mmnto-ai/totem#2799): `knownGates()` enumerates the pairs in
 * registry order for `--all`, and a named gate must be a member or we throw
 * (mirror the engine's no-default-allow — never silently install nothing).
 * `knownGateEvents()` supplies the event names for the user-facing messages, so
 * the wording is unchanged from when this resolved event strings only.
 *
 * Resolving the matcher HERE (behind the lazy `@mmnto/totem` import, ADR-072 §3)
 * is what lets `gate-install.ts` stay core-import-free: it receives the pairs
 * rather than looking them up.
 */
export async function resolveGates(
  opts: GateInstallCommandOptions,
): Promise<ReadonlyArray<GateInstallSpec>> {
  const { knownGateEvents, knownGates, TotemError } = await import('@mmnto/totem');
  const gates = knownGates();
  const known = knownGateEvents();

  if (opts.all) {
    return gates;
  }

  const name = opts.name?.trim();
  if (!name) {
    throw new TotemError(
      'GATE_INVALID',
      'No gate selected: pass --all or --<name>.',
      `Use --all or one of: ${known.join(', ')}.`,
    );
  }

  const gate = gates.find((g) => g.event === name);
  if (!gate) {
    throw new TotemError(
      'GATE_INVALID',
      `Unknown gate "${name}". Known gates: ${known.join(', ')}.`,
      'Use --all or one of the known gate names.',
    );
  }

  return [gate];
}

/**
 * `totem gate install [--all | --<name>]`
 *
 * Idempotently merges one PreToolUse entry per selected gate into committed
 * `.claude/settings.json` — each under the matcher its registry entry declares
 * — and scaffolds the shared parameterized wrapper to
 * `.claude/hooks/gate-wrapper.cjs`. Thin caller of the shared `installGates`
 * merger (the same path `init --gates=` routes through) — no second copy of
 * the merge logic. Fails loud on an unknown `--<name>` (no default-install).
 */
export async function gateInstallCommand(opts: GateInstallCommandOptions): Promise<void> {
  const gates = await resolveGates(opts);
  const { log } = await import('../ui.js');

  const cwd = process.cwd();
  const tier = resolveTier(opts);
  const results = installGates(cwd, gates, tier);

  // The registry-resolved spec for each installed gate, keyed by event — the
  // shell-matcher disclosure below reads the matcher from it (never guesses),
  // so a registry move carries the disclosure with it.
  const specByEvent = new Map(gates.map((g) => [g.event, g]));

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

    // ─── Shell-matcher disclosure (mmnto-ai/totem#2822) ─────────────────
    // The sentence itself lives in gate-install.ts, beside the installer both
    // entry points share: `init --gates=` prints its own rows and would
    // otherwise drop this line entirely.
    const spec = result.event ? specByEvent.get(result.event) : undefined;
    const disclosure = spec ? bashMatchedGateDisclosure(spec) : null;
    if (disclosure) {
      log.dim(TAG, disclosure);
    }
  }

  // ─── Pilot-tier CLI floor (mmnto-ai/totem#2800 fold F3) ───────────────
  // Once per install, not per gate: the floor is the WRAPPER's, and one wrapper
  // serves every entry it writes.
  const tierFloor = pilotTierCliFloorDisclosure(tier);
  if (tierFloor && results.some((r) => !r.err)) {
    log.dim(TAG, tierFloor);
  }
}

/** All of stdin (fd 0) as UTF-8 — the `--payload -` channel. */
const readStdinSync = (): string => readFileSync(0, 'utf-8');

/**
 * `totem gate check --event <type> --payload <json | ->`
 *
 * Evaluates a gate against deterministic state and writes the raw `GateVerdict`
 * JSON to stdout. The command is host-agnostic: it does NOT map the disposition
 * onto an exit code — the calling PreToolUse wrapper does that. Exit is 0 on a
 * successful evaluation (any disposition); a non-zero exit means the evaluation
 * itself failed (unknown event, bad payload, unparseable source) — never a
 * silent default-allow. `--payload -` reads the JSON from stdin: the
 * distributed wrapper's channel, because a Bash command can run to tens of
 * kilobytes and win32 caps a command line at 32,767 characters — an argv
 * payload past it fails the spawn with ENAMETOOLONG (mmnto-ai/totem#2799,
 * pass 3). The argv form stays for hand runs and for wrappers installed before
 * this cut.
 */
export async function gateCheckCommand(
  opts: GateCheckCommandOptions,
  readStdin: () => string = readStdinSync,
): Promise<void> {
  // Lazy-load @mmnto/totem inside the handler (ADR-072 §3) so the heavy core
  // module never loads on unrelated CLI invocations (e.g. `totem --help`).
  const { evaluateGate, TotemError } = await import('@mmnto/totem');

  // Validate the tier at the boundary: an unrecognized value is a broken
  // wrapper install, and silently defaulting it to `strict` (or `pilot`) would
  // decide enforcement by accident.
  const rawTier = opts.tier?.trim();
  if (rawTier !== undefined && rawTier !== '' && rawTier !== 'strict' && rawTier !== 'pilot') {
    throw new TotemError(
      'GATE_INVALID',
      `Unknown --tier "${rawTier}".`,
      'Pass --tier strict (the default) or --tier pilot.',
    );
  }
  const tier: GateTier = rawTier === 'pilot' ? 'pilot' : 'strict';

  const raw = opts.payload === '-' ? readStdin() : opts.payload;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new TotemError(
      'GATE_INVALID',
      'Invalid --payload JSON',
      'Pass valid JSON, e.g. --payload \'{"subsystem":"rule-compilation"}\', or --payload - with the JSON on stdin.',
      err,
    );
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const configRoot = isGlobalConfigPath(configPath) ? cwd : path.dirname(configPath);
  const totemDir = path.join(configRoot, config.totemDir);

  // The tier rides in on the gate context; a gate's own stderr lines go to the
  // process stderr the wrapper already passes through (the engine's default
  // sink), so the verdict on stdout stays the only parsed channel.
  const verdict = evaluateGate(opts.event, payload, totemDir, { tier });
  process.stdout.write(JSON.stringify(verdict) + '\n');
}

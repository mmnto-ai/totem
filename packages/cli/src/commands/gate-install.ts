import * as path from 'node:path';

import { type HostHookEntry, upsertClaudeHookCommand } from './host-hooks.js';
import { scaffoldFile } from './init.js';
import {
  CLAUDE_GATE_WRAPPER,
  CLAUDE_GATE_WRAPPER_ENTRY,
  TOTEM_FILE_MARKER,
} from './init-templates.js';

/**
 * Install the parameterized PreToolUse gate wrapper + one PreToolUse entry per
 * named gate into committed `.claude/settings.json` (PR-C, mmnto-ai/totem#2048).
 *
 * Single source of truth for BOTH the `totem gate install` verb and
 * `totem init --gates=` — neither owns a second copy of the merge logic.
 * Thin caller of the extracted `upsertClaudeHookCommand` upsert (host-hooks.ts).
 *
 * Tier-AWARE upsert keyed on the per-gate `--event <name>` identity (which is
 * tier-independent): installing freeze-check twice at the SAME tier is a no-op,
 * installing it at a DIFFERENT tier rewrites the one existing entry's command
 * in place (never a duplicate), and freeze-check + a future second gate produce
 * two distinct entries under the shared `Write|Edit` matcher.
 *
 * `--all` / unknown-gate validation is done by the CALLER against
 * `knownGateEvents()` (the registry is the single source of truth) — this
 * function trusts that `events` are already-validated known events.
 */

/** The PreToolUse matcher every gate entry installs under. */
const GATE_MATCHER = 'Write|Edit';

/** The wrapper script's repo-relative install path. */
export const GATE_WRAPPER_REL = '.claude/hooks/gate-wrapper.cjs';

/** Enforcement tier baked into the installed command at install time. */
export type GateTier = 'strict' | 'pilot';

/** The wrapper script basename — the eject scrub keys on this substring. */
const GATE_WRAPPER_BASENAME = 'gate-wrapper.cjs';

/**
 * Collision-safe gate-identity probe: does `command` install the gate for
 * EXACTLY this `event`?
 *
 * Tokenize on whitespace and require BOTH the wrapper basename AND the token
 * immediately after `--event` to equal `event`. A loose substring `includes`
 * would let `--event freeze-check` spuriously match a future
 * `--event freeze-check-extended`. The probe is tier-INDEPENDENT (it ignores
 * the baked `--strict` / `--pilot` flag), so it identifies the single existing
 * entry for a gate REGARDLESS of tier — the upsert then either no-ops (same
 * tier) or rewrites that one entry's command (tier switch), never duplicating.
 */
export function commandInstallsGate(command: string, event: string): boolean {
  const tokens = command.split(/\s+/).filter((t) => t.length > 0);
  if (!tokens.some((t) => t.includes(GATE_WRAPPER_BASENAME))) {
    return false;
  }
  const eventIdx = tokens.indexOf('--event');
  return eventIdx !== -1 && tokens[eventIdx + 1] === event;
}

/** Build the baked PreToolUse command string for a gate at a given tier. */
function gateCommand(event: string, tier: GateTier): string {
  return `node ${GATE_WRAPPER_REL} --event ${event} --${tier}`;
}

/** Build the PreToolUse entry for a single gate (one wrapper, N gates). */
function gateEntry(event: string, tier: GateTier): HostHookEntry {
  return {
    matcher: CLAUDE_GATE_WRAPPER_ENTRY.matcher,
    hooks: [
      {
        type: CLAUDE_GATE_WRAPPER_ENTRY.hooks[0]!.type,
        command: gateCommand(event, tier),
      },
    ],
  };
}

/**
 * Outcome of a single gate install operation.
 *
 * Gate-specific (decoupled from `ScaffoldOutcome['action']`): it adds
 * `'updated'`, which the wrapper-scaffold step can never produce but the
 * tier-aware entry upsert can (re-installing a gate at a DIFFERENT tier
 * rewrites the one existing entry's command in place).
 *
 * - `created` — fresh file / wrapper written
 * - `merged`  — a new entry appended to existing settings
 * - `updated` — an existing gate entry's command rewritten in place (tier
 *               switch) — exactly one entry per gate, never duplicated
 * - `skipped` — idempotent no-op (same-tier re-install, or the wrapper's
 *               `exists` outcome normalized at the boundary; both mean "no
 *               change")
 */
export type GateInstallAction = 'created' | 'merged' | 'updated' | 'skipped';

export interface GateInstallResult {
  /** Repo-relative file the result pertains to. */
  file: string;
  /** Outcome of the operation (see {@link GateInstallAction}). */
  action: GateInstallAction;
  /** The gate event this result is for (entry results only). */
  event?: string;
  err?: string;
}

/**
 * Install the gate wrapper script + one PreToolUse entry per `event` into the
 * given repo `cwd`. Returns one result per filesystem operation (the wrapper
 * scaffold, then one entry merge per gate) for caller-side summary reporting.
 *
 * `tier` (default `'strict'`) is BAKED into the installed command string at
 * install time — the wrapper reads it ONLY from argv (no env-var override), so
 * a default install is enforcement-immune to a consumer's environment. `pilot`
 * is an explicit install-time opt-in.
 *
 * `events` MUST already be validated against `knownGateEvents()` by the
 * caller (the verb / `--gates=` parser) — no default-install, fail-loud on
 * unknown happens upstream.
 */
export function installGates(
  cwd: string,
  events: string[],
  tier: GateTier = 'strict',
): GateInstallResult[] {
  const results: GateInstallResult[] = [];
  const settingsPath = path.join(cwd, '.claude', 'settings.json');

  // 1. Scaffold the ONE parameterized wrapper script (idempotent; marker-keyed).
  //    scaffoldFile returns 'exists' when a marker-bearing Totem file is already
  //    present (the idempotent re-run case); normalize that to 'skipped' so the
  //    GateInstallResult.action stays within created|merged|skipped (both mean
  //    "no write happened, no change") — see GateInstallResult below.
  const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
  const wrapperResult = scaffoldFile(wrapperPath, CLAUDE_GATE_WRAPPER, TOTEM_FILE_MARKER);
  results.push({
    file: GATE_WRAPPER_REL,
    // `exists` normalizes to `skipped` (no write, no change); a `refreshed`
    // drift-repair (scaffoldFile's new bounded-repair action, mmnto-ai/totem#2410 —
    // unreachable here since this call threads no end marker, but kept type-safe)
    // maps to `merged` (a write happened). `created` passes through.
    action:
      wrapperResult.action === 'exists'
        ? 'skipped'
        : wrapperResult.action === 'refreshed'
          ? 'merged'
          : wrapperResult.action,
    err: wrapperResult.err,
  });

  // 2. Tier-AWARE upsert of one PreToolUse entry per gate. The gate-identity
  //    probe matches the EXACT --event token (collision-safe and
  //    tier-independent), so the upsert keeps EXACTLY ONE entry per gate:
  //    a same-tier re-run is a no-op (`skipped`), a different-tier re-install
  //    rewrites that entry's command in place (`updated`), and a NEW gate adds
  //    a second distinct entry (`merged`).
  for (const event of events) {
    const entryResult = upsertClaudeHookCommand(
      settingsPath,
      GATE_MATCHER,
      gateEntry(event, tier),
      (cmd) => commandInstallsGate(cmd, event),
    );
    results.push({
      file: '.claude/settings.json',
      action: entryResult.action,
      event,
      err: entryResult.err,
    });
  }

  return results;
}

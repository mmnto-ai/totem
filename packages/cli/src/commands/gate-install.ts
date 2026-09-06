import * as path from 'node:path';

import { type HostHookEntry, upsertClaudeHookCommand } from './host-hooks.js';
import { scaffoldFile } from './init.js';
import {
  CLAUDE_GATE_WRAPPER,
  CLAUDE_GATE_WRAPPER_ENTRY,
  TOTEM_FILE_END,
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
 * in place (never a duplicate), and each gate lands as its own entry under ITS
 * OWN matcher (mmnto-ai/totem#2799) — freeze-check under `Write|Edit`,
 * transport-shield under `Bash|PowerShell`.
 *
 * `--all` / unknown-gate validation AND matcher resolution are done by the
 * CALLER against the core registry (`knownGates()`, the single source of truth)
 * — this function trusts that `gates` are already-validated `{event, matcher}`
 * pairs. Resolving them caller-side is what keeps this module free of any
 * `@mmnto/totem` import (ADR-072 §3: core loads lazily, inside the handler).
 */

/**
 * A validated gate to install: its event name plus the PreToolUse matcher its
 * entry installs under. Structurally core's `GateMatcher`, spelled as a literal
 * union here so this module imports nothing from `@mmnto/totem` (ADR-072 §3);
 * the CALLER reads the real value from `knownGates()` and never guesses.
 */
export interface GateInstallSpec {
  event: string;
  matcher: 'Write|Edit' | 'Bash|PowerShell';
}

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

/**
 * Build the PreToolUse entry for a single gate (one wrapper, N gates). The
 * matcher comes from the GATE (resolved caller-side from the core registry);
 * `CLAUDE_GATE_WRAPPER_ENTRY` supplies only the canonical hook `type` — its own
 * `matcher` is the freeze-check exemplar, not a default for every gate.
 */
function gateEntry(gate: GateInstallSpec, tier: GateTier): HostHookEntry {
  return {
    matcher: gate.matcher,
    hooks: [
      {
        type: CLAUDE_GATE_WRAPPER_ENTRY.hooks[0]!.type,
        command: gateCommand(gate.event, tier),
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
 * Install the gate wrapper script + one PreToolUse entry per gate into the
 * given repo `cwd`. Returns one result per filesystem operation (the wrapper
 * scaffold, then one entry merge per gate) for caller-side summary reporting.
 *
 * `tier` (default `'strict'`) is BAKED into the installed command string at
 * install time — the wrapper reads it ONLY from argv (no env-var override), so
 * a default install is enforcement-immune to a consumer's environment. `pilot`
 * is an explicit install-time opt-in.
 *
 * `gates` MUST already be resolved against the core registry by the caller
 * (the verb / `--gates=` parser, through `knownGates()`) — both the
 * fail-loud-on-unknown and the matcher lookup happen upstream, so this function
 * never guesses a matcher and never default-installs.
 */
export function installGates(
  cwd: string,
  gates: ReadonlyArray<GateInstallSpec>,
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
  // Thread the end marker (mmnto-ai/totem#2413) so a bounded drifted gate-wrapper is
  // actually drift-repaired (`refreshed`) during gate install, not left stale.
  const wrapperResult = scaffoldFile(
    wrapperPath,
    CLAUDE_GATE_WRAPPER,
    TOTEM_FILE_MARKER,
    TOTEM_FILE_END,
  );
  results.push({
    file: GATE_WRAPPER_REL,
    // `exists` normalizes to `skipped` (no write, no change); a `refreshed`
    // bounded drift-repair (scaffoldFile's bounded-repair action, mmnto-ai/totem#2410)
    // maps to `merged` (a write happened). `created` passes through.
    action:
      wrapperResult.action === 'exists'
        ? 'skipped'
        : wrapperResult.action === 'refreshed'
          ? 'merged'
          : wrapperResult.action,
    err: wrapperResult.err,
  });

  // 2. Tier-AWARE upsert of one PreToolUse entry per gate, under THAT GATE'S
  //    matcher. The gate-identity probe matches the EXACT --event token
  //    (collision-safe and tier-independent), so the upsert keeps EXACTLY ONE
  //    entry per gate: a same-tier re-run is a no-op (`skipped`), a
  //    different-tier re-install rewrites that entry's command in place
  //    (`updated`), and a NEW gate adds a second distinct entry (`merged`).
  //    Because a gate's matcher is a registry fact, not a caller choice, a gate
  //    can never end up installed under two different matchers.
  for (const gate of gates) {
    const entryResult = upsertClaudeHookCommand(
      settingsPath,
      gate.matcher,
      gateEntry(gate, tier),
      (cmd) => commandInstallsGate(cmd, gate.event),
    );
    results.push({
      file: '.claude/settings.json',
      action: entryResult.action,
      event: gate.event,
      err: entryResult.err,
    });
  }

  return results;
}

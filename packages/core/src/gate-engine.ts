import * as path from 'node:path';

import { TotemError } from './errors.js';
import { FREEZE_FILE, readFreezeConfig } from './freeze.js';
import type { GateDefinition, GateEvaluator, GateMatcher, GateVerdict } from './gate-types.js';
import { TRANSPORT_SHIELD_EVENT, transportShieldEvaluator } from './transport-shield.js';

export const FREEZE_CHECK_EVENT = 'freeze-check';

/**
 * freeze-check: `deny` iff the payload's `subsystem` exactly matches a frozen
 * subsystem in `.totem/freeze.json`; otherwise `allow`. Absent freeze file →
 * `allow` (nothing frozen).
 *
 * freeze.json is a human-authored, deterministic "do not touch" list, so an
 * exact subsystem match is FP≈0 and warrants a hard `deny` (OQ2). Glob-matching
 * a touched path against a frozen entry's `do-not` list is a documented
 * follow-on; V1 matches on the explicit `subsystem` field.
 */
const freezeCheckEvaluator: GateEvaluator = (payload, totemDir): GateVerdict => {
  const rawSubsystem =
    payload &&
    typeof payload === 'object' &&
    typeof (payload as { subsystem?: unknown }).subsystem === 'string'
      ? (payload as { subsystem: string }).subsystem
      : undefined;

  // Normalize ONCE so the non-empty guard, the freeze-match comparison, and the
  // emitted provenance all use the same value. Otherwise a padded subsystem
  // (e.g. " rule-compilation ") passes the guard but fails the exact match,
  // silently turning a frozen subsystem into `allow` — a freeze bypass.
  const subsystem = rawSubsystem?.trim();

  if (!subsystem) {
    throw new TotemError(
      'GATE_INVALID',
      'freeze-check payload requires a non-empty "subsystem" string.',
      'Pass --payload \'{"subsystem":"<name>"}\'.',
    );
  }

  const checkedAt = new Date().toISOString();
  // Stable, OS-independent provenance label derived from the configured totem
  // dir name (e.g. `.totem` or a custom `.totem-custom`) — NOT a resolvable
  // absolute path. Forward-slash by construction so it is deterministic across
  // platforms and machines (the audit trail must not leak cwd/host paths).
  const source = `${path.basename(totemDir)}/${FREEZE_FILE}`;
  const config = readFreezeConfig(totemDir);

  if (config === null) {
    return {
      disposition: 'allow',
      reason: 'No freeze file present — nothing is frozen.',
      provenance: { source, ref: 'no-freeze-file', matched: null, checkedAt },
    };
  }

  const match = config.frozen.find((e) => e.subsystem === subsystem);
  if (match) {
    const why = match.reason ? ` (${match.reason})` : '';
    return {
      disposition: 'deny',
      reason: `Subsystem "${subsystem}" is frozen${why}.`,
      provenance: { source, ref: subsystem, matched: match.subsystem, checkedAt },
    };
  }

  return {
    disposition: 'allow',
    reason: `Subsystem "${subsystem}" is not frozen.`,
    provenance: { source, ref: subsystem, matched: null, checkedAt },
  };
};

/**
 * Bounded registry of gate definitions, keyed by event type. Immutable after
 * load. Each entry carries the PreToolUse matcher its host entry installs under
 * (mmnto-ai/totem#2799): the installer reads it from here through
 * `knownGates()` / `gateMatcher()` and never guesses.
 */
const REGISTRY: ReadonlyMap<string, GateDefinition> = new Map<string, GateDefinition>([
  [FREEZE_CHECK_EVENT, { evaluator: freezeCheckEvaluator, matcher: 'Write|Edit' }],
  [TRANSPORT_SHIELD_EVENT, { evaluator: transportShieldEvaluator, matcher: 'Bash|PowerShell' }],
]);

/** The known gate event types — for error messages and host discovery. */
export function knownGateEvents(): string[] {
  return [...REGISTRY.keys()];
}

/** Every known gate with the matcher it installs under, in registry order. */
export function knownGates(): ReadonlyArray<{ event: string; matcher: GateMatcher }> {
  return [...REGISTRY.entries()].map(([event, def]) => ({ event, matcher: def.matcher }));
}

/**
 * The PreToolUse matcher a gate installs under. Throws (fail-loud) on an
 * unknown event — never a default matcher.
 */
export function gateMatcher(event: string): GateMatcher {
  const def = REGISTRY.get(event);
  if (!def) {
    throw new TotemError(
      'GATE_INVALID',
      `Unknown gate event "${event}". Known events: ${knownGateEvents().join(', ')}.`,
      'Use one of the known --event values.',
    );
  }
  return def.matcher;
}

/**
 * Evaluate a gate. Pure with respect to state: reads deterministic sources,
 * never mutates. Throws (fail-loud) on an unknown event or an unparseable
 * source — it never default-allows.
 */
export function evaluateGate(event: string, payload: unknown, totemDir: string): GateVerdict {
  const def = REGISTRY.get(event);
  if (!def) {
    throw new TotemError(
      'GATE_INVALID',
      `Unknown gate event "${event}". Known events: ${knownGateEvents().join(', ')}.`,
      'Use one of the known --event values.',
    );
  }
  return def.evaluator(payload, totemDir);
}

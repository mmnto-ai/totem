import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TotemConfig } from '@mmnto/totem';

// ─── Types ──────────────────────────────────────────────

export interface PilotState {
  startedAt: string; // ISO 8601
  pushCount: number;
  violations: Array<{
    timestamp: string;
    hook: string;
    detail: string;
  }>;
}

export interface PilotConfig {
  maxDays: number;
  maxPushes: number;
}

// ─── Defaults ───────────────────────────────────────────

const DEFAULT_MAX_DAYS = 14;
const DEFAULT_MAX_PUSHES = 50;

// ─── Config resolution ──────────────────────────────────

/**
 * Resolve the `pilot` field from TotemConfig into a concrete PilotConfig,
 * or null if pilot mode is not enabled.
 */
export function resolvePilotConfig(config: TotemConfig): PilotConfig | null {
  if (config.pilot === undefined || config.pilot === false) return null;

  if (config.pilot === true) {
    return { maxDays: DEFAULT_MAX_DAYS, maxPushes: DEFAULT_MAX_PUSHES };
  }

  return {
    maxDays: config.pilot.maxDays ?? DEFAULT_MAX_DAYS,
    maxPushes: config.pilot.maxPushes ?? DEFAULT_MAX_PUSHES,
  };
}

// ─── State persistence ──────────────────────────────────

function statePath(totemDir: string): string {
  return path.join(totemDir, 'pilot-state.json');
}

function isValidState(obj: unknown): obj is PilotState {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const rec = obj as Record<string, unknown>;

  if (typeof rec['startedAt'] !== 'string') return false;
  if (typeof rec['pushCount'] !== 'number') return false;
  if (!Array.isArray(rec['violations'])) return false;

  for (const v of rec['violations']) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const vr = v as Record<string, unknown>;
    if (typeof vr['timestamp'] !== 'string') return false;
    if (typeof vr['hook'] !== 'string') return false;
    if (typeof vr['detail'] !== 'string') return false;
  }

  return true;
}

/** What a pilot-state read did, measured by the read itself (mmnto-ai/totem#2815). */
export type PilotStateOutcome =
  | 'present' // a valid file, returned untouched
  | 'initialised' // no file; a fresh state written
  | 'reinitialised-invalid' // a file that was not valid JSON or not a pilot state; replaced
  | 'reinitialised-unreadable'; // a file this process could not read; replaced

/**
 * Read the pilot state from disk and say what the read did. A missing, unreadable or
 * invalid file is replaced by a fresh state (an atomic write), and the outcome names
 * which of those happened, so a caller reporting the result never has to read the file
 * beside this function and guess from the bytes (a preliminary read that fails while
 * this one succeeds would otherwise be reported as a reset that never happened).
 */
export function readPilotStateWithOutcome(totemDir: string): {
  state: PilotState;
  outcome: PilotStateOutcome;
} {
  const fp = statePath(totemDir);
  let outcome: PilotStateOutcome = 'initialised';

  if (fs.existsSync(fp)) {
    let raw: string | undefined;
    try {
      raw = fs.readFileSync(fp, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (isValidState(parsed)) return { state: parsed, outcome: 'present' };
      // totem-context: intentional — a file that cannot be read or parsed is one of the two re-initialise outcomes this function reports to its caller; the fresh state is written below, and `raw` says which failure it was.
    } catch {
      // Fall through to the rewrite; `raw` stays undefined only when the read itself threw.
    }
    outcome = raw === undefined ? 'reinitialised-unreadable' : 'reinitialised-invalid';
  }

  const fresh: PilotState = {
    startedAt: new Date().toISOString(),
    pushCount: 0,
    violations: [],
  };
  writePilotState(totemDir, fresh);
  return { state: fresh, outcome };
}

/**
 * Read the pilot state from disk. If the file is missing, unreadable or invalid,
 * initializes a fresh state and persists it.
 */
export function readPilotState(totemDir: string): PilotState {
  return readPilotStateWithOutcome(totemDir).state;
}

/**
 * Atomically write pilot state to disk (write to tmp, then rename).
 */
export function writePilotState(totemDir: string, state: PilotState): void {
  const fp = statePath(totemDir);
  const dir = path.dirname(fp);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, fp);
}

// ─── Expiry check ───────────────────────────────────────

/**
 * Check whether the pilot period has expired based on elapsed days or push count.
 */
export function isPilotExpired(
  state: PilotState,
  config: PilotConfig,
): { expired: boolean; reason?: string } {
  const startMs = new Date(state.startedAt).getTime();
  const elapsedDays = (Date.now() - startMs) / (1000 * 60 * 60 * 24);

  if (elapsedDays > config.maxDays) {
    return {
      expired: true,
      reason: `Pilot period expired: ${Math.floor(elapsedDays)} days elapsed (limit: ${config.maxDays}).`,
    };
  }

  if (state.pushCount >= config.maxPushes) {
    return {
      expired: true,
      reason: `Pilot period expired: ${state.pushCount} pushes reached (limit: ${config.maxPushes}).`,
    };
  }

  return { expired: false };
}

// ─── Wrapper ────────────────────────────────────────────

/**
 * Wrap a hook execution in pilot mode:
 * - If the pilot period has expired, prints an error and returns exit code 1.
 * - If the inner fn succeeds (exit 0), increments pushCount and returns 0.
 * - If the inner fn fails (exit non-zero), logs the violation as a WARNING
 *   and returns 0 (warn-only).
 */
export async function withPilotMode(
  hookName: string,
  totemDir: string,
  pilotConfig: PilotConfig,
  fn: () => Promise<number>,
): Promise<number> {
  const state = readPilotState(totemDir);

  const { expired, reason } = isPilotExpired(state, pilotConfig);
  if (expired) {
    console.error(`[Totem] ${reason} Hooks are now enforced. Run \`totem init\` to reconfigure.`);
    return 1;
  }

  const exitCode = await fn();

  if (exitCode === 0) {
    state.pushCount += 1;
    writePilotState(totemDir, state);
    return 0;
  }

  // Non-zero: log violation, warn instead of block — but still consume budget
  state.pushCount += 1;
  state.violations.push({
    timestamp: new Date().toISOString(),
    hook: hookName,
    detail: `Hook exited with code ${exitCode}`,
  });
  writePilotState(totemDir, state);

  console.error(
    `[Totem] WARNING: ${hookName} would have blocked (exit ${exitCode}), but pilot mode is active. ` +
      `${state.pushCount}/${pilotConfig.maxPushes} pushes used.`,
  );

  return 0;
}

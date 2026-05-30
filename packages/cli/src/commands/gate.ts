import * as path from 'node:path';

import { evaluateGate, TotemError } from '@mmnto/totem';

import { isGlobalConfigPath, loadConfig, resolveConfigPath } from '../utils.js';

export interface GateCheckCommandOptions {
  event: string;
  payload: string;
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

import { describe, expect, it } from 'vitest';

import { isInstalledGateCommand } from './eject.js';
import { commandInstallsGate } from './gate-install.js';

// The eject scrub's gate needle must agree with the installer's own probe on
// every shape the installer writes (mmnto-ai/totem#2799 pass-2 fold, P2-F18):
// an entry commandInstallsGate owns must be ejectable, and a user hook that only
// mentions the wrapper's basename must survive.

describe('isInstalledGateCommand — the eject needle agrees with the installer probe', () => {
  const installed = [
    'node .claude/hooks/gate-wrapper.cjs --event freeze-check --strict',
    'node .claude/hooks/gate-wrapper.cjs --event transport-shield --pilot',
    'node .claude/hooks/gate-wrapper.cjs  --event freeze-check --strict',
    'node ".claude/hooks/gate-wrapper.cjs" --event freeze-check --strict',
    "node '.claude/hooks/gate-wrapper.cjs' --event transport-shield --strict",
  ];

  it('accepts every shape the installer writes, including extra whitespace and a quoted path', () => {
    for (const cmd of installed) {
      expect(isInstalledGateCommand(cmd), cmd).toBe(true);
      expect(
        commandInstallsGate(cmd, 'freeze-check') || commandInstallsGate(cmd, 'transport-shield'),
        cmd,
      ).toBe(true);
    }
  });

  it('rejects a user hook that only mentions the wrapper basename, and unrelated commands', () => {
    for (const cmd of [
      'node my-hook.cjs --wraps .claude/hooks/gate-wrapper.cjs',
      'echo gate-wrapper.cjs',
      'node .claude/hooks/PreWriteShield.cjs',
      'my-hook',
      '',
    ]) {
      expect(isInstalledGateCommand(cmd), cmd).toBe(false);
    }
  });
});

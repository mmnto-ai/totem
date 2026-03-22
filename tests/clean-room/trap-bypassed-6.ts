// Adversarial corpus: trap-bypassed for process.kill PID
// This code SHOULD NOT trigger a violation.
// Uses child.connected to check liveness without signal 0.

import { ChildProcess } from 'child_process';

function isProcessAlive(child: ChildProcess): boolean {
  return child.connected;
}

export { isProcessAlive };

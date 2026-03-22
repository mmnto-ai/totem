// Adversarial corpus: trap-caught for process.kill PID
// This code SHOULD trigger a violation.
// Rule: process.kill($PID, 0)
// Bug: signal 0 throws ESRCH if the process has exited, causing an
// unhandled exception. Must wrap in try/catch or use child.connected.

function isProcessAlive(childPid: number): boolean {
  process.kill(childPid, 0);
  return true;
}

export { isProcessAlive };

// Adversarial corpus: trap-caught for spawn shell:true
// This code SHOULD trigger a violation.
// Rule: spawn($CMD, [$$$ARGS], { ..., shell: true, ... })
// Bug: shell:true enables shell injection when arguments contain
// user-controlled strings. Prefer direct exec without shell.

import { spawn } from 'child_process';

function runGitStatus(): void {
  const child = spawn('git', ['status'], { shell: true });
  child.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });
}

export { runGitStatus };

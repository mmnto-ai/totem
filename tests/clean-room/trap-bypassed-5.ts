// Adversarial corpus: trap-bypassed for spawn shell:true
// This code SHOULD NOT trigger a violation.
// Omits shell:true, using direct process execution (no shell injection risk).

import { spawn } from 'child_process';

function runGitStatus(): void {
  const child = spawn('git', ['status']);
  child.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });
}

export { runGitStatus };

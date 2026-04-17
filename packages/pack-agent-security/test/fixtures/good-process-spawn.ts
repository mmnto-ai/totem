// Fixture: the #1486 rule MUST NOT fire on any line below.
// These are benign operations that do not spawn child processes.
/* eslint-disable @typescript-eslint/no-unused-vars */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Plain function names that happen to overlap must not trip the rule by
// their mere presence; the rule fires on call sites only.
const spawnedCount = 5;
const forkInTheRoad = { left: 'a', right: 'b' };

function buildTaskArgs(cmd: string, args: string[]): { cmd: string; args: string[] } {
  return { cmd, args };
}

// File I/O, path operations — none of these are process-spawning calls.
const content = fs.readFileSync(path.join(__dirname, 'bad-process-spawn.ts'), 'utf-8');
const lines = content.split('\n');
const nonEmpty = lines.filter((line) => line.length > 0);

// Method calls where the method name overlaps with a child_process primitive
// but the callee is a property access (member_expression) do not match the
// rule's bare-identifier patterns.
class ParticleSystem {
  spawn(count: number): number[] {
    return Array.from({ length: count }, (_, i) => i);
  }
}

const sys = new ParticleSystem();
const particles = sys.spawn(10);

export { buildTaskArgs, forkInTheRoad, nonEmpty, particles, spawnedCount };

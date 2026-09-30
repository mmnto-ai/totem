import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLAUDE_GATE_WRAPPER } from './init-templates.js';

// ─── mmnto-ai/totem#2932: every synchronous spawn in the managed gate wrapper is bounded by SIGKILL ───

/** Each `spawnSync(` call's option object, as the text up to its closing `});`. */
function spawnBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('spawnSync(', from);
    if (start === -1) break;
    const end = source.indexOf('});', start);
    if (end === -1) throw new Error('spawnSync call without a closing });');
    blocks.push(source.slice(start, end + 3));
    from = end + 3;
  }
  return blocks;
}

describe('gate-wrapper template: spawn deadlines are enforced with SIGKILL', () => {
  it('names killSignal SIGKILL beside the timeout on every spawnSync', () => {
    const blocks = spawnBlocks(CLAUDE_GATE_WRAPPER);
    // The git read and the node checker — the two spawns the wrapper makes.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of blocks) {
      expect(block).toContain('timeout:');
      expect(block).toContain("killSignal: 'SIGKILL'");
    }
  });

  // The committed rendering on this repository is the template, byte for byte
  // (the parity mmnto-ai/totem#2833 asks to lock; pinned here for the wrapper).
  it('the committed .claude/hooks/gate-wrapper.cjs equals the template', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const committed = path.resolve(here, '../../../../.claude/hooks/gate-wrapper.cjs');
    expect(fs.readFileSync(committed, 'utf-8')).toBe(CLAUDE_GATE_WRAPPER);
  });
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLAUDE_PREWRITESHIELD } from './init-templates.js';

// ─── mmnto-ai/totem#3103: the committed write shield is the template, byte for byte ───
//
// The same lock the gate wrapper carries (gate-wrapper-killsignal.test.ts): a
// template edit that forgets the tracked rendering, or a hand edit to the
// rendering that never reaches the template, fails here instead of shipping
// two guards that disagree.

describe('PreWriteShield template: the committed rendering equals the template', () => {
  it('the committed .claude/hooks/PreWriteShield.cjs equals CLAUDE_PREWRITESHIELD', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const committed = path.resolve(here, '../../../../.claude/hooks/PreWriteShield.cjs');
    expect(fs.readFileSync(committed, 'utf-8')).toBe(CLAUDE_PREWRITESHIELD);
  });
});

/**
 * The Agent Arming doctor row (mmnto-ai/totem#3130): a sensor over the one key
 * whose absence changes what a seat's push runs, said where the hook itself
 * cannot say it (the strict arm that no longer runs is the one that would have).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { AGENT_ARMING_CHECK_NAME, checkAgentArming } from './doctor-agent-arming.js';

describe('checkAgentArming (mmnto-ai/totem#3130)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctor-arming-'));
    // A `.totem/` marker so the repo-root walk lands here, not on a parent.
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function registerSeat(seat: string): void {
    fs.mkdirSync(path.join(tmpDir, '.totem', 'orchestration', seat, 'outbox'), {
      recursive: true,
    });
  }

  it('a declared key passes, whatever its value, and names it', async () => {
    registerSeat('repo-claude');
    const strict = await checkAgentArming(tmpDir, { hooks: { agentArming: 'strict' } });
    expect(strict.name).toBe(AGENT_ARMING_CHECK_NAME);
    expect(strict.status).toBe('pass');
    expect(strict.message).toContain('hooks.agentArming: strict');
    expect(strict.message).toContain('TOTEM_SELF_AGENT');
    expect(strict.gateExempt).toBe(true);

    // A declared 'off' is a decision, not an omission — pass, even with seats.
    const off = await checkAgentArming(tmpDir, { hooks: { agentArming: 'off' } });
    expect(off.status).toBe('pass');
    expect(off.message).toContain('hooks.agentArming: off');
    expect(off.gateExempt).toBe(true);
  });

  it('unset with no seats registered passes and says the default', async () => {
    const result = await checkAgentArming(tmpDir, {});
    expect(result.status).toBe('pass');
    expect(result.message).toContain('hooks.agentArming unset');
    expect(result.message).toContain('no seats registered');
    expect(result.gateExempt).toBe(true);
  });

  it('unset with seats registered WARNS, names the seats, what they skip, and the key', async () => {
    registerSeat('repo-claude');
    registerSeat('repo-gemini');
    const result = await checkAgentArming(tmpDir, undefined);
    expect(result.status).toBe('warn');
    expect(result.message).toContain('2 seat(s)');
    expect(result.message).toContain('repo-claude, repo-gemini');
    expect(result.message).toContain('spec-evidence gate');
    expect(result.message).toContain('doctor --strict');
    expect(result.remediation).toContain('hooks.agentArming');
    expect(result.remediation).toContain('totem hook install --force');
    expect(result.gateExempt).toBe(true);
  });

  it('never fails: no arm returns a fail status', async () => {
    registerSeat('repo-claude');
    for (const config of [
      undefined,
      {},
      { hooks: {} },
      { hooks: { agentArming: 'off' as const } },
    ]) {
      expect((await checkAgentArming(tmpDir, config)).status).not.toBe('fail');
    }
  });

  it('a run from a subdirectory still finds the seats (the walk-start contract)', async () => {
    registerSeat('repo-claude');
    const sub = path.join(tmpDir, 'packages', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const result = await checkAgentArming(sub, {});
    expect(result.status).toBe('warn');
    expect(result.message).toContain('repo-claude');
  });

  it('routing surfaces and dotted entries under orchestration are not seats', async () => {
    fs.mkdirSync(path.join(tmpDir, '.totem', 'orchestration', '_broadcast'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.totem', 'orchestration', '.cache'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.totem', 'orchestration', 'config.json'), '{}');
    const result = await checkAgentArming(tmpDir, {});
    expect(result.status).toBe('pass');
    expect(result.message).toContain('no seats registered');
  });

  it('a wide cohort is named up to eight seats, then counted', async () => {
    for (let i = 0; i < 11; i += 1) registerSeat(`seat-${String(i).padStart(2, '0')}`);
    const result = await checkAgentArming(tmpDir, {});
    expect(result.status).toBe('warn');
    expect(result.message).toContain('11 seat(s)');
    expect(result.message).toContain('seat-07');
    expect(result.message).not.toContain('seat-08');
    expect(result.message).toContain('and 3 more');
  });
});

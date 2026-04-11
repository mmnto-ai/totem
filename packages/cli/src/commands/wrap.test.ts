import { describe, expect, it } from 'vitest';

import { TotemError } from '@mmnto/totem';

import { wrapCommand } from './wrap.js';

// ─── Retirement tests (mmnto-ai/totem#1361) ──────────────
//
// `totem wrap` is retired pending a fix for the destructive
// `totem docs` overwrite of hand-crafted committed documentation.
// The function body is intentionally a hard error so the command
// cannot be invoked out of habit. These tests lock the retirement
// contract so future refactors cannot silently re-enable the
// command without also removing the retirement shim.
//
// When wrap is un-retired, delete these tests and restore the
// original orchestration assertions from git history.

describe('wrapCommand (retired)', () => {
  it('throws a TotemError regardless of arguments', async () => {
    await expect(wrapCommand([], {})).rejects.toBeInstanceOf(TotemError);
    await expect(wrapCommand(['142'], {})).rejects.toBeInstanceOf(TotemError);
    await expect(
      wrapCommand(['100', '101'], { model: 'gemini-3-flash', fresh: true, yes: true }),
    ).rejects.toBeInstanceOf(TotemError);
  });

  it('names the retirement reason in the error message', async () => {
    try {
      await wrapCommand(['142'], {});
      expect.unreachable('wrapCommand should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemError);
      expect((err as Error).message).toContain('retired');
      expect((err as Error).message).toContain('totem docs');
    }
  });

  it('points at the tracking ticket in the recovery hint', async () => {
    try {
      await wrapCommand(['142'], {});
      expect.unreachable('wrapCommand should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemError);
      const hint = (err as TotemError).recoveryHint;
      expect(hint).toContain('mmnto-ai/totem#1361');
    }
  });

  it('lists the manual workaround sequence in the recovery hint', async () => {
    try {
      await wrapCommand(['142'], {});
      expect.unreachable('wrapCommand should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemError);
      const hint = (err as TotemError).recoveryHint;
      expect(hint).toContain('totem extract');
      expect(hint).toContain('totem sync');
      expect(hint).toContain('totem compile --export');
      expect(hint).toContain('git checkout HEAD -- .totem/compiled-rules.json');
    }
  });
});

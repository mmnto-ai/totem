import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lint.js', () => ({
  lintCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./shield.js', () => ({
  shieldCommand: vi.fn().mockResolvedValue(undefined),
}));

import { checkCommand } from './check.js';
import { lintCommand } from './lint.js';
import { shieldCommand } from './shield.js';

describe('checkCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs lint and shield sequentially', async () => {
    const callOrder: string[] = [];
    vi.mocked(lintCommand).mockImplementation(async () => {
      callOrder.push('lint');
    });
    vi.mocked(shieldCommand).mockImplementation(async () => {
      callOrder.push('review');
    });

    await checkCommand({});

    expect(callOrder).toEqual(['lint', 'review']);
  });

  it('reports failure when lint fails', async () => {
    vi.mocked(lintCommand).mockRejectedValueOnce(new Error('lint error'));

    await expect(checkCommand({})).rejects.toThrow(/Check failed.*lint/);
  });

  it('reports failure when review fails', async () => {
    vi.mocked(shieldCommand).mockRejectedValueOnce(new Error('review error'));

    await expect(checkCommand({})).rejects.toThrow(/Check failed.*review/);
  });

  it('continues review even when lint fails', async () => {
    vi.mocked(lintCommand).mockRejectedValueOnce(new Error('lint error'));

    try {
      await checkCommand({});
    } catch {
      // expected
    }

    expect(shieldCommand).toHaveBeenCalled();
  });

  it('reports both failures', async () => {
    vi.mocked(lintCommand).mockRejectedValueOnce(new Error('lint error'));
    // totem-context: test mock — Error is intentional for failure simulation
    vi.mocked(shieldCommand).mockRejectedValueOnce(new Error('review error'));

    await expect(checkCommand({})).rejects.toThrow(/lint \+ review/);
  });

  it('passes options through to subcommands', async () => {
    await checkCommand({ model: 'gemini-3-flash', fresh: true, staged: true });

    expect(lintCommand).toHaveBeenCalledWith({ staged: true });
    expect(shieldCommand).toHaveBeenCalledWith({
      model: 'gemini-3-flash',
      fresh: true,
      staged: true,
    });
  });
});

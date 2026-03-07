import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./learn.js', () => ({
  learnCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./sync.js', () => ({
  syncCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./triage.js', () => ({
  triageCommand: vi.fn().mockResolvedValue(undefined),
}));

import { learnCommand } from './learn.js';
import { syncCommand } from './sync.js';
import { triageCommand } from './triage.js';
import { wrapCommand } from './wrap.js';

describe('wrapCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls learn, sync, and triage in sequence', async () => {
    const callOrder: string[] = [];
    vi.mocked(learnCommand).mockImplementation(async () => {
      callOrder.push('learn');
    });
    vi.mocked(syncCommand).mockImplementation(async () => {
      callOrder.push('sync');
    });
    vi.mocked(triageCommand).mockImplementation(async () => {
      callOrder.push('triage');
    });

    await wrapCommand(['142'], {});

    expect(callOrder).toEqual(['learn', 'sync', 'triage']);
    expect(learnCommand).toHaveBeenCalledWith(['142'], {
      model: undefined,
      fresh: undefined,
      yes: undefined,
    });
    expect(syncCommand).toHaveBeenCalledWith({ full: false });
    expect(triageCommand).toHaveBeenCalledWith({
      model: undefined,
      fresh: undefined,
    });
  });

  it('passes model and fresh options through', async () => {
    await wrapCommand(['100', '101'], { model: 'gemini-3-flash', fresh: true, yes: true });

    expect(learnCommand).toHaveBeenCalledWith(['100', '101'], {
      model: 'gemini-3-flash',
      fresh: true,
      yes: true,
    });
    expect(triageCommand).toHaveBeenCalledWith({
      model: 'gemini-3-flash',
      fresh: true,
    });
  });

  it('aborts chain if learn throws', async () => {
    vi.mocked(learnCommand).mockRejectedValueOnce(new Error('User aborted'));

    await expect(wrapCommand(['142'], {})).rejects.toThrow('User aborted');
    expect(syncCommand).not.toHaveBeenCalled();
    expect(triageCommand).not.toHaveBeenCalled();
  });
});

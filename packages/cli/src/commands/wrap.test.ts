import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./extract.js', () => ({
  extractCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./sync.js', () => ({
  syncCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./triage.js', () => ({
  triageCommand: vi.fn().mockResolvedValue(undefined),
}));

import { extractCommand } from './extract.js';
import { syncCommand } from './sync.js';
import { triageCommand } from './triage.js';
import { wrapCommand } from './wrap.js';

describe('wrapCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls extract, sync, and triage in sequence', async () => {
    const callOrder: string[] = [];
    vi.mocked(extractCommand).mockImplementation(async () => {
      callOrder.push('extract');
    });
    vi.mocked(syncCommand).mockImplementation(async () => {
      callOrder.push('sync');
    });
    vi.mocked(triageCommand).mockImplementation(async () => {
      callOrder.push('triage');
    });

    await wrapCommand(['142'], {});

    expect(callOrder).toEqual(['extract', 'sync', 'triage']);
    expect(extractCommand).toHaveBeenCalledWith(['142'], {
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

    expect(extractCommand).toHaveBeenCalledWith(['100', '101'], {
      model: 'gemini-3-flash',
      fresh: true,
      yes: true,
    });
    expect(triageCommand).toHaveBeenCalledWith({
      model: 'gemini-3-flash',
      fresh: true,
    });
  });

  it('aborts chain if extract throws', async () => {
    vi.mocked(extractCommand).mockRejectedValueOnce(new Error('User aborted'));

    await expect(wrapCommand(['142'], {})).rejects.toThrow('User aborted');
    expect(syncCommand).not.toHaveBeenCalled();
    expect(triageCommand).not.toHaveBeenCalled();
  });
});

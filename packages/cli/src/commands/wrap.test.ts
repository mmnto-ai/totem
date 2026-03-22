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
vi.mock('./docs.js', () => ({
  docsCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./compile.js', () => ({
  compileCommand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { compileCommand } from './compile.js';
import { docsCommand } from './docs.js';
import { extractCommand } from './extract.js';
import { syncCommand } from './sync.js';
import { triageCommand } from './triage.js';
import { wrapCommand } from './wrap.js';

describe('wrapCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls extract, sync, triage, docs, and compile in sequence', async () => {
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
    vi.mocked(docsCommand).mockImplementation(async () => {
      callOrder.push('docs');
    });
    vi.mocked(compileCommand).mockImplementation(async () => {
      callOrder.push('compile');
    });

    await wrapCommand(['142'], {});

    expect(callOrder).toEqual(['extract', 'sync', 'triage', 'docs', 'compile']);
    // docs:inject (execSync) should also have been called
    const { execSync } = await import('node:child_process');
    expect(execSync).toHaveBeenCalledWith('pnpm run docs:inject', expect.any(Object));
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
    expect(docsCommand).toHaveBeenCalledWith([], {
      model: undefined,
      fresh: undefined,
      yes: undefined,
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
    expect(docsCommand).toHaveBeenCalledWith([], {
      model: 'gemini-3-flash',
      fresh: true,
      yes: true,
    });
    expect(compileCommand).toHaveBeenCalledWith({
      model: 'gemini-3-flash',
      fresh: true,
      export: true,
    });
  });

  it('gracefully skips docs step when no docs configured', async () => {
    const err = new Error('[Totem Error] No docs configured.');
    err.name = 'NoDocsConfiguredError';
    vi.mocked(docsCommand).mockRejectedValueOnce(err);

    await wrapCommand(['142'], {});

    expect(extractCommand).toHaveBeenCalled();
    expect(syncCommand).toHaveBeenCalled();
    expect(triageCommand).toHaveBeenCalled();
    expect(docsCommand).toHaveBeenCalled();
    expect(compileCommand).toHaveBeenCalled();
  });

  it('aborts chain if extract throws', async () => {
    vi.mocked(extractCommand).mockRejectedValueOnce(new Error('User aborted'));

    await expect(wrapCommand(['142'], {})).rejects.toThrow('User aborted');
    expect(syncCommand).not.toHaveBeenCalled();
    expect(triageCommand).not.toHaveBeenCalled();
    expect(docsCommand).not.toHaveBeenCalled();
  });
});

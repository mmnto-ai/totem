import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchFix } from '../fix-dispatcher.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@mmnto/totem', () => ({
  safeExec: vi.fn().mockReturnValue('abc1234'),
}));

let fsMock: typeof import('node:fs');
let totemMock: typeof import('@mmnto/totem');

describe('dispatchFix', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    fsMock = await import('node:fs');
    totemMock = await import('@mmnto/totem');
  });

  it('returns error when file does not exist', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const result = await dispatchFix({
      filePath: 'nonexistent.ts',
      findingBody: 'fix this',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn(),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('Cannot read');
  });

  it('returns error when LLM returns no response', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;');

    const result = await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'fix this',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('No response from LLM');
  });

  it('returns error when LLM returns no code block', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;');

    const result = await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'fix this',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue('No code block here'),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('code block');
  });

  it('returns error when LLM returns unchanged content', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;\n');

    const result = await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'fix this',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue('```typescript\nconst x = 1;\n```'),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('unchanged');
  });

  it('returns error when LLM call throws', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;');

    const result = await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'fix this',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockRejectedValue(new Error('timeout')),
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('LLM call failed');
  });

  it('applies fix and returns commit SHA', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;\n');
    (totemMock.safeExec as ReturnType<typeof vi.fn>).mockReturnValue('abc1234');

    const result = await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'Use const instead of let',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue('```typescript\nconst x = 2;\n```'),
    });
    expect(result.applied).toBe(true);
    expect(result.commitSha).toBe('abc1234');
  });

  it('includes finding tool and file in commit message', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;\n');
    const mockSafeExec = totemMock.safeExec as ReturnType<typeof vi.fn>;
    mockSafeExec.mockReturnValue('def5678');

    await dispatchFix({
      filePath: 'src/bar.ts',
      line: 42,
      findingBody: 'Missing null check',
      findingTool: 'GCA',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue('```typescript\nconst x = 2;\n```'),
    });

    // The second call to safeExec should be `git commit`
    const commitCall = mockSafeExec.mock.calls.find(
      (call: unknown[]) => call[0] === 'git' && (call[1] as string[])[0] === 'commit',
    );
    expect(commitCall).toBeDefined();
    const commitMsg = (commitCall![1] as string[])[2]!;
    expect(commitMsg).toContain('GCA');
    expect(commitMsg).toContain('src/bar.ts');
    expect(commitMsg).toContain(':42');
  });

  it('calls onLog callback during execution', async () => {
    (fsMock.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('const x = 1;\n');
    (totemMock.safeExec as ReturnType<typeof vi.fn>).mockReturnValue('abc1234');
    const onLog = vi.fn();

    await dispatchFix({
      filePath: 'src/foo.ts',
      findingBody: 'Fix something',
      findingTool: 'CR',
      cwd: '/tmp/fake',
      runOrchestrator: vi.fn().mockResolvedValue('```typescript\nconst x = 2;\n```'),
      onLog,
    });

    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Generating fix'));
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('Committed fix'));
  });
});

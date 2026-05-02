import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TotemConfig } from '@mmnto/totem';

const isEngineSealedMock = vi.fn<() => boolean>();
const loadInstalledPacksMock = vi.fn<(typeof import('@mmnto/totem'))['loadInstalledPacks']>();

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    isEngineSealed: () => isEngineSealedMock(),
    loadInstalledPacks: ((options?: Parameters<typeof loadInstalledPacksMock>[0]) =>
      loadInstalledPacksMock(options)) as typeof actual.loadInstalledPacks,
  };
});

afterEach(() => {
  isEngineSealedMock.mockReset();
  loadInstalledPacksMock.mockReset();
});

function makeConfig(overrides: Partial<TotemConfig> = {}): TotemConfig {
  return {
    targets: [],
    totemDir: '.totem',
    ignorePatterns: [],
    ...overrides,
  } as TotemConfig;
}

describe('bootstrapEngine', () => {
  it('invokes loadInstalledPacks with projectRoot and config.totemDir when engine is unsealed', async () => {
    isEngineSealedMock.mockReturnValue(false);
    const { bootstrapEngine } = await import('./bootstrap-engine.js');

    bootstrapEngine(makeConfig(), '/abs/repo-root');

    expect(loadInstalledPacksMock).toHaveBeenCalledTimes(1);
    expect(loadInstalledPacksMock).toHaveBeenCalledWith({
      projectRoot: '/abs/repo-root',
      totemDir: '.totem',
    });
  });

  it('short-circuits silently when engine is already sealed (test-harness re-entry)', async () => {
    isEngineSealedMock.mockReturnValue(true);
    const { bootstrapEngine } = await import('./bootstrap-engine.js');

    bootstrapEngine(makeConfig(), '/abs/repo-root');

    expect(loadInstalledPacksMock).not.toHaveBeenCalled();
  });

  it('propagates pack-callback errors verbatim — does not catch or rewrap', async () => {
    isEngineSealedMock.mockReturnValue(false);
    const cause = new Error("Pack 'broken' registration callback threw.");
    loadInstalledPacksMock.mockImplementation(() => {
      throw cause;
    });
    const { bootstrapEngine } = await import('./bootstrap-engine.js');

    expect(() => bootstrapEngine(makeConfig(), '/abs/repo-root')).toThrowError(cause);
  });

  it('passes a non-default totemDir through unchanged (monorepo subpackage case)', async () => {
    isEngineSealedMock.mockReturnValue(false);
    const { bootstrapEngine } = await import('./bootstrap-engine.js');

    bootstrapEngine(makeConfig({ totemDir: '.custom-totem' }), '/abs/repo-root/sub');

    expect(loadInstalledPacksMock).toHaveBeenCalledWith({
      projectRoot: '/abs/repo-root/sub',
      totemDir: '.custom-totem',
    });
  });
});

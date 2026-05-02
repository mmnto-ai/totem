/**
 * Regression-protection for the engine-bootstrap wiring (mmnto-ai/totem#1794).
 *
 * `lint.test.ts` covers the lint wiring. This file mirrors that assertion
 * for the other three command surfaces added in this PR — `shield`,
 * `compile`, and `test-rules` — so a future edit that drops the
 * `bootstrapEngine(config, configRoot)` call from any one of them fails
 * loud instead of silently regressing pack consumption end-to-end.
 *
 * Each test invokes the command and tolerates a downstream failure
 * (no diff, no lessons, no rules file) — the spy captures the
 * bootstrap call before the command can fail, which is the only
 * assertion we need.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

const bootstrapEngineMock = vi.fn();

vi.mock('../utils/bootstrap-engine.js', () => ({
  bootstrapEngine: (config: unknown, projectRoot: unknown) =>
    bootstrapEngineMock(config, projectRoot),
}));

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
    loadEnv: () => {},
  };
});

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-bootstrap-wiring-'));
}

function expectBootstrapCalledOnceWithConfigAndRoot(): void {
  expect(bootstrapEngineMock).toHaveBeenCalledTimes(1);
  const [calledConfig, calledRoot] = bootstrapEngineMock.mock.calls[0];
  expect(calledConfig).toMatchObject({ totemDir: '.totem' });
  expect(typeof calledRoot).toBe('string');
  expect((calledRoot as string).length).toBeGreaterThan(0);
}

describe('engine bootstrap wiring (mmnto-ai/totem#1794) — non-lint command surfaces', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    bootstrapEngineMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('shield (--estimate path) invokes bootstrapEngine with config + configRoot', async () => {
    const { shieldCommand } = await import('./shield.js');
    // Estimate branch routes through runEstimate; will fail downstream
    // (no git, no rules, etc.) but bootstrap fires first.
    await shieldCommand({ estimate: true } as never).catch(() => {});
    expectBootstrapCalledOnceWithConfigAndRoot();
  });

  it('compile invokes bootstrapEngine with config + configRoot', async () => {
    const { compileCommand } = await import('./compile.js');
    await compileCommand({} as never).catch(() => {});
    expectBootstrapCalledOnceWithConfigAndRoot();
  });

  it('test-rules invokes bootstrapEngine with config + configRoot', async () => {
    const { testRulesCommand } = await import('./test-rules.js');
    await testRulesCommand({}).catch(() => {});
    expectBootstrapCalledOnceWithConfigAndRoot();
  });
});

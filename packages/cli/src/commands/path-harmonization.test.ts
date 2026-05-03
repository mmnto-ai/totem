/**
 * Regression-protection for the cwd → configRoot path-harmonization fix
 * (mmnto-ai/totem#1796).
 *
 * Both `compileCommand` and `testRulesCommand` previously joined
 * `config.totemDir` against `process.cwd()`. In monorepo subpackage
 * invocations where `cwd != configRoot`, that resolved `.totem/` to
 * the wrong directory — pack/manifest state was read from the
 * configRoot (per PR #1795's `bootstrapEngine` wiring), but lessons,
 * compiled rules, and test fixtures were read from the subpackage's
 * cwd. These tests prove the fix by asserting the downstream
 * consumers (`@mmnto/totem` exports `readAllLessons` and
 * `runRuleTests`) are called with `configRoot`-relative paths even
 * when `cwd` points at a nested subpackage directory.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

const readAllLessonsMock = vi.fn();
const runRuleTestsMock = vi.fn();

vi.mock('../utils/bootstrap-engine.js', () => ({
  bootstrapEngine: vi.fn(),
}));

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    // Always resolve config to the configRoot (tmpDir), regardless of
    // what cwd we chdir into. This is the heart of the test — it
    // simulates a monorepo subpackage where the config lives at the
    // repo root but lint/compile is invoked from a nested package.
    resolveConfigPath: (_cwd: string) => path.join(currentTmpDir, 'totem.config.ts'),
    isGlobalConfigPath: () => false,
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
    loadEnv: () => {},
  };
});

vi.mock('@mmnto/totem', async () => {
  const actual = await vi.importActual<typeof import('@mmnto/totem')>('@mmnto/totem');
  return {
    ...actual,
    readAllLessons: (totemDir: string) => {
      readAllLessonsMock(totemDir);
      // Throw to short-circuit the rest of compileCommand — we only
      // need the path arg captured before the command's downstream
      // work fails.
      throw new Error('test-shortcircuit-after-readAllLessons');
    },
    runRuleTests: (rulesPath: string, testsDir: string) => {
      runRuleTestsMock(rulesPath, testsDir);
      return { total: 0, skipped: 0, results: [], skippedFixtures: [] };
    },
  };
});

let currentTmpDir = '';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-1796-harmonize-'));
}

/**
 * Tolerate the downstream throw that the `readAllLessons` mock raises —
 * the spy captures the path arg first, which is the only assertion
 * this test cares about. Asserting the rejection is an `Error`
 * keeps the catch non-empty per the project's "no empty catches" rule.
 */
function tolerateDownstreamThrow(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {
      // Command resolved cleanly — the downstream-spy assertion still
      // runs, but a future change that makes the command resolve
      // without invoking the spied consumer would still fail the
      // toHaveBeenCalled assertion below.
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(Error);
    },
  );
}

describe('cwd → configRoot path harmonization (mmnto-ai/totem#1796)', () => {
  let tmpDir: string;
  let subPackageDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    currentTmpDir = tmpDir;
    subPackageDir = path.join(tmpDir, 'packages', 'sub');
    fs.mkdirSync(subPackageDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {};', 'utf-8');
    originalCwd = process.cwd();
    // chdir into the subpackage so cwd != configRoot. This is the
    // execution shape that exposed the bug — running totem from a
    // monorepo subpackage where the config lives one level up.
    process.chdir(subPackageDir);
    readAllLessonsMock.mockClear();
    runRuleTestsMock.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
  });

  it('compile resolves `.totem/` against configRoot, not cwd', async () => {
    const { compileCommand } = await import('./compile.js');
    await tolerateDownstreamThrow(compileCommand({} as never));

    expect(readAllLessonsMock).toHaveBeenCalledTimes(1);
    const calledPath = readAllLessonsMock.mock.calls[0][0] as string;
    // macOS resolves `os.tmpdir()` `/tmp/...` → `/private/tmp/...` after
    // chdir; Windows may return 8.3 short names. Canonicalize the
    // tmpDir parent (which exists) and assert the called path is
    // `<tmpDir>/.totem` — NOT `<subPackageDir>/.totem`. Same cross-OS
    // realpath pattern as bootstrap-wiring.test.ts, but realpath only
    // the parent because `.totem/` itself is never created here.
    const tmpDirCanonical = fs.realpathSync.native(tmpDir);
    const calledParent = fs.realpathSync.native(path.dirname(calledPath));
    expect(calledParent).toBe(tmpDirCanonical);
    expect(path.basename(calledPath)).toBe('.totem');
  });

  it('test-rules resolves `.totem/{compiled-rules.json,tests}` against configRoot, not cwd', async () => {
    const { testRulesCommand } = await import('./test-rules.js');
    await tolerateDownstreamThrow(testRulesCommand({}));

    expect(runRuleTestsMock).toHaveBeenCalledTimes(1);
    const [calledRulesPath, calledTestsDir] = runRuleTestsMock.mock.calls[0] as [string, string];
    const tmpDirCanonical = fs.realpathSync.native(tmpDir);
    // calledRulesPath = <configRoot>/.totem/compiled-rules.json — the
    // grandparent of the file is configRoot. dirname(.totem) is the
    // parent of `.totem`, which is the configRoot. realpath only the
    // grandparent (which exists as tmpDir) for cross-OS comparison.
    expect(path.basename(calledRulesPath)).toBe('compiled-rules.json');
    expect(path.basename(path.dirname(calledRulesPath))).toBe('.totem');
    expect(fs.realpathSync.native(path.dirname(path.dirname(calledRulesPath)))).toBe(
      tmpDirCanonical,
    );
    expect(path.basename(calledTestsDir)).toBe('tests');
    expect(path.basename(path.dirname(calledTestsDir))).toBe('.totem');
    expect(fs.realpathSync.native(path.dirname(path.dirname(calledTestsDir)))).toBe(
      tmpDirCanonical,
    );
  });
});

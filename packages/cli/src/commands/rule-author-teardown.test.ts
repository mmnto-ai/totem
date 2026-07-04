import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { ruleAuthorCommand } from './rule-author.js';

// ── The §5.4 finally-teardown branches (CR #2295): the sandbox path is
// unconditional under a binding, so both teardown-failure branches are on the
// certifying hot path. The proof + sandbox + intake modules are mocked — the
// branches under test are the command's own control flow, not the seams'.
vi.mock('../utils.js', () => ({
  resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.json'),
  loadConfig: async () => ({ totemDir: '.totem' }),
}));
vi.mock('../spine-freeze-proof.js', () => ({
  resolveFrozenSplitByRef: vi.fn(() => ({
    artifact: {
      splitRef: `split:${'a'.repeat(64)}`,
      freezeCommitment: 'c'.repeat(64),
      cutBoundarySha: 'd'.repeat(40),
      split: { asOfCommit: 'e'.repeat(40), trainPrs: [], heldOutPrs: [] },
    },
  })),
  verifySharedFrozenSplit: vi.fn(),
}));
vi.mock('../author-sandbox.js', () => ({
  prepareAuthorSandbox: vi.fn(() => ({
    root: '/fake/sandbox-root',
    cutBoundarySha: 'd'.repeat(40),
  })),
  removeAuthorSandbox: vi.fn(),
}));
vi.mock('../authored-rule-intake.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../authored-rule-intake.js')>();
  return {
    ...real,
    runRuleAuthor: vi.fn(() => ({
      records: [],
      minted: 0,
      revised: 0,
      unchanged: 0,
      rejected: [],
    })),
  };
});
// resolveGitRoot spawns a real `git` with cwd = the temp root; its result only
// feeds the (mocked) proof seam here, and on Windows the spawn leaves the temp
// dir undeletable for the whole worker lifetime (EPERM in afterEach) — so pin
// it to the temp root instead of spawning.
vi.mock('@mmnto/totem', async (importOriginal) => {
  const real = await importOriginal<typeof import('@mmnto/totem')>();
  return { ...real, resolveGitRoot: vi.fn((cwd: string) => cwd) };
});

import { removeAuthorSandbox } from '../author-sandbox.js';
import { runRuleAuthor } from '../authored-rule-intake.js';

let root: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
const savedExitCode = process.exitCode;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ruleauthor-teardown-'));
  fs.mkdirSync(path.join(root, '.totem', 'spine'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.totem', 'spine', 'authored-rules.yaml'),
    yamlStringify({
      splitRef: `split:${'a'.repeat(64)}`,
      authoredAfterSplit: true,
      heldOutNonInspectionAttestation: true,
      rules: [],
    }),
    'utf-8',
  );
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
  vi.mocked(removeAuthorSandbox).mockReset();
  vi.mocked(runRuleAuthor).mockReset();
  vi.mocked(runRuleAuthor).mockReturnValue({
    records: [],
    minted: 0,
    revised: 0,
    unchanged: 0,
    rejected: [],
  });
});
afterEach(() => {
  cwdSpy.mockRestore();
  warnSpy.mockRestore();
  logSpy.mockRestore();
  process.exitCode = savedExitCode;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('ruleAuthorCommand §5.4 teardown-failure branches (the finally-shadow contract, GCA #2293 r4)', () => {
  it('throws the teardown error when teardown fails with NO primary error in flight', async () => {
    const teardownErr = new Error('sandbox rm failed');
    vi.mocked(removeAuthorSandbox).mockImplementation(() => {
      throw teardownErr;
    });
    // The intake succeeded and was reported, but the run still fails loudly —
    // a leaked sandbox root is never a silent success.
    await expect(ruleAuthorCommand({ lcDir: '/some/lc' })).rejects.toBe(teardownErr);
    expect(vi.mocked(runRuleAuthor)).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('surfaces the PRIMARY error and warns (never shadows) when teardown also fails', async () => {
    const primaryErr = new Error('intake exploded');
    vi.mocked(runRuleAuthor).mockImplementation(() => {
      throw primaryErr;
    });
    vi.mocked(removeAuthorSandbox).mockImplementation(() => {
      throw new Error('sandbox rm failed too');
    });
    await expect(ruleAuthorCommand({ lcDir: '/some/lc' })).rejects.toBe(primaryErr);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('sandbox teardown failed after a primary error'),
    );
    // The kept root is named in the warning — the operator can clean it up.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/fake/sandbox-root'));
  });

  it('tears down exactly once on the success path (no teardown error, clean return)', async () => {
    await ruleAuthorCommand({ lcDir: '/some/lc' });
    expect(vi.mocked(removeAuthorSandbox)).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

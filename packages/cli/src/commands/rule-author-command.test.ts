import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { ruleAuthorCommand } from './rule-author.js';

// The command resolves its `.totem` dir via `loadConfig(resolveConfigPath(cwd))`; mock that to a
// `.totem` under a temp root so the command is exercised end-to-end without the real config layer.
vi.mock('../utils.js', () => ({
  resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.json'),
  loadConfig: async () => ({ totemDir: '.totem' }),
}));

let root: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
const savedExitCode = process.exitCode;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ruleauthor-cmd-'));
  fs.mkdirSync(path.join(root, '.totem', 'spine'), { recursive: true });
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(root);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  process.exitCode = undefined;
});
afterEach(() => {
  cwdSpy.mockRestore();
  warnSpy.mockRestore();
  logSpy.mockRestore();
  process.exitCode = savedExitCode;
  fs.rmSync(root, { recursive: true, force: true });
});

const fixture = (pr: number) => ({
  pr,
  preimageSource: {
    kind: 'commit',
    preimageCommitSha: 'b'.repeat(40),
    mergeCommitSha: 'a'.repeat(40),
  },
  filePath: 'src/x.ts',
  matchedSpan: 'L1',
  contentHash: 'h'.repeat(8),
});
const writeYaml = (rules: unknown[], splitRef = 's') => {
  fs.writeFileSync(
    path.join(root, '.totem', 'spine', 'authored-rules.yaml'),
    yamlStringify({
      splitRef,
      authoredAfterSplit: true,
      heldOutNonInspectionAttestation: true,
      rules,
    }),
    'utf-8',
  );
};
const decidable = (over: Record<string, unknown> = {}) => ({
  author: 'alice',
  authoredAt: '2026-06-27',
  targetDefect: 'forbidden console.log',
  declaredEngine: 'regex',
  structuralClass: 'forbidden-literal-token',
  dslSource: 'console\\.log',
  positiveFixtures: [fixture(1)],
  ...over,
});

describe('ruleAuthorCommand (CLI entry — rejected-loud + non-zero exit, strategy seam-review (f))', () => {
  it('sets process.exitCode=1 and warns when a rule is non-decidable', async () => {
    writeYaml([decidable({ structuralClass: 'behavioral-smell' })]);
    await ruleAuthorCommand({});
    expect(process.exitCode).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
  });
  it('leaves process.exitCode untouched and does not warn on an all-decidable run', async () => {
    writeYaml([decidable()]);
    await ruleAuthorCommand({});
    expect(process.exitCode).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // §5.4 is NON-OPTIONAL under a content-addressed binding (#2294 couple): the
  // gate fires at binding-engagement, BEFORE the proof machinery loads, so no
  // artifact/git fixture is needed to exercise it.
  it('throws GATE_INVALID naming §5.4 when a content-addressed splitRef engages without --lc-dir', async () => {
    writeYaml([decidable()], `split:${'f'.repeat(64)}`);
    // Single invocation, all three facets on the one rejection (greptile #2295).
    await expect(ruleAuthorCommand({})).rejects.toMatchObject({
      name: 'TotemError',
      code: 'GATE_INVALID',
      message: expect.stringContaining('§5.4 author sandbox is NON-OPTIONAL'),
    });
  });

  it('treats a whitespace-only --lc-dir as missing under a content-addressed splitRef', async () => {
    writeYaml([decidable()], `split:${'f'.repeat(64)}`);
    await expect(ruleAuthorCommand({ lcDir: '   ' })).rejects.toMatchObject({
      code: 'GATE_INVALID',
    });
  });

  it('legacy free-text splitRef stays lcDir-free (binds nothing, no §5.4 gate)', async () => {
    writeYaml([decidable()]); // splitRef 's' — the pre-R1 adherence-class shape
    await ruleAuthorCommand({});
    // What distinguishes this from the all-decidable test above (greptile #2295):
    // the partition itself — the run completed WITHOUT engaging the freeze binding.
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('freeze binding verified'));
    expect(process.exitCode).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

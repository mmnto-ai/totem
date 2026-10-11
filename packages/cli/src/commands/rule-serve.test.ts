import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateOutputHash } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { ruleServeCommand } from './rule-serve.js';

// ─── `totem rule serve --json` (B2 of mmnto-ai/totem#3036) ───────────────────
//
// The report is emitted as data under the shared JSON envelope; a refusal is
// emitted as an error envelope carrying its code, and still throws so the CLI
// boundary exits 1.

const RULES = {
  version: 1,
  rules: [
    {
      lessonHash: 'aaaaaaaaaaaaaaaa',
      lessonHeading: 'Legacy',
      pattern: 'dummy',
      message: 'Legacy',
      engine: 'regex',
      compiledAt: '2026-01-01T00:00:00Z',
    },
  ],
  nonCompilable: [],
};

function setup(root: string, input: unknown): string {
  fs.writeFileSync(
    path.join(root, 'totem.config.ts'),
    'export default { targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }], totemDir: ".totem" };\n',
    'utf-8',
  );
  const totemDir = path.join(root, '.totem');
  fs.mkdirSync(path.join(totemDir, 'lessons'), { recursive: true });
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify(RULES, null, 2) + '\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(totemDir, 'compile-manifest.json'),
    JSON.stringify({
      compiled_at: '2026-01-01T00:00:00.000Z',
      model: 'm',
      input_hash: 'i',
      // The writer refuses a serving file its manifest does not attest.
      output_hash: generateOutputHash(path.join(totemDir, 'compiled-rules.json')),
      rule_count: 1,
    }),
    'utf-8',
  );
  const inputPath = path.join(root, 'in.json');
  fs.writeFileSync(inputPath, JSON.stringify(input), 'utf-8');
  return inputPath;
}

const INPUT = {
  schema: 'serving-input/1',
  asOf: '2026-10-10T02:18:13.000Z',
  source: 'test',
  dispositions: { legacyRow: 'archive', stamp: 'none' },
  floor: [],
  archive: [{ lessonHash: 'aaaaaaaaaaaaaaaa', reason: 'no-intent', ref: 'r' }],
};

describe('ruleServeCommand --json (mmnto-ai/totem#3036 B2)', () => {
  let tmpDir: string;
  let originalCwd: string;
  let out: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-serve-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('USERPROFILE', tmpDir);
    vi.stubEnv('TOTEM_JSON_OUTPUT', '1');
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.unstubAllEnvs();
  });

  it('emits the dry-run report as data with a success status', async () => {
    const inputPath = setup(tmpDir, INPUT);
    await ruleServeCommand(inputPath, { dryRun: true });
    const json = JSON.parse(out.join('')) as {
      status: string;
      command: string;
      data: { dryRun: boolean; written: boolean; report: { totals: Record<string, number> } };
    };
    expect(json.status).toBe('success');
    expect(json.command).toBe('rule serve');
    expect(json.data.dryRun).toBe(true);
    expect(json.data.written).toBe(false);
    expect(json.data.report.totals.archive).toBe(1);
  });

  it('emits a refusal as an error envelope carrying the code, and still throws', async () => {
    const inputPath = setup(tmpDir, {
      ...INPUT,
      dispositions: { legacyRow: 'archive', stamp: 'advisory' },
    });
    await expect(ruleServeCommand(inputPath, { dryRun: true })).rejects.toMatchObject({
      code: 'SERVING_INPUT_INVALID',
    });
    const json = JSON.parse(out.join('')) as {
      status: string;
      // eslint-disable-next-line id-match -- 'error' is the JSON envelope's field name
      error: { code: string; fix: string };
    };
    expect(json.status).toBe('error');
    expect(json.error.code).toBe('SERVING_INPUT_INVALID');
    expect(json.error.fix).toContain('none');
  });
});

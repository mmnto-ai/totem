import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runHookTests } from './test-runner.js';

let workDir: string;
let testsDir: string;
let manifestPath: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-hook-test-runner-'));
  testsDir = path.join(workDir, 'tests');
  fs.mkdirSync(testsDir);
  manifestPath = path.join(workDir, 'compiled-hooks.json');
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

const xorHook = {
  id: 'gca-tag-xor-command',
  packId: '@mmnto/pack-bot-gemini-code-assist',
  trigger: { tool: 'bash', pattern: 'gh\\s+(pr|issue)\\s+comment' },
  check: {
    pattern: '(?=.*@gemini-code-assist)(?=.*\\/gemini review)',
    type: 'reject-if-match' as const,
  },
  message: 'GCA tag XOR command — never both; doubling wastes GCA quota.',
};

function writeManifest(hooks: unknown[] = [xorHook]): void {
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      compiledAt: '2026-05-11T18:43:00Z',
      sourcePackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
      hooks,
    }),
    'utf8',
  );
}

function writeFixture(filename: string, content: string): void {
  fs.writeFileSync(path.join(testsDir, filename), content, 'utf8');
}

describe('runHookTests', () => {
  it('returns empty results when no fixtures exist', () => {
    writeManifest();
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.total).toBe(0);
    expect(summary.results).toEqual([]);
    expect(summary.unknownHooks).toEqual([]);
  });

  it('skips fixtures whose surface defaults to rules (backwards-compat)', () => {
    writeManifest();
    writeFixture(
      'rule-fixture.md',
      `---
rule: some-rule-hash
file: src/app.ts
---

## Should fail

\`\`\`ts
unsafe_pattern
\`\`\`
`,
    );
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.total).toBe(0);
  });

  it('reports passed=true when every fail-section line rejects', () => {
    writeManifest();
    writeFixture(
      'xor-fail.md',
      `---
rule: gca-tag-xor-command
file: hook-fixtures/gca-fail.txt
surface: hooks
corpus: fail
---

## Should fail

\`\`\`text
gh pr comment 1 -b "@gemini-code-assist /gemini review please"
gh issue comment 2 -b "@gemini-code-assist /gemini review now"
\`\`\`
`,
    );
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.results[0]!.failures).toEqual([]);
  });

  it('reports failed when a fail-section line does not reject (missed reject)', () => {
    writeManifest();
    writeFixture(
      'xor-fail.md',
      `---
rule: gca-tag-xor-command
file: hook-fixtures/gca-fail.txt
surface: hooks
corpus: fail
---

## Should fail

\`\`\`text
gh pr comment 1 -b "@gemini-code-assist take a look"
\`\`\`
`,
    );
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.failed).toBe(1);
    expect(summary.results[0]!.failures.length).toBe(1);
    expect(summary.results[0]!.failures[0]).toMatchObject({
      expected: 'reject',
      actual: 'allow',
    });
  });

  it('reports failed when a pass-section line rejects (false positive)', () => {
    writeManifest();
    writeFixture(
      'xor-pass.md',
      `---
rule: gca-tag-xor-command
file: hook-fixtures/gca-pass.txt
surface: hooks
corpus: pass
---

## Should pass

\`\`\`text
gh pr comment 1 -b "@gemini-code-assist /gemini review please"
\`\`\`
`,
    );
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.failed).toBe(1);
    expect(summary.results[0]!.failures[0]).toMatchObject({
      expected: 'allow',
      actual: 'reject',
    });
  });

  it('flags fixtures referencing a hook id absent from the manifest under unknownHooks', () => {
    writeManifest();
    writeFixture(
      'orphan.md',
      `---
rule: does-not-exist
file: hook-fixtures/orphan.txt
surface: hooks
corpus: fail
---

## Should fail

\`\`\`text
git push --force origin main
\`\`\`
`,
    );
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: { '@mmnto/pack-bot-gemini-code-assist': '1.0.0' },
    });
    expect(summary.total).toBe(0);
    expect(summary.unknownHooks).toEqual([expect.objectContaining({ hookId: 'does-not-exist' })]);
  });

  it('surfaces loadWarnings and loadErrors from the manifest loader', () => {
    fs.writeFileSync(manifestPath, '{ not valid json', 'utf8');
    const summary = runHookTests({
      manifestPath,
      testsDir,
      installedPackVersions: {},
    });
    expect(summary.loadErrors.length).toBe(1);
    expect(summary.loadErrors[0]!.code).toBe('HOOKS_LOAD_FAILED');
  });
});

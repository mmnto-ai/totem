/**
 * Post-check rule + helper tests (mmnto-ai/totem#2103, strategy#474 slice 4).
 * Covers the agy edge-case matrix (containment/win32, citation extraction,
 * line-range boundaries), the codex contract folds (3 OutputContract rules,
 * spec VERIFY + verifyFallback), the OQ2 override boundary, and the F2
 * provenance sensor end-to-end through the engine.
 */

import { describe, expect, it } from 'vitest';

import { evaluatePostChecks, type PostCheckContext } from './post-checks.js';
import {
  citationResolvesRule,
  DEFAULT_RULES,
  extractCitations,
  isContained,
  lineRefValid,
  overrideReappearanceRule,
  specVerifyRule,
  structuredOutputRule,
} from './post-checks-rules.js';
import type { RunArtifact } from './schema.js';

interface ArtifactOpts {
  caller?: string;
  taskProfile?: string;
  content?: string;
  outputContract?: {
    schema?: Record<string, unknown>;
    citationsRequired?: boolean;
    verifyFallback?: boolean;
  };
  bundleItems?: Array<{ filePath: string; provenance?: string }>;
}

function artifact(o: ArtifactOpts = {}): RunArtifact {
  const { caller, taskProfile = 'Spec', content = '', outputContract, bundleItems } = o;
  const a: Record<string, unknown> = {
    backend: { taskProfile },
    output: { content },
    grounding: {},
  };
  if (caller !== undefined || outputContract !== undefined) {
    const admission: Record<string, unknown> = {};
    if (caller !== undefined) admission.runMetadata = { caller };
    if (outputContract !== undefined) admission.outputContract = outputContract;
    a.admission = admission;
  }
  if (bundleItems !== undefined) {
    (a.grounding as Record<string, unknown>).bundle = {
      items: bundleItems.map((b) => ({
        provenance: b.provenance ?? 'similarity-only',
        filePath: b.filePath,
      })),
    };
  }
  return a as unknown as RunArtifact;
}

/** A readFile stub: returns a 5-line file for any path whose normalized form ends with a known suffix. */
function readStub(existing: string[]): PostCheckContext['readFile'] {
  const norm = (p: string) => p.replace(/\\/g, '/');
  return (abs) => (existing.some((e) => norm(abs).endsWith(e)) ? 'a\nb\nc\nd\ne' : undefined);
}

const ctx = (existing: string[] = []): PostCheckContext => ({
  configRoot: '/repo',
  readFile: readStub(existing),
});

describe('isContained — win32-safe containment', () => {
  it('accepts a relative path nested in root', () => {
    expect(isContained('/repo', 'src/x.ts')).toBe(true);
  });
  it('rejects parent-traversal escape', () => {
    expect(isContained('/repo', '../../etc/passwd')).toBe(false);
  });
  it('rejects backslash-separator traversal on any platform', () => {
    // POSIX treats `\` as a literal char; normalization must still catch this escape.
    expect(isContained('/repo', 'src\\..\\..\\etc/passwd')).toBe(false);
  });
  it('rejects an absolute path', () => {
    expect(isContained('/repo', '/etc/passwd')).toBe(false);
  });
  it('rejects a drive-letter path', () => {
    expect(isContained('/repo', 'C:\\Windows\\System32')).toBe(false);
  });
});

describe('extractCitations', () => {
  it('parses path, path:line, and path:start-end', () => {
    const cites = extractCitations('see `src/a.ts`, `src/b.ts:12`, and `src/c.ts:3-9`');
    expect(cites).toEqual([
      { raw: 'src/a.ts', filePath: 'src/a.ts' },
      { raw: 'src/b.ts:12', filePath: 'src/b.ts', line: 12 },
      { raw: 'src/c.ts:3-9', filePath: 'src/c.ts', line: 3, endLine: 9 },
    ]);
  });
  it('strips fenced code blocks before extracting', () => {
    const content = 'real `src/real.ts`\n```ts\nimport `src/fake.ts`\n```\n';
    expect(extractCitations(content).map((c) => c.filePath)).toEqual(['src/real.ts']);
  });
  it('ignores backticked tokens with no separator or known extension', () => {
    expect(extractCitations('run `main` then `pnpm test`')).toEqual([]);
  });
  it('keeps a bare filename with a known extension', () => {
    expect(extractCitations('the `tsconfig.json` file').map((c) => c.filePath)).toEqual([
      'tsconfig.json',
    ]);
  });
});

describe('lineRefValid — boundary matrix', () => {
  it('path-only (no line) always passes', () => expect(lineRefValid(5)).toBe(true));
  it('line in range passes', () => expect(lineRefValid(5, 5)).toBe(true));
  it('line 0 fails', () => expect(lineRefValid(5, 0)).toBe(false));
  it('line beyond EOF fails', () => expect(lineRefValid(5, 6)).toBe(false));
  it('valid range passes', () => expect(lineRefValid(5, 2, 4)).toBe(true));
  it('inverted range fails', () => expect(lineRefValid(5, 4, 2)).toBe(false));
  it('range past EOF fails', () => expect(lineRefValid(5, 2, 99)).toBe(false));
});

describe('structuredOutputRule', () => {
  it('abstains when no schema is declared', async () => {
    expect(
      (await structuredOutputRule.evaluate(artifact({ content: 'prose' }), ctx())).verdict,
    ).toBe('abstain');
  });
  it('applies to all runs (abstains without a schema rather than being gated out)', () => {
    expect(structuredOutputRule.appliesTo(artifact({ content: 'prose' }))).toBe(true);
  });
  it('fails when schema is declared but content is not JSON', async () => {
    const a = artifact({ content: 'not json', outputContract: { schema: { type: 'object' } } });
    expect((await structuredOutputRule.evaluate(a, ctx())).verdict).toBe('fail');
  });
  it('passes when schema is declared and content is JSON', async () => {
    const a = artifact({ content: '{"ok":true}', outputContract: { schema: { type: 'object' } } });
    expect((await structuredOutputRule.evaluate(a, ctx())).verdict).toBe('pass');
  });
});

describe('citationResolvesRule', () => {
  it('abstains when citations are not required by the contract', async () => {
    const a = artifact({ content: 'see `src/a.ts`' });
    expect((await citationResolvesRule.evaluate(a, ctx(['src/a.ts']))).verdict).toBe('abstain');
  });
  it('passes when every citation resolves and lines are in range', async () => {
    const a = artifact({
      content: 'see `src/a.ts:2` and `src/b.ts`',
      outputContract: { citationsRequired: true },
    });
    expect((await citationResolvesRule.evaluate(a, ctx(['src/a.ts', 'src/b.ts']))).verdict).toBe(
      'pass',
    );
  });
  it('fails on a missing file', async () => {
    const a = artifact({
      content: 'see `src/gone.ts`',
      outputContract: { citationsRequired: true },
    });
    expect((await citationResolvesRule.evaluate(a, ctx([]))).verdict).toBe('fail');
  });
  it('fails on an out-of-range line', async () => {
    const a = artifact({
      content: 'see `src/a.ts:99`',
      outputContract: { citationsRequired: true },
    });
    expect((await citationResolvesRule.evaluate(a, ctx(['src/a.ts']))).verdict).toBe('fail');
  });
  it('fails a review citation outside the delivered bundle', async () => {
    const a = artifact({
      caller: 'review',
      content: 'see `src/a.ts`',
      outputContract: { citationsRequired: true },
      bundleItems: [{ filePath: 'src/other.ts' }],
    });
    expect((await citationResolvesRule.evaluate(a, ctx(['src/a.ts']))).verdict).toBe('fail');
  });
  it('abstains when there are no citations to resolve', async () => {
    const a = artifact({
      content: 'no citations here',
      outputContract: { citationsRequired: true },
    });
    expect((await citationResolvesRule.evaluate(a, ctx())).verdict).toBe('abstain');
  });
});

describe('specVerifyRule — the #2090/#2091 fabrication class', () => {
  const invented = 'The fix lives in `packages/cli/src/utils/diff-selector.ts`.';

  it('fails a spec citing a nonexistent path without VERIFY:', async () => {
    const a = artifact({ caller: 'spec', content: invented });
    expect((await specVerifyRule.evaluate(a, ctx([]))).verdict).toBe('fail');
  });
  it('passes when VERIFY: marks the unresolved path', async () => {
    const a = artifact({
      caller: 'spec',
      content: `${invented}\nVERIFY: this path may not exist yet.`,
    });
    expect((await specVerifyRule.evaluate(a, ctx([]))).verdict).toBe('pass');
  });
  it('still fails with VERIFY: when verifyFallback is disabled', async () => {
    const a = artifact({
      caller: 'spec',
      content: `${invented}\nVERIFY: x`,
      outputContract: { verifyFallback: false },
    });
    expect((await specVerifyRule.evaluate(a, ctx([]))).verdict).toBe('fail');
  });
  it('passes when all cited paths resolve', async () => {
    const a = artifact({
      caller: 'spec',
      content: 'see `packages/cli/src/utils/diff-selector.ts`',
    });
    expect(
      (await specVerifyRule.evaluate(a, ctx(['packages/cli/src/utils/diff-selector.ts']))).verdict,
    ).toBe('pass');
  });
  it('does not apply to review runs', () => {
    expect(specVerifyRule.appliesTo(artifact({ caller: 'review' }))).toBe(false);
  });
});

describe('overrideReappearanceRule — OQ2 boundary', () => {
  it('abstains when no override memory is supplied', async () => {
    const a = artifact({ caller: 'review', content: 'anything' });
    expect((await overrideReappearanceRule.evaluate(a, ctx())).verdict).toBe('abstain');
  });
  it('passes when no override reappears', async () => {
    const a = artifact({ caller: 'review', content: 'clean output' });
    const c: PostCheckContext = { ...ctx(), overrideMemory: { reappearsIn: () => [] } };
    expect((await overrideReappearanceRule.evaluate(a, c)).verdict).toBe('pass');
  });
  it('fails when the store reports a reappearance', async () => {
    const a = artifact({ caller: 'review', content: 'the rejected claim is back' });
    const c: PostCheckContext = { ...ctx(), overrideMemory: { reappearsIn: () => ['override-7'] } };
    expect((await overrideReappearanceRule.evaluate(a, c)).verdict).toBe('fail');
  });
});

describe('engine + DEFAULT_RULES integration', () => {
  it('rejects the #2090 fabrication end-to-end', async () => {
    const a = artifact({
      caller: 'spec',
      content: 'see `packages/cli/src/utils/diff-selector.ts`',
    });
    const r = await evaluatePostChecks(a, DEFAULT_RULES, ctx([]));
    expect(r.isRejected).toBe(true);
    expect(r.findings.find((f) => f.ruleName === 'spec-verify')?.verdict).toBe('fail');
  });

  it('F2: a non-canonical provenance class is a SENSOR signal and never rejects', async () => {
    const a = artifact({
      caller: 'spec',
      content: 'no citations',
      bundleItems: [{ filePath: 'src/a.ts', provenance: 'execution-verified' }],
    });
    const r = await evaluatePostChecks(a, DEFAULT_RULES, ctx());
    const prov = r.findings.find((f) => f.ruleName === 'provenance-fail-safe-down');
    expect(prov).toMatchObject({ tier: 'sensor', verdict: 'fail' });
    expect(r.isRejected).toBe(false);
  });

  it('a slice-1 historic artifact (no caller, no contract, no bundle) is all-abstain and does not reject', async () => {
    const a = artifact({ caller: undefined, taskProfile: 'Spec', content: '' });
    // taskProfile 'Spec' still resolves caller -> spec; use an unknown profile for a true historic no-caller run.
    const historic = artifact({
      taskProfile: 'LegacyUnknown',
      content: 'plain text, no citations',
    });
    const r = await evaluatePostChecks(historic, DEFAULT_RULES, ctx());
    expect(r.isRejected).toBe(false);
    expect(r.findings.every((f) => f.verdict === 'abstain')).toBe(true);
    void a;
  });
});

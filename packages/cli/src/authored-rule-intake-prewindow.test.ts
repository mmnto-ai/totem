import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import type { FrozenSplitArtifact } from '@mmnto/totem';

import { runRuleAuthor } from './authored-rule-intake.js';

// ─── ADR-112 §5.2 leakage semantics at INTAKE (#2294 couple, operator option (a)):
// legal iff ∉ heldOut ∧ (∈ train ∨ proven pre-window). The verified set is handed
// in by the git-holding command boundary; this exercises the git-free gate.

const SPLIT_REF = `split:${'a'.repeat(64)}`;
const COMMITMENT = 'c'.repeat(64);

/** The intake's binding gate reads ONLY splitRef / freezeCommitment / split slices. */
const artifact = {
  splitRef: SPLIT_REF,
  freezeCommitment: COMMITMENT,
  split: { trainPrs: [447, 601], heldOutPrs: [602, 697] },
} as unknown as FrozenSplitArtifact;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-intake-prewindow-'));
  fs.mkdirSync(path.join(root, 'spine'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

const fixture = (pr: number) => ({
  pr,
  preimageSource: {
    kind: 'commit',
    preimageCommitSha: 'b'.repeat(40),
    mergeCommitSha: 'a'.repeat(40),
  },
  filePath: 'src/x.rs',
  matchedSpan: 'L1',
  contentHash: 'h'.repeat(8),
});

const writeYaml = (fixturePr: number) => {
  fs.writeFileSync(
    path.join(root, 'spine', 'authored-rules.yaml'),
    yamlStringify({
      splitRef: SPLIT_REF,
      freezeCommitment: COMMITMENT,
      authoredAfterSplit: true,
      heldOutNonInspectionAttestation: true,
      rules: [
        {
          author: 'alice',
          authoredAt: '2026-07-04',
          targetDefect: 'forbidden console.log',
          declaredEngine: 'regex',
          structuralClass: 'forbidden-literal-token',
          dslSource: 'console\\.log',
          positiveFixtures: [fixture(fixturePr)],
        },
      ],
    }),
    'utf-8',
  );
};

const run = (verified?: ReadonlySet<number>) =>
  runRuleAuthor(root, {
    judgedBy: 'static-whitelist@cert-1',
    freezeBinding: { artifact },
    ...(verified !== undefined ? { verifiedPreWindowFixturePrs: verified } : {}),
  });

describe('runRuleAuthor §5.2 fixture gate — leakage semantics under a frozen binding', () => {
  it('a train-slice fixture passes with no verified set (strict lane, byte-unchanged)', () => {
    writeYaml(447);
    const result = run();
    expect(result.records).toHaveLength(1);
  });

  it('an out-of-window fixture WITHOUT proof → GATE_INVALID naming the unproven pre-window leg', () => {
    writeYaml(422);
    expect(() => run()).toThrow(/NOT proven strictly pre-window/);
    expect(() => run()).toThrow(/#422/);
  });

  it('an out-of-window fixture WITH the ancestry proof → accepted (#2294 couple, option (a))', () => {
    writeYaml(422);
    const result = run(new Set([422]));
    expect(result.records).toHaveLength(1);
    expect(result.minted).toBe(1);
    expect(result.rejected).toHaveLength(0);
  });

  it('a HELD-OUT fixture rejects even when the verified set names it (FM (c) never overridable)', () => {
    writeYaml(602);
    expect(() => run(new Set([602]))).toThrow(/HELD-OUT/);
  });
});

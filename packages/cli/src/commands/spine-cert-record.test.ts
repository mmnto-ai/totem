import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ClassifierResult,
  DraftClassifier,
  DraftExtractor,
  FetchResult,
  ReviewThreadContent,
  ReviewThreadSource,
} from '@mmnto/totem';

import { recordCommand, type RecordDeps } from './spine-cert-record.js';
import {
  computeArtifactHash,
  type ReplayArtifact,
  type ReplayProvenance,
} from './spine-llm-replay.js';

const sha = (n: number): string => String(n).padStart(40, '0');

const REGEX_DSL = ['**Pattern:** `forbiddenCall\\(`', '**Engine:** regex'].join('\n');

const PROVENANCE: ReplayProvenance = {
  promptTemplateHash: sha(11),
  systemPromptHash: sha(12),
  provider: 'anthropic',
  model: 'claude-test',
  temperature: 0,
  orchestratorVersion: '0.0.0-test',
  adapterKind: 'extractor+classifier',
  keyVersion: 'v1',
  totemVersion: '0.0.0-test',
};

function content(pr: number): ReviewThreadContent {
  return {
    pr,
    mergeCommitSha: sha(pr),
    threads: [
      {
        path: 'src/a.ts',
        comments: [{ author: 'Jane', body: 'note' }],
        isResolved: false,
        isOutdated: false,
      },
    ],
  };
}

function fakeDeps(): RecordDeps {
  return {
    source: {
      async fetch(pr: number): Promise<FetchResult> {
        return { kind: 'ok', content: content(pr) };
      },
    } satisfies ReviewThreadSource,
    liveExtractor: {
      async draft() {
        return { drafts: [REGEX_DSL] };
      },
    } satisfies DraftExtractor,
    liveClassifier: {
      async classify(): Promise<ClassifierResult> {
        return { disposition: 'structural', dispositionSource: 'classified' };
      },
    } satisfies DraftClassifier,
    provenance: PROVENANCE,
  };
}

function validLock(): unknown {
  return {
    schema: 'windtunnel.lock.v1',
    canonicalPath: '.totem/spine/gate-1/windtunnel.lock.json',
    gate: 'gate-1',
    phase: 'certifying',
    corpus: {
      repo: 'mmnto-ai/liquid-city',
      selectionRule: {
        state: 'merged',
        predicate: 'touches-code',
        window: { type: 'all' },
        asOfCommit: sha(100),
      },
      resolvedPrs: [{ pr: 1, mergeCommit: sha(1), baseSha: sha(2), headSha: sha(3) }],
    },
    fpDefinition: {
      rubricRef: 'controls/rubric.md',
      groundTruthRef: 'controls/gt.json',
      adjudicator: 'operator',
      precisionFloor: 1.0,
    },
    controls: {
      positiveRef: 'controls/positive/',
      negativeRef: 'controls/negative/',
      integrity: { mechanism: 'git-hash-object', fixtureSha: sha(0) },
    },
    cullRateThreshold: 0.25,
    exposureDenominator: {
      activeRulesEvaluated: { floor: 2 },
      filesTouchedInWindow: { floor: 0 },
      positiveControlsExercised: { floor: 0 },
    },
  };
}

const SPLIT = {
  asOfCommit: sha(100),
  trainPrs: [1],
  heldOutPrs: [],
  excludedPrs: [],
  positiveControlPrs: [],
  negativeControlPrs: [],
  splitRule: { predicate: 'code-touching non-bot', cutIndex: 1 },
};

let tmpDir: string;
let gate1Dir: string;
let lockPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-record-cmd-'));
  gate1Dir = path.join(tmpDir, 'gate-1');
  fs.mkdirSync(gate1Dir, { recursive: true });
  lockPath = path.join(gate1Dir, 'windtunnel.lock.json');
  fs.writeFileSync(lockPath, JSON.stringify(validLock()), 'utf-8');
  fs.writeFileSync(path.join(gate1Dir, 'split.json'), JSON.stringify(SPLIT), 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('recordCommand (A2 record path)', () => {
  it('freezes the llm-replay artifact + review content and returns the integrity hash', async () => {
    const result = await recordCommand({ lockPath, deps: fakeDeps() });

    expect(fs.existsSync(result.artifactPath)).toBe(true);
    expect(fs.existsSync(result.contentPath)).toBe(true);

    // The returned hash matches computeArtifactHash over the written artifact.
    const artifact = JSON.parse(fs.readFileSync(result.artifactPath, 'utf-8')) as ReplayArtifact;
    expect(result.hash).toBe(computeArtifactHash(artifact));

    // The frozen content carries the fetched train PR.
    const frozenContent = JSON.parse(fs.readFileSync(result.contentPath, 'utf-8'));
    expect(frozenContent).toHaveLength(1);
    expect(frozenContent[0].pr).toBe(1);

    // The artifact recorded both extractor + classifier outputs.
    expect(Object.keys(artifact.records.extractor).length).toBeGreaterThan(0);
    expect(Object.keys(artifact.records.classifier).length).toBeGreaterThan(0);
  });
});

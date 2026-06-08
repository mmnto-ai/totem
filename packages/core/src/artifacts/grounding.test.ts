/**
 * Grounding-bundle tests (mmnto-ai/totem#2101, strategy#474 slice 2).
 *
 * The invariants under test are the design doc's eight, minus the caller-side
 * ones (those live in the CLI test suites):
 *   1. first-cut builder emits ONLY similarity-only items,
 *   2. input order never moves the bundle hash (canonical sort),
 *   3. summary derives from items alone; zero items → 'ungrounded',
 *   5. slice-1 artifacts (no bundle) still parse (F1 tolerance),
 *   7. items carry identity + hash, never content bytes.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGroundingBundle,
  type GroundingSourceItem,
  summarizeProvenance,
} from './grounding.js';
import { calculateDeterministicHash } from './hash.js';
import {
  GroundingItemSchema,
  PROVENANCE_CLASSES,
  PROVENANCE_COMPILED_RULE,
  PROVENANCE_SIMILARITY_ONLY,
  PROVENANCE_UNGROUNDED,
  RUN_ARTIFACT_SCHEMA_VERSION,
  RunArtifactSchema,
} from './schema.js';

function source(
  overrides: Partial<GroundingSourceItem['result']> = {},
  sourceType = 'code',
): GroundingSourceItem {
  return {
    sourceType,
    result: { content: 'function x() {}', filePath: 'src/x.ts', ...overrides },
  };
}

function baseArtifact(): Record<string, unknown> {
  return {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: 'prompt after DLP' },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only' },
    backend: {
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      qualifiedModel: 'gemini:gemini-3.1-pro-preview',
      admissionClass: 'completion_only',
      taskProfile: 'Spec',
    },
    output: { content: 'response', metrics: { durationMs: 100 } },
    createdAt: '2026-06-07T23:00:00.000Z',
  };
}

describe('buildGroundingBundle', () => {
  it('includes every input item — duplicates are delivery records, never deduped', () => {
    const item = source();
    const bundle = buildGroundingBundle([item, item, source({ filePath: 'src/y.ts' })]);
    expect(bundle.items).toHaveLength(3);
  });

  it('first cut emits only similarity-only — no input shape produces an upgraded class', () => {
    const bundle = buildGroundingBundle([
      source(),
      source({ filePath: 'lessons/l1.md' }, 'lesson'),
      source({ filePath: 'spec.md', sourceRepo: 'strategy' }, 'spec'),
    ]);
    expect(bundle.items.every((i) => i.provenance === PROVENANCE_SIMILARITY_ONLY)).toBe(true);
  });

  it('same item set in any input order produces a deep-equal bundle and identical hash', () => {
    const items = [
      source({ filePath: 'src/b.ts' }),
      source({ filePath: 'src/a.ts' }, 'spec'),
      source({ filePath: 'src/a.ts', sourceRepo: 'strategy' }),
      source({ content: 'other content', filePath: 'src/a.ts' }),
    ];
    const forward = buildGroundingBundle(items);
    const reversed = buildGroundingBundle([...items].reverse());
    expect(forward).toEqual(reversed);
    expect(calculateDeterministicHash(forward)).toBe(calculateDeterministicHash(reversed));
  });

  it('contentHash uses the one deterministic-hash convention; items carry no content bytes', () => {
    const bundle = buildGroundingBundle([source({ content: 'the snippet' })]);
    expect(bundle.items[0]!.contentHash).toBe(calculateDeterministicHash('the snippet'));
    expect(JSON.stringify(bundle)).not.toContain('the snippet');
  });

  it("carries sourceRepo only when present — absent means the run's own repo (F1)", () => {
    const bundle = buildGroundingBundle([
      source({ sourceRepo: 'strategy' }),
      source({ filePath: 'src/local.ts' }),
    ]);
    const cross = bundle.items.find((i) => i.sourceRepo !== undefined);
    const local = bundle.items.find((i) => i.sourceRepo === undefined);
    expect(cross?.sourceRepo).toBe('strategy');
    expect(local).toBeDefined();
    expect('sourceRepo' in local!).toBe(false);
  });
});

describe('summarizeProvenance', () => {
  it('derives sorted class counts from items alone', () => {
    const bundle = buildGroundingBundle([source(), source({ filePath: 'src/y.ts' })]);
    expect(summarizeProvenance(bundle)).toBe(`${PROVENANCE_SIMILARITY_ONLY}:2`);
  });

  it('renders multi-class bundles in sorted class order (deterministic string)', () => {
    // Hand-built bundle: the builder cannot emit upgraded classes (by design),
    // but the summarizer must handle them for the mmnto-ai/totem#344/#375 graduation path.
    const bundle = {
      items: [
        {
          provenance: PROVENANCE_SIMILARITY_ONLY,
          contentHash: 'c'.repeat(64),
          sourceType: 'code',
          filePath: 'a.ts',
        },
        {
          provenance: PROVENANCE_COMPILED_RULE,
          contentHash: 'd'.repeat(64),
          sourceType: 'lesson',
          filePath: 'b.md',
        },
        {
          provenance: PROVENANCE_SIMILARITY_ONLY,
          contentHash: 'e'.repeat(64),
          sourceType: 'code',
          filePath: 'c.ts',
        },
      ],
    };
    expect(summarizeProvenance(bundle)).toBe(
      `${PROVENANCE_COMPILED_RULE}:1,${PROVENANCE_SIMILARITY_ONLY}:2`,
    );
  });

  it("zero items → 'ungrounded' — abstention named, never empty", () => {
    expect(summarizeProvenance({ items: [] })).toBe(PROVENANCE_UNGROUNDED);
    expect(PROVENANCE_UNGROUNDED.length).toBeGreaterThan(0);
  });
});

describe('grounding schemas', () => {
  it('item requires identity fields — fabricated/absent identity is the illusion-of-grounding trap', () => {
    expect(() =>
      GroundingItemSchema.parse({
        provenance: PROVENANCE_SIMILARITY_ONLY,
        contentHash: 'f'.repeat(64),
        sourceType: 'code',
      }),
    ).toThrow();
    expect(() =>
      GroundingItemSchema.parse({
        provenance: PROVENANCE_SIMILARITY_ONLY,
        contentHash: 'not-a-hash',
        sourceType: 'code',
        filePath: 'a.ts',
      }),
    ).toThrow();
  });

  it('accepts non-canonical class strings — open vocabulary; consumers fail-safe-down (F2)', () => {
    const parsed = GroundingItemSchema.parse({
      provenance: 'execution-verified',
      contentHash: 'f'.repeat(64),
      sourceType: 'code',
      filePath: 'a.ts',
    });
    expect(parsed.provenance).toBe('execution-verified');
    expect(PROVENANCE_CLASSES).not.toContain('execution-verified');
  });

  it('a bundled artifact parses, and a slice-1 artifact without a bundle still parses (F1 tolerance)', () => {
    const slice1 = { ...baseArtifact(), schemaVersion: '1.0.0' };
    expect(() => RunArtifactSchema.parse(slice1)).not.toThrow();

    const bundle = buildGroundingBundle([source()]);
    const bundled = {
      ...baseArtifact(),
      grounding: {
        hash: calculateDeterministicHash(bundle),
        provenanceSummary: summarizeProvenance(bundle),
        bundle,
      },
    };
    const parsed = RunArtifactSchema.parse(bundled);
    // Explicit presence guard (Greptile R1 on mmnto-ai/totem#2122): an absent
    // bundle must fail HERE as a clear assertion, not as a confusing
    // crypto.update error inside the hash recompute below.
    expect(parsed.grounding.bundle).toBeDefined();
    expect(parsed.grounding.bundle?.items).toHaveLength(1);
    // Invariant 4: the attested hash is recomputable from the artifact surface alone.
    expect(parsed.grounding.hash).toBe(calculateDeterministicHash(parsed.grounding.bundle));
  });

  it('the written schema version is a 1.x minor bump marking the bundle semantics (Q3)', () => {
    expect(RUN_ARTIFACT_SCHEMA_VERSION).toBe('1.1.0');
  });
});

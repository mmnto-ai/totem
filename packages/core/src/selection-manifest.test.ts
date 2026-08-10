/**
 * Writer + schema tests for the selection-manifest instrument
 * (mmnto-ai/totem#2468 — the Prop 308 / strategy#467 M1 emitter substrate).
 *
 * The invariants under test come verbatim from the design doc
 * (.totem/specs/2468-selection-manifests.md):
 *
 *  - the schema is strict at BOTH levels — the structural refute-condition
 *    guard (Prop 308 F1: no shared score field can appear silently);
 *  - a fingerprint covers exactly the considered bytes: stable on identical
 *    content, changed on changed content, ABSENT (with a named warning) on
 *    hash failure — never fabricated;
 *  - attribution is stamped absence: no env/seat/session → fields absent,
 *    never guessed;
 *  - emission is a pure sensor: a failed append leaves the caller unbroken
 *    and the failure named on the accounting channel; a schema-invalid row
 *    THROWS from the writer (emitter programming error) and is converted to
 *    a warning by the sense wrapper;
 *  - a `.totem`-less cwd is a silent normal-state skip that materialises no
 *    directory.
 *
 * The EACCES induced-failure uses vi.spyOn on `node:fs` (accounting-branch
 * coverage, same scoping rationale as qbd/record.test.ts documents).
 */

import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs so spyOn works in ESM — same pattern as qbd/record.test.ts.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, default: actual };
});

import * as fs from 'node:fs';

import { TotemError } from './errors.js';
import {
  appendSelectionManifest,
  buildMeasuredCandidate,
  buildSelectionManifestRow,
  fingerprintContent,
  measureCandidateCost,
  readSelectionManifests,
  SELECTION_COST_BASIS,
  SELECTION_MANIFESTS_FILE,
  type SelectionCandidate,
  SelectionCandidateSchema,
  type SelectionManifestInput,
  SelectionManifestRowSchema,
  senseSelectionManifest,
} from './selection-manifest.js';
import { cleanTmpDir } from './test-utils.js';

const T0 = Date.parse('2026-08-10T03:00:00.000Z');
const SESSION_A = '550e8400-e29b-41d4-a716-446655440000';

let tmpDir: string;
let totemDir: string;

function baseCandidate(over: Partial<SelectionCandidate> = {}): SelectionCandidate {
  return {
    id: 'docs/example.md',
    disposition: 'selected',
    reason: 'test-policy: selected',
    ...over,
  };
}

function baseInput(over: Partial<SelectionManifestInput> = {}): SelectionManifestInput {
  return {
    totemDir,
    emitter: 'search_knowledge',
    context: { query: 'q' },
    universe: 'test-pool',
    candidates: [baseCandidate()],
    nowMs: T0,
    env: {},
    ...over,
  };
}

function manifestPath(): string {
  return path.join(totemDir, 'ledger', SELECTION_MANIFESTS_FILE);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-manifest-'));
  totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanTmpDir(tmpDir);
});

// ─── Measurement helpers ────────────────────────────────

describe('fingerprintContent / measureCandidateCost', () => {
  it('is stable across identical content and changes when content changes', () => {
    expect(fingerprintContent('same bytes')).toBe(fingerprintContent('same bytes'));
    expect(fingerprintContent('same bytes')).not.toBe(fingerprintContent('same bytes!'));
    expect(fingerprintContent('same bytes')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('string and Buffer forms of the same bytes fingerprint identically', () => {
    const s = 'café content';
    expect(fingerprintContent(s)).toBe(fingerprintContent(Buffer.from(s, 'utf-8')));
  });

  it('measures UTF-8 bytes (not chars) and declares tokens as ceil(bytes/4)', () => {
    const s = 'éé'; // 2 chars, 4 UTF-8 bytes
    expect(measureCandidateCost(s)).toEqual({ bytes: 4, approxTokens: 1 });
    expect(measureCandidateCost('12345')).toEqual({ bytes: 5, approxTokens: 2 });
    expect(measureCandidateCost('')).toEqual({ bytes: 0, approxTokens: 0 });
  });
});

describe('buildMeasuredCandidate', () => {
  it('measures and fingerprints content the policy actually read', () => {
    const { candidate, warning } = buildMeasuredCandidate({
      id: 'a.md',
      content: 'hello',
      disposition: 'selected',
      reason: 'r',
    });
    expect(warning).toBeUndefined();
    expect(candidate).toMatchObject({
      id: 'a.md',
      bytes: 5,
      approxTokens: 2,
      fingerprint: fingerprintContent('hello'),
    });
  });

  it('is TOTAL over bad content: non-string/non-Buffer degrades to an id-only row + warning, never a throw or a NaN (leg round 1, H-7)', () => {
    for (const bad of [undefined, null, 42, {}] as unknown[]) {
      const { candidate, warning } = buildMeasuredCandidate({
        id: 'bad.md',
        content: bad as string,
        disposition: 'selected',
        reason: 'r',
      });
      expect(warning).toContain('bad.md');
      expect(candidate.bytes).toBeUndefined();
      expect(candidate.approxTokens).toBeUndefined();
      expect(candidate.fingerprint).toBeUndefined();
      // The degraded row is still schema-valid inside a manifest — the whole
      // point: one malformed hit must not cost the row (H-7's failure shape).
      expect(SelectionCandidateSchema.safeParse(candidate).success).toBe(true);
    }
  });
});

// ─── Schema strictness (the refute-condition guard) ─────

describe('schema strictness', () => {
  it('rejects an unknown top-level field (e.g. a shared score)', () => {
    const row = buildSelectionManifestRow(baseInput());
    const poisoned = { ...row, sharedRelevanceScore: 0.9 };
    expect(SelectionManifestRowSchema.safeParse(poisoned).success).toBe(false);
  });

  it('rejects an unknown per-candidate field', () => {
    const row = buildSelectionManifestRow(baseInput());
    const poisoned = {
      ...row,
      candidates: [{ ...row.candidates[0]!, commonWeight: 1 }],
    };
    expect(SelectionManifestRowSchema.safeParse(poisoned).success).toBe(false);
  });

  it('rejects a row whose costBasis does not name the ruled aggregation', () => {
    const row = buildSelectionManifestRow(baseInput());
    const poisoned = { ...row, costBasis: { bytes: 'utf8-length', approxTokens: 'measured' } };
    expect(SelectionManifestRowSchema.safeParse(poisoned).success).toBe(false);
  });

  it('accepts a fully-populated row round-trip', () => {
    const row = buildSelectionManifestRow(
      baseInput({
        finalTruncation: { cap: 10_000, totalChars: 12_345, applied: true },
        candidates: [
          baseCandidate({ bytes: 5, approxTokens: 2, fingerprint: 'a'.repeat(16) }),
          baseCandidate({
            id: 'b.md',
            disposition: 'truncated',
            reason: 'display-cap 250 lines',
            bytes: 100,
            approxTokens: 25,
            deliveredBytes: 40,
          }),
          baseCandidate({ id: 'c.md', disposition: 'excluded', reason: 'recency-policy' }),
        ],
      }),
    );
    const parsed = SelectionManifestRowSchema.safeParse(JSON.parse(JSON.stringify(row)));
    expect(parsed.success).toBe(true);
  });
});

// ─── Attribution ────────────────────────────────────────

describe('attribution', () => {
  it('stamps absence when env and session pointer are absent — never guesses', () => {
    const row = buildSelectionManifestRow(baseInput());
    expect(row.session_id).toBeUndefined();
    expect(row.agent_source).toBeUndefined();
    expect(row.costBasis).toEqual(SELECTION_COST_BASIS);
    expect(row.timestamp).toBe(new Date(T0).toISOString());
  });

  it('stamps seat and session when both are present', () => {
    fs.mkdirSync(path.join(totemDir, 'ledger'), { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'ledger', '.session-id'), SESSION_A, 'utf-8');
    const row = buildSelectionManifestRow(baseInput({ env: { TOTEM_SELF_AGENT: 'totem-claude' } }));
    expect(row.session_id).toBe(SESSION_A);
    expect(row.agent_source).toBe('totem-claude');
  });
});

// ─── Writer ─────────────────────────────────────────────

describe('appendSelectionManifest', () => {
  it('writes a schema-valid NDJSON row that readSelectionManifests round-trips', () => {
    const result = appendSelectionManifest(baseInput());
    expect(result.written).toBe(true);
    expect(result.warnings).toEqual([]);
    const rows = readSelectionManifests(totemDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      schemaVersion: 1,
      emitter: 'search_knowledge',
      universe: 'test-pool',
    });
  });

  it('skips silently (no directory materialised) outside an instrumented project', () => {
    const bare = path.join(tmpDir, 'not-a-project', '.totem');
    const result = appendSelectionManifest(baseInput({ totemDir: bare }));
    expect(result).toMatchObject({ written: false, skipped: true, warnings: [] });
    expect(fs.existsSync(bare)).toBe(false);
  });

  it('THROWS the contract error on a schema-invalid row instead of persisting it', () => {
    const input = baseInput({
      candidates: [baseCandidate({ reason: '' })], // violates min(1)
    });
    expect(() => appendSelectionManifest(input)).toThrowError(TotemError);
    try {
      appendSelectionManifest(input);
    } catch (err) {
      expect((err as TotemError).code).toBe('SELECTION_MANIFEST_CONTRACT');
    }
    expect(fs.existsSync(manifestPath())).toBe(false);
  });

  it('degrades to a NAMED warning when the append itself fails (EACCES)', () => {
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    const result = appendSelectionManifest(baseInput());
    spy.mockRestore();
    expect(result.written).toBe(false);
    expect(result.warnings.some((w) => w.includes('append failed') && w.includes('EACCES'))).toBe(
      true,
    );
  });
});

// ─── Sensor wrapper (Tenet 13) ──────────────────────────

describe('senseSelectionManifest', () => {
  it('converts the contract throw into a warning and never propagates', () => {
    const warnings: string[] = [];
    const result = senseSelectionManifest(
      baseInput({ candidates: [baseCandidate({ reason: '' })] }),
      (w) => warnings.push(w),
    );
    expect(result.written).toBe(false);
    expect(warnings.some((w) => w.includes('selection-manifest sensor failed'))).toBe(true);
  });

  it('surfaces writer warnings through onWarn on the degraded path', () => {
    const spy = vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    const warnings: string[] = [];
    const result = senseSelectionManifest(baseInput(), (w) => warnings.push(w));
    spy.mockRestore();
    expect(result.written).toBe(false);
    expect(warnings.some((w) => w.includes('append failed'))).toBe(true);
  });

  it('healthy control: writes clean, no warnings surfaced', () => {
    const warnings: string[] = [];
    const result = senseSelectionManifest(baseInput(), (w) => warnings.push(w));
    expect(result.written).toBe(true);
    expect(warnings).toEqual([]);
  });
});

// ─── Reader ─────────────────────────────────────────────

describe('readSelectionManifests', () => {
  it('returns [] on ENOENT and skips malformed / schema-invalid lines', () => {
    expect(readSelectionManifests(totemDir)).toEqual([]);
    appendSelectionManifest(baseInput());
    fs.appendFileSync(manifestPath(), 'not json\n{"schemaVersion":99}\n', 'utf-8');
    const rows = readSelectionManifests(totemDir);
    expect(rows).toHaveLength(1);
  });
});

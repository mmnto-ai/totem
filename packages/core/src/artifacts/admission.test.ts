/**
 * Admission-record store tests (mmnto-ai/totem#2473).
 *
 * The store mirrors the verdict store's idioms — content-addressed with
 * `createdAt` excluded as observability-only, `wx` + EEXIST logical-identity
 * dedup, raw-address verification before schema parsing — and the record binds
 * the exact observation (scope + inputHash + projectionPolicyHash), so these
 * tests lock the identity semantics the codex design review required: two
 * different observations never share an address, an identical observation
 * repeated dedups to one record, and resolution is exact-identity with loud
 * corruption surfacing (never a silent fallback).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ADMISSION_RECORD_SCHEMA_VERSION,
  type AdmissionRecord,
  computeAdmissionContentHash,
  computeProjectionPolicyHash,
  findAdmissionRecordByIdentity,
  loadAdmissionRecord,
  renderAdmissionLine,
  saveAdmissionRecord,
} from './admission.js';

const SHA_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function baseRecord(overrides: Partial<AdmissionRecord> = {}): AdmissionRecord {
  return {
    schemaVersion: ADMISSION_RECORD_SCHEMA_VERSION,
    disposition: 'not-applicable',
    reason: 'all-non-code',
    createdAt: '2026-08-14T20:00:00.000Z',
    scope: { source: 'uncommitted', base: null, head: null, selectorForm: null },
    inputHash: SHA_EMPTY,
    projectionPolicyHash: SHA_EMPTY,
    skippedFileCount: 2,
    ...overrides,
  };
}

describe('computeProjectionPolicyHash — canonicalizer determinism', () => {
  const policy = {
    sourceExtensions: ['.ts', '.tsx'],
    generatedGlobs: ['**/pnpm-lock.yaml', '**/dist/**'],
    notGeneratedGlobs: ['docs/**'],
    ignorePatterns: ['audits/**'],
    classifierId: 'classifyChangedFiles@1',
  };

  it('is order-insensitive across array fields (set semantics)', () => {
    const reordered = {
      ...policy,
      sourceExtensions: ['.tsx', '.ts'],
      generatedGlobs: ['**/dist/**', '**/pnpm-lock.yaml'],
    };
    expect(computeProjectionPolicyHash(reordered)).toBe(computeProjectionPolicyHash(policy));
  });

  it('changes when any policy input changes — equal bytes under a changed policy are a different observation', () => {
    const base = computeProjectionPolicyHash(policy);
    expect(computeProjectionPolicyHash({ ...policy, sourceExtensions: ['.ts'] })).not.toBe(base);
    expect(computeProjectionPolicyHash({ ...policy, generatedGlobs: [] })).not.toBe(base);
    expect(computeProjectionPolicyHash({ ...policy, ignorePatterns: [] })).not.toBe(base);
    expect(
      computeProjectionPolicyHash({ ...policy, classifierId: 'classifyChangedFiles@2' }),
    ).not.toBe(base);
  });
});

describe('admission store — save/load/dedup/identity', () => {
  let totemDirAbs: string;

  beforeEach(() => {
    totemDirAbs = fs.mkdtempSync(path.join(os.tmpdir(), 'admission-store-'));
  });

  afterEach(() => {
    fs.rmSync(totemDirAbs, { recursive: true, force: true });
  });

  const storeDir = () => path.join(totemDirAbs, 'artifacts', 'admissions');

  it('round-trips a record with a verified content address', () => {
    const record = baseRecord();
    const saved = saveAdmissionRecord(totemDirAbs, record);
    expect(saved.existed).toBe(false);

    const loaded = loadAdmissionRecord(totemDirAbs, saved.hash);
    expect(loaded.record).toEqual(record);
    expect(loaded.contentHash).toBe(saved.hash);
  });

  it('createdAt is observability-only: same observation, different timestamps, ONE record (first-write-wins)', () => {
    const first = saveAdmissionRecord(
      totemDirAbs,
      baseRecord({ createdAt: '2026-08-14T20:00:00.000Z' }),
    );
    const second = saveAdmissionRecord(
      totemDirAbs,
      baseRecord({ createdAt: '2026-08-15T09:30:00.000Z' }),
    );
    expect(second.hash).toBe(first.hash);
    expect(second.existed).toBe(true);
    expect(fs.readdirSync(storeDir())).toHaveLength(1);
    // First write wins: the stored timestamp is the FIRST observation's.
    expect(loadAdmissionRecord(totemDirAbs, first.hash).record.createdAt).toBe(
      '2026-08-14T20:00:00.000Z',
    );
  });

  it('two different observations never share an address (input hash / policy hash / scope / reason)', () => {
    const base = computeAdmissionContentHash(baseRecord());
    const otherInput = computeAdmissionContentHash(
      baseRecord({ inputHash: SHA_EMPTY.replace('e3b0', 'ffff') }),
    );
    const otherPolicy = computeAdmissionContentHash(
      baseRecord({ projectionPolicyHash: SHA_EMPTY.replace('e3b0', 'ffff') }),
    );
    const otherScope = computeAdmissionContentHash(
      baseRecord({ scope: { source: 'staged', base: null, head: null, selectorForm: '--staged' } }),
    );
    const otherReason = computeAdmissionContentHash(baseRecord({ reason: 'filtered-empty' }));
    expect(new Set([base, otherInput, otherPolicy, otherScope, otherReason]).size).toBe(5);
  });

  it('rejects an invalid record on save (validate on the way out)', () => {
    expect(() =>
      saveAdmissionRecord(totemDirAbs, {
        ...baseRecord(),
        reason: 'because-i-said-so',
      } as unknown as AdmissionRecord),
    ).toThrow();
    expect(fs.existsSync(storeDir())).toBe(false);
  });

  it('a tampered stored record fails content-address verification loud', () => {
    const saved = saveAdmissionRecord(totemDirAbs, baseRecord());
    const filePath = path.join(storeDir(), `${saved.hash}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    raw['skippedFileCount'] = 99;
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');

    expect(() => loadAdmissionRecord(totemDirAbs, saved.hash)).toThrow(
      /content-address verification/,
    );
  });

  it('findAdmissionRecordByIdentity: exact-identity hit, miss, and loud corruption routing', () => {
    const record = baseRecord();
    const { createdAt: _createdAt, ...identity } = record;
    const corrupt: string[] = [];

    // Miss before any write.
    expect(findAdmissionRecordByIdentity(totemDirAbs, identity, (m) => corrupt.push(m))).toBe(
      undefined,
    );

    const saved = saveAdmissionRecord(totemDirAbs, record);
    const found = findAdmissionRecordByIdentity(totemDirAbs, identity, (m) => corrupt.push(m));
    expect(found?.contentHash).toBe(saved.hash);
    expect(found?.record).toEqual(record);
    expect(corrupt).toHaveLength(0);

    // A DIFFERENT identity does not resolve to it.
    expect(
      findAdmissionRecordByIdentity(totemDirAbs, { ...identity, reason: 'no-diff' }, (m) =>
        corrupt.push(m),
      ),
    ).toBe(undefined);

    // Present-but-corrupt routes to onCorrupt and returns undefined — the
    // caller's loud no-current-record sensor covers it (never silent).
    fs.writeFileSync(path.join(storeDir(), `${saved.hash}.json`), '{ not json', 'utf-8');
    expect(findAdmissionRecordByIdentity(totemDirAbs, identity, (m) => corrupt.push(m))).toBe(
      undefined,
    );
    expect(corrupt).toHaveLength(1);
  });

  it('renderAdmissionLine carries the local-lane prefix, reason, address, and record timestamp', () => {
    const saved = saveAdmissionRecord(totemDirAbs, baseRecord());
    const loaded = loadAdmissionRecord(totemDirAbs, saved.hash);
    expect(renderAdmissionLine(loaded)).toBe(
      `local-lane: not-applicable (all-non-code) recorded=${saved.hash.slice(0, 8)} at=2026-08-14T20:00:00.000Z`,
    );
  });
});

/**
 * Admission-record store tests (mmnto-ai/totem#2473).
 *
 * The store mirrors the verdict store's idioms — content-addressed with
 * `createdAt` (observability) and `schemaVersion` (writer metadata) excluded,
 * `wx` + EEXIST logical-identity dedup, raw-address verification before
 * schema parsing — and the record binds
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

  it('is order-insensitive AND duplicate-insensitive across array fields (true set semantics)', () => {
    const reordered = {
      ...policy,
      sourceExtensions: ['.tsx', '.ts'],
      generatedGlobs: ['**/dist/**', '**/pnpm-lock.yaml'],
    };
    expect(computeProjectionPolicyHash(reordered)).toBe(computeProjectionPolicyHash(policy));

    // A duplicated config entry does not change the effective projection, so
    // it must not re-key the address (CR on #2641).
    const duplicated = {
      ...policy,
      sourceExtensions: ['.ts', '.tsx', '.ts'],
      ignorePatterns: ['audits/**', 'audits/**'],
    };
    expect(computeProjectionPolicyHash(duplicated)).toBe(computeProjectionPolicyHash(policy));
  });

  it('is fixture-locked: a frozen policy pins a frozen digest (canonicalization drift fails red)', () => {
    // Falsification-leg MINOR 6: order-insensitivity tests alone cannot catch
    // a canonicalization change (a new field, a changed sort, a platform value
    // entering the hash). This pin does — recompute deliberately on any
    // intentional canonicalizer change.
    expect(
      computeProjectionPolicyHash({
        sourceExtensions: ['.ts', '.tsx'],
        generatedGlobs: ['**/pnpm-lock.yaml', '**/dist/**'],
        notGeneratedGlobs: ['docs/**'],
        ignorePatterns: ['audits/**'],
        classifierId: 'pinned-fixture@1',
      }),
    ).toBe('0d7c60a7f0fe5e2d06a1a61c37082599432adf4f19638948313f3db1eec2adc8');
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

  it('createdAt is a constrained UTC instant — a newline-bearing value is rejected on write AND on verified load', () => {
    // The field is address-excluded yet rides the stdout `local-lane:` line,
    // so an injection through it must fail loud (CR on #2641).
    const injected = '2026-08-14T20:00:00.000Z\ninjected: line';
    expect(() => saveAdmissionRecord(totemDirAbs, baseRecord({ createdAt: injected }))).toThrow();

    // Hand-edit the stored record's timestamp: the address still verifies
    // (createdAt is excluded), so the SCHEMA must be the rejecting layer.
    const saved = saveAdmissionRecord(totemDirAbs, baseRecord());
    const filePath = path.join(storeDir(), `${saved.hash}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    raw['createdAt'] = injected;
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf-8');
    expect(() => loadAdmissionRecord(totemDirAbs, saved.hash)).toThrow(/schema validation/);
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
    const { createdAt: _createdAt, schemaVersion: _schemaVersion, ...identity } = record;
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

  it('schemaVersion is writer metadata: the address is stable across 1.x versions and lookup needs no version', () => {
    // Falsification-leg MINOR 3: including schemaVersion in the address would
    // orphan every prior record on each minor bump — the tolerant-reader
    // contract requires the OBSERVATION alone to be the identity.
    expect(computeAdmissionContentHash(baseRecord({ schemaVersion: '1.0.0' }))).toBe(
      computeAdmissionContentHash(baseRecord({ schemaVersion: '1.9.3' })),
    );

    // Save under a DIFFERENT 1.x than the writer default so the version-free
    // lookup half genuinely crosses versions (re-arm leg MINOR 6 — a 1.0.0
    // save was same-version on both sides and tested nothing).
    const saved = saveAdmissionRecord(totemDirAbs, baseRecord({ schemaVersion: '1.9.3' }));
    const { createdAt: _c, schemaVersion: _s, ...identity } = baseRecord();
    const found = findAdmissionRecordByIdentity(totemDirAbs, identity, () => {});
    expect(found?.contentHash).toBe(saved.hash);
  });

  it('a newer-major record at a shared address fails with the NAMED upgrade error, never generic corruption', () => {
    // Version-free addressing makes this meeting possible (re-arm leg MINOR 5):
    // hand-write a valid-shaped 2.x record at the address its observation
    // would occupy, then load it as this 1.x reader.
    const record = { ...baseRecord(), schemaVersion: '2.0.0' };
    const { createdAt: _c, schemaVersion: _s, ...identity } = record;
    const dir = path.join(totemDirAbs, 'artifacts', 'admissions');
    fs.mkdirSync(dir, { recursive: true });
    const hash = computeAdmissionContentHash(record as AdmissionRecord);
    fs.writeFileSync(path.join(dir, `${hash}.json`), JSON.stringify(record, null, 2), 'utf-8');

    expect(() => loadAdmissionRecord(totemDirAbs, hash)).toThrow(/written by a newer totem/);
    // And the exact-identity path routes it to onCorrupt-style handling
    // upstream — but never as an address-verification failure.
    expect(() => loadAdmissionRecord(totemDirAbs, hash)).not.toThrow(
      /content-address verification/,
    );
    void identity;
  });

  it('renderAdmissionLine carries the local-lane prefix, reason, address, and record timestamp', () => {
    const saved = saveAdmissionRecord(totemDirAbs, baseRecord());
    const loaded = loadAdmissionRecord(totemDirAbs, saved.hash);
    expect(renderAdmissionLine(loaded)).toBe(
      `local-lane: not-applicable (all-non-code) recorded=${saved.hash.slice(0, 8)} at=2026-08-14T20:00:00.000Z`,
    );
  });
});

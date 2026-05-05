/**
 * Tests for `detectStaleManifest` + `staleManifestError`
 * (mmnto-ai/totem#1811, ADR-101).
 *
 * Two parallel paths drive the design:
 *   - Tree-sitter miss + cohort matches (semver-minor) → null detection,
 *     caller falls through to the original `TotemParseError`.
 *   - Tree-sitter miss + cohort missing/mismatched → detection object,
 *     caller surfaces a structured `STALE_MANIFEST` nudge.
 *
 * Both paths use a stubbed engine version + manifest reader so the
 * test does not depend on the real package.json or filesystem.
 */

import { describe, expect, it } from 'vitest';

import { detectStaleManifest, staleManifestError } from './stale-manifest.js';

const STUB_ENGINE = '1.27.0';
const stubResolve = () => STUB_ENGINE;

function makeReader(manifest: object | string | null): (manifestPath: string) => string | null {
  if (manifest === null) return () => null;
  if (typeof manifest === 'string') return () => manifest;
  return () => JSON.stringify(manifest);
}

describe('detectStaleManifest', () => {
  it('returns null when cohort major.minor matches the engine (happy path)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader({ version: 1, cohort: '1.27.0', packs: [] }),
    });
    expect(result).toBeNull();
  });

  it('tolerates patch drift (1.27.0 manifest vs 1.27.5 engine)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: () => '1.27.5',
      readManifest: makeReader({ version: 1, cohort: '1.27.0', packs: [] }),
    });
    expect(result).toBeNull();
  });

  it('flags minor bump (1.26.x → 1.27.x)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader({ version: 1, cohort: '1.26.5', packs: [] }),
    });
    expect(result).toEqual({
      reason: 'cohort-mismatch',
      manifestCohort: '1.26.5',
      engineVersion: STUB_ENGINE,
    });
  });

  it('flags major bump (1.x → 2.x)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: () => '2.0.0',
      readManifest: makeReader({ version: 1, cohort: '1.27.0', packs: [] }),
    });
    expect(result).toEqual({
      reason: 'cohort-mismatch',
      manifestCohort: '1.27.0',
      engineVersion: '2.0.0',
    });
  });

  it('flags missing manifest (ENOENT path)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader(null),
    });
    expect(result).toEqual({ reason: 'no-manifest', engineVersion: STUB_ENGINE });
  });

  it('flags pre-1.27.0 manifest without cohort field', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader({ version: 1, packs: [] }),
    });
    expect(result).toEqual({ reason: 'no-cohort', engineVersion: STUB_ENGINE });
  });

  it('flags malformed cohort (not semver) as no-cohort with the malformed value preserved', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader({ version: 1, cohort: 'not-a-semver', packs: [] }),
    });
    expect(result).toEqual({
      reason: 'no-cohort',
      manifestCohort: 'not-a-semver',
      engineVersion: STUB_ENGINE,
    });
  });

  it('treats unparseable JSON as no-manifest (defensive fallback)', () => {
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: () => '{ not valid json',
    });
    expect(result).toEqual({ reason: 'no-manifest', engineVersion: STUB_ENGINE });
  });

  it('treats schema-invalid manifest as no-manifest (defensive fallback)', () => {
    // Wrong type for `version` → fails schema, treated as missing.
    const result = detectStaleManifest({
      workingDirectory: '/fake',
      resolveVersion: stubResolve,
      readManifest: makeReader({ version: '1', packs: [] }),
    });
    expect(result).toEqual({ reason: 'no-manifest', engineVersion: STUB_ENGINE });
  });
});

describe('staleManifestError', () => {
  it('wraps every detection class in a STALE_MANIFEST TotemError pointing at --packs-only', () => {
    const detection = {
      reason: 'cohort-mismatch' as const,
      manifestCohort: '1.26.0',
      engineVersion: '1.27.0',
    };
    const err = staleManifestError(detection, {
      file: 'src/main.rs',
      extension: '.rs',
      ruleHash: 'abc123',
    });
    expect(err.code).toBe('STALE_MANIFEST');
    expect(err.message).toMatch(/1\.26\.0/);
    expect(err.message).toMatch(/1\.27\.0/);
    expect(err.message).toMatch(/main\.rs/);
    expect(err.recoveryHint).toMatch(/--packs-only/);
  });

  it('reports no-manifest cleanly when cohort is absent from the message', () => {
    const detection = { reason: 'no-manifest' as const, engineVersion: '1.27.0' };
    const err = staleManifestError(detection, {
      file: 'lib.rs',
      extension: '.rs',
      ruleHash: 'def456',
    });
    expect(err.message).toMatch(/missing or unreadable/);
    expect(err.message).toMatch(/def456/);
  });

  it('reports no-cohort with the pre-1.27.0 framing', () => {
    const detection = { reason: 'no-cohort' as const, engineVersion: '1.27.0' };
    const err = staleManifestError(detection, {
      file: 'a.rs',
      extension: '.rs',
      ruleHash: 'xyz789',
    });
    expect(err.message).toMatch(/pre-1\.27\.0/);
  });
});

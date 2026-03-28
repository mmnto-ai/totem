import { describe, expect, it } from 'vitest';

import { inferNextMilestone } from '../milestone-inference.js';

describe('inferNextMilestone', () => {
  it('bumps minor version: 1.6.0 → 1.7.0', () => {
    expect(inferNextMilestone('1.6.0')).toBe('1.7.0');
  });

  it('preserves v prefix: v1.6.0 → v1.7.0', () => {
    expect(inferNextMilestone('v1.6.0')).toBe('v1.7.0');
  });

  it('strips title suffix: 1.6.0 — Pipeline Maturity → 1.7.0', () => {
    expect(inferNextMilestone('1.6.0 — Pipeline Maturity')).toBe('1.7.0');
  });

  it('bumps major milestone: v2.0.0 → v2.1.0', () => {
    expect(inferNextMilestone('v2.0.0')).toBe('v2.1.0');
  });

  it('bumps from 0.0.1 → 0.1.0', () => {
    expect(inferNextMilestone('0.0.1')).toBe('0.1.0');
  });

  it('returns undefined for non-semver string: Sprint 4', () => {
    expect(inferNextMilestone('Sprint 4')).toBeUndefined();
  });

  it('returns undefined for non-semver string: MVP', () => {
    expect(inferNextMilestone('MVP')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(inferNextMilestone(undefined)).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(inferNextMilestone(null)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(inferNextMilestone('')).toBeUndefined();
  });
});

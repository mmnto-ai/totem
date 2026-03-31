import { describe, expect, it } from 'vitest';

import { formatSharedHelpers, getSharedHelpers } from './helpers.js';

describe('getSharedHelpers', () => {
  it('returns a non-empty array of helpers', () => {
    const helpers = getSharedHelpers();
    expect(helpers.length).toBeGreaterThan(0);
  });

  it('every helper has required fields', () => {
    const helpers = getSharedHelpers();
    for (const h of helpers) {
      expect(h.name).toBeTruthy();
      expect(h.module).toBeTruthy();
      expect(h.signature).toBeTruthy();
      expect(h.description).toBeTruthy();
      expect(h.useInstead).toBeTruthy();
    }
  });
});

describe('formatSharedHelpers', () => {
  it('formats helpers as markdown', () => {
    const helpers = getSharedHelpers();
    const result = formatSharedHelpers(helpers);
    expect(result).toContain('SHARED HELPERS');
    expect(result).toContain('**safeExec**');
    expect(result).toContain('Import:');
    expect(result).toContain('Signature:');
    expect(result).toContain('Instead of:');
  });

  it('returns empty string for empty array', () => {
    expect(formatSharedHelpers([])).toBe('');
  });
});

import { describe, expect, it } from 'vitest';

import {
  COMPILED_BASELINE_RULES,
  COMPILED_GO_BASELINE,
  COMPILED_PYTHON_BASELINE,
  COMPILED_RUST_BASELINE,
} from './compiled-baseline.js';

// ─── Helpers ────────────────────────────────────────

const ALL_ARRAYS = [
  { name: 'COMPILED_BASELINE_RULES', rules: COMPILED_BASELINE_RULES },
  { name: 'COMPILED_PYTHON_BASELINE', rules: COMPILED_PYTHON_BASELINE },
  { name: 'COMPILED_RUST_BASELINE', rules: COMPILED_RUST_BASELINE },
  { name: 'COMPILED_GO_BASELINE', rules: COMPILED_GO_BASELINE },
];

const ALL_RULES = ALL_ARRAYS.flatMap((a) => a.rules);

// ─── Tests ──────────────────────────────────────────

describe('compiled-baseline ecosystem arrays', () => {
  it.each(ALL_ARRAYS)('$name is non-empty', ({ rules }) => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(ALL_ARRAYS)('$name — every rule has required fields', ({ rules }) => {
    for (const rule of rules) {
      expect(rule.lessonHash).toBeTruthy();
      expect(rule.lessonHeading).toBeTruthy();
      expect(rule.engine).toBeTruthy();
      expect(rule.message).toBeTruthy();
      expect(rule.compiledAt).toBeTruthy();
      expect(rule.severity).toMatch(/^(error|warning)$/);
    }
  });

  it('no hash collisions across all arrays', () => {
    const hashes = ALL_RULES.map((r) => r.lessonHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  it('Python rules use .py file globs', () => {
    for (const rule of COMPILED_PYTHON_BASELINE) {
      const globs = rule.fileGlobs ?? [];
      const positive = globs.filter((g) => !g.startsWith('!'));
      expect(positive.some((g) => g.includes('.py'))).toBe(true);
    }
  });

  it('Rust rules use .rs file globs', () => {
    for (const rule of COMPILED_RUST_BASELINE) {
      const globs = rule.fileGlobs ?? [];
      const positive = globs.filter((g) => !g.startsWith('!'));
      expect(positive.some((g) => g.includes('.rs'))).toBe(true);
    }
  });

  it('Go rules use .go file globs', () => {
    for (const rule of COMPILED_GO_BASELINE) {
      const globs = rule.fileGlobs ?? [];
      const positive = globs.filter((g) => !g.startsWith('!'));
      expect(positive.some((g) => g.includes('.go'))).toBe(true);
    }
  });
});

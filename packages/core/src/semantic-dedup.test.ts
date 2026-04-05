import { describe, expect, it } from 'vitest';

import { deduplicateByHeading, normalizeHeading } from './semantic-dedup.js';

describe('normalizeHeading', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeHeading('  Pin  Bun  Versions  in  CI ')).toBe('pin bun versions in ci');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeHeading('')).toBe('');
  });
});

describe('deduplicateByHeading', () => {
  it('drops exact heading duplicates (keeps first)', () => {
    const candidates = [
      {
        tags: ['a'],
        text: 'Pin Bun to a specific version for CI stability.',
        heading: 'Pin Bun versions in CI',
      },
      {
        tags: ['b'],
        text: 'Always pin Bun versions in CI to avoid drift.',
        heading: 'Pin Bun versions in CI',
      },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(1);
    expect(unique[0]!.text).toBe('Pin Bun to a specific version for CI stability.');
    expect(headingDupes).toHaveLength(1);
    expect(headingDupes[0]!.text).toBe('Always pin Bun versions in CI to avoid drift.');
  });

  it('treats case-different headings as duplicates', () => {
    const candidates = [
      { tags: ['a'], text: 'First lesson.', heading: 'Export Types in WASM Shims' },
      { tags: ['b'], text: 'Second lesson.', heading: 'export types in wasm shims' },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(1);
    expect(headingDupes).toHaveLength(1);
  });

  it('keeps lessons with distinct headings', () => {
    const candidates = [
      { tags: ['a'], text: 'Lesson about error handling.', heading: 'Handle ENOENT errors' },
      { tags: ['b'], text: 'Lesson about git hooks.', heading: 'Pre-push hook best practices' },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(2);
    expect(headingDupes).toHaveLength(0);
  });

  it('keeps lessons without headings (no false drops)', () => {
    const candidates = [
      { tags: ['a'], text: 'First headingless lesson.' },
      { tags: ['b'], text: 'Second headingless lesson.' },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(2);
    expect(headingDupes).toHaveLength(0);
  });

  it('handles triple duplicates (keeps only first)', () => {
    const candidates = [
      { tags: ['a'], text: 'Version A.', heading: 'Use byte-level binary size checks' },
      { tags: ['b'], text: 'Version B.', heading: 'Use byte-level binary size checks' },
      { tags: ['c'], text: 'Version C.', heading: 'Use byte-level binary size checks' },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(1);
    expect(headingDupes).toHaveLength(2);
  });

  it('treats whitespace-only headings as headingless (not deduplicated)', () => {
    const candidates = [
      { tags: ['a'], text: 'First lesson.', heading: '   ' },
      { tags: ['b'], text: 'Second lesson.', heading: '\t\n' },
    ];

    const { unique, headingDupes } = deduplicateByHeading(candidates);
    expect(unique).toHaveLength(2);
    expect(headingDupes).toHaveLength(0);
  });

  it('returns empty arrays for empty input', () => {
    const { unique, headingDupes } = deduplicateByHeading([]);
    expect(unique).toHaveLength(0);
    expect(headingDupes).toHaveLength(0);
  });
});

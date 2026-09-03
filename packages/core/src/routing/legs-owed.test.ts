/**
 * `legs-owed` predicate tests (mmnto-ai/totem#2698).
 *
 * The design's invariant for this module: it is PURE, its basis lists every
 * `glob → file` match, and the seam exports a verdict plus its basis and
 * nothing gate-shaped. These lock that, plus the behaviour of the ruled
 * default floor (OQ4) against the paths the gate will actually meet.
 */

import { describe, expect, it } from 'vitest';

import { classifyLegsOwed, DEFAULT_LEGS_OWED_GLOBS } from './legs-owed.js';

const DEFAULTS = [...DEFAULT_LEGS_OWED_GLOBS];

describe('DEFAULT_LEGS_OWED_GLOBS — the ruled floor', () => {
  it('is the doctrine floor plus the public-copy surfaces plus .changeset/**', () => {
    expect(DEFAULTS).toEqual([
      'doctrine/**',
      'design-tenets.md',
      'adr/**',
      'proposals/**',
      'README.md',
      'docs/wiki/**',
      '.changeset/**',
    ]);
  });

  it('owes a leg for a changeset and for a wiki page', () => {
    expect(classifyLegsOwed(['.changeset/brave-pandas-shout.md'], DEFAULTS)).toEqual({
      owed: true,
      basis: [{ glob: '.changeset/**', file: '.changeset/brave-pandas-shout.md' }],
    });
    expect(classifyLegsOwed(['docs/wiki/a.md'], DEFAULTS)).toEqual({
      owed: true,
      basis: [{ glob: 'docs/wiki/**', file: 'docs/wiki/a.md' }],
    });
  });

  it('does NOT owe a leg for ordinary source', () => {
    expect(classifyLegsOwed(['packages/core/src/x.ts'], DEFAULTS)).toEqual({
      owed: false,
      basis: [],
    });
  });

  it('owes a leg for the doctrine and ADR surfaces', () => {
    const verdict = classifyLegsOwed(
      ['doctrine/model-tiering.md', 'adr/adr-038-agents-md-standard.md', 'design-tenets.md'],
      DEFAULTS,
    );
    expect(verdict.owed).toBe(true);
    expect(verdict.basis.map((b) => b.glob)).toEqual(['doctrine/**', 'adr/**', 'design-tenets.md']);
  });

  it('DISCLOSURE: a bare pattern matches by BASENAME anywhere, per the mandated matcher', () => {
    // `matchesGlob`'s rule-engine profile sets `barePatternMatchesBasename`, so
    // the floor's two bare entries are basename rules, not root-anchored paths:
    // EVERY README.md in a monorepo is owed, not just the root one. That is the
    // shipped dialect `ignorePatterns` already uses — the design's "the matcher
    // is the one `ignorePatterns` already uses" — so it is pinned here rather
    // than worked around. The profile offers NO root-only spelling: a `./`
    // prefix is anchored literally and changed paths are never `./`-prefixed,
    // so `./README.md` matches nothing (the falsification leg's F8 — a repo
    // following that remedy would silently retire the entry). A repo that
    // wants the root file only declares a NEGATIVE for its nested trees.
    for (const file of ['docs/README.md', 'packages/cli/README.md', 'sub/design-tenets.md']) {
      expect(classifyLegsOwed([file], DEFAULTS).owed, file).toBe(true);
    }
    expect(classifyLegsOwed(['README.md'], ['./README.md']).owed).toBe(false);
    const rootOnly = ['README.md', '!packages/**', '!docs/**'];
    expect(classifyLegsOwed(['README.md'], rootOnly).owed).toBe(true);
    expect(classifyLegsOwed(['packages/cli/README.md'], rootOnly).owed).toBe(false);
    expect(classifyLegsOwed(['docs/README.md'], rootOnly).owed).toBe(false);
    // Same profile, same consequence on the other side: `.changeset/**` covers
    // the tool's own config file, not only the release notes under it.
    expect(classifyLegsOwed(['.changeset/config.json'], DEFAULTS).owed).toBe(true);
    // A bare directory NAME is not a match — only files under it are.
    expect(classifyLegsOwed(['doctrine'], DEFAULTS).owed).toBe(false);
  });
});

describe('classifyLegsOwed — verdict plus basis', () => {
  it('is not owed for an empty changed-file set', () => {
    expect(classifyLegsOwed([], DEFAULTS)).toEqual({ owed: false, basis: [] });
  });

  it('is not owed when no glob is configured as a positive', () => {
    expect(classifyLegsOwed(['doctrine/x.md'], ['!doctrine/**'])).toEqual({
      owed: false,
      basis: [],
    });
    expect(classifyLegsOwed(['doctrine/x.md'], [])).toEqual({ owed: false, basis: [] });
  });

  it('lists EVERY (glob, file) match — files outer, globs inner, in input order', () => {
    const verdict = classifyLegsOwed(
      ['doctrine/a.md', 'src/x.ts', 'doctrine/b.md'],
      ['doctrine/**', 'doctrine/a.md', 'adr/**'],
    );
    expect(verdict).toEqual({
      owed: true,
      basis: [
        { glob: 'doctrine/**', file: 'doctrine/a.md' },
        { glob: 'doctrine/a.md', file: 'doctrine/a.md' },
        { glob: 'doctrine/**', file: 'doctrine/b.md' },
      ],
    });
  });

  it('honours a negative: a file matching any `!` glob is never owed', () => {
    expect(
      classifyLegsOwed(['doctrine/generated/index.md'], ['doctrine/**', '!doctrine/generated/**']),
    ).toEqual({ owed: false, basis: [] });
  });

  it('a negative removes only the files it matches, never the whole verdict', () => {
    const verdict = classifyLegsOwed(
      ['doctrine/generated/index.md', 'doctrine/model-tiering.md'],
      ['doctrine/**', '!doctrine/generated/**'],
    );
    expect(verdict).toEqual({
      owed: true,
      basis: [{ glob: 'doctrine/**', file: 'doctrine/model-tiering.md' }],
    });
  });

  it('is pure — repeated calls agree and the inputs are untouched', () => {
    const files = Object.freeze(['doctrine/a.md', 'src/x.ts']);
    const globs = Object.freeze([...DEFAULTS]);
    const first = classifyLegsOwed(files, globs);
    const second = classifyLegsOwed(files, globs);
    expect(first).toEqual(second);
    expect([...files]).toEqual(['doctrine/a.md', 'src/x.ts']);
    expect([...globs]).toEqual(DEFAULTS);
  });

  it('owed is true iff the basis is non-empty', () => {
    for (const files of [[], ['src/x.ts'], ['doctrine/a.md'], ['adr/a.md', 'src/x.ts']]) {
      const verdict = classifyLegsOwed(files, DEFAULTS);
      expect(verdict.owed, JSON.stringify(files)).toBe(verdict.basis.length > 0);
    }
  });
});

import { describe, expect, it } from 'vitest';

import {
  AUTO_CLOSE_KEYWORDS,
  AUTO_CLOSE_REGEX_SOURCE,
  autoCloseKeyForms,
  findAutoCloseRefs,
} from './matcher.js';

/** Verbatim body of commit b8aa74a2 on main — the real #2471→#2466 specimen. */
const B8AA74A2_BODY =
  'fix(review): deterministic skip paths no longer stamp the push gate (#2466) (#2471)\n' +
  '\n' +
  'Three deterministic skip paths (all-generated, all-non-code, filtered-empty) no longer ' +
  'mint the reviewed-content stamp; they log a shared NON-REVIEW notice instead. Adds coverage ' +
  'for the .gitattributes-marked .ts bypass and the filtered-empty path. ' +
  'Does not close #2466 (live exit-0 half deferred to #2473).';

const refs = (t: string) => findAutoCloseRefs(t).map((m) => m.ref);

describe('AUTO_CLOSE_REGEX_SOURCE / findAutoCloseRefs', () => {
  it('exports the nine GitHub close keywords', () => {
    expect([...AUTO_CLOSE_KEYWORDS].sort()).toEqual(
      [
        'close',
        'closed',
        'closes',
        'fix',
        'fixed',
        'fixes',
        'resolve',
        'resolved',
        'resolves',
      ].sort(),
    );
  });

  it('compiles to a valid regex', () => {
    expect(() => new RegExp(AUTO_CLOSE_REGEX_SOURCE, 'gi')).not.toThrow();
  });

  // ─── presence invariant: negated / emphasized / quoted all match ──────────

  it('matches under NEGATION (the confirmed #2471 specimen)', () => {
    expect(refs('Does not close #2466')).toEqual(['#2466']);
  });

  it('matches inside EMPHASIS', () => {
    expect(refs('**Fixes #700**')).toEqual(['#700']);
  });

  it('matches inside a block QUOTE', () => {
    expect(refs('> quoted: closes #12')).toEqual(['#12']);
  });

  it('matches a QUALIFIED cross-repo ref (still auto-closes)', () => {
    expect(refs('This resolves mmnto-ai/totem#2466 upstream')).toEqual(['mmnto-ai/totem#2466']);
  });

  it('matches MULTIPLE refs including a colon separator', () => {
    expect(refs('Fixes: #55 and also Resolved #56')).toEqual(['#55', '#56']);
  });

  it('matches every keyword inflection', () => {
    for (const kw of AUTO_CLOSE_KEYWORDS) {
      expect(refs(`${kw} #1`)).toEqual(['#1']);
      expect(refs(`${kw.toUpperCase()} #2`)).toEqual(['#2']);
    }
  });

  it('preserves the keyword casing and records a match index', () => {
    const [m] = findAutoCloseRefs('xx Closes #9');
    expect(m?.keyword).toBe('Closes');
    expect(m?.issue).toBe(9);
    expect(m?.index).toBe(3);
  });

  // ─── non-matches ──────────────────────────────────────────────────────────

  it('does NOT match subject-line parentheticals (no adjacent keyword)', () => {
    expect(refs('fix(review): stamp the push gate (#2466) (#2471)')).toEqual([]);
  });

  it('does NOT match keyword substrings (prefix / affixes / fixup)', () => {
    expect(refs('prefix #99, affixes #98, fixup #97')).toEqual([]);
  });

  it('does NOT match with no separator (closed#88 — GitHub declines it too)', () => {
    expect(refs('closed#88')).toEqual([]);
  });

  it('does NOT match a bare ref with no keyword', () => {
    expect(refs('See #247 above')).toEqual([]);
  });

  it('returns [] for empty / non-string input', () => {
    expect(findAutoCloseRefs('')).toEqual([]);
    expect(findAutoCloseRefs(undefined as unknown as string)).toEqual([]);
  });

  // ─── the b8aa74a2 positive control ────────────────────────────────────────

  it('finds exactly #2466 in the verbatim b8aa74a2 body (and NOT the parentheticals)', () => {
    expect(refs(B8AA74A2_BODY)).toEqual(['#2466']);
  });
});

describe('autoCloseKeyForms', () => {
  it('expands a bare ref to include the self-repo qualified form', () => {
    expect(autoCloseKeyForms({ issue: 2466 }, 'mmnto-ai/totem').sort()).toEqual(
      ['#2466', 'mmnto-ai/totem#2466'].sort(),
    );
  });

  it('expands a self-qualified ref to include the bare form', () => {
    expect(
      autoCloseKeyForms({ qualifier: 'mmnto-ai/totem', issue: 2466 }, 'mmnto-ai/totem').sort(),
    ).toEqual(['#2466', 'mmnto-ai/totem#2466'].sort());
  });

  it('keeps a cross-repo qualified ref distinct from the bare form', () => {
    expect(autoCloseKeyForms({ qualifier: 'mmnto-ai/other', issue: 5 }, 'mmnto-ai/totem')).toEqual([
      'mmnto-ai/other#5',
    ]);
  });
});

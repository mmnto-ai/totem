// ─── The regex-expressibility classifier, single-homed ───────────────────────
//
// Lifted OUT of `src/census.mts` VERBATIM (bodies unchanged, comments carried) so
// that `src/lower.mts` can apply the SAME gate the census measured with, without
// importing a module whose top level runs a 22-check census as a side effect.
//
// Single-homing is the point: LOWERING.md § Lowering 4 says "only census classes
// `re2-clean` and `word-boundary` lower". If the lowerer carried its own copy of
// the scanner, "the census classes" and "the classes the lowerer gates on" would
// be two statements of the same thing, free to drift. `census.mts` re-exports
// these, so there is exactly one definition.

export type ExpressibilityClass = 're2-clean' | 'word-boundary' | 'lookaround' | 'backreference';

export interface ScanResult {
  wordBoundary: number;
  lookahead: number;
  negativeLookahead: number;
  lookbehind: number;
  negativeLookbehind: number;
  backreference: number;
}

/**
 * ESCAPE-AWARE scan. A naive `includes('\\b')` cannot tell `\b` (word boundary)
 * from `\\b` (a literal backslash followed by `b`) or from `[\b]` (backspace
 * inside a character class), and cannot tell `\1` (backreference) from `[\1]`
 * (an octal escape). Both distinctions change the RE2 verdict, so the scan walks
 * the pattern rather than substring-testing it. The naive counts are computed
 * separately and DIFFED in the artifact — a divergence is itself a finding.
 */
export function scanPattern(pattern: string): ScanResult {
  const out: ScanResult = {
    wordBoundary: 0,
    lookahead: 0,
    negativeLookahead: 0,
    lookbehind: 0,
    negativeLookbehind: 0,
    backreference: 0,
  };
  let i = 0;
  let inClass = false;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next === undefined) break; // trailing lone backslash — malformed, nothing to classify
      if (!inClass && next === 'b') out.wordBoundary += 1;
      if (!inClass && next >= '1' && next <= '9') out.backreference += 1;
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      i += 1;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      i += 1;
      // JS/RE2: a `]` immediately after `[` or `[^` is a literal member, not a close.
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2);
      if (rest.startsWith('=')) out.lookahead += 1;
      else if (rest.startsWith('!')) out.negativeLookahead += 1;
      else if (rest.startsWith('<=')) out.lookbehind += 1;
      else if (rest.startsWith('<!')) out.negativeLookbehind += 1;
      // `(?<name>` is a NAMED GROUP, not a lookbehind — deliberately unmatched here.
    }
    i += 1;
  }
  return out;
}

/** The literal-substring reading of the dispatch's wording, kept only as a differential. */
export function naiveScan(pattern: string): ScanResult {
  const count = (needle: string) => pattern.split(needle).length - 1;
  return {
    wordBoundary: count('\\b'),
    lookahead: count('(?='),
    negativeLookahead: count('(?!'),
    lookbehind: count('(?<='),
    negativeLookbehind: count('(?<!'),
    backreference: [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce((n, d) => n + count(`\\${d}`), 0),
  };
}

export function classify(scan: ScanResult): ExpressibilityClass {
  if (scan.backreference > 0) return 'backreference';
  const looks = scan.lookahead + scan.negativeLookahead + scan.lookbehind + scan.negativeLookbehind;
  if (looks > 0) return 'lookaround';
  if (scan.wordBoundary > 0) return 'word-boundary';
  return 're2-clean';
}

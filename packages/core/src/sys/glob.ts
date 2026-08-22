// ─── Bounded glob dialects ──────────────────────────────────────────────────

type OptionalSyntax = 'brace-alternation' | 'question';
type StarActivation = 'all' | 'rule-engine-forms';
type GlobstarOverride = 'elide' | 'remainder';
type StarOverride = 'cross-segment';

interface GlobCache {
  get(glob: string): RegExp | undefined;
  set(glob: string, expression: RegExp): void;
}

interface GlobProfileOptions {
  normalizePatternSeparators: boolean;
  barePatternMatchesBasename: boolean;
  optionalSyntax: ReadonlySet<OptionalSyntax>;
  starActivation: StarActivation;
  crossSegmentWildcard: string;
  cache?: GlobCache;
}

type GlobToken =
  | { kind: 'alternation'; alternatives: readonly string[] }
  | { kind: 'globstar' }
  | { kind: 'globstar-segments' }
  | { kind: 'literal'; value: string }
  | { kind: 'never' }
  | { kind: 'question' }
  | { kind: 'star' };

interface StarSyntaxPlan {
  active: Set<number>;
  globstarOverrides: Map<number, GlobstarOverride>;
  starOverrides: Map<number, StarOverride>;
  neverMatch: boolean;
}

const RULE_ENGINE_CACHE_CAPACITY = 512;
const NO_OPTIONAL_SYNTAX = new Set<OptionalSyntax>();
const CLASSIFIER_OPTIONAL_SYNTAX = new Set<OptionalSyntax>(['brace-alternation', 'question']);
const classifierCache = new Map<string, RegExp>();

/**
 * LRU-bounded `string → RegExp` cache. Nothing about it is glob-specific — the
 * key is any source string and the value its compiled expression — so it is
 * exported for the other compile-once-evaluate-many sites in the engine (Prop
 * 310's `requires.pattern`, `spine/record-runtime.ts`). Reusing this rather than
 * a bare `Map` keeps the shipped idiom AND the bound: an unbounded map keyed by
 * rule content grows with every distinct pattern the process ever sees.
 */
export class BoundedRegexCache implements GlobCache {
  private readonly entries = new Map<string, RegExp>();

  constructor(private readonly capacity: number) {}

  get(glob: string): RegExp | undefined {
    const expression = this.entries.get(glob);
    if (expression) {
      this.entries.delete(glob);
      this.entries.set(glob, expression);
    }
    return expression;
  }

  set(glob: string, expression: RegExp): void {
    this.entries.delete(glob);
    if (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(glob, expression);
  }
}

const ruleEngineCache = new BoundedRegexCache(RULE_ENGINE_CACHE_CAPACITY);

const RULE_ENGINE_PROFILE: GlobProfileOptions = Object.freeze({
  normalizePatternSeparators: false,
  barePatternMatchesBasename: true,
  optionalSyntax: NO_OPTIONAL_SYNTAX,
  starActivation: 'rule-engine-forms',
  crossSegmentWildcard: '[\\s\\S]*',
  cache: ruleEngineCache,
});

const PATH_CLASSIFIER_PROFILE: GlobProfileOptions = Object.freeze({
  normalizePatternSeparators: true,
  barePatternMatchesBasename: false,
  optionalSyntax: CLASSIFIER_OPTIONAL_SYNTAX,
  starActivation: 'all',
  crossSegmentWildcard: '.*',
  cache: classifierCache,
});

/**
 * Prop 310 § Design 7 — the NORMATIVE record-grammar dialect, as a third profile
 * over the same tokenizer rather than a second matcher (the file's own design:
 * "profiles are option records over this one tokenizer and compiler"; a parallel
 * implementation would be Tenet 20's prohibited mirror of glob semantics).
 *
 * Each option below IS a spec clause, not a preference:
 *   - `barePatternMatchesBasename: false` — § Design 7 "No silent promotion": a
 *     glob means what it says, so `*.ts` is ROOT-LEVEL and tree-wide is written
 *     `**\/*.ts`. The rule-engine profile's basename prefix is exactly the
 *     promotion the grammar kills.
 *   - `starActivation: 'all'` — every `*` is a wildcard. The rule-engine profile's
 *     bounded legacy shapes silently demote unrecognized stars to LITERALS; the
 *     record dialect admits `*` and `**` and nothing else, so there is no
 *     unrecognized shape to demote.
 *   - `optionalSyntax` empty — braces are OUT of the dialect (§ Design 7's brace
 *     ruling) and `?` is banned regex syntax. Both are already parse errors, so
 *     this is defence in depth against a hand-edited manifest.
 *   - `crossSegmentWildcard: '.*'` — a TRAILING `**` (`packages/**`) matches the
 *     whole subtree. A `**\/` SEGMENT compiles to `(?:[^/]+/)*` via the shared
 *     `globstar-segments` token, so `**\/*.ts` is tree-wide INCLUDING the root.
 *   - `normalizePatternSeparators: false` — record globs are `/`-only (a backslash
 *     is a parse error), so there is nothing to normalize on the PATTERN side.
 *     The PATH side is normalized by `matchGlob` for every profile, which is
 *     § Design 7's "matchers normalize host separators before evaluation".
 *
 * Matching is case-SENSITIVE (no `i` flag anywhere in this file) against
 * repo-relative path names, per § Design 7's Windows-semantics paragraph.
 *
 * Its own cache instance is mandatory: the caches are keyed by glob STRING only,
 * so sharing one with another profile would serve a `*.ts` regex compiled under
 * the opposite promotion rule.
 */
const RECORD_DIALECT_PROFILE: GlobProfileOptions = Object.freeze({
  normalizePatternSeparators: false,
  barePatternMatchesBasename: false,
  optionalSyntax: NO_OPTIONAL_SYNTAX,
  starActivation: 'all',
  crossSegmentWildcard: '.*',
  cache: new BoundedRegexCache(RULE_ENGINE_CACHE_CAPACITY),
});

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mark the wildcard positions recognized by the historical rule-engine
 * dialect. This is a syntax pass only: both profiles still use the same token
 * compiler and matching loop below. The forms mirror the bounded legacy
 * grammar (leading and middle globstar segments, recursive directory tails,
 * extension stars, and directory extension stars); every other star remains a
 * literal.
 */
function collectRuleEngineStarIndexes(pattern: string): StarSyntaxPlan {
  const active = new Set<number>();
  const globstarOverrides = new Map<number, GlobstarOverride>();
  const starOverrides = new Map<number, StarOverride>();
  let neverMatch = false;
  let offset = 0;

  while (offset < pattern.length) {
    const remaining = pattern.slice(offset);

    // Legacy extension shape: `*.`.
    if (remaining.startsWith('*.')) {
      active.add(offset);
      starOverrides.set(offset, 'cross-segment');
      if (remaining.endsWith('.*')) {
        if (remaining.slice(1, -1).includes('/')) {
          neverMatch = true;
        } else {
          active.add(pattern.length - 1);
        }
      }
      return { active, globstarOverrides, starOverrides, neverMatch };
    }

    // Legacy leading globstar shape: `**/`.
    if (remaining.startsWith('**/')) {
      active.add(offset);
      active.add(offset + 1);
      offset += 3;
      continue;
    }

    // Legacy middle globstar shape: `/**/`.
    const recursiveIndex = remaining.indexOf('/**/');
    if (recursiveIndex > 0) {
      const globstarIndex = offset + recursiveIndex + 1;
      const suffix = remaining.slice(recursiveIndex + 4);
      if (suffix.length === 0) {
        globstarOverrides.set(globstarIndex, 'remainder');
      } else if (!suffix.includes('/') || suffix.startsWith('*.') || suffix.startsWith('**/')) {
        active.add(globstarIndex);
        active.add(globstarIndex + 1);
      } else {
        globstarOverrides.set(globstarIndex, 'elide');
      }
      offset = globstarIndex + 3;
      continue;
    }

    // Legacy recursive tail shape: `/**`.
    if (remaining.endsWith('/**')) {
      active.add(pattern.length - 2);
      active.add(pattern.length - 1);
      return { active, globstarOverrides, starOverrides, neverMatch };
    }

    // Legacy directory-extension shape: `/*.`.
    const singleStarIndex = remaining.indexOf('/*.');
    if (singleStarIndex > 0 && !remaining.includes('**')) {
      active.add(offset + singleStarIndex + 1);
      const suffix = remaining.slice(singleStarIndex + 2);
      if (suffix.includes('/')) {
        neverMatch = true;
      } else if (remaining.endsWith('.*')) {
        active.add(pattern.length - 1);
      }
    }
    return { active, globstarOverrides, starOverrides, neverMatch };
  }

  return { active, globstarOverrides, starOverrides, neverMatch };
}

function collectActiveStarIndexes(pattern: string, profile: GlobProfileOptions): StarSyntaxPlan {
  if (profile.starActivation === 'rule-engine-forms') {
    return collectRuleEngineStarIndexes(pattern);
  }

  const active = new Set<number>();
  for (let index = 0; index < pattern.length; index++) {
    if (pattern[index] === '*') active.add(index);
  }
  return {
    active,
    globstarOverrides: new Map(),
    starOverrides: new Map(),
    neverMatch: false,
  };
}

function tokenizeGlob(pattern: string, profile: GlobProfileOptions): GlobToken[] {
  const starPlan = collectActiveStarIndexes(pattern, profile);
  if (starPlan.neverMatch) return [{ kind: 'never' }];

  const tokens: GlobToken[] = [];
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index]!;

    const globstarOverride = starPlan.globstarOverrides.get(index);
    if (globstarOverride === 'elide') {
      index += 3;
      continue;
    }
    if (globstarOverride === 'remainder') {
      tokens.push({ kind: 'globstar' });
      index += 3;
      continue;
    }

    if (character === '*' && starPlan.active.has(index)) {
      if (pattern[index + 1] === '*' && starPlan.active.has(index + 1)) {
        if (pattern[index + 2] === '/') {
          tokens.push({ kind: 'globstar-segments' });
          index += 3;
        } else {
          tokens.push({ kind: 'globstar' });
          index += 2;
        }
      } else {
        tokens.push(
          starPlan.starOverrides.get(index) === 'cross-segment'
            ? { kind: 'globstar' }
            : { kind: 'star' },
        );
        index += 1;
      }
      continue;
    }

    if (character === '?' && profile.optionalSyntax.has('question')) {
      tokens.push({ kind: 'question' });
      index += 1;
      continue;
    }

    if (character === '{' && profile.optionalSyntax.has('brace-alternation')) {
      const end = pattern.indexOf('}', index + 1);
      if (end > index) {
        tokens.push({
          kind: 'alternation',
          alternatives: pattern.slice(index + 1, end).split(','),
        });
        index = end + 1;
        continue;
      }
    }

    tokens.push({ kind: 'literal', value: character });
    index += 1;
  }

  return tokens;
}

/**
 * Compile one of Totem's two compatibility glob profiles into an anchored
 * regular expression. The profiles are option records over this one tokenizer
 * and compiler: the rule engine keeps its deliberately muted wildcard forms,
 * while the path classifier keeps its anchored `*`, `?`, brace, `**`, and
 * separator-normalization behavior.
 *
 * This bounded dialect intentionally has no glob dependency. Re-evaluate
 * picomatch only if the consolidated dialect's needs grow toward a full engine.
 */
function compileGlob(glob: string, profile: GlobProfileOptions): RegExp {
  const pattern = profile.normalizePatternSeparators ? glob.replace(/\\/g, '/') : glob;
  const tokens = tokenizeGlob(pattern, profile);
  let source = '';

  for (const token of tokens) {
    switch (token.kind) {
      case 'alternation':
        source += `(?:${token.alternatives.map(escapeRegexLiteral).join('|')})`;
        break;
      case 'globstar':
        source += profile.crossSegmentWildcard;
        break;
      case 'globstar-segments':
        source += '(?:[^/]+/)*';
        break;
      case 'literal':
        source += escapeRegexLiteral(token.value);
        break;
      case 'never':
        source += '(?!)';
        break;
      case 'question':
        source += '[^/]';
        break;
      case 'star':
        source += '[^/]*';
        break;
    }
  }

  const basenamePrefix =
    profile.barePatternMatchesBasename && !pattern.includes('/')
      ? `(?:${profile.crossSegmentWildcard}\/)?`
      : '';
  return new RegExp(`^${basenamePrefix}${source}$`);
}

function matchGlob(filePath: string, glob: string, profile: GlobProfileOptions): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  let expression = profile.cache?.get(glob);
  if (!expression) {
    expression = compileGlob(glob, profile);
    profile.cache?.set(glob, expression);
  }
  return expression.test(normalizedPath);
}

/** Match a path with the public rule-engine compatibility profile. */
export function matchesGlob(filePath: string, glob: string): boolean {
  return matchGlob(filePath, glob, RULE_ENGINE_PROFILE);
}

/** Match a path with the anchored path-classifier compatibility profile. */
export function matchesPathGlob(filePath: string, glob: string): boolean {
  return matchGlob(filePath, glob, PATH_CLASSIFIER_PROFILE);
}

/**
 * Match a repo-relative path against ONE glob under the Prop 310 § Design 7
 * normative dialect. Single-glob only: the two-array scope rule
 * (`positiveMatch && !excludeMatch`) is record-grammar SEMANTICS and lives with
 * the record runtime (`spine/record-runtime.ts`), not in the dialect mechanics.
 *
 * Reachable only for rules that carry a Prop 310 compiled home; every legacy
 * rule keeps `matchesGlob`'s shipped behaviour byte-for-byte.
 */
export function matchesRecordGlob(filePath: string, glob: string): boolean {
  return matchGlob(filePath, glob, RECORD_DIALECT_PROFILE);
}

/**
 * Return true when a path matches any positive rule glob and no `!`-prefixed
 * negative glob. With no positive entries, every path is included by default.
 */
export function fileMatchesGlobs(filePath: string, globs: readonly string[]): boolean {
  const hasPositive = globs.some((glob) => !glob.startsWith('!'));
  let matchedPositive = !hasPositive;

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (matchesGlob(filePath, glob.slice(1))) return false;
    } else if (matchesGlob(filePath, glob)) {
      matchedPositive = true;
    }
  }

  return matchedPositive;
}

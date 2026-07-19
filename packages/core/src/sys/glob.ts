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

class BoundedRegexCache implements GlobCache {
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

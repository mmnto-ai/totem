import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CompiledRule,
  CompiledRulesFileSchema,
  fileMatchesGlobs,
  hashLesson,
  matchAstGrepPattern,
  readJsonSafe,
} from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const WIND_TUNNEL = path.join(__dirname, 'fixtures', 'wind-tunnel');

const manifest = readJsonSafe(path.join(PACK_ROOT, 'compiled-rules.json'), CompiledRulesFileSchema);

const RULE_BY_HASH: Record<string, CompiledRule> = Object.fromEntries(
  manifest.rules.map((rule) => [rule.lessonHash, rule]),
);

/**
 * Rule → its designated wind-tunnel bad site (logical path), plus the named
 * paths proving each negative glob actually excludes something. `deadNegative`
 * candidates are what codex's both-sides requirement rejects: a negative glob
 * no positive-matching path can ever hit silently broadens enforcement.
 */
const CASES: {
  hash: string;
  key: string;
  badSite: string;
  ext: string;
  negativeProofs: Record<string, string>;
}[] = [
  {
    hash: 'bddfbd2ec1c75eaf',
    key: 'auto-close-adjacency',
    badSite: 'docs/release-notes.md',
    ext: '.md',
    negativeProofs: { '!**/CHANGELOG.md': 'CHANGELOG.md' },
  },
  {
    hash: '028ffa125ce65b8c',
    key: 'catch-swallow',
    badSite: 'packages/svc/src/handler.ts',
    ext: '.ts',
    negativeProofs: {
      '!**/*.test.*': 'packages/svc/src/handler.test.ts',
      '!**/*.spec.*': 'packages/svc/src/handler.spec.ts',
    },
  },
  {
    hash: 'e64911592b774cc6',
    key: 'workflow-gate-masking',
    badSite: '.github/workflows/ci.yml',
    ext: '.yml',
    negativeProofs: {},
  },
  {
    hash: '49fc9ce5b1e35362',
    key: 'agent-secret-inline',
    badSite: '.claude/settings.json',
    ext: '.json',
    negativeProofs: {},
  },
  {
    hash: '7371b48e4e7ff9cf',
    key: 'competing-authority',
    badSite: 'CLAUDE.md',
    ext: '.md',
    negativeProofs: {},
  },
  {
    hash: '372539b90e1e6e87',
    key: 'permission-bypass',
    badSite: '.claude/settings.json',
    ext: '.json',
    negativeProofs: {},
  },
  {
    hash: 'f742b565a5c1a30c',
    key: 'governed-directive-provenance',
    badSite: '.totem/specs/policy.md',
    ext: '.md',
    negativeProofs: { '!**/*.test.*': '.totem/specs/policy.test.md' },
  },
  {
    hash: '67ec1598a0a8ef6a',
    key: 'dependency-disclosure',
    badSite: 'package.json',
    ext: '.json',
    negativeProofs: { '!**/node_modules/**': 'node_modules/dep/package.json' },
  },
  {
    hash: '404b8c8dabcbd1af',
    key: 'optional-dep-disclosure',
    badSite: 'package.json',
    ext: '.json',
    negativeProofs: { '!**/node_modules/**': 'node_modules/dep/package.json' },
  },
];

/** Every logical path present in the wind tunnel, both buckets. */
const WIND_TUNNEL_PATHS = [
  'docs/release-notes.md',
  'packages/svc/src/handler.ts',
  '.github/workflows/ci.yml',
  '.claude/settings.json',
  'CLAUDE.md',
  '.totem/specs/policy.md',
  'package.json',
  // Second file type for every rule whose globs span more than one
  // extension — without these, `packages/**/*.js` and
  // `.github/workflows/*.yaml` would be dead positive globs.
  'packages/svc/src/legacy.js',
  '.github/workflows/release.yaml',
  // Per-vendor agent-config surfaces. Every one of these globs names an exact
  // filename, so each vendor variant needs its own specimen or its glob is dead.
  '.gemini/settings.json',
  'GEMINI.md',
  'AGENTS.md',
];

type RuleMatch = { lineNumber: number };

function readSite(bucket: 'bad' | 'good', logical: string): string {
  return fs.readFileSync(path.join(WIND_TUNNEL, bucket, logical), 'utf-8');
}

/**
 * Mirrors the production engines: `applyRulesToAdditions` builds a
 * non-global RegExp and tests each line independently, and ast-grep rules go
 * through `matchAstGrepPattern` under the target extension's grammar.
 */
function runRegexRule(rule: CompiledRule, content: string): RuleMatch[] {
  if (!rule.pattern) throw new Error(`Rule ${rule.lessonHash} is regex but has no pattern`);
  const re = new RegExp(rule.pattern); // totem-context: pattern is the pack's own hand-authored regex, not user input
  const out: RuleMatch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) out.push({ lineNumber: i + 1 });
  }
  return out;
}

function runAstGrepRule(rule: CompiledRule, content: string, ext: string): RuleMatch[] {
  const lineCount = content.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const pattern = rule.astGrepYamlRule ?? rule.astGrepPattern;
  if (!pattern) throw new Error(`Rule ${rule.lessonHash} is ast-grep but has no pattern`);
  return matchAstGrepPattern(content, ext, pattern, lineNumbers);
}

function runRule(rule: CompiledRule, content: string, ext: string): RuleMatch[] {
  if (rule.engine === 'regex') return runRegexRule(rule, content);
  if (rule.engine === 'ast-grep') return runAstGrepRule(rule, content, ext);
  throw new Error(
    `Rule ${rule.lessonHash} has unsupported engine '${rule.engine}'; extend runRule to cover it`,
  );
}

describe('@mmnto/pack-agent-workflow rule content', () => {
  it('ships exactly the current rule set (drift guard)', () => {
    // 8 governed concepts, 9 compiled entries: the fail-open-gate family splits
    // into a TS catch-swallow (ast-grep) and a workflow-YAML masking (regex)
    // entry, because ast-grep cannot target YAML in a static pack and one entry
    // carries one engine.
    expect(manifest.rules).toHaveLength(9);
    expect(Object.keys(RULE_BY_HASH).sort()).toEqual(CASES.map((c) => c.hash).sort());
  });

  it('every markdown / YAML / JSON rule ships engine "regex"', () => {
    // Load-bearing: ast-grep's built-in registry is .ts/.tsx/.jsx/.js/.mjs/.cjs
    // only. A non-TS glob with engine "ast-grep" does NOT fail loud — the
    // resolver falls back to Lang.Tsx and silently parses the file as TSX.
    for (const rule of manifest.rules) {
      const positives = (rule.fileGlobs ?? []).filter((g) => !g.startsWith('!'));
      const targetsNonTs = positives.some((g) => !/\.(ts|tsx|jsx|js|mjs|cjs)$/.test(g));
      if (targetsNonTs) {
        expect(rule.engine, `${rule.lessonHash} targets a non-TS path but is not regex`).toBe(
          'regex',
        );
      }
    }
  });

  describe.each(CASES)('rule $key', ({ hash, badSite, ext, negativeProofs }) => {
    const rule = RULE_BY_HASH[hash]!;

    it('exists and carries the pack markers', () => {
      expect(rule).toBeDefined();
      expect(['ast-grep', 'regex']).toContain(rule.engine);
      // CompiledRuleSchema pins category to a fixed four-value enum with no
      // 'agent-workflow' member; pack identity lives in the package name.
      expect(['security', 'architecture', 'style', 'performance']).toContain(rule.category);
      expect(rule.manual).toBe(true);
      expect(rule.immutable).toBe(true);
      expect(['error', 'warning']).toContain(rule.severity);
    });

    it('has a deterministic lessonHash derived from heading + message', () => {
      expect(rule.lessonHash).toBe(hashLesson(rule.lessonHeading, rule.message));
    });

    it('uses an engine-appropriate pattern shape', () => {
      if (rule.engine === 'ast-grep') {
        expect(rule.astGrepYamlRule).toBeDefined();
        expect(rule.pattern).toBe('');
      } else {
        expect(rule.pattern.length).toBeGreaterThan(0);
        expect(rule.astGrepYamlRule).toBeUndefined();
      }
    });

    it('heading is at most 60 enforced characters', () => {
      expect(rule.lessonHeading.length).toBeLessThanOrEqual(80);
    });

    // ── Layer 1: synthetic controls ──
    it('L1 fires on its badExample', () => {
      expect(rule.badExample).toBeDefined();
      const matches = runRule(rule, rule.badExample!, ext);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('L1 stays silent on its goodExample (adversarial near-miss)', () => {
      expect(rule.goodExample).toBeDefined();
      const matches = runRule(rule, rule.goodExample!, ext);
      if (matches.length > 0) {
        throw new Error(
          `Rule ${hash} fired on its goodExample at line(s) ${matches.map((m) => m.lineNumber).join(', ')}`,
        );
      }
    });

    // ── Layer 2: in-situ wind tunnel ──
    it('L2 fires on its wind-tunnel bad site', () => {
      expect(fileMatchesGlobs(badSite, rule.fileGlobs ?? [])).toBe(true);
      const matches = runRule(rule, readSite('bad', badSite), ext);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('L2 stays silent on EVERY good site its globs admit', () => {
      const admitted = WIND_TUNNEL_PATHS.filter((p) => fileMatchesGlobs(p, rule.fileGlobs ?? []));
      // A rule that admits no good site would pass this vacuously.
      expect(admitted.length).toBeGreaterThan(0);
      for (const logical of admitted) {
        const extForSite = path.extname(logical);
        const matches = runRule(rule, readSite('good', logical), extForSite);
        if (matches.length > 0) {
          throw new Error(
            `Rule ${hash} fired on good site ${logical} at line(s) ${matches
              .map((m) => m.lineNumber)
              .join(', ')}`,
          );
        }
      }
    });

    // ── Layer 3: glob coverage, both sides ──
    it('L3 every positive glob matches at least one wind-tunnel path', () => {
      const positives = (rule.fileGlobs ?? []).filter((g) => !g.startsWith('!'));
      expect(positives.length).toBeGreaterThan(0);
      for (const glob of positives) {
        const hit = WIND_TUNNEL_PATHS.some((p) => fileMatchesGlobs(p, [glob]));
        expect(hit, `dead positive glob on ${hash}: ${glob} matches no wind-tunnel path`).toBe(
          true,
        );
      }
    });

    it('L3 every negative glob excludes a named otherwise-matching path', () => {
      const negatives = (rule.fileGlobs ?? []).filter((g) => g.startsWith('!'));
      for (const glob of negatives) {
        const proof = negativeProofs[glob];
        expect(proof, `no named proof path for negative glob ${glob} on ${hash}`).toBeDefined();
        const positives = (rule.fileGlobs ?? []).filter((g) => !g.startsWith('!'));
        // The proof path must match the positives (otherwise the negative is
        // dead — it excludes nothing the rule would ever have seen) AND be
        // excluded once the negative is applied.
        expect(
          fileMatchesGlobs(proof!, positives),
          `dead negative glob on ${hash}: ${glob} — ${proof} does not match the positives`,
        ).toBe(true);
        expect(fileMatchesGlobs(proof!, rule.fileGlobs ?? [])).toBe(false);
      }
    });
  });

  it('hashes are unique across the pack', () => {
    const hashes = manifest.rules.map((r) => r.lessonHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('every wind-tunnel path is admitted by at least one rule', () => {
    // Prevents the tunnel from accumulating specimens nothing scans.
    for (const logical of WIND_TUNNEL_PATHS) {
      const admittedBy = manifest.rules.filter((r) => fileMatchesGlobs(logical, r.fileGlobs ?? []));
      expect(admittedBy.length, `no rule admits wind-tunnel path ${logical}`).toBeGreaterThan(0);
    }
  });

  // ── Documented limitation, asserted rather than omitted ──
  it('KNOWN GAP: auto-close rule fires inside fenced code blocks (why it is warn-tier)', () => {
    const rule = RULE_BY_HASH['bddfbd2ec1c75eaf']!;
    const fenced = ['```markdown', 'Closes #123', '```'].join('\n');
    const matches = runRule(rule, fenced, '.md');
    // This SHOULD fire — a line-oriented regex has no fence awareness. The
    // assertion records the gap so it cannot regress silently into a claim of
    // fence-safety, and it is the reason the rule ships warn-tier rather than
    // error-tier (totem-agy's mandated near-miss the rule cannot survive).
    expect(matches.length).toBeGreaterThan(0);
  });
});

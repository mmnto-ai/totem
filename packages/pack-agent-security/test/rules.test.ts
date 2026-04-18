import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type CompiledRule,
  CompiledRulesFileSchema,
  hashLesson,
  matchAstGrepPattern,
  readJsonSafe,
} from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');

const manifest = readJsonSafe(path.join(PACK_ROOT, 'compiled-rules.json'), CompiledRulesFileSchema);

// totem-context: rule lookups by lessonHash are a test-harness surface, not
// a runtime pattern — keep them local and explicit.
const RULE_BY_HASH: Record<string, CompiledRule> = Object.fromEntries(
  manifest.rules.map((rule) => [rule.lessonHash, rule]),
);

// Rule-to-fixture mapping. Bad fixtures MUST fire the rule; good fixtures MUST NOT.
const FIXTURE_CASES: { hash: string; bad: string; good: string }[] = [
  {
    hash: 'c2c09301bb56a02b',
    bad: 'bad-process-spawn.ts',
    good: 'good-process-spawn.ts',
  },
  {
    hash: 'a0b737fd43fb943e',
    bad: 'bad-dynamic-eval.ts',
    good: 'good-dynamic-eval.ts',
  },
  {
    hash: '79353234aa907cd9',
    bad: 'bad-network-exfil-api.ts',
    good: 'good-network-exfil-api.ts',
  },
  {
    hash: '6fa15756b8a004ef',
    bad: 'bad-network-exfil-shell.ts',
    good: 'good-network-exfil-shell.ts',
  },
  {
    hash: '1c0c5a7daefdeb4b',
    bad: 'bad-obfuscation.ts',
    good: 'good-obfuscation.ts',
  },
];

type RuleMatch = { lineNumber: number };

function runAstGrepRule(rule: CompiledRule, content: string, ext = '.ts'): RuleMatch[] {
  const lineCount = content.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const pattern = rule.astGrepYamlRule ?? rule.astGrepPattern;
  if (!pattern) {
    throw new Error(`Rule ${rule.lessonHash} is ast-grep but has no pattern`);
  }
  return matchAstGrepPattern(content, ext, pattern, lineNumbers);
}

// totem-context: test-harness runRegexRule helper mirrors the production
// engine's regex path (new RegExp + per-line .test) so the pack rules
// execute identically in tests and at lint time. The patterns come from
// our own hand-authored compiled-rules.json, not user input, so regex
// injection / sanitization concerns do not apply; the pattern-validation
// test in compiler-schema.test already asserts every shipped pattern
// compiles. Test-assertion failures use plain `throw new Error` rather
// than the totem error-class wrapper because this is not runtime code.
function runRegexRule(rule: CompiledRule, content: string): RuleMatch[] {
  if (!rule.pattern) {
    throw new Error(`Rule ${rule.lessonHash} is regex but has no pattern`); // totem-context: test-harness fail-loud path
  }
  const re = new RegExp(rule.pattern); // totem-context: pattern is the compiled rule's own regex, not user input
  const out: RuleMatch[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i]!)) out.push({ lineNumber: i + 1 }); // totem-context: non-global regex, lastIndex not mutated
  }
  return out;
}

function runRule(rule: CompiledRule, content: string, ext = '.ts'): RuleMatch[] {
  if (rule.engine === 'regex') return runRegexRule(rule, content);
  return runAstGrepRule(rule, content, ext);
}

describe('@totem/pack-agent-security rule content', () => {
  it('ships exactly the current rule set (drift guard)', () => {
    // Fail loudly if someone adds or removes a rule without updating this test.
    // PR1 shipped 2 rules (#1486 + #1487). PR2 added 3 (#1488 ast-grep, #1488
    // regex, #1490 compound). Total expected: 5.
    expect(manifest.rules).toHaveLength(5);
    expect(Object.keys(RULE_BY_HASH).sort()).toEqual(FIXTURE_CASES.map((c) => c.hash).sort());
  });

  describe.each(FIXTURE_CASES)('rule $hash', ({ hash, bad, good }) => {
    const rule = RULE_BY_HASH[hash];

    it('exists', () => {
      expect(rule).toBeDefined();
    });

    it('carries the ADR-089 required markers', () => {
      // Engine is constrained to the two shapes the pack ships: compound ast-grep
      // for call-site detection (PR1's spawn + eval, PR2's network exfil + obfuscation)
      // and plain regex for string-content scanning (PR2's shell-string curl/wget).
      expect(['ast-grep', 'regex']).toContain(rule.engine); // totem-context: set-membership check, not string redaction
      expect(rule.severity).toBe('error');
      expect(rule.category).toBe('security');
      expect(rule.manual).toBe(true);
      expect(rule.immutable).toBe(true);
    });

    it('uses an engine-appropriate pattern shape', () => {
      if (rule.engine === 'ast-grep') {
        expect(rule.astGrepYamlRule).toBeDefined();
        expect(rule.pattern).toBe('');
        // Mutual exclusion: astGrepPattern must be empty/absent when yaml is present.
        expect(rule.astGrepPattern ?? '').toBe('');
      } else {
        // Regex rules carry the pattern on the `pattern` field and must not set
        // any ast-grep shape.
        expect(rule.pattern.length).toBeGreaterThan(0);
        expect(rule.astGrepYamlRule).toBeUndefined();
        expect(rule.astGrepPattern ?? '').toBe('');
      }
    });

    it('exposes belt-and-suspenders fileGlobs mirroring the pack .totemignore', () => {
      expect(rule.fileGlobs).toBeDefined();
      const globs = rule.fileGlobs ?? [];
      // Positive match on packages source
      expect(globs).toContain('packages/**/*.ts');
      expect(globs).toContain('packages/**/*.js');
      // Negative match on the four template paths shipped in the pack's .totemignore
      expect(globs).toContain('!**/scripts/**');
      expect(globs).toContain('!**/.github/**');
      expect(globs).toContain('!**/*.test.*');
      expect(globs).toContain('!**/*.spec.*');
    });

    it('has a deterministic lessonHash derived from heading + message', () => {
      const expected = hashLesson(rule.lessonHeading, rule.message);
      expect(rule.lessonHash).toBe(expected);
    });

    it('carries a non-empty badExample that the rule matches (smoke gate)', () => {
      expect(rule.badExample).toBeDefined();
      expect(rule.badExample?.length).toBeGreaterThan(0);
      const matches = runRule(rule, rule.badExample!);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('fires on the paired bad fixture', () => {
      const content = fs.readFileSync(path.join(FIXTURES, bad), 'utf-8');
      const matches = runRule(rule, content);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('stays silent on the paired good fixture', () => {
      const content = fs.readFileSync(path.join(FIXTURES, good), 'utf-8');
      const matches = runRule(rule, content);
      if (matches.length > 0) {
        const lines = matches.map((m) => m.lineNumber).join(', ');
        throw new Error(`Rule ${rule.lessonHash} fired on good fixture ${good} at lines ${lines}`);
      }
      expect(matches.length).toBe(0);
    });
  });

  it('hashes are unique across the pack', () => {
    const hashes = manifest.rules.map((r) => r.lessonHash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(hashes.length);
  });

  // Fragment-level coverage for #1490 (design doc Q2): the bad fixture has one
  // section per sub-pattern. If any single sub-pattern regresses, the count
  // drops below the family total and this test fails naming the shortfall.
  it('#1490 bad fixture fires across every obfuscation sub-pattern family', () => {
    const rule = RULE_BY_HASH['1c0c5a7daefdeb4b']!;
    const content = fs.readFileSync(path.join(FIXTURES, 'bad-obfuscation.ts'), 'utf-8'); // totem-context: sync read in test setup, no event-loop concern
    const matches = runRule(rule, content);
    // 7 `any:` entries covering 5 primitive families (Buffer.from splits hex
    // and base64; atob and btoa are distinct). At least 7 matches on the
    // bad fixture means every sub-pattern family fired at least once.
    expect(matches.length).toBeGreaterThanOrEqual(7); // totem-context: lower-bound coverage assertion, not length equality
  });
});

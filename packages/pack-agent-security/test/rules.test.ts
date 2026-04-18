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
    hash: '1597d56eebcf2623',
    bad: 'bad-network-exfil-api.ts',
    good: 'good-network-exfil-api.ts',
  },
  {
    hash: '6fa15756b8a004ef',
    bad: 'bad-network-exfil-shell.ts',
    good: 'good-network-exfil-shell.ts',
  },
  {
    hash: 'dd24f87f46e65812',
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
  if (rule.engine === 'ast-grep') return runAstGrepRule(rule, content, ext);
  // Fail loud so a future engine (e.g. tree-sitter 'ast') does not silently
  // skip test coverage. Every engine the pack ships MUST be dispatched here.
  throw new Error(
    `Rule ${rule.lessonHash} has unsupported engine '${rule.engine}'; extend runRule to cover it`,
  );
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

  // Per-sub-pattern coverage for #1490: run each `any:` entry individually
  // against a synthetic attack corpus and assert each one fires at least once.
  // Uses an inline source string rather than a fixture file because the pack
  // ships patterns for both quote styles (prettier collapses the fixture's
  // double-quoted literals to single, so a fixture-only harness can't prove
  // the double-quoted sub-patterns still match). A plain `matches.length >= N`
  // lower-bound could pass even when a single sub-pattern family regresses if
  // another family fires N times (CR catch on #1522), so this shape proves
  // per-family coverage rather than a count floor.
  it('#1490 every any: sub-pattern fires on a synthetic attack corpus', () => {
    const rule = RULE_BY_HASH['dd24f87f46e65812']!;
    const yaml = rule.astGrepYamlRule as { rule?: { any?: Array<{ pattern?: string }> } };
    const subPatterns = yaml.rule?.any ?? [];
    expect(subPatterns.length).toBeGreaterThan(0);

    // Assembled inline so prettier cannot collapse the double-quoted
    // Buffer.from variants. Each line exercises one sub-pattern family at
    // minimum; the double-quote / single-quote split is explicit.
    const attackCorpus = [
      'String.fromCharCode(99, 117, 114, 108);',
      'Buffer.from("68747470733a2f2f6e67726f6b2e696f", "hex");',
      "Buffer.from('68747470733a2f2f6e67726f6b2e696f', 'hex');",
      'Buffer.from("aHR0cHM6Ly9uZ3Jvay5pby9zdGVhbA==", "base64");',
      "Buffer.from('aHR0cHM6Ly9uZ3Jvay5pby9zdGVhbA==', 'base64');",
      'atob(payload);',
      'btoa(payload);',
      "hidden.split('').reverse().join('');",
    ].join('\n');
    const lineCount = attackCorpus.split('\n').length;
    const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

    const shortfalls: string[] = [];
    for (const entry of subPatterns) {
      if (!entry.pattern) continue;
      const matches = matchAstGrepPattern(attackCorpus, '.ts', entry.pattern, lineNumbers);
      if (matches.length === 0) shortfalls.push(entry.pattern);
    }
    if (shortfalls.length > 0) {
      throw new Error(
        `#1490 sub-patterns that failed to fire on the attack corpus: ${shortfalls.join(', ')}`,
      );
    }
    expect(shortfalls).toEqual([]);
  });
});

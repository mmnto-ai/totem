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
];

function runRule(rule: CompiledRule, content: string, ext = '.ts') {
  const lineCount = content.split('\n').length;
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);
  const pattern = rule.astGrepYamlRule ?? rule.astGrepPattern;
  if (!pattern) {
    throw new Error(`Rule ${rule.lessonHash} is ast-grep but has no pattern`);
  }
  return matchAstGrepPattern(content, ext, pattern, lineNumbers);
}

describe('@totem/pack-agent-security rule content', () => {
  it('ships exactly the rule set PR1 promised (drift guard)', () => {
    // Fail loudly if someone adds or removes a rule without updating this test.
    expect(manifest.rules).toHaveLength(2);
    expect(Object.keys(RULE_BY_HASH).sort()).toEqual(FIXTURE_CASES.map((c) => c.hash).sort());
  });

  describe.each(FIXTURE_CASES)('rule $hash', ({ hash, bad, good }) => {
    const rule = RULE_BY_HASH[hash];

    it('exists', () => {
      expect(rule).toBeDefined();
    });

    it('carries the ADR-089 required markers', () => {
      expect(rule.engine).toBe('ast-grep');
      expect(rule.severity).toBe('error');
      expect(rule.category).toBe('security');
      expect(rule.manual).toBe(true);
      expect(rule.immutable).toBe(true);
    });

    it('uses the compound ast-grep yaml rule shape, not a flat pattern', () => {
      expect(rule.astGrepYamlRule).toBeDefined();
      expect(rule.pattern).toBe('');
      // Mutual exclusion: astGrepPattern must be empty/absent when yaml is present.
      expect(rule.astGrepPattern ?? '').toBe('');
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
});

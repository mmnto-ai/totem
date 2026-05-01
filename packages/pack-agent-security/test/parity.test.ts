import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CompiledRulesFileSchema, readJsonSafe } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');

type Blocklist = {
  version: number;
  domains: string[];
  ipv4Strategy: string;
  note: string;
};

const blocklist = readJsonSafe<Blocklist>(path.join(PACK_ROOT, 'domain-blocklist.json'));
const manifest = readJsonSafe(path.join(PACK_ROOT, 'compiled-rules.json'), CompiledRulesFileSchema);

// #1488 Rule A (ast-grep compound) and Rule B (regex). Both reference the
// same domain set. Parity here guarantees the human-reviewable JSON asset and
// the baked regexes agree. Drift between them is a correctness bug in the
// rule: the JSON is the source of truth, the regexes are the derived form.
const RULE_A_HASH = '1597d56eebcf2623';
const RULE_B_HASH = '6fa15756b8a004ef';

function extractRuleAConstraintRegex(): string {
  const rule = manifest.rules.find((r) => r.lessonHash === RULE_A_HASH);
  if (!rule) throw new Error(`rule ${RULE_A_HASH} missing from manifest`);
  // NapiConfig carries a top-level `constraints` block, sibling to `rule:`.
  // Every sub-pattern in `rule.any` shares the same $URL constraint.
  const yaml = rule.astGrepYamlRule as { constraints?: { URL?: { regex?: string } } } | undefined;
  const regex = yaml?.constraints?.URL?.regex;
  if (!regex) {
    throw new Error(
      `rule ${RULE_A_HASH} missing top-level constraints.URL.regex on astGrepYamlRule`,
    );
  }
  return regex;
}

function extractRuleBPattern(): string {
  const rule = manifest.rules.find((r) => r.lessonHash === RULE_B_HASH);
  if (!rule) throw new Error(`rule ${RULE_B_HASH} missing from manifest`);
  if (!rule.pattern) throw new Error(`rule ${RULE_B_HASH} has empty pattern`);
  return rule.pattern;
}

describe('@mmnto/pack-agent-security domain-blocklist parity', () => {
  const ruleARegex = extractRuleAConstraintRegex();
  const ruleBPattern = extractRuleBPattern();

  it('every blocklist domain appears in Rule A (ast-grep $URL constraint)', () => {
    for (const domain of blocklist.domains) {
      // The rule regex embeds each domain with `\.` escapes. Strip the leading
      // `*.` wildcard marker on the JSON side and escape the dot for comparison.
      const stem = domain.replace(/^\*\./, '').replace(/\./g, '\\.');
      expect(ruleARegex, `Rule A regex missing blocklist entry: ${domain}`).toContain(stem);
    }
  });

  it('every blocklist domain appears in Rule B (regex shell-string pattern)', () => {
    for (const domain of blocklist.domains) {
      const stem = domain.replace(/^\*\./, '').replace(/\./g, '\\.');
      expect(ruleBPattern, `Rule B pattern missing blocklist entry: ${domain}`).toContain(stem);
    }
  });

  it('the two rule regexes carry the same domain fragment (internal consistency)', () => {
    // Rule B's pattern includes Rule A's $URL regex as a sub-expression
    // (wrapped in the curl/wget + any-chars prefix). Verifying that every
    // domain literal in A appears in B is enough to prove the two rules are
    // derived from the same blocklist. The converse is covered by the two
    // per-domain tests above.
    for (const domain of blocklist.domains) {
      const stem = domain.replace(/^\*\./, '').replace(/\./g, '\\.');
      if (ruleARegex.includes(stem)) {
        expect(ruleBPattern).toContain(stem);
      }
    }
  });

  it('both rules flag IPv4 literals per the match-any-literal strategy', () => {
    // `match-any-literal` means the regex targets any `\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}` shape.
    // Localhost and private-range literals are intentionally NOT excluded
    // (design doc Q2). The regex fragment `(?:\\d{1,3}\\.){3}\\d{1,3}` is
    // shared by both rules.
    expect(blocklist.ipv4Strategy).toBe('match-any-literal');
    const ipv4Fragment = '(?:\\d{1,3}\\.){3}\\d{1,3}';
    expect(ruleARegex).toContain(ipv4Fragment);
    expect(ruleBPattern).toContain(ipv4Fragment);
  });

  it('blocklist JSON is schema-shaped (version, domains array, strategy, note)', () => {
    expect(blocklist.version).toBe(1);
    expect(Array.isArray(blocklist.domains)).toBe(true);
    expect(blocklist.domains.length).toBeGreaterThan(0);
    expect(typeof blocklist.ipv4Strategy).toBe('string');
    expect(typeof blocklist.note).toBe('string');
    for (const domain of blocklist.domains) {
      expect(typeof domain).toBe('string');
      expect(domain.length).toBeGreaterThan(0);
    }
  });
});

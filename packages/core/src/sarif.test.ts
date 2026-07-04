import { describe, expect, it } from 'vitest';

import type { CompiledRule, Violation } from './compiler.js';
import { buildSarifLog, ruleId, wellFormedUnicode } from './sarif.js';

// ─── Surrogate helpers (mmnto-ai/totem#2296) ─────────
// Built via String.fromCharCode so the source file never carries a raw lone
// surrogate (which would be invisible/unmatchable in the editor).
const LONE_HIGH = String.fromCharCode(0xd83c); // unpaired high surrogate
const LONE_LOW = String.fromCharCode(0xdfff); // unpaired low surrogate
const REPLACEMENT = String.fromCharCode(0xfffd); // U+FFFD �

/** True if `s` contains any unpaired UTF-16 surrogate code unit. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

// ─── Fixtures ────────────────────────────────────────

const RULE_A: CompiledRule = {
  lessonHash: 'abc12345deadbeef',
  lessonHeading: 'Avoid hardcoded secrets',
  pattern: 'password\\s*=',
  message: 'Do not hardcode passwords in source code.',
  engine: 'regex',
  compiledAt: '2026-03-14T00:00:00Z',
};

const RULE_B: CompiledRule = {
  lessonHash: 'cafebabe12345678',
  lessonHeading: 'Avoid deprecated substr method',
  pattern: '\\.substr\\(',
  message: 'Use .substring() or .slice() instead of deprecated .substr().',
  engine: 'regex',
  compiledAt: '2026-03-14T00:00:00Z',
  fileGlobs: ['*.ts'],
};

const VIOLATION_A: Violation = {
  rule: RULE_A,
  file: 'src/config.ts',
  line: '  const password = "hunter2";',
  lineNumber: 42,
};

const VIOLATION_B: Violation = {
  rule: RULE_B,
  file: 'src/utils.ts',
  line: '  const slug = title.substr(0, 10);',
  lineNumber: 17,
};

// ─── Tests ───────────────────────────────────────────

describe('ruleId', () => {
  it('produces totem/<hash> format', () => {
    expect(ruleId(RULE_A)).toBe('totem/abc12345deadbeef');
  });
});

describe('buildSarifLog', () => {
  it('produces valid SARIF 2.1.0 structure with zero violations', () => {
    const sarif = buildSarifLog([], [RULE_A, RULE_B], { version: '0.31.0' });

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-schema-2.1.0');
    expect(sarif.runs).toHaveLength(1);

    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe('totem-lint');
    expect(run.tool.driver.version).toBe('0.31.0');
    expect(run.tool.driver.properties.llm_calls).toBe(0);
    expect(run.tool.driver.rules).toHaveLength(2);
    expect(run.results).toHaveLength(0);
    expect(run.invocations[0]!.executionSuccessful).toBe(true);
  });

  it('maps violations to SARIF results with correct fields', () => {
    const sarif = buildSarifLog([VIOLATION_A, VIOLATION_B], [RULE_A, RULE_B], {
      version: '0.31.0',
      commitHash: 'abc1234',
    });

    const run = sarif.runs[0]!;
    expect(run.results).toHaveLength(2);

    const result0 = run.results[0]!;
    expect(result0.ruleId).toBe('totem/abc12345deadbeef');
    expect(result0.ruleIndex).toBe(0);
    expect(result0.level).toBe('error');
    expect(result0.message.text).toContain('Do not hardcode passwords');
    expect(result0.message.text).toContain('hunter2');
    expect(result0.locations[0]!.physicalLocation.artifactLocation.uri).toBe('src/config.ts');
    expect(result0.locations[0]!.physicalLocation.region.startLine).toBe(42);

    const result1 = run.results[1]!;
    expect(result1.ruleId).toBe('totem/cafebabe12345678');
    expect(result1.ruleIndex).toBe(1);
    expect(result1.locations[0]!.physicalLocation.region.startLine).toBe(17);
  });

  it('includes commit_hash in tool properties when provided', () => {
    const sarif = buildSarifLog([], [RULE_A], { version: '0.31.0', commitHash: 'deadbeef' });
    expect(sarif.runs[0]!.tool.driver.properties.commit_hash).toBe('deadbeef');
  });

  it('omits commit_hash when not provided', () => {
    const sarif = buildSarifLog([], [RULE_A], { version: '0.31.0' });
    expect(sarif.runs[0]!.tool.driver.properties).not.toHaveProperty('commit_hash');
  });

  it('includes fileGlobs in rule properties when present', () => {
    const sarif = buildSarifLog([], [RULE_B], { version: '0.31.0' });
    const ruleProps = sarif.runs[0]!.tool.driver.rules[0]!.properties;
    expect(ruleProps).toHaveProperty('fileGlobs', ['*.ts']);
  });

  it('deduplicates rules by lessonHash', () => {
    const sarif = buildSarifLog(
      [VIOLATION_A, { ...VIOLATION_A, lineNumber: 99 }],
      [RULE_A, RULE_A],
      { version: '0.31.0' },
    );
    expect(sarif.runs[0]!.tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0]!.results).toHaveLength(2);
  });

  it('sets executionSuccessful to false when violations exist', () => {
    const sarif = buildSarifLog([VIOLATION_A], [RULE_A], { version: '0.31.0' });
    expect(sarif.runs[0]!.invocations[0]!.executionSuccessful).toBe(false);
  });

  it('records rules_enforced and violations_found in invocation properties', () => {
    const sarif = buildSarifLog([VIOLATION_A], [RULE_A, RULE_B], { version: '0.31.0' });
    const props = sarif.runs[0]!.invocations[0]!.properties;
    expect(props).toEqual({ rules_enforced: 2, violations_found: 1 });
  });
});

describe('wellFormedUnicode', () => {
  it('replaces a lone high surrogate with U+FFFD', () => {
    expect(wellFormedUnicode(`a${LONE_HIGH}b`)).toBe(`a${REPLACEMENT}b`);
  });

  it('replaces a lone low surrogate with U+FFFD', () => {
    expect(wellFormedUnicode(`a${LONE_LOW}b`)).toBe(`a${REPLACEMENT}b`);
  });

  it('replaces a trailing lone high surrogate at end-of-string', () => {
    expect(wellFormedUnicode(`ab${LONE_HIGH}`)).toBe(`ab${REPLACEMENT}`);
  });

  it('preserves a valid surrogate pair (a real astral-plane glyph)', () => {
    const emoji = '🎯'; // U+1F3AF — a proper high+low surrogate pair
    expect(wellFormedUnicode(`x${emoji}y`)).toBe(`x${emoji}y`);
    expect(hasLoneSurrogate(wellFormedUnicode(`x${emoji}y`))).toBe(false);
  });

  it('leaves surrogate-free text unchanged', () => {
    expect(wellFormedUnicode('password\\s*=')).toBe('password\\s*=');
  });

  it('is idempotent', () => {
    const once = wellFormedUnicode(`${LONE_HIGH}-${LONE_LOW}`);
    expect(wellFormedUnicode(once)).toBe(once);
    expect(hasLoneSurrogate(once)).toBe(false);
  });
});

describe('buildSarifLog surrogate safety (mmnto-ai/totem#2296)', () => {
  // A frozen emoji-range pattern encodes astral ranges as surrogate-pair ranges,
  // leaving lone surrogates in `pattern` (e.g. `[<high>-<low>]`). The SARIF we
  // emit is valid JSON, but upload-sarif re-serializes it and GitHub's ingestion
  // parser rejects the lone-surrogate escapes, silently dropping the analysis.
  const SURROGATE_RULE: CompiledRule = {
    lessonHash: 'emoji5afaf8d0',
    lessonHeading: `No ${LONE_HIGH} emoji in markdown`,
    pattern: `[${LONE_HIGH}-${LONE_LOW}]`,
    message: `Avoid emoji ${LONE_HIGH} in docs`,
    engine: 'regex',
    compiledAt: '2026-04-06T00:00:00Z',
    fileGlobs: ['**/*.md'],
  };

  const SURROGATE_VIOLATION: Violation = {
    rule: SURROGATE_RULE,
    file: 'README.md',
    line: `# Title ${LONE_HIGH}`,
    lineNumber: 1,
  };

  it('well-forms rule pattern / descriptions / message so no built field carries a lone surrogate', () => {
    const sarif = buildSarifLog([SURROGATE_VIOLATION], [SURROGATE_RULE], { version: '0.31.0' });
    const rule = sarif.runs[0]!.tool.driver.rules[0]!;

    expect(hasLoneSurrogate(rule.properties!.pattern as string)).toBe(false);
    expect(hasLoneSurrogate(rule.shortDescription.text)).toBe(false);
    expect(hasLoneSurrogate(rule.fullDescription!.text)).toBe(false);
    expect(hasLoneSurrogate(sarif.runs[0]!.results[0]!.message.text)).toBe(false);
    // The lossy replacement char is present where the surrogate was.
    expect(rule.properties!.pattern).toContain(REPLACEMENT);
  });

  it('survives the upload-sarif re-serialize/parse round-trip with no lone surrogates', () => {
    const sarif = buildSarifLog([SURROGATE_VIOLATION], [SURROGATE_RULE], { version: '0.31.0' });
    // Models what github/codeql-action/upload-sarif does: JSON.stringify then
    // GitHub re-parses. Without well-forming, the reparsed pattern carries a
    // lone surrogate and GitHub's parser rejects the document.
    const roundTripped = JSON.parse(JSON.stringify(sarif)) as typeof sarif;
    const rule = roundTripped.runs[0]!.tool.driver.rules[0]!;
    expect(hasLoneSurrogate(rule.properties!.pattern as string)).toBe(false);
    expect(hasLoneSurrogate(JSON.stringify(roundTripped))).toBe(false);
  });

  it('still enumerates fileGlobs (well-forming maps over the array without dropping it)', () => {
    const sarif = buildSarifLog([], [SURROGATE_RULE], { version: '0.31.0' });
    expect(sarif.runs[0]!.tool.driver.rules[0]!.properties).toHaveProperty('fileGlobs', [
      '**/*.md',
    ]);
  });
});

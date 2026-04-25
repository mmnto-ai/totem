import { describe, expect, it } from 'vitest';

import {
  extractAllFields,
  extractBadExample,
  extractBadGoodSnippets,
  extractGoodExample,
  extractManualPattern,
  extractMultilineField,
  extractRuleExamples,
  extractYamlRuleAfterField,
  isGlobSetEqual,
  parseDeclaredScope,
  parseDeclaredSeverity,
  stripInlineCode,
} from './lesson-pattern.js';

describe('extractManualPattern', () => {
  it('extracts all fields from a well-formed lesson body', () => {
    const body = [
      '**Tags:** config, env',
      '**Pattern:** process\\.env\\[',
      '**Engine:** regex',
      '**Scope:** src/**/*.ts, !src/**/config.ts',
      '**Severity:** warning',
      '',
      'Use a validated config schema instead of direct env var access.',
    ].join('\n');

    const result = extractManualPattern(body);
    expect(result).toEqual({
      pattern: 'process\\.env\\[',
      engine: 'regex',
      fileGlobs: ['src/**/*.ts', '!src/**/config.ts'],
      severity: 'warning',
    });
  });

  it('returns null when no Pattern field is present', () => {
    const body = 'Just a normal lesson body without pattern fields.';
    expect(extractManualPattern(body)).toBeNull();
  });

  it('defaults engine to regex when not specified', () => {
    const body = '**Pattern:** console\\.log\\(';
    const result = extractManualPattern(body);
    expect(result?.engine).toBe('regex');
  });

  it('defaults severity to warning when not specified', () => {
    const body = '**Pattern:** console\\.log\\(';
    const result = extractManualPattern(body);
    expect(result?.severity).toBe('warning');
  });

  it('parses ast-grep engine', () => {
    const body = '**Pattern:** new Error($$$)\n**Engine:** ast-grep';
    const result = extractManualPattern(body);
    expect(result?.engine).toBe('ast-grep');
    expect(result?.pattern).toBe('new Error($$$)');
  });

  it('parses error severity', () => {
    const body = '**Pattern:** throw\\s+new\\s+Error\n**Severity:** error';
    const result = extractManualPattern(body);
    expect(result?.severity).toBe('error');
  });

  it('handles fields without bold markers', () => {
    const body = 'Pattern: process\\.env\\[\nEngine: regex\nSeverity: warning';
    const result = extractManualPattern(body);
    expect(result?.pattern).toBe('process\\.env\\[');
    expect(result?.engine).toBe('regex');
  });

  it('returns undefined fileGlobs when no Scope field', () => {
    const body = '**Pattern:** foo\\.bar';
    const result = extractManualPattern(body);
    expect(result?.fileGlobs).toBeUndefined();
  });

  it('strips backtick wrappers from Pattern field', () => {
    const body = '**Pattern:** `process.kill($PID, 0)`\n**Engine:** ast-grep';
    const result = extractManualPattern(body);
    expect(result?.pattern).toBe('process.kill($PID, 0)');
  });

  // ─── Bad Example extraction (mmnto/totem#1408) ───────

  it('extracts a Bad Example section into badExample when present', () => {
    const body = [
      '**Pattern:** console\\.log',
      '**Engine:** regex',
      '**Severity:** warning',
      '',
      '### Bad Example',
      '',
      '```ts',
      'console.log("debug")',
      'console.log(x)',
      '```',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result?.badExample).toBe('console.log("debug")\nconsole.log(x)');
  });

  it('returns badExample undefined when no Bad Example section is present', () => {
    const body = '**Pattern:** console\\.log\n**Engine:** regex';
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result?.badExample).toBeUndefined();
  });

  it('treats an empty Bad Example block as absent', () => {
    const body = [
      '**Pattern:** foo',
      '**Engine:** regex',
      '',
      '### Bad Example',
      '',
      '```ts',
      '```',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.badExample).toBeUndefined();
  });

  it('accepts ~~~ fences as well as ``` fences for the Bad Example block', () => {
    const body = [
      '**Pattern:** foo',
      '**Engine:** regex',
      '',
      '### Bad Example',
      '',
      '~~~ts',
      'foo()',
      '~~~',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.badExample).toBe('foo()');
  });

  it('stops the Bad Example capture at the next heading', () => {
    const body = [
      '**Pattern:** foo',
      '**Engine:** regex',
      '',
      '### Bad Example',
      '',
      '```ts',
      'foo()',
      '```',
      '',
      '### Good Example',
      '',
      '```ts',
      'bar()',
      '```',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.badExample).toBe('foo()');
    expect(result?.badExample).not.toContain('bar()');
  });

  it('extracts fields with no whitespace after the closing bold marker (#1282 GCA)', () => {
    // Pre-fix, extractField required \s+ which silently rejected **Pattern:**foo
    // (no space). The lesson would fall through to Pipeline 2 instead of taking
    // the manual path. Caught by gemini-code-assist as a cross-helper consistency
    // cascade — the same pattern lesson-400fed87 describes.
    const body = '**Pattern:**process\\.env\\[\n**Engine:**regex\n**Severity:**warning';
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('process\\.env\\[');
    expect(result?.engine).toBe('regex');
    expect(result?.severity).toBe('warning');
  });

  it('treats empty field values as absent (#1282 GCA)', () => {
    // **Pattern:** with no value should return null (not a Pipeline 1 lesson)
    // rather than producing a rule with an empty pattern. Same fix as the
    // extractMultilineField empty-value handling — empty after trim → undefined
    // → caller's `!value` fallback fires.
    const body = '**Pattern:**\n**Engine:** regex';
    const result = extractManualPattern(body);
    expect(result).toBeNull();
  });

  it('extracts all fields when the lesson uses the **Field**: form (#1282)', () => {
    // Caught by Shield AI on PR #1282 as a partial-fix CRITICAL: extending
    // extractMultilineField to support **Field**: without extending the shared
    // extractField helper meant a lesson written entirely in alt-form would have
    // extractManualPattern return null because Pattern wouldn't be found.
    const body = [
      '**Pattern**: console\\.log\\(',
      '**Engine**: regex',
      '**Scope**: src/**/*.ts',
      '**Severity**: warning',
      '**Message**: Use the structured logger instead of console output.',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result?.pattern).toBe('console\\.log\\(');
    expect(result?.engine).toBe('regex');
    expect(result?.fileGlobs).toEqual(['src/**/*.ts']);
    expect(result?.severity).toBe('warning');
    expect(result?.message).toBe('Use the structured logger instead of console output.');
  });

  it('extracts a single-line Message field (#1265)', () => {
    const body = [
      '**Pattern:** console\\.log\\(',
      '**Engine:** regex',
      '**Severity:** warning',
      '**Message:** Use the structured logger instead of raw console output.',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.message).toBe('Use the structured logger instead of raw console output.');
  });

  it('extracts a multi-line Message field that spans paragraphs (#1265)', () => {
    const body = [
      '**Pattern:** componentDidCatch\\s*\\([^)]*\\)\\s*\\{\\s*\\}',
      '**Engine:** regex',
      '**Severity:** warning',
      '**Message:** Hydration errors should not be caught silently.',
      '',
      'Log to Sentry before rendering fallback UI so you retain visibility',
      'into the failure. Fix: add Sentry.captureException(error) before',
      'returning the fallback component.',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.message).toContain('Hydration errors should not be caught silently.');
    expect(result?.message).toContain('Sentry.captureException(error)');
    expect(result?.message).toContain('returning the fallback component.');
  });

  it('Message field stops at the next bold field marker (#1265)', () => {
    // Order independence: Message appears BEFORE Severity. Capture must terminate
    // at the next **Field:** marker, not run into Severity's value.
    const body = [
      '**Pattern:** eval\\(',
      '**Engine:** regex',
      '**Message:** Never call eval on untrusted input.',
      'It allows arbitrary code execution.',
      '**Severity:** error',
      '**Scope:** **/*.ts',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result?.message).toContain('Never call eval on untrusted input.');
    expect(result?.message).toContain('It allows arbitrary code execution.');
    expect(result?.message).not.toContain('error');
    expect(result?.message).not.toContain('**/*.ts');
    expect(result?.severity).toBe('error');
    expect(result?.fileGlobs).toEqual(['**/*.ts']);
  });

  it('Message field is undefined when absent — backward compatible (#1265)', () => {
    // Existing Pipeline 1 lessons that pre-date #1265 don't have a Message field.
    // extractManualPattern must continue returning a valid result with message: undefined,
    // and downstream buildManualRule will fall back to lesson.heading.
    const body = [
      '**Pattern:** process\\.env\\[',
      '**Engine:** regex',
      '**Severity:** warning',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result?.message).toBeUndefined();
  });
});

describe('extractMultilineField (#1265)', () => {
  it('returns single-line value when followed by EOF', () => {
    const body = '**Message:** Single line message.';
    expect(extractMultilineField(body, 'Message')).toBe('Single line message.');
  });

  it('captures multiple paragraphs until EOF', () => {
    const body = [
      '**Message:** First paragraph of the message.',
      '',
      'Second paragraph here.',
      '',
      'Third paragraph at the end.',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('First paragraph');
    expect(result).toContain('Second paragraph');
    expect(result).toContain('Third paragraph');
  });

  it('stops at the next bold field marker', () => {
    const body = [
      '**Message:** This is the message.',
      'It has two lines.',
      '**Severity:** warning',
      'This should NOT be captured.',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('This is the message.');
    expect(result).toContain('It has two lines.');
    expect(result).not.toContain('warning');
    expect(result).not.toContain('This should NOT be captured');
  });

  it('treats bare-colon prose as continuation, not a new field', () => {
    // "Note:" or "Fix:" mid-prose should NOT terminate the Message capture.
    // Only **bold-marker:** lines act as field terminators.
    const body = [
      '**Message:** Use the structured logger.',
      'Note: this is important for debugging.',
      'Fix: replace console.log with logger.info().',
      '**Severity:** warning',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('Note: this is important');
    expect(result).toContain('Fix: replace console.log');
    expect(result).not.toContain('warning');
  });

  it('returns undefined when the field is absent', () => {
    const body = '**Pattern:** foo\n**Engine:** regex';
    expect(extractMultilineField(body, 'Message')).toBeUndefined();
  });

  it('returns undefined for an empty field value (so caller fallback fires)', () => {
    // **Message:** with no body — must return undefined, not "", so the caller's
    // `manual.message ?? lesson.heading` fallback works correctly. Caught by Shield AI
    // during the combined PR review.
    const body = [
      '**Pattern:** foo',
      '**Engine:** regex',
      '**Message:**',
      '**Severity:** warning',
    ].join('\n');
    expect(extractMultilineField(body, 'Message')).toBeUndefined();
  });

  it('handles CRLF line endings (Windows-authored lessons)', () => {
    // body.split('\n') would leave trailing \r on each line. The startRe (.*)$ capture
    // (no /m flag) would silently fail because $ requires end-of-string and . doesn't
    // match \r. This is the same class of bug as the em-dash silent skip in #1263 —
    // a Windows-authored lesson would have its Message field invisibly dropped.
    // Caught by Shield AI during the combined PR review.
    const body = '**Pattern:** foo\r\n**Message:** Use err not error.\r\n**Severity:** warning';
    expect(extractMultilineField(body, 'Message')).toBe('Use err not error.');
  });

  it('handles CRLF in multi-line message capture', () => {
    const body = [
      '**Pattern:** eval\\(',
      '**Message:** Never call eval.',
      'It allows arbitrary code execution.',
      '**Severity:** error',
    ].join('\r\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('Never call eval.');
    expect(result).toContain('It allows arbitrary code execution.');
    expect(result).not.toContain('error');
  });

  it('trims leading and trailing whitespace from captured value', () => {
    const body = [
      '**Message:**    Leading spaces preserved on first line.',
      '',
      '   Trailing whitespace on the body.   ',
      '   ',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toBe(
      'Leading spaces preserved on first line.\n\n   Trailing whitespace on the body.',
    );
  });

  it('accepts the **Field**: form (asterisks before colon) for both start and terminator', () => {
    // Caught by gemini-code-assist on PR #1282 as a high-priority finding. Both the
    // start regex and the field-marker terminator must accept **Field**: in addition
    // to **Field:** so authors can use either common markdown convention without
    // having later fields incorrectly swallowed into the Message capture.
    const body = [
      '**Pattern**: foo',
      '**Message**: This message uses the alt-form heading.',
      'It spans multiple lines.',
      '**Severity**: warning',
      'This should NOT be captured.',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('This message uses the alt-form heading.');
    expect(result).toContain('It spans multiple lines.');
    expect(result).not.toContain('warning');
    expect(result).not.toContain('This should NOT be captured');
  });

  it('terminates on the bold-open-only **Field: form (#1282 CR)', () => {
    // CR caught the missing form during PR #1282. extractField already accepted
    // **Pattern: foo (bold-open, plain colon) since the original code, but
    // fieldMarkerRe didn't recognize it as a terminator. Result: a lesson written
    // with bold-open-only fields would have Message capture run past the next
    // intended field. Now all four forms terminate consistently.
    const body = [
      '**Message:** Use the structured logger.',
      'It survives across log rotations.',
      '**Severity: warning', // bold-open-only — should terminate
      'This should NOT be captured.',
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('Use the structured logger.');
    expect(result).toContain('It survives across log rotations.');
    expect(result).not.toContain('warning');
    expect(result).not.toContain('This should NOT be captured');
  });

  it('handles mixed **Field:** and **Field**: forms in the same body', () => {
    const body = [
      '**Pattern:** foo', // canonical
      '**Message**: First line.', // alt form
      'Second line.',
      '**Severity:** warning', // canonical terminator
    ].join('\n');
    const result = extractMultilineField(body, 'Message');
    expect(result).toContain('First line.');
    expect(result).toContain('Second line.');
    expect(result).not.toContain('warning');
  });
});

describe('extractAllFields', () => {
  it('returns all matching fields in order', () => {
    const body = '**Example Hit:** `foo()`\n**Example Hit:** `bar()`\n**Example Miss:** `baz()`';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['`foo()`', '`bar()`']);
  });

  it('returns empty array when no matches', () => {
    expect(extractAllFields('no examples here', 'Example Hit')).toEqual([]);
  });

  it('handles non-bold syntax', () => {
    const body = 'Example Hit: hit1\nExample Hit: hit2';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['hit1', 'hit2']);
  });

  it('captures empty values for bare field declarations', () => {
    const body = '**Example Hit:**\n**Example Hit:** valid';
    expect(extractAllFields(body, 'Example Hit')).toEqual(['', 'valid']);
  });

  it('extracts the **Field**: form (asterisks before colon) (#1282)', () => {
    // Mirrors the extractField + extractMultilineField fix for cross-helper consistency.
    const body =
      '**Example Hit**: hit-alt-1\n**Example Hit:** hit-canonical\n**Example Hit**: hit-alt-2';
    expect(extractAllFields(body, 'Example Hit')).toEqual([
      'hit-alt-1',
      'hit-canonical',
      'hit-alt-2',
    ]);
  });
});

describe('stripInlineCode', () => {
  it('strips surrounding backticks', () => {
    expect(stripInlineCode('`console.log()`')).toBe('console.log()');
  });

  it('leaves non-backtick text unchanged', () => {
    expect(stripInlineCode('console.log()')).toBe('console.log()');
  });

  it('does not strip partial backticks', () => {
    expect(stripInlineCode('`partial')).toBe('`partial');
  });
});

describe('extractRuleExamples', () => {
  it('returns hits and misses with backticks stripped', () => {
    const body = '**Example Hit:** `console.log("bad")`\n**Example Miss:** `logger.info("good")`';
    const result = extractRuleExamples(body);
    expect(result).toEqual({
      hits: ['console.log("bad")'],
      misses: ['logger.info("good")'],
    });
  });

  it('returns null when no examples exist', () => {
    expect(extractRuleExamples('plain body')).toBeNull();
  });

  it('handles multiple hits and zero misses', () => {
    const body = '**Example Hit:** a\n**Example Hit:** b';
    const result = extractRuleExamples(body);
    expect(result!.hits).toEqual(['a', 'b']);
    expect(result!.misses).toEqual([]);
  });
});

describe('extractBadGoodSnippets', () => {
  it('extracts fenced code blocks', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'console.log("bad");',
      '```',
      '',
      '**Good:**',
      '```ts',
      'logger.info("good");',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good");']);
  });

  it('extracts inline single-line snippets', () => {
    const body = '**Bad:** `console.log("bad")`\n**Good:** `logger.info("good")`';
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad")']);
    expect(result!.good).toEqual(['logger.info("good")']);
  });

  it('returns null when no Bad/Good fields', () => {
    const body = 'Just a normal lesson body without pattern fields.';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('returns null when only Bad (no Good)', () => {
    const body = '**Bad:** `console.log("bad")`';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('returns null when only Good (no Bad)', () => {
    const body = '**Good:** `logger.info("good")`';
    expect(extractBadGoodSnippets(body)).toBeNull();
  });

  it('handles mixed formats (fenced Bad, inline Good)', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'console.log("bad");',
      '```',
      '**Good:** `logger.info("good")`',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good")']);
  });

  it('filters empty lines from fenced snippets', () => {
    const body = [
      '**Bad:**',
      '```ts',
      '',
      'console.log("bad");',
      '',
      '```',
      '**Good:**',
      '```ts',
      '',
      'logger.info("good");',
      '',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['console.log("bad");']);
    expect(result!.good).toEqual(['logger.info("good");']);
  });

  it('extracts multi-line fenced code blocks', () => {
    const body = [
      '**Bad:**',
      '```ts',
      'const x = 1;',
      'console.log(x);',
      '```',
      '',
      '**Good:**',
      '```ts',
      'const x = 1;',
      'logger.info(x);',
      '```',
    ].join('\n');
    const result = extractBadGoodSnippets(body);
    expect(result).not.toBeNull();
    expect(result!.bad).toEqual(['const x = 1;', 'console.log(x);']);
    expect(result!.good).toEqual(['const x = 1;', 'logger.info(x);']);
  });
});

describe('extractYamlRuleAfterField', () => {
  it('parses a yaml-tagged fenced block following **Pattern:**', () => {
    const body = [
      '**Pattern:**',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '  not:',
      '    has:',
      '      kind: throw_statement',
      '      stopBy: end',
      '```',
      '',
      '**Engine:** ast-grep',
    ].join('\n');
    const result = extractYamlRuleAfterField(body, 'Pattern');
    expect(result).toEqual({
      rule: {
        kind: 'catch_clause',
        not: {
          has: {
            kind: 'throw_statement',
            stopBy: 'end',
          },
        },
      },
    });
  });

  it('accepts ~~~yaml fence style', () => {
    const body = ['**Pattern:**', '~~~yaml', 'rule:', '  kind: catch_clause', '~~~'].join('\n');
    const result = extractYamlRuleAfterField(body, 'Pattern');
    expect(result).toEqual({ rule: { kind: 'catch_clause' } });
  });

  it('ignores a bare ``` fence without yaml tag (so prose code blocks pass through)', () => {
    const body = ['**Pattern:**', '```', 'this is not a yaml rule', '```'].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('returns null when the yaml parses to a non-object (array/string/null)', () => {
    const arrayBody = ['**Pattern:**', '```yaml', '- foo', '- bar', '```'].join('\n');
    const stringBody = ['**Pattern:**', '```yaml', '"just a string"', '```'].join('\n');
    expect(extractYamlRuleAfterField(arrayBody, 'Pattern')).toBeNull();
    expect(extractYamlRuleAfterField(stringBody, 'Pattern')).toBeNull();
  });

  it('returns null when the yaml is malformed', () => {
    const body = ['**Pattern:**', '```yaml', '{ unterminated:', '```'].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('stops scanning at the next bold field marker (does not cross into later sections)', () => {
    // The yaml fence here lives AFTER a **Message:** marker, so the Pattern
    // scanner must stop before reaching it. This guards against a lesson
    // whose Pattern field is missing from producing a surprise match on a
    // yaml block intended for a different field.
    const body = [
      '**Pattern:**',
      'plain line, not a fence',
      '**Message:** prose',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '```',
    ].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('stops scanning at a markdown heading (CR #1454 — no cross-section YAML parsing)', () => {
    // A lesson that omits **Message:** and jumps straight to `### Bad Example`
    // or `## Why this needs to be compound` must NOT have a yaml fence under
    // those headings parsed as the rule body. Without the heading terminator,
    // the scanner would scoop the first yaml fence it finds anywhere after
    // **Pattern:**, even if the author intended the block as an illustration.
    const body = [
      '**Pattern:**',
      'plain line, not a fence',
      '',
      '### Bad Example',
      '',
      '```yaml',
      'this: is-an-illustration',
      'not: a-rule',
      '```',
    ].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('stops at level-2 headings too', () => {
    const body = [
      '**Pattern:**',
      'plain line',
      '',
      '## Why this needs to be compound',
      '',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '```',
    ].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('returns null when the fence never closes', () => {
    const body = [
      '**Pattern:**',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '(EOF with no closing fence)',
    ].join('\n');
    expect(extractYamlRuleAfterField(body, 'Pattern')).toBeNull();
  });

  it('handles CRLF line endings (Windows-authored lessons)', () => {
    const body = ['**Pattern:**', '```yaml', 'rule:', '  kind: catch_clause', '```'].join('\r\n');
    const result = extractYamlRuleAfterField(body, 'Pattern');
    expect(result).toEqual({ rule: { kind: 'catch_clause' } });
  });
});

describe('extractManualPattern — compound ast-grep path', () => {
  it('returns a ManualPattern with astGrepYamlRule when the Pattern field has a yaml fence', () => {
    const body = [
      '**Tags:** tenet-4, fail-loud',
      '**Engine:** ast-grep',
      '**Scope:** packages/**/*.ts, !**/*.test.ts',
      '**Severity:** error',
      '**Pattern:**',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '  not:',
      '    has:',
      '      kind: throw_statement',
      '      stopBy: end',
      '```',
      '',
      '**Message:** never swallow errors',
    ].join('\n');
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result!.engine).toBe('ast-grep');
    expect(result!.pattern).toBe('');
    expect(result!.severity).toBe('error');
    expect(result!.fileGlobs).toEqual(['packages/**/*.ts', '!**/*.test.ts']);
    expect(result!.message).toBe('never swallow errors');
    expect(result!.astGrepYamlRule).toEqual({
      rule: {
        kind: 'catch_clause',
        not: { has: { kind: 'throw_statement', stopBy: 'end' } },
      },
    });
  });

  it('throws TotemParseError when yaml fence present but Engine is not ast-grep (CR #1454 — fail-loud on authoring mismatch)', () => {
    const body = [
      '**Engine:** regex',
      '**Pattern:**',
      '```yaml',
      'rule:',
      '  kind: catch_clause',
      '```',
    ].join('\n');
    expect(() => extractManualPattern(body)).toThrow(/Lesson authoring error/);
  });

  it('still parses flat **Pattern:** values when no yaml fence is present (regression guard)', () => {
    const body = ['**Pattern:** new Error($$$)', '**Engine:** ast-grep'].join('\n');
    const result = extractManualPattern(body);
    expect(result).not.toBeNull();
    expect(result!.pattern).toBe('new Error($$$)');
    expect(result!.astGrepYamlRule).toBeUndefined();
  });
});

// ─── extractBadExample / extractGoodExample ──────────

describe('extractBadExample', () => {
  it('extracts a fenced code block after ### Bad Example', () => {
    const body = ['### Bad Example', '', '```ts', 'throw new Error("boom");', '```'].join('\n');
    expect(extractBadExample(body)).toBe('throw new Error("boom");');
  });

  it('accepts tilde fences too', () => {
    const body = ['### Bad Example', '', '~~~ts', 'foo()', '~~~'].join('\n');
    expect(extractBadExample(body)).toBe('foo()');
  });

  it('returns undefined when no Bad Example heading is present', () => {
    const body = '### Good Example\n\n```ts\nbar()\n```';
    expect(extractBadExample(body)).toBeUndefined();
  });

  it('returns undefined when the heading is present but no fence follows', () => {
    const body = '### Bad Example\n\nprose without a fence\n\n### Something Else';
    expect(extractBadExample(body)).toBeUndefined();
  });

  it('returns undefined when the fenced block is empty', () => {
    const body = '### Bad Example\n\n```ts\n```';
    expect(extractBadExample(body)).toBeUndefined();
  });

  it('does not slide into a following Good Example block when Bad lacks a fence', () => {
    const body = [
      '### Bad Example',
      '',
      'prose only — no fence',
      '',
      '### Good Example',
      '',
      '```ts',
      'correctForm()',
      '```',
    ].join('\n');
    expect(extractBadExample(body)).toBeUndefined();
  });

  it('matches the Bad heading case-insensitively', () => {
    const body = '### BAD Example\n```ts\nfoo()\n```';
    expect(extractBadExample(body)).toBe('foo()');
  });
});

describe('extractGoodExample', () => {
  it('extracts a fenced code block after ### Good Example', () => {
    const body = [
      '### Good Example',
      '',
      '```ts',
      'try { doWork(); } catch (err) { log(err); }',
      '```',
    ].join('\n');
    expect(extractGoodExample(body)).toBe('try { doWork(); } catch (err) { log(err); }');
  });

  it('accepts tilde fences too', () => {
    const body = '### Good Example\n\n~~~ts\nlogger.info(msg)\n~~~';
    expect(extractGoodExample(body)).toBe('logger.info(msg)');
  });

  it('returns undefined when no Good Example heading is present', () => {
    const body = '### Bad Example\n\n```ts\nfoo()\n```';
    expect(extractGoodExample(body)).toBeUndefined();
  });

  it('returns undefined when the heading is present but no fence follows', () => {
    const body = '### Good Example\n\nplain prose\n\n### Done';
    expect(extractGoodExample(body)).toBeUndefined();
  });

  it('returns undefined when the fenced block is empty', () => {
    const body = '### Good Example\n\n```ts\n```';
    expect(extractGoodExample(body)).toBeUndefined();
  });

  it('extracts Good after Bad when both blocks are present', () => {
    // Parity scenario: a Pipeline 1 lesson that defines both Bad and
    // Good Example blocks should let the caller pull each independently.
    const body = [
      '### Bad Example',
      '',
      '```ts',
      'badCall()',
      '```',
      '',
      '### Good Example',
      '',
      '```ts',
      'goodCall()',
      '```',
    ].join('\n');
    expect(extractBadExample(body)).toBe('badCall()');
    expect(extractGoodExample(body)).toBe('goodCall()');
  });

  it('matches the Good heading case-insensitively', () => {
    const body = '### good Example\n```ts\nfoo()\n```';
    expect(extractGoodExample(body)).toBe('foo()');
  });
});

// ─── parseDeclaredSeverity (mmnto-ai/totem#1656) ─────

describe('parseDeclaredSeverity', () => {
  it('extracts error from canonical **Severity:** error prose', () => {
    expect(parseDeclaredSeverity('**Severity:** error')).toBe('error');
  });

  it('extracts warning from canonical **Severity:** warning prose', () => {
    expect(parseDeclaredSeverity('**Severity:** warning')).toBe('warning');
  });

  it('normalizes uppercase to lowercase', () => {
    expect(parseDeclaredSeverity('**Severity:** ERROR')).toBe('error');
    expect(parseDeclaredSeverity('**Severity:** Warning')).toBe('warning');
  });

  it('accepts the alt markdown form **Severity**: error', () => {
    expect(parseDeclaredSeverity('**Severity**: error')).toBe('error');
  });

  it('accepts plain Severity: warning without bold markers', () => {
    expect(parseDeclaredSeverity('Severity: warning')).toBe('warning');
  });

  it('tolerates trailing period after the severity value', () => {
    // Matches the liquid-city ADR-008 exhibits where lesson prose ends the
    // severity line with a period (`**Severity:** error.`). The helper
    // strips trailing sentence punctuation so the author's intent survives.
    // mmnto-ai/totem#1658 R1 GCA + CR finding.
    expect(parseDeclaredSeverity('Severity: error.')).toBe('error');
    expect(parseDeclaredSeverity('**Severity:** error.')).toBe('error');
  });

  it('tolerates full-line bold markdown wrapping severity and value', () => {
    // Shape `**Severity: error**` is common in author prose. extractField
    // captures `error**`; the trailing-markdown strip normalizes to `error`.
    expect(parseDeclaredSeverity('**Severity: error**')).toBe('error');
    expect(parseDeclaredSeverity('**Severity: warning**')).toBe('warning');
  });

  it('tolerates backtick-wrapped values', () => {
    expect(parseDeclaredSeverity('**Severity:** `error`')).toBe('error');
    expect(parseDeclaredSeverity('Severity: `warning`')).toBe('warning');
  });

  it('tolerates leading markdown markers on the value', () => {
    // Shape `Severity: **error**` — leading `**` must strip alongside
    // trailing. Shield round-2 finding on mmnto-ai/totem#1658.
    expect(parseDeclaredSeverity('Severity: **error**')).toBe('error');
    expect(parseDeclaredSeverity('Severity: **warning**')).toBe('warning');
  });

  it('tolerates combined bold-then-punctuation shape like error**.', () => {
    // Punctuation outside the markdown markers. Both sets must strip to
    // reach the bare `error` / `warning` token.
    expect(parseDeclaredSeverity('Severity: **error**.')).toBe('error');
    expect(parseDeclaredSeverity('Severity: **warning**,')).toBe('warning');
  });

  it('tolerates backtick-wrapped values with bold markers or trailing punctuation', () => {
    // Order-of-operations matters: `stripInlineCode` only matches when
    // backticks are at absolute string edges. Running markdown/punctuation
    // strip first isolates the core value; then `stripInlineCode` removes
    // the backticks around it. GCA round-3 finding on
    // mmnto-ai/totem#1658.
    expect(parseDeclaredSeverity('Severity: **`error`**')).toBe('error');
    expect(parseDeclaredSeverity('Severity: `error`.')).toBe('error');
    expect(parseDeclaredSeverity('Severity: **`warning`**.')).toBe('warning');
  });

  it('tolerates comma or semicolon after the severity value', () => {
    expect(parseDeclaredSeverity('Severity: error,')).toBe('error');
    expect(parseDeclaredSeverity('Severity: warning;')).toBe('warning');
  });

  it('returns undefined when no Severity field is present', () => {
    expect(parseDeclaredSeverity('This lesson describes an important invariant.')).toBeUndefined();
  });

  it('returns undefined for free-prose mentions without the Severity: key', () => {
    // Mandatory-colon guard from lesson-28a41450 — "this prevents a severe
    // error" must not match as a severity declaration.
    expect(
      parseDeclaredSeverity('This lesson prevents a severe error in production code.'),
    ).toBeUndefined();
    expect(parseDeclaredSeverity('A warning message appears during compile.')).toBeUndefined();
  });

  it('returns undefined for an out-of-vocabulary severity level', () => {
    // The helper only produces the two canonical values that the
    // `CompiledRule.severity` field accepts. Prose declaring "info" or
    // "fatal" or any other string returns undefined, preserving the
    // compile-pipeline's default fallback.
    expect(parseDeclaredSeverity('**Severity:** info')).toBeUndefined();
    expect(parseDeclaredSeverity('**Severity:** critical')).toBeUndefined();
  });

  it('matches the first Severity: declaration when multiple appear', () => {
    // extractField returns the first match on the case-insensitive,
    // line-anchored regex. Lock in that a lesson body with a second
    // **Severity:** line lower down does not override the first.
    const body = [
      '**Severity:** error',
      '',
      'Some discussion of the invariant.',
      '',
      '**Severity:** warning',
    ].join('\n');
    expect(parseDeclaredSeverity(body)).toBe('error');
  });
});

// ─── parseDeclaredScope (mmnto-ai/totem#1665) ──────────

describe('parseDeclaredScope', () => {
  it('parses a comma-separated Scope: declaration', () => {
    expect(parseDeclaredScope('**Scope:** packages/core/**/*.ts')).toEqual([
      'packages/core/**/*.ts',
    ]);
  });

  it('preserves leading-! exclusion entries verbatim', () => {
    expect(
      parseDeclaredScope('**Scope:** packages/zomboid-sim/src/**/*.rs, !**/*.test.*, !**/*.spec.*'),
    ).toEqual(['packages/zomboid-sim/src/**/*.rs', '!**/*.test.*', '!**/*.spec.*']);
  });

  it('preserves authored order', () => {
    expect(parseDeclaredScope('**Scope:** !**/*.test.*, packages/core/**/*.ts')).toEqual([
      '!**/*.test.*',
      'packages/core/**/*.ts',
    ]);
  });

  it('returns undefined when Scope: is missing', () => {
    expect(parseDeclaredScope('Just a body with no Scope line.')).toBeUndefined();
  });

  it('returns undefined when Scope: value is empty', () => {
    expect(parseDeclaredScope('**Scope:**')).toBeUndefined();
  });

  it('returns undefined when Scope: value is whitespace-only', () => {
    expect(parseDeclaredScope('**Scope:**   ')).toBeUndefined();
  });

  it('filters empty entries from accidental double-commas', () => {
    expect(parseDeclaredScope('**Scope:** A,,B,  ,C')).toEqual(['A', 'B', 'C']);
  });

  it('returns undefined when the entire value collapses to empty after split + filter', () => {
    expect(parseDeclaredScope('**Scope:** ,,,')).toBeUndefined();
  });

  it('matches the same logic extractManualPattern uses (Pipeline 1 regression pin)', () => {
    // After mmnto-ai/totem#1665, extractManualPattern delegates Scope parsing
    // to parseDeclaredScope. This test pins that the manual-pattern path
    // produces identical fileGlobs to a direct parseDeclaredScope call so
    // the refactor doesn't drift the two surfaces.
    const body = [
      '**Pattern:** \\beval\\(',
      '**Engine:** regex',
      '**Scope:** packages/core/**/*.ts, !**/*.test.*',
      '**Severity:** error',
    ].join('\n');
    const manual = extractManualPattern(body);
    expect(manual?.fileGlobs).toEqual(parseDeclaredScope(body));
    expect(manual?.fileGlobs).toEqual(['packages/core/**/*.ts', '!**/*.test.*']);
  });
});

// ─── isGlobSetEqual (mmnto-ai/totem#1665) ──────────

describe('isGlobSetEqual', () => {
  it('returns true for two empty arrays', () => {
    expect(isGlobSetEqual([], [])).toBe(true);
  });

  it('returns true for identical arrays', () => {
    expect(isGlobSetEqual(['a', 'b'], ['a', 'b'])).toBe(true);
  });

  it('is order-insensitive', () => {
    expect(isGlobSetEqual(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('is duplicate-insensitive (set semantics)', () => {
    expect(isGlobSetEqual(['a', 'a'], ['a'])).toBe(true);
  });

  it('returns false when sizes differ after dedup', () => {
    expect(isGlobSetEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it("treats '!' prefix as part of the string (sign matters)", () => {
    expect(isGlobSetEqual(['!**/*.test.*'], ['**/*.test.*'])).toBe(false);
  });

  it('returns false when one side has an entry the other lacks', () => {
    expect(isGlobSetEqual(['a', 'b', '!c'], ['a', 'b'])).toBe(false);
  });

  it('returns true on referential equality fast-path', () => {
    const arr = ['a', 'b'];
    expect(isGlobSetEqual(arr, arr)).toBe(true);
  });

  it('does not mutate inputs', () => {
    const a = ['x', 'y'];
    const b = ['y', 'x'];
    const snapshotA = a.slice();
    const snapshotB = b.slice();
    isGlobSetEqual(a, b);
    expect(a).toEqual(snapshotA);
    expect(b).toEqual(snapshotB);
  });
});

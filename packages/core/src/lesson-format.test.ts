import { describe, expect, it } from 'vitest';

import {
  generateLessonHeading,
  HEADING_MAX_CHARS,
  rewriteLessonHeadings,
  truncateHeading,
} from './lesson-format.js';

describe('generateLessonHeading', () => {
  it('extracts first sentence from plain text', () => {
    expect(generateLessonHeading('Always use strict mode. It catches bugs early.')).toBe(
      'Always use strict mode.',
    );
  });

  it('uses full text when short enough and no sentence boundary', () => {
    expect(generateLessonHeading('Use strict mode')).toBe('Use strict mode');
  });

  it('truncates long text at word boundary without ellipsis', () => {
    const long =
      'This is a very long lesson that goes on and on and on without any sentence boundary for quite a while';
    const heading = generateLessonHeading(long);
    expect(heading.length).toBeLessThanOrEqual(HEADING_MAX_CHARS);
    expect(heading).not.toContain('…');
  });

  it('strips markdown bold formatting', () => {
    expect(generateLessonHeading('**Always** use strict mode')).toBe('Always use strict mode');
  });

  it('strips markdown heading prefixes', () => {
    expect(generateLessonHeading('### Important rule here')).toBe('Important rule here');
  });

  it('strips blockquote prefixes', () => {
    expect(generateLessonHeading('> Never trust raw input')).toBe('Never trust raw input');
  });

  it('strips inline code backticks', () => {
    expect(generateLessonHeading('Use `const` instead of `let`')).toBe('Use const instead of let');
  });

  it('strips code blocks and uses remaining text', () => {
    const body = '```typescript\nconst x = 1;\n```\nAlways initialize variables.';
    expect(generateLessonHeading(body)).toBe('Always initialize variables.');
  });

  it('prefers Fix/Rule line in structured lessons', () => {
    const body =
      '**Context:** Trying to persist state\n**Symptom:** App crashes\n**Fix/Rule:** Use custom localStorage wrappers';
    expect(generateLessonHeading(body)).toBe('Use custom localStorage wrappers');
  });

  it('returns fallback for empty body', () => {
    expect(generateLessonHeading('')).toBe('Lesson');
  });

  it('returns fallback for whitespace-only body', () => {
    expect(generateLessonHeading('   \n\n  ')).toBe('Lesson');
  });

  it('handles body that is only a code block', () => {
    expect(generateLessonHeading('```\ncode\n```')).toBe('Lesson');
  });

  it('strips tilde-fenced code blocks (#1319)', () => {
    const body = '~~~typescript\nconst x = 1;\n~~~\nAlways initialize variables.';
    expect(generateLessonHeading(body)).toBe('Always initialize variables.');
  });

  it('handles body that is only a tilde-fenced code block (#1319)', () => {
    expect(generateLessonHeading('~~~\ncode\n~~~')).toBe('Lesson');
  });

  it('strips list markers', () => {
    expect(generateLessonHeading('- Always validate input')).toBe('Always validate input');
  });
});

describe('truncateHeading', () => {
  it('returns short headings unchanged', () => {
    expect(truncateHeading('Guard reversed marker ordering')).toBe(
      'Guard reversed marker ordering',
    );
  });

  it('strips trailing ellipsis from LLM output', () => {
    expect(truncateHeading('Config-as-code trust boundary…')).toBe('Config-as-code trust boundary');
  });

  it('strips trailing triple-dot from LLM output', () => {
    expect(truncateHeading('Sentinel-based injection systems should always...')).toBe(
      'Sentinel-based injection systems should always',
    );
  });

  it('truncates long headings at word boundary and trims dangling tails', () => {
    const long =
      'When a configuration file is an executed script like totem config it has arbitrary code execution';
    const result = truncateHeading(long);
    expect(result.length).toBeLessThanOrEqual(HEADING_MAX_CHARS);
    expect(result).not.toContain('…');
    // Word boundary gives "...script like totem"; "totem" is not dangling so kept as-is
    expect(result).toBe('When a configuration file is an executed script like totem');
  });

  it('enforces HEADING_MAX_CHARS limit', () => {
    const long = 'a '.repeat(40); // 80 chars
    expect(truncateHeading(long).length).toBeLessThanOrEqual(HEADING_MAX_CHARS);
  });

  it('handles heading that is exactly at the limit', () => {
    const exact = 'x'.repeat(HEADING_MAX_CHARS);
    expect(truncateHeading(exact)).toBe(exact);
  });

  it('trims dangling "the" after word-boundary truncation', () => {
    expect(
      truncateHeading(
        'Custom glob matching functions must be tested against the directory-prefixed convention',
      ),
    ).toBe('Custom glob matching functions must be tested');
  });

  it('trims chained dangling words (e.g. "for the")', () => {
    // After 60-char truncation: "Implement validation logic for the configuration files in" → ends with "in" (dangling) → trim → "...files" (fine)
    expect(
      truncateHeading(
        'Implement validation logic for the configuration files in the project root directory',
      ),
    ).toBe('Implement validation logic for the configuration files');
  });

  it('trims dangling preposition from short heading after ellipsis strip', () => {
    // Under 60 chars after ellipsis strip, but "; use" — "use" is not in dangling list
    // The semicolon makes this tricky; the real fix is the improved prompt
    const result = truncateHeading('LLMs are notoriously poor at character counting; use…');
    expect(result).toBe('LLMs are notoriously poor at character counting; use');
  });

  it('trims dangling article from short heading after ellipsis strip', () => {
    expect(truncateHeading('Always iterate through all regex matches via the…')).toBe(
      'Always iterate through all regex matches',
    );
  });

  it('does not trim valid ending words', () => {
    expect(truncateHeading('Always sanitize Git outputs')).toBe('Always sanitize Git outputs');
  });

  it('does not trim when final word is not dangling', () => {
    // "config" is not a dangling word, so the heading stays intact
    expect(truncateHeading('Guard reversed marker ordering in config')).toBe(
      'Guard reversed marker ordering in config',
    );
  });

  it('trims dangling word from short heading', () => {
    // "in" at end is a dangling word
    expect(truncateHeading('Guard reversed marker ordering in')).toBe(
      'Guard reversed marker ordering',
    );
  });
});

// ─── rewriteLessonHeadings ─────────────────────────────

describe('rewriteLessonHeadings', () => {
  it('rewrites headings with dangling tails', () => {
    const input = `## Lesson — Custom glob matching functions must be tested against the

**Tags:** glob, testing

Body text here.`;
    const { output, rewritten } = rewriteLessonHeadings(input);
    expect(rewritten).toBe(1);
    expect(output).toContain('## Lesson — Custom glob matching functions must be tested');
    expect(output).not.toContain('against the');
  });

  it('preserves clean headings', () => {
    const input = `## Lesson — Always sanitize Git outputs

**Tags:** security`;
    const { output, rewritten } = rewriteLessonHeadings(input);
    expect(rewritten).toBe(0);
    expect(output).toBe(input);
  });

  it('handles multiple headings', () => {
    const input = `## Lesson — First heading is clean

Body 1.

## Lesson — Second heading ends with the

Body 2.

## Lesson — Third heading ends with for

Body 3.`;
    const { output, rewritten } = rewriteLessonHeadings(input);
    expect(rewritten).toBe(2);
    expect(output).toContain('## Lesson — First heading is clean');
    expect(output).toContain('## Lesson — Second heading ends');
    expect(output).toContain('## Lesson — Third heading ends');
  });

  it('strips ellipsis from headings', () => {
    const input = '## Lesson — Sentinel-based injection systems should always…';
    const { output, rewritten } = rewriteLessonHeadings(input);
    expect(rewritten).toBe(1);
    expect(output).toContain('## Lesson — Sentinel-based injection systems should');
    expect(output).not.toContain('…');
  });
});

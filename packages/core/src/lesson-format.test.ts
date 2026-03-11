import { describe, expect, it } from 'vitest';

import { generateLessonHeading, HEADING_MAX_CHARS, truncateHeading } from './lesson-format.js';

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

  it('truncates long headings at word boundary without ellipsis', () => {
    const long =
      'When a configuration file is an executed script like totem config it has arbitrary code execution';
    const result = truncateHeading(long);
    expect(result.length).toBeLessThanOrEqual(HEADING_MAX_CHARS);
    expect(result).not.toContain('…');
    // Should break cleanly — no partial words
    expect(long.startsWith(result)).toBe(true);
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
});

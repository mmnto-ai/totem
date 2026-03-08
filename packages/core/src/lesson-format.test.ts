import { describe, expect, it } from 'vitest';

import { generateLessonHeading } from './lesson-format.js';

describe('generateLessonHeading', () => {
  it('extracts first sentence from plain text', () => {
    expect(generateLessonHeading('Always use strict mode. It catches bugs early.')).toBe(
      'Always use strict mode.',
    );
  });

  it('uses full text when short enough and no sentence boundary', () => {
    expect(generateLessonHeading('Use strict mode')).toBe('Use strict mode');
  });

  it('truncates long text at word boundary with ellipsis', () => {
    const long =
      'This is a very long lesson that goes on and on and on without any sentence boundary for quite a while';
    const heading = generateLessonHeading(long);
    expect(heading.length).toBeLessThanOrEqual(65); // 60 + ellipsis + possible word
    expect(heading).toContain('…');
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

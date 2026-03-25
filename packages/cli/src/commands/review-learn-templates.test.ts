import { describe, expect, it } from 'vitest';

import {
  MAX_EXISTING_LESSONS,
  MAX_PROMPT_CHARS,
  REVIEW_LEARN_SYSTEM_PROMPT,
} from './review-learn-templates.js';

describe('REVIEW_LEARN_SYSTEM_PROMPT', () => {
  it('includes lifecycle nursery instruction', () => {
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('lifecycle: nursery');
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('"lifecycle": "nursery"');
  });

  it('includes dedup instruction', () => {
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('Deduplicate');
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('Do NOT repeat known patterns');
  });

  it('instructs to return empty array when no lessons', () => {
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('return an empty array');
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('return: []');
  });

  it('mentions CodeRabbit and Gemini Code Assist', () => {
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('CodeRabbit');
    expect(REVIEW_LEARN_SYSTEM_PROMPT).toContain('Gemini Code Assist');
  });
});

describe('constants', () => {
  it('MAX_EXISTING_LESSONS is a positive number', () => {
    expect(MAX_EXISTING_LESSONS).toBeGreaterThan(0);
  });

  it('MAX_PROMPT_CHARS is a positive number', () => {
    expect(MAX_PROMPT_CHARS).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from 'vitest';

import { normalizeReviewChrome, REVIEW_CHROME_NORMALIZER_VERSION } from './review-normalize.js';

describe('normalizeReviewChrome — strips presentational chrome', () => {
  it('strips a markdown severity badge image', () => {
    const body =
      '![high](https://www.gstatic.com/codereviewagent/high-priority.svg)\nrequire is_finite()';
    expect(normalizeReviewChrome(body)).toBe('require is_finite()');
  });

  it('strips an HTML <img> severity badge', () => {
    const body = '<img src="https://example.com/critical.svg" alt="critical"> guard the divisor';
    expect(normalizeReviewChrome(body)).toBe('guard the divisor');
  });

  it('strips a <details> collapsible (analysis chain / AI-prompt / tool dump)', () => {
    const body = [
      'Potential issue: missing finite guard.',
      '',
      '<details>',
      '<summary>🤖 Prompt for AI Agents</summary>',
      '',
      'In packages/x: add an is_finite() check before dividing.',
      '</details>',
    ].join('\n');
    expect(normalizeReviewChrome(body)).toBe('Potential issue: missing finite guard.');
  });

  it('strips HTML comments', () => {
    expect(normalizeReviewChrome('keep this <!-- tracking-id: abc123 --> text')).toBe(
      'keep this  text',
    );
  });

  it('collapses runaway blank lines and trims', () => {
    expect(normalizeReviewChrome('line one\n\n\n\n\nline two\n\n')).toBe('line one\n\nline two');
  });

  it('normalizes CRLF to LF', () => {
    expect(normalizeReviewChrome('a\r\nb')).toBe('a\nb');
  });

  it('leaves chrome-free human prose unchanged (apart from trim)', () => {
    const human = 'Please extract this into a helper and add a finite-check.';
    expect(normalizeReviewChrome(`  ${human}  `)).toBe(human);
  });

  it('preserves fenced code blocks (never over-strips the asserted invariant)', () => {
    const body = ['Use execFile:', '```ts', 'execFile("ls", args)', '```'].join('\n');
    expect(normalizeReviewChrome(body)).toBe(body);
  });

  it('preserves chrome-looking tokens INSIDE a fence; strips them outside (CR #2242)', () => {
    const body = [
      '![high](https://x/high.svg)', // chrome OUTSIDE → stripped
      'Forbid this exact snippet:',
      '```md',
      '<!-- keep -->', // chrome INSIDE fence → preserved (the literal invariant)
      '![inline](img.png)',
      '```',
    ].join('\n');
    const out = normalizeReviewChrome(body);
    expect(out).not.toContain('![high]'); // outside badge stripped
    expect(out).toContain('Forbid this exact snippet:');
    expect(out).toContain('<!-- keep -->'); // inside HTML comment preserved
    expect(out).toContain('![inline](img.png)'); // inside image preserved
  });

  it('is IDEMPOTENT: normalize(normalize(x)) === normalize(x)', () => {
    const heavy = [
      '![high](https://x/high.svg)',
      '### Critical Bug:',
      'divisor may be zero',
      '',
      '<details><summary>Analysis chain</summary>',
      'long tool dump',
      '</details>',
      '',
      '',
      '',
      'trailing',
    ].join('\n');
    const once = normalizeReviewChrome(heavy);
    expect(normalizeReviewChrome(once)).toBe(once);
  });
});

describe('REVIEW_CHROME_NORMALIZER_VERSION', () => {
  it('is a stable, non-empty version pin (folded into replay provenance — Tenet-15)', () => {
    expect(REVIEW_CHROME_NORMALIZER_VERSION).toBe('review-chrome-normalizer:v1');
  });
});

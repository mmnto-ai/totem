import type { CustomSecret } from '@mmnto/totem';
import { compileCustomSecrets, maskSecrets } from '@mmnto/totem';
import { describe, expect, it } from 'vitest';

// ─── Custom secrets DLP in add-lesson pipeline (#921) ──

describe('add-lesson custom secrets detection and redaction', () => {
  const customSecrets: CustomSecret[] = [
    { type: 'literal', value: 'MY_INTERNAL_TOKEN_XYZ' },
    { type: 'pattern', value: 'corp-secret-[0-9a-f]{8}' },
  ];

  it('detects custom secret in lesson text', () => {
    const lessonText = 'When authenticating, use MY_INTERNAL_TOKEN_XYZ in the header.';
    const compiled = compileCustomSecrets(customSecrets);
    const hasMatch = compiled.some((re) => {
      re.lastIndex = 0;
      return re.test(lessonText);
    });
    expect(hasMatch).toBe(true);
  });

  it('detects pattern-based custom secret in lesson text', () => {
    const lessonText = 'The service uses corp-secret-abcd1234 for internal auth.';
    const compiled = compileCustomSecrets(customSecrets);
    const hasMatch = compiled.some((re) => {
      re.lastIndex = 0;
      return re.test(lessonText);
    });
    expect(hasMatch).toBe(true);
  });

  it('does not flag text without custom secrets', () => {
    const lessonText = 'Always validate input before writing to disk.';
    const compiled = compileCustomSecrets(customSecrets);
    const hasMatch = compiled.some((re) => {
      re.lastIndex = 0;
      return re.test(lessonText);
    });
    expect(hasMatch).toBe(false);
  });

  it('redacts literal custom secrets before saving', () => {
    const lessonText = 'Auth token is MY_INTERNAL_TOKEN_XYZ in the config.';
    const redacted = maskSecrets(lessonText, customSecrets);
    expect(redacted).not.toContain('MY_INTERNAL_TOKEN_XYZ');
    expect(redacted).toContain('[REDACTED_CUSTOM]');
  });

  it('redacts pattern-based custom secrets before saving', () => {
    const lessonText = 'Found corp-secret-deadbeef in the environment.';
    const redacted = maskSecrets(lessonText, customSecrets);
    expect(redacted).not.toContain('corp-secret-deadbeef');
    expect(redacted).toContain('[REDACTED_CUSTOM]');
  });

  it('preserves lesson text when no custom secrets match', () => {
    const lessonText = 'Use structured error handling in async functions.';
    const redacted = maskSecrets(lessonText, customSecrets);
    expect(redacted).toBe(lessonText);
    expect(redacted).not.toContain('[REDACTED_CUSTOM]');
  });

  it('redacts multiple occurrences of the same secret', () => {
    const lessonText = 'First use MY_INTERNAL_TOKEN_XYZ, then verify MY_INTERNAL_TOKEN_XYZ again.';
    const redacted = maskSecrets(lessonText, customSecrets);
    expect(redacted).not.toContain('MY_INTERNAL_TOKEN_XYZ');
    // Should have two [REDACTED_CUSTOM] replacements
    const matches = redacted.match(/\[REDACTED_CUSTOM\]/g);
    expect(matches).toHaveLength(2);
  });
});

import { describe, expect, it } from 'vitest';

import { redactPath, RegexTelemetrySchema } from './telemetry.js';

describe('RegexTelemetrySchema', () => {
  const valid = {
    ruleHash: 'abc123def4567890',
    redactedPath: 'packages/core/src/foo.ts',
    matchedInputSize: 1024,
    elapsedTimeMs: 42,
    timeoutTriggered: false,
    softWarningTriggered: false,
  };

  it('accepts a fully-specified telemetry record', () => {
    const parsed = RegexTelemetrySchema.parse(valid);
    expect(parsed.ruleHash).toBe('abc123def4567890');
    expect(parsed.timeoutTriggered).toBe(false);
  });

  it('rejects a record missing ruleHash', () => {
    const { ruleHash: _, ...rest } = valid;
    const result = RegexTelemetrySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a record missing redactedPath', () => {
    const { redactedPath: _, ...rest } = valid;
    const result = RegexTelemetrySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects negative elapsedTimeMs', () => {
    // Elapsed time cannot be negative; fail loud on clock skew or wrong
    // computation path rather than writing nonsense to the telemetry sink.
    const result = RegexTelemetrySchema.safeParse({ ...valid, elapsedTimeMs: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects negative matchedInputSize', () => {
    const result = RegexTelemetrySchema.safeParse({ ...valid, matchedInputSize: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean timeoutTriggered', () => {
    const result = RegexTelemetrySchema.safeParse({ ...valid, timeoutTriggered: 'yes' });
    expect(result.success).toBe(false);
  });

  it('accepts a timeout record with timeoutTriggered=true', () => {
    const parsed = RegexTelemetrySchema.parse({
      ...valid,
      timeoutTriggered: true,
      elapsedTimeMs: 100,
    });
    expect(parsed.timeoutTriggered).toBe(true);
  });

  it('accepts a soft-warning record with softWarningTriggered=true', () => {
    const parsed = RegexTelemetrySchema.parse({
      ...valid,
      softWarningTriggered: true,
      elapsedTimeMs: 75,
    });
    expect(parsed.softWarningTriggered).toBe(true);
  });
});

describe('redactPath', () => {
  it('returns a repo-relative path unchanged when the input is already relative', () => {
    expect(redactPath('packages/core/src/foo.ts', '/repo/root')).toBe('packages/core/src/foo.ts');
  });

  it('strips the repo-root prefix from an absolute path', () => {
    expect(redactPath('/repo/root/packages/core/src/foo.ts', '/repo/root')).toBe(
      'packages/core/src/foo.ts',
    );
  });

  it('strips a trailing slash on the repo-root prefix consistently', () => {
    expect(redactPath('/repo/root/packages/core/src/foo.ts', '/repo/root/')).toBe(
      'packages/core/src/foo.ts',
    );
  });

  it('returns a content-hash marker when the path is outside the repo root', () => {
    // Protects against accidentally logging paths from /tmp, /etc, or a
    // different user's home directory. The content hash is stable but
    // does not leak the raw path bytes.
    const redacted = redactPath('/tmp/something/totally/elsewhere.ts', '/repo/root');
    expect(redacted.startsWith('<extern:')).toBe(true);
    expect(redacted).not.toContain('/tmp');
  });

  it('produces stable content hashes for the same extern path', () => {
    const a = redactPath('/external/path/foo.ts', '/repo/root');
    const b = redactPath('/external/path/foo.ts', '/repo/root');
    expect(a).toBe(b);
  });
});

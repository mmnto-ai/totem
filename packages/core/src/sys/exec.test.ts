import { describe, expect, it } from 'vitest';

import { safeExec } from './exec.js';

// Long-running interval used to ensure the child process outlives the
// timeout window. Any value safely larger than TIMEOUT_MS works; 30s is
// generous enough that a slow CI runner won't race the check.
const LONG_RUNNING_INTERVAL_MS = 30_000;
// Timeout for the test that asserts safeExec honors its timeout option.
// Short enough to keep the suite fast.
const TIMEOUT_TEST_MS = 100;

describe('safeExec', () => {
  it('executes a command and returns trimmed output', () => {
    // Use single quotes inside the JS expression — cmd.exe strips double quotes
    const result = safeExec('node', ['-e', "console.log('hello')"]);
    expect(result).toBe('hello');
  });

  it('preserves trailing whitespace when trim is false', () => {
    const result = safeExec('node', ['-e', "console.log('hello')"], { trim: false });
    expect(result).toContain('hello');
    expect(result.length).toBeGreaterThan('hello'.length);
  });

  it('throws with cause on non-zero exit', () => {
    try {
      safeExec('node', ['-e', 'process.exit(1)']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('Command failed');
      expect((err as Error).cause).toBeDefined();
    }
  });

  it('throws with cause on command not found', () => {
    try {
      safeExec('totem-nonexistent-binary-12345', []);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeDefined();
    }
  });

  it('respects cwd option', () => {
    const result = safeExec('node', ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: process.cwd(),
    });
    expect(result).toBeTruthy();
  });

  it('respects timeout option', () => {
    try {
      // Using setInterval(Object, ...) instead of setTimeout(() => {}, ...)
      // avoids shell metacharacters. On Windows, safeExec runs with
      // shell: true to resolve .cmd/.bat shims, and cmd.exe would parse
      // the `=>` token in an arrow function as `=` + `>` output redirection,
      // creating a stray file named `{}` in the cwd. See mmnto/totem#1233.
      safeExec('node', ['-e', `setInterval(Object, ${LONG_RUNNING_INTERVAL_MS})`], {
        timeout: TIMEOUT_TEST_MS,
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });

  it('does not expose stdio option (always forces pipe mode)', () => {
    const result = safeExec('node', ['-e', "console.log('pipe-ok')"]);
    expect(result).toBe('pipe-ok');
  });
});

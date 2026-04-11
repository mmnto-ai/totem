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
      // Historical note: this test originally used setTimeout with an
      // arrow function, but that was broken on Windows because safeExec
      // ran with `shell: true` to resolve .cmd/.bat shims, and cmd.exe
      // parsed `=>` in the arrow function as `=` + `>` output redirection,
      // creating a stray `{}` file in the cwd (mmnto/totem#1233).
      //
      // After mmnto/totem#1329 replaced execFileSync with cross-spawn,
      // `shell: true` is no longer enabled and the original idiom would
      // work. The `setInterval(Object, ...)` form is preserved here
      // because the test is stable and a cosmetic rewrite would add
      // diff noise without changing behavior. Intentional history.
      safeExec('node', ['-e', `setInterval(Object, ${LONG_RUNNING_INTERVAL_MS})`], {
        timeout: TIMEOUT_TEST_MS,
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      // mmnto/totem#1329: a timeout kill populates the `.signal` field
      // on the thrown error so callers can distinguish signal-killed
      // processes from non-zero exits without parsing the message body.
      const timeoutErr = err as Error & { signal?: string | null };
      expect(timeoutErr.signal).toBeTruthy();
    }
  });

  it('does not expose stdio option (always forces pipe mode)', () => {
    const result = safeExec('node', ['-e', "console.log('pipe-ok')"]);
    expect(result).toBe('pipe-ok');
  });

  // ─── #1329: shell metacharacter safety ────────
  //
  // Prior to mmnto/totem#1329, safeExec passed `shell: IS_WIN` to
  // execFileSync, which routed every Windows call through cmd.exe with
  // unescaped arguments. cmd.exe then interpreted shell metacharacters
  // like `&`, `>`, `|`, and `"` that appeared in ANY argument position,
  // not just in the command string. This was both a correctness bug
  // (see mmnto/totem#1233 for the stray `{}` file created when cmd.exe
  // parsed `=>` as `=` + `>` redirection) and a shell-injection vector
  // for any caller that forwarded user input through safeExec.
  //
  // The fix swapped execFileSync for cross-spawn.sync, which handles
  // Windows .cmd/.bat shim resolution WITHOUT enabling shell: true at
  // the Node layer. These tests lock in the invariant that argument
  // values pass through to the subprocess verbatim on all platforms.

  it('passes shell metacharacters in argument values through verbatim (#1329)', () => {
    // The headline regression test. This MUST pass on both POSIX and
    // Windows. On POSIX it always worked (no shell in the pipeline).
    // On Windows it was broken before #1329 because cmd.exe interpreted
    // `&` as a command separator and `>` as output redirection.
    const dangerousArg = 'hello&world>bar';
    const result = safeExec('node', [
      '-e',
      'process.stdout.write(process.argv[process.argv.length - 1])',
      dangerousArg,
    ]);
    expect(result).toBe(dangerousArg);
  });

  it('passes pipes and double quotes in argument values through verbatim (#1329)', () => {
    // A second metacharacter set covering `|` (pipe) and `"` (quote),
    // both of which cmd.exe treats specially.
    const dangerousArg = 'alpha|beta"gamma';
    const result = safeExec('node', [
      '-e',
      'process.stdout.write(process.argv[process.argv.length - 1])',
      dangerousArg,
    ]);
    expect(result).toBe(dangerousArg);
  });

  it('exposes .status on the thrown error for non-zero exit codes (#1329)', () => {
    // The cross-spawn refactor attaches status/stdout/stderr to the
    // thrown Error as optional fields, matching the richer information
    // cross-spawn's sync API provides. Existing callers that only read
    // `.message` and `.cause` continue to work. New callers that want
    // to distinguish exit codes no longer have to parse the message.
    try {
      safeExec('node', ['-e', 'process.exit(42)']);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const safeErr = err as Error & { status?: number | null };
      expect(safeErr.status).toBe(42);
    }
  });
});

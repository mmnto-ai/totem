import { describe, expect, it } from 'vitest';

import { safeExec } from './exec.js';

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
      safeExec('node', ['-e', 'setTimeout(() => {}, 30000)'], { timeout: 100 });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});

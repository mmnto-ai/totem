import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { brand, createSpinner, dim, log, printBanner } from './ui.js';

describe('brand colors', () => {
  it('wraps text (identity check — actual ANSI depends on TTY)', () => {
    // picocolors returns plain text when not a TTY, colored otherwise
    expect(typeof brand('hello')).toBe('string');
    expect(brand('hello')).toContain('hello');
  });

  it('dim wraps text', () => {
    expect(dim('test')).toContain('test');
  });
});

describe('log', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('log.info writes to stderr with tag', () => {
    log.info('Test', 'hello');
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('Test');
    expect(output).toContain('hello');
  });

  it('log.success writes to stderr', () => {
    log.success('Tag', 'done');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('log.warn writes to stderr', () => {
    log.warn('Tag', 'warning');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('log.error writes to stderr', () => {
    log.error('Tag', 'fail');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('log.dim writes to stderr', () => {
    log.dim('Tag', 'dimmed');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('createSpinner', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it('returns a static logger in non-TTY mode', async () => {
    // process.stderr.isTTY is undefined in test environment (non-TTY)
    const spinner = await createSpinner('Test', 'working...');
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('working...');

    // update, succeed, fail, stop should not throw
    spinner.update('still working');
    spinner.succeed('done');
    spinner.fail('oops');
    spinner.stop();
  });
});

describe('printBanner', () => {
  it('prints banner to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    printBanner();
    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0]![0] as string;
    expect(output).toContain('Your AI forgets. Totem remembers.');
    spy.mockRestore();
  });
});

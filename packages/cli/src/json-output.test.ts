import { afterEach, describe, expect, it, vi } from 'vitest';

import { isJsonMode, printJson } from './json-output.js';

describe('printJson', () => {
  it('outputs valid JSON to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    printJson({ status: 'success', command: 'test', data: { foo: 1 } });
    const output = spy.mock.calls[0]![0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('success');
    expect(parsed.data.foo).toBe(1);
    spy.mockRestore();
  });

  it('outputs error envelope with fix suggestion', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    printJson({
      status: 'error',
      command: 'lint',
      error: { message: 'No rules found', fix: 'Run totem compile', code: 'NO_RULES' },
    });
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.status).toBe('error');
    expect(parsed.error.fix).toBe('Run totem compile');
    spy.mockRestore();
  });
});

describe('isJsonMode', () => {
  const original = process.env['TOTEM_JSON_OUTPUT'];

  afterEach(() => {
    if (original === undefined) {
      delete process.env['TOTEM_JSON_OUTPUT'];
    } else {
      process.env['TOTEM_JSON_OUTPUT'] = original;
    }
  });

  it('returns true when TOTEM_JSON_OUTPUT is 1', () => {
    process.env['TOTEM_JSON_OUTPUT'] = '1';
    expect(isJsonMode()).toBe(true);
  });

  it('returns false when not set', () => {
    delete process.env['TOTEM_JSON_OUTPUT'];
    expect(isJsonMode()).toBe(false);
  });
});

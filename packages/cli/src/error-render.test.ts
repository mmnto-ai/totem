/**
 * `renderCliError` — the print half of the CLI error boundary
 * (mmnto-ai/totem#2525). The bytes are pinned per shape so a softened shield
 * failure and the boundary's own print cannot drift apart.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderCliError } from './error-render.js';

describe('renderCliError (mmnto-ai/totem#2525)', () => {
  let printed: unknown[][];
  let savedDebug: string | undefined;

  beforeEach(() => {
    printed = [];
    savedDebug = process.env['TOTEM_DEBUG'];
    delete process.env['TOTEM_DEBUG'];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      printed.push(args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedDebug === undefined) delete process.env['TOTEM_DEBUG'];
    else process.env['TOTEM_DEBUG'] = savedDebug;
  });

  it('a plain Error is branded, then the debug hint', () => {
    renderCliError(new Error('the thing failed'));
    expect(printed).toEqual([
      ['[Totem Error] the thing failed'],
      ['  (Set TOTEM_DEBUG=1 for full stack trace)'],
    ]);
  });

  it('a message already carrying the brand is not branded twice', () => {
    renderCliError(new Error('[Totem Error] already branded'));
    expect(printed).toEqual([
      ['[Totem Error] already branded'],
      ['  (Set TOTEM_DEBUG=1 for full stack trace)'],
    ]);
  });

  it('a recoveryHint prints as the Fix: line', () => {
    const err = Object.assign(new Error('No model specified'), {
      recoveryHint: 'Set orchestrator.defaultModel in the config.',
    });
    renderCliError(err);
    expect(printed).toEqual([
      ['[Totem Error] No model specified'],
      ['  Fix: Set orchestrator.defaultModel in the config.'],
      ['  (Set TOTEM_DEBUG=1 for full stack trace)'],
    ]);
  });

  it('a non-Error value prints the unknown-error line with the value', () => {
    renderCliError('a bare string');
    expect(printed).toEqual([
      ['[Totem Error] An unknown error occurred:', 'a bare string'],
      ['  (Set TOTEM_DEBUG=1 for full stack trace)'],
    ]);
  });

  it('under TOTEM_DEBUG=1 the stack and the cause chain print, and the hint does not', () => {
    process.env['TOTEM_DEBUG'] = '1';
    const cause = new Error('the root cause');
    renderCliError(new Error('the surface', { cause }));
    const lines = printed.map((args) => args.join(' '));
    expect(lines[0]).toBe('[Totem Error] the surface');
    expect(lines[1]).toBe('\nStack trace:');
    expect(lines).toContain('\nCaused by: the root cause');
    expect(lines).not.toContain('  (Set TOTEM_DEBUG=1 for full stack trace)');
  });
});

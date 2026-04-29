import { describe, expect, it } from 'vitest';

import { sanitizeForTerminal } from './terminal-sanitize.js';

describe('sanitizeForTerminal', () => {
  it('strips CSI escape sequences (ESC [ … final byte)', () => {
    expect(sanitizeForTerminal('\x1b[31mred\x1b[0m')).toBe('red');
    expect(sanitizeForTerminal('a\x1b[1;33mb\x1b[mc')).toBe('abc');
  });

  it('replaces C0 control bytes with a space, preserving \\n and \\t', () => {
    // \x07 BEL, \x08 BS, \x0b VT, \x0c FF, \x0e SO, \x1f US — all should become spaces.
    expect(sanitizeForTerminal('a\x07b\x08c\x0bd\x0ce\x0ef\x1fg')).toBe('a b c d e f g');
    // \n and \t survive (caller may collapse later).
    expect(sanitizeForTerminal('line\n\twith\twhitespace')).toBe('line\n\twith\twhitespace');
    // \x7f DEL also strips.
    expect(sanitizeForTerminal('del\x7fhere')).toBe('del here');
  });

  it('replaces C1 control bytes (\\x80-\\x9f) with a space — closes the original \\x7f gap', () => {
    // \x9b is the 8-bit CSI introducer — directly equivalent to ESC [ on
    // 8-bit-clean terminals. CR mmnto-ai/totem#1739 R2 caught the original
    // regex stopped at \x7f leaving the C1 range open.
    expect(sanitizeForTerminal('csi-8bit\x9bsequence')).toBe('csi-8bit sequence');
    // Sweep the whole C1 range.
    for (let cp = 0x80; cp <= 0x9f; cp += 1) {
      const ctrl = String.fromCharCode(cp);
      const out = sanitizeForTerminal(`a${ctrl}b`);
      expect(out).toBe('a b');
    }
  });

  it('passes printable text through unchanged', () => {
    expect(sanitizeForTerminal('plain text 123 !@#$%^&*()')).toBe('plain text 123 !@#$%^&*()');
    // Unicode above C1 is preserved.
    expect(sanitizeForTerminal('café — naïve')).toBe('café — naïve');
  });

  it('returns the empty string unchanged', () => {
    expect(sanitizeForTerminal('')).toBe('');
  });
});

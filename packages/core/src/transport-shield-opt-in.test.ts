import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The transport shield's readers grew opt-in options for the action-policy
// gate (mmnto-ai/totem#3106): `programStart`'s wrapper table and redirection
// skip, `programSpellings`' backslash basename, `tokenizeShell`'s literal
// backslash, and the body readers' raw and PowerShell modes. The shield's own
// rows must pass none of them, so its verdicts stay what they were. This test
// reads every call site in the shield's source and checks its arguments.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, 'transport-shield.ts'), 'utf-8');

/** Every call to `name(` in the source, as its argument text, definitions excluded. */
function callArguments(name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![\\w.])${name}\\(`, 'g');
  for (const m of SOURCE.matchAll(re)) {
    const at = m.index ?? 0;
    const lineStart = SOURCE.lastIndexOf('\n', at) + 1;
    if (/^\s*export function |^\s*function /.test(SOURCE.slice(lineStart, at + name.length + 1))) {
      continue;
    }
    let depth = 0;
    let k = at + name.length;
    for (; k < SOURCE.length; k += 1) {
      const ch = SOURCE[k];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(SOURCE.slice(at + name.length + 1, k).trim());
  }
  return out;
}

/** Top-level commas in an argument list: the argument count minus one. */
function argumentCount(args: string): number {
  if (args === '') return 0;
  let depth = 0;
  let count = 1;
  for (const ch of args) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) count += 1;
  }
  return count;
}

describe("the shield's own call sites pass no opt-in option", () => {
  it('programStart is called with at most (tokens, program)', () => {
    const calls = callArguments('programStart');
    expect(calls).toEqual(['tokens, program']);
  });

  it('programSpellings is called with the token only', () => {
    const calls = callArguments('programSpellings');
    // programIndex's own read and the wrapper-name lookup.
    expect(calls).toEqual(['t', 'token']);
    for (const args of calls) expect(argumentCount(args)).toBe(1);
  });

  it('substitutionBodies is called with the text only', () => {
    expect(callArguments('substitutionBodies')).toEqual(['seg.raw']);
  });

  it('backtickBodies is called with at most (text, skip)', () => {
    expect(callArguments('backtickBodies')).toEqual(['text, coveredAt']);
  });

  it('tokenizeShell and findHeredocs never receive literalBackslash or joinContinuations', () => {
    for (const args of [...callArguments('tokenizeShell'), ...callArguments('findHeredocs')]) {
      expect(args).not.toMatch(/literalBackslash|joinContinuations/);
    }
  });

  it('no option name of the opt-in set appears as an object key outside its definition', () => {
    for (const key of [
      'wrapperOptions',
      'wrapperPositionals',
      'skipRedirections',
      'literalBackslash',
      'joinContinuations',
      'backslash',
    ]) {
      const uses = [...SOURCE.matchAll(new RegExp(`\\b${key}\\s*:`, 'g'))];
      expect(uses, key).toHaveLength(0);
    }
  });
});

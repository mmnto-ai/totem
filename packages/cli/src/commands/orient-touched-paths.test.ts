import { describe, expect, it } from 'vitest';

import { parsePorcelainPaths } from './orient-touched-paths.js';

// The working-tree half of the action-policy section's touched set
// (mmnto-ai/totem#3106), read from `git status --porcelain -z`.

const NUL = String.fromCharCode(0);

describe('parsePorcelainPaths', () => {
  it('keeps the first character of a path whose status opens with a space', () => {
    expect(parsePorcelainPaths(` M src/a.ts${NUL}`)).toEqual(['src/a.ts']);
  });

  it('reads modified, added and untracked records', () => {
    const raw = [' M src/a.ts', 'A  db/migrations/1.sql', '?? notes.md', ''].join(NUL);
    expect(parsePorcelainPaths(raw)).toEqual(['src/a.ts', 'db/migrations/1.sql', 'notes.md']);
  });

  it('takes the new path of a rename and skips the original that follows it', () => {
    const raw = ['R  new/name.ts', 'old/name.ts', ' M other.ts', ''].join(NUL);
    expect(parsePorcelainPaths(raw)).toEqual(['new/name.ts', 'other.ts']);
  });

  it('keeps a path with spaces and non-ASCII bytes raw, never quoted', () => {
    expect(parsePorcelainPaths(`?? docs/café menu.md${NUL}`)).toEqual(['docs/café menu.md']);
  });

  it('returns nothing for a clean tree', () => {
    expect(parsePorcelainPaths('')).toEqual([]);
  });
});

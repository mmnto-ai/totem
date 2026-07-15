import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Family parity with the CLI's single-sourced self-description (mmnto-ai/totem#2336 D1,
// pattern from mmnto-ai/totem#2349): every published @mmnto package carries the ruled
// descriptive core and never regresses to the retired category label.
describe('package self-description parity (mmnto-ai/totem#2336 D1 family alignment)', () => {
  it('package.json description carries the ruled descriptive core', () => {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as {
      name: string;
      description: string;
    };
    expect(pkg.name).toBe('@mmnto/mcp');
    expect(pkg.description).toContain(
      'local-first toolkit that keeps AI-agent work queryable, enforceable, and derivable as plain files in your codebase',
    );
    // Guards against regressions to retired vocabulary.
    expect(pkg.description).not.toContain('persistent memory and context layer');
    expect(pkg.description).not.toContain('substrate');
    expect(pkg.description).not.toContain('—');
  });
});

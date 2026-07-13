import { readFileSync } from 'node:fs';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { TOTEM_DESCRIPTION } from './description.js';
import { TotemHelp } from './help.js';

describe('CLI self-description parity (mmnto-ai/totem#2336 D1)', () => {
  it('package.json description equals the single-sourced constant', () => {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8')) as {
      name: string;
      description: string;
    };
    expect(pkg.name).toBe('@mmnto/cli');
    expect(pkg.description).toBe(TOTEM_DESCRIPTION);
  });

  it('carries the ruled descriptive core (Prop 294 D1 headline)', () => {
    // The exact ruled string; the product-name prefix is permitted, the core is not.
    expect(TOTEM_DESCRIPTION).toContain(
      'a local-first, file-anchored substrate that makes AI-agent work queryable, enforceable, and derivable in your codebase',
    );
    // Guards against a regression to the retired category.
    expect(TOTEM_DESCRIPTION).not.toContain('persistent memory and context layer');
  });

  it('root help renders the constant as its header', () => {
    const program = new Command('totem');
    program.version('1.0.0');
    program.description(TOTEM_DESCRIPTION);
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output.startsWith(TOTEM_DESCRIPTION)).toBe(true);
  });
});

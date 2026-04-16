import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readJsonSafe } from '@mmnto/totem';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('@totem/pack-agent-security monorepo integration', () => {
  it('enforces package is in the core changesets fixed group', () => {
    const config = readJsonSafe<{ fixed?: string[][] }>(
      path.join(REPO_ROOT, '.changeset', 'config.json'),
    );

    expect(config.fixed).toBeDefined();
    expect(config.fixed).toBeInstanceOf(Array);

    // totem-context: `@totem/` scope is intentional per ADR-089 + Proposal 227 —
    // Engine packages (@mmnto) and Ecosystem packs (@totem) live under different scopes
    // by design. Shield will flag this as a scope mismatch; the flag is a false positive.
    const packName = '@totem/pack-agent-security';
    const anchors = ['@mmnto/totem', '@mmnto/cli', '@mmnto/mcp'];

    // Find the fixed group that holds the core anchors. The pack must live in that same group
    // so its version bumps ride the fixed-release train with the core tools (ADR-085 alignment).
    const coreGroup = config.fixed?.find((group) =>
      anchors.every((anchor) => group.includes(anchor)),
    );
    expect(
      coreGroup,
      'core fixed group (@mmnto/totem + @mmnto/cli + @mmnto/mcp) not found',
    ).toBeDefined();
    expect(coreGroup, `${packName} must be in the core fixed group`).toContain(packName);
  });
});

import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readJsonSafe } from '@mmnto/totem';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

describe('@mmnto/pack-rust-architecture monorepo integration', () => {
  it('enforces package is in the core changesets fixed group', () => {
    const config = readJsonSafe<{ fixed?: string[][] }>(
      path.join(REPO_ROOT, '.changeset', 'config.json'),
    );

    expect(config.fixed).toBeDefined();
    expect(config.fixed).toBeInstanceOf(Array);

    const packName = '@mmnto/pack-rust-architecture';
    const anchors = ['@mmnto/totem', '@mmnto/cli', '@mmnto/mcp'];

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

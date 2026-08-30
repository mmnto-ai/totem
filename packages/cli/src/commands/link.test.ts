/**
 * `totem link` names the TARGET repo's own Totem directory (mmnto-ai/totem#2692 C5,
 * amendment A3): the existence probe and the ingest globs written into this
 * repo's config use the directory the linked repo actually configures — its own
 * repo-local `totemDir`, else `.totem` — never this repo's setting and never the
 * global profile.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { linkCommand } from './link.js';

const ROOT_CONFIG = `export default {
  targets: [
    { glob: 'docs/*.md', type: 'lesson', strategy: 'markdown-heading' },
  ],
};
`;

const TARGET_YAML_BASE =
  'targets:\n  - glob: "docs/*.md"\n    type: lesson\n    strategy: markdown-heading\n';

describe('totem link — the target repo names its own totemDir (mmnto-ai/totem#2692 A3)', () => {
  let root: string;
  let originalCwd: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-link-'));
    fs.writeFileSync(path.join(root, 'totem.config.ts'), ROOT_CONFIG, 'utf-8');
    originalCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(root);
  });

  it("probes and writes the globs for the TARGET config's totemDir", async () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(path.join(target, 'knowledge'), { recursive: true });
    fs.writeFileSync(
      path.join(target, 'totem.yaml'),
      `${TARGET_YAML_BASE}totemDir: knowledge\n`,
      'utf-8',
    );

    await linkCommand('target', { yes: true });

    const written = fs.readFileSync(path.join(root, 'totem.config.ts'), 'utf-8');
    expect(written).toContain("glob: 'target/knowledge/lessons/*.md'");
    expect(written).toContain("glob: 'target/knowledge/lessons.md'");
    expect(written).not.toContain('target/.totem/');
  });

  it('falls back to .totem for a target with no config of its own', async () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(path.join(target, '.totem'), { recursive: true });

    await linkCommand('target', { yes: true });

    expect(fs.readFileSync(path.join(root, 'totem.config.ts'), 'utf-8')).toContain(
      "glob: 'target/.totem/lessons/*.md'",
    );
  });

  it('refuses a target totemDir that names the target itself or escapes it (A7)', async () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(path.join(target, 'outside'), { recursive: true });
    for (const bad of ['../outside', '.']) {
      fs.writeFileSync(
        path.join(target, 'totem.yaml'),
        `${TARGET_YAML_BASE}totemDir: ${JSON.stringify(bad)}\n`,
        'utf-8',
      );
      await expect(linkCommand('target', { yes: true })).rejects.toThrow(
        /names the target itself or escapes it/,
      );
    }
    // Nothing was written into this repo's config.
    expect(fs.readFileSync(path.join(root, 'totem.config.ts'), 'utf-8')).toBe(ROOT_CONFIG);
  });

  it('names the directory it probed when the target lacks it', async () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, 'totem.yaml'),
      `${TARGET_YAML_BASE}totemDir: knowledge\n`,
      'utf-8',
    );

    await expect(linkCommand('target', { yes: true })).rejects.toThrow(/knowledge\/ folder/);
  });
});

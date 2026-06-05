import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  DOCTRINE_MANIFEST_RELPATH,
  DOCTRINE_PIN_PACKAGE,
  doctrineBlockSnippet,
  doctrineFieldSnippet,
  insertTopLevelOrient,
  wireDoctrineManifest,
} from './init-doctrine.js';

const PATH = DOCTRINE_MANIFEST_RELPATH;

/** A minimal, loadConfig-valid config body (targets is the only required field). */
function configBody(extra = ''): string {
  return `export default {\n  targets: [{ glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' }],${extra}\n};\n`;
}

function bracesBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

describe('insertTopLevelOrient (pure)', () => {
  it('inserts a top-level orient field after the sole export default {', () => {
    const result = insertTopLevelOrient(configBody(), PATH);
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(result.content).toContain(`orient: { parityManifest: '${PATH}' }`);
    expect(result.content).toContain('.totem/lessons/*.md'); // untouched
    expect(bracesBalanced(result.content)).toBe(true);
  });

  it('bails (unspliceable) on a non-canonical export (defineConfig wrapper)', () => {
    const cfg = `import { defineConfig } from '@mmnto/totem';\nexport default defineConfig({ targets: [] });\n`;
    expect(insertTopLevelOrient(cfg, PATH).kind).toBe('unspliceable');
  });

  it('ignores a decoy export default { in a comment and inserts via the real export', () => {
    const cfg = `// export default { fake: true }\n${configBody()}`;
    const result = insertTopLevelOrient(cfg, PATH);
    expect(result.kind).toBe('written');
    if (result.kind !== 'written') return;
    expect(result.content).toContain(`orient: { parityManifest: '${PATH}' }`);
    expect(result.content).toContain('// export default { fake: true }'); // comment preserved
  });

  it('never inserts into a comment when the only export default { is commented out', () => {
    // Real export is a non-canonical defineConfig form; the sole literal
    // "export default {" lives in a comment — must bail, not corrupt it (GCA).
    const cfg = `// export default { legacy: true }\nexport default defineConfig({ targets: [] });\n`;
    expect(insertTopLevelOrient(cfg, PATH).kind).toBe('unspliceable');
  });

  it('never splices into a multiline template-literal decoy', () => {
    // The only literal "export default {" lives inside a template string; the
    // real export is a defineConfig form — must bail, not corrupt the string.
    const cfg =
      'const decoy = `\nexport default {\n`;\nexport default defineConfig({ targets: [] });\n';
    expect(insertTopLevelOrient(cfg, PATH).kind).toBe('unspliceable');
  });
});

describe('doctrine snippets (format-aware)', () => {
  it('field snippet renders per format', () => {
    expect(doctrineFieldSnippet(PATH, '.ts')).toBe(`  parityManifest: '${PATH}',`);
    expect(doctrineFieldSnippet(PATH, '.yaml')).toBe(`  parityManifest: ${PATH}`);
    expect(doctrineFieldSnippet(PATH, '.toml')).toBe(`parityManifest = "${PATH}"`);
  });

  it('block snippet renders per format', () => {
    expect(doctrineBlockSnippet(PATH, '.ts')).toBe(`  orient: { parityManifest: '${PATH}' },`);
    expect(doctrineBlockSnippet(PATH, '.yml')).toBe(`orient:\n  parityManifest: ${PATH}`);
    expect(doctrineBlockSnippet(PATH, '.toml')).toBe(`[orient]\nparityManifest = "${PATH}"`);
  });
});

describe('wireDoctrineManifest (real loadConfig)', () => {
  let tmpDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctrine-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doctrine-home-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    cleanTmpDir(homeDir);
  });

  function installPin(root: string): void {
    const pinDir = path.join(root, 'node_modules', ...DOCTRINE_PIN_PACKAGE.split('/'));
    fs.mkdirSync(pinDir, { recursive: true });
    fs.writeFileSync(path.join(pinDir, 'parity-manifest.yaml'), 'schema-version: 1\n', 'utf-8');
  }

  function writeConfig(body: string): string {
    const p = path.join(tmpDir, 'totem.config.ts');
    fs.writeFileSync(p, body, 'utf-8');
    return p;
  }

  it('honest-absent: pin not installed → pin-absent, config byte-unchanged', async () => {
    const p = writeConfig(configBody());
    const before = fs.readFileSync(p, 'utf-8');
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('pin-absent');
    expect(fs.readFileSync(p, 'utf-8')).toBe(before);
  });

  it('writes a top-level orient pointer when none exists', async () => {
    installPin(tmpDir);
    const p = writeConfig(configBody());
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('written');
    const written = fs.readFileSync(p, 'utf-8');
    expect(written).toContain(`parityManifest: '${PATH}'`);
    expect(written).toContain('.totem/lessons/*.md'); // untouched
  });

  it('is already-set (parse-based) when orient.parityManifest is configured', async () => {
    installPin(tmpDir);
    const p = writeConfig(configBody(`\n  orient: { parityManifest: '${PATH}' },`));
    const before = fs.readFileSync(p, 'utf-8');
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('already-set');
    expect(fs.readFileSync(p, 'utf-8')).toBe(before); // no rewrite
  });

  it('bails to a manual field snippet (no clobber) when an orient block already exists', async () => {
    installPin(tmpDir);
    const p = writeConfig(configBody('\n  orient: { projectNumber: 7 },'));
    const before = fs.readFileSync(p, 'utf-8');
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('manual');
    if (outcome.kind === 'manual') expect(outcome.reason).toBe('orient-exists');
    expect(fs.readFileSync(p, 'utf-8')).toBe(before); // never edits an existing orient
  });

  it('errors honestly when no config exists (no-config)', async () => {
    installPin(tmpDir);
    expect((await wireDoctrineManifest(tmpDir, homeDir)).kind).toBe('no-config');
  });

  it('refuses to wire a per-repo setting into a global-only profile', async () => {
    installPin(tmpDir);
    const globalTotem = path.join(homeDir, '.totem');
    fs.mkdirSync(globalTotem, { recursive: true });
    fs.writeFileSync(path.join(globalTotem, 'totem.config.ts'), configBody(), 'utf-8');
    expect((await wireDoctrineManifest(tmpDir, homeDir)).kind).toBe('global-only');
  });

  // ── bot-fix proofs (#2089 review): parse-based detection sees through text ──

  it('ignores a commented-out orient block — writes the REAL orient (Greptile P1)', async () => {
    installPin(tmpDir);
    const p = writeConfig(`${configBody()}// orient: { projectNumber: 7 }\n`);
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('written');
    const written = fs.readFileSync(p, 'utf-8');
    expect(written).toContain(`orient: { parityManifest: '${PATH}' }`); // real orient inserted
    expect(written).toContain('// orient: { projectNumber: 7 }'); // comment preserved, never parsed
  });

  it('does not false-positive already-set on a parityManifest mention in a comment (Greptile P2)', async () => {
    installPin(tmpDir);
    const p = writeConfig(`${configBody()}// TODO: set parityManifest once doctrine ships\n`);
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('written');
    expect(fs.readFileSync(p, 'utf-8')).toContain(`parityManifest: '${PATH}'`);
  });

  it('treats a quoted orient key as an existing block — no duplicate key (GCA high)', async () => {
    installPin(tmpDir);
    const body = configBody(`\n  'orient': { projectNumber: 7 },`);
    const p = writeConfig(body);
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('manual'); // not a second top-level orient
    expect(fs.readFileSync(p, 'utf-8')).toBe(body);
  });

  it('throws a TotemError (with cause) when the config cannot be parsed', async () => {
    installPin(tmpDir);
    writeConfig('export default { targets: [\n'); // syntax error
    await expect(wireDoctrineManifest(tmpDir, homeDir)).rejects.toThrow(/parse/i);
  });

  it('bails to a format-aware block for a non-JS (YAML) config — no auto-edit', async () => {
    installPin(tmpDir);
    const yamlBody =
      'targets:\n  - glob: ".totem/lessons/*.md"\n    type: lesson\n    strategy: markdown-heading\n';
    const p = path.join(tmpDir, 'totem.yaml');
    fs.writeFileSync(p, yamlBody, 'utf-8');
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('manual');
    if (outcome.kind === 'manual') {
      expect(outcome.reason).toBe('no-splice-point');
      expect(outcome.snippet).toBe(`orient:\n  parityManifest: ${PATH}`); // YAML form
    }
    expect(fs.readFileSync(p, 'utf-8')).toBe(yamlBody); // never edited
  });

  it('treats a blank parityManifest as unset, not already-set (CR)', async () => {
    installPin(tmpDir);
    const body = configBody(`\n  orient: { parityManifest: '   ' },`);
    const p = writeConfig(body);
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).not.toBe('already-set'); // blank ≠ configured → no silent no-op
    expect(outcome.kind).toBe('manual'); // orient block exists → guided, not auto-merged
    expect(fs.readFileSync(p, 'utf-8')).toBe(body);
  });

  it('reparse safety net: bails (no corrupt write) when the scanner would splice into a regex literal', async () => {
    installPin(tmpDir);
    const body =
      'const defineConfig = (c) => c;\n' +
      'const re = /export default {/;\n' +
      "export default defineConfig({ targets: [{ glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' }] });\n";
    const p = writeConfig(body);
    const outcome = await wireDoctrineManifest(tmpDir, homeDir);
    expect(outcome.kind).toBe('manual'); // scanner false-matched the regex; reparse caught it
    expect(fs.readFileSync(p, 'utf-8')).toBe(body); // config never corrupted
  });
});

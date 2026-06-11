import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildMissingSdkHint } from './missing-sdk.js';

describe('buildMissingSdkHint (mmnto-ai/totem#2018 L2 — context-correct remediation)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-missing-sdk-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('never suggests a global install in any branch (mmnto-ai/totem#2018 empirical: pnpm add -g does not fix the global binary)', () => {
    // Branch (a): dep installed locally
    fs.mkdirSync(path.join(tmpRoot, 'node_modules', '@google', 'genai'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'node_modules', '@google', 'genai', 'package.json'),
      '{"name":"@google/genai"}',
    );
    const installed = buildMissingSdkHint('@google/genai', { cwd: tmpRoot });
    // Branch (b): bare project, dep absent
    const bare = buildMissingSdkHint('@google/genai', {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'totem-bare-')),
    });
    for (const hint of [installed, bare]) {
      expect(hint).not.toMatch(/add\s+-g|--global|install\s+-g/);
    }
  });

  it('dep installed in the project → names the binary as the problem and points at the project-local CLI', () => {
    fs.mkdirSync(path.join(tmpRoot, 'node_modules', '@google', 'genai'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'node_modules', '@google', 'genai', 'package.json'),
      '{"name":"@google/genai"}',
    );
    const hint = buildMissingSdkHint('@google/genai', { cwd: tmpRoot });
    expect(hint).toContain('@google/genai IS installed in this project');
    expect(hint).toContain('pnpm exec totem');
    expect(hint).toContain('global');
    // Must not lead the user back to the wrong fix
    expect(hint).not.toContain('pnpm add @google/genai');
  });

  it('walks up from a nested cwd to find the project-local install', () => {
    fs.mkdirSync(path.join(tmpRoot, 'node_modules', '@google', 'genai'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'node_modules', '@google', 'genai', 'package.json'),
      '{"name":"@google/genai"}',
    );
    const nested = path.join(tmpRoot, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    const hint = buildMissingSdkHint('@google/genai', { cwd: nested });
    expect(hint).toContain('IS installed in this project');
  });

  it('workspace checkout (the totem monorepo) → points at the workspace build', () => {
    fs.mkdirSync(path.join(tmpRoot, 'packages', 'cli', 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'packages', 'cli', 'package.json'),
      '{"name":"@mmnto/cli"}',
    );
    fs.writeFileSync(path.join(tmpRoot, 'packages', 'cli', 'dist', 'index.js'), '');
    const hint = buildMissingSdkHint('@google/genai', { cwd: tmpRoot });
    expect(hint).toContain('node packages/cli/dist/index.js');
  });

  it('dep genuinely absent → plain project-local install hint + the externalized-by-design context', () => {
    const hint = buildMissingSdkHint('@google/genai', { cwd: tmpRoot, packageManager: 'npm' });
    expect(hint).toContain('npm add @google/genai');
    expect(hint).toContain('mmnto-ai/totem#2018');
    expect(hint).toContain('peer dependenc');
  });

  it('unscoped package names resolve in the node_modules probe', () => {
    fs.mkdirSync(path.join(tmpRoot, 'node_modules', 'openai'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'node_modules', 'openai', 'package.json'),
      '{"name":"openai"}',
    );
    const hint = buildMissingSdkHint('openai', { cwd: tmpRoot });
    expect(hint).toContain('openai IS installed in this project');
  });
});

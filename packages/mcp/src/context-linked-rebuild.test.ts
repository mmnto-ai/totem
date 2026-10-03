/**
 * mmnto-ai/totem#3009: the MCP server is a reader, and a reader never repairs
 * what it reads. A linked store that only a rebuild can repair is skipped with
 * one warning naming the linked repository and the cure; it is never deleted,
 * and the primary context still works.
 *
 * Drives the real `getContext()` over a real primary store and a real linked
 * store whose manifest is corrupted (LanceDB's open fails with "lance error",
 * a healable substring). Only `createEmbedder` is replaced, so no provider is
 * contacted. Kept in its own file so the `@mmnto/totem` mock and the module
 * cache reset stay away from the other context tests.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Embedder } from '@mmnto/totem';

const fake = vi.hoisted(() => {
  class FakeEmbedder {
    readonly dimensions = 4;
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
    }
  }
  return { FakeEmbedder };
});

vi.mock('@mmnto/totem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mmnto/totem')>();
  return {
    ...actual,
    createEmbedder: () => new fake.FakeEmbedder() as unknown as Embedder,
  };
});

const CONFIG_SOURCE = [
  'export default {',
  "  targets: [{ glob: '*.md', type: 'spec', strategy: 'markdown-heading' }],",
  "  embedding: { provider: 'gemini', model: 'test-model', dimensions: 4 },",
  '  LINKED',
  '};',
  '',
].join('\n');

function writeConfig(dir: string, linked: string[] | null): void {
  const linkedLine = linked ? `linkedIndexes: ${JSON.stringify(linked)},` : '';
  fs.writeFileSync(
    path.join(dir, 'totem.config.ts'),
    CONFIG_SOURCE.replace('LINKED', linkedLine),
    'utf-8',
  );
}

/** Every file under `dir`, recursively — the on-disk footprint of a store. */
function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

const chunk = (content: string) => ({
  content,
  contextPrefix: 'File: a.md',
  filePath: 'a.md',
  type: 'spec' as const,
  strategy: 'markdown-heading' as const,
  label: 'section',
  startLine: 1,
  endLine: 2,
  metadata: {},
});

describe('getContext with a linked store that needs a rebuild (mmnto-ai/totem#3009)', () => {
  let base: string;
  let projectDir: string;
  let linkedDir: string;

  beforeEach(() => {
    // Nest both repos under one temp parent so the strategy resolver's
    // sibling probe (<anchor>/../totem-strategy) finds nothing.
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-mcp-3009-'));
    projectDir = path.join(base, 'project');
    linkedDir = path.join(base, 'linked-repo');
    fs.mkdirSync(projectDir);
    fs.mkdirSync(linkedDir);
    writeConfig(projectDir, ['../linked-repo']);
    writeConfig(linkedDir, null);
    vi.stubEnv('TOTEM_STRATEGY_ROOT', '');
    vi.stubEnv('STRATEGY_ROOT', '');
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    try {
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // On Windows the cached context's open LanceDB connection keeps a
      // handle under the project directory until the worker exits (LanceStore
      // has no close()); the OS temp dir reclaims it. Cleanup is not the
      // subject of this test.
    }
  });

  it('skips the linked store with one warning naming it and the cure, leaves its directory unchanged, and keeps the primary working', async () => {
    const { LanceStore, TOTEM_TABLE_NAME } = await import('@mmnto/totem');
    const embedder = new fake.FakeEmbedder() as unknown as Embedder;

    // Primary: a healthy store with one row.
    const primarySeed = new LanceStore(path.join(projectDir, '.lancedb'), embedder, {
      absolutePathRoot: projectDir,
    });
    await primarySeed.connect();
    await primarySeed.insert([chunk('primary alpha')]);

    // Linked: a store with a row, then its manifest corrupted.
    const linkedLance = path.join(linkedDir, '.lancedb');
    const linkedSeed = new LanceStore(linkedLance, embedder, { absolutePathRoot: linkedDir });
    await linkedSeed.connect();
    await linkedSeed.insert([chunk('linked beta')]);
    const versionsDir = path.join(linkedLance, `${TOTEM_TABLE_NAME}.lance`, '_versions');
    const manifests = fs.readdirSync(versionsDir);
    expect(manifests.length).toBeGreaterThan(0);
    for (const f of manifests) fs.writeFileSync(path.join(versionsDir, f), 'garbage');
    const before = listFiles(linkedLance);

    const { getContext } = await import('./context.js');
    const ctx = await getContext();

    // The linked store was skipped, not added.
    expect(ctx.linkedStores.has('linked-repo')).toBe(false);
    // One warning, naming the linked repository (link name and root) and the cure.
    expect([...ctx.linkedStoreInitErrors.keys()]).toEqual(['linked-repo']);
    const warning = ctx.linkedStoreInitErrors.get('linked-repo')!;
    expect(warning).toContain('"linked-repo"');
    expect(warning).toContain(linkedDir);
    expect(warning).toContain('totem sync --full');
    // The linked directory is exactly as it was.
    expect(listFiles(linkedLance)).toEqual(before);
    // The primary context works.
    expect(await ctx.store.count()).toBe(1);
  });
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerContext } from './context.js';
import { _reconnectOnContext, loadEnv } from './context.js';

describe('loadEnv', () => {
  let tmpDir: string;
  const injectedKeys: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-env-'));
  });

  afterEach(() => {
    // Clean up any keys we injected into process.env
    for (const key of injectedKeys) {
      delete process.env[key];
    }
    injectedKeys.length = 0;

    // Remove temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEnv(content: string): void {
    fs.writeFileSync(path.join(tmpDir, '.env'), content, 'utf-8');
  }

  function trackKey(key: string): void {
    injectedKeys.push(key);
  }

  it('parses a basic key=value pair', () => {
    const key = 'TOTEM_TEST_BASIC';
    trackKey(key);
    writeEnv(`${key}=value`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('value');
  });

  it('strips inline comments', () => {
    const key = 'TOTEM_TEST_WITH_COMMENT';
    trackKey(key);
    writeEnv(`${key}=secret # expires tomorrow`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('secret');
  });

  it('preserves hash inside double-quoted values', () => {
    const key = 'TOTEM_TEST_QUOTED_HASH';
    trackKey(key);
    writeEnv(`${key}="my#secret" # actual comment`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('my#secret');
  });

  it('handles empty values', () => {
    const key = 'TOTEM_TEST_EMPTY_VAL';
    trackKey(key);
    writeEnv(`${key}=`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('');
  });

  it('completes silently when .env file does not exist', () => {
    const nonExistent = path.join(tmpDir, 'no-such-dir');

    // Should not throw
    expect(() => loadEnv(nonExistent)).not.toThrow();
  });

  it('does not overwrite existing process.env keys', () => {
    const key = 'TOTEM_TEST_NO_OVERWRITE';
    trackKey(key);
    process.env[key] = 'original';
    writeEnv(`${key}=overwritten`);

    loadEnv(tmpDir);

    expect(process.env[key]).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// _reconnectOnContext (mmnto/totem#1295 CR MAJOR fix)
// ---------------------------------------------------------------------------

describe('_reconnectOnContext', () => {
  /**
   * Build a minimal `ServerContext` with stub LanceStores. Cast through
   * `unknown` to satisfy the structural type — production stores have
   * many more methods, but the reconnect path only touches `.reconnect()`.
   */
  function makeStubContext(opts: {
    primaryReconnect: () => Promise<void>;
    linkedStores: Array<{ name: string; reconnect: () => Promise<void> }>;
    initErrors: Array<[string, string]>;
  }): ServerContext {
    const linkedStoresMap = new Map<string, unknown>();
    for (const { name, reconnect } of opts.linkedStores) {
      linkedStoresMap.set(name, { reconnect });
    }
    return {
      projectRoot: '/fake',
      config: {} as never,
      store: { reconnect: opts.primaryReconnect } as never,
      embedder: {} as never,
      linkedStores: linkedStoresMap as never,
      linkedStoreInitErrors: new Map(opts.initErrors),
    };
  }

  it('preserves init-time warnings when linked stores reconnect successfully', async () => {
    // CR MAJOR catch: earlier code DELETED entries from
    // linkedStoreInitErrors on successful reconnect, suppressing static
    // warnings (e.g., empty store) that a runtime reconnect can't fix.
    // After the fix, init warnings must survive any reconnect cycle.
    const linkedReconnect = vi.fn(async () => {});
    const ctx = makeStubContext({
      primaryReconnect: vi.fn(async () => {}),
      linkedStores: [{ name: 'strategy', reconnect: linkedReconnect }],
      initErrors: [['strategy', 'Linked index is empty (0 rows).']],
    });

    await _reconnectOnContext(ctx);

    // Linked store reconnect was called (Shield AI catch — also covered
    // by the search-knowledge integration test, but asserted here too).
    expect(linkedReconnect).toHaveBeenCalledOnce();
    // Init warning is UNCHANGED — the reconnect did not delete or mutate it.
    expect(ctx.linkedStoreInitErrors.get('strategy')).toBe('Linked index is empty (0 rows).');
    expect(ctx.linkedStoreInitErrors.size).toBe(1);
  });

  it('preserves init-time warnings when linked store reconnect throws', async () => {
    // CR MAJOR catch: earlier code OVERWROTE entries with
    // "Reconnect after primary retry failed: <msg>" on reconnect failure,
    // replacing the original diagnostic with a less useful generic message.
    // After the fix, init warnings survive reconnect failures untouched.
    const linkedReconnect = vi.fn(async () => {
      throw new Error('Stale handle');
    });
    const ctx = makeStubContext({
      primaryReconnect: vi.fn(async () => {}),
      linkedStores: [{ name: 'strategy', reconnect: linkedReconnect }],
      initErrors: [['strategy', 'Linked index is empty (0 rows).']],
    });

    await _reconnectOnContext(ctx);

    expect(linkedReconnect).toHaveBeenCalledOnce();
    // The original empty-store warning is unchanged. Crucially, it has
    // NOT been overwritten with a "Reconnect after primary retry failed"
    // message — that would lose the original diagnostic and break Case 3
    // routing in performSearch.
    expect(ctx.linkedStoreInitErrors.get('strategy')).toBe('Linked index is empty (0 rows).');
    expect(ctx.linkedStoreInitErrors.size).toBe(1);
  });

  it('does not add new entries to linkedStoreInitErrors on reconnect failure', async () => {
    // Even when there was NO init error (clean startup), a runtime
    // reconnect failure must not introduce one. The per-query runtime
    // warning path (`runtimeFailures`) is the correct surface for
    // transient runtime state, not the init-error map.
    const linkedReconnect = vi.fn(async () => {
      throw new Error('Transient lock');
    });
    const ctx = makeStubContext({
      primaryReconnect: vi.fn(async () => {}),
      linkedStores: [{ name: 'strategy', reconnect: linkedReconnect }],
      initErrors: [],
    });

    await _reconnectOnContext(ctx);

    expect(linkedReconnect).toHaveBeenCalledOnce();
    expect(ctx.linkedStoreInitErrors.size).toBe(0);
  });

  it('reconnects every linked store even if one in the middle throws', async () => {
    // Best-effort iteration: a single broken store does not stop the
    // reconnect loop from touching the others. Crucial for the multi-link
    // mesh — one stale handle should not prevent the rest from refreshing.
    const okA = vi.fn(async () => {});
    const broken = vi.fn(async () => {
      throw new Error('boom');
    });
    const okB = vi.fn(async () => {});
    const ctx = makeStubContext({
      primaryReconnect: vi.fn(async () => {}),
      linkedStores: [
        { name: 'a', reconnect: okA },
        { name: 'broken', reconnect: broken },
        { name: 'b', reconnect: okB },
      ],
      initErrors: [],
    });

    await _reconnectOnContext(ctx);

    expect(okA).toHaveBeenCalledOnce();
    expect(broken).toHaveBeenCalledOnce();
    expect(okB).toHaveBeenCalledOnce();
    expect(ctx.linkedStoreInitErrors.size).toBe(0);
  });
});

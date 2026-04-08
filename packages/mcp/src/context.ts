import * as fs from 'node:fs';
import * as path from 'node:path';

import dotenv from 'dotenv';

import type { Embedder, TotemConfig } from '@mmnto/totem';
import {
  createEmbedder,
  LanceStore,
  requireEmbedding,
  TotemConfigError,
  TotemConfigSchema,
} from '@mmnto/totem';

export interface ServerContext {
  projectRoot: string;
  config: TotemConfig;
  store: LanceStore;
  embedder: Embedder;
  /**
   * Linked Totem indexes keyed by their derived link name (mmnto/totem#1294
   * Cross-Repo Context Mesh, Phase 2). The name is computed from the
   * basename of the resolved linked path with any leading dot stripped
   * (e.g. `.strategy` → `'strategy'`, `../totem-playground` → `'totem-playground'`).
   *
   * Populated during `initContext()` from `config.linkedIndexes`. Each entry
   * is a LanceStore constructed with a `sourceContext` that tags every
   * result with its source repo + absolute path. Empty when no linked
   * indexes are configured or when every linked index failed to initialize.
   *
   * Used by `search_knowledge` for boundary routing:
   * - `boundary === '<link-name>'` → route only to that linked store
   * - `boundary === undefined` → federated search across primary + all linked
   */
  linkedStores: Map<string, LanceStore>;
  /**
   * Per-link initialization errors captured during `initContext()` for the
   * first-query-warn-block pattern (mmnto/totem#1294 Phase 2). When a
   * linked index fails to initialize — missing directory, broken config,
   * dimension mismatch, name collision — the error is stored here keyed
   * by the intended link name. The first `search_knowledge` call after
   * server startup surfaces these as a system warning so the agent sees
   * the failure in-context. The server does NOT crash on any of these
   * failures — that would destroy the agent's access to local tools.
   */
  linkedStoreInitErrors: Map<string, string>;
}

let cached: ServerContext | undefined;
let initPromise: Promise<ServerContext> | undefined;

/**
 * Re-open the cached LanceStore connection after a full sync rebuild.
 * No-op if the context hasn't been initialized yet.
 *
 * mmnto/totem#1294 Phase 2: also reconnects every linked store. Without
 * this, a `totem sync` in a linked repo would invalidate that repo's
 * LanceDB table handle, and subsequent federated queries would silently
 * drop that repo's results (or fail explicit-boundary queries) until the
 * MCP server was restarted. Linked-store reconnects are best-effort —
 * individual failures are captured into `linkedStoreInitErrors` so the
 * first-query-warn-block can surface them, matching the init-failure
 * pattern for consistency.
 */
export async function reconnectStore(): Promise<void> {
  if (!cached) return;

  await cached.store.reconnect();

  for (const [name, linkedStore] of cached.linkedStores.entries()) {
    try {
      await linkedStore.reconnect();
      // No-op on the error map: stores in `linkedStores` never have an
      // entry in `linkedStoreInitErrors` (init-success and init-failure
      // are mutually exclusive by construction). Kept intentionally as
      // a soft invariant — if the invariant ever breaks, clearing the
      // stale error here is the safe recovery.
      cached.linkedStoreInitErrors.delete(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cached.linkedStoreInitErrors.set(name, `Reconnect after primary retry failed: ${msg}`);
      // Remove the stale handle from the active map — federated queries
      // will skip it until the next server restart. No retry loop here:
      // the delete is load-bearing (the next reconnectStore call won't
      // find this entry to retry), but that's intentional. A persistent
      // linked-store failure that isn't fixed by the initial reconnect
      // is unlikely to resolve on a subsequent retry in the same session,
      // and a server restart is the clean recovery path. Captured as
      // mmnto/totem#1294 follow-up: eager retry + exponential backoff
      // across search_knowledge calls is a P1 enhancement.
      cached.linkedStores.delete(name);
    }
  }
}

/**
 * Derive a stable link name from a linked-index path. Used for both the
 * `ServerContext.linkedStores` map key and the `sourceRepo` tag stamped
 * on every SearchResult from that store.
 *
 * Rule: take the basename of the resolved absolute path and strip any
 * leading dot. Examples:
 *   `.strategy`              → `strategy`
 *   `../totem-playground`    → `totem-playground`
 *   `/abs/path/to/foo`       → `foo`
 *
 * The leading-dot strip exists because the canonical submodule path in
 * this project is `.strategy` (git submodule convention) and agents will
 * want to pass `boundary: 'strategy'` without the dot.
 */
function deriveLinkName(linkedPath: string, cwd: string): string {
  const resolved = path.resolve(cwd, linkedPath);
  const base = path.basename(resolved);
  return base.replace(/^\./, '');
}

/**
 * Load environment variables from .env file (does not override existing).
 */
export function loadEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  dotenv.config({ path: envPath });
}

/**
 * Load and parse totem.config.ts via jiti.
 */
async function loadConfig(configPath: string): Promise<TotemConfig> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath)) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  return TotemConfigSchema.parse(raw);
}

/**
 * Perform one-time initialization: load config, create embedder and store,
 * and wire up any linked indexes for the Cross-Repo Context Mesh
 * (mmnto/totem#1294 Phase 2).
 *
 * Sets the module-level `cached` variable and returns the context.
 */
async function initContext(): Promise<ServerContext> {
  const projectRoot = process.cwd();

  const configPath = path.join(projectRoot, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new TotemConfigError(
      'No totem.config.ts found in current directory.',
      "Run 'totem init' first.",
      'CONFIG_MISSING',
    );
  }

  loadEnv(projectRoot);

  const config = await loadConfig(configPath);
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const storePath = path.join(projectRoot, config.lanceDir);
  // Primary store gets its own SourceContext so `absoluteFilePath` is
  // populated on every local result. `sourceRepo` stays undefined —
  // primary hits don't carry a source tag.
  const store = new LanceStore(storePath, embedder, undefined, {
    absolutePathRoot: projectRoot,
  });
  await store.connect();

  // ─── Linked index initialization (mmnto/totem#1294 Phase 2) ──
  //
  // For every path in `config.linkedIndexes`, attempt to:
  //   1. Derive a stable link name via basename + leading-dot strip
  //   2. Detect and reject name collisions (2+ links resolving to the same name)
  //   3. Resolve the linked directory, load its config, validate its embedder
  //   4. Construct a LanceStore with sourceContext tagged for federation
  //   5. Connect it
  //
  // Any failure at any step is captured into `linkedStoreInitErrors` keyed
  // by the link name and surfaced on the first `search_knowledge` call via
  // the first-query-warn-block pattern. The server itself does NOT crash
  // on any linked-store failure — that would tear down local tools too
  // and produce a worse user experience than missing context.
  const linkedStores = new Map<string, LanceStore>();
  const linkedStoreInitErrors = new Map<string, string>();

  for (const linkedPath of config.linkedIndexes ?? []) {
    const name = deriveLinkName(linkedPath, projectRoot);

    // Collision detection — the first-wins so downstream lookups are stable
    if (linkedStores.has(name) || linkedStoreInitErrors.has(name)) {
      linkedStoreInitErrors.set(
        `${name} (collision at ${linkedPath})`,
        `Another linked index already claims the name "${name}". Rename one of the linked directories or remove the duplicate from config.linkedIndexes.`,
      );
      continue;
    }

    try {
      const resolvedPath = path.resolve(projectRoot, linkedPath);
      if (!fs.existsSync(resolvedPath)) {
        throw new TotemConfigError(
          `Linked index path does not exist: ${resolvedPath}`,
          'Check that the path is correct, and that the linked repository is cloned or the submodule is initialized.',
          'CONFIG_MISSING',
        );
      }

      const linkedConfigPath = path.join(resolvedPath, 'totem.config.ts');
      if (!fs.existsSync(linkedConfigPath)) {
        throw new TotemConfigError(
          `Linked index has no totem.config.ts: ${linkedConfigPath}`,
          "The linked directory must be a Totem-managed project. Run 'totem init' in that directory, or remove it from linkedIndexes.",
          'CONFIG_MISSING',
        );
      }

      const linkedConfig = await loadConfig(linkedConfigPath);
      if (!linkedConfig.embedding) {
        throw new TotemConfigError(
          `Linked index at ${resolvedPath} has no embedding provider configured.`,
          'Cross-repo search requires the linked index to have the same embedder as the primary repo. Add an `embedding` block to the linked totem.config.ts.',
          'CONFIG_MISSING',
        );
      }

      // Validate the linked embedder matches the primary embedder provider
      // and model. Different providers produce incompatible vector spaces
      // (see Tenet 7 / ADR-068 — version-pin, don't hand-wave). This catch
      // is a structural guarantee that mesh queries never cross-compare
      // mismatched dimensions.
      if (
        linkedConfig.embedding.provider !== embedding.provider ||
        linkedConfig.embedding.model !== embedding.model
      ) {
        throw new TotemConfigError(
          `Linked index embedder mismatch: primary uses ${embedding.provider}/${embedding.model ?? 'default'}, linked uses ${linkedConfig.embedding.provider}/${linkedConfig.embedding.model ?? 'default'}.`,
          'Cross-repo semantic search requires the same embedder on both sides. Rebuild the linked index with the primary embedder, or remove the link from config.linkedIndexes.',
          'CONFIG_INVALID',
        );
      }

      const linkedEmbedder = createEmbedder(linkedConfig.embedding);
      const linkedLanceDir = path.join(resolvedPath, linkedConfig.lanceDir);
      const linkedStore = new LanceStore(linkedLanceDir, linkedEmbedder, undefined, {
        sourceRepo: name,
        absolutePathRoot: resolvedPath,
      });
      await linkedStore.connect();

      // Post-connect sanity check: the linked store must have data.
      // Empty linked stores silently contribute nothing to federated
      // search, which is confusing. Warn on the first query if so.
      const rowCount = await linkedStore.count();
      if (rowCount === 0) {
        linkedStoreInitErrors.set(
          name,
          `Linked index at ${resolvedPath} is empty (0 rows). Run 'totem sync' in that repository to populate its index.`,
        );
        continue;
      }

      linkedStores.set(name, linkedStore);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      linkedStoreInitErrors.set(name, msg);
    }
  }

  cached = {
    projectRoot,
    config,
    store,
    embedder,
    linkedStores,
    linkedStoreInitErrors,
  };
  return cached;
}

/**
 * Lazily initialize and return the shared server context.
 * Config, embedder, and LanceStore are created on first call and cached.
 * Uses promise memoization to prevent concurrent callers from creating
 * duplicate connections.
 */
export async function getContext(): Promise<ServerContext> {
  if (cached) return cached;
  if (!initPromise) {
    initPromise = initContext().catch((err) => {
      initPromise = undefined; // Allow retry on transient failures
      throw err;
    });
  }
  return initPromise;
}

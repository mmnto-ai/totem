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
 * MCP server was restarted.
 *
 * mmnto/totem#1295 GCA HIGH: per-link reconnect failures are best-effort
 * and DO NOT mutate `linkedStores`. Earlier revisions evicted broken
 * stores from the active map on reconnect failure, but that caused two
 * problems: (1) transient issues (temporary file lock during a parallel
 * sync) would cause permanent context loss until server restart, and
 * (2) a subsequent fix in the linked repo couldn't be picked up without
 * restart. The current behavior: record the error for the first-query
 * warning path, leave the store in `linkedStores`, and let the next
 * `search_knowledge` call attempt a targeted reconnect again via
 * `federatedSearch`. Trades some log spam for resilience — the correct
 * Tenet 4 tradeoff per the bot review on PR mmnto/totem#1295.
 */
export async function reconnectStore(): Promise<void> {
  if (!cached) return;

  await cached.store.reconnect();

  for (const [name, linkedStore] of cached.linkedStores.entries()) {
    try {
      await linkedStore.reconnect();
      // Successful reconnect clears any previous runtime error for this
      // link. Init errors persist until server restart — they represent
      // static config issues (empty store, broken path) that a runtime
      // reconnect can't fix.
      if (cached.linkedStoreInitErrors.has(name)) {
        cached.linkedStoreInitErrors.delete(name);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cached.linkedStoreInitErrors.set(name, `Reconnect after primary retry failed: ${msg}`);
      // DO NOT evict from `linkedStores` — keep the store reference so
      // future `federatedSearch` calls can attempt a targeted reconnect
      // when the transient issue clears.
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
  const store = new LanceStore(storePath, embedder, { absolutePathRoot: projectRoot });
  await store.connect();

  // ─── Linked index initialization (mmnto/totem#1294 Phase 2 + #1295 fixes) ──
  //
  // For every path in `config.linkedIndexes`, attempt to:
  //   1. Derive a stable link name via basename + leading-dot strip
  //   2. Detect and reject name collisions (2+ links resolving to the same name)
  //   3. Load the linked repo's .env (may contain provider API keys)
  //   4. Resolve the linked directory, load its config
  //   5. Validate embedder provider/model AND dimensions match primary
  //   6. Construct a LanceStore with sourceContext tagged for federation
  //   7. Connect it
  //   8. Empty stores: add to linkedStores AND record warning (NOT fatal —
  //      a subsequent `totem sync` in the linked repo can populate it
  //      without requiring an MCP server restart)
  //
  // Any initialization failure is captured into `linkedStoreInitErrors`
  // keyed by the link name and surfaced on the first `search_knowledge`
  // call. The server itself does NOT crash on any linked-store failure —
  // that would tear down local tools too and produce a worse user
  // experience than missing context. Runtime search failures use a
  // separate per-query warning path (see `search-knowledge.ts`).
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

      // mmnto/totem#1295 GCA HIGH: linked repos may have their own `.env`
      // files containing embedder API keys. Load them BEFORE evaluating
      // the linked config — `loadEnv` uses `dotenv` without override, so
      // primary env vars stay authoritative when they overlap.
      loadEnv(resolvedPath);

      const linkedConfig = await loadConfig(linkedConfigPath);
      if (!linkedConfig.embedding) {
        throw new TotemConfigError(
          `Linked index at ${resolvedPath} has no embedding provider configured.`,
          'Cross-repo search requires the linked index to have the same embedder as the primary repo. Add an `embedding` block to the linked totem.config.ts.',
          'CONFIG_MISSING',
        );
      }

      // Validate the linked embedder matches the primary embedder
      // provider and model. Different providers produce incompatible
      // vector spaces (Tenet 7 / ADR-068 — version-pin, don't hand-wave).
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

      // mmnto/totem#1295 CR MAJOR: provider + model match is not
      // sufficient. The same embedder can be instantiated with different
      // output dimensions (config `dimensions` override). Cross-repo
      // federation across mismatched dimensions would merge scores from
      // incompatible vector spaces as if they were comparable. Validate
      // the resolved dimensions after construction.
      if (linkedEmbedder.dimensions !== embedder.dimensions) {
        throw new TotemConfigError(
          `Linked index embedder dimension mismatch: primary produces ${embedder.dimensions}-dim vectors, linked at ${resolvedPath} produces ${linkedEmbedder.dimensions}-dim. Federation would merge scores from incompatible vector spaces.`,
          "Align the linked repo embedder dimensions with the primary by updating the linked repo's totem.config.ts embedding.dimensions field, then rebuild the linked index via `totem sync --full` in that repo.",
          'CONFIG_INVALID',
        );
      }

      const linkedLanceDir = path.join(resolvedPath, linkedConfig.lanceDir);
      const linkedStore = new LanceStore(linkedLanceDir, linkedEmbedder, {
        sourceRepo: name,
        absolutePathRoot: resolvedPath,
      });
      await linkedStore.connect();

      // mmnto/totem#1295 GCA HIGH: empty linked stores are NOT fatal.
      // A subsequent `totem sync` in the linked repo can populate it
      // without requiring an MCP server restart. Add the store to the
      // active map but also record a warning so the first query surfaces
      // the "run totem sync" hint. (Maps are not mutually exclusive — a
      // store can be in BOTH linkedStores AND linkedStoreInitErrors if
      // it's queryable but has a non-fatal issue like being empty.)
      linkedStores.set(name, linkedStore);
      const rowCount = await linkedStore.count();
      if (rowCount === 0) {
        linkedStoreInitErrors.set(
          name,
          `Linked index at ${resolvedPath} is empty (0 rows). Federated queries will return no hits from this repo until you run 'totem sync' in that directory.`,
        );
      }
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

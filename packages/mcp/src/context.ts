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
}

let cached: ServerContext | undefined;
let initPromise: Promise<ServerContext> | undefined;

/**
 * Re-open the cached LanceStore connection after a full sync rebuild.
 * No-op if the context hasn't been initialized yet.
 */
export async function reconnectStore(): Promise<void> {
  if (cached) {
    await cached.store.reconnect();
  }
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
 * Perform one-time initialization: load config, create embedder and store.
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
  const store = new LanceStore(storePath, embedder);
  await store.connect();

  cached = { projectRoot, config, store, embedder };
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

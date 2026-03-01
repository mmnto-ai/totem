import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Embedder, TotemConfig } from '@mmnto/totem';
import { createEmbedder, LanceStore, TotemConfigSchema } from '@mmnto/totem';

export interface ServerContext {
  projectRoot: string;
  config: TotemConfig;
  store: LanceStore;
  embedder: Embedder;
}

let cached: ServerContext | undefined;

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
function loadEnv(cwd: string): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1]!.trim();
      const value = match[2]!.trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
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
 * Lazily initialize and return the shared server context.
 * Config, embedder, and LanceStore are created on first call and cached.
 */
export async function getContext(): Promise<ServerContext> {
  if (cached) return cached;

  const projectRoot = process.cwd();

  const configPath = path.join(projectRoot, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      '[Totem Error] No totem.config.ts found in current directory. Run `totem init` first.',
    );
  }

  loadEnv(projectRoot);

  const config = await loadConfig(configPath);
  const embedder = createEmbedder(config.embedding);
  const storePath = path.join(projectRoot, config.lanceDir);
  const store = new LanceStore(storePath, embedder);
  await store.connect();

  cached = { projectRoot, config, store, embedder };
  return cached;
}

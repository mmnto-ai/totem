import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TotemConfigSchema,
  LanceStore,
  createEmbedder,
} from '@mmnto/totem';
import type { ContentType } from '@mmnto/totem';

export async function searchCommand(
  query: string,
  options: { type?: string; maxResults?: string },
): Promise<void> {
  const cwd = process.cwd();

  const configPath = path.join(cwd, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    console.error('[Totem Error] No totem.config.ts found. Run `totem init` first.');
    process.exit(1);
  }

  loadEnv(cwd);

  const rawConfig = await loadConfig(configPath);
  const config = TotemConfigSchema.parse(rawConfig);

  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(`${cwd}/${config.lanceDir}`, embedder);
  await store.connect();

  const results = await store.search({
    query,
    typeFilter: options.type as ContentType | undefined,
    maxResults: options.maxResults ? parseInt(options.maxResults, 10) : 5,
  });

  if (results.length === 0) {
    console.log('[Totem] No results found.');
    return;
  }

  for (const result of results) {
    console.log(`\n--- ${result.label} (${result.type}) ---`);
    console.log(`File: ${result.filePath} | Score: ${result.score.toFixed(3)}`);
    console.log(result.content.slice(0, 200) + (result.content.length > 200 ? '...' : ''));
  }
}

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

async function loadConfig(configPath: string): Promise<unknown> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = await jiti.import(configPath) as Record<string, unknown>;
  return mod['default'] ?? mod;
}

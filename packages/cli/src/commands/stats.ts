import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TotemConfigSchema,
  LanceStore,
  createEmbedder,
} from '@mmnto/totem';

export async function statsCommand(): Promise<void> {
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

  const { totalChunks, byType } = await store.stats();

  console.log(`[Totem] Index statistics:`);
  console.log(`  Total chunks: ${totalChunks}`);
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }

  if (totalChunks === 0) {
    console.log('\n  No data indexed yet. Run `totem sync` first.');
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

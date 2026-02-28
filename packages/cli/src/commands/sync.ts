import * as fs from 'node:fs';
import * as path from 'node:path';
import { TotemConfigSchema, runSync } from '@mmnto/totem';

export async function syncCommand(options: { full?: boolean }): Promise<void> {
  const cwd = process.cwd();

  const configPath = path.join(cwd, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    console.error('[Totem Error] No totem.config.ts found. Run `totem init` first.');
    process.exit(1);
  }

  // Load .env for OPENAI_API_KEY
  loadEnv(cwd);

  const rawConfig = await loadConfig(configPath);
  const config = TotemConfigSchema.parse(rawConfig);

  const incremental = !options.full;

  const result = await runSync(config, {
    projectRoot: cwd,
    incremental,
    onProgress: (msg) => console.log(`[Totem] ${msg}`),
  });

  console.log(
    `[Totem] Done: ${result.chunksProcessed} chunks from ${result.filesProcessed} files`,
  );
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

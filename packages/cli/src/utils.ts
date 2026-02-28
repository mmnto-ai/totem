import * as fs from 'node:fs';
import * as path from 'node:path';
import { TotemConfigSchema } from '@mmnto/totem';
import type { TotemConfig } from '@mmnto/totem';

/**
 * Load environment variables from .env file (does not override existing).
 */
export function loadEnv(cwd: string): void {
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
export async function loadConfig(configPath: string): Promise<TotemConfig> {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url);
  const mod = await jiti.import(configPath) as Record<string, unknown>;
  const raw = mod['default'] ?? mod;
  return TotemConfigSchema.parse(raw);
}

/**
 * Resolve config path and validate it exists. Exits if missing.
 */
export function resolveConfigPath(cwd: string): string {
  const configPath = path.join(cwd, 'totem.config.ts');
  if (!fs.existsSync(configPath)) {
    console.error('[Totem Error] No totem.config.ts found. Run `totem init` first.');
    process.exit(1);
  }
  return configPath;
}

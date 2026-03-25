import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CustomSecret } from '@mmnto/totem';
import { SecretsFileSchema } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TAG = 'ListSecrets';

const YAML_CONFIG_FILES = [
  'totem.config.yaml',
  'totem.config.yml',
  'totem.yaml',
  'totem.yml',
] as const;

// ─── Types ──────────────────────────────────────────────

export interface SecretEntry {
  index: number;
  type: 'pattern' | 'literal';
  value: string;
  source: 'shared/yaml' | 'local/json';
}

// ─── Helpers ────────────────────────────────────────────

/** Mask a literal secret value: show first 4 chars + `***`. */
export function maskLiteral(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 4) + '***';
}

/** Read secrets from the first matching YAML config file. */
async function loadYamlSecrets(cwd: string): Promise<CustomSecret[]> {
  for (const file of YAML_CONFIG_FILES) {
    const configPath = path.join(cwd, file);
    if (!fs.existsSync(configPath)) continue;

    try {
      const { parse } = await import('yaml');
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = parse(content) as Record<string, unknown> | null;
      if (parsed && Array.isArray(parsed.secrets)) {
        return (parsed.secrets as CustomSecret[]).filter(
          (s) => s && typeof s.type === 'string' && typeof s.value === 'string',
        );
      }
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Read secrets from `.totem/secrets.json`. */
function loadJsonSecrets(cwd: string, totemDir: string): CustomSecret[] {
  const jsonPath = path.join(cwd, totemDir, 'secrets.json');
  if (!fs.existsSync(jsonPath)) return [];

  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    const result = SecretsFileSchema.safeParse(parsed);
    if (result.success) {
      return result.data.secrets;
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Entry builder (shared with remove-secret) ─────────

/**
 * Build an indexed list of all secrets from both sources.
 * Does not print anything — used by both list and remove commands.
 */
export async function buildSecretEntries(cwd: string, totemDir = '.totem'): Promise<SecretEntry[]> {
  const yamlSecrets = await loadYamlSecrets(cwd);
  const jsonSecrets = loadJsonSecrets(cwd, totemDir);

  const entries: SecretEntry[] = [];
  let idx = 1;

  for (const secret of yamlSecrets) {
    entries.push({
      index: idx++,
      type: secret.type,
      value: secret.value,
      source: 'shared/yaml',
    });
  }

  for (const secret of jsonSecrets) {
    entries.push({
      index: idx++,
      type: secret.type,
      value: secret.value,
      source: 'local/json',
    });
  }

  return entries;
}

// ─── Main ───────────────────────────────────────────────

export async function listSecretsCommand(
  cwd = process.cwd(),
  totemDir = '.totem',
): Promise<SecretEntry[]> {
  const { log } = await import('../ui.js');

  const entries = await buildSecretEntries(cwd, totemDir);

  if (entries.length === 0) {
    log.info(TAG, 'No custom secrets configured.');
    return [];
  }

  // Print header
  log.info(TAG, `${entries.length} custom secret(s) configured:\n`);

  // Print each entry
  for (const entry of entries) {
    const displayValue = entry.type === 'literal' ? maskLiteral(entry.value) : entry.value;
    console.error(`  ${entry.index}. [${entry.type}] ${displayValue}  (${entry.source})`);
  }

  console.error('');

  return entries;
}

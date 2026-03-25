import * as fs from 'node:fs';
import * as path from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CustomSecretSchema = z.object({
  type: z.enum(['pattern', 'literal']),
  value: z
    .string()
    .min(4, 'Secret patterns/literals must be at least 4 characters to prevent over-redaction'),
});

export type CustomSecret = z.infer<typeof CustomSecretSchema>;

export const SecretsFileSchema = z.object({
  secrets: z.array(CustomSecretSchema).default([]),
});

export type SecretsFile = z.infer<typeof SecretsFileSchema>;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/** Config file names checked in resolution order (YAML only for secrets loading). */
const YAML_CONFIG_FILES = [
  'totem.config.yaml',
  'totem.config.yml',
  'totem.yaml',
  'totem.yml',
] as const;

/**
 * Load user-defined custom secrets from both shared config (YAML) and
 * local secrets file (`.totem/secrets.json`, gitignored).
 *
 * 1. Reads the `secrets` array from the first matching YAML config in cwd.
 * 2. Reads `.totem/secrets.json` if it exists.
 * 3. Merges both arrays (shared first, then local).
 * 4. Validates each entry; skips invalid entries with a warning.
 */
export function loadCustomSecrets(
  cwd: string,
  totemDir = '.totem',
  onWarn?: (message: string) => void,
): CustomSecret[] {
  const sharedSecrets = loadSecretsFromYamlConfig(cwd, onWarn);
  const localSecrets = loadSecretsFromJson(cwd, totemDir, onWarn);

  const merged = [...sharedSecrets, ...localSecrets];
  const validated: CustomSecret[] = [];

  for (const entry of merged) {
    const result = CustomSecretSchema.safeParse(entry);
    if (result.success) {
      validated.push(result.data);
    } else {
      const issues = result.error.issues.map((i) => i.message).join('; ');
      onWarn?.(`Skipping invalid secret entry: ${issues}`);
    }
  }

  return validated;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read the `secrets` field from the first matching YAML config file. */
function loadSecretsFromYamlConfig(cwd: string, onWarn?: (message: string) => void): unknown[] {
  for (const file of YAML_CONFIG_FILES) {
    const configPath = path.join(cwd, file);
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = YAML.parse(content) as Record<string, unknown> | null;
      if (parsed && Array.isArray(parsed.secrets)) {
        return parsed.secrets as unknown[];
      }
      return [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onWarn?.(`Failed to parse ${file} for secrets: ${msg}`);
      return [];
    }
  }

  return [];
}

/** Read secrets from the local `.totem/secrets.json` file. */
function loadSecretsFromJson(
  cwd: string,
  totemDir: string,
  onWarn?: (message: string) => void,
): unknown[] {
  const jsonPath = path.join(cwd, totemDir, 'secrets.json');
  if (!fs.existsSync(jsonPath)) return [];

  try {
    const content = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    const result = SecretsFileSchema.safeParse(parsed);
    if (result.success) {
      return result.data.secrets;
    }
    const issues = result.error.issues.map((i) => i.message).join('; ');
    onWarn?.(`Invalid secrets.json structure: ${issues}`);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`Failed to read secrets.json: ${msg}`);
    return [];
  }
}

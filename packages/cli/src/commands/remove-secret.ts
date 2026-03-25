import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SecretsFile } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TAG = 'RemoveSecret';
const SECRETS_REL_PATH = '.totem/secrets.json';

// ─── Main ───────────────────────────────────────────────

export async function removeSecretCommand(
  indexStr: string,
  cwd = process.cwd(),
  totemDir = '.totem',
): Promise<void> {
  const { log } = await import('../ui.js');
  const { buildSecretEntries } = await import('./list-secrets.js');

  // 1. Build the full list to resolve index → source (silent, no output)
  const entries = await buildSecretEntries(cwd, totemDir);

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 1 || index > entries.length) {
    log.error(
      'Totem Error',
      `Index ${indexStr} is out of range. Valid range: 1–${entries.length || 0}.`,
    );
    process.exit(1);
  }

  const target = entries[index - 1];

  // 2. Reject shared/yaml secrets
  if (target.source === 'shared/yaml') {
    log.error(
      'Totem Error',
      'Cannot remove shared secrets from CLI. Edit your totem.config.yaml directly.',
    );
    process.exit(1);
  }

  // 3. Read secrets.json
  const secretsPath = path.join(cwd, SECRETS_REL_PATH);
  let data: SecretsFile = { secrets: [] };
  try {
    const content = fs.readFileSync(secretsPath, 'utf-8');
    data = JSON.parse(content) as SecretsFile;
    if (!Array.isArray(data.secrets)) {
      data.secrets = [];
    }
  } catch {
    log.error('Totem Error', `Failed to read ${SECRETS_REL_PATH}.`);
    process.exit(1);
  }

  // 4. Compute the local index within secrets.json
  //    The entry's position among local/json entries maps to the JSON array.
  //    Count how many shared/yaml entries come before this entry.
  const yamlCount = entries.filter((e) => e.source === 'shared/yaml').length;
  const localIndex = index - 1 - yamlCount;

  if (localIndex < 0 || localIndex >= data.secrets.length) {
    log.error('Totem Error', `Index ${indexStr} is out of range for local secrets.`);
    process.exit(1);
  }

  // 5. Remove
  const [removed] = data.secrets.splice(localIndex, 1);

  // 6. Write back
  fs.writeFileSync(secretsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  // 7. Confirm
  log.success(
    TAG,
    `Removed ${removed.type} secret: "${removed.type === 'literal' ? removed.value.slice(0, 4) + '***' : removed.value}"`,
  );
}

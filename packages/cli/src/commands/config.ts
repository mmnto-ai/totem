// ─── Helpers ───────────────────────────────────────────

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, part)) return undefined;
    current = record[part];
  }
  return current;
}

// ─── Subcommands ───────────────────────────────────────

export async function configGetCommand(key: string): Promise<void> {
  const { TotemConfigError } = await import('@mmnto/totem');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const result = getNestedValue(config as unknown as Record<string, unknown>, key);

  if (result === undefined) {
    throw new TotemConfigError(
      `No configuration value found for key '${key}'`,
      'Check your totem.config.ts file for available keys.',
      'CONFIG_INVALID',
    );
  }

  if (typeof result === 'object' && result !== null) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(String(result));
  }
}

export async function configSetCommand(_key: string, _value: string): Promise<void> {
  const { TotemConfigError } = await import('@mmnto/totem');
  throw new TotemConfigError(
    "'totem config set' is not yet implemented.",
    'Edit your totem.config.ts file directly.',
    'CONFIG_INVALID',
  );
}

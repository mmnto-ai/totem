const TAG = 'Config';

// ─── Helpers ───────────────────────────────────────────

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ─── Subcommands ───────────────────────────────────────

export async function configGetCommand(key: string): Promise<void> {
  const { log } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const result = getNestedValue(config as unknown as Record<string, unknown>, key);

  if (result === undefined) {
    log.error('Totem Error', `No configuration value found for key '${key}'`);
    process.exitCode = 1;
    return;
  }

  if (typeof result === 'object' && result !== null) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(String(result));
  }
}

export async function configSetCommand(_key: string, _value: string): Promise<void> {
  const { log } = await import('../ui.js');

  log.error(
    'Totem Error',
    "'totem config set' is not yet implemented. Edit totem.config.ts directly.",
  );
  process.exitCode = 1;
}

const TAG = '[Check]';

export async function checkCommand(options: {
  model?: string;
  fresh?: boolean;
  staged?: boolean;
}): Promise<void> {
  const { log } = await import('../ui.js');

  log.info(TAG, 'Running lint...');
  let lintFailed: Error | null = null;
  try {
    const { lintCommand } = await import('./lint.js');
    await lintCommand({ staged: options.staged });
  } catch (err) {
    lintFailed = err instanceof Error ? err : new Error(String(err));
  }

  log.info(TAG, 'Running review...');
  let shieldFailed: Error | null = null;
  try {
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({ model: options.model, fresh: options.fresh, staged: options.staged });
  } catch (err) {
    shieldFailed = err instanceof Error ? err : new Error(String(err));
  }

  if (lintFailed || shieldFailed) {
    const { TotemError } = await import('@mmnto/totem');
    const parts: string[] = [];
    if (lintFailed) parts.push('lint');
    if (shieldFailed) parts.push('review');
    const cause = lintFailed ?? shieldFailed;
    throw new TotemError(
      'CHECK_FAILED',
      `Check failed: ${parts.join(' + ')} reported violations.`,
      `Run \`totem ${parts[0]}\` for details.`,
      { cause },
    );
  }

  log.success(TAG, 'All checks passed.');
}

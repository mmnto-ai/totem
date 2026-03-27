const TAG = '[Check]';

export async function checkCommand(options: {
  model?: string;
  fresh?: boolean;
  staged?: boolean;
}): Promise<void> {
  const { log } = await import('../ui.js');

  log.info(TAG, 'Running lint...');
  let lintFailed = false;
  try {
    const { lintCommand } = await import('./lint.js');
    await lintCommand({ staged: options.staged });
  } catch {
    lintFailed = true;
  }

  log.info(TAG, 'Running shield...');
  let shieldFailed = false;
  try {
    const { shieldCommand } = await import('./shield.js');
    await shieldCommand({ model: options.model, fresh: options.fresh });
  } catch {
    shieldFailed = true;
  }

  if (lintFailed || shieldFailed) {
    const { TotemError } = await import('@mmnto/totem');
    const parts: string[] = [];
    if (lintFailed) parts.push('lint');
    if (shieldFailed) parts.push('shield');
    throw new TotemError(
      'CHECK_FAILED',
      `Check failed: ${parts.join(' + ')} reported violations.`,
      `Run \`totem ${parts[0]}\` for details.`,
    );
  }

  log.success(TAG, 'All checks passed.');
}

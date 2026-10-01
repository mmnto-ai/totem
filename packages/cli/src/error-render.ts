/**
 * The PRINT half of the CLI error boundary (mmnto-ai/totem#2525).
 *
 * `handleError` in `index.ts` prints an error and then exits; a caller that
 * must report an error WITHOUT exiting — the shield's `hooks.shield.enforce`
 * knob softening a failed `--gate` run — has to print the very same bytes, or
 * a softened failure would read differently from the one the boundary prints.
 * One renderer, two callers, so the two cannot drift. `index-lite.ts` keeps
 * its own copy on purpose and does not route through here.
 *
 * No imports: this is loaded by the CLI entry point eagerly.
 */

/** Print `err` exactly as the CLI error boundary does. Never exits. */
export function renderCliError(err: unknown): void {
  const debug = process.env['TOTEM_DEBUG'] === '1' || process.argv.includes('--debug');

  if (err instanceof Error) {
    const msg = err.message.startsWith('[Totem Error]')
      ? err.message
      : `[Totem Error] ${err.message}`;
    console.error(msg);
    if ('recoveryHint' in err && typeof err.recoveryHint === 'string') {
      console.error(`  Fix: ${err.recoveryHint}`);
    }
    if (debug && err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
      // Traverse cause chain
      const seen = new Set<unknown>([err]);
      let current: unknown = err.cause;
      while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        console.error(`\nCaused by: ${current.message}`);
        if (current.stack) console.error(current.stack);
        current = current.cause;
      }
    }
  } else {
    console.error('[Totem Error] An unknown error occurred:', err);
  }

  if (!debug) {
    console.error('  (Set TOTEM_DEBUG=1 for full stack trace)');
  }
}

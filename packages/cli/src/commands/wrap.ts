import { log } from '../ui.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Wrap';

// ─── Main command ───────────────────────────────────────

export interface WrapOptions {
  model?: string;
  fresh?: boolean;
  yes?: boolean;
}

export async function wrapCommand(prNumbers: string[], options: WrapOptions): Promise<void> {
  // Step 1: Learn from PR(s)
  log.info(TAG, `Step 1/4 — Extracting lessons from PR ${prNumbers.join(', ')}...`);
  const { extractCommand } = await import('./extract.js');
  await extractCommand(prNumbers, {
    model: options.model,
    fresh: options.fresh,
    yes: options.yes,
  });

  // Step 2: Sync index
  log.info(TAG, 'Step 2/4 — Syncing index...');
  const { syncCommand } = await import('./sync.js');
  await syncCommand({ full: false });

  // Step 3: Triage
  log.info(TAG, 'Step 3/4 — Generating triage roadmap...');
  const { triageCommand } = await import('./triage.js');
  await triageCommand({
    model: options.model,
    fresh: options.fresh,
  });

  // Step 4: Update project docs (if configured)
  log.info(TAG, 'Step 4/4 — Updating project docs...');
  try {
    const { docsCommand } = await import('./docs.js');
    await docsCommand([], {
      model: options.model,
      fresh: options.fresh,
      yes: options.yes,
    });
  } catch (err) {
    // Don't fail wrap if docs aren't configured — it's optional
    if (err instanceof Error && err.name === 'NoDocsConfiguredError') {
      log.dim(TAG, 'No docs configured — skipping doc sync.');
    } else {
      throw err;
    }
  }

  log.success(
    TAG,
    'Wrap complete — lessons extracted, index synced, roadmap updated, docs synced.',
  );
}

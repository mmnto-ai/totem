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
  log.info(TAG, `Step 1/5 — Extracting lessons from PR ${prNumbers.join(', ')}...`);
  const { extractCommand } = await import('./extract.js');
  await extractCommand(prNumbers, {
    model: options.model,
    fresh: options.fresh,
    yes: options.yes,
  });

  // Step 2: Sync index
  log.info(TAG, 'Step 2/5 — Syncing index...');
  const { syncCommand } = await import('./sync.js');
  await syncCommand({ full: false });

  // Step 3: Triage
  log.info(TAG, 'Step 3/5 — Generating triage roadmap...');
  const { triageCommand } = await import('./triage.js');
  await triageCommand({
    model: options.model,
    fresh: options.fresh,
  });

  // Step 4: Update project docs (if configured)
  log.info(TAG, 'Step 4/5 — Updating project docs...');
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

  // Step 5: Compile rules and export to AI tool configs (if configured)
  log.info(TAG, 'Step 5/5 — Compiling rules and exporting...');
  try {
    const { compileCommand } = await import('./compile.js');
    await compileCommand({
      model: options.model,
      fresh: options.fresh,
      export: true,
    });
  } catch (err) {
    // Don't fail wrap if compile has nothing to do
    if (err instanceof Error && err.message.includes('No lessons')) {
      log.dim(TAG, 'No lessons to compile — skipping.');
    } else {
      throw err;
    }
  }

  log.success(
    TAG,
    'Wrap complete — lessons extracted, index synced, roadmap updated, docs synced, rules exported.',
  );
}

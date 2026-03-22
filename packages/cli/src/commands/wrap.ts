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
  log.info(TAG, `Step 1/6 — Extracting from PR ${prNumbers.join(', ')}...`);
  const { extractCommand } = await import('./extract.js');
  await extractCommand(prNumbers, {
    model: options.model,
    fresh: options.fresh,
    yes: options.yes,
  });

  // Step 2: Sync index
  log.info(TAG, 'Step 2/6 — Syncing index...');
  const { syncCommand } = await import('./sync.js');
  await syncCommand({ full: false });

  // Step 3: Triage
  log.info(TAG, 'Step 3/6 — Generating triage roadmap...');
  const { triageCommand } = await import('./triage.js');
  await triageCommand({
    model: options.model,
    fresh: options.fresh,
  });

  // Step 4: Update project docs (if configured)
  log.info(TAG, 'Step 4/6 — Updating project docs...');
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

  // Step 5: Deterministic doc injection (markdown-magic)
  log.info(TAG, 'Step 5/6 — Injecting dynamic doc values...');
  try {
    const { execSync } = await import('node:child_process');
    execSync('pnpm run docs:inject', { cwd: process.cwd(), stdio: 'pipe' });
    log.success(TAG, 'Doc values injected.');
  } catch {
    log.dim(TAG, 'docs:inject not configured — skipping.');
  }

  // Step 6: Compile rules and export to AI tool configs (if configured)
  log.info(TAG, 'Step 6/6 — Compiling rules and exporting...');
  try {
    const { compileCommand } = await import('./compile.js');
    await compileCommand({
      model: options.model,
      fresh: options.fresh,
      export: true,
    });
  } catch (err) {
    // Don't fail wrap if compile has nothing to do
    if (err instanceof Error && err.name === 'NoLessonsError') {
      log.dim(TAG, 'Nothing to compile — skipping.');
    } else {
      throw err;
    }
  }

  log.success(
    TAG,
    'Wrap complete — lessons extracted, index synced, roadmap updated, docs synced, values injected, rules exported.',
  );
}

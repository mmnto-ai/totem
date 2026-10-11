// ─── `totem rule serve <input.json>`: the serving writer (mmnto-ai/totem#3036) ──
//
// Thin, lazy-loaded command wrapper: every runtime dependency loads via
// `await import`, so none hits `totem` startup. The IO lives in the non-command
// library `serving-writer.ts`; the decisions live in core's pure
// `planServingWrite`. Human output goes to stderr; `--json` emits the report
// (or the refusal, with its code) on stdout.

export interface RuleServeOptions {
  /** Read everything, write nothing, print the row-level report. */
  dryRun?: boolean;
}

const COMMAND = 'rule serve';

export async function ruleServeCommand(
  inputPath: string,
  opts: RuleServeOptions = {},
): Promise<void> {
  const { isJsonMode, printJson } = await import('../json-output.js');
  const { formatServingReport, runServingWriter } = await import('../serving-writer.js');

  try {
    const result = await runServingWriter({ inputPath, dryRun: opts.dryRun === true });
    if (isJsonMode()) {
      printJson({ status: 'success', command: COMMAND, data: result });
      return;
    }
    for (const line of formatServingReport(result)) console.error(`[Serve] ${line}`);
  } catch (err) {
    if (isJsonMode()) {
      const e = err as Error & { code?: string; recoveryHint?: string };
      printJson({
        status: 'error',
        command: COMMAND,
        error: {
          message: e.message ?? String(err),
          ...(e.recoveryHint !== undefined ? { fix: e.recoveryHint } : {}),
          ...(e.code !== undefined ? { code: e.code } : {}),
        },
      });
    }
    // The CLI boundary (`handleError`) renders the refusal and exits 1.
    throw err;
  }
}

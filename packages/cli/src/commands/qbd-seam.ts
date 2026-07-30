/**
 * The single place the query-before-derive seams resolve their ledger directory
 * (mmnto-ai/totem#2510).
 *
 * ## Why this exists
 *
 * The seams originally each did `path.join(cwd, config.totemDir)`. That is
 * wrong, and silently so. `resolveConfigPath` does NOT walk up the tree — it
 * checks the cwd and then falls back to the global `~/.totem/` profile — so
 * running a derive-class command from a subdirectory of a project resolves a
 * config successfully (the command works) while the seam targets
 * `<subdir>/.totem`, which does not exist. The core writer then skips, and the
 * derive vanishes from the denominator: exactly the #2510 falsifier-1 failure,
 * arrived at by accident instead of by gaming.
 *
 * The fix is to resolve the ledger directory the way this command family's
 * EXISTING ledger writes already do — from the config root, e.g. `shield.ts`'s
 * `path.join(configRoot, config.totemDir)` for `override` events — so QBD rows
 * land in the same ledger as every other event the same command emits.
 *
 * Every seam and the doctor reader route through here, so the resolution can
 * only be wrong in one place, and a fix lands everywhere at once. That
 * writer/reader agreement is the load-bearing property: rows went missing
 * precisely because the two resolved differently.
 *
 * ## Known residual, stated rather than hidden
 *
 * `resolveConfigPath` still does not walk up. Run from a subdirectory of a
 * project that has no config of its own, it resolves the global `~/.totem/`
 * profile, so the row lands in the global profile's ledger rather than the
 * enclosing project's. That is consistent — telemetry follows the same config
 * the command itself ran under, and the reader follows it too — but it is not
 * the same as project-root discovery. Fixing it properly means changing
 * `resolveConfigPath` semantics for EVERY command, which is a repo-wide change
 * well outside this slice. Scoped out deliberately, not overlooked.
 */

import * as path from 'node:path';

/**
 * Resolve the ledger directory QBD rows belong in, for a given cwd.
 *
 * Returns `undefined` when no Totem config can be resolved at all — there is no
 * project to instrument, which is a normal state for a general-purpose command
 * like `orient` run outside a repo.
 */
export async function resolveQbdLedgerDir(cwd: string): Promise<string | undefined> {
  return (await resolveQbdLedgerDirDetailed(cwd)).dir;
}

/**
 * As `resolveQbdLedgerDir`, but distinguishes the two reasons resolution can
 * fail so the caller can say which happened.
 *
 * `CONFIG_MISSING` is the honest-absent case — no project here, nothing to
 * instrument, an entirely normal state for a command like `orient`. Any other
 * failure means a config exists but could not be read, which is a degradation
 * worth naming rather than folding into "absent".
 */
export async function resolveQbdLedgerDirDetailed(
  cwd: string,
): Promise<{ dir?: string; reason?: string }> {
  try {
    const { loadConfig, resolveConfigPath } = await import('../utils.js');
    const configPath = resolveConfigPath(cwd);
    const config = await loadConfig(configPath);
    // configRoot, NOT cwd — see the header. Mirrors the sibling ledger writes.
    return { dir: path.join(path.dirname(configPath), config.totemDir) };
    // totem-context: intentional cleanup — a sensor must not fail the command it instruments (Tenet 13); the reason is returned to the caller and surfaced, never discarded.
  } catch (err) {
    // totem-context: intentional cleanup — a sensor must not fail the command it instruments (Tenet 13); the reason is returned to the caller and surfaced, never discarded.
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === 'CONFIG_MISSING') {
      return { reason: 'no Totem config found — not a project, nothing to instrument' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { reason: `Totem config could not be loaded (${msg})` };
  }
}

/** What a seam reports back so a skip is never a silent no-op. */
export interface QbdSeamReport {
  recorded: boolean;
  note?: string;
}

/**
 * Record a derive-class action from a CLI command.
 *
 * Never throws, never fails the instrumented command. Returns a note whenever
 * nothing was recorded, so the caller can surface it — a sensor that quietly
 * declines to measure is indistinguishable from one measuring zero, which is
 * the ADR-115 § 2 defect class.
 */
export async function recordQbdDerive(
  cwd: string,
  surface: 'spec' | 'orient' | 'review',
  onWarn: (msg: string) => void,
): Promise<QbdSeamReport> {
  const { dir: totemDir, reason } = await resolveQbdLedgerDirDetailed(cwd);
  if (totemDir === undefined) {
    return {
      recorded: false,
      note: `query-before-derive: ${reason ?? 'unresolved'} — not recording`,
    };
  }
  const { senseDeriveAction } = await import('@mmnto/totem');
  const result = senseDeriveAction({ totemDir, source: 'lint', surface }, onWarn);
  if (result.skipped === true) {
    return {
      recorded: false,
      note: `query-before-derive: no ledger at ${totemDir} — not recording`,
    };
  }
  return { recorded: result.written };
}

/**
 * Record a corpus query from a CLI command. Same contract as `recordQbdDerive`.
 */
export async function recordQbdQuery(
  cwd: string,
  onWarn: (msg: string) => void,
): Promise<QbdSeamReport> {
  const { dir: totemDir, reason } = await resolveQbdLedgerDirDetailed(cwd);
  if (totemDir === undefined) {
    return {
      recorded: false,
      note: `query-before-derive: ${reason ?? 'unresolved'} — not recording`,
    };
  }
  const { senseCorpusQuery } = await import('@mmnto/totem');
  const result = senseCorpusQuery({ totemDir, source: 'lint', surface: 'totem_search' }, onWarn);
  if (result.skipped === true) {
    return {
      recorded: false,
      note: `query-before-derive: no ledger at ${totemDir} — not recording`,
    };
  }
  return { recorded: result.written };
}

import type { ExemptionLocal, ExemptionShared } from '../exemptions/exemption-schema.js';
import { PROMOTION_THRESHOLD } from '../exemptions/exemption-schema.js';

const TAG = 'Exemption';

// ─── Helpers ───────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

async function resolveTotemPaths(): Promise<{
  totemDir: string;
  cacheDir: string;
}> {
  const path = await import('node:path');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const totemDir = path.join(cwd, config.totemDir);
  const cacheDir = path.join(totemDir, 'cache');

  return { totemDir, cacheDir };
}

async function loadExemptions(): Promise<{
  shared: ExemptionShared;
  local: ExemptionLocal;
  totemDir: string;
  cacheDir: string;
}> {
  const { log } = await import('../ui.js');
  const { readSharedExemptions, readLocalExemptions } =
    await import('../exemptions/exemption-store.js');

  const { totemDir, cacheDir } = await resolveTotemPaths();
  const shared = readSharedExemptions(totemDir, (msg) => log.dim(TAG, msg));
  const local = readLocalExemptions(cacheDir, (msg) => log.dim(TAG, msg));

  return { shared, local, totemDir, cacheDir };
}

// ─── Subcommands ───────────────────────────────────────

export async function exemptionListCommand(): Promise<void> {
  const { log, dim, bold } = await import('../ui.js');
  const { shared, local } = await loadExemptions();

  const hasShared = shared.exemptions.length > 0;
  const hasLocal = Object.keys(local.patterns).length > 0;

  if (!hasShared && !hasLocal) {
    log.info(TAG, 'No active exemptions.');
    return;
  }

  // Shared exemptions table
  if (hasShared) {
    console.error('');
    log.info(TAG, bold('Shared exemptions (committed, team-wide):'));

    const idW = 12;
    const labelW = 25;
    const reasonW = 30;
    const byW = 8;

    console.error(
      dim(
        `  ${'PATTERN-ID'.padEnd(idW)}${'LABEL'.padEnd(labelW)}${'REASON'.padEnd(reasonW)}${'BY'.padEnd(byW)}PROMOTED-AT`,
      ),
    );
    console.error(dim('  ' + '\u2500'.repeat(idW + labelW + reasonW + byW + 24)));

    for (const entry of shared.exemptions) {
      const id = truncate(entry.patternId, idW).padEnd(idW);
      const label = truncate(entry.label, labelW).padEnd(labelW);
      const reason = truncate(entry.reason, reasonW).padEnd(reasonW);
      const by = entry.promotedBy.padEnd(byW);
      const at = entry.promotedAt.slice(0, 10);

      console.error(`  ${id}${label}${reason}${by}${at}`);
    }

    console.error('');
    log.info(TAG, `${bold(String(shared.exemptions.length))} shared exemption(s)`);
  }

  // Local exemptions table
  if (hasLocal) {
    console.error('');
    log.info(TAG, bold('Local exemptions (per-developer tracking):'));

    const idW = 12;
    const countW = 7;
    const sourcesW = 15;

    console.error(
      dim(
        `  ${'PATTERN-ID'.padEnd(idW)}${'COUNT'.padEnd(countW)}${'SOURCES'.padEnd(sourcesW)}LAST-SEEN`,
      ),
    );
    console.error(dim('  ' + '\u2500'.repeat(idW + countW + sourcesW + 24)));

    for (const [patternId, pattern] of Object.entries(local.patterns)) {
      const id = truncate(patternId, idW).padEnd(idW);
      const count = String(pattern.count).padEnd(countW);
      const sources = pattern.sources.join(', ').padEnd(sourcesW);
      const lastSeen = pattern.lastSeenAt.slice(0, 10);

      console.error(`  ${id}${count}${sources}${lastSeen}`);
    }

    console.error('');
    log.info(TAG, `${bold(String(Object.keys(local.patterns).length))} local pattern(s)`);
  }
}

export async function exemptionAddCommand(options: {
  rule?: string;
  reason?: string;
}): Promise<void> {
  const { log } = await import('../ui.js');
  const { addManualSuppression } = await import('../exemptions/exemption-engine.js');
  const { readSharedExemptions, writeSharedExemptions } =
    await import('../exemptions/exemption-store.js');
  const { appendLedgerEvent } = await import('@mmnto/totem');

  if (!options.rule || !options.rule.trim()) {
    log.error(TAG, 'Missing required flag: --rule <label>');
    process.exitCode = 1;
    return;
  }

  if (!options.reason || !options.reason.trim()) {
    log.error(TAG, 'Missing required flag: --reason <text>');
    process.exitCode = 1;
    return;
  }

  const { totemDir } = await resolveTotemPaths();

  let shared = readSharedExemptions(totemDir, (msg) => log.dim(TAG, msg));
  shared = addManualSuppression(shared, options.rule, options.reason);
  writeSharedExemptions(totemDir, shared, (msg) => log.dim(TAG, msg));

  appendLedgerEvent(
    totemDir,
    {
      timestamp: new Date().toISOString(),
      type: 'exemption',
      ruleId: 'exemption-manual',
      file: '(exemption add)',
      justification: `--rule ${options.rule} --reason ${options.reason}`,
      source: 'shield',
    },
    (msg) => log.dim(TAG, msg),
  );

  log.success(TAG, `Exemption added for '${options.rule}'`);
}

export async function exemptionAuditCommand(): Promise<void> {
  const { log, bold, dim } = await import('../ui.js');
  const { readLedgerEvents } = await import('@mmnto/totem');

  const { shared, local, totemDir } = await loadExemptions();

  const sharedCount = shared.exemptions.length;
  const localCount = Object.keys(local.patterns).length;
  const autoCount = shared.exemptions.filter((e) => e.promotedBy === 'auto').length;
  const manualCount = shared.exemptions.filter((e) => e.promotedBy === 'manual').length;

  console.error('');
  log.info(TAG, bold('Exemption Audit Report'));
  console.error(dim('  ' + '\u2500'.repeat(50)));

  log.info(TAG, `Total shared exemptions: ${bold(String(sharedCount))}`);
  log.info(TAG, `Total local patterns:    ${bold(String(localCount))}`);
  log.info(TAG, `  Auto-promoted:  ${autoCount}`);
  log.info(TAG, `  Manual:         ${manualCount}`);

  // Promotion candidates (approaching threshold)
  const candidates = Object.entries(local.patterns).filter(
    ([patternId, pattern]) =>
      pattern.count > 0 &&
      pattern.count < PROMOTION_THRESHOLD &&
      !shared.exemptions.some((e) => e.patternId === patternId),
  );

  if (candidates.length > 0) {
    console.error('');
    log.info(TAG, bold('Promotion candidates (approaching threshold):'));
    for (const [patternId, pattern] of candidates) {
      log.info(
        TAG,
        `  ${truncate(patternId, 40)} — ${pattern.count}/${PROMOTION_THRESHOLD} strikes`,
      );
    }
  }

  // Recent ledger events
  const events = readLedgerEvents(totemDir, (msg) => log.dim(TAG, msg));
  const exemptionEvents = events.filter((e) => e.type === 'exemption' || e.type === 'override');
  const recent = exemptionEvents.slice(-10).reverse();

  if (recent.length > 0) {
    console.error('');
    log.info(TAG, bold('Recent exemption/override events (last 10):'));
    for (const event of recent) {
      const ts = event.timestamp.slice(0, 19).replace('T', ' ');
      const just = truncate(event.justification || '(none)', 50);
      log.info(TAG, `  ${dim(ts)} ${event.type.padEnd(10)} ${just}`);
    }
  } else {
    console.error('');
    log.dim(TAG, 'No exemption-related events in the ledger.');
  }

  console.error('');
}

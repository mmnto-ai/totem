// ─── Constants ──────────────────────────────────────────

const TAG = 'Verify';

// ─── Main command ───────────────────────────────────────

export async function verifyManifestCommand(): Promise<void> {
  const path = await import('node:path');
  const { generateInputHash, generateOutputHash, readCompileManifest, TotemError } =
    await import('@mmnto/totem');
  const { bold, errorColor, log, success: successColor } = await import('../ui.js');
  const { loadConfig, resolveConfigPath } = await import('../utils.js');

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);

  const manifestPath = path.join(cwd, config.totemDir, 'compile-manifest.json');
  const rulesPath = path.join(cwd, config.totemDir, 'compiled-rules.json');
  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');

  log.info(TAG, 'Verifying compile manifest integrity...');

  // readCompileManifest throws TotemParseError if missing or invalid
  const manifest = readCompileManifest(manifestPath);

  const actualInputHash = generateInputHash(lessonsDir);
  const actualOutputHash = generateOutputHash(rulesPath);

  const mismatches: string[] = [];

  if (actualInputHash !== manifest.input_hash) {
    mismatches.push(
      `Input hash mismatch — lessons changed since last compile.\n` +
        `  Expected: ${manifest.input_hash}\n` +
        `  Actual:   ${actualInputHash}`,
    );
  }

  if (actualOutputHash !== manifest.output_hash) {
    mismatches.push(
      `Output hash mismatch — compiled-rules.json was modified outside totem compile.\n` +
        `  Expected: ${manifest.output_hash}\n` +
        `  Actual:   ${actualOutputHash}`,
    );
  }

  if (mismatches.length > 0) {
    for (const msg of mismatches) {
      log.error('Totem Error', msg);
    }
    const label = errorColor(bold('FAIL'));
    log.error('Totem Error', `${label} — Manifest verification failed.`);
    throw new TotemError(
      'COMPILE_FAILED',
      'Compile manifest verification failed.',
      'Run "totem compile" to regenerate the manifest.',
    );
  }

  const label = successColor(bold('PASS'));
  log.success(TAG, `${label} — Manifest verified: ${manifest.rule_count} rules, hashes match.`);
}

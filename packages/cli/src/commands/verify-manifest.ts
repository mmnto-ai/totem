import * as path from 'node:path';

import { generateInputHash, generateOutputHash, readCompileManifest } from '@mmnto/totem';

import { bold, errorColor, log, success as successColor } from '../ui.js';
import { loadConfig, resolveConfigPath } from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Verify';

// ─── Main command ───────────────────────────────────────

export async function verifyManifestCommand(): Promise<void> {
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

  let failed = false;

  if (actualInputHash !== manifest.input_hash) {
    log.error(
      TAG,
      `Input hash mismatch — lessons changed since last compile.\n` +
        `  Expected: ${manifest.input_hash}\n` +
        `  Actual:   ${actualInputHash}`,
    );
    failed = true;
  }

  if (actualOutputHash !== manifest.output_hash) {
    log.error(
      TAG,
      `Output hash mismatch — compiled-rules.json was modified outside totem compile.\n` +
        `  Expected: ${manifest.output_hash}\n` +
        `  Actual:   ${actualOutputHash}`,
    );
    failed = true;
  }

  if (failed) {
    const label = errorColor(bold('FAIL'));
    log.error(TAG, `${label} — Manifest verification failed. Run "totem compile" to regenerate.`);
    process.exit(1);
  }

  const label = successColor(bold('PASS'));
  log.success(TAG, `${label} — Manifest verified: ${manifest.rule_count} rules, hashes match.`);
}

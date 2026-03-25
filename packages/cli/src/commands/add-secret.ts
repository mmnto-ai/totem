import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SecretsFile } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TAG = 'AddSecret';
const MIN_LENGTH = 4;
const SECRETS_REL_PATH = '.totem/secrets.json';
const GITIGNORE_ENTRY = '.totem/secrets.json';

// ─── Helpers ────────────────────────────────────────────

function ensureGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    if (lines.some((line) => line.trim() === GITIGNORE_ENTRY)) {
      return; // Already present
    }
    // Append with a preceding newline if file doesn't end with one
    const separator = content.endsWith('\n') ? '' : '\n';
    fs.writeFileSync(gitignorePath, `${content}${separator}${GITIGNORE_ENTRY}\n`, 'utf-8');
  } else {
    fs.writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`, 'utf-8');
  }
}

// ─── Main ───────────────────────────────────────────────

export interface AddSecretOptions {
  pattern?: boolean;
}

export async function addSecretCommand(
  value: string,
  opts: AddSecretOptions,
  cwd = process.cwd(),
): Promise<void> {
  const { log } = await import('../ui.js');

  // 1. Validate length
  if (value.length < MIN_LENGTH) {
    log.error(TAG, `Secret must be at least ${MIN_LENGTH} characters to prevent over-redaction.`);
    return;
  }

  // 2. Validate regex if --pattern
  const type: 'pattern' | 'literal' = opts.pattern ? 'pattern' : 'literal';
  if (type === 'pattern') {
    try {
      new RegExp(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(TAG, `Invalid regex pattern: ${msg}`);
      return;
    }
  }

  // 3. Read existing secrets.json
  const secretsPath = path.join(cwd, SECRETS_REL_PATH);
  const totemDir = path.join(cwd, '.totem');

  let data: SecretsFile = { secrets: [] };
  if (fs.existsSync(secretsPath)) {
    try {
      const content = fs.readFileSync(secretsPath, 'utf-8');
      data = JSON.parse(content) as SecretsFile;
      if (!Array.isArray(data.secrets)) {
        data.secrets = [];
      }
    } catch {
      // Corrupted file — start fresh
      data = { secrets: [] };
    }
  }

  // 4. Check for duplicates
  const isDuplicate = data.secrets.some((entry) => entry.type === type && entry.value === value);
  if (isDuplicate) {
    log.warn(TAG, `Duplicate: a ${type} secret with this value already exists.`);
    return;
  }

  // 5. Append new secret
  data.secrets.push({ type, value });

  // 6. Write back
  if (!fs.existsSync(totemDir)) {
    fs.mkdirSync(totemDir, { recursive: true });
  }
  fs.writeFileSync(secretsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  // 7. Ensure .gitignore contains secrets.json path
  ensureGitignore(cwd);

  // 8. Success message
  log.success(TAG, `Added ${type} secret (${value.length} chars) → ${SECRETS_REL_PATH}`);
}

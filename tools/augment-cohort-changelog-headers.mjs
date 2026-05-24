#!/usr/bin/env node
/**
 * Augment empty cohort-link CHANGELOG headers.
 *
 * Wired into root `package.json` "version" script after `changeset version`.
 * Detects `## X.Y.Z` headers with no body (immediately followed by blank line
 * + either next `## ` header or EOF) in the three pack CHANGELOGs that
 * exhibit the empty-cohort-header pattern, and injects the canonical
 * generic cohort-link note.
 *
 * Idempotent — re-running on already-augmented CHANGELOG is a no-op (any
 * header with a non-blank body line is left untouched).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

export const TARGET_CHANGELOGS = [
  'packages/core/CHANGELOG.md',
  'packages/pack-agent-security/CHANGELOG.md',
  'packages/pack-rust-architecture/CHANGELOG.md',
];

export const COHORT_NOTE =
  '_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._';

const VERSION_HEADER_RE = /^## \d+\.\d+\.\d+$/;

/**
 * Augment the content of one CHANGELOG file. Pure function — used by tests.
 *
 * @param {string} content
 * @returns {{ content: string, augmented: number }}
 */
export function augmentChangelog(content) {
  const lines = content.split('\n');
  const result = [];
  let augmented = 0;

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);

    if (!VERSION_HEADER_RE.test(lines[i])) continue;

    // Empty-header detection: next line must be blank, and the line after
    // must be either another `## ` header or end-of-file.
    const nextLine = lines[i + 1];
    const lineAfter = lines[i + 2];
    const isEmpty = nextLine === '' && (lineAfter === undefined || lineAfter.startsWith('## '));

    if (!isEmpty) continue;

    // Output shape: header, blank, note, blank, (next ## | EOF).
    // The blank at lines[i+1] is consumed by the i++ below; we emit fresh
    // blanks on both sides of the note so the spacing is canonical
    // regardless of what came before.
    result.push('');
    result.push(COHORT_NOTE);
    result.push('');
    augmented++;
    i++; // Skip the original blank at lines[i+1].
  }

  return { content: result.join('\n'), augmented };
}

async function main() {
  let totalAugmented = 0;
  const summaryRows = [];

  for (const target of TARGET_CHANGELOGS) {
    const path = join(rootDir, target);
    const content = readFileSync(path, 'utf8');
    const { content: newContent, augmented } = augmentChangelog(content);

    if (augmented > 0) {
      writeFileSync(path, newContent, 'utf8');
      summaryRows.push(`  ${target}: augmented ${augmented} header(s)`);
      totalAugmented += augmented;
    }
  }

  if (totalAugmented === 0) {
    console.log('[augment-headers] No empty cohort-link headers found (no-op).');
  } else {
    console.log(`[augment-headers] Augmented ${totalAugmented} header(s):`);
    for (const row of summaryRows) console.log(row);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error('[augment-headers] ERROR:', err.message);
    process.exit(1);
  });
}

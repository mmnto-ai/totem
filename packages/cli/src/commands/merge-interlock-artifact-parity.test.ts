// mmnto-ai/totem#1762 (A-slice) round-3 finding 1 — DRIFT SENSOR for the committed,
// ARMED merge-interlock hook artifacts. The round-2 matcher rewrite reached core, the
// in-memory templates, and the committed Gemini host, but NOT the committed Claude host
// (`.totem/hooks/merge-interlock.cjs`, executed by `.claude/settings.json`): it still
// embedded the round-1 pattern (allowed glued/quoted merge forms, backtracked ~50s at
// N=26 flag groups) while every test checked the in-memory `CLAUDE_MERGE_INTERLOCK`
// template, not the on-disk file — so nothing caught the drift.
//
// This test asserts the committed artifacts BYTE-MATCH what their templates render.
// Byte-exact by construction: `.prettierignore` exempts `.totem/hooks/` + `.gemini/hooks/`
// (no prettier rewrap) and `.gitattributes` forces `eol=lf`, so the working-tree files
// equal the template strings (`\n`, single trailing newline) with no normalization.
// `regenerateManagedSessionHooks` writes each roster entry's `content` verbatim, so a
// regenerate makes this pass; a template edit without a regenerate makes it fail (CI
// catches the drift that the in-memory template tests are blind to).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { API_ANCHOR_SOURCE } from '@mmnto/totem';

import {
  CLAUDE_MERGE_INTERLOCK,
  GEMINI_BEFORE_TOOL,
  MERGE_INTERLOCK_SCANNER_JS,
} from './init-templates.js';

/**
 * Walk up from this test file until the repo root that carries the committed
 * merge-interlock artifact — the same resolution shape as
 * shield.content-hash-parity.test.ts's `resolveHookPath`, so the test is runnable
 * from any cwd. Fails LOUD if the artifact cannot be located (it must exist in-repo).
 */
function resolveRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, '.totem', 'hooks', 'merge-interlock.cjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate .totem/hooks/merge-interlock.cjs from the test context');
}

const REPO_ROOT = resolveRepoRoot();

describe('committed merge-interlock hook artifacts match their templates (mmnto-ai/totem#1762 round-3)', () => {
  it('the armed Claude host `.totem/hooks/merge-interlock.cjs` byte-matches CLAUDE_MERGE_INTERLOCK', () => {
    const committed = fs.readFileSync(
      path.join(REPO_ROOT, '.totem', 'hooks', 'merge-interlock.cjs'),
      'utf-8',
    );
    expect(committed).toBe(CLAUDE_MERGE_INTERLOCK);
  });

  it('the armed Gemini host `.gemini/hooks/BeforeTool.cjs` byte-matches GEMINI_BEFORE_TOOL', () => {
    const committed = fs.readFileSync(
      path.join(REPO_ROOT, '.gemini', 'hooks', 'BeforeTool.cjs'),
      'utf-8',
    );
    expect(committed).toBe(GEMINI_BEFORE_TOOL);
  });

  // mmnto-ai/totem#1762 delta-4: the padding bypass close replaced the bounded
  // `{0,2000}?` regex span with the single-pass MERGE_INTERLOCK_SCANNER_JS. Byte-lock
  // the INLINED SCANNER (not just the regex) in BOTH committed artifacts, so a scanner
  // edit without a regenerate — or a scanner that drifts between the two hosts — fails
  // CI the way the round-3 Claude-host regex drift now does.
  it('both committed artifacts inline the SAME MERGE_INTERLOCK_SCANNER_JS scanner block', () => {
    const claude = fs.readFileSync(
      path.join(REPO_ROOT, '.totem', 'hooks', 'merge-interlock.cjs'),
      'utf-8',
    );
    const gemini = fs.readFileSync(
      path.join(REPO_ROOT, '.gemini', 'hooks', 'BeforeTool.cjs'),
      'utf-8',
    );
    // The single-source scanner is present verbatim in each armed host…
    expect(claude).toContain(MERGE_INTERLOCK_SCANNER_JS);
    expect(gemini).toContain(MERGE_INTERLOCK_SCANNER_JS);
    // …and its detection is the linear scan, not a length-capped span.
    expect(MERGE_INTERLOCK_SCANNER_JS).toContain('function findApiMergePaths(command)');
    expect(MERGE_INTERLOCK_SCANNER_JS).not.toContain('{0,2000}');
  });

  it('both committed artifacts inline the core API_ANCHOR_SOURCE (drift-locked to core)', () => {
    const claude = fs.readFileSync(
      path.join(REPO_ROOT, '.totem', 'hooks', 'merge-interlock.cjs'),
      'utf-8',
    );
    const gemini = fs.readFileSync(
      path.join(REPO_ROOT, '.gemini', 'hooks', 'BeforeTool.cjs'),
      'utf-8',
    );
    expect(claude).toContain(JSON.stringify(API_ANCHOR_SOURCE));
    expect(gemini).toContain(JSON.stringify(API_ANCHOR_SOURCE));
  });
});

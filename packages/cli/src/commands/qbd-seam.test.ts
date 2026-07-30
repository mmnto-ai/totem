/**
 * Seam-resolution tests for the query-before-derive instrumentation
 * (mmnto-ai/totem#2510).
 *
 * These pin the two defects that made the seams silently stop measuring:
 * resolving the ledger from the invocation cwd instead of the config root, and
 * siting the review seam below a branch that returns before reaching it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { recordQbdDerive, resolveQbdLedgerDirDetailed } from './qbd-seam.js';

/**
 * A minimal VALID config. `targets` requires at least one entry, so an empty
 * list would fail schema validation and the helper would report "config could
 * not be loaded" rather than resolving.
 */
const TOTEM_YAML = [
  'targets:',
  '  - glob: "src/**/*.ts"',
  '    type: code',
  '    strategy: file',
  '',
].join('\n');

let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-seam-')));
  // YAML, not .ts — a TypeScript config would need transpilation to load.
  fs.writeFileSync(path.join(projectRoot, 'totem.yaml'), TOTEM_YAML, 'utf-8');
  fs.mkdirSync(path.join(projectRoot, '.totem'), { recursive: true });
});

afterEach(() => {
  cleanTmpDir(projectRoot);
});

function ledgerRows(root: string): Array<Record<string, unknown>> {
  const file = path.join(root, '.totem', 'ledger', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('resolveQbdLedgerDir', () => {
  it('resolves from the config root, not the invocation cwd', async () => {
    const detailed = await resolveQbdLedgerDirDetailed(projectRoot);
    expect(detailed.reason ?? 'resolved').toBe('resolved');
    expect(detailed.dir).toBe(path.join(projectRoot, '.totem'));
  });
});

describe('recordQbdDerive from a subdirectory', () => {
  it('never creates a stray ledger under the subdirectory', async () => {
    // The original seams did `path.join(cwd, config.totemDir)`. Run from a
    // subdirectory that targets `<subdir>/.totem`, which does not exist — so the
    // writer skipped and the derive vanished from the denominator. That is the
    // #2510 falsifier-1 failure arrived at by accident. (Before the guard landed
    // it was worse: the writer CREATED that stray directory.)
    const subdir = path.join(projectRoot, 'packages', 'thing');
    fs.mkdirSync(subdir, { recursive: true });

    const notes: string[] = [];
    const report = await recordQbdDerive(subdir, 'spec', (msg) => notes.push(msg));

    expect(fs.existsSync(path.join(subdir, '.totem'))).toBe(false);
    // Never a silent no-op: not recording always carries a reason.
    if (!report.recorded) expect(report.note).toBeDefined();
  });

  it('writes where the READER will look — writer and reader cannot diverge', async () => {
    // The load-bearing invariant. `resolveConfigPath` does NOT walk up, so from
    // a subdirectory it resolves whatever config the COMMAND itself resolved
    // (a global `~/.totem/` profile, on a machine that has one) rather than the
    // enclosing project. That residual is documented in `qbd-seam.ts`; what must
    // never happen again is the writer and the doctor reader resolving to
    // DIFFERENT places, which is how rows went missing in the first place.
    const subdir = path.join(projectRoot, 'packages', 'thing');
    fs.mkdirSync(subdir, { recursive: true });

    const resolved = await resolveQbdLedgerDirDetailed(subdir);
    const report = await recordQbdDerive(subdir, 'spec', () => {});

    if (report.recorded) {
      expect(resolved.dir).toBeDefined();
      const rows = ledgerRows(path.dirname(resolved.dir!));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[rows.length - 1]!.type).toBe('derive_action');
    } else {
      expect(report.note).toBeDefined();
    }
  });

  it('records into the project ledger when run from the project root', async () => {
    const report = await recordQbdDerive(projectRoot, 'review', () => {});
    expect(report.recorded).toBe(true);

    const rows = ledgerRows(projectRoot);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('derive_action');
    expect(rows[0]!.activity_name).toBe('review');
  });

  it('never no-ops silently when there is no project at all', async () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-orphan-'));
    try {
      const report = await recordQbdDerive(orphan, 'orient', () => {});
      if (!report.recorded) {
        expect(report.note).toBeDefined();
        expect(report.note).toContain('query-before-derive');
      }
    } finally {
      cleanTmpDir(orphan);
    }
  });
});

describe('review seam placement (structural mode)', () => {
  it('records the derive ABOVE the structural-mode branch', () => {
    // Structural mode `return`s from inside its own branch, so a seam sited
    // after that branch records the standard and fan paths while structural
    // escapes the denominator entirely — which is exactly what happened. A
    // source-order pin is the honest regression test here: the defect IS the
    // ordering, and driving a full structural review in a unit test would
    // require mocking the orchestrator, the index, and git.
    const source = fs.readFileSync(path.join(__dirname, 'shield.ts'), 'utf-8');
    const seamIdx = source.indexOf('recordQbdDerive');
    const structuralIdx = source.indexOf("options.mode === 'structural'");

    expect(seamIdx).toBeGreaterThan(-1);
    expect(structuralIdx).toBeGreaterThan(-1);
    expect(seamIdx).toBeLessThan(structuralIdx);
  });
});

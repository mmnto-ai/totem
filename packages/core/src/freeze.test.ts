import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemConfigError } from './errors.js';
import {
  readCohortFreezes,
  readEffectiveFreezes,
  readFreezeConfig,
  RULE_COMPILATION_FREEZE_ID,
} from './freeze.js';

const PKG = '@mmnto/strategy-doctrine';

let tmpRoot: string;
let totemDir: string;

/** The live strategy entry shape (scope + id + do-not) — the round-trip fixture. */
const COHORT_ENTRY = {
  subsystem: 'rule-compilation (legacy lesson-compile path)',
  id: RULE_COMPILATION_FREEZE_ID,
  scope: 'cohort',
  since: '2026-05-17',
  reason: 'Parked pending the Convergent Spine replacement.',
  tracking: 'multi-gate lift status',
  'do-not': ['run `totem lesson compile`'],
};

const LOCAL_ENTRY = {
  subsystem: 'embedder-tuning',
  since: '2026-06-01',
  reason: 'parked locally',
};

function writeLocalFreeze(content: unknown): void {
  fs.writeFileSync(
    path.join(totemDir, 'freeze.json'),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

/** Build an installed-package fixture at `<root>/node_modules/<PKG>/`. */
function installSnapshot(root: string, opts: { version?: string; freeze?: unknown } = {}): void {
  const pkgDir = path.join(root, 'node_modules', ...PKG.split('/'));
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: PKG, version: opts.version ?? '0.2.0' }),
  );
  if (opts.freeze !== undefined) {
    fs.writeFileSync(
      path.join(pkgDir, 'freeze.json'),
      typeof opts.freeze === 'string' ? opts.freeze : JSON.stringify(opts.freeze),
    );
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-freeze-'));
  totemDir = path.join(tmpRoot, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
});

afterEach(() => {
  // maxRetries/retryDelay rides out transient Windows ENOTEMPTY/EBUSY without
  // an empty catch swallowing real teardown failures (repo test-cleanup idiom).
  fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('FreezeEntry schema — scope + id (strategy#584 sub-task 3)', () => {
  it('parses legacy entries without scope as scope "local"', () => {
    writeLocalFreeze({ frozen: [LOCAL_ENTRY] });
    const config = readFreezeConfig(totemDir);
    expect(config?.frozen[0]?.scope).toBe('local');
  });

  it('round-trips the live strategy entry shape with scope/id/do-not preserved', () => {
    writeLocalFreeze({ frozen: [COHORT_ENTRY] });
    const entry = readFreezeConfig(totemDir)?.frozen[0];
    expect(entry?.scope).toBe('cohort');
    expect(entry?.id).toBe(RULE_COMPILATION_FREEZE_ID);
    expect(entry?.['do-not']).toEqual(['run `totem lesson compile`']);
  });

  it('rejects a non-kebab id fail-closed in the LOCAL reader', () => {
    writeLocalFreeze({ frozen: [{ subsystem: 'x', id: 'Not A Slug' }] });
    expect(() => readFreezeConfig(totemDir)).toThrow(TotemConfigError);
  });

  it('rejects an unknown scope value fail-closed in the LOCAL reader', () => {
    writeLocalFreeze({ frozen: [{ subsystem: 'x', scope: 'global' }] });
    expect(() => readFreezeConfig(totemDir)).toThrow(TotemConfigError);
  });
});

describe('readCohortFreezes — distributed channel states (Tenet 14)', () => {
  it('absent package → status absent-package, zero entries, no throw', () => {
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('absent-package');
    expect(r.entries).toEqual([]);
  });

  it('package without freeze.json → status absent-file, version still captured', () => {
    installSnapshot(tmpRoot, { version: '0.1.5' });
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('absent-file');
    expect(r.packageVersion).toBe('0.1.5');
  });

  it('malformed JSON → status corrupt + warning, never throws', () => {
    installSnapshot(tmpRoot, { freeze: '{ not json' });
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('corrupt');
    expect(r.entries).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('schema-invalid content (bad id slug) → status corrupt, conservative degrade', () => {
    installSnapshot(tmpRoot, {
      freeze: { frozen: [{ subsystem: 'x', scope: 'cohort', id: 'Not A Slug' }] },
    });
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('corrupt');
    expect(r.entries).toEqual([]);
  });

  it('filters scope:local entries out of the byte-copy snapshot (leak filter)', () => {
    installSnapshot(tmpRoot, {
      freeze: { frozen: [COHORT_ENTRY, { ...LOCAL_ENTRY, scope: 'local' }, LOCAL_ENTRY] },
    });
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('ok');
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.id).toBe(RULE_COMPILATION_FREEZE_ID);
  });

  it('id-less cohort entry stays visible but warns (renders, never gate-matches)', () => {
    installSnapshot(tmpRoot, {
      freeze: { frozen: [{ subsystem: 'orphan-system', scope: 'cohort' }] },
    });
    const r = readCohortFreezes(tmpRoot, PKG);
    expect(r.status).toBe('ok');
    expect(r.entries).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes('orphan-system'))).toBe(true);
  });

  it('resolves through an ancestor node_modules (workspace hoisting)', () => {
    const nested = path.join(tmpRoot, 'packages', 'consumer');
    fs.mkdirSync(nested, { recursive: true });
    installSnapshot(tmpRoot, { freeze: { frozen: [COHORT_ENTRY] } });
    const r = readCohortFreezes(nested, PKG);
    expect(r.status).toBe('ok');
    expect(r.entries).toHaveLength(1);
  });
});

describe('readEffectiveFreezes — union + per-source status (codex W1)', () => {
  it('unions local + cohort entries with distinct provenance, no dedup', () => {
    writeLocalFreeze({ frozen: [{ ...COHORT_ENTRY, scope: 'local' }] });
    installSnapshot(tmpRoot, { version: '0.2.0', freeze: { frozen: [COHORT_ENTRY] } });
    const r = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(r.entries).toHaveLength(2);
    expect(r.entries.map((e) => e.provenance).sort()).toEqual(['cohort', 'local']);
    const cohort = r.entries.find((e) => e.provenance === 'cohort');
    expect(cohort?.sourceVersion).toBe('0.2.0');
    expect(r.localStatus).toBe('ok');
    expect(r.cohortStatus).toBe('ok');
  });

  it('reports genuinely-none distinctly from both honest-absent channel states', () => {
    const none = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(none.localStatus).toBe('absent');
    expect(none.cohortStatus).toBe('absent-package');
    expect(none.entries).toEqual([]);

    installSnapshot(tmpRoot, {});
    const preEmit = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(preEmit.cohortStatus).toBe('absent-file');

    installSnapshot(tmpRoot, { freeze: { frozen: [] } });
    const empty = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(empty.cohortStatus).toBe('ok');
    expect(empty.entries).toEqual([]);
  });

  it('corrupt distributed snapshot degrades; corrupt LOCAL freeze still throws fail-closed', () => {
    installSnapshot(tmpRoot, { freeze: '{ nope' });
    const r = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(r.cohortStatus).toBe('corrupt');
    expect(r.warnings.length).toBeGreaterThan(0);

    writeLocalFreeze('{ also nope');
    expect(() => readEffectiveFreezes(tmpRoot, totemDir, PKG)).toThrow(TotemConfigError);
  });

  it('resolver purity: a snapshot installed between two calls is visible to the second', () => {
    expect(readEffectiveFreezes(tmpRoot, totemDir, PKG).cohortStatus).toBe('absent-package');
    installSnapshot(tmpRoot, { freeze: { frozen: [COHORT_ENTRY] } });
    const second = readEffectiveFreezes(tmpRoot, totemDir, PKG);
    expect(second.cohortStatus).toBe('ok');
    expect(second.entries).toHaveLength(1);
  });
});

/**
 * Init-distributed prepare wrapper (mmnto-ai/totem#2410 PR-B).
 *
 * Three surfaces:
 *   - PREPARE_WRAPPER behavior: write the template to a temp dir + execute it with
 *     `process.execPath` against a hermetic fake `@mmnto/cli` (mkdtemp + cleanup;
 *     nothing global mocked). Exit-code contract: MODULE_NOT_FOUND → 0 + skip line;
 *     child exit propagated verbatim; a corrupt/missing bin → 1.
 *   - wirePreparePackageJson: absent → set; canonical → unchanged; different →
 *     untouched (byte-identical); missing / unparseable manifests.
 *   - checkPrepareWrapper (doctor row): present+wired → pass; absent / miswired /
 *     drifted → warn with the right remedy; owner-repo / user-owned → skip.
 *
 * The wrapper spawns are short-lived synchronous `node` invocations with cwd pinned
 * to the hermetic temp dir (so resolution never leaks to the real repo's node_modules);
 * every temp dir is torn down in afterEach.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { checkPrepareWrapper } from './doctor.js';
import { wirePreparePackageJson } from './init.js';
import {
  PREPARE_SCRIPT_COMMAND,
  PREPARE_WRAPPER,
  TOTEM_FILE_END,
  TOTEM_FILE_MARKER,
} from './init-templates.js';

// ─── PREPARE_WRAPPER: exit-code behavior ─────────────────────────────

describe('PREPARE_WRAPPER — exit-code contract', () => {
  let tmpDir: string;
  let wrapperPath: string;

  const cliDir = () => path.join(tmpDir, 'node_modules', '@mmnto', 'cli');

  /** Plant a fake `@mmnto/cli` with the given bin filename + body (undefined body = no bin file). */
  function plantFakeCli(binFile: string, binBody: string | undefined): void {
    fs.mkdirSync(cliDir(), { recursive: true });
    fs.writeFileSync(
      path.join(cliDir(), 'package.json'),
      JSON.stringify({ name: '@mmnto/cli', version: '0.0.0', bin: { totem: `./${binFile}` } }),
    );
    if (binBody !== undefined) {
      fs.writeFileSync(path.join(cliDir(), binFile), binBody);
    }
  }

  /** Run the wrapper with cwd pinned to the hermetic temp dir. */
  function runWrapper(): { status: number | null; stderr: string } {
    const r = spawnSync(process.execPath, [wrapperPath], { cwd: tmpDir, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr ?? '' };
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410b-wrap-'));
    wrapperPath = path.join(tmpDir, 'prepare.cjs');
    fs.writeFileSync(wrapperPath, PREPARE_WRAPPER, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('(a) @mmnto/cli not resolvable → exit 0 + a declared-skip stderr line', () => {
    const { status, stderr } = runWrapper();
    expect(status).toBe(0);
    expect(stderr).toContain('@mmnto/cli is not installed');
    expect(stderr).toContain('skipping hook install');
  });

  it('(b) fake @mmnto/cli whose bin exits 0 → wrapper exits 0', () => {
    plantFakeCli('cli-bin.js', 'process.exit(0);\n');
    expect(runWrapper().status).toBe(0);
  });

  it('(c) fake bin exits 3 → wrapper propagates 3 (a genuine hook-install failure fails prepare loud)', () => {
    plantFakeCli('cli-bin.js', 'process.exit(3);\n');
    expect(runWrapper().status).toBe(3);
  });

  it('(d) resolution ok but the bin file is missing (corrupt install) → exit 1', () => {
    // package.json resolves + declares a bin, but the bin JS does not exist → the
    // spawned `node <missing>` exits 1, which the wrapper propagates verbatim.
    plantFakeCli('missing-bin.js', undefined);
    expect(runWrapper().status).toBe(1);
  });

  it('never spawns through a shell (spawnSync argv form; no shell:true) — the marker opens the file', () => {
    // Structural guard: the emitted wrapper drives node via an argv array, not a
    // shell string (the Windows quoting class, mmnto-ai/totem#2351).
    expect(PREPARE_WRAPPER.trimStart().startsWith(TOTEM_FILE_MARKER)).toBe(true);
    expect(PREPARE_WRAPPER).toContain("spawnSync(process.execPath, [binJs, 'hook', 'install']");
    expect(PREPARE_WRAPPER).not.toContain('shell: true');
    expect(PREPARE_WRAPPER).not.toContain('execSync');
  });
});

// ─── wirePreparePackageJson: wiring matrix ───────────────────────────

describe('wirePreparePackageJson — wiring matrix', () => {
  let tmpDir: string;
  const pkgPath = () => path.join(tmpDir, 'package.json');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410b-wire-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('no prepare script → sets it (wired)', () => {
    fs.writeFileSync(
      pkgPath(),
      JSON.stringify({ name: 'consumer', scripts: { build: 'tsc' } }, null, 2) + '\n',
    );
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('wired');
    const parsed = JSON.parse(fs.readFileSync(pkgPath(), 'utf-8'));
    expect(parsed.scripts.prepare).toBe(PREPARE_SCRIPT_COMMAND);
    // Existing key order preserved; prepare appended after build.
    expect(Object.keys(parsed.scripts)).toEqual(['build', 'prepare']);
    // Trailing newline preserved.
    expect(fs.readFileSync(pkgPath(), 'utf-8').endsWith('}\n')).toBe(true);
  });

  it('no scripts block at all → creates scripts with prepare (wired)', () => {
    fs.writeFileSync(pkgPath(), JSON.stringify({ name: 'consumer' }, null, 2) + '\n');
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('wired');
    expect(JSON.parse(fs.readFileSync(pkgPath(), 'utf-8')).scripts.prepare).toBe(
      PREPARE_SCRIPT_COMMAND,
    );
  });

  it('prepare already exactly canonical → unchanged (exists), byte-identical', () => {
    const raw =
      JSON.stringify({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } }, null, 2) +
      '\n';
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('exists');
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  it('a DIFFERENT existing prepare → declined + byte-identical (no overwrite of user content)', () => {
    const raw =
      JSON.stringify({ name: 'consumer', scripts: { prepare: 'husky install' } }, null, 2) + '\n';
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('declined');
    expect(r.existing).toBe('husky install');
    // The whole file is preserved verbatim.
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  it('a non-string prepare value → declined + byte-identical (never clobber weird user content)', () => {
    const raw =
      JSON.stringify({ name: 'consumer', scripts: { prepare: { weird: true } } }, null, 2) + '\n';
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('declined');
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  it('no package.json → missing (nothing to wire)', () => {
    expect(wirePreparePackageJson(pkgPath()).action).toBe('missing');
  });

  it('invalid JSON → unparseable (surfaced, never a crash), byte-identical', () => {
    const raw = '{ not valid json ]';
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('unparseable');
    expect(r.err).toBeDefined();
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  // F1 (mmnto-ai/totem#2416): a non-object JSON root must not crash at `.scripts` or be
  // written into — validate the shape and decline as unparseable.
  it.each([
    ['null root', 'null'],
    ['scalar root', '5'],
    ['string root', '"hi"'],
    ['array root', '[]'],
  ])('%s → unparseable + byte-identical (never dereferenced or written)', (_label, raw) => {
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('unparseable');
    expect(r.err).toBeDefined();
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  it('a present-but-non-object `scripts` → unparseable + byte-identical (never clobbered)', () => {
    // The pre-fix bug: a non-object `scripts` fell through to the wire branch and was
    // silently REPLACED by `{ prepare: ... }`. It must be declined as unparseable.
    const raw = JSON.stringify({ name: 'consumer', scripts: 'oops-a-string' }, null, 2) + '\n';
    fs.writeFileSync(pkgPath(), raw);
    const r = wirePreparePackageJson(pkgPath());
    expect(r.action).toBe('unparseable');
    expect(fs.readFileSync(pkgPath(), 'utf-8')).toBe(raw);
  });

  // F5 (mmnto-ai/totem#2416): a write that throws is a DISTINCT discriminant from a
  // read/parse/shape problem.
  it('a write failure → write-failed (distinct from unparseable)', () => {
    const raw = JSON.stringify({ name: 'consumer' }, null, 2) + '\n';
    fs.writeFileSync(pkgPath(), raw);
    fs.chmodSync(pkgPath(), 0o444); // read-only → read+parse succeed, writeFileSync throws (EPERM/EACCES)
    try {
      const r = wirePreparePackageJson(pkgPath());
      expect(r.action).toBe('write-failed');
      expect(r.err).toBeDefined();
    } finally {
      // Restore write perms so cleanup can remove the temp dir.
      fs.chmodSync(pkgPath(), 0o644);
    }
  });
});

// ─── checkPrepareWrapper: doctor sensor row ──────────────────────────

describe('checkPrepareWrapper — doctor parity row (sensor, never gates)', () => {
  let tmpDir: string;

  const wrapperPath = () => path.join(tmpDir, '.totem', 'prepare.cjs');
  const pkgPath = () => path.join(tmpDir, 'package.json');

  function writeWrapper(content: string): void {
    fs.mkdirSync(path.dirname(wrapperPath()), { recursive: true });
    fs.writeFileSync(wrapperPath(), content, 'utf-8');
  }
  function writePkg(pkg: unknown): void {
    fs.writeFileSync(pkgPath(), JSON.stringify(pkg, null, 2) + '\n');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2410b-doc-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('present + canonical + wired → pass', async () => {
    writeWrapper(PREPARE_WRAPPER);
    writePkg({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('pass');
  });

  it('wrapper absent + no prepare → warn, remedy names totem init', async () => {
    writePkg({ name: 'consumer', scripts: { build: 'tsc' } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toBe('totem init');
  });

  it('wrapper present + canonical but prepare NOT wired → warn (miswired), remedy totem init', async () => {
    writeWrapper(PREPARE_WRAPPER);
    writePkg({ name: 'consumer', scripts: {} });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toBe('totem init');
    expect(r.message).toContain('not wired');
  });

  it('wrapper present + marker-headed + BOUNDED but drifted → warn, remedy is bare totem hook install', async () => {
    writeWrapper(`${TOTEM_FILE_MARKER} — drifted\nconsole.log("stale");\n${TOTEM_FILE_END}\n`);
    writePkg({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toBe('totem hook install');
    expect(r.message).toContain('drifted');
  });

  // F3 (mmnto-ai/totem#2416): a marker-headed but UNBOUNDED drifted wrapper (no end
  // marker) is not bare-repairable — the remedy must name --force.
  it('wrapper present + marker-headed but UNBOUNDED drifted → warn, remedy is totem hook install --force', async () => {
    writeWrapper(`${TOTEM_FILE_MARKER} — drifted, no end marker\nconsole.log("stale");\n`);
    writePkg({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toBe('totem hook install --force');
    expect(r.message).toContain('drifted');
  });

  // F2 (mmnto-ai/totem#2416): a wrapper that EXISTS but cannot be read must warn with the
  // read-failure detail, not fall through to the user-owned skip. A directory-at-path makes
  // existsSync true while readFileSync throws EISDIR (cross-platform).
  it('wrapper present but unreadable (EISDIR) → warn naming the read failure, not a user-owned skip', async () => {
    fs.mkdirSync(path.join(tmpDir, '.totem', 'prepare.cjs'), { recursive: true });
    writePkg({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.message).toContain('could not read');
    expect(r.message).not.toContain('user-owned');
  });

  // F4 (mmnto-ai/totem#2416): canonical wrapper present but a DIFFERENT prepare exists —
  // `totem init` deliberately declines that, so the remedy must be the manual line.
  it('wrapper present + canonical but a DIFFERENT prepare → warn, remedy is the manual line (not totem init)', async () => {
    writeWrapper(PREPARE_WRAPPER);
    writePkg({ name: 'consumer', scripts: { prepare: 'husky install' } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toContain('add or chain');
    expect(r.remediation).not.toBe('totem init');
  });

  it('owner-repo exception: wrapper absent + a DIFFERENT user-managed prepare → skip (no nudge)', async () => {
    writePkg({ name: 'owner', scripts: { prepare: 'node tools/install-hooks.js' } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('skip');
  });

  it('user-owned .totem/prepare.cjs (no Totem marker) → skip (left as-is)', async () => {
    writeWrapper('// my own prepare helper\nconsole.log("mine");\n');
    writePkg({ name: 'consumer', scripts: { prepare: 'node .totem/prepare.cjs' } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('skip');
  });

  it('no package.json → skip (nothing to wire)', async () => {
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('skip');
  });

  it('wired canonical but wrapper file missing → warn, remedy totem init', async () => {
    writePkg({ name: 'consumer', scripts: { prepare: PREPARE_SCRIPT_COMMAND } });
    const r = await checkPrepareWrapper(tmpDir);
    expect(r.status).toBe('warn');
    expect(r.remediation).toBe('totem init');
    expect(r.message).toContain('missing');
  });
});

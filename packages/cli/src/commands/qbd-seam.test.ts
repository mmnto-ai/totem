/**
 * Seam-resolution tests for the query-before-derive instrumentation
 * (mmnto-ai/totem#2510).
 *
 * ## Test isolation is load-bearing here, not hygiene
 *
 * Every test passes an explicit temp `homeDir`. `resolveConfigPath` falls back
 * to the global `~/.totem/` profile when the cwd has no config, so a test that
 * omits it resolves the DEVELOPER'S REAL profile — and on a machine whose
 * global config sets `totemDir: '.'`, the writer then appends real derive rows
 * to their live `~/.totem/ledger/events.ndjson`. An earlier version of this
 * file did exactly that on every suite run. No test here may be *able* to reach
 * the real profile.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { recordQbdDerive, recordQbdQuery, resolveQbdLedgerDirDetailed } from './qbd-seam.js';

/** A minimal VALID config — `targets` requires at least one entry. */
const TOTEM_YAML = [
  'targets:',
  '  - glob: "src/**/*.ts"',
  '    type: code',
  '    strategy: file',
  '',
].join('\n');

let projectRoot: string;
/** A temp home with NO global profile — the "no config anywhere" case. */
let emptyHome: string;

beforeEach(() => {
  projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-seam-')));
  fs.writeFileSync(path.join(projectRoot, 'totem.yaml'), TOTEM_YAML, 'utf-8');
  fs.mkdirSync(path.join(projectRoot, '.totem'), { recursive: true });

  emptyHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-home-')));
});

afterEach(() => {
  cleanTmpDir(projectRoot);
  cleanTmpDir(emptyHome);
});

/**
 * Build a temp home that DOES carry a global profile.
 *
 * `totemDir: '.'` mirrors the real-world shape (it is what this machine's
 * `~/.totem/totem.config.ts` sets), so the profile's ledger lives at
 * `<home>/.totem/ledger/` — the layout the silent-landing finding was about.
 */
function homeWithGlobalProfile(): string {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-ghome-')));
  const globalDir = path.join(home, '.totem');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'totem.yaml'), `totemDir: "."\n${TOTEM_YAML}`, 'utf-8');
  return home;
}

/** Where a `homeWithGlobalProfile` home keeps its ledger. */
function globalTotemDir(home: string): string {
  return path.join(home, '.totem');
}

function ledgerRows(totemDir: string): Array<Record<string, unknown>> {
  const file = path.join(totemDir, 'ledger', 'events.ndjson');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('resolveQbdLedgerDirDetailed', () => {
  it('resolves from the config root', async () => {
    const detailed = await resolveQbdLedgerDirDetailed(projectRoot, emptyHome);
    expect(detailed.reason ?? 'resolved').toBe('resolved');
    expect(detailed.dir).toBe(path.join(projectRoot, '.totem'));
    expect(detailed.global).toBe(false);
  });

  it('resolves a cwd that is NOT the config root to the CONFIG ROOT ledger', async () => {
    // The discriminating case. From a subdirectory with a global profile in
    // play, the old `path.join(cwd, config.totemDir)` would answer
    // `<subdir>/.totem`; the correct answer is the resolved config's own root.
    // At the project root the two agree, which is why a root-only assertion
    // proves nothing about the bug it is supposed to pin.
    const home = homeWithGlobalProfile();
    try {
      const subdir = path.join(projectRoot, 'packages', 'thing');
      fs.mkdirSync(subdir, { recursive: true });

      const detailed = await resolveQbdLedgerDirDetailed(subdir, home);
      // What the old cwd-joined logic would have answered, computed from the
      // SAME `totemDir` this fixture's profile sets (`.`) — so it is `subdir`
      // itself, not `subdir/.totem`. Hard-coding `.totem` here made the
      // assertion pass under both implementations, i.e. pinned nothing.
      const oldBuggyAnswer = path.join(subdir, '.');

      expect(detailed.dir).toBeDefined();
      expect(detailed.dir).not.toBe(oldBuggyAnswer);
      expect(detailed.dir).toBe(globalTotemDir(home));
      expect(detailed.global).toBe(true);
    } finally {
      cleanTmpDir(home);
    }
  });

  it('gives two different cwds under one config root the SAME ledger dir', async () => {
    const home = homeWithGlobalProfile();
    try {
      const a = path.join(projectRoot, 'packages', 'alpha');
      const b = path.join(projectRoot, 'docs', 'deep', 'nested');
      fs.mkdirSync(a, { recursive: true });
      fs.mkdirSync(b, { recursive: true });

      const fromA = await resolveQbdLedgerDirDetailed(a, home);
      const fromB = await resolveQbdLedgerDirDetailed(b, home);

      // Resolution is a function of the resolved config root, so two cwds that
      // resolve the same config cannot disagree about where rows land. Under
      // the old cwd-joined logic these two answers differed.
      expect(fromA.dir).toBe(fromB.dir);
      expect(fromA.dir).not.toBe(path.join(a, '.totem'));
      expect(fromB.dir).not.toBe(path.join(b, '.totem'));
    } finally {
      cleanTmpDir(home);
    }
  });

  it('reports CONFIG_MISSING when neither cwd nor home carries a config', async () => {
    const orphan = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-orphan-')));
    try {
      const detailed = await resolveQbdLedgerDirDetailed(orphan, emptyHome);
      expect(detailed.dir).toBeUndefined();
      expect(detailed.reason).toContain('no Totem config found');
    } finally {
      cleanTmpDir(orphan);
    }
  });
});

describe('recordQbdDerive', () => {
  it('records into the project ledger when run from the project root', async () => {
    const report = await recordQbdDerive(projectRoot, 'review', () => {}, emptyHome);
    expect(report.recorded).toBe(true);
    expect(report.note).toBeUndefined();

    const rows = ledgerRows(path.join(projectRoot, '.totem'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('derive_action');
    expect(rows[0]!.activity_name).toBe('review');
  });

  it('never creates a stray ledger under a subdirectory', async () => {
    const subdir = path.join(projectRoot, 'packages', 'thing');
    fs.mkdirSync(subdir, { recursive: true });

    const report = await recordQbdDerive(subdir, 'spec', () => {}, emptyHome);

    expect(fs.existsSync(path.join(subdir, '.totem'))).toBe(false);
    if (!report.recorded) expect(report.note).toBeDefined();
  });

  it('ANNOUNCES a landing in the global profile instead of doing it silently', async () => {
    // Legitimate, but the row goes somewhere other than the project the user is
    // looking at — so it must say so. This was the silent half of the finding.
    const home = homeWithGlobalProfile();
    const orphan = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-orphan-')));
    try {
      const report = await recordQbdDerive(orphan, 'orient', () => {}, home);
      expect(report.recorded).toBe(true);
      expect(report.note).toBeDefined();
      expect(report.note).toContain('global profile ledger');
      // And it landed in the global profile's ledger, not the orphan cwd.
      expect(ledgerRows(globalTotemDir(home))).toHaveLength(1);
      expect(fs.existsSync(path.join(orphan, '.totem'))).toBe(false);
    } finally {
      cleanTmpDir(orphan);
      cleanTmpDir(home);
    }
  });

  it('never no-ops silently when there is no project at all', async () => {
    const orphan = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-orphan-')));
    try {
      const report = await recordQbdDerive(orphan, 'orient', () => {}, emptyHome);
      expect(report.recorded).toBe(false);
      expect(report.note).toContain('query-before-derive');
    } finally {
      cleanTmpDir(orphan);
    }
  });
});

describe('recordQbdQuery', () => {
  it('writes a corpus_query row carrying a correlation ID into the project ledger', async () => {
    const report = await recordQbdQuery(projectRoot, () => {}, emptyHome);
    expect(report.recorded).toBe(true);

    const rows = ledgerRows(path.join(projectRoot, '.totem'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('corpus_query');
    expect(rows[0]!.activity_name).toBe('totem_search');
    expect(typeof rows[0]!.qbd_correlation_id).toBe('string');
  });

  it('shares the derive seam’s not-recording contract', async () => {
    // Both seams route through one internal body, so the note strings cannot
    // drift apart — this pins that they really are the same contract.
    const orphan = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-qbd-orphan-')));
    try {
      const queryReport = await recordQbdQuery(orphan, () => {}, emptyHome);
      const deriveReport = await recordQbdDerive(orphan, 'orient', () => {}, emptyHome);
      expect(queryReport.recorded).toBe(false);
      expect(queryReport.note).toBe(deriveReport.note);
    } finally {
      cleanTmpDir(orphan);
    }
  });
});

describe('review seam placement', () => {
  /**
   * Source pin, and an honest account of why it is one.
   *
   * `handleVerdictResult` is module-private and `shieldCommand` needs the
   * orchestrator, the Lance index, git, and the exemption store before it
   * reaches a verdict, so driving the structural branch executably is not
   * feasible at unit scope. The previous version of this test was worse than
   * useless: it indexed the IMPORT of `recordQbdDerive` rather than the call,
   * never read the enclosing control flow, and would have passed after a
   * comment edit.
   *
   * This one anchors to the CALL EXPRESSION inside the enclosing function body.
   * Mutations it catches: moving the record call out of `handleVerdictResult`
   * (structural and standard would both stop recording); deleting the fan's own
   * call (the fan path would stop recording); the structural branch no longer
   * routing through the shared handler before it returns.
   *
   * Mutations it does NOT catch, stated so the pin is not read as stronger than
   * it is: reordering within the handler; a call that is present but
   * unreachable; and — because these are substring matches, not parsed
   * statements — a *comment* mentioning `recordQbdDerive(` would satisfy them
   * just as well as the real call. Accepted, because the alternative at unit
   * scope is no coverage at all, and building an AST harness for one call site
   * is machinery this slice does not need.
   */
  const source = fs.readFileSync(path.join(__dirname, 'shield.ts'), 'utf-8');

  /** Slice out one top-level function body by declaration name. */
  function functionBody(name: string): string {
    const start = source.indexOf(`async function ${name}(`);
    expect(start, `${name} should exist`).toBeGreaterThan(-1);
    const rest = source.slice(start + 1);
    const end = rest.search(/\n(?:export )?(?:async )?function /);
    return end === -1 ? rest : rest.slice(0, end);
  }

  it('records the derive INSIDE the shared verdict handler', () => {
    // Structural and standard both route through this function, so a call here
    // fires exactly once per review and only after a verdict exists.
    const body = functionBody('handleVerdictResult');
    expect(body).toContain('recordQbdDerive(');
  });

  it('records only AFTER a verdict has parsed — never for --raw or unparsable', () => {
    // The recording used to be the handler's first statement, which put it
    // ahead of BOTH `if (options.raw) return` and the unparsable-verdict throw:
    // a raw context dump recorded a derive (and could consume a query's
    // grounding), and so did a run whose verdict never parsed.
    //
    // The invariant is positional, so pin it positionally: the record call must
    // sit after the raw exit AND after the point where a verdict is parsed.
    const body = functionBody('handleVerdictResult');
    const rawExitIdx = body.indexOf('if (options.raw) return;');
    const laneDeriveIdx = body.indexOf('deriveLaneOutcome(');
    const structuralBranchIdx = body.indexOf('if (outcome.structuredVerdict)');
    const v1BranchIdx = body.indexOf('const verdict = parseVerdict(content);');
    const firstRecordIdx = body.indexOf('await recordReviewDerive()');

    expect(rawExitIdx).toBeGreaterThan(-1);
    expect(laneDeriveIdx).toBeGreaterThan(-1);
    expect(firstRecordIdx).toBeGreaterThan(-1);

    // After the raw exit: `--raw` returns before any record can fire.
    expect(firstRecordIdx).toBeGreaterThan(rawExitIdx);
    // After the verdict is derived: nothing records before parsing is attempted.
    expect(firstRecordIdx).toBeGreaterThan(laneDeriveIdx);
    // And the call sites are the two PARSED-verdict branches, not the body.
    expect(firstRecordIdx).toBeGreaterThan(structuralBranchIdx);
    expect(body.indexOf('await recordReviewDerive()', v1BranchIdx)).toBeGreaterThan(v1BranchIdx);
  });

  it('records on a FAIL verdict too — a failing review is a completed derive', () => {
    // Excluding FAIL would shrink the denominator, which is the falsifier-1
    // failure mode. The record sits at the TOP of the structured branch, ahead
    // of the pass/fail split and ahead of the SHIELD_FAILED throw.
    const body = functionBody('handleVerdictResult');
    const recordIdx = body.indexOf('await recordReviewDerive()');
    const failThrowIdx = body.indexOf("'SHIELD_FAILED'");
    expect(failThrowIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeLessThan(failThrowIdx);
  });

  it('routes the structural branch through that shared handler before returning', () => {
    const body = functionBody('shieldCommand');
    const structuralIdx = body.indexOf("options.mode === 'structural'");
    expect(structuralIdx).toBeGreaterThan(-1);

    const afterStructural = body.slice(structuralIdx);
    const handlerIdx = afterStructural.indexOf('handleVerdictResult(');
    const returnIdx = afterStructural.indexOf('\n    return;');
    expect(handlerIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    expect(handlerIdx).toBeLessThan(returnIdx);
  });

  it('gives the multi-lane fan its own record call, since it bypasses the handler', () => {
    const body = functionBody('shieldCommand');
    const fanIdx = body.indexOf('runReviewFan(');
    expect(fanIdx).toBeGreaterThan(-1);
    expect(body.slice(fanIdx)).toContain('recordQbdDerive(');
  });
});

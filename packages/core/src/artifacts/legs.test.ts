/**
 * Leg-deposit store tests (mmnto-ai/totem#2698).
 *
 * These lock the core-owned half of the design's "invariants to lock in via
 * tests": the store is read JSON-AWARE through the schema (a file that merely
 * quotes `diffSha`/`findings` in some other shape is not a deposit), ancestry
 * ranking is exact > nearest ancestor > latest read, a corrupt file is
 * disclosed by name and reason and never hides a valid sibling,
 * `unknown-commit` and `not-ancestor` are DISTINCT stale reasons, the schema
 * refuses control bytes and a non-subset `folded` at write and at read alike,
 * and the writer is create-exclusive with a disclosed replacement.
 *
 * Every hostile string is built with `String.fromCharCode` on purpose: a
 * literal `\u`/`\x` escape authored through an editing tool has landed as a
 * RAW control byte in this repo before, which would make the test assert
 * something other than what it reads as.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  countLegFindings,
  findLegDepositForHead,
  LEG_DEPOSIT_KNOWN_MAJOR,
  LEG_DEPOSIT_SCHEMA_VERSION,
  LEG_FINDING_SEVERITIES,
  type LegDeposit,
  LegDepositExistsError,
  legDepositPath,
  LegDepositSchema,
  type LegFinding,
  type LegGitAdapter,
  legsDir,
  loadLegDeposits,
  renderLegField,
  saveLegDeposit,
} from './legs.js';

const LF = String.fromCharCode(0x0a);
const NUL = String.fromCharCode(0x00);
const NEL = String.fromCharCode(0x85);
const ESC = String.fromCharCode(0x1b);

/** Distinct, deterministic 40-hex shas — the store's addresses. */
function sha(seed: string): string {
  return seed.repeat(40).slice(0, 40);
}

const HEAD = sha('a');
const OLDER = sha('b');
const OLDEST = sha('c');
const ELSEWHERE = sha('d');

function finding(overrides: Partial<LegFinding> = {}): LegFinding {
  return {
    id: 'F1',
    severity: 'BLOCKING',
    file: 'packages/core/src/artifacts/legs.ts',
    line: 12,
    claim: 'the loader throws on a corrupt file',
    counterexample: 'loadLegDeposits returns a corrupt row instead',
    ...overrides,
  };
}

function deposit(overrides: Partial<LegDeposit> = {}): LegDeposit {
  return {
    schemaVersion: LEG_DEPOSIT_SCHEMA_VERSION,
    diffSha: HEAD,
    readAt: '2026-09-03T05:00:00.000Z',
    findings: [finding()],
    folded: ['F1'],
    verdict: 'one blocking finding, folded',
    ...overrides,
  };
}

/** A git seam that knows a fixed commit set and a fixed ancestry map. */
function fakeGit(options: {
  commits: readonly string[];
  /** `sha -> distance to head`; absent means "commit, but not an ancestor". */
  ancestors?: Record<string, number>;
}): LegGitAdapter {
  const ancestors = options.ancestors ?? {};
  return {
    isCommit: (candidate) => options.commits.includes(candidate),
    isAncestor: (base) => Object.hasOwn(ancestors, base),
    distance: (base) => ancestors[base] ?? 0,
  };
}

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-legs-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write raw bytes into the store, bypassing the writer (the hand-edit path). */
function writeRaw(name: string, content: string): void {
  fs.mkdirSync(legsDir(tmpDir), { recursive: true });
  fs.writeFileSync(path.join(legsDir(tmpDir), name), content, 'utf-8');
}

describe('LegDepositSchema — the parse boundary', () => {
  it('accepts a well-formed deposit and tolerates a forward-minor unknown key', () => {
    const forward = { ...deposit(), schemaVersion: '1.7.0', futureField: 'ignored by this reader' };
    const parsed = LegDepositSchema.safeParse(forward);
    expect(parsed.success).toBe(true);
    // Tolerated means STRIPPED, not preserved (the run-artifact precedent).
    if (parsed.success) expect('futureField' in parsed.data).toBe(false);
  });

  it('refuses a newer major BY NAME, not as generic corruption', () => {
    const parsed = LegDepositSchema.safeParse({ ...deposit(), schemaVersion: '2.0.0' });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((i) => i.message).join(' ')).toContain(
        `this reader understands major ${LEG_DEPOSIT_KNOWN_MAJOR}.x`,
      );
    }
  });

  it('requires a full 40-hex lowercase diffSha', () => {
    for (const bad of [HEAD.slice(0, 8), HEAD.toUpperCase(), `${HEAD}0`, 'not-a-sha']) {
      expect(LegDepositSchema.safeParse({ ...deposit(), diffSha: bad }).success, bad).toBe(false);
    }
  });

  it('requires finding ids to be unique', () => {
    const parsed = LegDepositSchema.safeParse(
      deposit({
        findings: [finding({ id: 'F1' }), finding({ id: 'F1', claim: 'a second claim' })],
        folded: [],
      }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('duplicate finding id'))).toBe(
        true,
      );
    }
  });

  it('requires folded to be a SUBSET of the finding ids', () => {
    const parsed = LegDepositSchema.safeParse(
      deposit({ findings: [finding({ id: 'F1' })], folded: ['F1', 'F9'] }),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('"F9"'))).toBe(true);
      expect(parsed.error.issues.some((i) => i.path.join('.') === 'folded.1')).toBe(true);
    }
  });

  it('accepts empty findings and empty folded — a leg that found nothing still deposits', () => {
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [], folded: [], verdict: 'no findings' }))
        .success,
    ).toBe(true);
  });

  it('refuses a multi-line verdict', () => {
    const parsed = LegDepositSchema.safeParse(deposit({ verdict: `line one${LF}line two` }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path.join('.')).toBe('verdict');
  });

  it('refuses control bytes in verdict, claim, counterexample and file', () => {
    const cases: Array<[string, LegDeposit]> = [
      ['verdict', deposit({ verdict: `ok${NUL}` })],
      ['findings.0.claim', deposit({ findings: [finding({ claim: `c${NEL}` })], folded: [] })],
      [
        'findings.0.counterexample',
        deposit({ findings: [finding({ counterexample: `${ESC}[2J` })], folded: [] }),
      ],
      ['findings.0.file', deposit({ findings: [finding({ file: `a.ts${LF}b.ts` })], folded: [] })],
    ];
    for (const [expectedPath, candidate] of cases) {
      const parsed = LegDepositSchema.safeParse(candidate);
      expect(parsed.success, expectedPath).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.map((i) => i.path.join('.'))).toContain(expectedPath);
      }
    }
  });

  it('allows an EMPTY counterexample but not an empty claim, file or verdict', () => {
    expect(
      LegDepositSchema.safeParse(
        deposit({ findings: [finding({ counterexample: '' })], folded: [] }),
      ).success,
    ).toBe(true);
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [finding({ claim: '' })], folded: [] }))
        .success,
    ).toBe(false);
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [finding({ file: '' })], folded: [] }))
        .success,
    ).toBe(false);
    expect(LegDepositSchema.safeParse(deposit({ verdict: '' })).success).toBe(false);
  });

  it('refuses a negative or fractional line, accepts 0', () => {
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [finding({ line: 0 })], folded: [] })).success,
    ).toBe(true);
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [finding({ line: -1 })], folded: [] }))
        .success,
    ).toBe(false);
    expect(
      LegDepositSchema.safeParse(deposit({ findings: [finding({ line: 1.5 })], folded: [] }))
        .success,
    ).toBe(false);
  });

  it('pins the severity vocabulary as a set', () => {
    expect([...LEG_FINDING_SEVERITIES]).toEqual(['BLOCKING', 'MATERIAL', 'MINOR']);
    expect(
      LegDepositSchema.safeParse(
        deposit({ findings: [finding({ severity: 'CRITICAL' as never })], folded: [] }),
      ).success,
    ).toBe(false);
  });
});

describe('saveLegDeposit — create-exclusive, atomic, validate-first', () => {
  it('stores the deposit at <diffSha>.json with a diffSha equal to the name', () => {
    const result = saveLegDeposit(tmpDir, deposit());
    expect(result.path).toBe(legDepositPath(tmpDir, HEAD));
    expect(path.basename(result.path)).toBe(`${HEAD}.json`);
    expect(result.replaced).toBeUndefined();
    const onDisk = JSON.parse(fs.readFileSync(result.path, 'utf-8')) as LegDeposit;
    expect(onDisk.diffSha).toBe(path.basename(result.path, '.json'));
  });

  it('refuses an existing sha without replace, naming the incumbent readAt', () => {
    saveLegDeposit(tmpDir, deposit({ readAt: '2026-09-01T00:00:00.000Z' }));
    let caught: unknown;
    try {
      saveLegDeposit(tmpDir, deposit({ readAt: '2026-09-03T00:00:00.000Z' }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LegDepositExistsError);
    const refusal = caught as LegDepositExistsError;
    expect(refusal.code).toBe('LEG_DEPOSIT_EXISTS');
    expect(refusal.existingReadAt).toBe('2026-09-01T00:00:00.000Z');
    expect(refusal.message).toContain('2026-09-01T00:00:00.000Z');
    // The refused write did NOT touch the incumbent.
    const onDisk = JSON.parse(fs.readFileSync(legDepositPath(tmpDir, HEAD), 'utf-8')) as LegDeposit;
    expect(onDisk.readAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('replaces with the OLD readAt reported', () => {
    saveLegDeposit(tmpDir, deposit({ readAt: '2026-09-01T00:00:00.000Z' }));
    const result = saveLegDeposit(tmpDir, deposit({ readAt: '2026-09-03T00:00:00.000Z' }), {
      replace: true,
    });
    expect(result.replaced).toEqual({ readAt: '2026-09-01T00:00:00.000Z' });
    const onDisk = JSON.parse(fs.readFileSync(result.path, 'utf-8')) as LegDeposit;
    expect(onDisk.readAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('replaces a CORRUPT incumbent, disclosing that its instant was unreadable', () => {
    writeRaw(`${HEAD}.json`, 'not json at all');
    const result = saveLegDeposit(tmpDir, deposit(), { replace: true });
    expect(result.replaced).toEqual({ readAt: undefined });
    expect(loadLegDeposits(tmpDir).deposits).toHaveLength(1);
  });

  it('leaves NO file and NO temp behind on a validation failure', () => {
    expect(() => saveLegDeposit(tmpDir, deposit({ verdict: `bad${LF}verdict` }))).toThrow();
    expect(fs.existsSync(legsDir(tmpDir))).toBe(false);

    // …and none beside an existing store either.
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDER }));
    expect(() => saveLegDeposit(tmpDir, deposit({ diffSha: HEAD, folded: ['nope'] }))).toThrow();
    expect(fs.readdirSync(legsDir(tmpDir))).toEqual([`${OLDER}.json`]);
  });

  it('leaves no temp file behind on a successful write either', () => {
    saveLegDeposit(tmpDir, deposit());
    expect(fs.readdirSync(legsDir(tmpDir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('loadLegDeposits — tolerant, JSON-aware, never throws', () => {
  it('returns empty results when the store directory does not exist', () => {
    expect(loadLegDeposits(tmpDir)).toEqual({ deposits: [], corrupt: [] });
  });

  it('ignores non-.json entries entirely (not deposits, not corrupt rows)', () => {
    saveLegDeposit(tmpDir, deposit());
    writeRaw('notes.md', 'a leg wrote prose here');
    writeRaw('.gitkeep', '');
    const result = loadLegDeposits(tmpDir);
    expect(result.deposits).toHaveLength(1);
    expect(result.corrupt).toEqual([]);
  });

  it('is JSON-AWARE: a file that merely QUOTES diffSha/findings is corrupt, not a deposit', () => {
    // A review artifact copied into the store: same words, different shape.
    writeRaw(
      `${HEAD}.json`,
      JSON.stringify({
        schemaVersion: '1.0.0',
        note: `this record mentions diffSha ${HEAD} and findings but is a verdict artifact`,
        findings: 3,
        lanes: ['anthropic:claude-opus-5'],
      }),
    );
    const result = loadLegDeposits(tmpDir);
    expect(result.deposits).toEqual([]);
    expect(result.corrupt).toHaveLength(1);
    expect(result.corrupt[0]?.file).toBe(`${HEAD}.json`);
    expect(result.corrupt[0]?.reason).toContain('schema-invalid');
  });

  it('discloses each corrupt file by name and reason WITHOUT hiding a valid sibling', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: HEAD }));
    writeRaw(`${OLDER}.json`, '{ this is not json');
    writeRaw(`${OLDEST}.json`, JSON.stringify({ ...deposit({ diffSha: OLDEST }), verdict: '' }));

    const result = loadLegDeposits(tmpDir);
    expect(result.deposits.map((d) => d.diffSha)).toEqual([HEAD]);
    expect(result.corrupt.map((c) => c.file).sort()).toEqual(
      [`${OLDER}.json`, `${OLDEST}.json`].sort(),
    );
    const unreadable = result.corrupt.find((c) => c.file === `${OLDER}.json`);
    expect(unreadable?.reason).toContain('unreadable or not JSON');
    const invalid = result.corrupt.find((c) => c.file === `${OLDEST}.json`);
    expect(invalid?.reason).toContain('verdict');
  });

  it('every corrupt reason is ONE echo-safe line', () => {
    writeRaw(`${HEAD}.json`, JSON.stringify(deposit({ verdict: `a${LF}b${NUL}c` })));
    const [row] = loadLegDeposits(tmpDir).corrupt;
    expect(row).toBeDefined();
    const reason = row?.reason ?? '';
    for (let i = 0; i < reason.length; i++) {
      const code = reason.charCodeAt(i);
      expect(code < 32 || (code >= 127 && code <= 159), `code ${code} at ${i}`).toBe(false);
    }
  });

  it('refuses a newer-major deposit BY NAME rather than as corruption', () => {
    writeRaw(`${HEAD}.json`, JSON.stringify({ ...deposit(), schemaVersion: '2.0.0' }));
    const result = loadLegDeposits(tmpDir);
    expect(result.deposits).toEqual([]);
    expect(result.corrupt[0]?.reason).toContain('written by a newer totem');
    expect(result.corrupt[0]?.reason).toContain('upgrade @mmnto/cli');
  });

  it('refuses a file whose NAME disagrees with its stored diffSha', () => {
    writeRaw(`${OLDER}.json`, JSON.stringify(deposit({ diffSha: HEAD })));
    const result = loadLegDeposits(tmpDir);
    expect(result.deposits).toEqual([]);
    expect(result.corrupt[0]?.reason).toContain('filename does not match its stored diffSha');
  });
});

describe('findLegDepositForHead — ancestor-or-equal resolution', () => {
  it('resolves nothing (but still discloses) when the store is empty', () => {
    const resolution = findLegDepositForHead(tmpDir, HEAD, fakeGit({ commits: [] }));
    expect(resolution.winner).toBeUndefined();
    expect(resolution).toMatchObject({ superseded: [], stale: [], corrupt: [] });
  });

  it('EXACT outranks ancestor', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: HEAD, readAt: '2026-09-01T00:00:00.000Z' }));
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDER, readAt: '2026-09-03T00:00:00.000Z' }));
    const resolution = findLegDepositForHead(
      tmpDir,
      HEAD,
      fakeGit({ commits: [OLDER], ancestors: { [OLDER]: 1 } }),
    );
    expect(resolution.winner?.diffSha).toBe(HEAD);
    expect(resolution.winner?.rank).toBe('exact');
    expect(resolution.winner?.distance).toBe(0);
    expect(resolution.superseded).toEqual([
      { diffSha: OLDER, readAt: '2026-09-03T00:00:00.000Z', rank: 'ancestor', distance: 1 },
    ]);
  });

  it('the NEAREST ancestor outranks a farther one', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDER, readAt: '2026-09-01T00:00:00.000Z' }));
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDEST, readAt: '2026-09-03T00:00:00.000Z' }));
    const resolution = findLegDepositForHead(
      tmpDir,
      HEAD,
      fakeGit({ commits: [OLDER, OLDEST], ancestors: { [OLDER]: 2, [OLDEST]: 9 } }),
    );
    expect(resolution.winner?.diffSha).toBe(OLDER);
    expect(resolution.winner?.rank).toBe('ancestor');
    expect(resolution.winner?.distance).toBe(2);
    expect(resolution.superseded.map((s) => s.diffSha)).toEqual([OLDEST]);
  });

  it('equal distance resolves to the LATEST readAt', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDER, readAt: '2026-09-01T00:00:00.000Z' }));
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDEST, readAt: '2026-09-02T00:00:00.000Z' }));
    const resolution = findLegDepositForHead(
      tmpDir,
      HEAD,
      fakeGit({ commits: [OLDER, OLDEST], ancestors: { [OLDER]: 3, [OLDEST]: 3 } }),
    );
    expect(resolution.winner?.diffSha).toBe(OLDEST);
    expect(resolution.superseded.map((s) => s.diffSha)).toEqual([OLDER]);
  });

  it('distinguishes unknown-commit from not-ancestor', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: ELSEWHERE }));
    saveLegDeposit(tmpDir, deposit({ diffSha: OLDER }));
    const resolution = findLegDepositForHead(
      tmpDir,
      HEAD,
      // OLDER is a commit here but on another branch; ELSEWHERE is unknown.
      fakeGit({ commits: [OLDER], ancestors: {} }),
    );
    expect(resolution.winner).toBeUndefined();
    expect(
      resolution.stale
        .map((s) => ({ diffSha: s.diffSha, reason: s.reason }))
        .sort((a, b) => a.diffSha.localeCompare(b.diffSha)),
    ).toEqual(
      [
        { diffSha: OLDER, reason: 'not-ancestor' },
        { diffSha: ELSEWHERE, reason: 'unknown-commit' },
      ].sort((a, b) => a.diffSha.localeCompare(b.diffSha)),
    );
  });

  it('an EXACT match never consults the git seam', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: HEAD }));
    const explodes: LegGitAdapter = {
      isCommit: () => {
        throw new Error('isCommit must not be called for an exact match');
      },
      isAncestor: () => {
        throw new Error('isAncestor must not be called for an exact match');
      },
      distance: () => {
        throw new Error('distance must not be called for an exact match');
      },
    };
    expect(findLegDepositForHead(tmpDir, HEAD, explodes).winner?.rank).toBe('exact');
  });

  it('a corrupt file rides the resolution and never masks the valid winner', () => {
    saveLegDeposit(tmpDir, deposit({ diffSha: HEAD }));
    writeRaw(`${OLDER}.json`, 'garbage');
    const resolution = findLegDepositForHead(tmpDir, HEAD, fakeGit({ commits: [] }));
    expect(resolution.winner?.diffSha).toBe(HEAD);
    expect(resolution.corrupt.map((c) => c.file)).toEqual([`${OLDER}.json`]);
  });
});

describe('countLegFindings + renderLegField — the covariate v1.2 field', () => {
  it('counts every severity, and folded findings stay counted in their bucket', () => {
    const counts = countLegFindings(
      deposit({
        findings: [
          finding({ id: 'F1', severity: 'BLOCKING' }),
          finding({ id: 'F2', severity: 'BLOCKING' }),
          finding({ id: 'F3', severity: 'MATERIAL' }),
          finding({ id: 'F4', severity: 'MINOR' }),
        ],
        folded: ['F1', 'F3'],
      }),
    );
    expect(counts).toEqual({ blocking: 2, material: 1, minor: 1, folded: 2 });
  });

  it('renders EXACTLY `leg: <sha8> blocking=N material=N folded=N`', () => {
    const rendered = renderLegField(
      deposit({
        diffSha: HEAD,
        findings: [
          finding({ id: 'F1', severity: 'BLOCKING' }),
          finding({ id: 'F2', severity: 'MATERIAL' }),
          finding({ id: 'F3', severity: 'MINOR' }),
        ],
        folded: ['F2'],
      }),
    );
    expect(rendered).toBe(`leg: ${HEAD.slice(0, 8)} blocking=1 material=1 folded=1`);
  });

  it('renders EXACTLY `leg: none` for no deposit', () => {
    expect(renderLegField(undefined)).toBe('leg: none');
  });

  it('renders zeroes for a leg that found nothing', () => {
    expect(renderLegField(deposit({ findings: [], folded: [] }))).toBe(
      `leg: ${HEAD.slice(0, 8)} blocking=0 material=0 folded=0`,
    );
  });
});

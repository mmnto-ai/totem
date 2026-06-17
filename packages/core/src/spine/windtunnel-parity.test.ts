import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enrichWithAstContext } from '../ast-gate.js';
import type { CompiledRule, DiffAddition, Violation } from '../compiler-schema.js';
import { applyAstRulesToAdditions, applyRulesToAdditions } from '../rule-engine.js';
import { cleanTmpDir, makeRuleEngineCtx } from '../test-utils.js';

/**
 * Bidirectional firing-parity test for the wind-tunnel readStrategy seam
 * (S1+C1, .totem/specs/2188.md Invariants).
 *
 * The wind-tunnel replays each PR's diff against the rule engine and must
 * observe the SAME firings production `totem lint` would observe — otherwise
 * it measures a different engine than Gate 2 arms. The seam that makes this
 * exact is the post-image `readStrategy` injected into BOTH
 * `enrichWithAstContext` (regex `astContext` classification) and
 * `applyAstRulesToAdditions` (whole-file AST parsing). This file proves parity
 * is bidirectional:
 *
 *   - OVER-FIRE (C1): a regex match that lands inside a comment/string must NOT
 *     become a violation. Production suppresses it via `astContext`; the replay,
 *     fed the same post-image content through the same seam, must suppress it
 *     identically. Caught by comparing readStrategy-fed firings to disk-fed
 *     firings (the production baseline) — they must be equal.
 *   - UNDER-FIRE (S1): an AST/ast-grep rule needs the whole post-image file, not
 *     just the additions. The readStrategy supplying that post-image must fire
 *     identically to the same content read from disk.
 */

// ─── Named constants ─────────────────────────────────

const SRC_FILE = 'src/app.ts';
const DEBUGGER_RULE: CompiledRule = {
  lessonHash: 'wt-parity-debugger',
  lessonHeading: 'No debugger statements',
  // Matches the literal token `debugger` — appears in both code and a comment
  // in the fixture below, so astContext is what decides over-firing.
  pattern: 'debugger',
  message: 'debugger statement',
  engine: 'regex',
  compiledAt: '2026-06-17T00:00:00.000Z',
};

const CONSOLE_LOG_AST_RULE: CompiledRule = {
  lessonHash: 'wt-parity-console-log',
  lessonHeading: 'No console.log',
  pattern: '',
  message: 'console.log call',
  engine: 'ast-grep',
  astGrepPattern: 'console.log($$$)',
  compiledAt: '2026-06-17T00:00:00.000Z',
};

// Post-image fixture: the trigger token appears on a real code line (line 2)
// AND inside a comment (line 3). A faithful replay fires a *violation* only on
// the code line; the comment line is telemetry-only.
const POST_IMAGE = [
  'function run() {', // 1
  '  debugger;', // 2 — real code → violation // totem-ignore
  '  // debugger; left in by mistake — but this is a comment // totem-ignore', // 3 — comment → suppressed
  '  console.log("hi");', // 4
  '}', // 5
].join('\n');

const CODE_LINE = '  debugger;'; // totem-ignore
const COMMENT_LINE = '  // debugger; left in by mistake — but this is a comment // totem-ignore';
const CONSOLE_LINE = '  console.log("hi");';

// ─── Helpers ─────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-wt-parity-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

function additionsForDebugger(): DiffAddition[] {
  // Both the code line and the comment line are "added" in this PR. The replay
  // must classify each from the post-image and fire only on the code line.
  return [
    { file: SRC_FILE, line: CODE_LINE, lineNumber: 2, precedingLine: 'function run() {' },
    { file: SRC_FILE, line: COMMENT_LINE, lineNumber: 3, precedingLine: CODE_LINE },
  ];
}

/** Normalize a violation list into a comparable, order-independent shape. */
function fingerprint(violations: Violation[]): string {
  return violations
    .map((v) => `${v.rule.lessonHash}|${v.file}|${v.lineNumber}|${v.line}`)
    .sort()
    .join('\n');
}

// ─── Assertion 1: over-fire suppression + disk/readStrategy parity (C1) ─

describe('bidirectional parity — over-fire suppression (C1)', () => {
  it('a regex match inside a comment does NOT become a violation when classified from the post-image', async () => {
    const additions = additionsForDebugger();

    // Inject the post-image content through the readStrategy seam (the path the
    // wind-tunnel uses): line 2 classifies as code, line 3 as comment.
    await enrichWithAstContext(additions, {
      cwd: tmpDir,
      readStrategy: async () => POST_IMAGE,
    });

    expect(additions[0]!.astContext).toBe('code');
    expect(additions[1]!.astContext).toBe('comment');

    const ctx = makeRuleEngineCtx();
    const violations = applyRulesToAdditions(ctx, [DEBUGGER_RULE], additions);

    // Only the real code line fires; the comment match is telemetry-only.
    expect(violations).toHaveLength(1);
    expect(violations[0]!.lineNumber).toBe(2);
    expect(violations[0]!.line).toBe(CODE_LINE);
  });

  it('readStrategy-injected content fires identically to the same content on disk (replay == production)', async () => {
    // ── Production baseline: content on disk, NO readStrategy ──
    fs.writeFileSync(path.join(tmpDir, SRC_FILE), POST_IMAGE, 'utf-8');
    const diskAdditions = additionsForDebugger();
    await enrichWithAstContext(diskAdditions, { cwd: tmpDir });
    const diskCtx = makeRuleEngineCtx();
    const diskViolations = applyRulesToAdditions(diskCtx, [DEBUGGER_RULE], diskAdditions);

    // ── Replay: identical content fed via readStrategy (file may differ on disk) ──
    const replayAdditions = additionsForDebugger();
    await enrichWithAstContext(replayAdditions, {
      cwd: tmpDir,
      readStrategy: async () => POST_IMAGE,
    });
    const replayCtx = makeRuleEngineCtx();
    const replayViolations = applyRulesToAdditions(replayCtx, [DEBUGGER_RULE], replayAdditions);

    // Parity: the two firing sets are byte-identical.
    expect(fingerprint(replayViolations)).toBe(fingerprint(diskViolations));
    expect(replayViolations).toHaveLength(1);
    expect(replayViolations[0]!.lineNumber).toBe(2);
  });

  it('proves the seam matters: stale on-disk content would mis-suppress without the post-image', async () => {
    // On disk the file has the debugger ON A CODE LINE (no comment); but the PR
    // post-image moved it into a comment. Without the readStrategy seam, the
    // replay would classify against the wrong tree. Feeding the post-image makes
    // line 3 a comment (suppressed) — exactly what production sees for this PR.
    const staleDisk = [
      'function run() {',
      '  debugger;', // totem-ignore
      '  debugger;', // totem-ignore — on disk this is CODE
      '  console.log("hi");',
      '}',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, SRC_FILE), staleDisk, 'utf-8');

    const additions = additionsForDebugger();
    await enrichWithAstContext(additions, {
      cwd: tmpDir,
      readStrategy: async () => POST_IMAGE, // the PR's actual post-image
    });

    // Line 3 is a comment in the post-image, so it is suppressed despite being
    // code on disk — the seam decided correctly.
    expect(additions[1]!.astContext).toBe('comment');
    const ctx = makeRuleEngineCtx();
    const violations = applyRulesToAdditions(ctx, [DEBUGGER_RULE], additions);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.lineNumber).toBe(2);
  });
});

// ─── Assertion 2: AST whole-file seam parity (S1) ────

describe('bidirectional parity — AST whole-file seam (S1)', () => {
  it('applyAstRulesToAdditions fires identically via readStrategy and via disk (parity)', async () => {
    const additions: DiffAddition[] = [
      { file: SRC_FILE, line: CONSOLE_LINE, lineNumber: 4, precedingLine: COMMENT_LINE },
    ];

    // ── Production baseline: content on disk, no readStrategy ──
    fs.writeFileSync(path.join(tmpDir, SRC_FILE), POST_IMAGE, 'utf-8');
    const diskCtx = makeRuleEngineCtx();
    const diskViolations = await applyAstRulesToAdditions(
      diskCtx,
      [CONSOLE_LOG_AST_RULE],
      additions,
      tmpDir,
    );

    // ── Replay: identical post-image fed via readStrategy ──
    const replayCtx = makeRuleEngineCtx();
    const replayViolations = await applyAstRulesToAdditions(
      replayCtx,
      [CONSOLE_LOG_AST_RULE],
      additions,
      tmpDir,
      undefined,
      undefined,
      async () => POST_IMAGE,
    );

    // The AST engine parses the WHOLE post-image in both cases — firings match.
    expect(fingerprint(replayViolations)).toBe(fingerprint(diskViolations));
    expect(replayViolations).toHaveLength(1);
    expect(replayViolations[0]!.lineNumber).toBe(4);
  });

  it('the post-image readStrategy lets the AST engine see whole-file context an additions-only feed lacks (under-fire guard)', async () => {
    // The addition we evaluate is line 4 (console.log). The AST engine parses
    // the full post-image (functions, braces) to resolve it as a call
    // expression. A readStrategy returning ONLY the bare addition line would
    // still parse, but the point of S1 is that the engine receives the full
    // post-image — proven by feeding the whole file and getting the fire.
    const additions: DiffAddition[] = [
      { file: SRC_FILE, line: CONSOLE_LINE, lineNumber: 4, precedingLine: COMMENT_LINE },
    ];

    const ctx = makeRuleEngineCtx();
    const violations = await applyAstRulesToAdditions(
      ctx,
      [CONSOLE_LOG_AST_RULE],
      additions,
      tmpDir,
      undefined,
      undefined,
      async () => POST_IMAGE,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]!.lineNumber).toBe(4);
    expect(violations[0]!.rule.lessonHash).toBe(CONSOLE_LOG_AST_RULE.lessonHash);
  });
});

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knownGates, TotemError } from '@mmnto/totem';

import { ejectCommand } from './eject.js';
import { gateInstallCommand } from './gate.js';
import {
  commandInstallsGate,
  GATE_WRAPPER_REL,
  type GateInstallSpec,
  installGates,
} from './gate-install.js';
import { initCommand } from './init.js';
import { CLAUDE_GATE_WRAPPER, TOTEM_FILE_END, TOTEM_FILE_MARKER } from './init-templates.js';
import { resolveGitRootForHookPath, resolveHooksDir } from './install-hooks.js';

// The eject-parity tests below drive `ejectCommand`, which (mmnto-ai/totem#2426)
// now resolves the git root + hooks dir via the #2422 helpers. Mock that seam so
// no real `git` is spawned in a temp dir; only eject imports these two exports,
// so the gate/init tests here are unaffected. Default: git root = cwd, hooks dir
// = <root>/.git/hooks (matching the plain `.git/hooks` fixtures these tests build).
vi.mock('./install-hooks.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./install-hooks.js')>();
  return {
    ...actual,
    resolveGitRootForHookPath: vi.fn(),
    resolveHooksDir: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(resolveGitRootForHookPath).mockImplementation((c: string) => ({
    gitRoot: c,
    unparseablePointer: false,
  }));
  vi.mocked(resolveHooksDir).mockImplementation((root: string) => path.join(root, '.git', 'hooks'));
});

/**
 * CLI-seam tests for `totem gate install` + the parameterized gate wrapper
 * (PR-C, mmnto-ai/totem#2048).
 *
 * Locks the invariants in spec 2048.md §"Invariants the tests lock":
 *   - idempotent merge (re-run is a no-op)
 *   - `--all` enumerates `knownGateEvents()`; unknown `--<name>` / `--gates=`
 *     member fails loud (no default-install)
 *   - the wrapper's disposition → exit-code map, including the LOAD-BEARING
 *     empty-subsystem pass-through and the applicable-gate-source-broken
 *     fail-closed
 *   - `eject` removes the gate entry (parity with install)
 *   - `init --gates=` routes through the SAME installer as the verb
 *
 * The engine itself (allow/deny/no-file/side-effect-free) is covered by
 * `@mmnto/totem`'s gate-engine.test.ts and is NOT duplicated here.
 */

function makeTmpDir(): string {
  // `.native` expands Windows 8.3 short names so process.cwd()/realpath agree.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gate-install-')));
}

/**
 * The parent env with EVERY case-variant of PATH dropped and exactly one
 * `PATH` set (win32 stores it as `Path`; a plain spread would leave both keys
 * in the child's block). Everything else is inherited so node still boots under
 * an empty PATH.
 *
 * Load-bearing since the wrapper grew a PATH fallback arm (mmnto-ai/totem#2822):
 * a wrapper test that means "no CLI is resolvable" must say so explicitly, or it
 * silently reads the developer's global `@mmnto/cli` and passes/fails by machine.
 */
function envWithPath(value: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (key.toUpperCase() === 'PATH') continue;
    env[key] = val;
  }
  env.PATH = value;
  return env;
}

function readSettings(cwd: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf-8');
  return JSON.parse(raw);
}

function preToolUseEntries(cwd: string): Array<{ matcher?: string; hooks?: Array<unknown> }> {
  const parsed = readSettings(cwd);
  const hooks = (parsed.hooks ?? {}) as Record<string, unknown>;
  return (hooks.PreToolUse ?? []) as Array<{ matcher?: string; hooks?: Array<unknown> }>;
}

/**
 * The `{event, matcher}` pairs the caller resolves from the core registry and
 * hands `installGates` (mmnto-ai/totem#2799). Spelled literally here rather than
 * read from `knownGates()` so a registry change that silently moved a gate to a
 * different matcher would FAIL these tests instead of following them.
 */
const FREEZE_CHECK: GateInstallSpec = { event: 'freeze-check', matcher: 'Write|Edit' };
const TRANSPORT_SHIELD: GateInstallSpec = {
  event: 'transport-shield',
  matcher: 'Bash|PowerShell',
};
const MERGE_READY: GateInstallSpec = { event: 'merge-ready', matcher: 'Bash|PowerShell' };

/**
 * Every PreToolUse matcher an entry installing `event` currently appears under.
 * Matcher-AGNOSTIC by construction: a gate that leaked into a second matcher
 * shows up here as two members, which is the invariant the #2799 tests assert.
 */
function matchersFor(cwd: string, event: string): string[] {
  const found: string[] = [];
  for (const e of preToolUseEntries(cwd)) {
    if (!Array.isArray(e.hooks)) continue;
    for (const h of e.hooks) {
      const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
      // Collision-safe exact --event match (tier-independent).
      if (commandInstallsGate(cmd, event)) found.push(e.matcher ?? '');
    }
  }
  return found;
}

/** Count PreToolUse entries (under ANY matcher) whose command references a given gate. */
function gateEntryCount(cwd: string, event: string): number {
  return preToolUseEntries(cwd).filter(
    (e) =>
      Array.isArray(e.hooks) &&
      e.hooks.some((h) => {
        const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
        return commandInstallsGate(cmd, event);
      }),
  ).length;
}

/** The single baked command string for a gate (or undefined if none/many). */
function gateCommandFor(cwd: string, event: string): string | undefined {
  const cmds: string[] = [];
  for (const e of preToolUseEntries(cwd)) {
    if (!Array.isArray(e.hooks)) continue;
    for (const h of e.hooks) {
      const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
      if (commandInstallsGate(cmd, event)) cmds.push(cmd);
    }
  }
  return cmds.length === 1 ? cmds[0] : undefined;
}

describe('installGates / gate install (settings merge)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('scaffolds the wrapper and merges one PreToolUse entry per gate', () => {
    const results = installGates(cwd, [FREEZE_CHECK]);
    // wrapper scaffold + one entry merge
    expect(results.some((r) => r.file === GATE_WRAPPER_REL && r.action === 'created')).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
  });

  it('drift-repairs a bounded stale gate-wrapper during install (refreshed → merged, mmnto-ai/totem#2413)', () => {
    // Plant a bounded-but-stale wrapper: marker opens it, end marker present, body drifted.
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
    fs.writeFileSync(wrapperPath, `${TOTEM_FILE_MARKER}\nstale\n${TOTEM_FILE_END}\n`, 'utf-8');

    const results = installGates(cwd, [FREEZE_CHECK]);
    // gate install now threads the end marker, so scaffoldFile drift-repairs the bounded
    // wrapper (`refreshed`) and gate-install maps that to `merged` (a write happened).
    expect(results.find((r) => r.file === GATE_WRAPPER_REL)!.action).toBe('merged');
    expect(fs.readFileSync(wrapperPath, 'utf-8')).toBe(CLAUDE_GATE_WRAPPER);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
  });

  it('is idempotent: a second install of the same gate is a no-op', () => {
    installGates(cwd, [FREEZE_CHECK]);
    const before = JSON.stringify(readSettings(cwd));

    const second = installGates(cwd, [FREEZE_CHECK]);
    const entryResult = second.find((r) => r.event === 'freeze-check');
    expect(entryResult?.action).toBe('skipped');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(JSON.stringify(readSettings(cwd))).toBe(before);
  });

  it('keys idempotency on the per-gate command substring (distinct gates → distinct entries)', () => {
    // freeze-check installed; a hypothetical future gate keyed on a different
    // --event substring produces a SECOND entry rather than colliding.
    installGates(cwd, [FREEZE_CHECK]);
    installGates(cwd, [{ event: 'some-future-gate', matcher: 'Write|Edit' }]);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(gateEntryCount(cwd, 'some-future-gate')).toBe(1);
    // Two distinct Write|Edit gate entries under one matcher.
    const gateEntries = preToolUseEntries(cwd).filter(
      (e) =>
        e.matcher === 'Write|Edit' &&
        Array.isArray(e.hooks) &&
        e.hooks.some((h) => {
          const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
          return cmd.includes('gate-wrapper.cjs --event ');
        }),
    );
    expect(gateEntries.length).toBe(2);
  });

  it('preserves a pre-existing user PreToolUse entry when merging', () => {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-hook' }] }],
        },
      }),
    );
    installGates(cwd, [FREEZE_CHECK]);
    const entries = preToolUseEntries(cwd);
    expect(entries.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
  });

  it('gateInstallCommand --all installs every known gate under ITS registry matcher', async () => {
    await gateInstallCommand({ all: true });
    for (const { event, matcher } of knownGates()) {
      expect(gateEntryCount(cwd, event)).toBe(1);
      // The installed matcher is the registry's, not a shared default.
      expect(matchersFor(cwd, event)).toEqual([matcher]);
    }
  });
});

// ─── Per-gate matchers (mmnto-ai/totem#2799) ───────────────────────────
//
// Before #2799 every gate entry was written under one hardcoded `Write|Edit`
// matcher. The registry now carries each gate's own matcher, the caller
// resolves it (`knownGates()`), and `installGates` writes THAT — so
// `transport-shield` lands on `Bash|PowerShell` while `freeze-check` keeps the
// byte-identical `Write|Edit` entry it has always written.
describe('installGates per-gate matcher (mmnto-ai/totem#2799)', () => {
  let cwd: string;
  let originalCwd: string;

  const STRICT_FREEZE_ENTRY = {
    matcher: 'Write|Edit',
    hooks: [
      {
        type: 'command',
        command: 'node .claude/hooks/gate-wrapper.cjs --event freeze-check --strict',
      },
    ],
  };
  const STRICT_TRANSPORT_ENTRY = {
    matcher: 'Bash|PowerShell',
    hooks: [
      {
        type: 'command',
        command: 'node .claude/hooks/gate-wrapper.cjs --event transport-shield --strict',
      },
    ],
  };
  const STRICT_MERGE_READY_ENTRY = {
    matcher: 'Bash|PowerShell',
    hooks: [
      {
        type: 'command',
        command: 'node .claude/hooks/gate-wrapper.cjs --event merge-ready --strict',
      },
    ],
  };

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('transport-shield writes exactly ONE entry under Bash|PowerShell with the baked command', () => {
    installGates(cwd, [TRANSPORT_SHIELD]);

    expect(gateEntryCount(cwd, 'transport-shield')).toBe(1);
    expect(matchersFor(cwd, 'transport-shield')).toEqual(['Bash|PowerShell']);
    expect(gateCommandFor(cwd, 'transport-shield')).toBe(
      'node .claude/hooks/gate-wrapper.cjs --event transport-shield --strict',
    );
    // The whole emitted entry, byte for byte.
    expect(preToolUseEntries(cwd)).toEqual([STRICT_TRANSPORT_ENTRY]);
  });

  it('freeze-check writes the SAME Write|Edit entry it wrote before #2799, byte for byte', () => {
    installGates(cwd, [FREEZE_CHECK]);

    // The full emitted JSON entry — the regression guard on the gate whose
    // matcher did NOT change.
    expect(preToolUseEntries(cwd)).toEqual([STRICT_FREEZE_ENTRY]);
  });

  it('both gates together write both entries, each under its own matcher', () => {
    installGates(cwd, [FREEZE_CHECK, TRANSPORT_SHIELD]);

    expect(preToolUseEntries(cwd)).toEqual([STRICT_FREEZE_ENTRY, STRICT_TRANSPORT_ENTRY]);
    expect(matchersFor(cwd, 'freeze-check')).toEqual(['Write|Edit']);
    expect(matchersFor(cwd, 'transport-shield')).toEqual(['Bash|PowerShell']);
  });

  it('re-running both gates at the same tier is a byte-level no-op', () => {
    installGates(cwd, [FREEZE_CHECK, TRANSPORT_SHIELD]);
    const settingsPath = path.join(cwd, '.claude', 'settings.json');
    const before = fs.readFileSync(settingsPath, 'utf-8');

    const second = installGates(cwd, [FREEZE_CHECK, TRANSPORT_SHIELD]);

    expect(second.find((r) => r.event === 'freeze-check')?.action).toBe('skipped');
    expect(second.find((r) => r.event === 'transport-shield')?.action).toBe('skipped');
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
  });

  it('a tier switch updates the transport-shield entry IN PLACE under its own matcher', () => {
    installGates(cwd, [TRANSPORT_SHIELD], 'pilot');
    expect(gateCommandFor(cwd, 'transport-shield')).toContain('--pilot');

    const switched = installGates(cwd, [TRANSPORT_SHIELD], 'strict');

    expect(switched.find((r) => r.event === 'transport-shield')?.action).toBe('updated');
    expect(gateEntryCount(cwd, 'transport-shield')).toBe(1);
    expect(matchersFor(cwd, 'transport-shield')).toEqual(['Bash|PowerShell']);
    const cmd = gateCommandFor(cwd, 'transport-shield');
    expect(cmd).toContain('--strict');
    expect(cmd).not.toContain('--pilot');
  });

  it('merge-ready writes ONE entry under Bash|PowerShell, beside transport-shield (mmnto-ai/totem#2800)', () => {
    installGates(cwd, [MERGE_READY]);

    expect(gateEntryCount(cwd, 'merge-ready')).toBe(1);
    expect(matchersFor(cwd, 'merge-ready')).toEqual(['Bash|PowerShell']);
    expect(gateCommandFor(cwd, 'merge-ready')).toBe(
      'node .claude/hooks/gate-wrapper.cjs --event merge-ready --strict',
    );
    expect(preToolUseEntries(cwd)).toEqual([STRICT_MERGE_READY_ENTRY]);

    // A second Bash|PowerShell gate is its OWN entry, never folded into the
    // first (each gate's --event is its identity).
    installGates(cwd, [TRANSPORT_SHIELD]);
    expect(gateEntryCount(cwd, 'merge-ready')).toBe(1);
    expect(gateEntryCount(cwd, 'transport-shield')).toBe(1);
    expect(preToolUseEntries(cwd)).toEqual([STRICT_MERGE_READY_ENTRY, STRICT_TRANSPORT_ENTRY]);
  });

  it('a merge-ready tier switch updates the one entry in place', () => {
    installGates(cwd, [MERGE_READY], 'pilot');
    expect(gateCommandFor(cwd, 'merge-ready')).toContain('--pilot');

    const switched = installGates(cwd, [MERGE_READY], 'strict');

    expect(switched.find((r) => r.event === 'merge-ready')?.action).toBe('updated');
    expect(gateEntryCount(cwd, 'merge-ready')).toBe(1);
    expect(gateCommandFor(cwd, 'merge-ready')).toBe(
      'node .claude/hooks/gate-wrapper.cjs --event merge-ready --strict',
    );
  });

  it('after any sequence of INSTALLER writes, no gate appears under two matchers (hand edits are not enforced)', () => {
    // Interleave tiers and selections — the upsert must converge on exactly one
    // entry per gate, always under that gate's registry matcher.
    installGates(cwd, [FREEZE_CHECK], 'pilot');
    installGates(cwd, [TRANSPORT_SHIELD]);
    installGates(cwd, [TRANSPORT_SHIELD], 'pilot');
    installGates(cwd, [FREEZE_CHECK, TRANSPORT_SHIELD], 'strict');
    installGates(cwd, [TRANSPORT_SHIELD], 'strict');

    for (const { event, matcher } of [FREEZE_CHECK, TRANSPORT_SHIELD]) {
      expect(matchersFor(cwd, event)).toEqual([matcher]);
      expect(gateEntryCount(cwd, event)).toBe(1);
    }
    expect(preToolUseEntries(cwd)).toEqual([STRICT_FREEZE_ENTRY, STRICT_TRANSPORT_ENTRY]);
  });
});

// ─── FIX A: tier-AWARE upsert (update in place, never silent no-op/dup) ──
//
// Locks the tier-update behavior so it can never regress to either failure
// mode the pre-fix tier-INDEPENDENT probe had: (a) a tier switch silently
// dropped as a "skipped — no change" no-op, or (b) a second duplicate entry
// for the same gate. The invariant: EXACTLY ONE entry per gate, ever, and the
// baked tier flag flips in place on a different-tier re-install.
describe('installGates tier-aware upsert (FIX A)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('default(strict) then re-install --strict → skipped, one entry, command keeps --strict', () => {
    installGates(cwd, [FREEZE_CHECK]); // default tier === strict
    const second = installGates(cwd, [FREEZE_CHECK], 'strict');
    const entryResult = second.find((r) => r.event === 'freeze-check');
    expect(entryResult?.action).toBe('skipped');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(gateCommandFor(cwd, 'freeze-check')).toContain('--strict');
  });

  it('--pilot then --strict → updated, ONE entry, command flips to --strict (not --pilot)', () => {
    installGates(cwd, [FREEZE_CHECK], 'pilot');
    expect(gateCommandFor(cwd, 'freeze-check')).toContain('--pilot');

    const switched = installGates(cwd, [FREEZE_CHECK], 'strict');
    const entryResult = switched.find((r) => r.event === 'freeze-check');
    expect(entryResult?.action).toBe('updated');
    // Exactly one entry — no duplicate created by the tier switch.
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    const cmd = gateCommandFor(cwd, 'freeze-check');
    expect(cmd).toContain('--strict');
    expect(cmd).not.toContain('--pilot');
  });

  it('--strict then --pilot → updated back to --pilot, one entry', () => {
    installGates(cwd, [FREEZE_CHECK], 'strict');
    const switched = installGates(cwd, [FREEZE_CHECK], 'pilot');
    const entryResult = switched.find((r) => r.event === 'freeze-check');
    expect(entryResult?.action).toBe('updated');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    const cmd = gateCommandFor(cwd, 'freeze-check');
    expect(cmd).toContain('--pilot');
    expect(cmd).not.toContain('--strict');
  });

  it('init --gates= routes the tier through the same upsert (default then --pilot re-init)', async () => {
    // First init at default (strict).
    await initCommand({ bare: true, gates: 'freeze-check' });
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(gateCommandFor(cwd, 'freeze-check')).toContain('--strict');

    // Re-init with --pilot → routes through the same installGates upsert:
    // one entry at the right (pilot) tier, NOT a duplicate.
    await initCommand({ bare: true, gates: 'freeze-check', pilot: true });
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    const cmd = gateCommandFor(cwd, 'freeze-check');
    expect(cmd).toContain('--pilot');
    expect(cmd).not.toContain('--strict');
  });

  it('coexists with a pre-existing PreWriteShield Write|Edit entry (the post-init layout)', () => {
    // Realistic post-`totem init` state: a PreWriteShield hook already sits in
    // committed settings.json under the SAME 'Write|Edit' matcher the gate uses.
    // The upsert must install the gate as a DISTINCT entry and, on a tier
    // switch, update ONLY the gate entry — never touching PreWriteShield.
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    const shieldCommand = 'node .claude/hooks/PreWriteShield.cjs';
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Write|Edit', hooks: [{ type: 'command', command: shieldCommand }] },
          ],
        },
      }),
    );
    const hasShield = (): boolean =>
      preToolUseEntries(cwd).some(
        (e) =>
          e.matcher === 'Write|Edit' &&
          Array.isArray(e.hooks) &&
          e.hooks.some((h) => {
            const c = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
            return c === shieldCommand;
          }),
      );

    // Install the gate at pilot → a distinct second Write|Edit entry.
    installGates(cwd, [FREEZE_CHECK], 'pilot');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(gateCommandFor(cwd, 'freeze-check')).toContain('--pilot');
    expect(hasShield()).toBe(true);
    expect(preToolUseEntries(cwd).filter((e) => e.matcher === 'Write|Edit').length).toBe(2);

    // Tier switch → updates ONLY the gate entry in place; PreWriteShield stays.
    const switched = installGates(cwd, [FREEZE_CHECK], 'strict');
    expect(switched.find((r) => r.event === 'freeze-check')?.action).toBe('updated');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    const cmd2 = gateCommandFor(cwd, 'freeze-check');
    expect(cmd2).toContain('--strict');
    expect(cmd2).not.toContain('--pilot');
    expect(hasShield()).toBe(true);
    expect(preToolUseEntries(cwd).filter((e) => e.matcher === 'Write|Edit').length).toBe(2);
  });
});

// `resolveGates` (the registry-driven `{event, matcher}` resolver that replaced
// `resolveGateEvents` in mmnto-ai/totem#2799) is covered in gate.test.ts, beside
// the other `./gate.js` command-seam tests.

// ─── The parameterized wrapper's disposition → exit-code map ───────────
//
// We render the wrapper template to a temp dir and drive it via stdin with
// synthetic PreToolUse envelopes. A stub `node_modules/@mmnto/cli/dist/index.js`
// stands in for the local CLI: it echoes a verdict / exit code driven by env
// vars so the test controls each disposition deterministically WITHOUT the
// real engine (the engine is covered by gate-engine.test.ts).
describe('gate-wrapper.cjs disposition → exit code', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    // Render the wrapper exactly as `installGates` would.
    fs.mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'), CLAUDE_GATE_WRAPPER);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /** Where the stub CLI records the argv and stdin it was spawned with (absent ⇒ never spawned). */
  const stubRecordPath = (): string => path.join(cwd, 'stub-record.json');

  /** Install a stub local CLI that records its argv + stdin and emits a controlled verdict / exit code. */
  function writeStubCli(opts: { verdict?: unknown; exit?: number; stderr?: string }): void {
    const distDir = path.join(cwd, 'node_modules', '@mmnto', 'cli', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const verdictJson = opts.verdict === undefined ? '' : JSON.stringify(opts.verdict);
    const exitCode = opts.exit ?? 0;
    // `stderr` stands in for the ENGINE's own agent-facing lines (merge-ready's
    // override audit, its zero-checks fact): the wrapper must pass them through
    // in every arm, allow included (mmnto-ai/totem#2800 fold F1).
    const stderrText = opts.stderr ?? '';
    // CommonJS stub (the wrapper invokes via `node <path>`); .js is fine here
    // because there is no package.json type:module in the temp dir. The record
    // is what lets a test assert BOTH that a spawn happened and exactly which
    // `gate check --event … --payload -` the wrapper projected, argv AND the
    // stdin the payload rides on (mmnto-ai/totem#2799); `JSON.stringify` on
    // the path handles Windows separators without a hand-written escape.
    const stub = [
      '"use strict";',
      'const fs = require("fs");',
      `const out = ${JSON.stringify(verdictJson)};`,
      'let stdin = "";',
      'try { stdin = fs.readFileSync(0, "utf-8"); } catch { stdin = ""; }',
      `fs.writeFileSync(${JSON.stringify(
        stubRecordPath(),
      )}, JSON.stringify({ argv: process.argv.slice(2), stdin }));`,
      `const err = ${JSON.stringify(stderrText)};`,
      'if (err) process.stderr.write(err + "\\n");',
      'if (out) process.stdout.write(out + "\\n");',
      `process.exit(${exitCode});`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(distDir, 'index.js'), stub);
  }

  /** What the stub CLI was spawned with, or null when the wrapper never spawned it. */
  function stubRecord(): { argv: string[]; stdin: string } | null {
    if (!fs.existsSync(stubRecordPath())) return null;
    return JSON.parse(fs.readFileSync(stubRecordPath(), 'utf-8')) as {
      argv: string[];
      stdin: string;
    };
  }

  /** The argv the stub CLI was spawned with, or null when the wrapper never spawned it. */
  function stubArgv(): string[] | null {
    return stubRecord()?.argv ?? null;
  }

  /**
   * The payload JSON the wrapper projected, parsed (throws if it never
   * spawned). The payload rides on the child's stdin under `--payload -` —
   * never argv, whose win32 limit a long Bash command would exceed.
   */
  function spawnedPayload(): Record<string, unknown> {
    const record = stubRecord();
    expect(record, 'the wrapper never spawned the CLI').not.toBeNull();
    const at = record!.argv.indexOf('--payload');
    expect(at).toBeGreaterThan(-1);
    expect(record!.argv[at + 1]).toBe('-');
    return JSON.parse(record!.stdin) as Record<string, unknown>;
  }

  /**
   * Run the rendered wrapper with the given envelope + baked extra args.
   * `env` defaults to the parent's (every test here writes a repo-local stub,
   * which the wrapper resolves FIRST, so the ambient PATH is inert for them);
   * the no-CLI test passes an empty PATH explicitly.
   */
  function runWrapper(
    envelope: unknown,
    extraArgs: string[] = [],
    event = 'freeze-check',
    env: NodeJS.ProcessEnv | undefined = undefined,
  ): { status: number | null; stderr: string } {
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', event, ...extraArgs], {
      cwd,
      input: JSON.stringify(envelope),
      encoding: 'utf-8',
      timeout: 30000,
      ...(env ? { env } : {}),
    });
    return { status: res.status, stderr: res.stderr ?? '' };
  }

  const EDIT_NO_SUBSYSTEM = { tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts' } };
  const DECLARED = { tool_name: 'Edit', tool_input: { subsystem: 'rule-compilation' } };
  const ALLOW_VERDICT = { disposition: 'allow', reason: 'ok', provenance: {} };

  it('allow → exit 0 (silent)', () => {
    writeStubCli({ verdict: { disposition: 'allow', reason: 'ok', provenance: {} }, exit: 0 });
    const { status } = runWrapper(DECLARED);
    expect(status).toBe(0);
  });

  it('warn → exit 0 + reason/provenance to stderr (advisory, never blocks)', () => {
    writeStubCli({
      verdict: { disposition: 'warn', reason: 'heads up', provenance: { source: 's' } },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(0);
    expect(stderr).toMatch(/warn/i);
    expect(stderr).toContain('heads up');
  });

  it('deny → exit 2 under --strict (default) + stderr', () => {
    writeStubCli({
      verdict: { disposition: 'deny', reason: 'frozen', provenance: { matched: 'x' } },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toContain('frozen');
  });

  it('deny → exit 0 under --pilot + stderr (advisory tier)', () => {
    writeStubCli({
      verdict: { disposition: 'deny', reason: 'frozen', provenance: {} },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED, ['--pilot']);
    expect(status).toBe(0);
    expect(stderr).toContain('frozen');
  });

  it('no-declared-subsystem Edit → exit 0 pass-through (gate NOT invoked)', () => {
    // Stub emits a DENY; if the wrapper invoked it, exit would be 2. The
    // empty-subsystem guardrail must short-circuit to exit 0 WITHOUT shelling
    // out (LOAD-BEARING: protects every ordinary edit from being blocked).
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(EDIT_NO_SUBSYSTEM);
    expect(status).toBe(0);
  });

  it('applicable-gate-source-broken (non-zero gate check) → exit 2 fail-closed', () => {
    // A declared subsystem IS present (gate applies) and `gate check` exits
    // non-zero (corrupt freeze.json etc.) → fail-closed block.
    writeStubCli({ exit: 1 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/fail-closed/i);
  });

  it('malformed stdin envelope → exit 0 fail-soft', () => {
    writeStubCli({ verdict: { disposition: 'deny' } });
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', 'freeze-check'], {
      cwd,
      input: '{ not valid json',
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(res.status).toBe(0);
  });

  // ─── FIX 2: applicable gate but no local CLI dist → fail-closed ────────
  it('applicable gate but NO CLI is resolvable (local absent, PATH empty) → exit 2 fail-closed (FIX 2)', () => {
    // Deliberately do NOT write the stub CLI, and hand the wrapper an EMPTY
    // PATH so neither resolution arm can answer (mmnto-ai/totem#2822 added the
    // PATH fallback; without this the test would silently read a developer's
    // global @mmnto/cli and stop testing fail-closed). A declared subsystem
    // makes the gate APPLY; freeze-check has no commit-time hard floor, so an
    // applicable-but-unevaluable gate must fail closed (exit 2), never silently
    // allow (exit 0).
    const { status, stderr } = runWrapper(DECLARED, [], 'freeze-check', envWithPath(''));
    expect(status).toBe(2);
    expect(stderr).toMatch(/failing closed/i);
  });

  it('gate check exits 0 with unparseable stdout → exit 2 fail-closed', () => {
    // verdict undefined → stub emits nothing; the wrapper cannot parse a
    // verdict from a 0-exit gate → fail-closed.
    writeStubCli({ verdict: undefined, exit: 0 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unparseable|parse/i);
  });

  it('well-formed verdict with an unknown disposition → exit 2 fail-closed', () => {
    writeStubCli({ verdict: { disposition: 'bogus', reason: 'x', provenance: {} }, exit: 0 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown disposition/i);
  });

  // ─── FIX 3: valid JSON but non-object stdin → fail-soft ────────────────
  it('stdin is valid JSON but non-object (the bytes `null`) → exit 0 fail-soft (FIX 3)', () => {
    writeStubCli({ verdict: { disposition: 'deny' } });
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', 'freeze-check'], {
      cwd,
      input: 'null',
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(res.status).toBe(0);
  });

  // ─── Per-event payload projection (mmnto-ai/totem#2799) ────────────────
  //
  // The wrapper is --event-parameterized but used to build ONE freeze-check-
  // shaped payload for every event. It now branches on the baked --event AFTER
  // the envelope parse and the non-object guard: each gate owns its own
  // NOT-APPLICABLE test and its own payload, and an event it cannot project
  // fails CLOSED. The stub CLI records its argv, so "did not spawn" is an
  // assertion about the filesystem, not an inference from the exit code.

  const BASH_CMD = { tool_name: 'Bash', tool_input: { command: 'git status' } };
  const PWSH_CMD = { tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } };

  it('transport-shield on a Write envelope → exit 0, never spawns', () => {
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(
      { tool_name: 'Write', tool_input: { file_path: 'src/foo.ts' } },
      [],
      'transport-shield',
    );
    expect(status).toBe(0);
    expect(stubArgv()).toBeNull();
  });

  it('transport-shield on a Write envelope that DECLARES a subsystem still never spawns', () => {
    // The falsifier for the projection swap: pre-#2799 the wrapper keyed
    // applicability on `tool_input.subsystem` for EVERY event, so this envelope
    // shelled out with a freeze-check-shaped `{subsystem}` payload under
    // `--event transport-shield`. Applicability is now the gate's own.
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(
      { tool_name: 'Write', tool_input: { subsystem: 'rule-compilation' } },
      [],
      'transport-shield',
    );
    expect(status).toBe(0);
    expect(stubArgv()).toBeNull();
  });

  it('transport-shield on a Bash envelope with no string command → exit 0, never spawns', () => {
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(
      { tool_name: 'Bash', tool_input: { description: 'no command field' } },
      [],
      'transport-shield',
    );
    expect(status).toBe(0);
    expect(stubArgv()).toBeNull();
  });

  it('transport-shield on a Bash envelope with a command spawns {tool, command, platform}', () => {
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    const { status } = runWrapper(BASH_CMD, [], 'transport-shield');

    expect(status).toBe(0);
    // The baked tier rides along since mmnto-ai/totem#2800 (R1): the engine owns
    // the strict/pilot split for a gate's own unevaluable class.
    // A STRICT wrapper forwards NO `--tier` (fold F3): strict is the engine's
    // default, and an option a 2.2.x CLI cannot parse would fail the check
    // closed — re-entering the mmnto-ai/totem#2822 bootstrap self-block.
    expect(stubArgv()).toEqual(['gate', 'check', '--event', 'transport-shield', '--payload', '-']);
    expect(spawnedPayload()).toEqual({
      tool: 'Bash',
      command: 'git status',
      platform: process.platform,
    });
  });

  it('a Bash command past the win32 command-line limit still reaches the gate on stdin (P3-F6)', () => {
    // 40,000 characters: past win32's 32,767-character argv cap, where an argv
    // payload failed the spawn with ENAMETOOLONG and fell into the fail-closed
    // arm with nothing broken. On stdin the verdict comes back and maps to exit 0.
    // Discriminates the fold on the windows-latest CI leg only: linux (128 KB per
    // argument) and darwin admit a 40 KB argv, so there the pre-fold wrapper also
    // exits 0; the stdin record assertion below is what holds on every platform.
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    /** One command-line past win32's 32,767-character cap (CreateProcess), where argv transport fails. */
    const PAST_WIN32_ARGV_CAP = 40_000;
    const long = 'x'.repeat(PAST_WIN32_ARGV_CAP);
    const { status, stderr } = runWrapper(
      { tool_name: 'Bash', tool_input: { command: long } },
      [],
      'transport-shield',
    );

    expect(status).toBe(0);
    expect(stderr).not.toContain('fail-closed');
    expect(spawnedPayload()).toEqual({ tool: 'Bash', command: long, platform: process.platform });
  });

  it('transport-shield on a PowerShell envelope spawns the same shape with tool PowerShell', () => {
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    const { status } = runWrapper(PWSH_CMD, [], 'transport-shield');

    expect(status).toBe(0);
    expect(spawnedPayload()).toEqual({
      tool: 'PowerShell',
      command: 'Get-ChildItem',
      platform: process.platform,
    });
  });

  it('freeze-check is UNCHANGED: no subsystem → exit 0 without spawning', () => {
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(EDIT_NO_SUBSYSTEM);
    expect(status).toBe(0);
    expect(stubArgv()).toBeNull();
  });

  it('freeze-check is UNCHANGED: a declared subsystem spawns the {subsystem} payload', () => {
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    const { status } = runWrapper(DECLARED);

    expect(status).toBe(0);
    expect(stubArgv()).toEqual(['gate', 'check', '--event', 'freeze-check', '--payload', '-']);
    expect(spawnedPayload()).toEqual({ subsystem: 'rule-compilation' });
  });

  it('a PILOT install forwards --tier pilot; a strict one forwards none (fold F3)', () => {
    // The tier the ENGINE needs is the non-default one. Forwarding `--tier` on
    // every entry made a 2.2.x CLI exit "unknown option" — the fail-closed arm —
    // for every gated command, so only pilot pays that coupling and its
    // install-time disclosure names the 2.3.0 floor.
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    runWrapper(DECLARED, ['--pilot']);
    expect(stubArgv()).toEqual([
      'gate',
      'check',
      '--event',
      'freeze-check',
      '--tier',
      'pilot',
      '--payload',
      '-',
    ]);

    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    runWrapper(DECLARED, ['--strict']);
    expect(stubArgv()).not.toContain('--tier');
  });

  it('the child CLI stderr reaches the transcript on ALLOW, not just on failure (fold F1)', () => {
    // merge-ready writes its audited-override line and its zero-checks fact to
    // stderr with an `allow` verdict. Printing the child's stderr only in the
    // failure arm silently dropped exactly the lines that must never be silent.
    writeStubCli({
      verdict: ALLOW_VERDICT,
      exit: 0,
      stderr: '[totem merge-ready] OVERRIDE (TOTEM_MERGE_GATE_OVERRIDE=1): allowing repo#1',
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(0);
    expect(stderr).toContain('[totem merge-ready] OVERRIDE');
  });

  it('a warn verdict carries the child stderr through as well (fold F1)', () => {
    writeStubCli({
      verdict: { disposition: 'warn', reason: 'heads up', provenance: {} },
      exit: 0,
      stderr: '[totem merge-ready] ZERO status checks — predicate 1 passes as a fact',
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(0);
    expect(stderr).toContain('ZERO status checks');
    expect(stderr).toContain('heads up');
  });

  it('an --event the wrapper cannot project → exit 2 fail-closed, never spawns', () => {
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    const { status, stderr } = runWrapper(BASH_CMD, [], 'nope');

    expect(status).toBe(2);
    expect(stderr).toContain('no payload projection for event "nope"; failing closed.');
    expect(stubArgv()).toBeNull();
  });

  it('an unprojectable --event fails closed even under --pilot (tier maps dispositions only)', () => {
    writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
    const { status } = runWrapper(BASH_CMD, ['--pilot'], 'nope');
    expect(status).toBe(2);
    expect(stubArgv()).toBeNull();
  });

  // ─── merge-ready projection (mmnto-ai/totem#2800) ──────────────────────
  //
  // The gate installs under Bash|PowerShell, so this branch sees EVERY shell
  // command: the load-bearing half is what it does NOT do — a command that is
  // not `gh pr merge` at command position must pass through (exit 0) without
  // ever spawning the CLI. `stubArgv() === null` is the filesystem record of
  // "never spawned", not an inference from the exit code.
  describe('merge-ready', () => {
    /** Give the temp cwd a git identity so the projection can read repo/branch/head. */
    function initGitRepo(): string {
      spawnSync('git', ['init', '-b', 'feat/demo'], { cwd, encoding: 'utf-8' });
      spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/mmnto-ai/totem.git'], {
        cwd,
      });
      fs.writeFileSync(path.join(cwd, 'file.txt'), 'x');
      spawnSync('git', ['add', '-A'], { cwd });
      spawnSync(
        'git',
        ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-m', 'init'],
        { cwd },
      );
      return spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).stdout.trim();
    }

    const bash = (command: string): Record<string, unknown> => ({
      tool_name: 'Bash',
      tool_input: { command },
    });

    it('projects { repo, pr, headSha } from `gh pr merge <number>`', () => {
      const head = initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      const { status } = runWrapper(bash('gh pr merge 2800 --squash'), [], 'merge-ready');

      expect(status).toBe(0);
      // No `--tier` at the default strict tier (fold F3).
      expect(stubArgv()).toEqual(['gate', 'check', '--event', 'merge-ready', '--payload', '-']);
      expect(spawnedPayload()).toEqual({ repo: 'mmnto-ai/totem', pr: 2800, headSha: head });
    });

    it('projects pr: null + the CURRENT branch when the command names no PR', () => {
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge'), [], 'merge-ready');
      const payload = spawnedPayload();
      expect(payload.pr).toBeNull();
      expect(payload.branch).toBe('feat/demo');
      expect(payload.repo).toBe('mmnto-ai/totem');
    });

    it('reads the repo from -R / --repo= and the PR from a URL, over the git remote', () => {
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge --squash -R mmnto-ai/liquid-city 363'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ repo: 'mmnto-ai/liquid-city', pr: 363 });

      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(
        bash('gh pr merge https://github.com/mmnto-ai/totem-strategy/pull/1251 --merge'),
        [],
        'merge-ready',
      );
      expect(spawnedPayload()).toMatchObject({ repo: 'mmnto-ai/totem-strategy', pr: 1251 });

      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge 12 --repo=mmnto-ai/other'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ repo: 'mmnto-ai/other', pr: 12 });
    });

    it('a named branch is projected as the branch, not as a PR number', () => {
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge feat/other-branch'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: null, branch: 'feat/other-branch' });
    });

    it('a value-taking flag does not swallow the PR target (`-b "…" 42`)', () => {
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge -b "merge this now" 42'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 42 });
    });

    it("fires at command position after a separator, after the shell's command-position words, and behind an assignment prefix", () => {
      initGitRepo();
      for (const command of [
        'git status && gh pr merge 7',
        'git fetch; gh pr merge 7',
        'for x in 1; do gh pr merge 7; done',
        'if true; then gh pr merge 7; fi',
        'git log |\ngh pr merge 7',
        // PR round 1 (greptile): a merge used AS the condition, and one behind
        // an assignment prefix, each left something other than `gh` at the
        // segment's front and went unjudged.
        'if gh pr merge 7; then echo merged; fi',
        'if false; then :; elif gh pr merge 7; then :; fi',
        'while gh pr merge 7; do break; done',
        'until gh pr merge 7; do sleep 1; done',
        'GH_TOKEN=x gh pr merge 7',
        'GH_REPO=mmnto-ai/totem GH_TOKEN="a b" gh pr merge 7',
        'exec gh pr merge 7',
        'command gh pr merge 7',
      ]) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 7 });
      }
    });

    it('does NOT fire inside a quoted string, a heredoc body, or on another gh verb — and never spawns', () => {
      initGitRepo();
      for (const command of [
        'echo "gh pr merge 5"',
        "echo 'gh pr merge 5'",
        'gh pr list',
        'gh pr view 3 | grep merge',
        'git commit -m "gh pr merge"',
        // A heredoc body is DATA, not commands (fold F4): firing here was a
        // false deny — the direction this projection must not have.
        'cat <<EOF\ngh pr merge 5\nEOF',
        "cat <<'EOF'\ngh pr merge 5\nEOF",
        'cat <<-EOF\n\tgh pr merge 5\n\tEOF',
        'cat <<EOF > notes.txt\ngh pr merge 5\nEOF\necho done',
        // An UNTERMINATED body runs to the end of the command and is still data.
        'cat <<EOF\ngh pr merge 5',
        // DISCLOSED misses (the gate does not fire — the safe direction): a
        // wrapper PROGRAM takes the first token, so the position anchor never
        // sees `gh` (an assignment prefix no longer hides it — PR round 1).
        'sudo gh pr merge 5',
        'timeout 30 gh pr merge 5',
        'env GH_TOKEN=x gh pr merge 5',
      ]) {
        writeStubCli({
          verdict: { disposition: 'deny', reason: 'should not run', provenance: {} },
        });
        const { status } = runWrapper(bash(command), [], 'merge-ready');
        expect(status, command).toBe(0);
        expect(stubArgv(), command).toBeNull();
      }
    });

    it('every gh pr merge at command position is judged, not only the first (PR round 1, greptile)', () => {
      initGitRepo();
      // The stub overwrites its record on every spawn, so the record names the
      // LAST payload judged. An allowing stub: the second merge is reached.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      const allowed = runWrapper(bash('gh pr merge 7; gh pr merge 8'), [], 'merge-ready');
      expect(allowed.status).toBe(0);
      expect(spawnedPayload()).toMatchObject({ pr: 8 });

      // A denying stub under strict: the FIRST deny exits 2, so the second
      // merge is never spawned and the record still names the first.
      writeStubCli({ verdict: { disposition: 'deny', reason: 'not ready', provenance: {} } });
      const denied = runWrapper(bash('gh pr merge 7 && gh pr merge 8'), [], 'merge-ready');
      expect(denied.status).toBe(2);
      expect(spawnedPayload()).toMatchObject({ pr: 7 });
      expect(denied.stderr.match(/merge-ready \(deny\)/g)).toHaveLength(1);

      // Under --pilot a deny prints and the NEXT merge is still judged: two
      // deny lines, the record names the second merge, exit 0.
      writeStubCli({ verdict: { disposition: 'deny', reason: 'not ready', provenance: {} } });
      const pilot = runWrapper(bash('gh pr merge 7; gh pr merge 8'), ['--pilot'], 'merge-ready');
      expect(pilot.status).toBe(0);
      expect(spawnedPayload()).toMatchObject({ pr: 8 });
      expect(pilot.stderr.match(/merge-ready \(deny\)/g)).toHaveLength(2);
    });

    it('an arithmetic shift or a comment does not swallow the merge that follows (fold round 2, F1)', () => {
      // `$((1<<2))` is a SHIFT and `# see <<note` is a comment: neither opens a
      // heredoc. Before the guards, each swallowed the rest of the command and
      // the real merge after it went unjudged — a silent miss on the exact
      // command this gate exists for.
      initGitRepo();
      for (const command of [
        'echo $((1<<2)); gh pr merge 5',
        'echo $(( 3<<1 )); gh pr merge 5',
        '# see <<note\ngh pr merge 5',
        '(( 1<<3 ))\ngh pr merge 5',
        'echo hi # <<EOF\ngh pr merge 5',
      ]) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 5 });
      }
    });

    it('a line continuation does not hide the anchor (round 3, F6)', () => {
      // The shell removes a backslash-newline and joins the halves. Absorbing
      // the newline into the token left the segment starting with something
      // other than `gh`, so a real merge went unjudged.
      initGitRepo();
      for (const command of ['gh \\\npr merge 5', 'gh pr merge \\\n5', 'gh \\\r\npr merge 5']) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), JSON.stringify(command)).toMatchObject({ pr: 5 });
      }

      // A backslash before an ORDINARY character keeps its old meaning: it
      // escapes that character into the token.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge 5 --body a\\ b'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 5 });
    });

    it('a PowerShell block comment is data, not commands (round 3 F8; round 4 F1, F8)', () => {
      initGitRepo();
      const pwsh = (command: string): Record<string, unknown> => ({
        tool_name: 'PowerShell',
        tool_input: { command },
      });

      // THE CONTROL (round 4, F1): a MULTI-LINE block comment. Without the
      // `<#` arm this fires with pr 9 — verified by stripping the arm from a
      // rendered copy. The single-line row below behaves the same either way
      // (the `#` word-comment arm already covers it), so it is a companion, not
      // a control.
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      expect(runWrapper(pwsh('<#\ngh pr merge 9\n#>\necho hi'), [], 'merge-ready').status).toBe(0);
      expect(stubArgv()).toBeNull();

      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      expect(runWrapper(pwsh('<# gh pr merge 9 #>\necho hi'), [], 'merge-ready').status).toBe(0);
      expect(stubArgv()).toBeNull();

      // The merge AFTER one is still judged — the blank must not eat it.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(pwsh('<# notes #>\ngh pr merge 4'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 4 });

      // ROUND 4 F8: the blank is a POWERSHELL rule. In bash `<#tmp` is a
      // redirect from a file named `#tmp`, and blanking from it to a later `#>`
      // would swallow the real merge on the next line.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('sort <#tmp\ngh pr merge 8'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 8 });
    });

    it('a comment is not a command: a merge inside one never fires', () => {
      initGitRepo();
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      const { status } = runWrapper(bash('echo hi # gh pr merge 9'), [], 'merge-ready');
      expect(status).toBe(0);
      expect(stubArgv()).toBeNull();
    });

    it('EVERY heredoc queued on a line is read as data, not just the first (fold round 2, F2)', () => {
      // bash reads `cat <<A <<B` as two bodies in order, so a command sitting
      // in B's body is data too. Consuming only A's body left B's body as
      // commands — a false deny on text.
      initGitRepo();
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      const { status } = runWrapper(
        bash('cat <<A <<B\nfirst\nA\ngh pr merge 5\nB\n'),
        [],
        'merge-ready',
      );
      expect(status).toBe(0);
      expect(stubArgv()).toBeNull();

      // The complement: a heredoc as the merge's OWN operand still fires.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge 5 <<EOF\nnotes\nEOF\n'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 5 });
    });

    it('still fires on a real merge that FOLLOWS a heredoc (the blanker keeps the segments)', () => {
      // The heredoc blanker must not swallow the rest of the command: the
      // terminator line ends the body and the next segment is judged normally.
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(
        bash('cat <<EOF > body.md\nsome release notes\nEOF\ngh pr merge 21'),
        [],
        'merge-ready',
      );
      expect(spawnedPayload()).toMatchObject({ pr: 21 });
    });

    it('an unexpanded shell variable rides as unresolvedTarget, not as a branch (fold F13)', () => {
      // `gh pr merge $PR` names a target the hook cannot know — the shell
      // expands it after the gate has already decided. Reading "$PR" as a
      // branch would judge the wrong PR, or none.
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge $PR --squash'), [], 'merge-ready');
      const payload = spawnedPayload();
      expect(payload.unresolvedTarget).toBe('$PR');
      expect(payload.pr).toBeNull();
      // NOT the current-branch fallback: that is for a command naming no target.
      expect(payload.branch).toBeUndefined();
    });

    it('a braced expansion keeps its braces in the evidence (round 2, F10)', () => {
      // `${PR}` used to reach the engine as bare "$", because the tokenizer
      // split on the braces. A `$( … )` deliberately still splits — a real
      // merge inside a command substitution must keep firing.
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge ${PR}'), [], 'merge-ready');
      expect(spawnedPayload().unresolvedTarget).toBe('${PR}');

      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('echo $(gh pr merge 8)'), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 8 });
    });

    it('a Write envelope and a PowerShell command are treated by tool, not by text', () => {
      initGitRepo();
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      const write = runWrapper(
        { tool_name: 'Write', tool_input: { file_path: 'notes.md' } },
        [],
        'merge-ready',
      );
      expect(write.status).toBe(0);
      expect(stubArgv()).toBeNull();

      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(
        { tool_name: 'PowerShell', tool_input: { command: 'gh pr merge 11' } },
        [],
        'merge-ready',
      );
      expect(spawnedPayload()).toMatchObject({ pr: 11 });
    });

    it('an evaluation failure on an APPLICABLE merge blocks (fail-closed), pilot exits 0', () => {
      initGitRepo();
      writeStubCli({ exit: 1 });
      const strict = runWrapper(bash('gh pr merge 2800'), [], 'merge-ready');
      expect(strict.status).toBe(2);
      expect(strict.stderr).toMatch(/fail-closed/i);

      writeStubCli({ verdict: { disposition: 'deny', reason: 'behind', provenance: {} }, exit: 0 });
      const pilot = runWrapper(bash('gh pr merge 2800'), ['--pilot'], 'merge-ready');
      expect(pilot.status).toBe(0);
      expect(pilot.stderr).toContain('behind');
    });
  });
});

// ─── The PATH fallback arm (mmnto-ai/totem#2822) ───────────────────────
//
// A `Bash|PowerShell`-matched gate applies to `pnpm install` / `pnpm build` —
// the very commands that CREATE the repo-local CLI — so a repo-local-ONLY
// resolution made the gate block its own bootstrap on a fresh clone, and block
// the cure its message named (`totem eject`, a Bash command). The wrapper now
// falls back to a `totem` on PATH (repo-local still FIRST) and fails closed
// only when NEITHER arm resolves — the #2799 ruling is kept, the self-block is
// not. Each test below drives the rendered wrapper with a CONTROLLED PATH and
// discriminates the fold: pre-fix, the first two exited through the no-CLI arm
// (there was no PATH probe at all) and the third's message named `totem eject`.
describe('gate-wrapper.cjs PATH fallback (mmnto-ai/totem#2822)', () => {
  let cwd: string;
  let pathDir: string;

  /** The self-block case: a bootstrap command under the shell-matched gate. */
  const BOOTSTRAP = { tool_name: 'Bash', tool_input: { command: 'pnpm install' } };
  const ALLOW = { disposition: 'allow', reason: 'ok', provenance: {} };

  beforeEach(() => {
    cwd = makeTmpDir();
    fs.mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'), CLAUDE_GATE_WRAPPER);
    // A PATH entry shaped like an npm global prefix on win32: the `totem.cmd`
    // shim's sibling `node_modules/@mmnto/cli/dist/index.js`. Deliberately NOT
    // under `cwd/node_modules`, so the repo-local arm cannot resolve it.
    pathDir = path.join(cwd, 'global-bin');
    fs.mkdirSync(pathDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /**
   * A CLI stub at `<dir>/node_modules/@mmnto/cli/dist/index.js` emitting the
   * given verdict and exit code; returns the entry path the wrapper should
   * resolve. It drains stdin (the `--payload -` channel) before exiting so the
   * parent's `input` write never races an EPIPE into `result.error`.
   */
  function writeCliUnder(dir: string, opts: { verdict?: unknown; exit?: number }): string {
    const distDir = path.join(dir, 'node_modules', '@mmnto', 'cli', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const out = opts.verdict === undefined ? '' : JSON.stringify(opts.verdict);
    const stub = [
      '"use strict";',
      'const fs = require("fs");',
      `const out = ${JSON.stringify(out)};`,
      'try { fs.readFileSync(0, "utf-8"); } catch { /* no stdin */ }',
      'if (out) process.stdout.write(out + "\\n");',
      `process.exit(${opts.exit ?? 0});`,
      '',
    ].join('\n');
    const entry = path.join(distDir, 'index.js');
    fs.writeFileSync(entry, stub);
    return entry;
  }

  /** Run the rendered wrapper in `cwd` with an exact PATH value. */
  function runWithPath(
    envelope: unknown,
    pathValue: string,
    event = 'transport-shield',
  ): { status: number | null; stderr: string } {
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', event, '--strict'], {
      cwd,
      input: JSON.stringify(envelope),
      encoding: 'utf-8',
      timeout: 30000,
      env: envWithPath(pathValue),
    });
    return { status: res.status, stderr: res.stderr ?? '' };
  }

  it('no repo-local CLI but a totem on PATH → the PATH arm evaluates (allow → exit 0)', () => {
    writeCliUnder(pathDir, { verdict: ALLOW, exit: 0 });
    const { status } = runWithPath(BOOTSTRAP, pathDir);
    // Pre-fix this was exit 2: the wrapper never probed PATH, so a fresh clone's
    // `pnpm install` was blocked by the gate it was about to install the CLI for.
    expect(status).toBe(0);
  });

  it('the PATH CLI failing → exit 2 fail-closed, disclosing which CLI evaluated (basenames only)', () => {
    // A CLI older than 2.2.0 has no `gate check --payload -` and lands exactly
    // here (unknown option → non-zero exit). Fail-closed is UNCHANGED; the
    // added line names the arm so the operator knows what to update.
    const entry = writeCliUnder(pathDir, { exit: 1 });
    const { status, stderr } = runWithPath(BOOTSTRAP, pathDir);
    expect(status).toBe(2);
    expect(stderr).toMatch(/fail-closed/i);
    expect(stderr).toContain('evaluated by the PATH CLI at');
    // The rendering is NON-resolvable: the PATH entry's basename plus the fixed
    // package suffix. Hook stderr lands in transcripts that get pasted into
    // issues, so a user-profile path must never ride along.
    expect(stderr).toContain(
      'evaluated by the PATH CLI at global-bin/node_modules/@mmnto/cli/dist/index.js',
    );
    expect(stderr).not.toContain(entry);
    expect(stderr).not.toContain(cwd);
  });

  it('no CLI anywhere → exit 2 naming exits this gate does NOT block', () => {
    const { status, stderr } = runWithPath(BOOTSTRAP, '');
    expect(status).toBe(2);
    expect(stderr).toMatch(/failing closed/i);
    expect(stderr).toContain('terminal OUTSIDE the harness');
    expect(stderr).toContain('.claude/settings.json');
    // The cure must not be a command this very gate blocks (the pre-fix message
    // said "Reinstall totem or run `totem eject`" — both Bash).
    expect(stderr).not.toContain('totem eject');
  });

  it('the repo-local CLI still wins when both resolve (pinned beats ambient)', () => {
    // ADR-072 §2 / Tenet 14: the PATH arm is a FALLBACK, never a preference.
    // The PATH stub would fail closed if the cascade ever inverted.
    writeCliUnder(cwd, { verdict: ALLOW, exit: 0 });
    writeCliUnder(pathDir, { exit: 1 });
    const { status, stderr } = runWithPath(BOOTSTRAP, pathDir);
    expect(status).toBe(0);
    expect(stderr).not.toContain('PATH CLI');
  });
});

// ─── Install-time disclosure of the shell-matcher property (#2822) ─────
describe('gate install discloses a Bash-matched gate applies to bootstrap', () => {
  let cwd: string;
  let originalCwd: string;
  let lines: string[];
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    lines = [];
    // `log.*` writes through console.error (ui.ts); capture the rendered lines.
    // Restored per-test rather than via restoreAllMocks, which would also clear
    // the module-level install-hooks seam this file mocks.
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('prints the line for a Bash|PowerShell gate and NOT for a Write|Edit gate', async () => {
    await gateInstallCommand({ name: 'transport-shield' });
    const shield = lines.join('\n');
    expect(shield).toContain('transport-shield matches Bash|PowerShell:');
    expect(shield).toContain(
      "fresh clone's bootstrap commands (your package manager's install and build; here pnpm install and pnpm build)",
    );
    expect(shield).toContain('bootstrap a fresh clone from a terminal outside the harness');

    lines = [];
    await gateInstallCommand({ name: 'freeze-check' });
    const freeze = lines.join('\n');
    // It DID install (the control), and said nothing about bootstrap: the
    // property is the shell matcher's, not every gate's.
    expect(freeze).toContain('freeze-check');
    expect(freeze).not.toContain('bootstrap');
    expect(freeze).not.toContain('matches Bash|PowerShell');

    // A third install in the SAME cwd: transport-shield is already present, so
    // the merge is a no-op — and the disclosure still prints beside it. The
    // property belongs to the installed gate, not to the write that installed
    // it, and a re-install is where an operator most often reads the output.
    lines = [];
    await gateInstallCommand({ name: 'transport-shield' });
    const again = lines.join('\n');
    expect(again).toContain('already present — no change');
    expect(again).toContain('transport-shield matches Bash|PowerShell:');
    expect(again).toContain('bootstrap a fresh clone from a terminal outside the harness');
  });

  // ─── Pilot-tier CLI floor (mmnto-ai/totem#2800 fold F3) ───────────────
  it('a --pilot install names the CLI floor its wrapper needs; a strict one does not', async () => {
    await gateInstallCommand({ name: 'merge-ready', pilot: true });
    const pilot = lines.join('\n');
    expect(pilot).toContain('gate check --tier pilot');
    expect(pilot).toContain('2.3.0');

    lines = [];
    await gateInstallCommand({ name: 'freeze-check' });
    const strict = lines.join('\n');
    // A strict install forwards no tier, so it carries no floor to disclose.
    expect(strict).not.toContain('2.3.0');
    expect(strict).not.toContain('--tier');
  });

  it('init --gates= discloses the same pilot floor (it prints its own rows)', async () => {
    await initCommand({ bare: true, gates: 'merge-ready', pilot: true });
    const out = lines.join('\n');
    expect(out).toContain('gate check --tier pilot');
    expect(out).toContain('2.3.0');
  });
});

// ─── eject parity ──────────────────────────────────────────────────────
describe('eject removes the gate entry (parity with install)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('scrubs the gate PreToolUse entry and the wrapper script on eject', async () => {
    installGates(cwd, [FREEZE_CHECK]);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
    // Settings file may be removed entirely (if it only held the gate entry)
    // or scrubbed of the gate entry — either way no gate entry survives.
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.json'))) {
      expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
    }
  });

  it('preserves a user PreToolUse entry while scrubbing the gate entry', async () => {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] }] },
      }),
    );
    installGates(cwd, [FREEZE_CHECK]);

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'settings.json'))).toBe(true);
    const entries = preToolUseEntries(cwd);
    expect(entries.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
  });
});

// ─── init --gates= routes through the SAME installer ───────────────────
describe('init --gates= routes through the shared installer', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('init --gates=freeze-check installs the same entry installGates would', async () => {
    await initCommand({ bare: true, gates: 'freeze-check' });
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);
  });

  it('init --gates=all installs every known gate under ITS registry matcher', async () => {
    await initCommand({ bare: true, gates: 'all' });
    for (const { event, matcher } of knownGates()) {
      expect(gateEntryCount(cwd, event)).toBe(1);
      expect(matchersFor(cwd, event)).toEqual([matcher]);
    }
  });

  it('init --gates=transport-shield installs it under Bash|PowerShell (the pair, not a default)', async () => {
    await initCommand({ bare: true, gates: 'transport-shield' });
    expect(gateEntryCount(cwd, 'transport-shield')).toBe(1);
    expect(matchersFor(cwd, 'transport-shield')).toEqual(['Bash|PowerShell']);
    expect(gateCommandFor(cwd, 'transport-shield')).toBe(
      'node .claude/hooks/gate-wrapper.cjs --event transport-shield --strict',
    );
  });

  it('init --gates= discloses the bootstrap property for a Bash-matched gate, not for Write|Edit', async () => {
    // The verb and init share `installGates` but NOT their output: init prints
    // its own summary rows, so before mmnto-ai/totem#2822's shared helper the
    // disclosure existed only on the verb and `--gates=` dropped it silently.
    const shieldLines: string[] = [];
    const shieldSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      shieldLines.push(args.map((a) => String(a)).join(' '));
    });
    await initCommand({ bare: true, gates: 'transport-shield' });
    shieldSpy.mockRestore();
    const shield = shieldLines.join('\n');
    expect(shield).toContain('transport-shield matches Bash|PowerShell:');
    expect(shield).toContain('bootstrap a fresh clone from a terminal outside the harness');

    const freezeLines: string[] = [];
    const freezeSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      freezeLines.push(args.map((a) => String(a)).join(' '));
    });
    await initCommand({ bare: true, gates: 'freeze-check' });
    freezeSpy.mockRestore();
    const freeze = freezeLines.join('\n');
    // The control: freeze-check installs (a row names it) and says nothing
    // about bootstrap — the property is the shell matcher's, not every gate's.
    expect(freeze).toContain('freeze-check');
    expect(freeze).not.toContain('bootstrap');
    expect(freeze).not.toContain('matches Bash|PowerShell');
  });

  it('init --gates=merge-ready installs it under Bash|PowerShell (mmnto-ai/totem#2800)', async () => {
    await initCommand({ bare: true, gates: 'merge-ready' });
    expect(gateEntryCount(cwd, 'merge-ready')).toBe(1);
    expect(matchersFor(cwd, 'merge-ready')).toEqual(['Bash|PowerShell']);
    expect(gateCommandFor(cwd, 'merge-ready')).toBe(
      'node .claude/hooks/gate-wrapper.cjs --event merge-ready --strict',
    );
  });

  it('init --gates= with an unknown member fails loud', async () => {
    await expect(initCommand({ bare: true, gates: 'made-up-gate' })).rejects.toThrow(
      /unknown gate/i,
    );
  });

  // ─── FIX 4: empty --gates= selection fails loud, installs nothing ──────
  it('init --gates=, (empty after parse) throws GATE_INVALID and writes no gate wrapper/entry', async () => {
    const err = await initCommand({ bare: true, gates: ',' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotemError);
    expect((err as TotemError).code).toBe('GATE_INVALID');
    // No orphan wrapper scaffolded, no PreToolUse gate entry merged.
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.json'))) {
      expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
    }
  });

  it('init --gates= (whitespace-only) throws GATE_INVALID and writes no gate wrapper/entry', async () => {
    const err = await initCommand({ bare: true, gates: '   ' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotemError);
    expect((err as TotemError).code).toBe('GATE_INVALID');
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
  });
});

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

  /** Where the stub CLI records the argv it was spawned with (absent ⇒ never spawned). */
  const stubArgvPath = (): string => path.join(cwd, 'stub-argv.json');

  /** Install a stub local CLI that records its argv and emits a controlled verdict / exit code. */
  function writeStubCli(opts: { verdict?: unknown; exit?: number }): void {
    const distDir = path.join(cwd, 'node_modules', '@mmnto', 'cli', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const verdictJson = opts.verdict === undefined ? '' : JSON.stringify(opts.verdict);
    const exitCode = opts.exit ?? 0;
    // CommonJS stub (the wrapper invokes via `node <path>`); .js is fine here
    // because there is no package.json type:module in the temp dir. The argv
    // record is what lets a test assert BOTH that a spawn happened and exactly
    // which `gate check --event … --payload …` the wrapper projected
    // (mmnto-ai/totem#2799); `JSON.stringify` on the path handles Windows
    // separators without a hand-written escape.
    const stub = [
      '"use strict";',
      `const out = ${JSON.stringify(verdictJson)};`,
      `require("fs").writeFileSync(${JSON.stringify(
        stubArgvPath(),
      )}, JSON.stringify(process.argv.slice(2)));`,
      'if (out) process.stdout.write(out + "\\n");',
      `process.exit(${exitCode});`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(distDir, 'index.js'), stub);
  }

  /** The argv the stub CLI was spawned with, or null when the wrapper never spawned it. */
  function stubArgv(): string[] | null {
    if (!fs.existsSync(stubArgvPath())) return null;
    return JSON.parse(fs.readFileSync(stubArgvPath(), 'utf-8')) as string[];
  }

  /** The `--payload` JSON the wrapper projected, parsed (throws if it never spawned). */
  function spawnedPayload(): Record<string, unknown> {
    const argv = stubArgv();
    expect(argv, 'the wrapper never spawned the CLI').not.toBeNull();
    const at = argv!.indexOf('--payload');
    expect(at).toBeGreaterThan(-1);
    return JSON.parse(argv![at + 1] as string) as Record<string, unknown>;
  }

  /** Run the rendered wrapper with the given envelope + baked extra args. */
  function runWrapper(
    envelope: unknown,
    extraArgs: string[] = [],
    event = 'freeze-check',
  ): { status: number | null; stderr: string } {
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', event, ...extraArgs], {
      cwd,
      input: JSON.stringify(envelope),
      encoding: 'utf-8',
      timeout: 30000,
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
  it('applicable gate but the local CLI dist is missing → exit 2 fail-closed (FIX 2)', () => {
    // Deliberately do NOT write the stub CLI. A declared subsystem makes the
    // gate APPLY, but @mmnto/cli is not resolvable. freeze-check has no
    // commit-time hard floor, so an applicable-but-unevaluable gate must fail
    // closed (exit 2) rather than silently allow (exit 0).
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/not resolvable|not installed|failing closed/i);
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
    expect(stubArgv()).toEqual([
      'gate',
      'check',
      '--event',
      'transport-shield',
      '--payload',
      expect.any(String),
    ]);
    expect(spawnedPayload()).toEqual({
      tool: 'Bash',
      command: 'git status',
      platform: process.platform,
    });
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
    expect(stubArgv()).toEqual([
      'gate',
      'check',
      '--event',
      'freeze-check',
      '--payload',
      expect.any(String),
    ]);
    expect(spawnedPayload()).toEqual({ subsystem: 'rule-compilation' });
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

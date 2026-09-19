import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Core's scanner of record for the parity lock (spec 2857 § 3). */
const CORE_TRANSPORT_SHIELD_SRC = path.resolve(HERE, '../../../core/src/transport-shield.ts');

/** Core's span shape; `body` is the one field the wrapper's port drops. */
type CoreFindHeredocs = (
  command: string,
  opts?: { powershell?: boolean },
) => Array<WrapperSpan & { body: string }>;

/**
 * Core's `findHeredocs`, loaded from its SOURCE at run time. The specifier is
 * built at run time ON PURPOSE: the function is not re-exported from core's
 * index and core's exports map has no subpath for it (mmnto-ai/totem#2851),
 * while a STATIC relative import of another package's source fails
 * `tsc --build` with TS6059 (`rootDir`). `bot-identity-parity.test.ts`, the
 * exemplar, reads its sources as text for the same reason.
 */
async function loadCoreFindHeredocs(): Promise<CoreFindHeredocs> {
  const mod = (await import(pathToFileURL(CORE_TRANSPORT_SHIELD_SRC).href)) as {
    findHeredocs: CoreFindHeredocs;
  };
  return mod.findHeredocs;
}

/** One heredoc the wrapper's scanner located — core's span minus `body` (spec 2857 § 1). */
interface WrapperSpan {
  delimiter: string;
  quoted: boolean;
  stripTabs: boolean;
  unterminated: boolean;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * The rendered wrapper's export seam (spec `.totem/specs/2856.md` § E): run as a
 * hook it IS the main module and runs its entry; `require`d it runs no entry and
 * exports the projection, the scanner and the budget clamp, so the strip table,
 * the executable test, the clamp and scanner parity can be driven in-process
 * instead of through a process spawn per row.
 */
interface WrapperExports {
  blankHeredocBodies: (command: string, powershell: boolean) => string;
  findHeredocSpans: (command: string, powershell: boolean) => WrapperSpan[];
  ghPrMergeArgvs: (command: string, powershell: boolean) => string[][];
  isGhExecutable: (token: string) => boolean;
  projectMergeReady: (argv: string[]) => Record<string, unknown>;
  clampBudgetMs: (raw: unknown) => number;
}

const requireCjs = createRequire(import.meta.url);
let wrapperExportsCache: WrapperExports | null = null;

/**
 * The rendered template's exports, loaded once from a temp `.cjs` (the file is
 * removed again as soon as `require` has read it — nothing lands under the
 * repo). Loading the RENDERED text, not the source, is what makes these rows
 * read the same bytes the installed hook runs.
 */
function wrapperExports(): WrapperExports {
  if (wrapperExportsCache === null) {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gate-seam-')));
    const file = path.join(dir, 'gate-wrapper.cjs');
    fs.writeFileSync(file, CLAUDE_GATE_WRAPPER);
    try {
      wrapperExportsCache = requireCjs(file) as WrapperExports;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  return wrapperExportsCache;
}

// ─── The command corpus (spec `.totem/specs/2857.md` § 3) ──────────────
//
// Every command string the merge-ready rows below assert on lives here ONCE,
// so the scanner-parity lock at the foot of this file can walk the same
// strings through BOTH scanners: a shape worth a projection row is a shape the
// ported scanner is held equal to core's on. A new heredoc-, comment- or
// quote-bearing row belongs in one of these lists, not inline in an `it`.

/** Fires at command position: after a separator, a reserved word, an assignment prefix. */
const COMMAND_POSITION_ROWS = [
  'git status && gh pr merge 7',
  'git fetch; gh pr merge 7',
  'for x in 1; do gh pr merge 7; done',
  'if true; then gh pr merge 7; fi',
  'git log |\ngh pr merge 7',
  // PR round 1 (greptile): a merge used AS the condition, and one behind an
  // assignment prefix, each left something other than `gh` at the segment's
  // front and went unjudged.
  'if gh pr merge 7; then echo merged; fi',
  'if false; then :; elif gh pr merge 7; then :; fi',
  'while gh pr merge 7; do break; done',
  'until gh pr merge 7; do sleep 1; done',
  'GH_TOKEN=x gh pr merge 7',
  'GH_REPO=mmnto-ai/totem GH_TOKEN="a b" gh pr merge 7',
  'exec gh pr merge 7',
  'command gh pr merge 7',
  // Round 2 (the leg's F1): two more reserved words and the builtin that runs
  // an unquoted operand as the command.
  'time gh pr merge 7',
  'coproc gh pr merge 7',
  'eval gh pr merge 7',
];

/** Must NEVER project — the false-deny direction this projection must not have. */
const NEVER_SPAWNS_ROWS = [
  'echo "gh pr merge 5"',
  "echo 'gh pr merge 5'",
  'gh pr list',
  'gh pr view 3 | grep merge',
  'git commit -m "gh pr merge"',
  // A heredoc body is DATA, not commands (fold F4): firing here was a false
  // deny — the direction this projection must not have.
  'cat <<EOF\ngh pr merge 5\nEOF',
  "cat <<'EOF'\ngh pr merge 5\nEOF",
  'cat <<-EOF\n\tgh pr merge 5\n\tEOF',
  'cat <<EOF > notes.txt\ngh pr merge 5\nEOF\necho done',
  // An UNTERMINATED body runs to the end of the command and is still data.
  'cat <<EOF\ngh pr merge 5',
  // A substitution inside SINGLE quotes really is data: bash does not expand
  // it, so `echo '`gh pr merge 5`'` prints the text and merges nothing. The
  // DOUBLE-quoted spellings are a different matter — bash runs those, and they
  // are a disclosed MISS in MUTANT_ROWS below, not a control here (round-5
  // leg, F4).
  "echo '`gh pr merge 5`'",
  "echo '$(gh pr merge 5)'",
];

/** § A — the executable spellings that project. */
const EXECUTABLE_SPELLING_ROWS = [
  'gh.exe pr merge 5',
  'gh.EXE pr merge 5',
  './gh pr merge 5',
  '/usr/local/bin/gh pr merge 5',
  // A win32 path reaches the executable test only when it is QUOTED: this walk
  // reads POSIX quoting for BOTH tools (disclosed since the first round), so an
  // unquoted `C:\tools\gh.exe` arrives as `C:toolsgh.exe` with its separators
  // consumed as escapes — locked as a miss in MUTANT_ROWS.
  "'C:\\tools\\gh.exe' pr merge 5",
  '"/opt/hub/gh" pr merge 5',
];

/** § B — the transparent wrapper programs and flag-carrying builtins that project. */
const WRAPPER_STRIP_ROWS = [
  'sudo gh pr merge 5',
  'sudo -u root gh pr merge 5',
  'sudo --user=root gh pr merge 5',
  'sudo -- gh pr merge 5',
  // A long option that takes a SEPARATE operand needs its own table entry, or
  // the operand reads as the program and the merge behind it goes unjudged
  // (round-5 leg, F2 — an undisclosed miss family inside the closed table).
  'sudo --user root gh pr merge 5',
  'sudo --group grp gh pr merge 5',
  'sudo --prompt p gh pr merge 5',
  // sudo options that are NOT describe-only: `-E` keeps the environment, `-b`
  // runs the command in the background. Both still execute the operand.
  'sudo -E gh pr merge 5',
  'sudo -b gh pr merge 5',
  'env GH_TOKEN=x gh pr merge 5',
  'env -u X A=1 gh pr merge 5',
  'env --unset X gh pr merge 5',
  'env --chdir /tmp gh pr merge 5',
  'timeout 30 gh pr merge 5',
  'timeout 30s gh pr merge 5',
  'timeout -k 5 30 gh pr merge 5',
  'timeout --kill-after=5 30 gh pr merge 5',
  'timeout --kill-after 5 30 gh pr merge 5',
  'timeout --signal KILL 30 gh pr merge 5',
  'timeout --foreground 30 gh pr merge 5',
  'nice -n 10 gh pr merge 5',
  'nice --adjustment=10 gh pr merge 5',
  'nice --adjustment 10 gh pr merge 5',
  'nice -10 gh pr merge 5',
  'nohup gh pr merge 5',
  'command -p gh pr merge 5',
  'exec -a x gh pr merge 5',
  'time -p gh pr merge 5',
  'time -- gh pr merge 5',
  // A wrapper wrapping a wrapper: the strip loops until the head is the
  // command itself.
  'sudo -u root timeout 30 gh pr merge 5',
  'nohup nice -n 5 gh pr merge 5',
  // `eval` re-tokenizes its operand ONCE (depth 1) and projects from the inner
  // string — a merge handed over as one quoted word.
  'eval "gh pr merge 5"',
  "eval 'gh pr merge 5'",
];

/** § C — leading redirections and backtick substitutions that project. */
const REDIRECTION_ROWS = [
  '> out.txt gh pr merge 5',
  '>out.txt gh pr merge 5',
  '>> log.txt gh pr merge 5',
  '< in.txt gh pr merge 5',
  '2> err.txt gh pr merge 5',
  '2>/dev/null gh pr merge 5',
  // `&>` is not read as one operator — `&` ends the segment — but the segment
  // AFTER it starts at the `>`, which the arms do read.
  '&> out.txt gh pr merge 5',
  // A redirection in front of a wrapper program: both strips run.
  '> out.txt sudo gh pr merge 5',
  // The strip runs over the WHOLE segment, not just its front (round-5 leg,
  // F5 + F12): a redirection BETWEEN the executable and its verb no longer
  // breaks the anchor, and the here-string and `<>` spellings are operators
  // too.
  'gh > out.txt pr merge 5',
  '<<<bar gh pr merge 5',
  '<<< bar gh pr merge 5',
  '2<> file gh pr merge 5',
  'echo `gh pr merge 5`',
  '`gh pr merge 5`',
];

/**
 * § F — one mutant per widened form, and the LOCKED disclosed misses; none of
 * them may project. A mutant is a shape the shell does not run as a merge; a
 * disclosed miss is one it DOES run and this walk cannot decide — each is
 * named as which in its comment, so the residue in the template's comment is
 * read from these rows rather than from memory.
 */
const MUTANT_ROWS = [
  // § B: the operand of `sudo -u` IS `gh`, so the command is `pr`.
  'sudo -u gh pr merge 5',
  // sudo's DESCRIBE-only options run nothing at all: `-l`/`--list` prints the
  // policy, `-v`/`--validate` refreshes the timestamp, `-V`/`--version` prints
  // a version, `-K`/`--remove-timestamp` clears credentials and may not carry
  // a command. Projecting a merge there was a FALSE DENY on a command the
  // shell never runs (round-5 leg, F1).
  'sudo -l gh pr merge 5',
  'sudo --list gh pr merge 5',
  'sudo -v gh pr merge 5',
  'sudo --validate gh pr merge 5',
  'sudo -V gh pr merge 5',
  'sudo --version gh pr merge 5',
  'sudo -K gh pr merge 5',
  'sudo --remove-timestamp gh pr merge 5',
  // `time` is bash's RESERVED WORD (`time [-p] [--] pipeline`), not
  // `/usr/bin/time`: no option of it takes an operand, and any other `-` token
  // is a command bash cannot find — nothing runs, so nothing is projected
  // (round-5 leg, F3). Both spellings were read with GNU time's grammar.
  'time -f x gh pr merge 5',
  'time -o out.txt gh pr merge 5',
  // LOCKED: the PROGRAM spelled by path is not the reserved word, and a
  // path-spelled wrapper is not on the closed table at all.
  '/usr/bin/time -f x gh pr merge 5',
  // LOCKED: `env -S` / `--split-string` splits its OPERAND under env's own
  // rules and runs that as the command. The operand is consumed with the
  // option here, so the merge inside it is never read.
  "env -S 'gh pr merge 5'",
  "env --split-string='gh pr merge 5'",
  // `timeout` with no duration: the grammar consumes exactly one positional
  // before the command, so `gh` reads as the duration. A disclosed
  // false-negative of the grammar, locked here (the form is invalid to
  // `timeout` itself).
  'timeout gh pr merge 5',
  // `command -v` / `-V` DESCRIBE their operand, they never execute it.
  'command -v gh pr merge 5',
  'command -V gh pr merge 5',
  // Not on the closed list: `npx` runs a package, never the GitHub CLI.
  'npx gh pr merge 5',
  'xargs gh pr merge 5',
  'bash -c "gh pr merge 5"',
  // `eval` is bounded to ONE level.
  'eval "eval \\"gh pr merge 5\\""',
  // § C, LOCKED: a redirection operator carrying a tokenizer separator. `|`
  // ends a segment before `>|` is ever read as one word, and the segment it
  // leaves starts at the FILE, not at a redirection — so this one is named in
  // the template as unreachable rather than claimed. A `2>&1` splits the same
  // way and leaves `1` at the front.
  '>| out.txt gh pr merge 5',
  '2>&1 gh pr merge 5',
  // § A: a near-miss executable. `gh.cmd` is a DIFFERENT program (and not
  // resolvable as `gh` by spawn without a shell); `$GH` is a variable this
  // wrapper cannot expand.
  'ghx pr merge 5',
  'gh.cmd pr merge 5',
  '$GH pr merge 5',
  '${GH} pr merge 5',
  // The unquoted win32 path (see EXECUTABLE_SPELLING_ROWS): its backslashes
  // are consumed as escapes before the executable test sees the token.
  'C:\\tools\\gh.exe pr merge 5',
  // A DISCLOSED MISS, not a control (round-5 leg, F4): bash EXECUTES a
  // backtick pair and a `$( … )` inside double quotes, so both of these merge
  // PR 5 — and this walk's quote arms swallow them as one token, so neither is
  // judged. A fail-open, filed as mmnto-ai/totem#2893; they sit here because
  // the observable is the same (nothing projects), but the reason is the
  // opposite of the single-quoted control above.
  'echo "`gh pr merge 5`"',
  'echo "$(gh pr merge 5)"',
];

/** An arithmetic shift or a comment must not swallow the merge that follows. */
const ARITHMETIC_COMMENT_ROWS = [
  'echo $((1<<2)); gh pr merge 5',
  'echo $(( 3<<1 )); gh pr merge 5',
  '# see <<note\ngh pr merge 5',
  '(( 1<<3 ))\ngh pr merge 5',
  'echo hi # <<EOF\ngh pr merge 5',
];

/** A `<<<` here-string is not a heredoc: the merge after it still fires. */
const HERESTRING_ROWS = [
  'grep x <<< bar\ngh pr merge 5',
  'grep x <<<bar\ngh pr merge 5',
  '<<<bar\ngh pr merge 5',
];

/** A backslash-newline joins two halves of one word. */
const LINE_CONTINUATION_ROWS = ['gh \\\npr merge 5', 'gh pr merge \\\n5', 'gh \\\r\npr merge 5'];

// Shapes each asserted by a row of their own below, named here so the parity
// corpus reads them too.
const ROW_TWO_HEREDOC_BODIES = 'cat <<A <<B\nfirst\nA\ngh pr merge 5\nB\n';
const ROW_HEREDOC_AS_OPERAND = 'gh pr merge 5 <<EOF\nnotes\nEOF\n';
const ROW_MERGE_AFTER_HEREDOC = 'cat <<EOF > body.md\nsome release notes\nEOF\ngh pr merge 21';
const ROW_PS_BLOCK_MULTILINE = '<#\ngh pr merge 9\n#>\necho hi';
const ROW_PS_BLOCK_INLINE = '<# gh pr merge 9 #>\necho hi';
const ROW_PS_BLOCK_THEN_MERGE = '<# notes #>\ngh pr merge 4';
const ROW_BASH_HASH_REDIRECT = 'sort <#tmp\ngh pr merge 8';
const ROW_SUBSTITUTION_COMMENT = 'echo $(# <<note\ngh pr merge 5\n)';
const ROW_HERESTRING_AS_OPERAND = 'gh pr merge 6 <<< notes';
const ROW_TRAILING_COMMENT = 'echo hi # gh pr merge 9';
const ROW_PAREN_COMMENT_HEREDOC = '(true)#<<note\ngh pr merge 5';
const ROW_COLON_DELIMITER = 'cat <<E:F\nbody\nE:F\ngh pr merge 5';
const ROW_PS_CALL_OPERATOR = '& gh pr merge 5';
/**
 * A TRAILING redirection (round-5 leg, F5): the shell writes gh's output to
 * the file and merges the current branch's PR. Read at the segment's FRONT
 * only, the `>` rode into argv as the merge's first positional and the payload
 * named a branch `>` — the engine denied a pull request on a branch no one
 * wrote, a deny with a false reason.
 */
const ROW_TRAILING_REDIRECT_BRANCH = 'gh pr merge --squash > merge.log';
const ROW_TRAILING_REDIRECT_ERR = 'gh pr merge --squash 2> err.log';
const ROW_TRAILING_REDIRECT_PR = 'gh pr merge 5 > out.txt';
/**
 * A disclosed FALSE FIRE (round-5 leg, F13). PowerShell's escape inside a
 * double-quoted string is the BACKTICK, so `"a `"; gh pr merge 5`"b"` is ONE
 * string to PowerShell — it prints text and merges nothing. This walk reads
 * POSIX quoting for BOTH tools, so the `"` after the escaping backtick closes
 * the string, the `;` ends a segment, and `gh pr merge 5` lands at the next
 * segment's front. The row asserts what the wrapper DOES here, so the
 * disclosure in the template is read from a row, never from memory.
 */
const ROW_PS_DQ_BACKTICK = 'Write-Output "a `"; gh pr merge 5`"b"';
const ROW_OPEN_PAREN_COMMENT = '(#<<note\ngh pr merge 5\n)';
const ROW_GROUP_CLOSE_COMMENT = '(true; echo a)#<<note\ngh pr merge 5';

/**
 * The delimiters mmnto-ai/totem#2857 names — each carrying a character outside
 * the template's old word class — in a terminated and an unterminated form.
 */
const PARITY_DELIMITERS = ['E:F', 'E*F', 'E+F', 'E=F', 'E,F', 'E@F', 'E!F', 'EOF~'];
const DELIMITER_PARITY_ROWS = PARITY_DELIMITERS.flatMap((d) => [
  `cat <<${d}\nbody\n${d}\ngh pr merge 5`,
  `cat <<${d}\nbody\ngh pr merge 5`,
]);

/** Every string above, the corpus half of the parity lock. */
const PARITY_COMMAND_CORPUS = [
  ...COMMAND_POSITION_ROWS,
  ...NEVER_SPAWNS_ROWS,
  ...EXECUTABLE_SPELLING_ROWS,
  ...WRAPPER_STRIP_ROWS,
  ...REDIRECTION_ROWS,
  ...MUTANT_ROWS,
  ...ARITHMETIC_COMMENT_ROWS,
  ...HERESTRING_ROWS,
  ...LINE_CONTINUATION_ROWS,
  ...DELIMITER_PARITY_ROWS,
  ROW_TWO_HEREDOC_BODIES,
  ROW_HEREDOC_AS_OPERAND,
  ROW_MERGE_AFTER_HEREDOC,
  ROW_PS_BLOCK_MULTILINE,
  ROW_PS_BLOCK_INLINE,
  ROW_PS_BLOCK_THEN_MERGE,
  ROW_BASH_HASH_REDIRECT,
  ROW_SUBSTITUTION_COMMENT,
  ROW_HERESTRING_AS_OPERAND,
  ROW_TRAILING_COMMENT,
  ROW_PAREN_COMMENT_HEREDOC,
  ROW_COLON_DELIMITER,
  ROW_OPEN_PAREN_COMMENT,
  ROW_GROUP_CLOSE_COMMENT,
  ROW_PS_CALL_OPERATOR,
  ROW_PS_DQ_BACKTICK,
  ROW_TRAILING_REDIRECT_BRANCH,
  ROW_TRAILING_REDIRECT_ERR,
  ROW_TRAILING_REDIRECT_PR,
];

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
    // A fresh stub starts with NO record: the record is written only by a
    // spawn, so `stubArgv() === null` after a run means "never spawned" and a
    // `spawnedPayload()` after a run names THAT run's payload. Without this
    // reset a loop of firing shapes that all name the same PR passed on the
    // record left by its FIRST iteration — the PR-round-2 leg proved every
    // later row green against the pre-fold wrapper (F2).
    fs.rmSync(stubRecordPath(), { force: true });
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
      for (const command of COMMAND_POSITION_ROWS) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 7 });
      }
    });

    it('does NOT fire inside a quoted string, a heredoc body, or on another gh verb — and never spawns', () => {
      initGitRepo();
      for (const command of NEVER_SPAWNS_ROWS) {
        writeStubCli({
          verdict: { disposition: 'deny', reason: 'should not run', provenance: {} },
        });
        const { status } = runWrapper(bash(command), [], 'merge-ready');
        expect(status, command).toBe(0);
        expect(stubArgv(), command).toBeNull();
      }
    });

    it('the executable may carry an extension or a path (mmnto-ai/totem#2856 § A)', () => {
      // The anchor read the bare token `gh`, so every other spelling of the SAME
      // executable ran unjudged — a bypass under the strict tier (greptile P1 on
      // mmnto-ai/totem#2855). The basename after the last `/` or `\` is what the
      // test reads now.
      initGitRepo();
      for (const command of EXECUTABLE_SPELLING_ROWS) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 5 });
      }
    });

    it('a transparent wrapper program and a flag-carrying builtin are stripped (mmnto-ai/totem#2856 § B)', () => {
      // A wrapper PROGRAM took the segment's first token, so the anchor never
      // saw `gh` and the merge ran unjudged. The strip now consumes a CLOSED
      // list of transparent programs with their option grammar, re-runs the
      // assignment strip after them, and only then reads the executable.
      initGitRepo();
      for (const command of WRAPPER_STRIP_ROWS) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 5 });
      }
    });

    it('a leading redirection and a backtick substitution are judged (mmnto-ai/totem#2856 § C)', () => {
      // The shell applies a leading redirection and runs what follows, and the
      // operand of a backtick substitution IS a command — both ran unjudged
      // while the redirection word was the segment's first token and the
      // backtick was an ordinary character.
      initGitRepo();
      for (const command of REDIRECTION_ROWS) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 5 });
      }

      // PowerShell's CALL OPERATOR is not a miss and the template says so from
      // this row, never from memory (§ F): `&` is one of the tokenizer's
      // segment separators, so the segment after it starts at `gh`.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(
        { tool_name: 'PowerShell', tool_input: { command: ROW_PS_CALL_OPERATOR } },
        [],
        'merge-ready',
      );
      expect(spawnedPayload(), ROW_PS_CALL_OPERATOR).toMatchObject({ pr: 5 });

      // The complement: a backtick substitution as the merge's own TARGET is a
      // target this hook cannot know, exactly as `$( … )` is — it rides as
      // `unresolvedTarget` rather than falling back to the current branch.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash('gh pr merge `cat pr.txt`'), [], 'merge-ready');
      const payload = spawnedPayload();
      expect(payload.pr).toBeNull();
      expect(payload.unresolvedTarget).toBe('`');
      expect(payload.branch).toBeUndefined();
    });

    it('every widened form has a MUTANT that must NOT project, and never spawns (mmnto-ai/totem#2856 § F)', () => {
      initGitRepo();
      for (const command of MUTANT_ROWS) {
        writeStubCli({
          verdict: { disposition: 'deny', reason: 'should not run', provenance: {} },
        });
        const { status } = runWrapper(bash(command), [], 'merge-ready');
        expect(status, command).toBe(0);
        expect(stubArgv(), command).toBeNull();
      }
    });

    it('the two scanner divergences from mmnto-ai/totem#2855 now project (mmnto-ai/totem#2857 § 4)', () => {
      // These are the MUTANT PROOF for the parity lock at the foot of this
      // file: each one is a heredoc the template's hand-copied scanner opened
      // and core's does not, so the merge on the following line was blanked
      // and ran unjudged — one lost advisory read under PILOT, a bypass under
      // STRICT. `(true)#<<note` needs the paren-boundary arms (an operator `)`
      // ends a word, so the `#` after it begins a comment); `<<E:F` needs
      // core's bare-delimiter class (`[^\s'"\\<>()|&;]+`), where the template's
      // narrower one read the delimiter as the prefix `E` so the terminator
      // line never matched and the body ran to the end of the command.
      initGitRepo();
      for (const command of [
        ROW_PAREN_COMMENT_HEREDOC,
        ROW_COLON_DELIMITER,
        // Beside them, the other two shapes the paren arms decide: a `#` right
        // after an OPENING `(` (which begins a word), and one after the `)` of
        // a multi-command group. Neither is a comment without those arms, and
        // the `<<note` inside each opened a body that blanked the merge.
        ROW_OPEN_PAREN_COMMENT,
        ROW_GROUP_CLOSE_COMMENT,
      ]) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(stubArgv(), JSON.stringify(command)).not.toBeNull();
        expect(spawnedPayload(), JSON.stringify(command)).toMatchObject({ pr: 5 });
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
      for (const command of ARITHMETIC_COMMENT_ROWS) {
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
      for (const command of LINE_CONTINUATION_ROWS) {
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
      expect(runWrapper(pwsh(ROW_PS_BLOCK_MULTILINE), [], 'merge-ready').status).toBe(0);
      expect(stubArgv()).toBeNull();

      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      expect(runWrapper(pwsh(ROW_PS_BLOCK_INLINE), [], 'merge-ready').status).toBe(0);
      expect(stubArgv()).toBeNull();

      // The merge AFTER one is still judged — the blank must not eat it.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(pwsh(ROW_PS_BLOCK_THEN_MERGE), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 4 });

      // ROUND 4 F8: the blank is a POWERSHELL rule. In bash `<#tmp` is a
      // redirect from a file named `#tmp`, and blanking from it to a later `#>`
      // would swallow the real merge on the next line.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_BASH_HASH_REDIRECT), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 8 });
    });

    it('a trailing redirection never rides into argv as the merge target (round-5 leg, F5 + F12)', () => {
      // `gh pr merge --squash > merge.log` merges the CURRENT branch's PR and
      // writes gh's output to a file. With the strip reading only the
      // segment's FRONT, the `>` arrived as the merge's first positional: the
      // payload named a branch `>`, and the engine denied a pull request on a
      // branch no one wrote — a deny with a FALSE reason, the worst shape a
      // gate can have. The strip now runs over the whole segment.
      const head = initGitRepo();
      for (const command of [ROW_TRAILING_REDIRECT_BRANCH, ROW_TRAILING_REDIRECT_ERR]) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toEqual({
          repo: 'mmnto-ai/totem',
          pr: null,
          branch: 'feat/demo',
          headSha: head,
        });
      }

      // And with a PR named, the number is still the target and nothing of the
      // redirection reaches the payload.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_TRAILING_REDIRECT_PR), [], 'merge-ready');
      expect(spawnedPayload(), ROW_TRAILING_REDIRECT_PR).toEqual({
        repo: 'mmnto-ai/totem',
        pr: 5,
        headSha: head,
      });
    });

    it('a PowerShell backtick escape inside double quotes is a DISCLOSED false fire (round-5 leg, F13)', () => {
      // PowerShell escapes with a backtick inside a double-quoted string, so
      // `"a `"; gh pr merge 5`"b"` is ONE string and PowerShell merges nothing.
      // This walk reads POSIX quoting for BOTH tools — the `"` after the
      // escaping backtick closes the string and `gh pr merge 5` reaches a
      // segment's front — so the wrapper judges a merge the shell never runs.
      // The deny direction on contrived text, disclosed in the template's
      // false-fires paragraph and asserted here rather than claimed there.
      const head = initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(
        { tool_name: 'PowerShell', tool_input: { command: ROW_PS_DQ_BACKTICK } },
        [],
        'merge-ready',
      );
      expect(spawnedPayload(), ROW_PS_DQ_BACKTICK).toEqual({
        repo: 'mmnto-ai/totem',
        pr: 5,
        headSha: head,
      });
    });

    it('a comment is not a command: a merge inside one never fires', () => {
      initGitRepo();
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      const { status } = runWrapper(bash(ROW_TRAILING_COMMENT), [], 'merge-ready');
      expect(status).toBe(0);
      expect(stubArgv()).toBeNull();
    });

    it('EVERY heredoc queued on a line is read as data, not just the first (fold round 2, F2)', () => {
      // bash reads `cat <<A <<B` as two bodies in order, so a command sitting
      // in B's body is data too. Consuming only A's body left B's body as
      // commands — a false deny on text.
      initGitRepo();
      writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
      const { status } = runWrapper(bash(ROW_TWO_HEREDOC_BODIES), [], 'merge-ready');
      expect(status).toBe(0);
      expect(stubArgv()).toBeNull();

      // The complement: a heredoc as the merge's OWN operand still fires.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_HEREDOC_AS_OPERAND), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 5 });
    });

    it('still fires on a real merge that FOLLOWS a heredoc (the blanker keeps the segments)', () => {
      // The heredoc blanker must not swallow the rest of the command: the
      // terminator line ends the body and the next segment is judged normally.
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_MERGE_AFTER_HEREDOC), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 21 });
    });

    it('a here-string is not a heredoc: a merge on the line after `<<<` still fires (CodeRabbit on mmnto-ai/totem#2855)', () => {
      // `<<<` was excluded only at its FIRST `<`; the scanner then re-entered
      // at the second, read `bar` as a heredoc delimiter and blanked every
      // line after it — the merge below went unjudged, a fail-OPEN path. Core's
      // scanner (transport-shield.ts) carries the preceding-character guard the
      // template lacked; this row holds the two scanners equal on that shape.
      initGitRepo();
      // Three spellings, every one fail-open before the guard (the re-arm's R6):
      // spaced, glued, and a here-string that opens the command.
      for (const command of HERESTRING_ROWS) {
        writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
        runWrapper(bash(command), [], 'merge-ready');
        expect(spawnedPayload(), command).toMatchObject({ pr: 5 });
      }
      // The complement (a non-regression row, not a falsifier): a here-string as
      // the merge's OWN operand still fires.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_HERESTRING_AS_OPERAND), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 6 });
    });

    it('a # glued to $( is a comment, as in core: a <<word inside it never opens a heredoc (the pilot-install re-arm, R2)', () => {
      // Core's scanner sets the word boundary after a command substitution
      // opens, so `$(# …` reads the `#` as a comment. The template had no
      // substitution arm: the boundary stayed false, the `#` was text, and a
      // `<<note` inside it opened a heredoc whose unterminated body blanked the
      // merge on the next line — the same fail-open class as the here-string.
      initGitRepo();
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      runWrapper(bash(ROW_SUBSTITUTION_COMMENT), [], 'merge-ready');
      expect(spawnedPayload()).toMatchObject({ pr: 5 });
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

    /**
     * A `--require` preload that sleeps 8 s and exits 0 in any node process
     * whose executable IS the `git` shim, and is a no-op in every other node
     * process — the wrapper and the stub CLI run under the same NODE_OPTIONS,
     * so the argv0/execPath guard is what keeps the shim from slowing them.
     */
    const SLOW_GIT_PRELOAD = [
      '"use strict";',
      'const path = require("path");',
      'const base = (p) => path.basename(String(p || "")).toLowerCase();',
      'const me = base(process.argv0) + "|" + base(process.execPath);',
      'if (me.includes("git")) {',
      '  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 8000);',
      '  process.exit(0);',
      '}',
      '',
    ].join('\n');

    /**
     * The slow-git shim on a PATH dir of its own: `spawnSync('git', …)`
     * without a shell resolves `git.exe` through PATH on win32 (a `.cmd` shim
     * is NOT resolvable that way), so the shim is a copy — a hard link where
     * the volume allows — of this node binary named `git`/`git.exe`, slowed by
     * the argv0-guarded preload above.
     */
    function slowGitEnv(): NodeJS.ProcessEnv {
      const binDir = path.join(cwd, 'slow-git-bin');
      fs.mkdirSync(binDir, { recursive: true });
      const shim = path.join(binDir, process.platform === 'win32' ? 'git.exe' : 'git');
      if (!fs.existsSync(shim)) {
        try {
          fs.linkSync(process.execPath, shim);
        } catch {
          fs.copyFileSync(process.execPath, shim);
        }
        if (process.platform !== 'win32') fs.chmodSync(shim, 0o755);
      }
      const preload = path.join(cwd, 'slow.cjs');
      fs.writeFileSync(preload, SLOW_GIT_PRELOAD);
      const env = envWithPath(binDir + path.delimiter + (process.env.PATH ?? ''));
      env.NODE_OPTIONS = '--require=' + preload.split(path.sep).join('/');
      return env;
    }

    /**
     * Spawn the rendered wrapper, write the envelope on its stdin and leave
     * the stream OPEN, then await the exit. The `end` never comes, so only the
     * wrapper's own budget can end the run — which is the whole assertion.
     * The kill after 10 s is the harness's own floor, not the wrapper's: if it
     * fires, the row has failed.
     */
    async function runWrapperOpenStdin(
      envelope: unknown,
      extraArgs: string[],
      event: string,
    ): Promise<{ status: number | null; stderr: string; elapsed: number }> {
      const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
      const started = Date.now();
      const child = spawn(process.execPath, [wrapperPath, '--event', event, ...extraArgs], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.setEncoding('utf-8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.stdout.resume();
      // A wrapper that exits while the pipe is still open makes this write
      // EPIPE; that is the expected end of this row, not a failure.
      child.stdin.on('error', () => {});
      child.stdin.write(JSON.stringify(envelope));
      const status = await new Promise<number | null>((resolve, reject) => {
        const kill = setTimeout(() => {
          child.kill();
          reject(new Error('the wrapper did not exit on its own with stdin left open'));
        }, 10000);
        child.on('error', (err) => {
          clearTimeout(kill);
          reject(err);
        });
        child.on('close', (code) => {
          clearTimeout(kill);
          resolve(code);
        });
      });
      return { status, stderr, elapsed: Date.now() - started };
    }

    it('the stdin read is INSIDE the budget: an envelope whose pipe never closes exits 2 (round-5 leg, F6)', async () => {
      // The budget covered everything after the envelope ARRIVED; reading it
      // was outside. A host that writes the envelope and holds the pipe open
      // (or writes nothing at all) left this hook waiting with no deadline of
      // its own until the HOST killed it — and a killed hook's exit code is
      // never applied, a fail-OPEN on a gate whose posture is fail-closed, the
      // same class § D cured for the projection's git reads. The timer is armed
      // at the entry for what is left of the budget; the `end` handler clears
      // it before evaluating, so a normal run never sees it (every other row in
      // this file is that proof).
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      const { status, stderr, elapsed } = await runWrapperOpenStdin(
        bash('gh pr merge 5'),
        ['--budget-ms', '1000'],
        'merge-ready',
      );

      expect(status).toBe(2);
      expect(stderr).toContain(
        'the 1000 ms budget was spent before the envelope arrived on stdin',
      );
      expect(stderr).toContain('fail-closed');
      // Nothing was evaluated: the envelope never finished arriving.
      expect(stubArgv()).toBeNull();
      // It waited for the budget, and only for the budget.
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(5000);
    });

    it('the `--budget-ms=<n>` spelling parses like the separate-token form (round-5 leg, F7)', () => {
      // `--budget-ms=1500` fell through the argv loop as an unknown argument
      // and left the full 30 s default in place — silently WIDENING the window
      // for a caller that wrote the argument to shorten it, the one direction
      // this argument must never move. End-to-end against the same hung git as
      // the row above, so what is asserted is the wrapper's real arm.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      const env = slowGitEnv();

      const started = Date.now();
      const { status, stderr } = runWrapper(
        bash('gh pr merge 5'),
        ['--budget-ms=1500'],
        'merge-ready',
        env,
      );
      const elapsed = Date.now() - started;

      expect(status).toBe(2);
      expect(stderr).toContain(
        'the 1500 ms budget was spent before gate "merge-ready" could be evaluated',
      );
      expect(stubArgv()).toBeNull();
      expect(elapsed).toBeLessThan(6000);
    });

    it('a hung git is bounded by the budget: exit 2, the named line, no CLI spawn (mmnto-ai/totem#2856 § G)', () => {
      // THE FALSIFIER for § D. `spawnSync('git', …)` without a shell resolves
      // `git.exe` through PATH on win32 (a `.cmd` shim is NOT resolvable that
      // way), so the shim is a copy — a hard link where the volume allows — of
      // this node binary named `git`/`git.exe` on a PATH dir of its own.
      //
      // Pre-fix the projection's git reads ran on their own 10 s timeouts
      // BEFORE any deadline existed: the wrapper spent ~20 s in the projection
      // and then spawned the CLI (and on a multi-merge envelope it reached the
      // host's own hook timeout, where its exit code is never applied). With
      // the budget set at the entry, the reads are bounded by what is left of
      // it and the spent-budget arm fires before the first `gate check`.
      writeStubCli({ verdict: ALLOW_VERDICT, exit: 0 });
      const env = slowGitEnv();

      const started = Date.now();
      const { status, stderr } = runWrapper(
        bash('gh pr merge 5'),
        ['--budget-ms', '1500'],
        'merge-ready',
        env,
      );
      const elapsed = Date.now() - started;

      expect(status).toBe(2);
      expect(stderr).toContain(
        'the 1500 ms budget was spent before gate "merge-ready" could be evaluated',
      );
      expect(stderr).toContain('fail-closed');
      // The CLI was never spawned: the budget was gone before the first check.
      expect(stubArgv()).toBeNull();
      // Bounded by the budget plus one floor, not by the 8 s sleep and not by
      // `runWrapper`'s own 30 s timeout.
      expect(elapsed).toBeLessThan(6000);
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

// ─── The export seam (mmnto-ai/totem#2856 § E) ─────────────────────────
//
// Run as a hook the wrapper IS the main module and runs its entry; `require`d
// it runs no entry and exports the projection, the scanner and the budget
// clamp. These rows drive those exports IN-PROCESS — a cell of the strip table
// through a process spawn costs a second of wall time apiece, and the
// end-to-end rows above already prove the seam and the hook agree.
describe('gate-wrapper export seam (mmnto-ai/totem#2856 § E)', () => {
  it('a required wrapper exports the projection, the scanner and the clamp — and runs no entry', () => {
    const w = wrapperExports();
    for (const name of [
      'blankHeredocBodies',
      'clampBudgetMs',
      'findHeredocSpans',
      'ghPrMergeArgvs',
      'isGhExecutable',
      'projectMergeReady',
    ] as const) {
      expect(typeof w[name], name).toBe('function');
    }
    // The entry reads stdin and exits the process: requiring the module must do
    // NEITHER — reaching this line is that assertion — and the projection must
    // answer without a spawn.
    expect(w.ghPrMergeArgvs('gh pr merge 5', false)).toEqual([['5']]);
  });

  it('--budget-ms can only LOWER the budget (§ D)', () => {
    // A malformed or oversized test-only argument must never WIDEN the window
    // in which a hung git can run the hook into the host's own kill (where the
    // wrapper's fail-closed exit is never applied). The clamp is silent and
    // one-directional; the value it settled on is echoed in the budget line
    // when the arm fires.
    const { clampBudgetMs } = wrapperExports();
    const rows: Array<[unknown, number]> = [
      [1, 1000],
      ['abc', 30000],
      [99999, 30000],
      [1500, 1500],
      ['1500', 1500],
      [undefined, 30000],
      [null, 30000],
      ['', 30000],
      [0, 1000],
      [-5, 1000],
      [999, 1000],
      [1000, 1000],
      [30000, 30000],
      [30001, 30000],
      ['20000abc', 20000],
      [Number.NaN, 30000],
      [Number.POSITIVE_INFINITY, 30000],
    ];
    for (const [raw, expected] of rows) {
      expect(clampBudgetMs(raw), JSON.stringify(raw ?? String(raw))).toBe(expected);
    }
  });

  it('the strip table, cell by cell: what projects and what must not (§ B)', () => {
    const { ghPrMergeArgvs } = wrapperExports();
    /** [command, the argv after `gh pr merge`, or null when nothing projects] */
    const rows: Array<[string, string[] | null]> = [
      // sudo: `-u -g -p -C -D -h -r -t -T -U` each take a separate operand,
      // and so does each long spelling (round-5 leg, F2).
      ['sudo gh pr merge 5', ['5']],
      ['sudo -u root gh pr merge 5', ['5']],
      ['sudo -g grp -p prompt gh pr merge 5', ['5']],
      ['sudo -H -E gh pr merge 5', ['5']],
      ['sudo -u gh pr merge 5', null],
      ['sudo --user root gh pr merge 5', ['5']],
      ['sudo --group grp --prompt p gh pr merge 5', ['5']],
      ['sudo --chdir /tmp gh pr merge 5', ['5']],
      ['sudo --chroot /r gh pr merge 5', ['5']],
      ['sudo --host h gh pr merge 5', ['5']],
      ['sudo --role r --type t gh pr merge 5', ['5']],
      ['sudo --other-user u gh pr merge 5', ['5']],
      ['sudo --command-timeout 10 gh pr merge 5', ['5']],
      ['sudo --user gh pr merge 5', null],
      // sudo's DESCRIBE-only options execute nothing (round-5 leg, F1).
      ['sudo -l gh pr merge 5', null],
      ['sudo --list gh pr merge 5', null],
      ['sudo -v gh pr merge 5', null],
      ['sudo --validate gh pr merge 5', null],
      ['sudo -V gh pr merge 5', null],
      ['sudo --version gh pr merge 5', null],
      ['sudo -K gh pr merge 5', null],
      ['sudo --remove-timestamp gh pr merge 5', null],
      // …but `-E` and `-b` still run the command.
      ['sudo -E gh pr merge 5', ['5']],
      ['sudo -b gh pr merge 5', ['5']],
      // env: options, then the assignment strip re-runs.
      ['env gh pr merge 5', ['5']],
      ['env A=1 B=2 gh pr merge 5', ['5']],
      ['env -u X A=1 gh pr merge 5', ['5']],
      ['env -C /tmp gh pr merge 5', ['5']],
      ['env -u gh pr merge 5', null],
      ['env --unset X gh pr merge 5', ['5']],
      ['env --chdir /tmp gh pr merge 5', ['5']],
      ['env --unset gh pr merge 5', null],
      // LOCKED: `-S` / `--split-string` carries the command as its operand.
      ["env -S 'gh pr merge 5'", null],
      ["env --split-string='gh pr merge 5'", null],
      // timeout: exactly ONE positional (the duration) before the command.
      ['timeout 30 gh pr merge 5', ['5']],
      ['timeout -s TERM 30 gh pr merge 5', ['5']],
      ['timeout gh pr merge 5', null],
      ['timeout 30 sudo gh pr merge 5', ['5']],
      ['timeout --signal KILL 30 gh pr merge 5', ['5']],
      ['timeout --kill-after 5 30 gh pr merge 5', ['5']],
      ['timeout --signal 30 gh pr merge 5', null],
      // nice: `-n` takes an operand; a bare `-10` is an adjustment.
      ['nice gh pr merge 5', ['5']],
      ['nice -n 10 gh pr merge 5', ['5']],
      ['nice -10 gh pr merge 5', ['5']],
      ['nice -n gh pr merge 5', null],
      ['nice --adjustment 10 gh pr merge 5', ['5']],
      ['nice --adjustment gh pr merge 5', null],
      // nohup: no options of its own.
      ['nohup gh pr merge 5', ['5']],
      // command: `-p` is transparent, `-v`/`-V` describe and never execute.
      ['command gh pr merge 5', ['5']],
      ['command -p gh pr merge 5', ['5']],
      ['command -v gh pr merge 5', null],
      ['command -V gh pr merge 5', null],
      // exec: `-a` takes the argv[0] operand; `-c` and `-l` do not.
      ['exec gh pr merge 5', ['5']],
      ['exec -a x gh pr merge 5', ['5']],
      ['exec -c -l gh pr merge 5', ['5']],
      ['exec -a gh pr merge 5', null],
      // time: bash's RESERVED WORD, `time [-p] [--] pipeline`. `-p` is its one
      // option, `--` ends options, and ANY other `-` token is a command bash
      // cannot find — nothing runs, nothing projects (round-5 leg, F3). GNU
      // `/usr/bin/time`'s `-o`/`-f` grammar is a different program's, and a
      // path-spelled wrapper is not on the closed table.
      ['time gh pr merge 5', ['5']],
      ['time -p gh pr merge 5', ['5']],
      ['time -- gh pr merge 5', ['5']],
      ['time -o out.txt gh pr merge 5', null],
      ['time -f x gh pr merge 5', null],
      ['time -o gh pr merge 5', null],
      ['/usr/bin/time -f x gh pr merge 5', null],
      // eval: depth 1 only.
      ['eval gh pr merge 5', ['5']],
      ['eval "gh pr merge 5"', ['5']],
      ['eval "eval \\"gh pr merge 5\\""', null],
      // Not on the closed list.
      ['npx gh pr merge 5', null],
      ['xargs -n1 gh pr merge 5', null],
      ['watch gh pr merge 5', null],
      // The flags of the merge itself still ride through untouched.
      ['sudo gh pr merge 5 --squash', ['5', '--squash']],
    ];
    for (const [command, expected] of rows) {
      const found = ghPrMergeArgvs(command, false);
      expect(found, command).toEqual(expected === null ? [] : [expected]);
    }
  });

  it('a redirection is dropped with its file ANYWHERE in the segment (§ C, round-5 leg F5 + F12)', () => {
    // The argv the rows above can only assert through a payload, asserted
    // exactly: an operator alone takes the file token with it, a fused one
    // goes alone, and neither ever reaches `gh pr merge`'s argv.
    const { ghPrMergeArgvs } = wrapperExports();
    const rows: Array<[string, string[] | null]> = [
      // Trailing — the shape that rode `>` in as the merge's target.
      [ROW_TRAILING_REDIRECT_PR, ['5']],
      ['gh pr merge 5 >out.txt', ['5']],
      [ROW_TRAILING_REDIRECT_BRANCH, ['--squash']],
      [ROW_TRAILING_REDIRECT_ERR, ['--squash']],
      // Between the executable and its verb — the shape that broke the anchor.
      ['gh > out.txt pr merge 5', ['5']],
      ['gh pr > out.txt merge 5', ['5']],
      // Leading, alone and fused, in every spelling the two patterns read.
      ['> out.txt gh pr merge 5', ['5']],
      ['2>/dev/null gh pr merge 5', ['5']],
      ['<<<bar gh pr merge 5', ['5']],
      ['<<< bar gh pr merge 5', ['5']],
      ['2<> file gh pr merge 5', ['5']],
      ['2<>file gh pr merge 5', ['5']],
      // A `<<EOF` head is a fused form and drops harmlessly — its body was
      // blanked by the scanner long before the tokenizer ran.
      [ROW_HEREDOC_AS_OPERAND, ['5']],
      [ROW_HERESTRING_AS_OPERAND, ['6']],
      // RESIDUE, unreachable rather than claimed: `|` and `&` are the
      // tokenizer's own separators and end the token before the operator is
      // whole, so these two never present a redirection to strip.
      ['>| out.txt gh pr merge 5', null],
      ['2>&1 gh pr merge 5', null],
    ];
    for (const [command, expected] of rows) {
      const found = ghPrMergeArgvs(command, false);
      expect(found, JSON.stringify(command)).toEqual(expected === null ? [] : [expected]);
    }
  });

  it('the span blanker replaces a body with spaces and keeps every offset (2857 § 1)', () => {
    const { blankHeredocBodies, findHeredocSpans } = wrapperExports();
    const command = 'cat <<EOF\ngh pr merge 5\nEOF\ngh pr merge 7';
    const blanked = blankHeredocBodies(command, false);
    // Core's shape: same length, the body's characters replaced by spaces, the
    // operator line and the terminator line untouched.
    expect(blanked).toHaveLength(command.length);
    const [span] = findHeredocSpans(command, false);
    expect(blanked.slice(span.bodyStart, span.bodyEnd)).toBe(
      ' '.repeat(span.bodyEnd - span.bodyStart),
    );
    expect(blanked.slice(0, span.bodyStart)).toBe(command.slice(0, span.bodyStart));
    expect(blanked.slice(span.bodyEnd)).toBe(command.slice(span.bodyEnd));
  });

  it('isGhExecutable reads the basename after the last / or backslash (§ A)', () => {
    const { isGhExecutable } = wrapperExports();
    for (const token of [
      'gh',
      'gh.exe',
      'gh.EXE',
      './gh',
      '../bin/gh',
      '/usr/local/bin/gh',
      'C:\\tools\\gh.exe',
      '\\\\server\\share\\gh',
    ]) {
      expect(isGhExecutable(token), token).toBe(true);
    }
    for (const token of [
      '',
      'ghx',
      'gh.cmd',
      'GH',
      'github',
      'gh.exe.bak',
      'mygh',
      '$GH',
      '${GH}',
      'C:toolsgh.exe',
    ]) {
      expect(isGhExecutable(token), token).toBe(false);
    }
  });
});

// ─── Scanner parity with core (spec `.totem/specs/2857.md` § 3) ────────
//
// The wrapper's heredoc scanner is a VERBATIM port of core's `findHeredocs`
// (`packages/core/src/transport-shield.ts`). A distributed, dependency-free
// hook cannot import core — its exports map carries `import` conditions only
// and no scanner subpath (mmnto-ai/totem#2851), and the package is not linked
// at this monorepo's root — so the cohort lesson for an inlined standalone
// utility applies: port it verbatim, anchor BOTH sites, and back the copy with
// an executable parity test. This is that test.
//
// It compares SPANS, not behaviour: a divergence fails here, naming the input,
// instead of surfacing later as a heredoc one scanner opens and the other does
// not — which is a blanked `gh pr merge` on a following line, a lost advisory
// read under PILOT and a bypass under STRICT. The two rows the fix flips from
// "never spawns" to projecting (mmnto-ai/totem#2855's locked divergences) are
// the proof that this lock BITES: they are exactly the behaviour the ported
// arms add.
describe('heredoc scanner parity with core (mmnto-ai/totem#2857)', () => {
  let findHeredocs: CoreFindHeredocs | null = null;

  // The ONE async step: core's scanner is a TypeScript source this suite loads
  // at run time. Loading it here keeps every row below synchronous, which is
  // what they are.
  beforeAll(async () => {
    findHeredocs = await loadCoreFindHeredocs();
  });

  /** Core's spans in the wrapper's shape — same fields, minus the unused `body`. */
  function coreSpans(command: string, powershell: boolean): WrapperSpan[] {
    if (findHeredocs === null) throw new Error('core findHeredocs was not loaded');
    return findHeredocs(command, { powershell }).map((s) => ({
      delimiter: s.delimiter,
      quoted: s.quoted,
      stripTabs: s.stripTabs,
      unterminated: s.unterminated,
      bodyStart: s.bodyStart,
      bodyEnd: s.bodyEnd,
    }));
  }

  /**
   * A seeded pseudo-random corpus: a 32-bit LCG (Numerical Recipes constants)
   * with a FIXED seed, so the strings are identical on every machine and every
   * run and a divergence is reproducible from the seed alone. The alphabet is
   * the characters the two walks branch on, plus the multi-character tokens
   * they branch on as a unit.
   */
  function fuzzCorpus(count: number): string[] {
    const alphabet = [
      'a',
      'b',
      '_',
      '-',
      '.',
      ':',
      '*',
      '(',
      ')',
      '#',
      '$',
      '<',
      '>',
      "'",
      '"',
      '\\',
      '`',
      '|',
      '&',
      ';',
      ' ',
      '\n',
      '\t',
      '<<',
      '<<-',
      '<<<',
      '$(',
      '((',
      '<#',
      '#>',
      'EOF',
    ];
    let state = 20260919 >>> 0;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const out: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const draws = 1 + Math.floor(next() * 40);
      let s = '';
      for (let j = 0; j < draws; j += 1) {
        s += alphabet[Math.floor(next() * alphabet.length)];
      }
      out.push(s);
    }
    return out;
  }

  it('agrees with core over every command in this file, in both modes', () => {
    const { findHeredocSpans } = wrapperExports();
    for (const command of PARITY_COMMAND_CORPUS) {
      for (const powershell of [false, true]) {
        expect(
          findHeredocSpans(command, powershell),
          JSON.stringify({ command, powershell }),
        ).toEqual(coreSpans(command, powershell));
      }
    }
  });

  it('agrees with core over a seeded 3 000-string fuzz corpus, in both modes', () => {
    const { findHeredocSpans } = wrapperExports();
    const corpus = fuzzCorpus(3000);
    expect(corpus).toHaveLength(3000);
    for (const command of corpus) {
      for (const powershell of [false, true]) {
        expect(
          findHeredocSpans(command, powershell),
          JSON.stringify({ command, powershell }),
        ).toEqual(coreSpans(command, powershell));
      }
    }
  });

  it('the corpus carries the delimiters the issue names, terminated and not', () => {
    // The guard on the guard: a corpus that silently lost these rows would
    // pass the two parity rows above while testing nothing about the bare
    // delimiter class the port widens.
    expect(DELIMITER_PARITY_ROWS).toHaveLength(PARITY_DELIMITERS.length * 2);
    for (const delimiter of PARITY_DELIMITERS) {
      expect(PARITY_COMMAND_CORPUS.some((c) => c.includes('<<' + delimiter))).toBe(true);
      // Each one really is a heredoc to CORE — otherwise the row would prove
      // nothing about the delimiter class.
      const spans = coreSpans(
        'cat <<' + delimiter + '\nbody\n' + delimiter + '\ngh pr merge 5',
        false,
      );
      expect(spans, delimiter).toHaveLength(1);
      expect(spans[0].delimiter, delimiter).toBe(delimiter);
      expect(spans[0].unterminated, delimiter).toBe(false);
    }
  });
});

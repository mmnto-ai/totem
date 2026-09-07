// [totem] auto-generated — Claude Code action-gate wrapper
// ONE parameterized PreToolUse wrapper for the Totem gate engine (PR-C,
// mmnto-ai/totem#2048). Reads --event <name> from argv (baked per-entry into
// the installed command), reads the PreToolUse stdin envelope, shells to
// `totem gate check`, and maps the GateVerdict disposition → host exit code.
// `.cjs` extension because package.json may have "type": "module" — Claude
// Code execs hooks via plain `node`, which would otherwise treat `.js` as ESM.
//
// Exit-code contract (LOAD-BEARING — ADR-109 §2; branch ONLY on disposition):
//   0 = allow | warn | --pilot deny | NOT-APPLICABLE fail-soft
//       (unparseable/non-object envelope; freeze-check with no declared
//        subsystem; transport-shield on a tool other than Bash/PowerShell or
//        with no non-empty string command)
//   2 = deny (--strict, Claude block convention)
//       | APPLICABLE-gate-not-evaluable fail-closed (missing CLI, non-zero
//         `gate check`, unparseable verdict, or unknown disposition)
//       | an --event this wrapper has no payload projection for (a baked event
//         it cannot project is an applicable gate it cannot evaluate)
'use strict';

const { spawnSync } = require('child_process');
const { existsSync, realpathSync } = require('fs');
const { delimiter, join } = require('path');

// ─── PATH FALLBACK for the Totem CLI (mmnto-ai/totem#2822) ──────────────
// A `Bash|PowerShell`-matched gate applies to the very commands that CREATE
// the repo-local CLI on a fresh clone (`pnpm install`, then `pnpm build` in
// this monorepo), so with a repo-local-only resolution the gate blocks its own
// bootstrap — and blocks the cure it prints. This is a RESOLUTION arm, not an
// exemption: an applicable gate that cannot be evaluated by EITHER arm still
// fails closed (mmnto-ai/totem#2799 ruling, Tenet 4).
//
// The repo-local pinned dist stays FIRST (ADR-072 §2 amended cascade, Tenet 14:
// pinned beats ambient); this runs only when it is absent. Two npm-global
// layouts are probed per PATH dir, first hit wins:
//   (a) <dir>/node_modules/@mmnto/cli/dist/index.js — the win32 layout, where
//       the `totem.cmd` shim sits beside `node_modules`;
//   (b) <dir>/totem realpath'd — the POSIX npm-global symlink, taken only when
//       it resolves to an existing `.js` file (a shell shim resolves to an
//       extensionless script and is correctly skipped).
// A dir that yields neither is skipped; nothing here throws.
function resolveCliFromPath() {
  const raw = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  const dirs = raw.split(delimiter);
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (!dir) continue;
    const packaged = join(dir, 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
    if (existsSync(packaged)) return packaged;
    const shim = join(dir, 'totem');
    if (existsSync(shim)) {
      try {
        const real = realpathSync(shim);
        if (typeof real === 'string' && real.endsWith('.js') && existsSync(real)) return real;
      } catch (err) {
        // An unreadable link is not a resolution — keep scanning the PATH.
      }
    }
  }
  return '';
}

// ─── Parse baked args (--event <name>, optional --pilot / --strict) ─────
// The tier is read ONLY from argv (baked into the installed command at
// install time). There is NO env-var override: env sourcing would be a
// fail-open (any shell with TOTEM_GATE_TIER=pilot could silently downgrade
// enforcement). Default (no flag) = strict, so a default install is
// environment-immune; --pilot is an explicit install-time opt-in.
const argv = process.argv.slice(2);
let event = '';
let tier = 'strict';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--event') {
    event = argv[i + 1] || '';
    i++;
  } else if (argv[i] === '--pilot') {
    tier = 'pilot';
  } else if (argv[i] === '--strict') {
    tier = 'strict';
  }
}

// Read the PreToolUse stdin envelope.
let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  let parsed;
  try {
    parsed = stdin ? JSON.parse(stdin) : {};
  } catch (err) {
    // Fail-soft on a malformed envelope (mirror PreWriteShield): a broken
    // host envelope is not an applicable gate, so it must NOT block.
    process.stderr.write('[totem gate-wrapper] could not parse stdin JSON; allowing\n');
    process.exit(0);
  }

  // Valid JSON can still be a non-object (the bytes `null`, `123`, or a bare
  // quoted string). Such an envelope carries no `tool_input` to dereference and
  // is NOT an applicable gate → fail-soft (exit 0). Guarding here also prevents
  // a TypeError-on-deref from leaking as exit 1.
  if (parsed === null || typeof parsed !== 'object') {
    process.stderr.write('[totem gate-wrapper] stdin JSON is not an object; allowing\n');
    process.exit(0);
  }

  const input =
    typeof parsed.tool_input === 'object' && parsed.tool_input !== null ? parsed.tool_input : {};

  // ─── PER-EVENT PAYLOAD PROJECTION ─────────────────────────────────────
  // Each gate reads a DIFFERENT slice of the PreToolUse envelope, so the
  // projection branches on the baked --event. Every branch owns its own
  // NOT-APPLICABLE test — the point past which a gate genuinely applies and
  // any evaluation failure must fail CLOSED.
  //
  //   event            | applies when                     | payload
  //   -----------------|----------------------------------|---------------------------
  //   freeze-check     | tool_input.subsystem is a         | { subsystem }
  //                    | non-empty string                  |
  //   transport-shield | tool_name is Bash or PowerShell   | { tool, command, platform }
  //                    | AND tool_input.command is a       |
  //                    | non-empty string                  |
  //   (anything else)  | — no projection → fail closed     | —
  let payload = '';

  if (event === 'freeze-check') {
    // THE EMPTY-SUBSYSTEM GUARDRAIL: freeze-check's predicate is on a DECLARED
    // subsystem. A normal Edit/Write carries tool_input.file_path (a path), NOT
    // a subsystem. With no declared subsystem, NO GATE APPLIES → pass through
    // (exit 0). Do NOT shell out — a blanket fail-closed here would block every
    // ordinary edit.
    const declaredSubsystem =
      typeof input.subsystem === 'string' && input.subsystem.trim() !== ''
        ? input.subsystem.trim()
        : '';
    if (declaredSubsystem === '') {
      process.exit(0);
    }
    payload = JSON.stringify({ subsystem: declaredSubsystem });
  } else if (event === 'transport-shield') {
    // transport-shield's predicate is on a SHELL COMMAND. Anything that is not
    // a Bash/PowerShell invocation carrying a command string is NOT an
    // applicable gate → pass through (exit 0), mirroring the guardrail above.
    // The installed matcher is the CLI's own, so a foreign tool_name here means
    // a hand-edited settings entry, not a shape to judge.
    const tool = parsed.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    if (typeof input.command !== 'string' || input.command.trim() === '') {
      process.exit(0);
    }
    payload = JSON.stringify({
      tool: tool,
      command: input.command,
      platform: process.platform,
    });
  } else {
    // A baked --event this wrapper cannot project is an APPLICABLE gate it
    // cannot evaluate → fail closed (ADR-109). Reinstalling refreshes the
    // wrapper (`totem gate install` drift-repairs the bounded region).
    process.stderr.write(
      '[totem gate-wrapper] no payload projection for event "' + event + '"; failing closed.\n',
    );
    process.exit(2);
  }

  // Resolve the Totem CLI: the repo-local pinned dist FIRST (a global `totem`
  // may be stale and missing deps — the known repo gotcha; ADR-072 §2 amended
  // cascade, Tenet 14: pinned beats ambient), then a `totem` on PATH as a
  // FALLBACK (mmnto-ai/totem#2822 — the bootstrap self-block above). Invoke
  // node on whichever dist entry resolved.
  //
  // FAIL-CLOSED when NEITHER arm resolves: we are PAST the per-event
  // applicability guardrail (freeze-check: a declared subsystem;
  // transport-shield: a Bash or PowerShell command), so a gate genuinely
  // APPLIES here. Neither gate has a commit-time hard floor (unlike
  // PreWriteShield, whose fail-soft is backed by `totem-lint` at commit), so an
  // APPLICABLE gate that cannot be evaluated for ANY reason (no CLI anywhere OR
  // a broken source) must fail closed — not silently allow (guardrail rule +
  // Tenet 4 fail-closed). Fail-SOFT (exit 0) is reserved for genuinely
  // NOT-APPLICABLE inputs (unparseable/non-object envelope, no declared
  // subsystem, no shell command), all of which already returned above.
  const localCliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  let cliPath = '';
  // Which arm resolved — 'repo-local' or 'PATH' — for the provenance line the
  // fail-closed arms below disclose. Empty until one resolves.
  let arm = '';
  if (existsSync(localCliPath)) {
    cliPath = localCliPath;
    arm = 'repo-local';
  } else {
    const fromPath = resolveCliFromPath();
    if (fromPath) {
      cliPath = fromPath;
      arm = 'PATH';
    }
  }

  if (!cliPath) {
    // The exits named here must be exits the gate does NOT block: "reinstall
    // totem" and `totem eject` are Bash commands a Bash|PowerShell gate blocks
    // with this very message (mmnto-ai/totem#2822).
    process.stderr.write(
      '[totem gate] ' +
        event +
        ' applies but no totem CLI is resolvable ' +
        '(repo-local node_modules/@mmnto/cli/dist/index.js absent; no totem on PATH); ' +
        'failing closed. Exits: run pnpm install and pnpm build (or npm i -g @mmnto/cli) ' +
        'in a terminal OUTSIDE the harness, or remove this ' +
        "gate's entry from .claude/settings.json with the editor, " +
        'then re-run totem gate install ' +
        event +
        '.\n',
    );
    process.exit(2);
  }

  // The payload rides on the child's STDIN (`--payload -`), never argv: a Bash
  // command can run to tens of kilobytes and win32 caps a command line at
  // 32,767 characters — an argv payload past it fails the spawn with
  // ENAMETOOLONG and would land in the fail-closed arm below with nothing
  // broken (mmnto-ai/totem#2799, pass 3).
  const result = spawnSync(
    process.execPath,
    [cliPath, 'gate', 'check', '--event', event, '--payload', '-'],
    { encoding: 'utf-8', timeout: 30000, input: payload },
  );

  // Provenance for the PATH fallback arm (mmnto-ai/totem#2822): a CLI older
  // than 2.2.0 has no `gate check --payload -` and lands in the fail-closed
  // arms below (unknown option → non-zero exit, or nothing on stdout). The
  // BEHAVIOUR is unchanged — exit 2 either way — the line only names WHICH CLI
  // evaluated and how to update it. Empty on the repo-local arm.
  const armNote =
    arm === 'PATH'
      ? 'evaluated by the PATH CLI at ' +
        cliPath +
        "; a CLI older than 2.2.0 lacks 'gate check --payload -' — " +
        'update it: npm i -g @mmnto/cli@latest\n'
      : '';

  // ─── FAIL-CLOSED ──────────────────────────────────────────────────────
  // A gate genuinely applies (the per-event projection above found its input:
  // a declared subsystem, or a Bash/PowerShell command) and the evaluation
  // itself failed (non-zero exit: corrupt freeze.json, an invalid payload,
  // spawn error, etc.). Never silently allow when an applicable gate's source
  // is broken → exit 2. (Not-applicable envelopes already returned exit 0
  // above, so this only blocks when the gate's input was actually present.)
  if (result.error || typeof result.status !== 'number' || result.status !== 0) {
    process.stderr.write(
      '[totem gate-wrapper] gate "' +
        event +
        '" evaluation failed (source broken or unavailable) — blocking (fail-closed).\n' +
        (result.stderr || (result.error ? String(result.error.message || result.error) : '')) +
        '\n' +
        armNote,
    );
    process.exit(2);
  }

  let verdict;
  try {
    verdict = JSON.parse(result.stdout || '');
  } catch (err) {
    // The command emitted unparseable stdout despite a 0 exit — an applicable
    // gate whose verdict we cannot read is a broken source → fail-closed.
    process.stderr.write(
      '[totem gate-wrapper] gate "' + event + '" emitted unparseable verdict — blocking (fail-closed).\n' + armNote,
    );
    process.exit(2);
  }

  // ─── Disposition → host exit code (branch ONLY on disposition) ─────────
  const disposition = verdict && typeof verdict.disposition === 'string' ? verdict.disposition : '';
  // reason/provenance are OPAQUE stderr passthrough — never parsed for control flow.
  const detail =
    (verdict && verdict.reason ? verdict.reason : '') +
    (verdict && verdict.provenance ? ' [' + JSON.stringify(verdict.provenance) + ']' : '');

  if (disposition === 'allow') {
    process.exit(0);
  }
  if (disposition === 'warn') {
    process.stderr.write('[totem gate-wrapper] ' + event + ' (warn): ' + detail + '\n');
    process.exit(0);
  }
  if (disposition === 'deny') {
    process.stderr.write('[totem gate-wrapper] ' + event + ' (deny): ' + detail + '\n');
    process.exit(tier === 'pilot' ? 0 : 2);
  }

  // Unknown disposition from an applicable gate — fail-closed.
  process.stderr.write(
    '[totem gate-wrapper] gate "' + event + '" returned unknown disposition "' + disposition + '" — blocking (fail-closed).\n',
  );
  process.exit(2);
});
// [totem] end auto-generated

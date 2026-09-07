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
const { existsSync } = require('fs');
const { join } = require('path');

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

  // Resolve the LOCAL Totem CLI (the global `totem` binary may be stale and
  // missing deps — the known repo gotcha). Invoke node on the installed dist
  // entry.
  //
  // FAIL-CLOSED on a missing CLI: we are PAST the per-event applicability
  // guardrail (freeze-check: a declared subsystem; transport-shield: a Bash or
  // PowerShell command), so a gate genuinely APPLIES here. Neither gate has a
  // commit-time hard floor (unlike PreWriteShield, whose fail-soft is backed by
  // `totem-lint` at commit), so an APPLICABLE gate that cannot be evaluated
  // for ANY reason (missing CLI OR a broken source) must fail closed — not
  // silently allow (guardrail rule + Tenet 4 fail-closed). Fail-SOFT (exit 0)
  // is reserved for genuinely NOT-APPLICABLE inputs (unparseable/non-object
  // envelope, no declared subsystem, no shell command), all of which already
  // returned above.
  const cliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (!existsSync(cliPath)) {
    process.stderr.write(
      '[totem gate] ' +
        event +
        ' applies but the totem CLI is not resolvable; failing closed. ' +
        'Reinstall totem or run `totem eject` to remove the gate.\n',
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
        '\n',
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
      '[totem gate-wrapper] gate "' + event + '" emitted unparseable verdict — blocking (fail-closed).\n',
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

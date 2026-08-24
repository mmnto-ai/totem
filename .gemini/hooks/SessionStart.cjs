// [totem] auto-generated — Gemini CLI SessionStart hook
// Runs `totem describe` at the start of every Gemini CLI session to emit
// the project-orientation banner ("[Describe] Project: ... Lessons: N
// Targets: N Hooks: ..."). Matches the family-canonical pattern used by
// totem-strategy, totem-substrate, arhgap11, and totem-status, and
// matches the Claude-side SessionStart hook scaffolded by this same init
// pass (mmnto-ai/totem#1884).
const { spawnSync } = require('child_process');

// totem-status refresh-gh — GH-federation snapshot refresh (mmnto-ai/totem-status#127
// C3 residual; tracking mmnto-ai/totem#2556). Spawn-and-forget, detached+unref, and
// fired BEFORE the synchronous describe/orient briefings so it overlaps them: session
// start must never block on it (mmnto-ai/totem#2059 measured ~3s of synchronous gh
// calls here). The verb's exit-0-or-nothing contract (single-flight, atomic rename,
// no-clobber when gh is missing) makes blind firing safe. ENOENT = the sidecar is not
// adopted in this repo (the common non-cohort case) — zero noise; any other spawn
// failure keeps a non-fatal stderr breadcrumb.
// A SECOND verb rides this same block: `totem-status refresh-obligation-store`
// (mmnto-ai/totem-status#127 slice-two residual, sibling of mmnto-ai/totem#2556)
// writes the durable obligation store beside the GH snapshot, so it gets the same
// session-start moment. Same primary-checkout gate, same detached+unref spawn, same
// inherited log fd, same ENOENT-silent arm — and each firing stamps its own `verb=`
// field, so a stamp with nothing after it still reads per verb. Blind firing stays
// safe here too: that verb is in-process single-flight only, so it races the daemon
// exactly the way its manual invocation already does.
// PRIMARY checkout only (.git must be a DIRECTORY): in a linked worktree .git is a
// pointer FILE, and a detached child inheriting the worktree cwd holds a Windows
// directory lock that breaks worktree removal; the primary's hooks + the daemon
// cover the workspace-level snapshot (single-flight makes extra fires redundant).
// A non-git cwd has no refresh moment at all. The stat is cwd-anchored, not a
// walk-up: both host runtimes launch session hooks with cwd = project root, so a
// subdirectory cwd (which would skip) does not occur in practice — and adding a
// git walk would cost a synchronous process on the very path this block keeps free.
try {
  const nodePath = require('path');
  const { statSync } = require('fs');
  let primaryCheckout = false;
  try {
    primaryCheckout = statSync(nodePath.join(process.cwd(), '.git')).isDirectory();
  } catch {
    // not a git checkout (or .git unreadable) — no refresh moment here
  }
  if (primaryCheckout) {
    const { spawn } = require('child_process');
    // Observability leg (mmnto-ai/totem#2570, routed from the status seat's
    // 2026-08-03 silent no-write): under stdio:'ignore' plus the verb's
    // exit-0-or-nothing contract, a reaped or dying child leaves NO trace
    // (Windows detached is not job-object breakaway — a hook-harness
    // tree-kill takes the child mid-run). Each firing stamps a workspace-root
    // log and hands the child the same fd, so the verb's own success line
    // lands after the stamp; a stamp with nothing after it means the child
    // never finished. Log failures degrade to the previous blind firing —
    // the stamp must never block or break the spawn.
    const { openSync, closeSync, appendFileSync, existsSync, writeFileSync } = require('fs');
    // REPO-LOCAL log, inside .git (falsification round: the primary-checkout
    // gate just proved .git is a directory; never tracked, dies with the
    // clone, writable wherever git itself writes, and per-repo so concurrent
    // firings from sibling repos never interleave). A workspace-parent path
    // would grow an un-gitignorable file OUTSIDE the repo tree for every
    // consumer of these published templates — including non-adopters, whose
    // ENOENT firing still stamps.
    const logPath = nodePath.join(process.cwd(), '.git', 'totem-status-refresh-hook.log');
    // Control characters are scrubbed from path-derived fields before they
    // reach the log (terminal-injection guideline: a crafted checkout path
    // must not forge stamp lines or inject terminal controls).
    const scrub = (v) => String(v).replace(/[\x00-\x1f\x7f]/g, '?');
    let stdio = 'ignore';
    let logFd = null;
    try {
      try {
        // 1 MiB self-cap: the log truncates rather than growing forever.
        if (statSync(logPath).size > 1048576) writeFileSync(logPath, '');
      } catch {
        // no log yet — nothing to cap
      }
      appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-gh\n');
      logFd = openSync(logPath, 'a');
      stdio = ['ignore', logFd, logFd];
    } catch {
      // log unavailable — refresh still fires blind, as before
    }
    const refresh = spawn('totem-status', ['refresh-gh'], {
      detached: true,
      stdio,
    });
    refresh.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-gh\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
    });
    refresh.unref();
    // Second verb, same gate and same log fd (see the banner above). Written out
    // rather than looped so the spawn, the stamp, and the breadcrumb each carry a
    // literal verb — a reader of the generated hook (or of the log) never has to
    // resolve a variable to know which refresh fired.
    try {
      appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-obligation-store\n');
    } catch {
      // log unavailable — this verb still fires blind, exactly as the first does
    }
    const refreshStore = spawn('totem-status', ['refresh-obligation-store'], {
      detached: true,
      stdio,
    });
    refreshStore.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] gemini spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-obligation-store\n');
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write('[SessionStart] totem-status refresh-obligation-store spawn failed (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
    });
    refreshStore.unref();
    // Each child holds its own copy of the fd from spawn time; release the parent's
    // once BOTH are away (an early close would hand the second spawn an EBADF).
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // nothing to release
      }
    }
  }
} catch (err) {
  process.stderr.write('[SessionStart] totem-status refresh-gh unavailable (non-fatal): ' + (err instanceof Error ? err.message : String(err)) + '\n');
}

// ─── A.3.a: mint session ID + log session_start event ──────────
// New with mmnto-ai/totem#2468: this template never took over the A.3.a duty
// its Claude sibling carries, so Gemini-seat sessions had no session UUID and
// no session_start denominator row — the selection-manifest join key and the
// recorded-absence contract both need them. Same shape as the Claude template.
// Fire-and-forget: a ledger failure must NOT block the briefing.
let mintedSessionId = null;
try {
  const nodePath = require('path');
  const { mkdirSync, writeFileSync, appendFileSync } = require('fs');
  const { randomUUID } = require('crypto');
  const ledgerDir = nodePath.join(process.cwd(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  mintedSessionId = randomUUID();
  writeFileSync(nodePath.join(ledgerDir, '.session-id'), mintedSessionId, 'utf-8');
  const selfAgentEntry = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const event = {
    timestamp: new Date().toISOString(),
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    ...(selfAgentEntry ? { agent_source: selfAgentEntry } : {}),
    justification: '',
    session_id: mintedSessionId,
  };
  appendFileSync(nodePath.join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\n', 'utf-8');
} catch (err) {
  process.stderr.write(
    '[SessionStart] session-start telemetry unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

// Interactive Gemini ingests SessionStart CONTEXT only from the
// hookSpecificOutput.additionalContext envelope — plain exit-0 stdout wraps as
// systemMessage, which the interactive startup consumer never injects, so the
// briefing was absent from model context in the primary dev flow even once
// registered (mmnto-ai/totem#2613; leg-verified against @google/gemini-cli
// 0.54.4). systemMessage rides alongside the envelope for the human surfaces:
// interactive startup and /clear render it as a UI info item and -p echoes it
// to stderr — so the briefing is VISIBLE to the human on those surfaces and
// injected as context for the model (one payload, both audiences).
// The Totem CLI writes its banner and diagnostics to STDERR, so capture takes
// BOTH streams — the same seam the Claude-side template documents; a
// stdout-only capture silently drops the describe leg (mmnto-ai/totem#2613
// falsification round). A leg failure carries any partial stdout plus the
// fail-soft note; exit is ALWAYS 0 (never blocks boot).
// Per-leg 20s budgets cut the measured worst-case process exit from 60s to
// 40s against Gemini's 60s DEFAULT_HOOK_TIMEOUT (which tree-kills at expiry;
// no descendant inherits this hook's own streams).
let briefing = '';
try {
  const describeRun = spawnSync('totem describe', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // spawnSync sets .error (it does NOT throw) on spawn-level failure/timeout.
  briefing += describeRun.stdout || '';
  if (describeRun.error || describeRun.status !== 0) {
    const reason = describeRun.error
      ? (describeRun.error.message || String(describeRun.error))
      : ((describeRun.stderr || '').trim() || 'totem describe exited ' + describeRun.status);
    briefing += '[Totem] Briefing unavailable: ' + reason + '\n';
  } else {
    briefing += describeRun.stderr || '';
  }
} catch (err) {
  // Belt for a genuinely throwing spawnSync: same fail-soft note.
  briefing += '[Totem] Briefing unavailable: ' + (err instanceof Error ? err.message : String(err)) + '\n';
}

// Selection-manifest block boundary (mmnto-ai/totem#2468): everything in
// `briefing` up to here is the describe leg — including its fail-soft note,
// which IS injected payload when it fires.
const describeBriefingEnd = briefing.length;

// totem orient --session — live derived in-flight state, ADDITIVE to describe
// (mmnto-ai/totem#2044 PR-3). Own try/catch; orient --session is itself boot-safe.
try {
  const orientRun = spawnSync('totem orient --session', {
    shell: true,
    timeout: 20000,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  briefing += orientRun.stdout || '';
  if (orientRun.error || orientRun.status !== 0) {
    const orientReason = orientRun.error
      ? (orientRun.error.message || String(orientRun.error))
      : ((orientRun.stderr || '').trim() || 'totem orient exited ' + orientRun.status);
    // Boot-safe: orient is additive to describe; a failure never blocks session
    // start. The note rides the briefing (both keys) so the model and the human
    // both see the orient gap — a stderr-only note is invisible to the model
    // (CR round on this PR); the parent-stderr breadcrumb stays for hook
    // diagnostics.
    briefing += '[Totem] Orient briefing unavailable: ' + orientReason + '\n';
    process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + orientReason + '\n');
  } else {
    briefing += orientRun.stderr || '';
  }
} catch (err) {
  const orientMsg = err instanceof Error ? err.message : String(err);
  briefing += '[Totem] Orient briefing unavailable: ' + orientMsg + '\n';
  process.stderr.write('[SessionStart] orient briefing unavailable (non-fatal): ' + orientMsg + '\n');
}

// ─── selection manifest (mmnto-ai/totem#2468 M1) ────────────────
// Inline append mirroring the A.3.a write above — this rendered hook runs
// standalone in consumer repos with no access to @mmnto/totem's writer. The
// row shape is BOUND to SelectionManifestRowSchema (strict): change both in
// the same PR; the template contract test parses this row with the real
// schema. A zero-byte block never becomes a candidate (nothing was injected).
try {
  const nodePath = require('path');
  const { appendFileSync } = require('fs');
  const { createHash } = require('crypto');
  const measure = (id, content, reason) => {
    const bytes = Buffer.byteLength(content, 'utf-8');
    return {
      id,
      disposition: 'selected',
      reason,
      bytes,
      approxTokens: Math.ceil(bytes / 4),
      fingerprint: createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16),
    };
  };
  const selfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const row = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    emitter: 'session-start',
    ...(mintedSessionId ? { session_id: mintedSessionId } : {}),
    ...(selfAgent ? { agent_source: selfAgent } : {}),
    // mmnto-ai/totem#2629: provenance disclosed on every row (ruled item 1).
    // Self-minted row — the minting seat IS this process's env read, so the
    // core conflict probe is structurally inapplicable; only the two-value
    // provenance enum rides. Mirrors senseAgentAttribution's biconditional.
    agent_source_provenance: selfAgent ? 'env' : 'absent',
    context: { template: 'gemini-managed' },
    universe: 'managed-template blocks: describe + orient --session',
    costBasis: { bytes: 'utf8-length', approxTokens: 'ceil(bytes/4) approximation' },
    candidates: [
      measure('describe', briefing.slice(0, describeBriefingEnd), 'always-injected briefing'),
      measure('orient:session-block', briefing.slice(describeBriefingEnd), 'always-injected briefing'),
    ].filter((c) => c.bytes > 0),
    warnings: [],
  };
  appendFileSync(
    nodePath.join(process.cwd(), '.totem', 'ledger', 'selection-manifests.ndjson'),
    JSON.stringify(row) + '\n',
    'utf-8',
  );
} catch (err) {
  process.stderr.write(
    '[SessionStart] selection manifest unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

process.stdout.write(JSON.stringify({
  systemMessage: briefing,
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing },
}) + '\n');
// [totem] end auto-generated

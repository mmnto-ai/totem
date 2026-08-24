// [totem] auto-generated — Claude Code SessionStart hook
// Runs `@mmnto/cli describe` at the start of every Claude Code session.
// Mirrors `.gemini/hooks/SessionStart.cjs`. `.cjs` extension because
// package.json may have "type": "module" — Claude Code execs hooks via
// plain `node`, which would otherwise treat `.js` as ESM.
//
// A.3.a: mints a session UUID, persists to .totem/ledger/.session-id,
// and appends a `session_start` event to .totem/ledger/events.ndjson
// BEFORE running `totem describe`. Subsequent MCP calls within the
// session correlate via session_id (ADR-029 § Session Heuristic).
// Fire-and-forget: any ledger failure must NOT block the briefing.
const { spawnSync } = require('child_process');
const { existsSync, mkdirSync, writeFileSync, appendFileSync } = require('fs');
const { randomUUID } = require('crypto');
const { join } = require('path');

// ─── A.3.a: mint session ID + log session_start event ──────────
// Hoisted so the selection-manifest row below (mmnto-ai/totem#2468) can carry
// the same session UUID as its join key.
let mintedSessionId = null;
try {
  const ledgerDir = join(process.cwd(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const sessionId = randomUUID();
  mintedSessionId = sessionId;
  writeFileSync(join(ledgerDir, '.session-id'), sessionId, 'utf-8');
  // Amended ADR-078 (2026-07-15): agent_source is the env-carried seat-id
  // (TOTEM_SELF_AGENT, first non-empty comma entry), never a vendor class
  // ('claude' has no reverse projection to a seat). Omitted entirely when
  // the env var is absent: stamp absence, never guess (Tenet 4). The parse
  // deliberately mirrors deriveSearchLogAttribution (packages/mcp/src/
  // search-log.ts) and parseEnvAgentList (packages/core/src/
  // orchestration-resolver.ts) — inlined because this rendered .cjs hook
  // runs standalone in consumer repos with no access to those modules; if
  // the shared parse semantics change, change this template in the same PR.
  const selfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const event = {
    timestamp: new Date().toISOString(),
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    ...(selfAgent ? { agent_source: selfAgent } : {}),
    justification: '',
    session_id: sessionId,
  };
  appendFileSync(join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\n', 'utf-8');
} catch (err) {
  // Fire-and-forget; ledger failures must not block the briefing. A lightweight
  // stderr breadcrumb makes hook misconfigurations diagnosable in consumer repos
  // (CR R1 catch — empty catch suppresses all signal). stderr (not stdout) so
  // the briefing path remains clean for Claude's prompt context.
  process.stderr.write(
    '[SessionStart] Session-start telemetry unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

// ─── totem-status refresh-gh — GH-federation snapshot refresh ───
// (mmnto-ai/totem-status#127 C3 residual; tracking mmnto-ai/totem#2556.)
// Spawn-and-forget, detached+unref, fired BEFORE the synchronous describe/orient
// briefings so it overlaps them: session start must never block on it
// (mmnto-ai/totem#2059 measured ~3s of synchronous gh calls here). The verb's
// exit-0-or-nothing contract (single-flight, atomic rename, no-clobber when gh
// is missing) makes blind firing safe. ENOENT = the sidecar is not adopted in
// this repo (the common non-cohort case) — zero noise; any other spawn failure
// keeps a non-fatal stderr breadcrumb.
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
      appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-gh\n');
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
        appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-gh\n');
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
      appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn cwd=' + scrub(process.cwd()) + ' path-has-go-bin=' + /go[\\/]bin/i.test(process.env.PATH || '') + ' cwd-shadow-exe=' + existsSync(nodePath.join(process.cwd(), 'totem-status.exe')) + ' verb=refresh-obligation-store\n');
    } catch {
      // log unavailable — this verb still fires blind, exactly as the first does
    }
    const refreshStore = spawn('totem-status', ['refresh-obligation-store'], {
      detached: true,
      stdio,
    });
    refreshStore.on('error', (err) => {
      try {
        appendFileSync(logPath, '[' + new Date().toISOString() + '] claude spawn-error code=' + ((err && err.code) || 'unknown') + ' verb=refresh-obligation-store\n');
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

// ─── totem describe briefing (existing behavior) ────────────────
// Captured (mmnto-ai/totem#2468): the injected block is the selection-manifest
// candidate below — the not-installed notice is a notice, not a briefing.
let describeText = '';
try {
  const cliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (existsSync(cliPath)) {
    const result = spawnSync(process.execPath, [cliPath, 'describe'], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    if (result.error) {
      throw result.error;
    }
    // Totem CLI writes diagnostic output to stderr; route to stdout so the
    // session-start context lands in Claude's prompt rather than user-visible noise.
    describeText = (result.stdout || '') + (result.stderr || '');
    process.stdout.write(describeText);
  } else {
    process.stdout.write(
      '[Totem] @mmnto/cli not installed. Run `pnpm install` (or your package manager equivalent) to enable session-start orientation.\n',
    );
  }
} catch (err) {
  process.stdout.write(
    '[Totem] Briefing unavailable: ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

// ─── totem orient --session — live derived in-flight state (mmnto-ai/totem#2044 PR-3) ──
// ADDITIVE to describe (Tenet 13: describe = static identity sensor — scope/tier/
// counts; orient = live in-flight sensor — open PRs/issues/board/freeze). Append,
// never replace. Its OWN try/catch so an orient failure never disturbs the describe
// briefing or the boot; `orient --session` is itself boot-safe (emits nothing when
// nothing is high-signal, never exits non-zero, degrades to honest "could not derive").
let orientText = '';
try {
  const orientCliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  if (existsSync(orientCliPath)) {
    const orientResult = spawnSync(process.execPath, [orientCliPath, 'orient', '--session'], {
      encoding: 'utf-8',
      timeout: 30000,
    });
    // spawnSync sets .error (it does NOT throw) on a spawn-level failure; re-throw so
    // it surfaces through the catch breadcrumb below rather than writing '' silently.
    if (orientResult.error) {
      throw orientResult.error;
    }
    orientText = (orientResult.stdout || '') + (orientResult.stderr || '');
    process.stdout.write(orientText);
  }
} catch (err) {
  // Boot-safe: orient is additive to describe (already emitted), so a failure never
  // blocks session start — but surface a NON-fatal breadcrumb to stderr (not stdout,
  // to keep the prompt clean) for debuggability rather than swallowing silently.
  process.stderr.write(
    '[SessionStart] orient briefing unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

// ─── selection manifest (mmnto-ai/totem#2468 M1) ────────────────
// Inline append mirroring the session_start write above — this rendered hook
// runs standalone in consumer repos with no access to @mmnto/totem's writer.
// The row shape is BOUND to SelectionManifestRowSchema (strict): change both
// in the same PR; the template contract test parses this row with the real
// schema. A zero-byte block never becomes a candidate (nothing was injected).
try {
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
    context: { template: 'claude-managed' },
    universe: 'managed-template blocks: describe + orient --session',
    costBasis: { bytes: 'utf8-length', approxTokens: 'ceil(bytes/4) approximation' },
    candidates: [
      measure('describe', describeText, 'always-injected briefing'),
      measure('orient:session-block', orientText, 'always-injected briefing'),
    ].filter((c) => c.bytes > 0),
    warnings: [],
  };
  appendFileSync(
    join(process.cwd(), '.totem', 'ledger', 'selection-manifests.ndjson'),
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
// [totem] end auto-generated

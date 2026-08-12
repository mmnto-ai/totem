/**
 * `totem seat add | suspend | remove | list` — the declared seat-lifecycle
 * verbs (mmnto-ai/totem#2511 slice 2).
 *
 * Seat EXISTENCE stays dir-derived (the mmnto-ai/totem#2141 dirs-union
 * invariant): these verbs do not mint a second registration surface. What they
 * add is the DECLARED half — an `active | suspended | retired` marker written
 * by an operator word, which downstream consumers (broadcast denominators,
 * annotations, the totem-status#127 session projection) read. Session state
 * (`LIVE/IDLE/FAULTED`) is a different axis and never appears here.
 *
 * Two disciplines run through every verb:
 *   - **Emit, never apply.** A seat's birth and retirement touch surfaces this
 *     binary cannot reach honestly — vendor hook files (mmnto-ai/totem#2612 is
 *     the live tracked-file-mutation bug class), `totem-status`'s
 *     `agentHomeMap`, the mmnto-ai/totem-strategy#611-frozen `eclCohortRepos`,
 *     four prose copies of the signoff seat table, the strategy-owned parity
 *     manifest. Every one of them is printed as a checklist line and NONE of
 *     them is written.
 *   - **Nothing is deleted.** `seat remove` writes a `retired` tombstone and
 *     leaves the outbox, processed marks, and journals exactly where they are;
 *     retention policy is mmnto-ai/totem#2518's lane. Lifecycle transitions
 *     also never discharge an obligation — that is an explicit disposition
 *     with provenance (mmnto-ai/totem-status#127).
 *
 * All human output goes to STDOUT as one stream. The product of these verbs is
 * a report an operator acts on and pipes (`totem seat add x > wiring.txt`), so
 * splitting it across stdout/stderr would hand over a checklist with holes in
 * it. Failures still travel as `TotemError` to the index.ts error boundary,
 * which prints them on stderr and sets a non-zero exit.
 *
 * The marker schema lives in core (`seat-lifecycle.ts`) and is never redefined
 * here: this layer composes markers and hands them to `writeSeatLifecycle`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { SeatLifecycleMarker, SeatLifecycleState, SeatStatus } from '@mmnto/totem';

// ─── Constants ──────────────────────────────────────────

const TOTEM_DIR = '.totem';
const ORCHESTRATION_DIR = 'orchestration';

/** The optional `host_agents` override file (`ConfigSchema.passthrough()`). */
const CONFIG_FILENAME = 'config.json';
const HOST_AGENTS_KEY = 'host_agents';

/** The three per-seat coordination subdirs a birth creates (ADR-106 § 3). */
const SEAT_SUBDIRS = ['outbox', 'processed', 'journal'] as const;

/**
 * Env var whose FIRST usable entry attributes a transition. Unset (or holding
 * nothing usable) means the marker's `by` is honestly ABSENT — a stamped
 * absence, never a fabricated attribution (the mmnto-ai/totem#2625 MB-2 rule).
 */
const SELF_AGENT_ENV_VAR = 'TOTEM_SELF_AGENT';

/** Width of the `──` rules that delimit an emitted checklist block. */
const RULE_WIDTH = 74;

/** Column floors for the `seat list` table, so headers never collapse. */
const LIST_COLUMN_MIN_WIDTHS = { seat: 4, state: 5, since: 5, source: 6 } as const;

/** Placeholder for a column with nothing to render (a markerless seat). */
const EMPTY_CELL = '—';

// ─── Types ──────────────────────────────────────────────

/**
 * The core barrel, imported dynamically inside each command
 * (mmnto-ai/totem#2339) so `totem --help` stays cold-start cheap. Only types
 * cross the boundary statically — erased at build.
 */
type Core = typeof import('@mmnto/totem');

interface SeatCommandSeams {
  /** Test seam — production callers use `process.cwd()`. */
  cwdForTest?: string;
  /** Test seam — production callers use `process.env`. */
  envForTest?: NodeJS.ProcessEnv;
  /** Test seam — pins the marker's `since`. */
  nowForTest?: string;
}

export interface SeatAddOptions extends SeatCommandSeams {
  /** Transition an existing SUSPENDED seat back to `active`. Nothing else. */
  reactivate?: boolean;
}

export interface SeatSuspendOptions extends SeatCommandSeams {
  /** The operator's recorded ruling — the §6.6 audit trail when present. */
  reason?: string;
}

export interface SeatRemoveOptions extends SeatCommandSeams {
  reason?: string;
}

export interface SeatListOptions extends SeatCommandSeams {
  json?: boolean;
}

/** How the `host_agents` merge resolved — reported, never implicit. */
type ConfigMergeStatus = 'absent' | 'appended' | 'already-present' | 'no-host-agents-key';

interface ConfigMergeOutcome {
  status: ConfigMergeStatus;
  configPath: string;
}

// ─── Local helpers ──────────────────────────────────────

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One `process.stdout.write` per block, so a report never interleaves. */
function emit(lines: readonly string[]): void {
  process.stdout.write(lines.join('\n') + '\n');
}

function rule(): string {
  return '─'.repeat(RULE_WIDTH);
}

/**
 * `throwIfNoEntry: false` suppresses ENOENT only; any OTHER stat failure
 * (EACCES, ENOTDIR, ELOOP) is rethrown as a TotemError naming the path — a
 * permission wall must fail loud, never read as "seat does not exist" (a
 * false-unknown would route the operator to `seat add` on a tree they cannot
 * even stat).
 */
function directoryExists(target: string, TotemErrorCtor: Core['TotemError']): boolean {
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(target, { throwIfNoEntry: false });
    // totem-context: intentional rethrow-as-TotemError — non-ENOENT stat failures must surface loudly with the path, not degrade to "not a directory here".
  } catch (err) {
    throw new TotemErrorCtor(
      'CHECK_FAILED',
      `cannot stat ${target}: ${String(err)}`,
      'check permissions on the .totem/orchestration tree.',
      err,
    );
  }
  return stat !== undefined && stat.isDirectory();
}

/**
 * The acting seat for a marker's `by`: the SINGLE usable `TOTEM_SELF_AGENT`
 * entry, or `undefined`. Never a guess — an unset env records the transition
 * without attribution, and a MULTI-seat env list is ambiguous, so under the
 * stamped-absence rule (#2625 MB-2) it also records absence: "the first entry"
 * is no evidence that seat ran the verb.
 */
function resolveActingSeat(
  env: NodeJS.ProcessEnv,
  isSafe: (id: string) => boolean,
): { by: string | undefined; ambiguous: boolean; setButUnusable: boolean } {
  const raw = env[SELF_AGENT_ENV_VAR];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { by: undefined, ambiguous: false, setButUnusable: false };
  }
  const usable = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(isSafe);
  if (usable.length === 1) return { by: usable[0], ambiguous: false, setButUnusable: false };
  // Distinct absences (re-arm P-3): a SET-but-unusable env must not render as
  // "not set" — a false fact about the environment inside a feature whose
  // thesis is stamped absence over invention.
  return { by: undefined, ambiguous: usable.length > 1, setButUnusable: usable.length === 0 };
}

/** One-line disclosure when ambiguity (not absence) caused the `by` omission. */
function attributionNote(acting: { ambiguous: boolean }): string[] {
  return acting.ambiguous
    ? [
        `  · by omitted: ${SELF_AGENT_ENV_VAR} lists multiple seats — the marker records`,
        '    stamped absence rather than a guess at which one acted.',
      ]
    : [];
}

/** `state · since · by · reason` for a one-line marker echo. */
function describeMarker(marker: SeatLifecycleMarker): string {
  const parts = [`state ${marker.state}`, `since ${marker.since}`];
  parts.push(marker.by === undefined ? 'by (not recorded)' : `by ${marker.by}`);
  if (marker.reason !== undefined) parts.push(`reason ${JSON.stringify(marker.reason)}`);
  return parts.join(' · ');
}

// ─── Shared prose ───────────────────────────────────────

/**
 * Lifecycle never closes an obligation edge. Printed by both exclusion verbs
 * because the whole failure this feature is aimed at is a seat that stops
 * answering while its obligations quietly look discharged.
 */
const OBLIGATIONS_NOTE = [
  '  · Open obligations held by this seat are NOT discharged. A lifecycle',
  '    transition is not a disposition — dispose of each edge explicitly, with',
  '    provenance, per mmnto-ai/totem-status#127.',
];

// ─── Core-bound helpers ─────────────────────────────────

/**
 * Every helper that touches a core VALUE lives behind this factory and closes
 * over the one dynamically-imported barrel instance (a static value import
 * would defeat the lazy-loading contract). Bodies are otherwise ordinary
 * module helpers — the factory exists only to carry `core`.
 */
function coreHelpers(core: Core) {
  const {
    deriveSeatStatuses,
    isPathSafeAgentId,
    readSeatLifecycle,
    resolveTotemRepoRootSync,
    sanitizeForTerminal,
    SEAT_LIFECYCLE_SCHEMA_VERSION,
    TotemConfigError,
    TotemError,
    writeFileAtomicSync,
  } = core;

  /**
   * Repo roots and error text originate outside this process: sanitize and
   * flatten before any terminal write so embedded ANSI or newlines cannot
   * forge extra report lines (the `wt.ts` render precedent). Seat ids are
   * already through `isPathSafeAgentId`, which excludes control characters and
   * whitespace outright.
   */
  function render(text: string): string {
    return sanitizeForTerminal(text)
      .replace(/[\t\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }

  /** One guard for every verb — no second seat-id validator exists. */
  function requireSafeSeatId(verb: string, seatId: string): void {
    if (!isPathSafeAgentId(seatId)) {
      throw new TotemConfigError(
        `seat ${verb}: invalid seat id ${JSON.stringify(seatId)}`,
        'A seat id is a single path segment: no separators, `..`, null byte, control/whitespace, or win32-reserved characters. Example: totem-claude',
        'CONFIG_INVALID',
      );
    }
  }

  /**
   * Walk-start, not definitive root (the `resolveTotemRepoRootSync` contract):
   * a seat verb run from inside `.totem/orchestration/<seat>/journal/` must
   * still resolve the repo, not the subdir.
   */
  function repoRootFor(options: SeatCommandSeams): string {
    return resolveTotemRepoRootSync(undefined, options.cwdForTest ?? process.cwd());
  }

  function seatDirFor(repoRoot: string, seatId: string): string {
    return path.join(repoRoot, TOTEM_DIR, ORCHESTRATION_DIR, seatId);
  }

  function configPathFor(repoRoot: string): string {
    return path.join(repoRoot, TOTEM_DIR, ORCHESTRATION_DIR, CONFIG_FILENAME);
  }

  /** Every registered seat with its state, for an unknown-seat error. */
  function knownSeatLabels(repoRoot: string): string[] {
    return deriveSeatStatuses(repoRoot).map((status) => `${status.seat} (${status.state})`);
  }

  /**
   * `suspend`/`remove` refuse an unknown seat and LIST what exists — a typo'd
   * id must never mint a marker for a seat nobody has.
   */
  function requireKnownSeat(verb: string, repoRoot: string, seatId: string): void {
    if (directoryExists(seatDirFor(repoRoot, seatId), TotemError)) return;
    const known = knownSeatLabels(repoRoot);
    throw new TotemConfigError(
      `seat ${verb}: unknown seat "${seatId}" — no seat directory at ${render(seatDirFor(repoRoot, seatId))}`,
      known.length === 0
        ? 'No seats are registered in this repo yet (the dirs ARE the roster — mmnto-ai/totem#2141). Register one with `totem seat add <seat-id>`.'
        : `Known seats: ${known.join(', ')}. Register a new seat with \`totem seat add <seat-id>\`.`,
      'CONFIG_INVALID',
    );
  }

  /**
   * Compose a marker. `by` and `reason` are omitted rather than nulled — the
   * core schema is `.strict()`, and an absent field is the honest shape for
   * "nothing was recorded".
   */
  function buildMarker(
    state: SeatLifecycleState,
    since: string,
    by: string | undefined,
    reason: string | undefined,
  ): SeatLifecycleMarker {
    return {
      schemaVersion: SEAT_LIFECYCLE_SCHEMA_VERSION,
      state,
      since,
      ...(by === undefined ? {} : { by }),
      ...(reason === undefined ? {} : { reason }),
    };
  }

  /**
   * Read a seat's declared state plus the degraded-read warning, if any. The
   * read never throws (core's fail-open contract), so a corrupt marker reads
   * as `active` and the warning is surfaced to the operator verbatim.
   */
  function readState(
    repoRoot: string,
    seatId: string,
  ): { state: SeatLifecycleState; since?: string; warning?: string } {
    const read = readSeatLifecycle(repoRoot, seatId);
    return {
      state: read.state,
      ...(read.marker === undefined ? {} : { since: read.marker.since }),
      ...(read.warning === undefined ? {} : { warning: read.warning }),
    };
  }

  /**
   * Append the seat to `host_agents` in an EXISTING `config.json`, preserving
   * every existing entry and every unknown passthrough key (core's
   * `ConfigSchema` is `.passthrough()`, and other consumers keep their own keys
   * in this file). The file is never CREATED here: a repo without one resolves
   * its roster from dirs ∪ map, and minting the file would replace that.
   *
   * The same reasoning is why a config that exists WITHOUT a `host_agents` key
   * is left alone: the key has REPLACE semantics
   * (`orchestration-resolver.ts:374-399`), so writing `[<new seat>]` into a
   * config that had none would suppress every other present seat. That is the
   * silent-unbind class the resolver already warns about, and it is not this
   * verb's call to make — the situation is reported instead.
   */
  function mergeHostAgents(repoRoot: string, seatId: string): ConfigMergeOutcome {
    const configPath = configPathFor(repoRoot);
    if (!fs.existsSync(configPath)) return { status: 'absent', configPath };

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TotemError(
        'CONFIG_INVALID',
        `${render(configPath)} is not a JSON object`,
        'Repair the file by hand (it must be a JSON object with an optional `host_agents` array), then re-run.',
      );
    }

    const record = parsed as Record<string, unknown>;
    const existing = record[HOST_AGENTS_KEY];
    if (existing === undefined) return { status: 'no-host-agents-key', configPath };
    if (!Array.isArray(existing) || existing.some((entry) => typeof entry !== 'string')) {
      throw new TotemError(
        'CONFIG_INVALID',
        `${render(configPath)} has a ${HOST_AGENTS_KEY} field that is not an array of strings`,
        'Repair `host_agents` by hand (it is `string[]`), then re-run — the verb refuses to rewrite a shape it cannot preserve.',
      );
    }
    if (existing.includes(seatId)) return { status: 'already-present', configPath };

    // Spread-then-overwrite keeps every unknown key AND the original key order
    // (an existing `host_agents` stays in place rather than moving to the end).
    const merged: Record<string, unknown> = {
      ...record,
      [HOST_AGENTS_KEY]: [...existing, seatId],
    };
    writeFileAtomicSync(configPath, JSON.stringify(merged, null, 2) + '\n');
    return { status: 'appended', configPath };
  }

  return {
    render,
    requireSafeSeatId,
    repoRootFor,
    seatDirFor,
    configPathFor,
    knownSeatLabels,
    requireKnownSeat,
    buildMarker,
    readState,
    mergeHostAgents,
  };
}

// ─── Emitted checklists (never applied) ─────────────────

/**
 * The birth checklist. Every line names a surface this binary deliberately
 * does not touch, and says who must. The poll-wiring block is first because a
 * seat that is registered but never polls looks alive and answers nothing —
 * the cohort-roles §6.6 poll-asymmetry class this issue exists for.
 */
function birthChecklist(seatId: string): string[] {
  return [
    rule(),
    ` seat add: ${seatId} — birth checklist (EMITTED, NOT APPLIED)`,
    rule(),
    'Nothing below was written for you. These verbs never edit a vendor hook',
    'file or a foreign surface (mmnto-ai/totem#2612 is the live tracked-file',
    'mutation bug class) — each line is a surface a human or the owning seat',
    'must reach.',
    '',
    '1. POLL WIRING — the seat must actually receive mail.',
    '   · claude seats: a SessionStart hook surface exists — install it with',
    '     `totem hooks` (legacy alias: `totem install-hooks`) in the seat’s own',
    '     harness config; the session briefing carries the `totem mail` poll.',
    '   · gemini seats: same install path, the `.gemini/` SessionStart surface.',
    '   · codex / kimi / agy seats: NO hook surface exists at all. Wire the poll',
    '     into the seat’s prompt or runbook instead — run `totem mail` from the',
    `     repo ROOT with ${SELF_AGENT_ENV_VAR}=${seatId} in the environment.`,
    '   A seat that is registered but never polls is the poll-asymmetry failure',
    '   (cohort-roles §6.6): it looks alive and answers nothing.',
    '',
    '2. totem-status `orchestration.go` — add the seat to `agentHomeMap` (the',
    '   projection’s seat → home-repo binding). Not reachable from this repo.',
    '',
    '3. totem-status `eclCohortRepos` — the set is FROZEN by',
    '   mmnto-ai/totem-strategy#611. EMITTED, NEVER WRITTEN: do not edit the',
    '   frozen set here or anywhere; route any change through the #611 ruling.',
    '',
    '4. The four signoff seat-table copies (prose rows, not derived state):',
    '   · .claude/skills/signoff/SKILL.md',
    '   · .agents/skills/signoff/SKILL.md',
    '   · .gemini/skills/signoff.md',
    '   · packages/cli/src/commands/init-templates.ts — SIGNOFF_SKILL_CONTENT,',
    '     the PUBLISHED template every `totem init` consumer receives.',
    '   A parity test locks three of the four against each other (CI fails on',
    '   drift); the .gemini copy has NO mechanical lock — check it explicitly.',
    '',
    '5. Strategy lane — parity-manifest row candidate for this seat. The',
    '   manifest is strategy-owned; this verb never adds a row. File it there.',
    rule(),
  ];
}

/**
 * The retirement counterpart: the same foreign surfaces, in the removal
 * direction. Emitted only — a retired seat's rows are removed by the people
 * who own those files.
 */
function deregistrationChecklist(seatId: string, configLine: string): string[] {
  return [
    rule(),
    ` seat remove: ${seatId} — deregistration checklist (EMITTED, NOT APPLIED)`,
    rule(),
    '1. totem-status `orchestration.go` — remove the seat from `agentHomeMap`.',
    '',
    '2. The four signoff seat-table copies (update them together):',
    '   · .claude/skills/signoff/SKILL.md',
    '   · .agents/skills/signoff/SKILL.md',
    '   · .gemini/skills/signoff.md',
    '   · packages/cli/src/commands/init-templates.ts — SIGNOFF_SKILL_CONTENT',
    '',
    `3. ${configLine}`,
    '',
    '4. totem-status `eclCohortRepos` is FROZEN (mmnto-ai/totem-strategy#611) —',
    '   named here for completeness; route any change through the #611 ruling,',
    '   never by editing the frozen set.',
    rule(),
  ];
}

// ─── add ────────────────────────────────────────────────

/**
 * Register a seat: three coordination subdirs, an `active` marker, and — only
 * where a `config.json` already exists — the `host_agents` append. Then emit
 * the birth checklist for everything this binary cannot reach.
 *
 * An existing seat is a hard error, not an overwrite: `--reactivate` is the
 * only way back in, and it moves ONLY `suspended → active`. A `retired` seat
 * is never resurrected here — retirement was an operator word, so resurrection
 * must be one too (the Phase-4 gate ruling, OQ1).
 */
export async function seatAddCommand(seatId: string, options: SeatAddOptions = {}): Promise<void> {
  const core = await import('@mmnto/totem');
  const { isPathSafeAgentId, resolveOrchestrationPaths, TotemConfigError, TotemError } = core;
  const {
    render,
    requireSafeSeatId,
    repoRootFor,
    seatDirFor,
    buildMarker,
    readState,
    mergeHostAgents,
  } = coreHelpers(core);

  requireSafeSeatId('add', seatId);

  const env = options.envForTest ?? process.env;
  const since = options.nowForTest ?? new Date().toISOString();
  const repoRoot = repoRootFor(options);
  const seatDir = seatDirFor(repoRoot, seatId);
  const current = readState(repoRoot, seatId);
  const markerPresent = fs.existsSync(path.join(seatDir, core.SEAT_LIFECYCLE_FILENAME));
  const acting = resolveActingSeat(env, isPathSafeAgentId);
  const by = acting.by;

  if (directoryExists(seatDir, TotemError) || markerPresent) {
    if (options.reactivate !== true) {
      throw new TotemConfigError(
        `seat add: "${seatId}" already exists in ${render(repoRoot)} — current state: ${current.state}`,
        current.state === 'suspended'
          ? `Reactivate it with \`totem seat add ${seatId} --reactivate\`, or pick a different seat id.`
          : current.state === 'retired'
            ? 'The seat is retired: retirement was an operator word; resurrection needs a fresh ruling — file a new seat or route to the operator.'
            : 'The seat is already active — there is nothing to add. Pick a different seat id.',
        'CONFIG_INVALID',
      );
    }
    if (current.state === 'retired') {
      throw new TotemConfigError(
        `seat add --reactivate: refusing to resurrect retired seat "${seatId}"`,
        'Refused: retirement was an operator word; resurrection needs a fresh ruling — file a new seat or route to the operator.',
        'CONFIG_INVALID',
      );
    }
    if (current.state !== 'suspended') {
      throw new TotemConfigError(
        `seat add --reactivate: "${seatId}" is already ${current.state} — --reactivate transitions only suspended → active`,
        current.warning === undefined
          ? 'Nothing to do. Check `totem seat list` for the current declared state of every seat.'
          : `The seat reads as active because its marker could not be used: ${render(current.warning)}`,
        'CONFIG_INVALID',
      );
    }

    const marker = buildMarker('active', since, by, undefined);
    const markerPath = core.writeSeatLifecycle(repoRoot, seatId, marker);
    emit([
      `Seat reactivated: ${seatId} (suspended → active)`,
      `  marker: ${render(markerPath)}`,
      `  ${describeMarker(marker)}`,
      '',
      'Effects',
      '  · The seat re-enters broadcast required-sets and round denominators on',
      '    the very next poll — markers are read fresh, never cached.',
      '  · Its dirs, outbox, processed marks, and journals were untouched.',
      ...attributionNote(acting),
      ...(current.warning === undefined ? [] : ['', `warning: ${render(current.warning)}`]),
    ]);
    return;
  }

  // --reactivate on a seat that does not exist must not silently fall through
  // to the birth path — the flag would change meaning (falsification finding
  // 11 on this branch): reactivation is a transition on an EXISTING seat.
  if (options.reactivate === true) {
    throw new TotemConfigError(
      `seat add --reactivate: unknown seat "${seatId}" — there is nothing to reactivate`,
      'The flag transitions suspended → active on an existing seat. Register a new seat by running `totem seat add` without --reactivate.',
      'CONFIG_INVALID',
    );
  }

  // ── New seat ──
  const completed: string[] = [];
  for (const subdir of SEAT_SUBDIRS) {
    const target = path.join(seatDir, subdir);
    // totem-context: intentional rethrow-as-TotemError — a seat-dir path occupied by a FILE (ENOTDIR) or a permission wall must fail loud with the path (re-arm P-4), never as a raw fs error one call after the directoryExists guard.
    try {
      fs.mkdirSync(target, { recursive: true });
    } catch (err) {
      throw new TotemError(
        'CHECK_FAILED',
        `seat add: cannot create ${render(target)}: ${String(err)}`,
        'Check that the .totem/orchestration path is a writable directory tree (a file squatting on the seat path must be moved aside).',
        err,
      );
    }
  }

  // Verify through the resolver rather than trusting the mkdir calls: the
  // resolver is what every consumer reads the tree through, so its answer is
  // the one that counts (`source: 'none'` means the seat is not registered).
  const paths = resolveOrchestrationPaths(repoRoot, seatId);
  if (
    paths.source !== 'orchestration' ||
    paths.outbox === null ||
    paths.processed === null ||
    paths.journal === null
  ) {
    throw new TotemError(
      'CHECK_FAILED',
      `seat add: created ${render(seatDir)} but the orchestration resolver does not see a complete tree (outbox/processed/journal)`,
      'Check permissions on the .totem/orchestration directory and re-run — directory creation is idempotent.',
    );
  }
  completed.push(`created ${SEAT_SUBDIRS.length} subdir(s) under ${render(seatDir)}`);

  const marker = buildMarker('active', since, by, undefined);
  const markerPath = core.writeSeatLifecycle(repoRoot, seatId, marker);
  completed.push(`wrote ${render(markerPath)}`);

  let merge: ConfigMergeOutcome;
  // totem-context: intentional cleanup — the dirs and the marker already landed, so a config failure must report COMPLETED vs FAILED steps (the #2511 failure table) instead of a bare I/O error; the cause is attached and nothing is swallowed.
  try {
    merge = mergeHostAgents(repoRoot, seatId);
    // totem-context: intentional cleanup — see directive above the try; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
  } catch (err) {
    throw new TotemError(
      'CHECK_FAILED',
      `seat add: the seat was created but ${CONFIG_FILENAME} could not be updated: ${render(describe(err))} — completed: ${completed.join('; ')}; FAILED: ${HOST_AGENTS_KEY} merge`,
      'Fix the config file by hand (add the seat to `host_agents`) or re-run `totem seat add` — dir creation and the config merge are both idempotent.',
      err,
    );
  }

  const configLines: string[] = [];
  if (merge.status === 'appended') {
    configLines.push(`  · ${HOST_AGENTS_KEY} in ${render(merge.configPath)}: appended ${seatId}`);
  } else if (merge.status === 'already-present') {
    configLines.push(
      `  · ${HOST_AGENTS_KEY} in ${render(merge.configPath)}: already listed — left unchanged`,
    );
  } else if (merge.status === 'no-host-agents-key') {
    configLines.push(
      `  · ${render(merge.configPath)} exists but declares no ${HOST_AGENTS_KEY} — left unchanged.`,
      `    ${HOST_AGENTS_KEY} REPLACES the derived roster, so minting it with one seat`,
      '    would suppress every other present seat. The new seat is registered by',
      '    its dir either way (mmnto-ai/totem#2141).',
    );
  } else {
    configLines.push(
      `  · no ${CONFIG_FILENAME} in this repo — none was created`,
      `    (looked at ${render(merge.configPath)}). Seat registration is`,
      '    dir-derived (mmnto-ai/totem#2141); the file is an override, not a',
      '    registry.',
    );
  }

  emit([
    `Seat added: ${seatId}`,
    `  dirs:   ${render(seatDir)} (${SEAT_SUBDIRS.join(', ')})`,
    `  marker: ${render(markerPath)}`,
    `  ${describeMarker(marker)}`,
    ...configLines,
    // Distinct absence disclosures (finding 7 + re-arm P-3): ambiguous
    // multi-seat env / set-but-unusable env / genuinely unset — each states
    // the true reason, never "not set" for an env that IS set.
    ...(acting.ambiguous
      ? [...attributionNote(acting), '']
      : acting.setButUnusable
        ? [
            `  · by omitted: ${SELF_AGENT_ENV_VAR} is set but no entry is a usable seat id —`,
            '    the marker records stamped absence rather than a fabricated attribution.',
            '',
          ]
        : by === undefined
          ? [
              `  · ${SELF_AGENT_ENV_VAR} is not set, so the marker records no \`by\` —`,
              '    a stamped absence rather than a fabricated attribution.',
              '',
            ]
          : ['']),
    ...birthChecklist(seatId),
  ]);
}

// ─── suspend ────────────────────────────────────────────

/**
 * Declare a seat suspended: it leaves broadcast required-sets and round
 * denominators, while its directed mail keeps surfacing (the gate ruling, OQ4
 * — suspension excludes a seat from the count, it never hides its mail).
 *
 * Already-suspended is a no-op success with no rewrite: re-running the verb
 * must not overwrite the ORIGINAL `since`, which is the audit trail's anchor.
 */
export async function seatSuspendCommand(
  seatId: string,
  options: SeatSuspendOptions = {},
): Promise<void> {
  const core = await import('@mmnto/totem');
  const { isPathSafeAgentId, TotemConfigError } = core;
  const { render, requireSafeSeatId, repoRootFor, requireKnownSeat, buildMarker, readState } =
    coreHelpers(core);

  requireSafeSeatId('suspend', seatId);

  const env = options.envForTest ?? process.env;
  const since = options.nowForTest ?? new Date().toISOString();
  const repoRoot = repoRootFor(options);
  requireKnownSeat('suspend', repoRoot, seatId);

  const current = readState(repoRoot, seatId);
  if (current.state === 'suspended') {
    emit([
      `Seat ${seatId} is already suspended since ${current.since ?? 'an unrecorded instant'} — nothing was rewritten.`,
      '  Re-running the verb would replace the original `since`, which is the',
      '  anchor of the recorded-ruling audit trail (cohort-roles §6.6).',
    ]);
    return;
  }
  if (current.state === 'retired') {
    throw new TotemConfigError(
      `seat suspend: "${seatId}" is retired — a retired seat cannot be suspended`,
      'Retirement is the terminal declared state; nothing further is owed here. If the seat must come back, that is a fresh operator ruling.',
      'CONFIG_INVALID',
    );
  }

  const acting = resolveActingSeat(env, isPathSafeAgentId);
  const marker = buildMarker('suspended', since, acting.by, options.reason);
  const markerPath = core.writeSeatLifecycle(repoRoot, seatId, marker);

  emit([
    `Seat suspended: ${seatId}`,
    `  marker: ${render(markerPath)}`,
    `  ${describeMarker(marker)}`,
    ...attributionNote(acting),
    '',
    'Effects',
    `  · ${seatId} drops out of broadcast REQUIRED-SETS and round denominators:`,
    '    a broadcast no longer waits on this seat’s mark (mmnto-ai/totem#2412).',
    '  · Directed mail addressed to this seat still surfaces — suspension',
    '    changes the count, it never hides a message.',
    ...OBLIGATIONS_NOTE,
    ...(options.reason === undefined
      ? [
          '',
          '  no --reason recorded — this is not a blocker, but `reason` + `since` on',
          '  the marker is the recorded-ruling audit trail the cohort-roles §6.6',
          `  \`operator-excluded\` synthesis reads. Consider re-running with`,
          `  \`totem seat suspend ${seatId} --reason "<the ruling>"\`.`,
        ]
      : []),
    ...(current.warning === undefined ? [] : ['', `warning: ${render(current.warning)}`]),
  ]);
}

// ─── remove ─────────────────────────────────────────────

/**
 * Declare a seat retired. Nothing is deleted — the marker is a durable
 * tombstone and retention policy is mmnto-ai/totem#2518's lane — and no
 * obligation is discharged. The residual foreign surfaces are emitted as a
 * deregistration checklist, never applied.
 */
export async function seatRemoveCommand(
  seatId: string,
  options: SeatRemoveOptions = {},
): Promise<void> {
  const core = await import('@mmnto/totem');
  const { isPathSafeAgentId } = core;
  const {
    render,
    requireSafeSeatId,
    repoRootFor,
    seatDirFor,
    configPathFor,
    requireKnownSeat,
    buildMarker,
    readState,
  } = coreHelpers(core);

  requireSafeSeatId('remove', seatId);

  const env = options.envForTest ?? process.env;
  const since = options.nowForTest ?? new Date().toISOString();
  const repoRoot = repoRootFor(options);
  requireKnownSeat('remove', repoRoot, seatId);

  const current = readState(repoRoot, seatId);
  if (current.state === 'retired') {
    emit([
      `Seat ${seatId} is already retired since ${current.since ?? 'an unrecorded instant'} — nothing was rewritten.`,
      '  The existing tombstone stands; its `since` is the retirement’s anchor.',
    ]);
    return;
  }

  const acting = resolveActingSeat(env, isPathSafeAgentId);
  const marker = buildMarker('retired', since, acting.by, options.reason);
  const markerPath = core.writeSeatLifecycle(repoRoot, seatId, marker);

  const configPath = configPathFor(repoRoot);
  const configLine = fs.existsSync(configPath)
    ? `${render(configPath)} — remove the seat from ${HOST_AGENTS_KEY} if it is listed there.`
    : `no ${CONFIG_FILENAME} in this repo — nothing to deregister there.`;

  emit([
    `Seat retired: ${seatId}`,
    `  marker: ${render(markerPath)}`,
    `  ${describeMarker(marker)}`,
    ...attributionNote(acting),
    '',
    'Retention',
    `  · Nothing was deleted. ${render(seatDirFor(repoRoot, seatId))} keeps its`,
    '    outbox, processed marks, and journals exactly as they are — the marker',
    '    is a durable tombstone, and retention policy is mmnto-ai/totem#2518’s',
    '    lane, not this verb’s.',
    '',
    'Effects',
    `  · ${seatId} leaves broadcast required-sets and round denominators.`,
    ...OBLIGATIONS_NOTE,
    ...(current.warning === undefined ? [] : ['', `warning: ${render(current.warning)}`]),
    '',
    ...deregistrationChecklist(seatId, configLine),
  ]);
}

// ─── list ───────────────────────────────────────────────

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Read-only accounting: every registered seat (the dirs ARE the roster) with
 * its declared lifecycle, derived at read time and never cached. Degraded
 * marker reads appear as warnings BELOW the table — a seat with an unusable
 * marker still renders as `active`, because fail-open is the read contract.
 */
export async function seatListCommand(options: SeatListOptions = {}): Promise<void> {
  const core = await import('@mmnto/totem');
  const { deriveSeatStatuses } = core;
  const { render, repoRootFor } = coreHelpers(core);

  const repoRoot = repoRootFor(options);
  const statuses: SeatStatus[] = deriveSeatStatuses(repoRoot);

  if (options.json === true) {
    process.stdout.write(JSON.stringify(statuses, null, 2) + '\n');
    return;
  }

  if (statuses.length === 0) {
    emit([
      `no seats registered in ${render(path.join(repoRoot, TOTEM_DIR, ORCHESTRATION_DIR))}`,
      '  The dirs ARE the roster (mmnto-ai/totem#2141) — a seat registers itself',
      '  on its first write, or explicitly via `totem seat add <seat-id>`.',
    ]);
    return;
  }

  const rows = statuses.map((status) => ({
    seat: status.seat,
    state: status.state,
    since: status.since ?? EMPTY_CELL,
    source: status.source,
  }));
  const widths = {
    seat: Math.max(LIST_COLUMN_MIN_WIDTHS.seat, ...rows.map((row) => row.seat.length)),
    state: Math.max(LIST_COLUMN_MIN_WIDTHS.state, ...rows.map((row) => row.state.length)),
    since: Math.max(LIST_COLUMN_MIN_WIDTHS.since, ...rows.map((row) => row.since.length)),
    source: Math.max(LIST_COLUMN_MIN_WIDTHS.source, ...rows.map((row) => row.source.length)),
  };

  const warnings = statuses
    .filter((status) => status.warning !== undefined)
    .map((status) => render(status.warning ?? ''));

  emit([
    `${padCell('seat', widths.seat)}  ${padCell('state', widths.state)}  ${padCell('since', widths.since)}  source`,
    `${'-'.repeat(widths.seat)}  ${'-'.repeat(widths.state)}  ${'-'.repeat(widths.since)}  ${'-'.repeat(widths.source)}`,
    ...rows.map(
      (row) =>
        `${padCell(row.seat, widths.seat)}  ${padCell(row.state, widths.state)}  ${padCell(row.since, widths.since)}  ${row.source}`,
    ),
    `${statuses.length} seat(s) in ${render(repoRoot)} · derived at read time, never cached`,
    ...(warnings.length === 0
      ? []
      : ['', `warnings (${warnings.length}):`, ...warnings.map((warning) => `  · ${warning}`)]),
  ]);
}

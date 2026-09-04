/**
 * `totem legs deposit` / `totem legs gate` — the two verbs over the
 * leg-deposit store (mmnto-ai/totem#2698, ruled 2026-09-03;
 * `doctrine/model-tiering.md` § Review legs).
 *
 * `deposit` is the ONLY writer: it resolves the head a falsification leg
 * actually read, binds the leg's findings file to that sha, and hands the
 * bytes to core's validate-on-write `saveLegDeposit`. `gate` is a READER — it
 * never writes, never judges a finding's severity, and never decides policy:
 * it answers one question for a push, *was this head read by a leg*, and says
 * exactly how it derived the answer.
 *
 * Three properties of the gate are contract, not style:
 *
 * 1. **The tier changes only the exit code.** `--advisory` prints the
 *    BYTE-IDENTICAL lines of every state and exits 0; the strict caller is
 *    the pre-push hook, which maps 3 and 2 to a block. That is why the
 *    derivation returns its lines and BOTH codes, and the flag is applied at
 *    one place at the very end — a second formatting path per tier is how the
 *    advisory line and the blocking line drift apart.
 * 2. **Not owed never consults the store.** The predicate is derived from the
 *    changed-file set alone; a repo whose diff matches no glob must not have
 *    its deposit directory read, so the "not owed" line is honest about
 *    having judged globs and nothing else.
 * 3. **stdout is written SYNCHRONOUSLY before exit.** A piped write is
 *    asynchronous on macOS, so `process.stdout.write` followed by
 *    `process.exit` can truncate the very line the `sh` arm is about to echo
 *    — the `fs.writeSync(1, …)` precedent from the strict pre-commit reader.
 *
 * Everything the gate echoes is control-character sanitized. The deposit's own
 * strings are already refused at the schema boundary (core `artifacts/legs.ts`),
 * but paths, glob names and corrupt-file reasons come off a filesystem and a
 * config file, so they are sanitized here too rather than trusted by provenance.
 *
 * Per the CLI command-module contract, every VALUE import is dynamic inside
 * the command bodies (the core barrel pulls LanceDB into `--help` otherwise);
 * `import type` is erased at build and stays static.
 */

import type { LegCoverageQuery, LegDeposit, LegFindingCounts, LegGitAdapter } from '@mmnto/totem';

/** Log tag for this command pair's human output (`log.*` writes to stderr). */
const TAG = 'Legs';

/**
 * How many `glob → file` basis pairs the BLOCKED line names before it
 * collapses the rest into `+K more`. Sized like `MAX_DISCLOSED_FILTERED_FILES`
 * in `git.ts`: enough to show the reason, bounded so one broad glob cannot
 * flood a hook's output.
 */
const MAX_DISCLOSED_BASIS_PAIRS = 5;

/**
 * How many changed paths the gate's own scope line names before it collapses
 * the rest into `+K more`. Higher than the basis cap because this line is the
 * scope itself rather than a reason, but still bounded: an unbounded list is a
 * screenful in a hook's output on a large branch, and the true count stays in
 * the parentheses either way.
 */
const MAX_DISCLOSED_CHANGED_FILES = 12;

/**
 * List what a candidate could have READ: the paths its own branch diff added
 * relative to `base` (three-dot).
 *
 * `-z` is load-bearing, not a style choice (mmnto-ai/totem#2698 fold 4). Under
 * git's default `core.quotePath=true`, `--name-only` C-QUOTES any path with a
 * non-ASCII byte, a quote or a backslash — `docs/caf\303\251.md` — while the
 * owed set comes from `extractChangedFiles`, which is unquoted. The two sets
 * then never intersect for such a path, and a covering ancestor is rejected
 * with the false reason "predates every owed change". `-z` emits raw
 * NUL-separated names and never quotes, so both sides speak one spelling.
 *
 * One helper, taking the runner: the gate shells out through `safeExec` and the
 * covariate through its injected `GitExec`, and a second copy of this argv is
 * exactly how one of them would drift back to the quoted form.
 */
export function legReachPaths(
  run: (args: readonly string[]) => string,
  base: string,
  head: string,
): string[] {
  const raw = run(['diff', '--name-only', '-z', `${base}...${head}`]);
  // NUL-terminated, not NUL-separated: the payload ends with one, so the final
  // split element is empty and is dropped along with any other empty.
  return raw.split(LEG_PATH_SEPARATOR).filter((entry) => entry.length > 0);
}

/** The `-z` record separator, built rather than escaped (the banked decode trap). */
const LEG_PATH_SEPARATOR = String.fromCharCode(0);

/** The prefix `TotemError` stamps on every message — stripped when re-branding. */
const TOTEM_ERROR_BRAND = '[Totem Error] ';

/** Milliseconds in a day — the evidence line's age is reported in days. */
const MS_PER_DAY = 86_400_000;

/**
 * Collapse every C0 (0-31) and DEL/C1 (127-159) code point to `?`.
 *
 * `sanitizeForTerminal` deliberately PRESERVES LF and HT — it defends a
 * multi-line log payload — so it is not sufficient on its own for a value
 * landing inside a single `[Totem] …` line that a shell arm echoes: one
 * newline in a glob or a path would forge a second line and a reader could not
 * tell the forged one from the gate's own. This is the strict-pre-commit
 * reader's `safe()` rule (`install-hooks.ts`), applied AFTER the ANSI/CSI strip
 * so both defenses hold: escapes removed, then every remaining control byte
 * flattened. U+0085 (NEL) is inside the band because it breaks a line on some
 * terminals.
 *
 * Written as a `charCodeAt` loop, not the equivalent regex class: the class
 * would have to be authored with `\u`/`\x` escapes, and this repo has a banked
 * incident where an editing tool decoded such an escape into a RAW control byte
 * in the source (mmnto-ai/totem#2692 fold 3).
 */
function safeLine(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const control = code < 32 || (code >= 127 && code <= 159);
    out = out + (control ? '?' : text.charAt(i));
  }
  return out;
}

/**
 * The ONE spelling of "this value came from outside and is about to be echoed":
 * strip ANSI/CSI escapes, then flatten every remaining control byte. Both verbs
 * pass every filesystem-, config- and argv-sourced value through it
 * (mmnto-ai/totem#2698 fold 2).
 */
function echoSafe(value: string): string {
  return safeLine(sanitizeForTerminalSync(value));
}

/**
 * `sanitizeForTerminal`, bound through a module-local slot so {@link echoSafe}
 * stays synchronous inside message templates. Assigned from the same dynamic
 * core import the rest of the module uses, before either verb echoes anything.
 */
let sanitizeForTerminalSync: (value: string) => string = (value) => value;

/** Bind the core sanitizer for this process. Idempotent; called by both verbs. */
async function loadSanitizer(): Promise<void> {
  const { sanitizeForTerminal } = await import('@mmnto/totem');
  sanitizeForTerminalSync = sanitizeForTerminal;
}

// ─── `totem legs deposit` ───────────────────────────────────────────────────

export interface LegsDepositOptions {
  /** The head the leg READ. Any rev git accepts; defaults to `HEAD`. */
  sha?: string;
  /** Path to the leg's findings JSON. */
  from: string;
  /** Overwrite an existing deposit for this sha, reporting what was replaced. */
  replace?: boolean;
  /** The leg's own instant (ISO-8601). Overrides the file's `readAt`. */
  readAt?: string;
}

/** Render the four counts the way both verbs spell them. */
function renderCounts(counts: LegFindingCounts): string {
  return `blocking=${counts.blocking} material=${counts.material} minor=${counts.minor} folded=${counts.folded}`;
}

/**
 * Resolve `ref` to a full 40-hex COMMIT sha, refusing anything that is not a
 * commit in this repo by name. `^{commit}` is the peel that makes a tag or a
 * tree fail here rather than silently addressing the store under a non-commit
 * object name.
 */
async function resolveCommitSha(cwd: string, ref: string): Promise<string> {
  const { safeExec, TotemError } = await import('@mmnto/totem');
  await loadSanitizer();
  const trimmed = ref.trim();
  if (trimmed.length === 0 || trimmed.startsWith('-')) {
    // Mirrors `getGitDiffRange`'s flag-injection guard: a ref starting with
    // `-` reaches git as an option, not a revision.
    throw new TotemError(
      'GIT_FAILED',
      `Invalid --sha ${JSON.stringify(echoSafe(ref))}: a revision may not be empty or start with '-' (git-flag injection guard).`,
      'Pass a plain revision such as HEAD or a commit sha.',
    );
  }
  let out: string;
  try {
    out = safeExec('git', ['rev-parse', '--verify', `${trimmed}^{commit}`], { cwd });
  } catch (err) {
    // git's own failure rides as the CAUSE (styleguide rule 9): the message
    // names the ref the seat passed, and `--debug` can still reach what git
    // actually said.
    throw new TotemError(
      'GIT_FAILED',
      `--sha ${echoSafe(trimmed)} does not name a commit in this repository.`,
      'Pass a commit this checkout can resolve (e.g. HEAD), or fetch the missing history first.',
      err,
    );
  }
  const sha = out.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new TotemError(
      'GIT_FAILED',
      `--sha ${echoSafe(trimmed)} resolved to ${JSON.stringify(echoSafe(sha))}, which is not a 40-character commit sha.`,
      'Pass a commit this checkout can resolve (e.g. HEAD).',
    );
  }
  return sha;
}

/**
 * `totem legs deposit --sha <ref> --from <file> [--replace] [--read-at <iso>]`
 *
 * The writer. Refuses, loudly and before touching the store, every way the
 * deposit could name the wrong head: a `--sha` that is not a commit, a file
 * whose own `diffSha` disagrees with it, and an occupied address without
 * `--replace`. `readAt` is the leg's own instant — when the file carries none
 * and none is passed, the stamp is `now` and that substitution is PRINTED,
 * because a deposit's instant is what the resolver breaks ties on.
 */
export async function legsDepositCommand(options: LegsDepositOptions): Promise<void> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { LEG_DEPOSIT_SCHEMA_VERSION, countLegFindings, saveLegDeposit, TotemError } =
    await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  await loadSanitizer();

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);
  const totemDirAbs = path.join(path.dirname(configPath), config.totemDir);

  const diffSha = await resolveCommitSha(cwd, options.sha ?? 'HEAD');

  const fromPath = path.resolve(cwd, options.from);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(fromPath, 'utf-8'));
  } catch (err) {
    throw new TotemError(
      'PARSE_FAILED',
      `Could not read the leg's findings at ${echoSafe(options.from)}.`,
      'Pass --from <file> pointing at the leg deposit JSON the review leg returned.',
      err,
    );
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TotemError(
      'PARSE_FAILED',
      `The leg's findings at ${echoSafe(options.from)} are not a JSON object.`,
      'The file must be a deposit object: { findings, folded, verdict, ... }.',
    );
  }
  const fields = raw as Record<string, unknown>;

  // The deposit must NAME the head it read: a file that carries its own
  // `diffSha` and disagrees with `--sha` is a mismatch, never a rewrite.
  const declaredSha = fields['diffSha'];
  if (typeof declaredSha === 'string' && declaredSha !== diffSha) {
    throw new TotemError(
      'PARSE_FAILED',
      `The findings file names diffSha ${echoSafe(declaredSha)}, but --sha resolved to ${diffSha}.`,
      'Deposit against the head the leg actually read, or correct the diffSha in the file.',
    );
  }

  const fileReadAt =
    typeof fields['readAt'] === 'string' ? (fields['readAt'] as string) : undefined;
  const readAt = options.readAt ?? fileReadAt ?? new Date().toISOString();
  if (options.readAt === undefined && fileReadAt === undefined) {
    log.warn(
      TAG,
      `readAt defaulted to ${echoSafe(readAt)} — pass --read-at for the leg's own instant`,
    );
  }

  const schemaVersion =
    typeof fields['schemaVersion'] === 'string'
      ? (fields['schemaVersion'] as string)
      : LEG_DEPOSIT_SCHEMA_VERSION;

  // Assembled as `unknown` and handed to the validate-on-write path: the
  // schema is the ONE validation boundary, so a malformed findings array
  // surfaces with its Zod path instead of a hand-rolled second opinion.
  const candidate = {
    ...fields,
    schemaVersion,
    diffSha,
    readAt,
  } as LegDeposit;

  let result;
  try {
    result = saveLegDeposit(totemDirAbs, candidate, { replace: options.replace === true });
  } catch (err) {
    // A ZodError's own message is a JSON blob; re-state it as the path→message
    // pairs the seat has to fix (the `loadConfig` idiom). Every other failure —
    // including core's typed LegDepositExistsError, which already carries the
    // incumbent's readAt and names --replace — propagates untouched.
    if (err instanceof Error && err.name === 'ZodError' && 'issues' in err) {
      const issues = (
        err as { issues: Array<{ path: Array<string | number>; message: string }> }
      ).issues
        // Each issue's path and message are line-safed INDIVIDUALLY; the
        // newline between entries is this code's own layout, not attacker
        // input, so it survives (a whole-block flatten would destroy the list).
        .map(
          (issue) => `  ${echoSafe(issue.path.join('.') || '<root>')}: ${echoSafe(issue.message)}`,
        )
        .join('\n');
      throw new TotemError(
        'PARSE_FAILED',
        `The leg deposit built from ${echoSafe(options.from)} is not valid:\n${issues}`,
        'Fix the fields listed above; every finding needs a unique id, and folded may only name finding ids.',
        err,
      );
    }
    throw err;
  }

  if (result.replaced !== undefined) {
    log.warn(
      TAG,
      `replaced the deposit read at ${echoSafe(result.replaced.readAt ?? 'an unreadable instant')} for ${diffSha}`,
    );
  }
  log.success(TAG, `${echoSafe(result.path)} · ${renderCounts(countLegFindings(candidate))}`);
}

// ─── `totem legs gate` ──────────────────────────────────────────────────────

export interface LegsGateOptions {
  /**
   * Print every line of the derived state, but exit 0 for every GATE state
   * (not owed, evidence, blocked, not derived). A failure BEFORE the
   * derivation — an unloadable config, an unknown flag — still exits non-zero.
   *
   * The repo's `hooks.legsOwed.enforce` knob OVERRIDES this flag
   * (mmnto-ai/totem#2771): `'block'` exits the derived state whether or not
   * the flag was passed, `'advisory'` exits 0 whether or not it was, and an
   * absent knob leaves the flag in charge. The knob rides the deps seam
   * ({@link LegsGateDeps.enforce}) because it is a property of the repo, not
   * of the caller.
   */
  advisory?: boolean;
}

/** The two spellings of `hooks.legsOwed.enforce` (mmnto-ai/totem#2771). */
export type LegsEnforce = 'block' | 'advisory';

/**
 * There is deliberately no `--head`: the gate judges `HEAD` and nothing else
 * (mmnto-ai/totem#2698 fold 2, MATERIAL). A caller-chosen head turns a block
 * into a pass — a deposit written on a sibling branch answers for a commit
 * this push does not contain — and the hook has no reason to ask about any
 * head but the one being pushed. Tests inject a head through
 * {@link LegsGateDeps.resolveHead}, which is a seam, not a public flag.
 */

/**
 * The derivation seam. Everything the gate needs that touches the world —
 * git, the config's globs, the diff — arrives through this interface, so the
 * five states are testable against a temp store and a fake git without a
 * fixture repo per case (core's `LegGitAdapter` precedent).
 */
export interface LegsGateDeps {
  /** The root every printed path is relative to (the config root). */
  root: string;
  /** Absolute totem dir — the deposit store lives under it. */
  totemDirAbs: string;
  /** The judgment-dense floor this push is judged against. */
  globs: readonly string[];
  /**
   * The repo's `hooks.legsOwed.enforce`, when it declares one. Applied to the
   * STATUS only, after the derivation, exactly where `--advisory` is; the
   * lines never depend on it except for the one disclosure that names it.
   */
  enforce?: LegsEnforce;
  /** Ancestry seam handed to core's resolver. */
  git: LegGitAdapter;
  /** Full 40-hex head sha. Throws when the head cannot be resolved. */
  resolveHead(): string;
  /** The push's resolved branch scope. Throws when the diff cannot be resolved. */
  changedFiles(): Promise<LegsGateScope>;
}

/**
 * The branch scope the gate judges: the unfiltered changed-file set, plus the
 * base it was resolved against.
 *
 * The base is carried because COVERAGE is measured against it
 * (mmnto-ai/totem#2698 fold 3) — a candidate's reach is `base...<diffSha>`, and
 * it has to be the SAME base HEAD was resolved against or the two diffs are not
 * comparable. Absent when the resolution produced no base, which the gate
 * treats as "coverage is not derivable" rather than guessing one.
 */
export interface LegsGateScope {
  files: readonly string[];
  base?: string;
}

/**
 * The coverage query for a set of owed paths, or `undefined` when it cannot be
 * derived (no base). Exported because the covariate resolves through the SAME
 * inputs as the gate — a field that named a deposit the gate rejects would be
 * the round reading evidence the push gate does not accept.
 *
 * The basis lists one entry per `glob -> file` MATCH, so a file matching three
 * globs appears three times; the owed set is those files, deduplicated in
 * basis order.
 */
export function legsCoverageForBasis(
  base: string | undefined,
  basis: readonly { glob: string; file: string }[],
): LegCoverageQuery | undefined {
  if (base === undefined) return undefined;
  const owedFiles = [...new Set(basis.map((entry) => entry.file))];
  return owedFiles.length === 0 ? undefined : { base, owedFiles };
}

/** Exit vocabulary: 0 not owed / evidence · 2 could not derive · 3 owed, no deposit. */
export type LegsGateCode = 0 | 2 | 3;

export interface LegsGateOutcome {
  /** The DERIVED state — what the gate concluded, before any tier mapping. */
  derived: LegsGateCode;
  /**
   * What the process exits with: `derived`, or 0 when the run is advisory —
   * `--advisory` with no knob, or `hooks.legsOwed.enforce: 'advisory'` at any
   * tier; `'block'` makes every tier exit `derived` (mmnto-ai/totem#2771).
   */
  status: LegsGateCode;
  /**
   * stdout lines, in order. Identical for both tiers, by contract: the knob
   * adds one line when it is SET, the same line under either flag, so a
   * flagged and an unflagged run of one config still print the same text.
   */
  stdout: string[];
  /** stderr lines (the corrupt-deposit sensor rows). */
  stderr: string[];
}

/**
 * Derive the gate's verdict and its lines.
 *
 * The tier is applied ONLY to `status`; `stdout` is produced once, so an
 * advisory run and a strict run of the same state cannot print different text.
 * The repo's `hooks.legsOwed.enforce` knob is applied at the SAME point and
 * nowhere else (mmnto-ai/totem#2771): it decides `advisory` before any line is
 * composed, so there is still one formatting path and the knob, like the
 * tier, changes only the exit code.
 */
export async function runLegsGate(
  options: LegsGateOptions,
  deps: LegsGateDeps,
): Promise<LegsGateOutcome> {
  const path = await import('node:path');
  const { classifyLegsOwed, countLegFindings, findLegDepositForHead, sanitizeForTerminal } =
    await import('@mmnto/totem');

  // The knob wins over the flag in BOTH directions; an absent knob leaves the
  // flag in charge, which is the pre-knob behaviour byte for byte.
  const advisory =
    deps.enforce === 'block'
      ? false
      : deps.enforce === 'advisory'
        ? true
        : options.advisory === true;
  // One disclosure when the knob is set, appended LAST so every verdict line
  // keeps its index, and printed under either flag so the two tiers' stdout
  // stays identical for one config. A reader blocked on a standard-tier
  // install sees which key did it; a reader passing on strict sees the same.
  const knobLine =
    deps.enforce === undefined ? [] : [`[Totem] legs: hooks.legsOwed.enforce = ${deps.enforce}`];
  const finish = (derived: LegsGateCode, stdout: string[], stderr: string[]): LegsGateOutcome => ({
    derived,
    status: advisory ? 0 : derived,
    stdout: [...stdout, ...knobLine],
    stderr,
  });
  // Two-stage, in this order: strip ANSI/CSI escapes, then flatten every
  // remaining control byte. The second stage is what keeps a newline in a glob
  // or a path from forging a second `[Totem]` line (mmnto-ai/totem#2698 fold 2).
  const safe = (value: string): string => safeLine(sanitizeForTerminal(value));
  /** Repo-root-relative, forward-slashed — the address a reader can act on. */
  const relative = (target: string): string =>
    safe(path.relative(deps.root, target).split(path.sep).join('/'));

  let head: string;
  let scope: LegsGateScope;
  let resolution: Awaited<ReturnType<typeof findLegDepositForHead>> | undefined;
  let owed: ReturnType<typeof classifyLegsOwed> | undefined;
  try {
    const { TotemError } = await import('@mmnto/totem');
    head = deps.resolveHead();
    scope = await deps.changedFiles();
    owed = classifyLegsOwed(scope.files, deps.globs);
    // The store is consulted ONLY when the diff is owed — a not-owed push must
    // not depend on the deposit directory being readable at all.
    if (owed.owed) {
      // Coverage is not optional for the GATE (mmnto-ai/totem#2698 fold 3): it
      // only ever runs on the branch scope, so a scope that resolved without a
      // base is a failure to derive, not a licence to fall back to
      // ancestry-only — that fallback is exactly the merge-base pass the
      // ruling closed.
      const query = legsCoverageForBasis(scope.base, owed.basis);
      if (query === undefined) {
        throw new TotemError(
          'GIT_FAILED',
          'the branch scope resolved without a base ref, so coverage is not derivable',
          'Fetch the base branch (git fetch origin <base>) and retry.',
        );
      }
      resolution = findLegDepositForHead(deps.totemDirAbs, head, deps.git, query);
    }
    // totem-context: intentional — this is not a swallow but the gate's LOUDEST arm: any failure to derive (no repo, an unresolvable head, a branch diff or an ancestry probe that will not resolve) becomes the NOT DERIVED verdict, printed with its cause and exit 2, which the strict pre-push arm blocks on with its own line (mmnto-ai/totem#2698)
  } catch (err) {
    // `TotemError` brands its own message, and this line is already branded —
    // `[Totem] legs: NOT DERIVED — [Totem Error] …` reads as two speakers. The
    // gate owns the shape of its line, so the inner brand is stripped; the
    // recovery hint stays on the error for any programmatic caller.
    const raw = err instanceof Error ? err.message : String(err);
    const cause = safe(
      raw.startsWith(TOTEM_ERROR_BRAND) ? raw.slice(TOTEM_ERROR_BRAND.length) : raw,
    );
    return finish(2, [`[Totem] legs: NOT DERIVED — ${cause}`], []);
  }

  const head8 = safe(head.slice(0, 8));

  if (!owed.owed) {
    return finish(
      0,
      [
        `[Totem] legs: not owed — no changed path matched hooks.legsOwed.globs (${deps.globs.length} globs; head ${head8})`,
      ],
      [],
    );
  }

  // The corrupt rows are a SENSOR, not a verdict: they are disclosed on stderr
  // whatever the outcome, and they never mask a valid sibling deposit.
  const stderr = (resolution?.corrupt ?? []).map(
    (entry) =>
      `[Totem] legs: sensor — ignoring corrupt deposit ${safe(entry.file)}: ${safe(entry.reason)}`,
  );

  const winner = resolution?.winner;
  if (winner !== undefined) {
    const counts = countLegFindings(winner.deposit);
    const stamp = Date.parse(winner.deposit.readAt);
    const deltaMs = Number.isNaN(stamp) ? undefined : Date.now() - stamp;
    const days = deltaMs === undefined ? undefined : Math.floor(deltaMs / MS_PER_DAY);
    // A negative age is not an unknown age. A deposit stamped in the FUTURE —
    // a skewed clock, a hand-edited instant — used to print `age unknown`,
    // which reads as "unparseable" and hides the one thing worth acting on:
    // this instant is wrong, and ranking breaks ties on it.
    const age =
      days === undefined
        ? 'age unknown'
        : days >= 0
          ? `${days} days old`
          : // The MAGNITUDE is floored, not the signed value: `Math.floor` on a
            // negative delta rounds AWAY from zero, so a stamp two days and a
            // second ahead reported three.
            `read ${Math.floor(Math.abs(deltaMs ?? 0) / MS_PER_DAY)} days in the FUTURE — check the clock or the deposit`;
    const reach =
      winner.rank === 'exact'
        ? 'exact'
        : `nearest ancestor, +${winner.distance} commits since the leg read`;
    // `covers K/N owed paths` is DISCLOSURE, never a block: a leg that read
    // some of what this push owes is still a leg that read this head, and the
    // re-arm is doctrine's call. The gate always supplies a coverage query, so
    // the field is always present here; the guard exists because the core
    // resolution is shared with the covariate, which may resolve without one.
    const covers =
      winner.coverage === undefined
        ? ''
        : ` · covers ${winner.coverage.covered}/${winner.coverage.owed} owed paths`;
    const stdout = [
      `[Totem] legs evidence: ${relative(winner.path)} (read ${safe(winner.deposit.readAt)}, ${age}) · head ${head8} · ${reach}${covers} · blocking=${counts.blocking} material=${counts.material} folded=${counts.folded}`,
    ];
    const superseded = resolution?.superseded ?? [];
    if (superseded.length > 0) {
      const named = superseded
        .map(
          (candidate) =>
            `${safe(candidate.diffSha.slice(0, 8))} (read ${safe(candidate.readAt)}, ${
              candidate.rank === 'exact' ? 'exact' : `ancestor +${candidate.distance}`
            })`,
        )
        .join(', ');
      stdout.push(
        `[Totem] legs: ${superseded.length} superseded candidate(s) for this head: ${named}`,
      );
    }
    return finish(0, stdout, stderr);
  }

  // Owed, and nothing answers for this head. The basis is what makes the block
  // actionable — WHICH glob matched WHICH file — and every stale candidate is
  // named with its own reason, because "not an ancestor" and "unknown to this
  // repo" are different repairs.
  const shown = owed.basis
    .slice(0, MAX_DISCLOSED_BASIS_PAIRS)
    .map((entry) => `${safe(entry.glob)} → ${safe(entry.file)}`)
    .join(', ');
  const more =
    owed.basis.length > MAX_DISCLOSED_BASIS_PAIRS
      ? `, +${owed.basis.length - MAX_DISCLOSED_BASIS_PAIRS} more`
      : '';
  const stdout = [
    `[Totem] BLOCKED: this push is legs-owed (${shown}${more}) and carries no fresh falsification-leg deposit for head ${head8}`,
  ];
  for (const candidate of resolution?.stale ?? []) {
    // One reason per candidate, because the repairs differ: fetch the missing
    // history, deposit against this branch, or run the leg over the owed diff.
    // Exhaustive on purpose — a ternary chain's final arm silently ADOPTS any
    // reason core adds later, printing the wrong repair for it.
    const reason = ((): string => {
      switch (candidate.reason) {
        case 'not-ancestor':
          return 'not an ancestor of head';
        case 'unknown-commit':
          return 'unknown to this repo';
        case 'no-coverage':
          return 'covers none of the owed paths (the deposit predates every owed change)';
        default: {
          const unreachable: never = candidate.reason;
          return String(unreachable);
        }
      }
    })();
    stdout.push(`[Totem] legs: stale deposit ${safe(candidate.diffSha.slice(0, 8))}: ${reason}`);
  }
  stdout.push(
    '[Totem] legs: run the leg, then: totem legs deposit --sha HEAD --from <findings.json>',
  );
  return finish(3, stdout, stderr);
}

/**
 * How a caller wants the branch scope resolved.
 *
 * `run` is the git seam (mmnto-ai/totem#2698 fold 5, Q1): the covariate
 * resolves HEAD and ancestry through an INJECTED runner, and a reach probe that
 * shelled out to real git regardless left half that seam unhonored — a test
 * could fake the ancestry half and silently get real git for the other.
 */
export interface LegsScopeOptions {
  /** Suppress this module's `[Legs]` scope lines AND the resolver's own. */
  suppressScopeNarration?: boolean;
  /** Git runner; defaults to `safeExec('git', …, { cwd })`. */
  run?: (args: readonly string[]) => string;
}

/**
 * Resolve the branch scope the floor is judged on — the ONE derivation the gate
 * and the covariate both use (mmnto-ai/totem#2698 fold 3 item 3), so the
 * covariate can never name a deposit the gate would reject.
 *
 * The push-gate scope (`--branch`): the branch-vs-base diff is what the leg
 * read, and it is what the push actually proposes. An empty result is not owed
 * — there is nothing for a leg to read.
 *
 * UNFILTERED, deliberately (mmnto-ai/totem#2698 fold 1). The same base/head
 * resolution runs, but with an EMPTY ignore configuration, so neither
 * `ignorePatterns` nor `shieldIgnorePatterns` can hide a path from the floor.
 * Those keys carry INDEX-exclusion semantics that were merged into the
 * review/lint diff filter for back-compat (mmnto-ai/totem#1746,
 * mmnto-ai/totem#1748) — letting them narrow this predicate would mean a repo
 * that excludes `README.md` from its index silently stops owing a leg for its
 * public copy, which is the claim-without-mechanism shape the floor exists to
 * close.
 *
 * The resolved BASE rides back with the files: coverage is measured against it,
 * and it must be the same base HEAD was resolved against.
 */
export async function resolveUnfilteredBranchScope(
  cwd: string,
  options: LegsScopeOptions = {},
): Promise<LegsGateScope> {
  const { safeExec } = await import('@mmnto/totem');
  const { getDiffForReview } = await import('../git.js');
  const { log } = await import('../ui.js');
  await loadSanitizer();
  const run =
    options.run ?? ((args: readonly string[]): string => safeExec('git', [...args], { cwd }));
  const narrate = options.suppressScopeNarration !== true;
  // The GATE narrates its scope; the covariate does not. Since fold 4 the leg
  // field derives coverage from HEAD's branch scope on every review scope, so
  // this resolution runs inside `totem review` runs too — and a `[Legs]` line
  // in the middle of a `[Review]` run describes a probe nobody asked for.
  // `getDiffForReview` still resolves the BASE (its origin-preference logic is
  // the one this gate must agree with) and still rules on the empty-diff case,
  // but its narration is ALWAYS suppressed: its `Changed files` line is built
  // from `extractChangedFiles`, which spells a non-ASCII path the C-quoted way,
  // and this module prints the RAW list below. Letting both speak printed the
  // same line twice, in two different spellings (caught on this branch's own
  // gate run, mmnto-ai/totem#2698 fold 5).
  const result = await getDiffForReview(
    { branch: true, suppressScopeNarration: true },
    { ignorePatterns: [], shieldIgnorePatterns: [] },
    cwd,
    TAG,
  );
  const base = result.base;
  // One disclosure, ours, carrying the resolved base so nothing the suppressed
  // line said is lost.
  if (narrate) {
    log.info(
      TAG,
      safeLine(
        `Diff source: branch-vs-base (${base ?? 'no base resolved'}...HEAD, unfiltered — ignorePatterns do not apply to the floor)`,
      ),
    );
  }
  // The FILE LIST is read separately, with `-z` (mmnto-ai/totem#2698 fold 5).
  //
  // Not a preference: `extractChangedFiles` parses `diff --git` headers, which
  // git C-QUOTES for any path carrying a non-ASCII byte, a double quote or a
  // backslash. The reach probe reads the same names raw. Fold 4 tried to
  // reconcile them by DECODING the quoted side, which handled octal triples
  // and nothing else — a name with a quote or a backslash still missed, and a
  // literal `\123` inside a legal filename was rewritten to `S`. Reading the
  // owed side through the SAME `-z` helper the reach uses makes both sides raw
  // by construction, so there is nothing left to decode and no name a decoder
  // could corrupt.
  const files =
    'empty' in result || base === undefined
      ? // No base, or nothing changed: there is no `base...HEAD` to list, and
        // an empty scope is not owed anyway.
        []
      : legReachPaths(run, base, 'HEAD');
  // The gate's own disclosure, from the RAW list — so the names it prints are
  // the names it judged, spelled as they are on disk.
  if (narrate) {
    const shownFiles = files.slice(0, MAX_DISCLOSED_CHANGED_FILES).map(safeLine);
    const moreFiles =
      files.length > shownFiles.length ? `, +${files.length - shownFiles.length} more` : '';
    // The count in the parentheses is the TRUE one — the cap shortens the list,
    // never the number.
    log.info(
      TAG,
      safeLine(`Changed files (${files.length}): ${shownFiles.join(', ')}${moreFiles}`),
    );
  }
  return { files, ...(base === undefined ? {} : { base }) };
}

/**
 * The judgment-dense floor this repo declares, or the default when it declares
 * none — the ONE spelling, shared by the gate and both covariate sites.
 */
export async function legsOwedGlobs(config: {
  hooks?: { legsOwed?: { globs?: readonly string[] } };
}): Promise<readonly string[]> {
  const { DEFAULT_LEGS_OWED_GLOBS } = await import('@mmnto/totem');
  return config.hooks?.legsOwed?.globs ?? [...DEFAULT_LEGS_OWED_GLOBS];
}

/**
 * What a covariate site learned when it asked for coverage inputs: either the
 * query, or the reason it is not derivable for that site's scope.
 */
export interface LegsCoverageResolution {
  query?: LegCoverageQuery;
  /** Present iff `query` is absent — the caller discloses it as one Sensor line. */
  reason?: string;
}

/**
 * Derive the coverage query for a COVARIATE site (mmnto-ai/totem#2698 fold 3,
 * corrected in fold 4).
 *
 * The inputs come from HEAD's branch-vs-base scope ALWAYS — never from the
 * scope the review itself ran on. The leg field answers "was THIS HEAD read",
 * so what it owes is a property of HEAD, not of whether the operator happened
 * to review a staged slice or a dirty tree. Deriving from the review's scope
 * meant the default `uncommitted` scope resolved ancestry-only and NAMED the
 * merge-base deposit the gate rejects — the field disagreeing with the gate,
 * which is the one thing it must never do.
 *
 * Both covariate sites route through this one function, and it reuses the
 * gate's own pieces — the unfiltered branch scope and core's single
 * `classifyLegsOwed` — so the guarantee is unconditional: the field never names
 * a deposit the gate would reject. When HEAD has no branch base the answer is
 * `leg: none` plus one sensor, never a name resolved on ancestry alone.
 */
export async function deriveLegsCoverageForHead(
  cwd: string,
  globs: readonly string[],
  options: LegsScopeOptions = {},
): Promise<LegsCoverageResolution> {
  const { classifyLegsOwed } = await import('@mmnto/totem');
  await loadSanitizer();
  let scope;
  try {
    scope = await resolveUnfilteredBranchScope(cwd, options);
    // totem-context: intentional — `--covariate` is a read-only sensor whose contract is to print a line and exit 0, so a branch scope that will not resolve (no repo, an unfetched base) yields the no-coverage answer with its reason printed, never a throw out of a transport verb
  } catch (err) {
    return {
      reason: `coverage was not derivable — HEAD has no branch base (${echoSafe(err instanceof Error ? err.message : String(err))})`,
    };
  }
  const owed = classifyLegsOwed(scope.files, globs);
  const query = legsCoverageForBasis(scope.base, owed.basis);
  if (query !== undefined) return { query };
  // Two shapes reach here and they are NOT the same answer. No base: coverage
  // is underivable, so no deposit can be credited. Nothing owed: HEAD owes no
  // leg at all, so an empty query is vacuously satisfied and the field resolves
  // on ancestry — the gate would not even consult the store for this head.
  return scope.base === undefined
    ? { reason: 'coverage was not derivable — HEAD has no branch base' }
    : { query: { base: scope.base, owedFiles: [] } };
}

/**
 * Build the gate's real-world seam from the repo's config and git.
 *
 * Exported so the UNFILTERED-diff contract below is testable against a real
 * checkout without capturing a process exit: a test resolves these deps in a
 * fixture repo and asserts what `changedFiles()` actually returns.
 *
 * It takes no options: since `--head` was removed (mmnto-ai/totem#2698 fold 2)
 * nothing about the seam varies with a flag — `--advisory` is applied to the
 * STATUS, after the derivation, and never to what is derived.
 */
export async function buildLegsGateDeps(): Promise<LegsGateDeps> {
  const path = await import('node:path');
  const { safeExec, TotemError } = await import('@mmnto/totem');
  // The branch scope (and its `Diff source:` disclosure) now lives in the
  // shared `resolveUnfilteredBranchScope`, which the covariate calls too.
  const { isAncestor } = await import('../git.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  await loadSanitizer();

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);
  const root = path.dirname(configPath);

  const git: LegGitAdapter = {
    isCommit(sha) {
      try {
        safeExec('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd });
        return true;
        // totem-context: intentional — "does this repo know that object" IS the boolean; git's failure text is not a second signal, and the caller reports the deposit as `unknown to this repo`
      } catch {
        return false;
      }
    },
    isAncestor(base, head) {
      return isAncestor(cwd, base, head);
    },
    changedFiles: (base, head) =>
      legReachPaths((args) => safeExec('git', [...args], { cwd }), base, head),
    distance(base, head) {
      const raw = safeExec('git', ['rev-list', '--count', `${base}..${head}`], { cwd }).trim();
      const count = Number.parseInt(raw, 10);
      if (Number.isNaN(count)) {
        // Never guessed (mmnto-ai/totem#2698 fold 2, MINOR). The number is
        // PRINTED as fact — `+N commits since the leg read` — so an
        // unparseable answer is a failure to derive, not a zero: it throws,
        // reaches the gate's NOT DERIVED arm, and the strict hook blocks on it.
        // Guessing 0 would render a stale read as an exact one.
        throw new TotemError(
          'GIT_FAILED',
          `git rev-list --count ${base}..${head} returned ${JSON.stringify(echoSafe(raw))}, which is not a commit count.`,
          'Fix the checkout (a corrupt or truncated object store) and retry.',
        );
      }
      return count;
    },
  };

  const deps: LegsGateDeps = {
    root,
    totemDirAbs: path.join(root, config.totemDir),
    globs: await legsOwedGlobs(config),
    ...(config.hooks?.legsOwed?.enforce === undefined
      ? {}
      : { enforce: config.hooks.legsOwed.enforce }),
    git,
    resolveHead() {
      return safeExec('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd }).trim();
    },
    changedFiles: () =>
      resolveUnfilteredBranchScope(cwd, {
        run: (args) => safeExec('git', [...args], { cwd }),
      }),
  };
  return deps;
}

/**
 * `totem legs gate [--advisory]`
 *
 * The reader the managed pre-push arm and the CI arm call. Loads the repo's
 * config, builds the real git and diff seams, derives, writes SYNCHRONOUSLY,
 * exits with the tier-mapped status. `--advisory` maps every GATE state to 0
 * unless `hooks.legsOwed.enforce` says otherwise (mmnto-ai/totem#2771); a
 * failure before the derivation (config load, flag parse) still exits
 * non-zero through the CLI's error boundary.
 */
export async function legsGateCommand(options: LegsGateOptions): Promise<void> {
  const fs = await import('node:fs');
  const deps = await buildLegsGateDeps();
  const outcome = await runLegsGate(options, deps);
  for (const line of outcome.stderr) fs.writeSync(2, `${line}\n`);
  // fs.writeSync, not console.log: stdout is a PIPE under the hook, and a
  // piped write is asynchronous on macOS — process.exit could truncate the
  // line the `sh` arm is about to echo.
  for (const line of outcome.stdout) fs.writeSync(1, `${line}\n`);
  process.exit(outcome.status);
}

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

import type { LegDeposit, LegFindingCounts, LegGitAdapter } from '@mmnto/totem';

/** Log tag for this command pair's human output (`log.*` writes to stderr). */
const TAG = 'Legs';

/**
 * How many `glob → file` basis pairs the BLOCKED line names before it
 * collapses the rest into `+K more`. Sized like `MAX_DISCLOSED_FILTERED_FILES`
 * in `git.ts`: enough to show the reason, bounded so one broad glob cannot
 * flood a hook's output.
 */
const MAX_DISCLOSED_BASIS_PAIRS = 5;

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
    // totem-context: intentional — git's own stderr is not the useful surface here; the refusal must NAME the ref the seat passed, which the wrapper below does
  } catch {
    throw new TotemError(
      'GIT_FAILED',
      `--sha ${echoSafe(trimmed)} does not name a commit in this repository.`,
      'Pass a commit this checkout can resolve (e.g. HEAD), or fetch the missing history first.',
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
      `Could not read the leg's findings at ${echoSafe(options.from)}: ${echoSafe(err instanceof Error ? err.message : String(err))}`,
      'Pass --from <file> pointing at the leg deposit JSON the falsification leg returned.',
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
  /** Print every line of the derived state, but always exit 0. */
  advisory?: boolean;
  /** The head to judge. Any rev git accepts; defaults to `HEAD`. */
  head?: string;
}

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
  /** Ancestry seam handed to core's resolver. */
  git: LegGitAdapter;
  /** Full 40-hex head sha. Throws when the head cannot be resolved. */
  resolveHead(): string;
  /** The push's changed-file set. Throws when the diff cannot be resolved. */
  changedFiles(): Promise<readonly string[]>;
}

/** Exit vocabulary: 0 not owed / evidence · 2 could not derive · 3 owed, no deposit. */
export type LegsGateCode = 0 | 2 | 3;

export interface LegsGateOutcome {
  /** The DERIVED state — what the gate concluded, before any tier mapping. */
  derived: LegsGateCode;
  /** What the process exits with: `derived`, or 0 under `--advisory`. */
  status: LegsGateCode;
  /** stdout lines, in order. Identical for both tiers, by contract. */
  stdout: string[];
  /** stderr lines (the corrupt-deposit sensor rows). */
  stderr: string[];
}

/**
 * Derive the gate's verdict and its lines.
 *
 * The tier is applied ONLY to `status`; `stdout` is produced once, so an
 * advisory run and a strict run of the same state cannot print different text.
 */
export async function runLegsGate(
  options: LegsGateOptions,
  deps: LegsGateDeps,
): Promise<LegsGateOutcome> {
  const path = await import('node:path');
  const { classifyLegsOwed, countLegFindings, findLegDepositForHead, sanitizeForTerminal } =
    await import('@mmnto/totem');

  const advisory = options.advisory === true;
  const finish = (derived: LegsGateCode, stdout: string[], stderr: string[]): LegsGateOutcome => ({
    derived,
    status: advisory ? 0 : derived,
    stdout,
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
  let changed: readonly string[];
  let resolution: Awaited<ReturnType<typeof findLegDepositForHead>> | undefined;
  let owed: ReturnType<typeof classifyLegsOwed> | undefined;
  try {
    head = deps.resolveHead();
    changed = await deps.changedFiles();
    owed = classifyLegsOwed(changed, deps.globs);
    // The store is consulted ONLY when the diff is owed — a not-owed push must
    // not depend on the deposit directory being readable at all.
    if (owed.owed) {
      resolution = findLegDepositForHead(deps.totemDirAbs, head, deps.git);
    }
    // totem-context: intentional — this is not a swallow but the gate's LOUDEST arm: any failure to derive (no repo, an unresolvable head, a branch diff or an ancestry probe that will not resolve) becomes the NOT DERIVED verdict, printed with its cause and exit 2, which the strict pre-push arm blocks on with its own line (mmnto-ai/totem#2698)
  } catch (err) {
    const cause = safe(err instanceof Error ? err.message : String(err));
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
    const days = Number.isNaN(stamp) ? -1 : Math.floor((Date.now() - stamp) / MS_PER_DAY);
    const age = days >= 0 ? `${days} days old` : 'age unknown';
    const reach =
      winner.rank === 'exact'
        ? 'exact'
        : `nearest ancestor, +${winner.distance} commits since the leg read`;
    const stdout = [
      `[Totem] legs evidence: ${relative(winner.path)} (read ${safe(winner.deposit.readAt)}, ${age}) · head ${head8} · ${reach} · blocking=${counts.blocking} material=${counts.material} folded=${counts.folded}`,
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
    const reason =
      candidate.reason === 'not-ancestor' ? 'not an ancestor of head' : 'unknown to this repo';
    stdout.push(`[Totem] legs: stale deposit ${safe(candidate.diffSha.slice(0, 8))}: ${reason}`);
  }
  stdout.push(
    '[Totem] legs: run the leg, then: totem legs deposit --sha HEAD --from <findings.json>',
  );
  return finish(3, stdout, stderr);
}

/**
 * Build the gate's real-world seam from the repo's config and git.
 *
 * Exported so the UNFILTERED-diff contract below is testable against a real
 * checkout without capturing a process exit: a test resolves these deps in a
 * fixture repo and asserts what `changedFiles()` actually returns.
 */
export async function buildLegsGateDeps(options: LegsGateOptions): Promise<LegsGateDeps> {
  const path = await import('node:path');
  const { DEFAULT_LEGS_OWED_GLOBS, safeExec } = await import('@mmnto/totem');
  const { getDiffForReview, isAncestor } = await import('../git.js');
  const { log } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');

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
    distance(base, head) {
      const count = Number.parseInt(
        safeExec('git', ['rev-list', '--count', `${base}..${head}`], { cwd }).trim(),
        10,
      );
      // A throw here reaches the NOT DERIVED arm (the checkout is the repair);
      // a non-numeric answer from a successful rev-list cannot happen, and
      // guessing 0 would print a stale read as an exact one.
      return Number.isNaN(count) ? 0 : count;
    },
  };

  const deps: LegsGateDeps = {
    root,
    totemDirAbs: path.join(root, config.totemDir),
    globs: config.hooks?.legsOwed?.globs ?? [...DEFAULT_LEGS_OWED_GLOBS],
    git,
    resolveHead() {
      return safeExec('git', ['rev-parse', '--verify', `${options.head ?? 'HEAD'}^{commit}`], {
        cwd,
      }).trim();
    },
    async changedFiles() {
      // The push-gate scope (`--branch`): the branch-vs-base diff is what the
      // leg read, and it is what the push actually proposes. An empty result
      // is not owed — there is nothing for a leg to read.
      //
      // UNFILTERED, deliberately (mmnto-ai/totem#2698 fold 1). The same base/head
      // resolution runs, but with an EMPTY ignore configuration, so neither
      // `ignorePatterns` nor `shieldIgnorePatterns` can hide a path from the
      // floor. Those keys carry INDEX-exclusion semantics that were merged into
      // the review/lint diff filter for back-compat (mmnto-ai/totem#1746,
      // mmnto-ai/totem#1748) — letting them narrow this predicate would mean a
      // repo that excludes `README.md` from its index silently stops owing a leg
      // for its public copy, which is the claim-without-mechanism shape the
      // floor exists to close.
      log.info(
        TAG,
        safeLine(
          'Diff source: branch-vs-base (unfiltered — ignorePatterns do not apply to the floor)',
        ),
      );
      const result = await getDiffForReview(
        { branch: true },
        { ignorePatterns: [], shieldIgnorePatterns: [] },
        cwd,
        TAG,
      );
      return 'empty' in result ? [] : result.changedFiles;
    },
  };
  return deps;
}

/**
 * `totem legs gate [--advisory] [--head <ref>]`
 *
 * The reader the strict pre-push arm calls. Loads the repo's config, builds
 * the real git and diff seams, derives, writes SYNCHRONOUSLY, exits with the
 * tier-mapped status.
 */
export async function legsGateCommand(options: LegsGateOptions): Promise<void> {
  const fs = await import('node:fs');
  const deps = await buildLegsGateDeps(options);
  const outcome = await runLegsGate(options, deps);
  for (const line of outcome.stderr) fs.writeSync(2, `${line}\n`);
  // fs.writeSync, not console.log: stdout is a PIPE under the hook, and a
  // piped write is asynchronous on macOS — process.exit could truncate the
  // line the `sh` arm is about to echo.
  for (const line of outcome.stdout) fs.writeSync(1, `${line}\n`);
  process.exit(outcome.status);
}

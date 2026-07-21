// ─── `totem pr merge` — the sanctioned auto-close-safe merge actuator ────────
//
// The B-slice of the auto-close enforcement seam (mmnto-ai/totem#1762, A+B).
// The A-slice PreToolUse interlock reroutes every raw `gh pr merge` here; this is
// the ONE path that is allowed to merge. It:
//   1. asserts the repo merge-config posture (E lever + squash-only) via GraphQL,
//      failing closed on drift (reusing core's evaluateMergeConfigPosture);
//   2. fetches the PR title + body ONLY (never comments — comments never
//      auto-close), zod-validated;
//   3. evaluates title + body against the ONE shared close-keyword evaluator,
//      refusing to merge when an undeclared close-keyword-adjacent ref is present
//      (the totem-close marker is the sole authorizing channel — codex #3);
//   4. merges SQUASH-ONLY with NO body/subject flags (the E-lever BLANK posture
//      means a body flag is the confirmed accidental-close vector), binding the
//      merge to the evaluated snapshot via `--match-head-commit <headRefOid>`;
//   5. optionally (--close-declared) closes the marker-declared targets, else
//      prints the exact (shell-quoted, backtick-free) commands.
//
// CLAIM BOUNDARY (condition 2 — claim no larger than the mechanism): the safety
// assertion is EVALUATION-TIME. `gh pr view` reads the title/body ONCE and the
// evaluator runs on that snapshot. HEAD drift between evaluation and merge is
// closed by `--match-head-commit <headRefOid>` (the merge refuses if the head
// moved). BODY-TEXT drift (a body edited after the read but before the merge) is
// NOT proven by B — the layered D1 (PR-time required check) + D2 (post-merge
// reconciliation) sensors are the loud backstop for that vector. B never claims a
// merge-time text guarantee.
//
// Fail-closed everywhere: any gh/env failure in the pre-merge phase exits 1 with
// NO merge attempted. A merge-queue landing (auto-merge armed / queued) is NOT
// treated as a completed merge — the post-command PR state is re-read and declared
// closes are DEFERRED until it actually lands. GraphQL (not REST) is used for the
// posture read because REST omits the merge-policy fields for non-admin tokens
// (see merge-config.ts).

import { z } from 'zod';

// totem-context: pr.ts is loaded ONLY via `await import('./commands/pr.js')` in index.ts (the lazy-load convention), so this @mmnto/totem barrel import never resolves at CLI `--help` startup — the cold-start rule (mmnto-ai/totem#2339) is N/A here, same as mail.ts / gh-utils.ts.
import {
  type DeclaredIntentRef,
  evaluateMergeConfigPosture,
  type MergeConfigVerdict,
  parseDeclaredCloseIntent,
  safeExec,
  scanPrCorpus,
  TotemError,
} from '@mmnto/totem';

import { GH_TIMEOUT_MS } from '../utils.js';

/** Options for {@link prMergeCommand}. */
export interface PrMergeOptions {
  /** Evaluate posture + auto-close safety and exit 0/1 WITHOUT merging. */
  checkOnly: boolean;
  /** After a successful merge, close marker-declared targets (default: print the commands). */
  closeDeclared: boolean;
}

/** Runs a `gh` subcommand, returning stdout. MUST throw on a non-zero exit (fail-closed). */
export type GhRunner = (args: string[]) => string;

/** Injectable seams for {@link prMergeCommand} (defaults spawn real `gh`). */
export interface PrMergeDeps {
  gh: GhRunner;
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
}

// ─── Validated GitHub surfaces ───────────────────────────────────────────────

/**
 * `gh pr view --json title,body,state,number,headRefOid`. NO comments field —
 * comments never auto-close, so they are never fetched or scanned. `body` is
 * coerced from a possible null to '' (gh emits null for an empty description).
 */
export const PrViewSchema = z.object({
  title: z.string(),
  body: z
    .string()
    .nullish()
    .transform((v) => v ?? ''),
  state: z.string(),
  number: z.number(),
  headRefOid: z.string(),
});
export type PrView = z.infer<typeof PrViewSchema>;

/** `gh pr view N --json state,mergedAt` — the post-command landing check (codex B-5). */
export const PrMergeStateSchema = z.object({
  state: z.string(),
  mergedAt: z.string().nullish(),
});

/**
 * A positive-decimal PR number. `gh pr view` officially accepts a NUMBER, a URL,
 * or a branch — a URL/branch positional lets an arbitrary PR (a DIFFERENT repo) be
 * looked up while the merge actuates in the current repo (the confused-deputy
 * vector, codex B-2). We accept ONLY `[1-9][0-9]*`.
 */
const PR_NUMBER_RE = /^[1-9][0-9]*$/;

/**
 * Reject any PR positional that is not a positive decimal (codex B-2). Called at
 * BOTH the Commander boundary (index.ts action) and the command boundary
 * (prMergeCommand) so no path forwards a URL/branch to `gh pr view`. `undefined`
 * (no positional — merge the current branch's PR) is allowed.
 */
export function assertValidPrNumberArg(arg: string | undefined): void {
  if (arg === undefined) return;
  if (!PR_NUMBER_RE.test(arg)) {
    throw new TotemError(
      'PR_MERGE_FAILED',
      `invalid PR argument "${arg}" — expected a positive decimal PR number`,
      'pass a bare PR number (e.g. `totem pr merge 1762`), or omit it to merge the current branch’s PR. ' +
        'A URL or branch name is refused: it could resolve a PR in a different repo than the one being merged.',
    );
  }
}

/** The GraphQL `repository` merge-policy fields (all nullable per token visibility). */
const MergeConfigGraphqlSchema = z
  .object({
    squashMergeAllowed: z.boolean().nullish(),
    mergeCommitAllowed: z.boolean().nullish(),
    rebaseMergeAllowed: z.boolean().nullish(),
    squashMergeCommitTitle: z.string().nullish(),
    squashMergeCommitMessage: z.string().nullish(),
  })
  .passthrough();

// The merge-config posture query — GraphQL, not REST (merge-config.ts records why:
// REST hides these fields from non-admin tokens; GraphQL reads them with a plain
// token). Kept verbatim in sync with tools/autoclose-pr.mjs (the D1 glue).
const MERGE_CONFIG_QUERY =
  'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ' +
  'squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed ' +
  'squashMergeCommitTitle squashMergeCommitMessage } }';

// ─── Pure evaluators (no I/O — the tested surface) ───────────────────────────

/** Result of evaluating a PR's title + body for undeclared auto-close refs. */
export interface PrMergeEvaluation {
  /** True iff every close-keyword-adjacent ref is marker-authorized. */
  ok: boolean;
  /** Normalized keys of every close-keyword-adjacent ref found. */
  findings: string[];
  /** Normalized keys authorized by a totem-close marker. */
  declaredByMarker: string[];
  /** Findings NOT authorized by a marker — these refuse the merge. */
  undeclared: string[];
}

/**
 * Evaluate a PR's title + body against the ONE shared close-keyword evaluator.
 * Reuses core's {@link scanPrCorpus} (which composes `findAutoCloseRefs` +
 * `parseDeclaredCloseIntent` + the marker-strip) over the title + body ONLY — no
 * commit messages, no comments. `closingIssuesReferences` is GitHub-derived and
 * therefore non-authorizing (codex #3), so the client wrapper passes `[]`.
 */
export function evaluatePrMerge(pr: {
  title: string;
  body: string;
  repo: string;
}): PrMergeEvaluation {
  const scan = scanPrCorpus({
    title: pr.title,
    body: pr.body,
    commitMessages: [],
    closingIssuesReferences: [],
    repo: pr.repo,
  });
  return {
    ok: scan.ok,
    findings: scan.findings,
    declaredByMarker: scan.declaredByMarker,
    undeclared: scan.undeclared,
  };
}

/**
 * Flags a merge argv must NEVER contain: any body/subject vector. Under the BLANK
 * squash posture a `--body`/`-b`/`--body-file`/`-F`/`-t`/`--subject` is the
 * confirmed accidental-close vector, so the constructed argv is asserted (not just
 * the behavior) to exclude them.
 */
export const FORBIDDEN_MERGE_FLAGS = ['-b', '--body', '-F', '--body-file', '-t', '--subject'];

/**
 * Build the squash-only merge argv. NO body/subject flags, EVER (asserted in
 * tests). Binds the merge to the resolved `repo` (same identity `gh pr view` used
 * — codex B-2) and to the evaluated snapshot via `--match-head-commit <headRefOid>`
 * (codex Q / Greptile P1 / CR): the merge refuses if HEAD moved after evaluation.
 */
export function buildMergeArgv(prNumber: number, repo: string, headRefOid: string): string[] {
  return [
    'pr',
    'merge',
    String(prNumber),
    '--repo',
    repo,
    '--squash',
    '--match-head-commit',
    headRefOid,
  ];
}

/**
 * Build the `gh issue close` argv for a marker-declared target (opt-in
 * --close-declared). Binds to the ref's qualifier when present, else the resolved
 * `repo` (same identity as the merge). The comment carries NO backticks (they
 * execute as command substitution if the printed line is pasted — codex NB-1) and
 * no close-keyword adjacent to the digit ref (the word before `#N` is `PR`).
 */
export function buildIssueCloseArgv(
  ref: DeclaredIntentRef,
  prNumber: number,
  repo: string,
): string[] {
  const comment =
    `Auto-close guard: declared close target for PR #${prNumber}, merged via ` +
    'totem pr merge --close-declared. mmnto-ai/totem#1762.';
  return [
    'issue',
    'close',
    String(ref.issue),
    '--repo',
    ref.qualifier ?? repo,
    '--comment',
    comment,
  ];
}

/**
 * Shell-quote a single argv token for a COPY-PASTE-runnable display line
 * (codex NB-1). OS-appropriate: PowerShell single-quotes (embedded `'` doubled)
 * on Windows, POSIX single-quotes (embedded `'` → `'\''`) elsewhere. A token with
 * no shell-special char is left bare.
 */
export function quoteArgForDisplay(token: string): string {
  if (/^[A-Za-z0-9_./:=-]+$/.test(token)) return token;
  if (process.platform === 'win32') {
    return `'${token.replace(/'/g, "''")}'`;
  }
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** Render a `gh <argv>` line that is safe to copy-paste into the user's shell. */
export function displayGhCommand(argv: string[]): string {
  return `gh ${argv.map(quoteArgForDisplay).join(' ')}`;
}

/** Human label for a declared ref (`owner/repo#N` or `#N`). */
function refLabel(ref: DeclaredIntentRef): string {
  return ref.qualifier ? `${ref.qualifier}#${ref.issue}` : `#${ref.issue}`;
}

// ─── I/O helpers ─────────────────────────────────────────────────────────────

function defaultGh(cwd: string): GhRunner {
  return (args: string[]) =>
    safeExec('gh', args, {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
}

function resolveDeps(input: Partial<PrMergeDeps>): PrMergeDeps {
  const cwd = input.cwd ?? process.cwd();
  return {
    cwd,
    gh: input.gh ?? defaultGh(cwd),
    out: input.out ?? ((t) => process.stdout.write(t)),
    err: input.err ?? ((t) => process.stderr.write(t)),
  };
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveRepo(gh: GhRunner): string {
  const raw = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(raw)) {
    throw new TotemError(
      'PR_MERGE_FAILED',
      `could not resolve owner/repo from \`gh repo view\` (got "${raw}")`,
      'run inside a GitHub repository with `gh` authenticated (`gh auth status`).',
    );
  }
  return raw;
}

function assertPosture(gh: GhRunner, repo: string): MergeConfigVerdict {
  const [owner, name] = repo.split('/');
  const raw = gh([
    'api',
    'graphql',
    '-f',
    `query=${MERGE_CONFIG_QUERY}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '--jq',
    '.data.repository',
  ]);
  const r = MergeConfigGraphqlSchema.parse(JSON.parse(raw));
  return evaluateMergeConfigPosture({
    squash_merge_commit_title: r.squashMergeCommitTitle,
    squash_merge_commit_message: r.squashMergeCommitMessage,
    allow_squash_merge: r.squashMergeAllowed,
    allow_merge_commit: r.mergeCommitAllowed,
    allow_rebase_merge: r.rebaseMergeAllowed,
  });
}

function fetchPr(gh: GhRunner, prNumberArg: string | undefined, repo: string): PrView {
  // Bind the lookup to the SAME resolved repo as the merge (codex B-2): with an
  // explicit --repo, an out-of-repo PR positional cannot be looked up here.
  const args = [
    'pr',
    'view',
    ...(prNumberArg ? [prNumberArg] : []),
    '--repo',
    repo,
    '--json',
    'title,body,state,number,headRefOid',
  ];
  return PrViewSchema.parse(JSON.parse(gh(args)));
}

/** Re-read the PR's landing state after `gh pr merge` (codex B-5). */
function fetchMergeState(gh: GhRunner, prNumber: number, repo: string): z.infer<typeof PrMergeStateSchema> {
  const raw = gh(['pr', 'view', String(prNumber), '--repo', repo, '--json', 'state,mergedAt']);
  return PrMergeStateSchema.parse(JSON.parse(raw));
}

// ─── The command ─────────────────────────────────────────────────────────────

/**
 * `totem pr merge [number]`. Returns an exit code (the index wrapper sets
 * process.exitCode) — 0 on a clean merge / clean --check-only / a queued
 * (merge-queue) landing, 1 on an invalid PR argument, posture drift, an undeclared
 * close-keyword ref, any gh/env failure in the pre-merge phase (fail-closed, NO
 * merge attempted), or a `--close-declared` run where a requested close failed.
 *
 * `assertValidPrNumberArg` runs FIRST (before any gh call) so a URL/branch
 * positional is refused up front (codex B-2); it throws a TotemError that
 * propagates to the index handler.
 */
export async function prMergeCommand(
  prNumberArg: string | undefined,
  opts: PrMergeOptions,
  depsInput: Partial<PrMergeDeps> = {},
): Promise<{ exitCode: number }> {
  const { gh, out, err } = resolveDeps(depsInput);

  // Refuse a non-decimal PR positional before touching gh (the confused-deputy
  // guard, codex B-2). Throws TotemError → index.ts handleError → exit 1.
  assertValidPrNumberArg(prNumberArg);

  // ── Phase 1: resolve + assert posture + fetch + evaluate — all fail-closed ──
  let repo: string;
  let pr: PrView;
  let evaluation: PrMergeEvaluation;
  try {
    repo = resolveRepo(gh);
    const posture = assertPosture(gh, repo);
    if (!posture.conforms) {
      err(`[totem pr merge] ${posture.message}\n`);
      return { exitCode: 1 };
    }
    pr = fetchPr(gh, prNumberArg, repo);
    if (pr.state !== 'OPEN') {
      err(
        `[totem pr merge] PR #${pr.number} is ${pr.state}, not OPEN — nothing to merge. ` +
          'Failing closed (no merge attempted).\n',
      );
      return { exitCode: 1 };
    }
    evaluation = evaluatePrMerge({ title: pr.title, body: pr.body, repo });
    // totem-context: intentional fail-closed exit-code boundary — any gh/env failure in the pre-merge phase is surfaced LOUDLY via err() and returns exit 1 with NO merge attempted (the custom exit-code contract, like mail/ecl-gc), never silent degradation (Tenet 4).
  } catch (e) {
    err(
      '[totem pr merge] pre-merge check failed — failing closed, NO merge attempted: ' +
        `${messageOf(e)}\n`,
    );
    return { exitCode: 1 };
  }

  if (!evaluation.ok) {
    err(
      `[totem pr merge] BLOCKED: PR #${pr.number} title/body carries close-keyword-adjacent ` +
        `issue ref(s) not authorized by a totem-close marker: ${evaluation.undeclared.join(', ')}.\n` +
        'GitHub auto-closes a linked issue from a PR title / squash body carrying this pattern ' +
        '(even under negation).\n' +
        'Declare each INTENDED close with a `<!-- totem-close: #N -->` marker (or a `Totem-Close: #N` ' +
        'trailer) in the PR body — the sole authorizing channel — then re-run. Otherwise rephrase to ' +
        'a non-keyword form (references / see / tracks). NO merge attempted. mmnto-ai/totem#1762.\n',
    );
    return { exitCode: 1 };
  }

  if (opts.checkOnly) {
    out(
      `[totem pr merge] --check-only PASS: merge-config posture conforms and PR #${pr.number} ` +
        'carries no undeclared close-keyword refs. No merge attempted.\n',
    );
    return { exitCode: 0 };
  }

  // ── Phase 2: merge — SQUASH-ONLY, NO body/subject flags, bound to repo + head ──
  try {
    gh(buildMergeArgv(pr.number, repo, pr.headRefOid));
    // totem-context: intentional fail-closed exit-code boundary — a merge failure is surfaced LOUDLY (gh stderr passed through) and returns exit 1; not a silent swallow (Tenet 4).
  } catch (e) {
    err(
      `[totem pr merge] \`gh pr merge --squash --match-head-commit\` failed: ${messageOf(e)}\n` +
        'If this was a head-mismatch (HEAD advanced since evaluation), re-run `totem pr merge` to ' +
        're-evaluate the new snapshot before merging. NO closes attempted.\n',
    );
    return { exitCode: 1 };
  }

  // Merge-queue semantics (codex B-5): a zero exit from `gh pr merge` may mean the
  // PR was ADDED TO A QUEUE / auto-merge was ARMED, not that it landed. Re-read the
  // state; only a MERGED PR proceeds to the merged message + declared-close phase.
  let landingState: string;
  try {
    landingState = fetchMergeState(gh, pr.number, repo).state;
  } catch (e) {
    // The merge command already returned 0; if we cannot confirm the landing state
    // we DEFER closes (conservative) rather than closing against an unproven merge.
    err(
      `[totem pr merge] merged PR #${pr.number}, but could not confirm the landing state ` +
        `(${messageOf(e)}). Declared closes were NOT executed — confirm the merge landed, then ` +
        'close the declared targets manually.\n',
    );
    return { exitCode: 0 };
  }

  if (landingState !== 'MERGED') {
    // Queued / auto-merge armed: the PR has not landed yet. Closing declared issues
    // now would close them against an unmerged PR — DEFER them.
    const declaredRefs = parseDeclaredCloseIntent([pr.title, pr.body].join('\n'));
    out(
      `[totem pr merge] PR #${pr.number} is ${landingState}, not yet MERGED — a merge queue / ` +
        'auto-merge is in effect. The PR will land when its checks pass.\n' +
        (declaredRefs.length > 0
          ? 'Declared closes are DEFERRED until it lands. After it merges, run these to close them:\n' +
            declaredRefs.map((ref) => `  ${displayGhCommand(buildIssueCloseArgv(ref, pr.number, repo))}\n`).join('')
          : ''),
    );
    return { exitCode: 0 };
  }

  out(`[totem pr merge] merged PR #${pr.number} (--squash).\n`);

  // ── Phase 3: marker-declared closes (opt-in; default prints the commands) ──
  const declaredRefs = parseDeclaredCloseIntent([pr.title, pr.body].join('\n'));
  if (declaredRefs.length === 0) {
    return { exitCode: 0 };
  }

  if (!opts.closeDeclared) {
    out(
      '[totem pr merge] marker-declared closes were NOT executed (default). Run these to close them:\n',
    );
    for (const ref of declaredRefs) {
      out(`  ${displayGhCommand(buildIssueCloseArgv(ref, pr.number, repo))}\n`);
    }
    return { exitCode: 0 };
  }

  // Continue through ALL declared targets (the merge is irreversible), but track
  // failures: the final exit code is 1 when any requested close failed (codex B-4),
  // so automation never gets a false all-actions-success signal.
  const failed: string[] = [];
  for (const ref of declaredRefs) {
    try {
      gh(buildIssueCloseArgv(ref, pr.number, repo));
      out(`[totem pr merge] closed ${refLabel(ref)} (marker-declared).\n`);
      // totem-context: the merge already landed (irreversible), so a per-issue close failure is annotated LOUDLY via err() and the loop continues — a post-merge cleanup sensor, not a silent swallow (Tenet 4).
    } catch (e) {
      // The merge already landed (irreversible), so a close failure is annotated
      // loudly and the loop continues — the merge is the primary act.
      failed.push(refLabel(ref));
      err(
        `[totem pr merge] could NOT close ${refLabel(ref)}: ${messageOf(e)} — ` +
          'close it manually (the merge already landed).\n',
      );
    }
  }

  if (failed.length > 0) {
    err(
      `[totem pr merge] ${failed.length} declared close(s) FAILED: ${failed.join(', ')}. ` +
        'The merge landed; close the listed target(s) manually. Exiting non-zero.\n',
    );
    return { exitCode: 1 };
  }

  return { exitCode: 0 };
}

/**
 * Raw-merge command matcher — the harness-boundary half of the auto-close
 * enforcement seam (mmnto-ai/totem#1762, A+B slice; ADR-082 Amendment 1).
 *
 * The A-slice PreToolUse interlock (Claude `Bash` + Gemini `run_shell_command`)
 * DENIES an agent's attempt to merge a PR outside the sanctioned `totem pr merge`
 * actuator, so the shared receipt evaluator (B) is never bypassed. This module is
 * the ONE shared detector both rendered hosts inline (via `JSON.stringify` — the
 * same drift-locked local-mirror shape as `AUTO_CLOSE_REGEX_SOURCE`), and that B's
 * tests read. It never authors a second copy of the pattern.
 *
 * The input is a shell COMMAND STRING (the `Bash`/`run_shell_command` payload),
 * not a parsed argv. We do NOT tokenize a shell — that is undecidable in general
 * (aliases, functions, `eval`, injected spawns; the mmnto-ai/totem#2460 class).
 * Instead we enforce a **presence invariant with a deny-on-undecidable arm**:
 *
 *   1. `gh pr merge` — ANY flags, bodyless included; tolerant of common quoting
 *      (individually quoted tokens, `gh.exe`, a leading PowerShell `&`) and of
 *      inherited flag tokens spliced between words (`gh --repo o/r pr merge`,
 *      `gh pr --repo o/r merge` — `-R/--repo` is an official inherited flag and a
 *      natural cross-repo form; kimi B-2 + codex B-1). Line-wrapped invocations
 *      (`\`+LF in sh, `^`+LF in cmd.exe) are recognized too (kimi B-3). Matched
 *      regardless of a `--body`/`--body-file`/`-F`/`-t` payload — the point is to
 *      reroute the WHOLE invocation, so a hidden body cannot slip a merge past.
 *   2. `gh api … /pulls/{n}/merge` — the raw merge-API vector with a LITERAL
 *      decimal PR number (`gh pr merge` under a different name).
 *   3. `gh pr` immediately followed by a command-substitution / variable
 *      continuation (`$(…)`, `${…}`, `$VAR`, a backtick) — the subcommand is
 *      UNDECIDABLE, so we deny (license condition 2: deny-on-undecidable, never
 *      guess it is safe).
 *   4. `gh api` followed by a `$`/backtick continuation, OR a `gh api …/merge`
 *      REST path whose PR segment is a variable/substitution (`…/pulls/$PR/merge`)
 *      — the endpoint is UNDECIDABLE before shell expansion, so we deny for the
 *      merge-API family exactly as arm 3 does for `gh pr` (kimi NB-1 deny
 *      direction; codex B-1 variable REST form).
 *   5. `gh api graphql … mergePullRequest …` — the GraphQL merge mutation, a
 *      third door to the same raw merge (kimi NB-2). Presence-invariant token
 *      match; it does not fire on an unrelated `gh api graphql` read.
 *
 * It MUST NOT over-fire on the read-only `gh pr` verbs (`view`, `checkout`,
 * `diff`, `list`, …) or on `gh pr merge` embedded in a larger word
 * (`foogh pr merge`, `gh-pr-merge`).
 *
 * BOUNDED-SURFACE HONESTY (condition 2): this matcher claims exactly "block
 * recognizable raw-merge invocations in a shell command string at this harness".
 * It does not defeat an aliased/renamed `gh`, a shell function wrapping the call,
 * or a spawn injected through a helper it cannot see (mmnto-ai/totem#2460).
 *
 * RECORDED GAPS (unclaimed, not silent — condition 2 honesty):
 *   - a VISIBLE-TOKEN splice a shell concatenates back into the keyword —
 *     `gh pr me''rge`, `gh "p""r" merge`, or a `bash -c "gh \"pr\" merge"`
 *     re-quoting layer — executes a real merge yet reads as non-adjacent tokens
 *     here (kimi NB-3).
 *   - a command SUBSTITUTION replacing the SUBCOMMAND word — `gh $(echo pr) merge`,
 *     `gh "$SUB" merge` — the `pr`/`api` token itself is produced by expansion the
 *     matcher cannot see (strategy-claude NB). The boundary is the SUBCOMMAND, not
 *     the binary: `$GH pr merge` DOES match (the lookbehind admits a `$`-led,
 *     `gh`-less prefix and the literal `pr merge` is still present), and `gh pr $(…)`
 *     is caught by the deny-on-undecidable arm — the uncaught case is specifically a
 *     substitution standing in for the `pr`/`api` word.
 * The layered D1 (PR-time required check) + D2 (post-merge reconciliation) sensors
 * are the loud backstop for anything that transits this bounded surface.
 */

/**
 * One inter-token separator unit: an ASCII quote, any whitespace, or a shell
 * (`\`+LF) / cmd.exe (`^`+LF) line-continuation. Folding the continuation into
 * the separator class means a long, dangerous merge command wrapped across lines
 * is still recognized (kimi B-3). Non-capturing so the classify group indices
 * below stay stable.
 */
const SEP = "(?:['\"\\s]|(?:\\\\|\\^)\\r?\\n)";

/**
 * A run of interspersed flag tokens between two command words — zero or more of
 * (separators, a `-x`/`--word` flag, an optional `=value` or space-separated
 * value that does not itself start a flag). Admits an inherited `-R/--repo o/n`
 * spliced between `gh`↔`pr` or `pr`↔`merge` (a natural cross-repo form; kimi B-2
 * + codex B-1) while a bare non-flag word (`view`, `list`) stops the run, so the
 * read-only verbs never resolve to `merge`. Non-capturing (stable group indices).
 */
const FLAGRUN =
  '(?:' + SEP + "+-{1,2}[\\w-]+(?:=[^\\s'\"]+|" + SEP + "+[^\\s'\"-][^\\s'\"]*)?)*";

/**
 * A within-one-command span char: anything EXCEPT a shell command separator
 * (`;` `|` `&`) or a newline. The `gh api …` merge-path arms scan across this
 * class (not `[\s\S]`) so a merge path on the far side of a separator
 * (`gh api /user; echo /pulls/5/merge`) is NOT mistaken for a reachable merge —
 * a separator inside the path breaks it for gh too, so denial coverage is
 * preserved (Greptile P2). Also bounds the lazy re-scan kimi measured (NB-6).
 */
const NOSEP = '[^;|&\\r\\n]';

/**
 * Canonical raw-merge command pattern (apply flags `gi` when compiling). ONE
 * string, five ordered alternatives, each with a sentinel capture group so
 * {@link findMergeInvocations} can classify which vector matched:
 *
 *   - `(?<![\w-])gh(?:\.exe)?` + {@link FLAGRUN} + {@link SEP}`+` — a `gh` (or
 *     `gh.exe`) TOKEN (the lookbehind rejects a preceding word/dash char, so
 *     `foogh`/`gh-pr` do not match), then optional spliced flags, then ≥1
 *     separator, so individually quoted tokens (`"gh" "pr"`, `& gh pr`) and a
 *     cross-repo `--repo` flag still resolve.
 *   - group 1 `(pr\b` FLAGRUN SEP`+ merge)(?![\w-])` — `gh pr merge` (form
 *     `gh-pr-merge`), flags tolerated between `pr` and `merge`. The trailing
 *     `(?![\w-])` keeps `merge` a whole token (`merged`, `merge-queue` do not
 *     match).
 *   - group 2 `(api\b[\s\S]*?/pulls/\d+/merge)(?![\w-])` — a raw
 *     `/pulls/{n}/merge` API path with a LITERAL PR number (form `gh-api-merge`).
 *   - group 3 `(pr\b` SEP`*(?:$|` + backtick + `))` — `gh pr` then a `$`/backtick
 *     continuation (form `gh-pr-undecidable`, deny-on-undecidable).
 *   - group 4 `(api\b` SEP`*(?:$|`+backtick+`)|api\b[\s\S]*?(?:$|`+backtick+`)[\s\S]*?/merge\b)`
 *     — `gh api` with a `$`/backtick continuation or a variable REST merge path
 *     (form `gh-api-undecidable`, deny-on-undecidable).
 *   - group 5 `(api\b[\s\S]*?graphql[\s\S]*?mergePullRequest)(?![\w-])` — the
 *     GraphQL merge mutation (form `gh-api-merge`).
 */
export const MERGE_COMMAND_REGEX_SOURCE =
  "(?<![\\w-])gh(?:\\.exe)?" +
  FLAGRUN +
  SEP +
  '+' +
  '(?:' +
  '(pr\\b' +
  FLAGRUN +
  SEP +
  '+merge)(?![\\w-])' +
  '|(api\\b' +
  NOSEP +
  '*?/pulls/\\d+/merge)(?![\\w-])' +
  '|(pr\\b' +
  SEP +
  '*(?:\\$|`))' +
  '|(api\\b' +
  SEP +
  '*(?:\\$|`)|api\\b' +
  NOSEP +
  '*?(?:\\$|`)' +
  NOSEP +
  '*?/merge\\b)' +
  '|(api\\b' +
  NOSEP +
  '*?graphql' +
  NOSEP +
  '*?mergePullRequest)(?![\\w-])' +
  ')';

/** The raw-merge vector a {@link MergeInvocation} was matched under. */
export type MergeInvocationForm =
  | 'gh-pr-merge'
  | 'gh-api-merge'
  | 'gh-pr-undecidable'
  | 'gh-api-undecidable';

/** One recognized raw-merge invocation found in a shell command string. */
export interface MergeInvocation {
  /** Which vector matched (see {@link MergeInvocationForm}). */
  form: MergeInvocationForm;
  /** Byte offset of the match start within the scanned command. */
  index: number;
}

/** Fresh, correctly-flagged regex per call (the `g` flag makes it stateful). */
function compile(): RegExp {
  return new RegExp(MERGE_COMMAND_REGEX_SOURCE, 'gi');
}

/**
 * Scan a shell command string for every recognizable raw-merge invocation. Zero
 * shell semantics — presence-invariant with the deny-on-undecidable arms. An empty
 * result means the command carried no recognizable `gh pr merge` / raw merge-API /
 * `gh pr`-substitution vector; the interlock allows those (its bounded claim).
 */
export function findMergeInvocations(command: string): MergeInvocation[] {
  if (typeof command !== 'string' || command.length === 0) return [];
  const out: MergeInvocation[] = [];
  for (const m of command.matchAll(compile())) {
    // Group layout: 1 = gh pr merge; 2 = gh api …/pulls/N/merge (literal);
    // 3 = gh pr $(…); 4 = gh api $(…) / variable REST merge; 5 = graphql merge.
    let form: MergeInvocationForm;
    if (m[1] !== undefined) form = 'gh-pr-merge';
    else if (m[2] !== undefined) form = 'gh-api-merge';
    else if (m[3] !== undefined) form = 'gh-pr-undecidable';
    else if (m[4] !== undefined) form = 'gh-api-undecidable';
    else form = 'gh-api-merge'; // group 5 — graphql mergePullRequest mutation
    out.push({ form, index: m.index ?? 0 });
  }
  return out;
}

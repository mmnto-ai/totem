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
 *      natural cross-repo form; kimi B-2 + codex B-1). A flag's value may be
 *      `=`-joined AND quoted (`--repo='o/r'`, `--repo="$REPO"`; codex round-2 B-1
 *      quoted `=value` bypass), space-separated (`--repo o/r`), OR GLUED with no
 *      separator the way pflag accepts a short flag's value (`-Rmmnto-ai/totem`;
 *      kimi round-2 BLOCKING-4 — the glued tail is non-whitespace only, so it stops
 *      at the space before the subcommand and never swallows a following `merge`).
 *      Line-wrapped invocations (`\`+LF in sh, `^`+LF in cmd.exe) are recognized
 *      (kimi B-3). Matched regardless of a `--body`/`--body-file`/`-F`/`-t` payload
 *      — the point is to reroute the WHOLE invocation, so a hidden body cannot slip
 *      a merge past.
 *   2. `gh api … /pulls/{n}/merge` — the raw merge-API vector with a LITERAL
 *      decimal PR number (`gh pr merge` under a different name).
 *   3. `gh pr` immediately followed by a command-substitution / variable
 *      continuation (`$(…)`, `${…}`, `$VAR`, a backtick) — the subcommand is
 *      UNDECIDABLE, so we deny (license condition 2: deny-on-undecidable, never
 *      guess it is safe).
 *   4. `gh api` whose endpoint is UNDECIDABLE before shell expansion, so we deny
 *      for the merge-API family exactly as arm 3 does for `gh pr`:
 *        - a `$`/backtick/`%`/`!` continuation after `gh api` and any inherited
 *          flags (`gh api $EP`, `gh api "$ENDPOINT"`, `gh api --method PUT "$EP"`,
 *          `gh api %ENDPOINT%` — the entire endpoint is a variable; codex B-1
 *          round-2), OR
 *        - a `…/merge` REST path whose PR segment is a variable/substitution —
 *          `$PR`, `${PR}`, a backtick, or the cmd.exe `%PR%` / delayed `!PR!`
 *          shapes (`…/pulls/$PR/merge`, `…/pulls/%PR%/merge`; kimi NB-1 deny
 *          direction, codex B-1 variable REST form + round-2 cmd.exe vars).
 *   5. `gh api graphql … mergePullRequest …` — the GraphQL merge mutation, a
 *      third door to the same raw merge (kimi NB-2). Presence-invariant token
 *      match; it does not fire on an unrelated `gh api graphql` read.
 *
 * LINE-CONTINUATION HARDENING (kimi round-2 BLOCKING-5): the `\`+LF / `^`+LF fold
 * of B-3 only reached the SEP-separated words. The merge-API / graphql arms scan
 * spans and match rigid literals (`/pulls/`, `/merge`, `graphql`,
 * `mergePullRequest`), so a continuation SPLICED into the path executed a real
 * merge while the matcher saw a broken span and allowed it. Now the span class
 * ({@link NOSEP}) admits a continuation unit AND each literal is threaded with an
 * optional continuation between characters (see {@link contLit}), so a splice
 * anywhere — `gh api \⏎…/pulls/5/merge`, `…/pulls/5/\⏎merge`, cmd.exe `^`+CRLF,
 * `…/pulls/$PR/\⏎merge`, `gh api graphql \⏎…mergePullRequest`, and mid-token
 * splices — is still recognized. The fix is at the PATTERN level (both inlined
 * hosts get it), never an in-hook pre-scan (that would fork the two-host surface).
 *
 * It MUST NOT over-fire on the read-only `gh pr` verbs (`view`, `checkout`,
 * `diff`, `list`, …) — even carrying a spliced quoted flag (`gh pr --repo="x"
 * view 5`; codex round-2 negative) or a glued one (`gh pr -Rfoo/bar view 5`; kimi
 * round-2) — or on `gh pr merge` embedded in a larger word (`foogh pr merge`,
 * `gh-pr-merge`). No flag-value class consumes a shell command separator (`;` `|`
 * `&`) or a newline, so a run never crosses a command boundary (`gh --repo o/r;
 * pr merge` does NOT block; codex round-2 NB).
 *
 * LINEARITY (codex round-2 BLOCKING — catastrophic backtracking): every nested
 * quantifier ranges over a character class DISJOINT from its neighbors — a
 * separator (`SEP`, quotes/whitespace/line-continuation) never overlaps a flag
 * lead (`-`) and neither overlaps a value head. In particular the flag NAME is
 * `-{1,2}[\w]…` (a word char is REQUIRED after the dashes; the earlier
 * `-{1,2}[\w-]+` let `[\w-]`'s first char overlap `-{1,2}`, giving every `--flag`
 * two parses → 2^N total backtracks: a non-matching command took 6.46s at 26
 * repeated flag groups). The `gh api …` span is a BOUNDED lazy quantifier
 * (`{0,2000}?`, kimi round-2 NB-1) so a separator-free filler cannot make it scan
 * the whole remainder like `[\s\S]` did. With the overlaps removed and the span
 * bounded the construction is linear; the adversarial perf fixtures in
 * command-matcher.test.ts PROVE it for BOTH shapes — repeated flag groups AND the
 * separator-free NOSEP filler — <50ms at the adversarial sizes (measured, not
 * claimed). (safe-regex2 still rejects the pattern on its conservative star-height
 * heuristic; that heuristic cannot see the disjoint-class structure that makes it
 * linear, so the timing fixtures are the authoritative gate, not safe-regex2.)
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
 * RECORDED FRICTION (kimi round-2 NB-2 — a false-DENY, defensible, not disambiguated):
 *   - `gh pr --label merge list` BLOCKS. A `merge`-valued flag placed BEFORE the
 *     subcommand makes the `merge`-token binding genuinely ambiguous, and
 *     deny-on-undecidable answers "deny". Disambiguating it would need a real shell
 *     parser; the natural `gh pr list --label merge` order stays clean.
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
const SEP = '(?:[\'"\\s]|(?:\\\\|\\^)\\r?\\n)';

/**
 * Zero or more shell (`\`+LF) / cmd.exe (`^`+LF) line-continuations at a single
 * splice point. Threaded between the characters of the rigid merge-path / graphql
 * literals (see {@link contLit}) so a continuation spliced mid-path — which the
 * shell removes before `gh` runs — cannot break the literal and slip a merge past
 * (kimi round-2 BLOCKING-5). Zero-width when there is no continuation, so it costs
 * nothing on ordinary input.
 */
const CONT = '(?:(?:\\\\|\\^)\\r?\\n)*';

/**
 * A within-one-command span UNIT: a line-continuation (so the `gh api …` arms see
 * across a `\`+LF / `^`+LF, kimi round-2 BLOCKING-5) OR any char EXCEPT a shell
 * command separator (`;` `|` `&`) or a bare newline. The merge-path arms scan this
 * (not `[\s\S]`) so a merge path on the far side of a separator
 * (`gh api /user; echo /pulls/5/merge`) is NOT mistaken for a reachable merge — a
 * separator inside the path breaks it for gh too, so denial coverage is preserved
 * (Greptile P2).
 */
const NOSEP_UNIT = '(?:(?:\\\\|\\^)\\r?\\n|[^;|&\\r\\n])';

/**
 * A BOUNDED lazy span of {@link NOSEP_UNIT} (`{0,2000}?`, not `*?`). A real
 * `gh api …/merge` path segment has no business exceeding ~2 KB; bounding it stops
 * a separator-free filler from making the lazy scan cover the whole remainder like
 * the old `[\s\S]`/`*?` did (kimi round-2 NB-1 — a ~42× regression measured on a
 * 152 KB separator-free input). Part of the same linearity mandate as the FLAGRUN
 * backtracking fix; the perf fixtures cover both shapes.
 */
const NOSEP = NOSEP_UNIT + '{0,2000}?';

/**
 * An OPTIONAL `=`-joined or space-separated flag value. The `=` arm admits a
 * single-quoted, double-quoted, or bare value, so `--repo='o/r'` / `--repo="$REPO"`
 * (a quoted `=value`, incl. a quoted variable) no longer bypass the bare-only
 * `=[^\s'"]+` arm (codex B-1 round-2); a quoted value is self-delimiting. The
 * space arm is a `SEP+`-led bare value (`--repo o/r`); a space-separated QUOTED
 * value (`-R 'o/r'`) needs no dedicated arm because `SEP` already includes the
 * quote. Every value class excludes the shell command separators `;` `|` `&`
 * (finding 5, codex round-2 NB) and — via `\s` — newlines, so a value can never
 * straddle a command boundary. The space-value HEAD additionally excludes `-` so
 * the next `-`-led flag is never mis-consumed as this flag's value.
 */
const FLAGVAL = '(?:=(?:\'[^\']*\'|"[^"]*"|[^\\s\'";|&]*)|' + SEP + '+[^\\s\'";|&-][^\\s\'";|&]*)?';

/**
 * ONE flag token: the dashes + NAME (`-{1,2}[\w]` — a word char REQUIRED after the
 * dashes so `-{1,2}` and the name never overlap on `-`, the disjoint-class rule
 * that removes the 2^N backtracking), then a GLUED tail of non-separator, non-`=`
 * chars (`[^\s'";|&=]*` — this is how pflag reads a short flag's glued value, e.g.
 * `-Rmmnto-ai/totem`; kimi round-2 BLOCKING-4; the tail is non-whitespace so it
 * stops before the subcommand and never swallows a following `merge`), then an
 * optional {@link FLAGVAL}. `=` is excluded from the glued tail so a `--repo="x"`
 * routes to FLAGVAL's quoted `=value` arm rather than being half-eaten.
 */
const FLAGTOKEN = '-{1,2}[\\w][^\\s\'";|&=]*' + FLAGVAL;

/**
 * A run of interspersed flag tokens between two command words — zero or more of
 * (separators, a {@link FLAGTOKEN}). Admits an inherited `-R/--repo o/n` spliced
 * between `gh`↔`pr` or `pr`↔`merge` (a natural cross-repo form; kimi B-2 + codex
 * B-1) while a bare non-flag word (`view`, `list`) stops the run, so the read-only
 * verbs never resolve to `merge`. Non-capturing (stable group indices).
 */
const FLAGRUN = '(?:' + SEP + '+' + FLAGTOKEN + ')*';

/**
 * The lead of an UNDECIDABLE continuation after `gh pr` (arm 3): a shell
 * variable/substitution (`$`, a backtick).
 */
const VARLEAD = '(?:\\$|`)';

/**
 * The lead of an UNDECIDABLE endpoint/segment for the merge-API family (arm 4):
 * the shell forms (`$`, backtick) PLUS the cmd.exe variable shapes `%…%` and the
 * delayed-expansion `!…!` (codex B-1 round-2 — `gh api …/pulls/%PR%/merge` and the
 * `!PR!` form must deny as variable REST paths).
 */
const APIVARLEAD = '(?:\\$|`|%|!)';

/**
 * Thread {@link CONT} between the characters of a rigid literal so a line
 * continuation spliced anywhere inside it (which the shell removes before `gh`
 * runs) still matches (kimi round-2 BLOCKING-5). ASCII literals only.
 */
function contLit(literal: string): string {
  return literal.split('').join(CONT);
}

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
 *     `gh-pr-merge`), flags tolerated between `pr` and `merge`.
 *   - group 2 `(api\b` NOSEP `/pulls/` … `\d+` … `/merge)(?![\w-])` — a raw
 *     `/pulls/{n}/merge` API path with a LITERAL PR number (form `gh-api-merge`),
 *     continuation-tolerant via {@link contLit}.
 *   - group 3 `(pr\b` SEP`*` VARLEAD`)` — `gh pr` then a `$`/backtick
 *     continuation (form `gh-pr-undecidable`, deny-on-undecidable).
 *   - group 4 `(api\b` FLAGRUN SEP`*` APIVARLEAD` | api\b` NOSEP APIVARLEAD NOSEP `/merge\b)`
 *     — `gh api` whose endpoint is a variable (after any inherited flags), or a
 *     variable REST merge path (form `gh-api-undecidable`, deny-on-undecidable).
 *   - group 5 `(api\b` NOSEP `graphql` NOSEP `mergePullRequest)(?![\w-])` — the
 *     GraphQL merge mutation (form `gh-api-merge`), continuation-tolerant.
 */
export const MERGE_COMMAND_REGEX_SOURCE =
  '(?<![\\w-])gh(?:\\.exe)?' +
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
  contLit('/pulls/') +
  CONT +
  '\\d+' +
  CONT +
  contLit('/merge') +
  ')(?![\\w-])' +
  '|(pr\\b' +
  SEP +
  '*' +
  VARLEAD +
  ')' +
  '|(api\\b' +
  FLAGRUN +
  SEP +
  '*' +
  APIVARLEAD +
  '|api\\b' +
  NOSEP +
  APIVARLEAD +
  NOSEP +
  contLit('/merge') +
  '\\b)' +
  '|(api\\b' +
  NOSEP +
  contLit('graphql') +
  NOSEP +
  contLit('mergePullRequest') +
  ')(?![\\w-])' +
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

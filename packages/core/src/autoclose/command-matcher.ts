/**
 * Raw-merge command matcher — the harness-boundary half of the auto-close
 * enforcement seam (mmnto-ai/totem#1762, A+B slice; ADR-082 Amendment 1).
 *
 * The A-slice PreToolUse interlock (Claude `Bash` + Gemini `run_shell_command`)
 * DENIES an agent's attempt to merge a PR outside the sanctioned `totem pr merge`
 * actuator, so the shared receipt evaluator (B) is never bypassed. This module is
 * the ONE shared detector both rendered hosts inline (the regex arms via
 * `JSON.stringify` — the same drift-locked local-mirror shape as
 * `AUTO_CLOSE_REGEX_SOURCE` — and the {@link findApiMergePaths} single-pass scanner
 * verbatim), and that B's tests read. It never authors a second copy of the pattern.
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
 *   2. `gh pr` immediately followed by a command-substitution / variable
 *      continuation (`$(…)`, `${…}`, `$VAR`, a backtick) — the subcommand is
 *      UNDECIDABLE, so we deny (license condition 2: deny-on-undecidable, never
 *      guess it is safe).
 *   3. `gh api` whose ENTIRE endpoint is UNDECIDABLE before shell expansion — a
 *      `$`/backtick/`%`/`!` continuation after `gh api` and any inherited flags
 *      (`gh api $EP`, `gh api "$ENDPOINT"`, `gh api --method PUT "$EP"`,
 *      `gh api %ENDPOINT%`) — so we deny for the merge-API family exactly as arm 2
 *      does for `gh pr` (codex B-1 round-2 cmd.exe vars).
 *
 * Arms 1–3 are a REGEX ({@link MERGE_COMMAND_REGEX_SOURCE}, groups 1/2/3). The
 * raw-merge-API PATHS — a literal `…/pulls/{n}/merge`, a variable REST merge path
 * (`…/pulls/$PR/merge`, `…/pulls/%PR%/merge`, kimi NB-1 deny direction + codex B-1),
 * and the GraphQL `mergePullRequest` mutation (kimi NB-2) — are detected by the
 * {@link findApiMergePaths} SINGLE-PASS SCANNER instead of the regex (see LINEARITY).
 *
 * LINE-CONTINUATION HARDENING (kimi round-2 BLOCKING-5): a `\`+LF / `^`+LF splice
 * anywhere in a merge-API path or graphql literal (which the shell removes before
 * `gh` runs) must still be recognized. The regex arms fold the continuation into
 * their {@link SEP} class; the scanner DE-FOLDS the continuations first (removes
 * every `\`+LF / `^`+LF), so a splice mid-path — `gh api \⏎…/pulls/5/merge`,
 * `…/pulls/5/\⏎merge`, cmd.exe `^`+CRLF, `…/pulls/$PR/\⏎merge`,
 * `gh api graphql \⏎…mergePullRequest`, and mid-token splices — collapses back to
 * the contiguous literal before detection. The scanner is inlined into both hosts,
 * never forked into an in-hook pre-scan.
 *
 * It MUST NOT over-fire on the read-only `gh pr` verbs (`view`, `checkout`,
 * `diff`, `list`, …) — even carrying a spliced quoted flag (`gh pr --repo="x"
 * view 5`; codex round-2 negative) or a glued one (`gh pr -Rfoo/bar view 5`; kimi
 * round-2) — or on `gh pr merge` embedded in a larger word (`foogh pr merge`,
 * `gh-pr-merge`). No flag-value class consumes a shell command separator (`;` `|`
 * `&`) or a newline, and the scanner never crosses a `;`/`|`/`&`/bare-newline
 * command boundary (`gh api /user; echo /pulls/5/merge` does NOT block; Greptile
 * P2), so a run never straddles a command boundary.
 *
 * LINEARITY (codex round-2 BLOCKING — catastrophic backtracking; codex delta-4 —
 * the padding bypass): every nested quantifier in the regex ranges over a character
 * class DISJOINT from its neighbors — a separator (`SEP`, quotes/whitespace/line-
 * continuation) never overlaps a flag lead (`-`) and neither overlaps a value head.
 * In particular the flag NAME is `-{1,2}[\w]…` (a word char is REQUIRED after the
 * dashes; the earlier `-{1,2}[\w-]+` let `[\w-]`'s first char overlap `-{1,2}`,
 * giving every `--flag` two parses → 2^N total backtracks: a non-matching command
 * took 6.46s at 26 repeated flag groups). The merge-API path detection is NOT a
 * regex span at all: a bounded lazy span (`{0,2000}?`) was linear but turned input
 * length into a deterministic ALLOW — a header padded past ~2000 chars slipped a
 * real `…/pulls/{n}/merge` past the cap (codex delta-3 #3). {@link findApiMergePaths}
 * replaces it with a single left-to-right pass (de-fold → per-segment anchor via
 * {@link API_ANCHOR_SOURCE} → bounded in-segment literal scan) that BLOCKS the padded
 * form with NO length-based allow condition and NO O(k·n) rescan. The adversarial
 * perf fixtures in command-matcher.test.ts PROVE both shapes linear — repeated flag
 * groups AND a separator-free filler — <50ms at the adversarial sizes (measured, not
 * claimed). (safe-regex2 still rejects the regex on its conservative star-height
 * heuristic; it cannot see the disjoint-class structure, so the timing fixtures are
 * the authoritative gate.)
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
 * The lead of an UNDECIDABLE continuation after `gh pr` (arm 2): a shell
 * variable/substitution (`$`, a backtick).
 */
const VARLEAD = '(?:\\$|`)';

/**
 * The lead of an UNDECIDABLE endpoint for the merge-API family (arm 3): the shell
 * forms (`$`, backtick) PLUS the cmd.exe variable shapes `%…%` and the
 * delayed-expansion `!…!` (codex B-1 round-2 — `gh api %ENDPOINT%` and the `!EP!`
 * form must deny as variable endpoints).
 */
const APIVARLEAD = '(?:\\$|`|%|!)';

/**
 * The shared `gh … api` PREFIX the {@link findApiMergePaths} scanner anchors on:
 * a `gh` (or `gh.exe`) TOKEN (the lookbehind rejects a preceding word/dash char,
 * so `foogh`/`gh-pr` do not anchor), then optional spliced flags ({@link FLAGRUN}),
 * then ≥1 separator, then the `api` subcommand. Byte-identical to the prefix
 * MERGE_COMMAND_REGEX_SOURCE uses (the same disjoint-class construction, so it is
 * linear), and inlined verbatim into both rendered hosts (drift-locked by the
 * init.test.ts parity assertions, like {@link MERGE_COMMAND_REGEX_SOURCE}).
 */
export const API_ANCHOR_SOURCE = '(?<![\\w-])gh(?:\\.exe)?' + FLAGRUN + SEP + '+api\\b';

/**
 * Canonical raw-merge command pattern (apply flags `gi` when compiling). ONE
 * string, three ordered alternatives, each with a sentinel capture group so
 * {@link findMergeInvocations} can classify which vector matched:
 *
 *   - `(?<![\w-])gh(?:\.exe)?` + {@link FLAGRUN} + {@link SEP}`+` — a `gh` (or
 *     `gh.exe`) TOKEN, optional spliced flags, then ≥1 separator, so individually
 *     quoted tokens (`"gh" "pr"`, `& gh pr`) and a cross-repo `--repo` flag still
 *     resolve.
 *   - group 1 `(pr\b` FLAGRUN SEP`+ merge)(?![\w-])` — `gh pr merge` (form
 *     `gh-pr-merge`), flags tolerated between `pr` and `merge`.
 *   - group 2 `(pr\b` SEP`*` VARLEAD`)` — `gh pr` then a `$`/backtick
 *     continuation (form `gh-pr-undecidable`, deny-on-undecidable).
 *   - group 3 `(api\b` FLAGRUN SEP`*` APIVARLEAD`)` — `gh api` whose entire endpoint
 *     is a variable after any inherited flags (form `gh-api-undecidable`,
 *     deny-on-undecidable).
 *
 * The literal `…/pulls/{n}/merge`, variable REST merge, and graphql
 * `mergePullRequest` paths are NOT in this regex — {@link findApiMergePaths}
 * detects them in a single linear pass (see LINEARITY in the module header).
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
  ')' +
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

/** Whether `ch` continues a `merge`/`mergePullRequest`/PR-number word (the `\b` /
 *  `(?![\w-])` boundary the removed regex arms carried). `undefined` (end of the
 *  region) is a boundary. */
function isMergeWordChar(ch: string | undefined): boolean {
  return (
    ch !== undefined &&
    ((ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-')
  );
}

/**
 * Classify a single command SEGMENT's post-`api` region for a raw merge-API path.
 * `region` is `folded.slice(apiEnd, segEnd)` (continuations already removed, no
 * `;`/`|`/`&`/newline inside); `regionLower` is its lowercase twin. Alternatives
 * are checked in the SAME source order the removed regex arms had:
 *   1. a literal `/pulls/<digits>/merge` (contiguous, boundary-terminated) — merge;
 *   2. else a variable ($ ` % !) segment followed by `/merge` — undecidable;
 *   3. else `graphql … mergePullRequest` — the GraphQL merge mutation — merge.
 * Returns the form, or null when the segment carries no recognizable merge path.
 */
function classifyApiMergeRegion(region: string, regionLower: string): MergeInvocationForm | null {
  // arm A: a literal /pulls/<digits>/merge path.
  for (
    let p = regionLower.indexOf('/pulls/');
    p !== -1;
    p = regionLower.indexOf('/pulls/', p + 1)
  ) {
    let q = p + 7;
    let sawDigit = false;
    while (q < regionLower.length && regionLower[q] >= '0' && regionLower[q] <= '9') {
      q++;
      sawDigit = true;
    }
    if (
      sawDigit &&
      regionLower.slice(q, q + 6) === '/merge' &&
      !isMergeWordChar(regionLower[q + 6])
    ) {
      return 'gh-api-merge';
    }
  }
  // arm B: a variable PR/endpoint segment then /merge — undecidable.
  for (let v = 0; v < region.length; v++) {
    const ch = region[v];
    if (ch === '$' || ch === '`' || ch === '%' || ch === '!') {
      const mIdx = regionLower.indexOf('/merge', v);
      if (mIdx !== -1 && !isMergeWordChar(regionLower[mIdx + 6])) return 'gh-api-undecidable';
      break;
    }
  }
  // arm C: the graphql mergePullRequest mutation.
  const gq = regionLower.indexOf('graphql');
  if (gq !== -1) {
    const mpr = regionLower.indexOf('mergepullrequest', gq + 7);
    if (mpr !== -1 && !isMergeWordChar(regionLower[mpr + 16])) return 'gh-api-merge';
  }
  return null;
}

/**
 * Single left-to-right pass for the raw merge-API PATHS (literal `…/pulls/{n}/merge`,
 * variable REST merge, graphql `mergePullRequest`). Replaces the removed bounded
 * `{0,2000}?` regex span — which turned input length into a deterministic ALLOW
 * (a header padded past the cap slipped a real merge path past; codex delta-3 #3).
 * PROVABLY LINEAR: de-fold once (O(n)); per command segment scan for the FIRST
 * `gh … api` anchor and one bounded in-segment literal scan, advancing past the
 * segment each time — no length-based allow, no O(k·n) rescan. The SAME logic is
 * inlined verbatim into both rendered hosts (init-templates `MERGE_INTERLOCK_SCANNER_JS`).
 */
export function findApiMergePaths(command: string): MergeInvocation[] {
  const out: MergeInvocation[] = [];
  if (typeof command !== 'string' || command.length === 0) return out;

  // De-fold shell (`\`+LF) / cmd.exe (`^`+LF) line-continuations so a splice inside
  // a merge path (removed by the shell before `gh` runs) collapses to the contiguous
  // literal; keep an index map back to the original command for reported offsets.
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const d = command[i + 1];
    if ((c === '\\' || c === '^') && (d === '\n' || (d === '\r' && command[i + 2] === '\n'))) {
      i += d === '\r' ? 2 : 1;
      continue;
    }
    folded += c;
    map.push(i);
  }
  const lower = folded.toLowerCase();

  const anchor = new RegExp(API_ANCHOR_SOURCE, 'gi');
  let a: RegExpExecArray | null;
  while ((a = anchor.exec(folded)) !== null) {
    const apiEnd = a.index + a[0].length;
    let segEnd = apiEnd;
    while (segEnd < folded.length && ';|&\r\n'.indexOf(folded[segEnd]) === -1) segEnd++;
    const form = classifyApiMergeRegion(folded.slice(apiEnd, segEnd), lower.slice(apiEnd, segEnd));
    if (form !== null) out.push({ form, index: map[a.index] ?? 0 });
    // One anchor per segment keeps the scan linear (a later anchor's region is a
    // subset already covered); resume after this segment's boundary.
    anchor.lastIndex = segEnd;
  }
  return out;
}

/**
 * Scan a shell command string for every recognizable raw-merge invocation. Zero
 * shell semantics — presence-invariant with the deny-on-undecidable arms. Combines
 * the regex arms (`gh pr merge`, `gh pr $(…)`, `gh api $EP`) with the
 * {@link findApiMergePaths} linear scan (raw merge-API / graphql paths). An empty
 * result means the command carried no recognizable vector; the interlock allows
 * those (its bounded claim).
 */
export function findMergeInvocations(command: string): MergeInvocation[] {
  if (typeof command !== 'string' || command.length === 0) return [];
  const out: MergeInvocation[] = [];
  for (const m of command.matchAll(compile())) {
    // Group layout: 1 = gh pr merge; 2 = gh pr $(…); 3 = gh api $EP (variable endpoint).
    let form: MergeInvocationForm;
    if (m[1] !== undefined) form = 'gh-pr-merge';
    else if (m[2] !== undefined) form = 'gh-pr-undecidable';
    else form = 'gh-api-undecidable';
    out.push({ form, index: m.index ?? 0 });
  }
  for (const inv of findApiMergePaths(command)) out.push(inv);
  out.sort((x, y) => x.index - y.index);
  return out;
}

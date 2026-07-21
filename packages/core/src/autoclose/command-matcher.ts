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
 *      (individually quoted tokens, `gh.exe`, a leading PowerShell `&`). Matched
 *      regardless of a `--body`/`--body-file`/`-F`/`-t` payload — the point is to
 *      reroute the WHOLE invocation, so a hidden body cannot slip a merge past.
 *   2. `gh api … /pulls/{n}/merge` — the raw merge-API vector (`gh pr merge` under
 *      a different name).
 *   3. `gh pr` immediately followed by a command-substitution / variable
 *      continuation (`$(…)`, `${…}`, `$VAR`, a backtick) — the subcommand is
 *      UNDECIDABLE, so we deny (license condition 2: deny-on-undecidable, never
 *      guess it is safe).
 *
 * It MUST NOT over-fire on the read-only `gh pr` verbs (`view`, `checkout`,
 * `diff`, `list`, …) or on `gh pr merge` embedded in a larger word
 * (`foogh pr merge`, `gh-pr-merge`).
 *
 * BOUNDED-SURFACE HONESTY (condition 2): this matcher claims exactly "block
 * recognizable raw-merge invocations in a shell command string at this harness".
 * It does not defeat an aliased/renamed `gh`, a shell function wrapping the call,
 * or a spawn injected through a helper it cannot see (mmnto-ai/totem#2460). The
 * layered D1 (PR-time required check) + D2 (post-merge reconciliation) sensors are
 * the loud backstop for anything that transits this bounded surface.
 */

/**
 * Canonical raw-merge command pattern (apply flags `gi` when compiling). ONE
 * string, three ordered alternatives, each with a sentinel capture group so
 * {@link findMergeInvocations} can classify which vector matched:
 *
 *   - `(?<![\w-])gh(?:\.exe)?['"\s]+` — a `gh` (or `gh.exe`) TOKEN (not a
 *     substring of a larger word — the lookbehind rejects a preceding word/dash
 *     char) followed by ≥1 whitespace/quote separator, so individually quoted
 *     tokens (`"gh" "pr"`, `& gh pr`) still resolve.
 *   - group 1 `(pr\b['"\s]+merge)(?![\w-])` — `gh pr merge` (form `gh-pr-merge`).
 *     The trailing `(?![\w-])` keeps `merge` a whole token (`merged`,
 *     `merge-queue` do not match).
 *   - group 2 `(api\b[\s\S]*?/pulls/\d+/merge)(?![\w-])` — a raw
 *     `/pulls/{n}/merge` API path anywhere after `gh api` (form `gh-api-merge`).
 *   - group 3 `(pr\b['"\s]*(?:\$|` + "`" + `))` — `gh pr` then a `$`/backtick
 *     continuation (form `gh-pr-undecidable`, deny-on-undecidable).
 */
export const MERGE_COMMAND_REGEX_SOURCE =
  '(?<![\\w-])gh(?:\\.exe)?[\'"\\s]+' +
  '(?:' +
  '(pr\\b[\'"\\s]+merge)(?![\\w-])' +
  '|(api\\b[\\s\\S]*?/pulls/\\d+/merge)(?![\\w-])' +
  '|(pr\\b[\'"\\s]*(?:\\$|`))' +
  ')';

/** The raw-merge vector a {@link MergeInvocation} was matched under. */
export type MergeInvocationForm = 'gh-pr-merge' | 'gh-api-merge' | 'gh-pr-undecidable';

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
 * shell semantics — presence-invariant with the deny-on-undecidable arm. An empty
 * result means the command carried no recognizable `gh pr merge` / raw merge-API /
 * `gh pr`-substitution vector; the interlock allows those (its bounded claim).
 */
export function findMergeInvocations(command: string): MergeInvocation[] {
  if (typeof command !== 'string' || command.length === 0) return [];
  const out: MergeInvocation[] = [];
  for (const m of command.matchAll(compile())) {
    // Group layout: 1 = gh pr merge; 2 = gh api …/pulls/N/merge; 3 = gh pr $(…).
    let form: MergeInvocationForm;
    if (m[1] !== undefined) form = 'gh-pr-merge';
    else if (m[2] !== undefined) form = 'gh-api-merge';
    else form = 'gh-pr-undecidable';
    out.push({ form, index: m.index ?? 0 });
  }
  return out;
}

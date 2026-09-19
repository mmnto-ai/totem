// [totem] auto-generated — Claude Code action-gate wrapper
// ONE parameterized PreToolUse wrapper for the Totem gate engine (PR-C,
// mmnto-ai/totem#2048). Reads --event <name> from argv (baked per-entry into
// the installed command), reads the PreToolUse stdin envelope, shells to
// `totem gate check`, and maps the GateVerdict disposition → host exit code.
// `.cjs` extension because package.json may have "type": "module" — Claude
// Code execs hooks via plain `node`, which would otherwise treat `.js` as ESM.
//
// Exit-code contract (LOAD-BEARING — ADR-109 §2; branch ONLY on disposition):
//   0 = allow | warn | --pilot deny | NOT-APPLICABLE fail-soft
//       (unparseable/non-object envelope; freeze-check with no declared
//        subsystem; transport-shield on a tool other than Bash/PowerShell or
//        with no non-empty string command; merge-ready on any command that is
//        not `gh pr merge` at command position)
//   2 = deny (--strict, Claude block convention)
//       | APPLICABLE-gate-not-evaluable fail-closed (no CLI resolvable
//         (repo-local, then PATH), non-zero `gate check`, unparseable verdict,
//         or unknown disposition)
//       | an --event this wrapper has no payload projection for (a baked event
//         it cannot project is an applicable gate it cannot evaluate)
//       | the BUDGET spent before a gate could be evaluated — the projection's
//         git reads did not answer inside it (mmnto-ai/totem#2856 § D)
//       | the BUDGET spent before the envelope arrived on stdin — the host
//         opened this hook and never closed its input (same § D, fold F6)
//     Both budget arms are fail-closed at EVERY tier, --pilot included: an
//     applicable gate that could not be evaluated is not a softened deny.
'use strict';

const { spawnSync } = require('child_process');
const { existsSync, realpathSync } = require('fs');
const { basename, delimiter, dirname, join } = require('path');

// ─── PATH FALLBACK for the Totem CLI (mmnto-ai/totem#2822) ──────────────
// A `Bash|PowerShell`-matched gate applies to the very commands that CREATE
// the repo-local CLI on a fresh clone (`pnpm install`, then `pnpm build` in
// this monorepo), so with a repo-local-only resolution the gate blocks its own
// bootstrap — and blocks the cure it prints. This is a RESOLUTION arm, not an
// exemption: an applicable gate that cannot be evaluated by EITHER arm still
// fails closed (mmnto-ai/totem#2799 ruling, Tenet 4).
//
// A session started in a fresh worktree has no node_modules at its cwd and
// takes this arm; with no global CLI it fails closed — the ruling, not a bug.
//
// The repo-local pinned dist stays FIRST — the pinned-beats-ambient ordering of
// ADR-072 § 2; tiers 1, 3 and 5 are out of scope for a hook that must not shell
// out. This runs only when the pinned dist is absent. Two npm-global layouts
// are probed per PATH dir, first hit wins:
//   (a) <dir>/node_modules/@mmnto/cli/dist/index.js — the win32 layout, where
//       the `totem.cmd` shim sits beside `node_modules`;
//   (b) <dir>/totem realpath'd — the POSIX npm-global symlink, taken only when
//       it resolves to an existing `.js` file (a shell shim resolves to an
//       extensionless script and is correctly skipped).
// A dir that yields neither is skipped; nothing here throws.
//
// PATH is trusted here at exactly the level `node` itself already is: the
// settings.json entry invokes this hook as a bare `node`, so whoever controls
// PATH controls the interpreter before this line ever runs.
//
// Returns { entry, display }: `entry` is the absolute path to spawn, `display`
// a NON-resolvable rendering (basenames only) for the stderr provenance line —
// hook stderr lands in transcripts that get pasted into issues, so it never
// carries a user-profile path.
function resolveCliFromPath() {
  const raw = typeof process.env.PATH === 'string' ? process.env.PATH : '';
  const dirs = raw.split(delimiter);
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (!dir) continue;
    const packaged = join(dir, 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
    if (existsSync(packaged)) {
      return {
        entry: packaged,
        display: basename(dir) + '/node_modules/@mmnto/cli/dist/index.js',
      };
    }
    const shim = join(dir, 'totem');
    if (existsSync(shim)) {
      try {
        const real = realpathSync(shim);
        if (typeof real === 'string' && real.endsWith('.js') && existsSync(real)) {
          return {
            entry: real,
            display:
              basename(dir) + '/totem -> ' + basename(dirname(real)) + '/' + basename(real),
          };
        }
      } catch (err) {
        // An unreadable link is not a resolution — keep scanning the PATH.
      }
    }
  }
  return null;
}

// ─── merge-ready: `gh pr merge` at COMMAND POSITION + its payload ──────
//
// One walk over the command text does BOTH jobs, so recognition and argv
// extraction can never disagree: it tracks quoting, splits on the unquoted
// command separators (`;`, `&`, `|`, a newline, `(`/`)`, `{`/`}`, and a
// backtick) and tokenizes each segment. A segment whose FIRST token is the
// `gh` executable, followed by `pr` and `merge`, is a merge at command
// position; a quoted "gh pr merge" is a single token and never matches, so
// `echo "gh pr merge"` does not fire. What is NOT the command is stripped from
// the segment's front before the anchor is read — a leading redirection, the
// transparent wrapper programs with their options, the shell's reserved words
// (`do`, `then`, `else`, `if`, `elif`, `while`, `until`, `!`, `coproc`) and
// any run of `NAME=value` assignment prefixes — so `for … ; do gh pr merge;
// done`, `if gh pr merge 5; then …` and `GH_TOKEN=x gh pr merge 5` all fire.
// Before the PR's review round only `do`/`then`/`else`/`!` were skipped, so a
// merge used AS an `if` condition, or behind an assignment prefix, went
// unjudged (mmnto-ai/totem#2844 round 1, greptile). EVERY matching segment is
// collected, not the first: `gh pr merge 7; gh pr merge 8` yields two argv
// lists and the wrapper judges each PR on its own facts (same round).
//
// HEREDOC BODIES AND COMMENTS ARE BLANKED FIRST (mmnto-ai/totem#2800 fold F4).
// A heredoc body is DATA, not commands: `cat <<EOF` … `gh pr merge 5` … `EOF`
// writes a line of text and merges nothing, and firing there was a false deny —
// the one direction this projection must not have. Since mmnto-ai/totem#2857
// the scanner that finds those bodies is a VERBATIM port of core's
// `findHeredocs` (see the sync anchor below), not a second reading of the same
// grammar: quoted (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) and bare delimiters,
// `<<` and `<<-` (whose terminator may be tab-indented), an unterminated body
// read to the end of the command, `<<<` left alone (a here-string is not a
// heredoc), `$(( … ))` / `(( … ))` skipped whole so a shift opens nothing, a
// `#` that begins a word discarded to end-of-line, and the paren bookkeeping
// that says whether a `)` ends a word. Every `<<` on the operator line is
// queued and its body consumed in order, as bash does for `cat <<A <<B`.
//
// WHAT THE ANCHOR NOW READS (mmnto-ai/totem#2856, the strict tier's
// precondition — under PILOT each of these was one lost advisory read, under
// STRICT a bypass): the executable may be spelled `gh`, `gh.exe` or either
// behind a path; a CLOSED table of transparent wrapper programs (`sudo`,
// `env`, `timeout`, `nice`, `nohup`, `command`, `exec`, `time`) is stripped
// with its option grammar; `eval` re-tokenizes its operand once and
// `env -S` / `--split-string` splits its own operand into the words that
// take the option's place; a leading redirection is skipped with its file;
// and a backtick substitution is a segment of its own. In POWERSHELL mode a
// trailing backtick is that shell's LINE CONTINUATION instead — at a WORD
// BOUNDARY the backtick and the newline are consumed and the next line
// continues the command, the twin of bash's trailing backslash there
// (round-6 leg, G3, bounded by round-7's H4); it was a separator in both
// modes before, which made the backtick itself the merge's target and left
// the real one in the next segment. INSIDE a word the two shells differ:
// PowerShell's backtick escapes the newline INTO the argument, so
// `gh pr merg<backtick><LF>e 5` is the word `merg<LF>e` and merges
// nothing — and neither does this.
//
// Disclosed misses, same posture as transport-shield's scanner — the gate does
// NOT fire, which is the safe direction, never a false deny. Every one of them
// is a LOCKED row in gate-install.test.ts, so this list is read from the suite,
// not from memory:
//   - a VARIABLE executable (`$GH pr merge 5`, `${GH} pr merge 5`): the walk
//     cannot expand it, and the `unresolvedTarget` arm covers only the PR
//     argument, not the program;
//   - an UNQUOTED win32 path (`C:\tools\gh.exe pr merge 5`): this walk reads
//     POSIX quoting for BOTH tools, so the separators are consumed as escapes
//     and the token arrives as `C:toolsgh.exe`. Quoted, it projects;
//   - `timeout` with NO duration (`timeout gh pr merge 5`): the grammar
//     consumes exactly one positional before the command, so `gh` reads as the
//     duration. The form is invalid to `timeout` itself;
//   - a wrapper program not on the table (`npx`, `xargs`, `bash -c "…"`) and a
//     builtin flag not in it: the table is closed on purpose — the walk cannot
//     know which operand of an arbitrary program is the command;
//   - a table word spelled by PATH (`/usr/bin/time -f x gh pr merge 5`): the
//     table is keyed on the bare word the shell reads at command position, and
//     `/usr/bin/time` is a PROGRAM with its own option grammar, not the
//     reserved word this table models;
//   - env's OWN splitting rules inside a `-S` / `--split-string` operand.
//     The operand itself is no longer a miss: it is SPLIT and read, because
//     every spelling of it RUNS the merge (fold 3, measured on coreutils
//     8.32 with a stub `gh`) and consuming it with the option made all of
//     them a bypass under STRICT. But it is split on WHITESPACE and nothing
//     more: env's own escapes (`\_` is a SPACE, `\n`, `\t`, `\#`,
//     `\$`), its `$VAR` expansion inside the string and its `#` comment
//     are not modelled, and quotes INSIDE the string are not stripped.
//     Measured: `env -S 'gh\_pr\_merge\_5'` runs `gh pr merge 5`, while
//     the split reads ONE word here and nothing projects; and
//     `env -S 'env -S "gh pr merge 5"'` runs it too, because env strips the
//     quotes inside its own operand while this walk keeps them and reads
//     `"gh` as the executable (both locked rows, round-7 leg H5). The
//     ATTACHED SHORT spelling is no longer among them: `env -Sgh pr merge 5`
//     and `env -S'gh pr merge 5'` both arrive as the token
//     `-Sgh pr merge 5`, and the rest of that token is now read as the
//     operand, so both are judged;
//   - `eval` nested deeper than ONE level
//     (`eval "eval \"gh pr merge 5\""`);
//   - a substitution inside DOUBLE quotes (`echo "`gh pr merge 5`"`,
//     `echo "$(gh pr merge 5)"`): bash EXECUTES both of those, but the
//     tokenizer's quote arm swallows the whole string as ONE token, so the
//     merge inside runs unjudged. Filed as mmnto-ai/totem#2893 (round-5 leg,
//     F4); the single-quoted spelling really is data and stays a control row;
//   - a redirection operator carrying a tokenizer separator (`>|`, `2>&1`,
//     `>& file`, `<& 3`, `exec 3>&1 …`): `|` and `&` end the segment before
//     the operator is read as one word, and ALL FIVE of those are merges the
//     shell runs — measured with a stub on bash 5.3, each applies its
//     redirection and then runs `gh pr merge 5` (the `<& 3` form once that
//     descriptor is open). The segment they leave starts at the FILE
//     (`out.txt`, `1`, `file`, `3`), so nothing of the merge is read: a
//     fail-open, not text the shell ignores (round-6 leg, G2). A `&>` splits
//     the same way but leaves a readable `>` at the front of the next
//     segment, so THAT one projects;
//   - PowerShell's own quoting (backtick escapes outside double quotes,
//     here-strings) is not modelled — the walk reads POSIX quoting for both
//     tools. PowerShell's call operator is NOT a miss: `& gh pr merge 5`
//     projects, because `&` is one of the separators and the segment after it
//     starts at `gh` (row, not memory).
// Disclosed FALSE FIRES, the deny direction, all contrived — text the shell
// does not execute as a merge but that sits at a segment's front here: a bash
// array assignment whose elements spell a merge (`A=(gh pr merge 8)`) is judged
// as a merge of 8, because `(` is a separator and the segment inside it starts
// with `gh`; a `case` pattern `gh pr merge)` yields an EMPTY argv, which
// projects to the current branch's PR (both surfaced when every segment began
// to be collected, round 2 F6); and a function DEFINITION whose body is a
// merge (`f() { gh pr merge 5; }`) fires at definition time, because `{` is a
// separator and the body is its own segment (round 3, F4; it fired before this
// PR's rounds too). A fourth, PowerShell's own: a double-quoted string whose
// backtick escapes a quote (`Write-Output "a `"; gh pr merge 5`"b"`) is ONE
// string to PowerShell and merges nothing, but this walk reads POSIX quoting
// for both tools, so the `"` after the escaping backtick closes the string and
// the merge reaches a segment's front (round-5 leg, F13; a row asserts it).
// A fifth, and the only one that is not contrived: an INVALID OPTION to a
// word on the table above (`command -x`, `exec -x`, `timeout -Z 30`,
// `nice -Z`, `env -Z`, `nohup -x`, `sudo -Z`). Each makes the program answer
// "invalid option" and run NOTHING, while the strip below reads any unknown
// `-` token as one of that word's own options and projects the merge behind
// it. Ruled disclose-not-cure (round-6 leg, G4): the cure is a closed `flags`
// list per program — the shape `time` carries, whose reserved-word grammar
// really is two flags — and on a mutant with that list everywhere it turns
// every real flag the list omits (`sudo -n`, `sudo -E`,
// `timeout --foreground`) into a MISS, which is a bypass under STRICT. A
// false fire on a command that runs nothing costs one bogus deny; rows assert
// each of them, so this paragraph is read from the suite.
// A sixth, PowerShell's again (round-7 leg, H4): a TRAILING BACKTICK AT THE
// END OF THE INPUT (`gh pr merge 5 <backtick>`) is a continuation with
// nothing to continue — pwsh answers with a parse error and runs NOTHING —
// while here the backtick is not followed by a newline, so it falls through
// to the separator arm and the merge in front of it is judged.
// A seventh, env's (round-7 leg, H5): a `$VAR` inside a `-S` operand
// (`env -S 'gh pr merge $PR'`) makes env REFUSE the whole command — it
// supports only `${VARNAME}` and answers "only ${VARNAME} expansion is
// supported" — so NOTHING runs, while the split reaches the anchor and
// `$PR` rides as an `unresolvedTarget` the strict tier denies.
// `TOTEM_MERGE_GATE_OVERRIDE=1` is the audited way past any of them.
// ─── The heredoc scanner (mmnto-ai/totem#2857) ─────────────────────────
// sync-anchor: findHeredocs-scanner-downstream (packages/core/src/transport-shield.ts findHeredocs; the parity test in gate-install.test.ts is the lock)
//
// A VERBATIM port of core's `findHeredocs` and its three tables, not a second
// reading of the same grammar. The hand copy this replaces had diverged in the
// FAIL-OPEN direction — it opened heredocs core does not, and each one blanked
// the `gh pr merge` on a following line (a lost advisory read under PILOT, a
// bypass under STRICT): no paren-boundary arms, so a `#` after `(` or after an
// operator `)` was text and a `<<word` inside it opened a body; a narrower
// bare-delimiter class, so `<<E:F` read as the prefix `E` and the terminator
// line never matched; and a double-quote backslash that escaped ANY next
// character where core escapes only DQ_ESCAPABLE.
//
// A distributed hook cannot import core (its exports map carries `import`
// conditions only and no scanner subpath — mmnto-ai/totem#2851), so the cohort
// lesson for an inlined standalone utility rules: port verbatim, anchor both
// sites, lock it with an executable parity test. Change nothing here without
// changing core's `findHeredocs` and re-running that test.

/** Inside double quotes a backslash escapes only these (POSIX); elsewhere it is kept. */
const DQ_ESCAPABLE = ['$', '`', '"', '\\', '\n'];

/**
 * `<<` or `<<-`, optional blanks, then the delimiter WORD as bash delimits it:
 * single-quoted, double-quoted, backslash-quoted (`\EOF`) or bare — a bare
 * word running to the next blank, quote, backslash or operator character, so
 * `EOF.TXT`, `E:F` and `1EOF` are whole delimiter words. Groups: 1 the dash,
 * 2 single-quoted, 3 double-quoted, 4 backslash-quoted, 5 bare.
 */
const HEREDOC_AT =
  /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\([^\s'"\\<>()|&;]+)|([^\s'"\\<>()|&;]+))/;

/**
 * Characters after which the next character BEGINS a word — where a `#` starts
 * a comment (POSIX 2.3 rule 9). Parentheses are not here: an opening `(` and an
 * OPERATOR `)` begin a word, but the `)` that closes a `$( … )` continues one,
 * so the walk tracks which `(` each `)` closes and sets the boundary from that.
 */
const WORD_BOUNDARY = [' ', '\t', '\r', '\n', ';', '|', '&'];

// The index just past the `))` that closes an arithmetic expansion whose
// opening `$((` / `((` ends at `from`; the end of the command when it is
// unterminated. A `<<` inside is a SHIFT, never a heredoc operator — without
// this guard `echo $((1<<2))` opened a heredoc and swallowed every command
// after it, so a real `gh pr merge` went unjudged (F1).
function skipArithmetic(command, from) {
  let depth = 2;
  let i = from;
  while (i < command.length) {
    const ch = command[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return command.length;
}

/**
 * ONE pass over the command that tracks shell quoting and SKIPS heredoc
 * bodies, returning every heredoc's span. Core's `findHeredocs`, arm for arm:
 * an operator inside a quoted argument is text, `<<<` is a here-string, a
 * `#` that begins a word discards the rest of its line without quote
 * processing, `$(( … ))` / `(( … ))` is skipped whole, and `parens` records
 * what each open `(` is — a substitution (`$(`, `<(`, `>(`), which is part of
 * a word, or a grouping operator — so the `)` that closes it can say whether
 * the next character begins a word. A body starts after the newline that ends
 * the operator's line and runs to the first line that IS the delimiter (an
 * exact line match, as bash reads it), or to the end of the command.
 *
 * The one thing core's scanner does not need and this one does: the COMMENT
 * regions. Core's tokenizer reads comments itself; this wrapper's does not, so
 * the blanker below has to blank them exactly as the hand copy dropped them,
 * or a `<# … #>` block or a `#` comment whose text begins with a merge would
 * reach the anchor. They are collected in the SAME two arms that discard them,
 * so the two readings cannot disagree, and they are NOT part of the span list
 * the parity lock compares.
 */
function scanShell(command, ps) {
  const spans = [];
  const comments = [];
  const pending = [];
  const parens = [];
  let inSingle = false;
  let inDouble = false;
  let boundary = true;
  let i = 0;
  // Consume EVERY body queued on the operator line, in order, starting just
  // past that line's newline — bash reads `cat <<A <<B` as two bodies, so a
  // command sitting in B's body is data too (F2). An unterminated body runs to
  // the end of the command and no later heredoc on that line can start.
  const consumeBodies = (from) => {
    let cursor = from;
    for (let p = 0; p < pending.length; p++) {
      const h = pending[p];
      const bodyStart = cursor;
      let bodyEnd = command.length;
      let unterminated = true;
      let resume = command.length;
      let at = bodyStart;
      while (at <= command.length) {
        const nl = command.indexOf('\n', at);
        const stop = nl === -1 ? command.length : nl;
        let line = command.slice(at, stop);
        if (h.stripTabs) line = line.replace(/^\t+/, '');
        if (line === h.delimiter) {
          bodyEnd = at;
          unterminated = false;
          resume = nl === -1 ? command.length : nl + 1;
          break;
        }
        if (nl === -1) break;
        at = nl + 1;
      }
      spans.push({
        delimiter: h.delimiter,
        quoted: h.quoted,
        stripTabs: h.stripTabs,
        unterminated: unterminated,
        bodyStart: bodyStart,
        bodyEnd: bodyEnd,
      });
      cursor = resume;
      if (unterminated) break;
    }
    pending.length = 0;
    return cursor;
  };
  while (i < command.length) {
    const ch = command[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      i += 1;
      boundary = false;
      continue;
    }
    if (inDouble) {
      if (ps && ch === '`' && i + 1 < command.length) {
        // PowerShell's escape inside a double-quoted string is the backtick.
        i += 2;
        boundary = false;
        continue;
      }
      if (ch === '\\' && i + 1 < command.length && DQ_ESCAPABLE.indexOf(command[i + 1]) !== -1) {
        i += 2;
        boundary = false;
        continue;
      }
      if (ch === '"') inDouble = false;
      i += 1;
      boundary = false;
      continue;
    }
    if (ps && command.slice(i, i + 2) === '<#') {
      // PowerShell's block comment, discarded without quote processing; an
      // unterminated one runs to the end. Applied ONLY for the PowerShell tool
      // (round 4, F8): in bash `sort <#tmp` is a redirect from a file named
      // `#tmp`, and discarding from it to a later `#>` would swallow real
      // commands.
      const close = command.indexOf('#>', i + 2);
      const end = close === -1 ? command.length : close + 2;
      comments.push({ start: i, end: end });
      i = end;
      boundary = true;
      continue;
    }
    if (ch === '#' && boundary) {
      // A comment: discarded to the end of the line without quote processing;
      // the newline itself stays (it may end an operator line).
      const nl = command.indexOf('\n', i);
      const end = nl === -1 ? command.length : nl;
      comments.push({ start: i, end: end });
      i = end;
      continue;
    }
    if (ch === '$' && command.slice(i, i + 3) === '$((') {
      i = skipArithmetic(command, i + 3);
      boundary = false;
      continue;
    }
    if (ch === '(' && command[i + 1] === '(' && boundary) {
      i = skipArithmetic(command, i + 2);
      boundary = false;
      continue;
    }
    if ((ch === '$' || ch === '<' || ch === '>') && command[i + 1] === '(') {
      // A command or process substitution: part of the word that carries it.
      // Its first character begins a word (a `#` right after `$(` is a
      // comment).
      parens.push('subst');
      i += 2;
      boundary = true;
      continue;
    }
    if (ch === '(') {
      parens.push('group');
      i += 1;
      boundary = true;
      continue;
    }
    if (ch === ')') {
      // The `)` of a substitution continues the word; an operator `)` ends one.
      boundary = parens.pop() !== 'subst';
      i += 1;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      boundary = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      boundary = false;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      boundary = false;
      continue;
    }
    if (ch === '\n') {
      i = pending.length > 0 ? consumeBodies(i + 1) : i + 1;
      boundary = true;
      continue;
    }
    // `<<` opens a heredoc; `<<<` is a here-string and is left alone — at BOTH
    // of its first two characters (without the preceding-character guard the
    // second `<` of `<<<` opened a heredoc whose body swallowed every later
    // line, a fail-open path — CodeRabbit on mmnto-ai/totem#2855).
    if (ch === '<' && command[i + 1] === '<' && command[i - 1] !== '<' && command[i + 2] !== '<') {
      const m = HEREDOC_AT.exec(command.slice(i));
      if (m !== null) {
        pending.push({
          stripTabs: (m[1] || '') === '-',
          quoted: m[2] !== undefined || m[3] !== undefined || m[4] !== undefined,
          delimiter:
            m[2] !== undefined
              ? m[2]
              : m[3] !== undefined
                ? m[3]
                : m[4] !== undefined
                  ? m[4]
                  : m[5] !== undefined
                    ? m[5]
                    : '',
        });
        i += m[0].length;
        boundary = false;
        continue;
      }
    }
    boundary = WORD_BOUNDARY.indexOf(ch) !== -1;
    i += 1;
  }
  if (pending.length > 0) consumeBodies(command.length);
  return { heredocs: spans, comments: comments };
}

/** Every heredoc in the command — core's span shape minus the unused `body`. */
function findHeredocSpans(command, powershell) {
  return scanShell(command, powershell === true).heredocs;
}

/**
 * The command with every heredoc body, and every comment, replaced by SPACES:
 * core's blanking shape, so LENGTH and every offset are preserved (the hand
 * copy dropped body lines instead, which moved every offset after them). The
 * tokenizer below treats any run of spaces as one boundary, so the change of
 * shape is invisible to it — the heredoc rows in the suite are that proof.
 */
function blankHeredocBodies(command, powershell) {
  const scan = scanShell(command, powershell === true);
  const regions = [];
  for (let s = 0; s < scan.heredocs.length; s++) {
    regions.push({ start: scan.heredocs[s].bodyStart, end: scan.heredocs[s].bodyEnd });
  }
  for (let c = 0; c < scan.comments.length; c++) {
    regions.push(scan.comments[c]);
  }
  let out = command;
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    if (region.end <= region.start) continue;
    out =
      out.slice(0, region.start) +
      ' '.repeat(region.end - region.start) +
      out.slice(region.end);
  }
  return out;
}

// The words the shell reads at command position that are NOT the command:
// reserved words that introduce a compound command (`time` and `coproc` are
// reserved words too — the round-2 leg found them missing), the negation, and
// the builtins that execute their operand as the command (`exec`, `command`,
// `eval`). Stripped from a segment's front, in any run, before the
// `gh pr merge` anchor is read.
//
// Four of them — `time`, `exec`, `command`, `eval` — also carry an OPTION
// grammar, so they appear again in TRANSPARENT_WRAPPERS below and the strip
// reads them from THERE (the table is consulted first). They stay here so this
// list still reads as what it is: every word the shell itself skips at command
// position.
const COMMAND_POSITION_WORDS = [
  'do',
  'then',
  'else',
  'if',
  'elif',
  'while',
  'until',
  'time',
  'coproc',
  '!',
  'exec',
  'command',
  'eval',
];

// A `NAME=value` word at a segment's front is an assignment PREFIX to the
// command that follows it (`GH_TOKEN=x gh pr merge 5`), never the command.
function isAssignmentPrefix(token) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

// The executable spellings the anchor accepts (mmnto-ai/totem#2856 § A):
// `gh`, `gh.exe`, and either of those behind a path (`./gh`,
// `/usr/local/bin/gh`, `'C:\tools\gh.exe'`). The BASENAME after the last
// `/` or `\` is what is read, and the `.exe` suffix is case-insensitive as
// win32 resolves it. Reading only the bare token `gh` left every other
// spelling of the SAME executable unjudged — one lost advisory read under
// PILOT, a bypass under STRICT (greptile P1 on mmnto-ai/totem#2855).
// A VARIABLE executable (`$GH`, `${GH}`) is not a spelling this wrapper can
// expand, and stays a disclosed miss below.
function isGhExecutable(token) {
  if (typeof token !== 'string' || token === '') return false;
  const slash = token.lastIndexOf('/');
  const back = token.lastIndexOf('\\');
  const cut = slash > back ? slash : back;
  const base = cut === -1 ? token : token.slice(cut + 1);
  if (base === 'gh') return true;
  return base.length === 6 && base.slice(0, 3) === 'gh.' && base.slice(3).toLowerCase() === 'exe';
}

// ─── Transparent wrapper programs (mmnto-ai/totem#2856 § B) ─────────────
// A CLOSED table of words that RUN their operand as the command, with the
// option grammar needed to find that operand:
//   operand     — options that take a SEPARATE next token (skip the option AND
//                 that token);
//   positional  — how many non-option words the program itself consumes before
//                 the command (only `timeout`'s duration);
//   terminator  — whether a `--` ends its options;
//   describe    — options that make the word DESCRIBE its operand instead of
//                 executing it (`command -v`, `sudo -l`): the segment ends
//                 with NO projection, because nothing is executed;
//   flags       — when present, the ONLY options the word HAS: any other
//                 `-` token is not an option of it, so the shell runs no
//                 command and there is nothing to project (bash's `time`
//                 reserved word answers `-f: command not found`);
//   evaluates   — the builtin whose operand is a STRING to re-tokenize;
//   evaluatesOperand
//               — the OPTIONS whose own operand is a command STRING: the
//                 operand is split into words and those words TAKE THE
//                 OPTION'S PLACE, so the strip reads on from them
//                 (`env -S 'gh pr merge 5'`).
// Every other `-` token is skipped as a flag of the wrapper, so a long option
// with an ATTACHED value (`--user=x`, `--kill-after=5`, `--adjustment=10`)
// needs no entry and a bare `-10` reads as `nice`'s adjustment. A long option
// that takes a SEPARATE operand does need one, beside its short spelling, or
// the operand itself reads as the command (`sudo --user root gh …` read
// `root` as the program — round-5 leg, F2). After a wrapper is consumed the
// strip loops, so the assignment prefixes of `env NAME=v gh …` and a wrapper
// wrapping a wrapper both resolve.
//
// The table is CLOSED on purpose (ADR-082 A1, Tenet 19): a program that is not
// on it IS the command, because this walk cannot know which of an arbitrary
// program's operands is a command — `npx` runs a package, `xargs` builds its
// own argv. Widening it is a later PR with its own rows, never a guess here.
const TRANSPARENT_WRAPPERS = {
  sudo: {
    operand: [
      '-u',
      '-g',
      '-p',
      '-C',
      '-D',
      '-h',
      '-r',
      '-t',
      '-T',
      '-U',
      '--user',
      '--group',
      '--prompt',
      '--chdir',
      '--chroot',
      '--host',
      '--role',
      '--type',
      '--other-user',
      '--command-timeout',
    ],
    positional: 0,
    terminator: true,
    // sudo's DESCRIBE-only options: `-l`/`--list` prints what the user may
    // run, `-v`/`--validate` refreshes the timestamp, `-V`/`--version`
    // prints the version, `-K`/`--remove-timestamp` clears the credentials
    // and may not carry a command. None of them executes the operand, so
    // `sudo -l gh pr merge 5` merges nothing — projecting there was a FALSE
    // DENY (round-5 leg, F1).
    describe: ['-l', '--list', '-v', '--validate', '-V', '--version', '-K', '--remove-timestamp'],
  },
  env: {
    operand: ['-u', '-C', '--unset', '--chdir'],
    positional: 0,
    terminator: false,
    // `-S` / `--split-string` does NOT consume its operand: env splits that
    // string into words and PREPENDS them to the arguments that follow, then
    // runs the first word as the command. Measured on coreutils 8.32 with a
    // stub `gh`, every one of `env -S 'gh pr merge 5'`,
    // `env -S "gh pr merge" 5`, `env -S gh pr merge 5`,
    // `env --split-string gh pr merge 5`, `env --split-string='gh pr merge 5'`,
    // `env -u X -S 'gh pr merge 5'` and `env -S 'A=1 gh pr merge 5'` RUNS
    // `gh pr merge 5`. Consuming the operand with the option made all seven a
    // MISS — consistency in the miss direction, which is a bypass under STRICT
    // (fold 3, on the round-6 fold's own measurement). So the words take the
    // option's place and the strip reads on from them, the way `eval`'s
    // operand is re-read. The ATTACHED SHORT spellings join them (round-7
    // leg, H5): `env -Sgh pr merge 5` and `env -S'gh pr merge 5'` both
    // arrive as the one token `-Sgh pr merge 5` and run the merge too. An
    // `=` is NOT a separator for a short option, so `env -S=x` reads its
    // operand as `=x` — which is what env does with it.
    evaluatesOperand: ['-S', '--split-string'],
  },
  timeout: { operand: ['-k', '-s', '--kill-after', '--signal'], positional: 1, terminator: true },
  nice: { operand: ['-n', '--adjustment'], positional: 0, terminator: false },
  nohup: { operand: [], positional: 0, terminator: false },
  command: { operand: [], positional: 0, terminator: false, describe: ['-v', '-V'] },
  exec: { operand: ['-a'], positional: 0, terminator: false },
  // `time` here is BASH'S RESERVED WORD, not `/usr/bin/time`: its grammar is
  // `time [-p] [--] pipeline` — no option of it takes an operand, and any
  // other `-` token is not an option at all (bash runs `-f` as a command and
  // answers "command not found", merging nothing). `time -f x gh pr merge 5`
  // was read with GNU time's option grammar and projected a merge the shell
  // never runs — a false deny (round-5 leg, F3). The PROGRAM `/usr/bin/time`
  // is a path-spelled wrapper, which this closed table does not carry.
  time: { operand: [], positional: 0, terminator: true, flags: ['-p'] },
  eval: { operand: [], positional: 0, terminator: false, evaluates: true },
};

// A REDIRECTION is not the command — and it is not an ARGUMENT either
// (mmnto-ai/totem#2856 § C, widened by the round-5 leg's F5 and F12). The
// shell applies it wherever it stands and runs the rest, so
// `> out.txt gh pr merge 5` merges, `gh > out.txt pr merge 5` merges, and
// `gh pr merge 5 > out.txt` merges PR 5 — while reading it at the segment's
// FRONT only left `>` riding into argv as the merge's target, where the
// engine denied a pull request on branch "`>`" with a reason no one wrote.
// So: ONE strip over the WHOLE segment, ahead of every other strip and of the
// anchor test.
//
// An operator ALONE (`>`, `>>`, `<`, `<>`, `2>`, `<<<`) takes the next
// token — the file — with it; a FUSED form (`>out.txt`, `2>/dev/null`,
// `<<<bar`, `2<>file`) is one token and drops alone. A `<<EOF` head is a
// fused form too and drops harmlessly: the scanner blanked its BODY long
// before this, so nothing of the heredoc is left to decide here.
//
// Residue, disclosed and unreachable rather than claimed: an operator carrying
// `|` or `&` (`>|`, `2>&1`, `>& file`, `<& 3`, `exec 3>&1 …`) never
// arrives as ONE token, because those two characters are the tokenizer's own
// segment separators and end the token first. ALL FIVE of those run the merge
// — measured with a stub on bash 5.3, each applies its redirection and then
// runs `gh pr merge 5` (the `<& 3` form once that descriptor is open) — so
// every one of them is a fail-open miss, not text the shell ignores (round-6
// leg, G2). `&>` splits the same way but leaves a readable `>` at the front
// of the next segment, so that one IS read.
//
// WHAT MAKES A REDIRECTION REAL IS THE QUOTING OF THE OPERATOR, not of the
// word it sits in (round-7 leg, H1/H2; the round-6 rule this replaces read
// "any part of which came from inside quotes or from an escape", which is not
// the shell's). Bash decides on the operator characters alone: quote the
// FILENAME and the redirection still happens — `>"out.txt" gh pr merge 5`
// truncates out.txt and merges PR 5 — while quoting the OPERATOR makes the
// whole word an argument: `gh pr merge --squash ">"out.txt` passes the string
// `>out.txt` to gh and redirects nothing. So the walk records, per token, the
// INDEX of its first character that came from inside quotes or from a
// backslash escape (`-1` when none), and a token is stripped only when the
// operator prefix this file's two patterns match lies ENTIRELY BEFORE that
// index. Under the round-6 rule every one of `>"out.txt"`, `2>"err.log"`,
// `<<<'bar'` and `>"$FILE"` rode into argv as data — a merge judged on a
// target nobody wrote, or (trailing) a branch named `>merge.log`. The rows
// that made the round-6 rule necessary are unchanged by this one, because
// their operator character is itself quoted or escaped: `-b "<br>" 5` and
// `-b \<br\> 5` both have their first literal character at index 0.
const REDIRECTION_ALONE = /^[0-9]*(?:<<<|[<>]{1,2})$/;
const REDIRECTION_FUSED = /^([0-9]*(?:<<<|[<>]{1,2}))[^\s]+$/;

/**
 * The argv after EVERY `gh pr merge` at command position in the command —
 * one array per merge, in command order — or an empty array when there is
 * none. A compound command that merges twice yields two, and the wrapper
 * judges each (mmnto-ai/totem#2844 round 1).
 */
function ghPrMergeArgvs(rawCommand, powershell, depth) {
  // `eval` re-enters this function ONCE (§ B); every other caller is depth 0.
  const level = typeof depth === 'number' ? depth : 0;
  const command = blankHeredocBodies(rawCommand, powershell === true);
  // Each segment's tokens, and beside them ONE NUMBER PER TOKEN: the INDEX,
  // within the token, of the first character that came from inside quotes or
  // from a backslash escape — `-1` when the whole word is bare. The
  // redirection strip below is its only reader, and it needs the index rather
  // than a yes/no because the shell decides a redirection on the QUOTING OF
  // THE OPERATOR: `>"out.txt"` redirects (first literal character at 1, past
  // the `>`) while `">"out.txt` is the argument `>out.txt` (first literal
  // character at 0, on the operator itself). A yes/no answered both with
  // "data" and let a real redirection ride into argv (round-7 leg, H1/H2); it
  // answered `-b "<br>" 5` correctly, and so does the index (round-6 leg,
  // G1). The numbers ride in a PARALLEL array so every reader of a token stays
  // a reader of a plain string. It annotates the walk's output; it changes no
  // grammar.
  const segments = [];
  const literalAts = [];
  let current = [];
  let currentLiteralAt = [];
  let token = '';
  let hasToken = false;
  let tokenLiteralAt = -1;
  let i = 0;
  /** The next character appended to this token is literal: mark the first. */
  const markLiteral = () => {
    if (tokenLiteralAt === -1) tokenLiteralAt = token.length;
  };
  const endToken = () => {
    if (hasToken) {
      current.push(token);
      currentLiteralAt.push(tokenLiteralAt);
      token = '';
      hasToken = false;
      tokenLiteralAt = -1;
    }
  };
  const endSegment = () => {
    endToken();
    segments.push(current);
    literalAts.push(currentLiteralAt);
    current = [];
    currentLiteralAt = [];
  };
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      hasToken = true;
      markLiteral();
      i++;
      while (i < command.length && command[i] !== "'") {
        token += command[i];
        i++;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      hasToken = true;
      markLiteral();
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length) {
          token += command[i + 1];
          i += 2;
          continue;
        }
        token += command[i];
        i++;
      }
      i++;
      continue;
    }
    // A parameter expansion is ONE word: without this, `${PR}` splits on its
    // braces and the unresolved-target evidence line reads just "$"
    // (mmnto-ai/totem#2800 round 2, F10). A `$( … )` is deliberately NOT
    // swallowed the same way — a real `gh pr merge` inside a command
    // substitution has to keep firing, so its parens stay separators.
    if (ch === '$' && command[i + 1] === '{') {
      const close = command.indexOf('}', i + 2);
      const end = close === -1 ? command.length : close + 1;
      token += command.slice(i, end);
      hasToken = true;
      i = end;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken();
      i++;
      continue;
    }
    // A BACKTICK command substitution opens a segment of its own
    // (mmnto-ai/totem#2856 § C): its operand is a command the shell runs, so a
    // merge inside one has to be judged, exactly as a merge inside `$( … )`
    // is. The backtick is kept as a TOKEN, the way `$(` leaves its `$` behind:
    // without it a merge whose TARGET is a backtick substitution would lose
    // that target and fall back to the current branch — judging a pull request
    // the command never named. One inside a heredoc body is already blanked,
    // and that is correct — a body is data. One inside DOUBLE quotes never
    // reaches here either, because the quote arm above swallows the whole
    // string as one token — and that one is NOT data: bash executes a backtick
    // pair and a `$( … )` inside double quotes, so `echo "`gh pr merge 5`"`
    // merges PR 5 unjudged. A disclosed fail-open, filed as
    // mmnto-ai/totem#2893 (round-5 leg, F4).
    // POWERSHELL'S LINE CONTINUATION is a trailing BACKTICK — the twin of the
    // backslash-newline arm below AT A WORD BOUNDARY, and the reason this one
    // has to be read first: in ps mode the backtick and the newline after it
    // are consumed and the next line's words continue the command, so
    // `gh pr merge <backtick><LF>5` is `gh pr merge 5`. Read as the segment
    // separator it is in BASH, that command projected the backtick itself as
    // the merge's target (`unresolvedTarget`, a deny on a target nobody wrote
    // under strict) while the real target sat in the next segment and merged
    // unjudged (round-6 leg, G3). Bash keeps the separator: there a backtick
    // opens a command substitution, whatever follows it.
    //
    // INSIDE A WORD the two shells part company (round-7 leg, H4). Bash's
    // backslash-newline really joins the halves — `me\<LF>rge` is `merge`
    // — while PowerShell's backtick is its ESCAPE character and
    // `merg<backtick><LF>e` is the single argument `merg<LF>e`, which is not
    // `merge` and runs nothing. So the join applies only where no token is
    // open; inside one, the escaped newline lands IN the token, the anchor
    // fails to match, and nothing is projected — which is what PowerShell
    // does. Joining there projected a merge the shell never runs.
    if (
      powershell === true &&
      ch === '`' &&
      (command[i + 1] === '\n' || (command[i + 1] === '\r' && command[i + 2] === '\n'))
    ) {
      if (hasToken) {
        markLiteral();
        token += '\n';
      }
      i += command[i + 1] === '\r' ? 3 : 2;
      continue;
    }
    if (ch === '`') {
      endToken();
      current.push('`');
      currentLiteralAt.push(-1);
      endSegment();
      i++;
      continue;
    }
    if (
      ch === ';' ||
      ch === '&' ||
      ch === '|' ||
      ch === '\n' ||
      ch === '(' ||
      ch === ')' ||
      ch === '{' ||
      ch === '}'
    ) {
      endSegment();
      i++;
      continue;
    }
    // A line continuation joins the two halves of ONE word (`gh \<LF>pr` is
    // `ghpr` to the shell, and `gh \<LF>pr merge` keeps `gh` at the front of
    // the segment): drop both characters and keep tokenizing (round 3, F6).
    if (ch === '\\' && (command[i + 1] === '\n' || (command[i + 1] === '\r' && command[i + 2] === '\n'))) {
      i += command[i + 1] === '\r' ? 3 : 2;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      markLiteral();
      token += command[i + 1];
      hasToken = true;
      i += 2;
      continue;
    }
    token += ch;
    hasToken = true;
    i++;
  }
  endSegment();

  const found = [];
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    const literalAt = literalAts[s];
    // FIRST, over the WHOLE segment: drop every redirection (the two patterns
    // above). It runs before the strip below and before the anchor test, so a
    // redirection in front of the command does not hide it, one in the middle
    // does not break the anchor, and a trailing one never rides into argv.
    // The OPERATOR's own quoting decides, as it does in the shell: strip only
    // when the matched operator prefix lies entirely before the token's first
    // literal character (round-7 leg, H1/H2).
    let tokens = [];
    for (let r = 0; r < segment.length; r++) {
      const word = segment[r];
      const at = literalAt[r];
      if (REDIRECTION_ALONE.test(word) && (at === -1 || word.length <= at)) {
        // The operator and the file it names, both gone — however that file
        // is spelled: `> "out.txt"` is as real a redirection as `> out.txt`.
        r += 1;
        continue;
      }
      const fused = REDIRECTION_FUSED.exec(word);
      if (fused !== null && (at === -1 || fused[1].length <= at)) continue;
      tokens.push(word);
    }
    // Then strip everything at the segment's front that is NOT the command, in
    // any run: a transparent wrapper with its options (the table above), a
    // command-position word, an assignment prefix. The loop re-runs after each
    // one, so `env -u X A=1 gh …` and `sudo -u root timeout 30 gh …` both
    // resolve to the same anchor test.
    let stripping = true;
    while (stripping && tokens.length > 0) {
      const head = tokens[0];
      const wrapper = Object.prototype.hasOwnProperty.call(TRANSPARENT_WRAPPERS, head)
        ? TRANSPARENT_WRAPPERS[head]
        : null;
      if (wrapper === null) {
        if (COMMAND_POSITION_WORDS.indexOf(head) !== -1 || isAssignmentPrefix(head)) {
          tokens = tokens.slice(1);
          continue;
        }
        break;
      }
      tokens = tokens.slice(1);
      // `eval` hands the shell a STRING: join what is left with one space and
      // re-tokenize it ONCE. That inner projection IS this segment's, and the
      // depth bound keeps `eval "eval \"gh pr merge 5\""` a disclosed miss.
      if (wrapper.evaluates === true) {
        if (level < 1 && tokens.length > 0) {
          const inner = ghPrMergeArgvs(tokens.join(' '), powershell, level + 1);
          for (let k = 0; k < inner.length; k++) {
            found.push(inner[k]);
          }
        }
        tokens = [];
        break;
      }
      while (tokens.length > 0 && tokens[0].charAt(0) === '-' && tokens[0].length > 1) {
        const opt = tokens[0];
        if (opt === '--') {
          tokens = tokens.slice(1);
          if (wrapper.terminator === true) break;
          continue;
        }
        if (wrapper.describe !== undefined && wrapper.describe.indexOf(opt) !== -1) {
          // `command -v gh …` prints a path and `sudo -l gh …` prints a
          // policy line; each runs nothing, so there is nothing to judge and
          // nothing to project.
          tokens = [];
          stripping = false;
          break;
        }
        if (wrapper.flags !== undefined && wrapper.flags.indexOf(opt) === -1) {
          // A `-` token that is not one of this word's OWN options: the shell
          // has no command to run here (`time -f x gh pr merge 5` makes bash
          // try to run `-f`), so the segment ends with no projection.
          tokens = [];
          stripping = false;
          break;
        }
        if (wrapper.evaluatesOperand !== undefined) {
          // Where the operand is: a LONG option carries an attached one after
          // an `=` (`--split-string='gh pr merge 5'`), a SHORT one carries it
          // with no separator at all (`-Sgh pr merge 5`, and
          // `-S'gh pr merge 5'`, which the quote arm joins into that same
          // token), and otherwise it is the NEXT token. An `=` is not a
          // separator for a short option — `env -S=x` hands env the operand
          // `=x` — so the split is long-only (round-7 leg, H5).
          let name = opt;
          let attached = null;
          if (opt.charAt(1) === '-') {
            const eq = opt.indexOf('=');
            if (eq !== -1) {
              name = opt.slice(0, eq);
              attached = opt.slice(eq + 1);
            }
          } else {
            name = opt.slice(0, 2);
            if (opt.length > 2) attached = opt.slice(2);
          }
          if (wrapper.evaluatesOperand.indexOf(name) !== -1) {
            // The operand is a COMMAND STRING, not a value to skip past: env
            // splits it into words and prepends them to what follows. Split
            // on whitespace — env's own rule — put the words where the option
            // stood, and let the strip read on, so the assignment strip runs
            // for `env -S 'A=1 gh pr merge 5'` and the anchor sees `gh`.
            const operandText = attached === null ? (tokens.length > 1 ? tokens[1] : '') : attached;
            const rest = tokens.slice(attached === null ? 2 : 1);
            const words = operandText.split(/\s+/);
            tokens = [];
            for (let w = 0; w < words.length; w++) {
              if (words[w] !== '') tokens.push(words[w]);
            }
            tokens = tokens.concat(rest);
            continue;
          }
        }
        if (wrapper.operand.indexOf(opt) !== -1) {
          tokens = tokens.slice(2);
          continue;
        }
        tokens = tokens.slice(1);
      }
      for (let p = 0; stripping && p < wrapper.positional && tokens.length > 0; p++) {
        tokens = tokens.slice(1);
      }
    }
    if (
      tokens.length >= 3 &&
      isGhExecutable(tokens[0]) &&
      tokens[1] === 'pr' &&
      tokens[2] === 'merge'
    ) {
      found.push(tokens.slice(3));
    }
  }
  return found;
}

// ─── The one budget for the whole run (mmnto-ai/totem#2856 § D) ─────────
// The instant this hook must be finished by. It is set as the FIRST thing the
// entry does — before stdin is read and before any projection — so that EVERY
// spawn this process makes, the projection's git reads included, is bounded by
// it. Before this PR the deadline came into being only at the evaluation loop,
// and the projection ran up to three 10-second git reads per merge ahead of
// it: a hung git on a multi-merge envelope reached the HOST's hook timeout,
// where a killed hook's exit code is never applied — a fail-OPEN on a gate
// whose posture is fail-closed (round 3, F3).
//
// Zero until the entry sets it, which reads as "already spent": an exported
// `projectMergeReady` (the seam below) therefore does no git reads at all.
let deadline = 0;

/** The default budget, and the ceiling `--budget-ms` is clamped to. */
const DEFAULT_BUDGET_MS = 30000;

/**
 * The budget a `--budget-ms <n>` argument asks for, clamped to
 * [1000, 30000]. The clamp is SILENT and one-directional by design: the
 * argument exists so a test can shorten the window, and a malformed or
 * oversized value must never WIDEN it (Tenet 4 keeps the safe direction). The
 * value it settles on is echoed in the budget line when the arm fires.
 */
function clampBudgetMs(raw) {
  const n = parseInt(String(raw), 10);
  if (!isFinite(n) || n > DEFAULT_BUDGET_MS) return DEFAULT_BUDGET_MS;
  if (n < 1000) return 1000;
  return n;
}

/**
 * Run git read-only and return trimmed stdout, or '' when it did not answer.
 * Bounded by what is LEFT of the budget (never more than 10 s, never less than
 * a 250 ms floor), and it does not spawn at all once the budget is spent.
 */
function gitRead(args) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return '';
  const res = spawnSync('git', args, {
    encoding: 'utf-8',
    timeout: Math.max(250, Math.min(10000, remaining)),
  });
  if (res.error || typeof res.status !== 'number' || res.status !== 0) return '';
  return (res.stdout || '').trim();
}

/** `owner/name` out of any git remote URL shape (ssh, https, with or without .git). */
function repoFromRemote(url) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(url.trim());
  return m ? m[1] + '/' + m[2] : '';
}

// The flags of `gh pr merge` that CONSUME the next argv element — without this
// list, `gh pr merge -b "some branch"` would read the body as the PR target.
const GH_MERGE_VALUE_FLAGS = [
  '-R',
  '--repo',
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-t',
  '--subject',
  '--match-head-commit',
  '--author-email',
];

/**
 * Project { repo, pr, branch?, headSha? } from the argv after `gh pr merge`:
 * a number, a PR URL, a branch, `-R/--repo`. With no argument at all, gh
 * merges the PR for the CURRENT branch — so the payload carries pr: null plus
 * that branch, exactly as the gate's payload contract allows.
 */
function projectMergeReady(argv) {
  let repo = '';
  let pr = null;
  let branch = '';
  let positional = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    if (arg.slice(0, 2) === '--' && eq > 2) {
      if (arg.slice(0, eq) === '--repo') repo = arg.slice(eq + 1);
      continue;
    }
    if (GH_MERGE_VALUE_FLAGS.indexOf(arg) !== -1) {
      if (arg === '-R' || arg === '--repo') repo = argv[i + 1] || '';
      i++;
      continue;
    }
    if (arg.charAt(0) === '-') continue;
    if (positional === null) positional = arg;
  }

  // An UNEXPANDED shell variable (`gh pr merge $PR`) is not a target this
  // projection can know (mmnto-ai/totem#2800 fold F13): the shell expands it
  // after the hook has already decided. Reading it as a branch name would judge
  // the wrong PR — or none — so it rides as `unresolvedTarget`, which the
  // engine treats as unevaluable (strict denies, pilot warns).
  let unresolvedTarget = '';
  if (positional !== null && /[$`]/.test(positional)) {
    unresolvedTarget = positional;
    positional = null;
  }

  if (positional !== null) {
    const url = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(positional);
    if (url) {
      if (repo === '') repo = url[1] + '/' + url[2];
      pr = parseInt(url[3], 10);
    } else if (/^\d+$/.test(positional)) {
      pr = parseInt(positional, 10);
    } else {
      branch = positional;
    }
  }

  // gh itself honours GH_REPO before the git remote; mirror that order so the
  // gate reads the SAME pull request the command would merge.
  if (repo === '') repo = (process.env.GH_REPO || '').trim();
  if (repo === '') repo = repoFromRemote(gitRead(['config', '--get', 'remote.origin.url']));
  // The current-branch fallback is for a command that named NO target. An
  // unresolved one named a target we could not read, so it must not fall back.
  if (pr === null && branch === '' && unresolvedTarget === '') {
    branch = gitRead(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  const headSha = gitRead(['rev-parse', 'HEAD']);
  const out = { repo: repo, pr: pr };
  if (branch !== '') out.branch = branch;
  if (unresolvedTarget !== '') out.unresolvedTarget = unresolvedTarget;
  if (/^[0-9a-f]{40}$/i.test(headSha)) out.headSha = headSha;
  return out;
}

// ─── The export seam (mmnto-ai/totem#2856 § E) ─────────────────────────
// Everything above is pure and side-effect free; everything below is the
// hook's ENTRY — it reads argv and stdin and exits the process. A `require`
// of this file (the suite's in-process driver for the strip table, the
// executable test, the budget clamp and the scanner-parity lock) must run
// NEITHER, so the entry runs only when this file is the main module. The
// module-scope `return` is CommonJS's own early exit, and it sits AFTER every
// module-level binding above so the exported functions are all initialized.
//
// Nothing else changes when the file runs as a hook: `require.main` is this
// module, the `return` is not taken, and the entry below is the same code it
// has always been. One consequence worth naming: an exported
// `projectMergeReady` runs with no budget set (see `deadline`), so it does no
// git reads — the projection's shape is what the seam is for, the git facts
// are the entry's.
if (require.main !== module) {
  module.exports = {
    blankHeredocBodies: blankHeredocBodies,
    clampBudgetMs: clampBudgetMs,
    findHeredocSpans: findHeredocSpans,
    ghPrMergeArgvs: ghPrMergeArgvs,
    isGhExecutable: isGhExecutable,
    projectMergeReady: projectMergeReady,
  };
  return;
}

// ─── Parse baked args (--event <name>, optional --pilot / --strict) ─────
// The tier is read ONLY from argv (baked into the installed command at
// install time). There is NO env-var override: env sourcing would be a
// fail-open (any shell with TOTEM_GATE_TIER=pilot could silently downgrade
// enforcement). Default (no flag) = strict, so a default install is
// environment-immune; --pilot is an explicit install-time opt-in.
//
// `--budget-ms <n>` is the one argument the install line never writes: it
// exists so a test can SHORTEN the run's budget, and it is clamped so it can
// only ever shorten it (§ D). An env var was the alternative and was ruled
// out for the same reason the tier is argv-only — any shell could set it.
// BOTH spellings parse: `--budget-ms 1500` and `--budget-ms=1500`. The
// attached form used to fall through as an unknown argument and silently left
// the 30 000 ms default standing — a WIDENING on a caller that wrote the
// argument to shorten the window (round-5 leg, F7). A repeated flag is
// last-wins, and no spelling of it can ever exceed the default, because every
// value goes through the same clamp.
const argv = process.argv.slice(2);
let event = '';
let tier = 'strict';
let budgetMs = DEFAULT_BUDGET_MS;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--event') {
    event = argv[i + 1] || '';
    i++;
  } else if (argv[i] === '--pilot') {
    tier = 'pilot';
  } else if (argv[i] === '--strict') {
    tier = 'strict';
  } else if (argv[i] === '--budget-ms') {
    budgetMs = clampBudgetMs(argv[i + 1]);
    i++;
  } else if (argv[i].slice(0, 12) === '--budget-ms=') {
    budgetMs = clampBudgetMs(argv[i].slice(12));
  }
}

// The FIRST thing the entry does after reading its own arguments: from here on
// every spawn — the projection's git reads and the evaluation loop's gate
// checks alike — is bounded by one deadline, so the wrapper always terminates
// within the budget plus one 1 000 ms floor with its OWN exit code.
deadline = Date.now() + budgetMs;

// …and the READ of the envelope is inside it too (round-5 leg, F6). The budget
// used to start counting for everything the hook did AFTER the envelope had
// arrived; arriving itself was unbounded. A host that writes the envelope and
// holds the pipe open, or hands this hook a stdin that never ends, left it
// waiting with no deadline of its own until the HOST's own timeout killed it —
// and a killed hook's exit code is never applied, which is a fail-OPEN on a
// gate whose posture is fail-closed. Exactly the class § D cured for the
// projection's git reads, one step earlier in the run.
//
// The timer is cleared by the `end` handler below BEFORE anything is
// evaluated, so a normal run — every run where stdin closes — never sees it.
const stdinBudgetTimer = setTimeout(
  () => {
    process.stderr.write(
      '[totem gate-wrapper] the ' +
        budgetMs +
        ' ms budget was spent before the envelope arrived on stdin — blocking (fail-closed).\n',
    );
    process.exit(2);
  },
  Math.max(0, deadline - Date.now()),
);

// Read the PreToolUse stdin envelope.
let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
  clearTimeout(stdinBudgetTimer);
  let parsed;
  try {
    parsed = stdin ? JSON.parse(stdin) : {};
  } catch (err) {
    // Fail-soft on a malformed envelope (mirror PreWriteShield): a broken
    // host envelope is not an applicable gate, so it must NOT block.
    process.stderr.write('[totem gate-wrapper] could not parse stdin JSON; allowing\n');
    process.exit(0);
  }

  // Valid JSON can still be a non-object (the bytes `null`, `123`, or a bare
  // quoted string). Such an envelope carries no `tool_input` to dereference and
  // is NOT an applicable gate → fail-soft (exit 0). Guarding here also prevents
  // a TypeError-on-deref from leaking as exit 1.
  if (parsed === null || typeof parsed !== 'object') {
    process.stderr.write('[totem gate-wrapper] stdin JSON is not an object; allowing\n');
    process.exit(0);
  }

  const input =
    typeof parsed.tool_input === 'object' && parsed.tool_input !== null ? parsed.tool_input : {};

  // ─── PER-EVENT PAYLOAD PROJECTION ─────────────────────────────────────
  // Each gate reads a DIFFERENT slice of the PreToolUse envelope, so the
  // projection branches on the baked --event. Every branch owns its own
  // NOT-APPLICABLE test — the point past which a gate genuinely applies and
  // any evaluation failure must fail CLOSED.
  //
  //   event            | applies when                     | payload
  //   -----------------|----------------------------------|---------------------------
  //   freeze-check     | tool_input.subsystem is a         | { subsystem }
  //                    | non-empty string                  |
  //   transport-shield | tool_name is Bash or PowerShell   | { tool, command, platform }
  //                    | AND tool_input.command is a       |
  //                    | non-empty string                  |
  //   merge-ready      | tool_name is Bash or PowerShell   | { repo, pr, branch?, headSha? }
  //                    | AND the command runs `gh pr merge`|
  //                    | at COMMAND POSITION               |
  //   (anything else)  | — no projection → fail closed     | —
  //
  // A projection yields ONE payload per gate evaluation — and merge-ready can
  // yield several for one envelope (one per `gh pr merge` at command
  // position), each judged on its own below.
  let payloads = [];

  if (event === 'freeze-check') {
    // THE EMPTY-SUBSYSTEM GUARDRAIL: freeze-check's predicate is on a DECLARED
    // subsystem. A normal Edit/Write carries tool_input.file_path (a path), NOT
    // a subsystem. With no declared subsystem, NO GATE APPLIES → pass through
    // (exit 0). Do NOT shell out — a blanket fail-closed here would block every
    // ordinary edit.
    const declaredSubsystem =
      typeof input.subsystem === 'string' && input.subsystem.trim() !== ''
        ? input.subsystem.trim()
        : '';
    if (declaredSubsystem === '') {
      process.exit(0);
    }
    payloads = [JSON.stringify({ subsystem: declaredSubsystem })];
  } else if (event === 'transport-shield') {
    // transport-shield's predicate is on a SHELL COMMAND. Anything that is not
    // a Bash/PowerShell invocation carrying a command string is NOT an
    // applicable gate → pass through (exit 0), mirroring the guardrail above.
    // The installed matcher is the CLI's own, so a foreign tool_name here means
    // a hand-edited settings entry, not a shape to judge.
    const tool = parsed.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    if (typeof input.command !== 'string' || input.command.trim() === '') {
      process.exit(0);
    }
    payloads = [
      JSON.stringify({
        tool: tool,
        command: input.command,
        platform: process.platform,
      }),
    ];
  } else if (event === 'merge-ready') {
    // merge-ready's predicate is on a PULL REQUEST about to be merged. The gate
    // installs under Bash|PowerShell, so this branch sees every shell command:
    // anything that is not `gh pr merge` at COMMAND POSITION is NOT an
    // applicable gate → pass through (exit 0) WITHOUT spawning.
    const tool = parsed.tool_name;
    if (tool !== 'Bash' && tool !== 'PowerShell') {
      process.exit(0);
    }
    if (typeof input.command !== 'string' || input.command.trim() === '') {
      process.exit(0);
    }
    const merges = ghPrMergeArgvs(input.command, tool === 'PowerShell');
    if (merges.length === 0) {
      process.exit(0);
    }
    // One payload per merge: `gh pr merge 7; gh pr merge 8` is judged twice,
    // each PR against its own facts (mmnto-ai/totem#2844 round 1).
    for (let m = 0; m < merges.length; m++) {
      payloads.push(JSON.stringify(projectMergeReady(merges[m])));
    }
  } else {
    // A baked --event this wrapper cannot project is an APPLICABLE gate it
    // cannot evaluate → fail closed (ADR-109). Reinstalling refreshes the
    // wrapper (`totem gate install` drift-repairs the bounded region).
    process.stderr.write(
      '[totem gate-wrapper] no payload projection for event "' + event + '"; failing closed.\n',
    );
    process.exit(2);
  }

  // No payload past the projection is not an applicable gate that passed — it
  // is a branch above that forgot to project, and before the loop that shape
  // fail-closed through the child's non-zero exit. Keep the default closed
  // (round 2, F7).
  if (payloads.length === 0) {
    process.stderr.write(
      '[totem gate-wrapper] event "' + event + '" projected no payload; failing closed.\n',
    );
    process.exit(2);
  }

  // Resolve the Totem CLI: the repo-local pinned dist FIRST (a global `totem`
  // may be stale and missing deps — the known repo gotcha; the
  // pinned-beats-ambient ordering of ADR-072 § 2, Tenet 14), then a `totem` on
  // PATH as a FALLBACK (mmnto-ai/totem#2822 — the bootstrap self-block above).
  // Invoke node on whichever dist entry resolved.
  //
  // FAIL-CLOSED when NEITHER arm resolves: we are PAST the per-event
  // applicability guardrail (freeze-check: a declared subsystem;
  // transport-shield: a Bash or PowerShell command), so a gate genuinely
  // APPLIES here. Neither gate has a commit-time hard floor (unlike
  // PreWriteShield, whose fail-soft is backed by `totem-lint` at commit), so an
  // APPLICABLE gate that cannot be evaluated for ANY reason (no CLI anywhere OR
  // a broken source) must fail closed — not silently allow (guardrail rule +
  // Tenet 4 fail-closed). Fail-SOFT (exit 0) is reserved for genuinely
  // NOT-APPLICABLE inputs (unparseable/non-object envelope, no declared
  // subsystem, no shell command), all of which already returned above.
  const localCliPath = join(process.cwd(), 'node_modules', '@mmnto', 'cli', 'dist', 'index.js');
  let cliPath = '';
  // Which arm resolved — 'repo-local' or 'PATH' — for the provenance line the
  // fail-closed arms below disclose. Empty until one resolves.
  let arm = '';
  // The PATH arm's non-resolvable rendering of what it found (basenames only).
  let cliDisplay = '';
  if (existsSync(localCliPath)) {
    cliPath = localCliPath;
    arm = 'repo-local';
  } else {
    const fromPath = resolveCliFromPath();
    if (fromPath) {
      cliPath = fromPath.entry;
      cliDisplay = fromPath.display;
      arm = 'PATH';
    }
  }

  if (!cliPath) {
    // The exits named here must be exits the gate does NOT block: "reinstall
    // totem" and `totem eject` are Bash commands a Bash|PowerShell gate blocks
    // with this very message (mmnto-ai/totem#2822). They are ORDERED: the
    // editor path still needs the bootstrap before the gate can be reinstalled.
    process.stderr.write(
      '[totem gate] ' +
        event +
        ' applies but no totem CLI is resolvable ' +
        '(repo-local node_modules/@mmnto/cli/dist/index.js absent; no totem on PATH); ' +
        'failing closed. Exits: bootstrap from a terminal OUTSIDE the harness ' +
        '(pnpm install and pnpm build, or npm i -g @mmnto/cli); or remove this ' +
        "gate's entry from .claude/settings.json with the editor, bootstrap, " +
        'then re-run totem gate install ' +
        event +
        '.\n',
    );
    process.exit(2);
  }

  // The payload rides on the child's STDIN (`--payload -`), never argv: a Bash
  // command can run to tens of kilobytes and win32 caps a command line at
  // 32,767 characters — an argv payload past it fails the spawn with
  // ENAMETOOLONG and would land in the fail-closed arm below with nothing
  // broken (mmnto-ai/totem#2799, pass 3).
  // The baked tier rides along (mmnto-ai/totem#2800 R1): the ENGINE owns the
  // strict/pilot split for a gate's UNEVALUABLE class (a read that could not
  // derive), while the disposition → exit map below stays the wrapper's. A gate
  // that ignores the tier — freeze-check — still fails closed at both.
  //
  // `--tier` is forwarded ONLY when it is NOT the default (fold F3): a CLI at
  // or below 2.2.1 has no such option and would exit non-zero with
  // "unknown option", which is the fail-closed arm — and on a
  // `Bash|PowerShell` gate that re-creates the mmnto-ai/totem#2822 bootstrap
  // self-block through the PATH arm. `strict` IS the engine's default, so a
  // strict wrapper stays runnable against a 2.2.x CLI; a `--pilot` install
  // passes the flag and needs a CLI at 2.3.0 or newer (the install-time
  // disclosure says so).
  const checkArgs = [cliPath, 'gate', 'check', '--event', event];
  if (tier !== 'strict') {
    checkArgs.push('--tier', tier);
  }
  checkArgs.push('--payload', '-');

  // Provenance for the PATH fallback arm (mmnto-ai/totem#2822): a CLI older
  // than 2.2.0 has no `gate check --payload -` and lands in the fail-closed
  // arms below (unknown option → non-zero exit, or nothing on stdout). The
  // BEHAVIOUR is unchanged — exit 2 either way — the line only names WHICH CLI
  // evaluated and how to update it. Empty on the repo-local arm. It prints the
  // basename rendering, never the absolute entry: this is transcript-bound text.
  // The floor NAMED here is the floor this wrapper actually needs: a strict
  // wrapper sends no `--tier`, so 2.2.0 (the `--payload -` cut) still answers
  // it; a pilot wrapper sends `--tier pilot`, which only 2.3.0 and newer parse
  // (mmnto-ai/totem#2800 fold F3).
  const armNote =
    arm === 'PATH'
      ? 'evaluated by the PATH CLI at ' +
        cliDisplay +
        (tier === 'strict'
          ? "; a CLI older than 2.2.0 lacks 'gate check --payload -' — "
          : "; a CLI older than 2.3.0 lacks 'gate check --tier' (this entry is baked --pilot) — ") +
        'update it: npm i -g @mmnto/cli@latest\n'
      : '';

  // ─── One evaluation per projected payload ─────────────────────────────
  // freeze-check and transport-shield project exactly one. merge-ready projects
  // one per `gh pr merge` at command position, so `gh pr merge 7; gh pr merge 8`
  // is judged TWICE, each PR on its own facts — judging only the first let the
  // shell run the second unjudged (mmnto-ai/totem#2844 round 1). The first
  // strict deny, and every fail-closed arm, EXITS at once; a warn, and a deny
  // under --pilot, print their line and let the NEXT payload be judged, so every
  // merge in the envelope gets its stderr line; exit 0 only once every payload
  // has allowed or warned.
  //
  // ONE budget across every payload, not one per payload (round 2, F5): the
  // hook host kills a PreToolUse hook at its own default budget (60 s on both
  // Claude Code and Gemini, the same figure the session-hook templates above
  // cut their legs against) and a killed hook's exit code is never applied — a
  // fail-OPEN on a gate whose posture is fail-closed. The budget is set at the
  // ENTRY (see `deadline` above), so it now covers the projection's git reads
  // too (mmnto-ai/totem#2856 § D); before that it began here, and a hung git
  // ahead of it could run the hook into the host's kill through up to three
  // 10-second reads per merge (round 3, F3).
  //
  // Two arms keep the whole run inside it: a payload whose spawn would start
  // past the deadline gets the fail-closed line below INSTEAD of a spawn, and
  // a spawn that starts inside it still gets the one-second floor (round 3,
  // F2) and times out into the evaluation-failed arm. Either way the wrapper
  // exits with its OWN code, inside the budget plus one floor.
  for (let p = 0; p < payloads.length; p++) {
    if (Date.now() >= deadline) {
      process.stderr.write(
        '[totem gate-wrapper] the ' +
          budgetMs +
          ' ms budget was spent before gate "' +
          event +
          "\" could be evaluated (the projection's git reads did not answer in time) — blocking (fail-closed).\n",
      );
      process.exit(2);
    }
    const result = spawnSync(process.execPath, checkArgs, {
      encoding: 'utf-8',
      timeout: Math.max(1000, deadline - Date.now()),
      input: payloads[p],
    });

    // ─── The child's stderr IS a gate surface (fold F1) ──────────────────
    // merge-ready's audited-override line, its zero-checks fact and every
    // "could not derive" line are written by the ENGINE to stderr. Passing them
    // through verbatim in EVERY arm — allow included — is what puts them in the
    // transcript; printing them only on failure hid the override's audit trail,
    // the one line that must never be silent.
    if (typeof result.stderr === 'string' && result.stderr !== '') {
      process.stderr.write(result.stderr);
    }

    // ─── FAIL-CLOSED ────────────────────────────────────────────────────
    // A gate genuinely applies (the per-event projection above found its input:
    // a declared subsystem, or a Bash/PowerShell command) and the evaluation
    // itself failed (non-zero exit: corrupt freeze.json, an invalid payload,
    // spawn error, etc.). Never silently allow when an applicable gate's source
    // is broken → exit 2. (Not-applicable envelopes already returned exit 0
    // above, so this only blocks when the gate's input was actually present.)
    if (result.error || typeof result.status !== 'number' || result.status !== 0) {
      process.stderr.write(
        '[totem gate-wrapper] gate "' +
          event +
          '" evaluation failed (source broken or unavailable) — blocking (fail-closed).\n' +
          // The child's stderr already went through verbatim above (fold F1);
          // only a spawn-level error (no child, so no stderr) is added here.
          (result.error ? String(result.error.message || result.error) + '\n' : '') +
          armNote,
      );
      process.exit(2);
    }

    let verdict;
    try {
      verdict = JSON.parse(result.stdout || '');
    } catch (err) {
      // The command emitted unparseable stdout despite a 0 exit — an applicable
      // gate whose verdict we cannot read is a broken source → fail-closed.
      process.stderr.write(
        '[totem gate-wrapper] gate "' + event + '" emitted unparseable verdict — blocking (fail-closed).\n' + armNote,
      );
      process.exit(2);
    }

    // ─── Disposition → host exit code (branch ONLY on disposition) ───────
    const disposition = verdict && typeof verdict.disposition === 'string' ? verdict.disposition : '';
    // reason/provenance are OPAQUE stderr passthrough — never parsed for control flow.
    const detail =
      (verdict && verdict.reason ? verdict.reason : '') +
      (verdict && verdict.provenance ? ' [' + JSON.stringify(verdict.provenance) + ']' : '');

    if (disposition === 'allow') {
      // Deliberately SILENT on the PATH arm too: a provenance line on every
      // allowed Bash command would be transcript noise on the common path, and
      // the operator already learned the property at install time (the
      // `gate install` disclosure) — stderr here is reserved for what blocks.
      continue;
    }
    if (disposition === 'warn') {
      process.stderr.write('[totem gate-wrapper] ' + event + ' (warn): ' + detail + '\n');
      continue;
    }
    if (disposition === 'deny') {
      process.stderr.write('[totem gate-wrapper] ' + event + ' (deny): ' + detail + '\n');
      if (tier !== 'pilot') {
        process.exit(2);
      }
      continue;
    }

    // Unknown disposition from an applicable gate — fail-closed. The provenance
    // note rides here too, so all four not-evaluable causes in the exit-code
    // contract above disclose which arm evaluated.
    process.stderr.write(
      '[totem gate-wrapper] gate "' + event + '" returned unknown disposition "' + disposition + '" — blocking (fail-closed).\n' + armNote,
    );
    process.exit(2);
  }
  process.exit(0);
});
// [totem] end auto-generated

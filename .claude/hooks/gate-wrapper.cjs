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

// ─── Parse baked args (--event <name>, optional --pilot / --strict) ─────
// The tier is read ONLY from argv (baked into the installed command at
// install time). There is NO env-var override: env sourcing would be a
// fail-open (any shell with TOTEM_GATE_TIER=pilot could silently downgrade
// enforcement). Default (no flag) = strict, so a default install is
// environment-immune; --pilot is an explicit install-time opt-in.
const argv = process.argv.slice(2);
let event = '';
let tier = 'strict';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--event') {
    event = argv[i + 1] || '';
    i++;
  } else if (argv[i] === '--pilot') {
    tier = 'pilot';
  } else if (argv[i] === '--strict') {
    tier = 'strict';
  }
}

// ─── merge-ready: `gh pr merge` at COMMAND POSITION + its payload ──────
//
// One walk over the command text does BOTH jobs, so recognition and argv
// extraction can never disagree: it tracks quoting, splits on the unquoted
// command separators (`;`, `&`, `|`, a newline, `(`/`)`, `{`/`}`) and
// tokenizes each segment. A segment whose FIRST token is `gh`, followed by
// `pr` and `merge`, is a merge at command position; a quoted
// "gh pr merge" is a single token and never matches, so
// `echo "gh pr merge"` does not fire. The shell's own COMMAND-POSITION words
// are skipped before the anchor is read — the reserved words `do`, `then`,
// `else`, `if`, `elif`, `while`, `until` and `!`, the builtins `exec` and
// `command` (which run their operand as the command), and any run of
// `NAME=value` assignment prefixes — so `for … ; do gh pr merge; done`,
// `if gh pr merge 5; then …` and `GH_TOKEN=x gh pr merge 5` all fire. Before
// the PR's review round only `do`/`then`/`else`/`!` were skipped, so a merge
// used AS an `if` condition, or behind an assignment prefix, went unjudged
// (mmnto-ai/totem#2844 round 1, greptile). EVERY matching segment is
// collected, not the first: `gh pr merge 7; gh pr merge 8` yields two argv
// lists and the wrapper judges each PR on its own facts (same round).
//
// HEREDOC BODIES ARE BLANKED FIRST (mmnto-ai/totem#2800 fold F4). A heredoc
// body is DATA, not commands: `cat <<EOF` … `gh pr merge 5` … `EOF` writes a
// line of text and merges nothing, and firing there was a false deny — the one
// direction this projection must not have. The blanker is the shape core's
// transport-shield scanner uses, in a self-contained form because a distributed
// hook cannot import core: quoted (`<<'EOF'`, `<<"EOF"`, `<<\EOF`) and bare
// delimiters, `<<` and `<<-` (whose terminator may be tab-indented), an
// unterminated body read to the end of the command, and `<<<` left alone (a
// here-string is not a heredoc). Round 2 added the two guards that keep the
// blanker from EATING commands: `$(( … ))` / `(( … ))` is skipped whole, so a
// shift (`$((1<<2))`) opens nothing, and a `#` that begins a word is a comment
// discarded to end-of-line, so neither its text nor a `<<note` inside it is
// read — before them, either one swallowed the rest of the command and a real
// merge after it went unjudged. Every `<<` on the operator line is queued and
// its body consumed in order, as bash does for `cat <<A <<B`.
//
// Disclosed misses, same posture as transport-shield's scanner — the gate does
// NOT fire, which is the safe direction, never a false deny:
//   - a wrapper PROGRAM that takes operands before `gh` (`sudo`, `timeout 30`,
//     `npx`, `env`, `nohup`): the program is the segment's first token, so the
//     position anchor does not see `gh` (the shell's reserved words and the
//     `exec`/`command`/`eval` builtins are skipped; an arbitrary program is
//     not, since the walk cannot know which of its operands is the command);
//   - a skipped word carrying a FLAG (`command -p gh pr merge 5`,
//     `exec -a x gh pr merge 5`, and the reserved word's own `time -p` /
//     `time --`): the flag is a token before `gh`, and bash runs the merge
//     all the same (round 3, F1);
//   - a merge handed over as ONE quoted word (`eval "gh pr merge 5"`,
//     `bash -c "gh pr merge 5"`): a quoted string is data to this walk;
//   - a backtick command substitution (`echo \`gh pr merge 5\``): the walk
//     splits on `$( … )` parens but treats a backtick as an ordinary character,
//     so the merge inside it stays part of `echo`'s segment;
//   - a leading redirection (`> out.txt gh pr merge 5`): the redirection word
//     is the segment's first token;
//   - PowerShell's own quoting (backtick escapes, here-strings) is not
//     modelled — the walk reads POSIX quoting for both tools.
// Disclosed FALSE FIRES, the deny direction, all contrived — text the shell
// does not execute as a merge but that sits at a segment's front here: a bash
// array assignment whose elements spell a merge (`A=(gh pr merge 8)`) is judged
// as a merge of 8, because `(` is a separator and the segment inside it starts
// with `gh`; a `case` pattern `gh pr merge)` yields an EMPTY argv, which
// projects to the current branch's PR (both surfaced when every segment began
// to be collected, round 2 F6); and a function DEFINITION whose body is a
// merge (`f() { gh pr merge 5; }`) fires at definition time, because `{` is a
// separator and the body is its own segment (round 3, F4; it fired before this
// PR's rounds too). `TOTEM_MERGE_GATE_OVERRIDE=1` is the audited way past any
// of them.
// Which characters END a word, so the scanner can say whether the next one
// BEGINS one. Same set core's scanner uses (mmnto-ai/totem#2800 round 2, F1).
function isWordBoundary(ch) {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\r' ||
    ch === '\n' ||
    ch === ';' ||
    ch === '|' ||
    ch === '&'
  );
}

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

function blankHeredocBodies(command, powershell) {
  let out = '';
  let i = 0;
  let quote = '';
  let boundary = true;
  let pending = [];

  // Consume EVERY body queued on the operator line, in order, starting just
  // past that line's newline — bash reads `cat <<A <<B` as two bodies, so a
  // command sitting in B's body is data too (F2). Terminator lines are kept;
  // body lines are dropped with their newlines, so the segments around them
  // stay separated exactly as the shell separates them. An unterminated body
  // runs to the end and is dropped whole.
  const consumeBodies = (from) => {
    let cursor = from;
    for (let p = 0; p < pending.length; p++) {
      const h = pending[p];
      let at = cursor;
      cursor = command.length;
      while (at <= command.length) {
        const nl = command.indexOf('\n', at);
        const stop = nl === -1 ? command.length : nl;
        let line = command.slice(at, stop);
        if (h.stripTabs) line = line.replace(/^\t+/, '');
        line = line.replace(/\r$/, '');
        const next = nl === -1 ? command.length : nl + 1;
        if (line === h.delimiter) {
          out += command.slice(at, next);
          cursor = next;
          break;
        }
        if (nl === -1) break;
        out += '\n';
        at = next;
      }
    }
    pending = [];
    return cursor;
  };

  while (i < command.length) {
    const ch = command[i];
    if (quote !== '') {
      out += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        out += command[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      boundary = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i++;
      boundary = false;
      continue;
    }
    // A backslash before a NEWLINE is a line continuation: the shell removes
    // both characters and the command carries on, so the scanner must too
    // (mmnto-ai/totem#2800 round 3, F6). Absorbing the newline into a token is
    // what hid `gh \<LF>pr merge 5` from the position anchor.
    if (ch === '\\' && (command[i + 1] === '\n' || (command[i + 1] === '\r' && command[i + 2] === '\n'))) {
      i += command[i + 1] === '\r' ? 3 : 2;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      out += ch + command[i + 1];
      i += 2;
      boundary = false;
      continue;
    }
    // A `#` that BEGINS a word is a comment: discarded to the end of the line
    // WITHOUT quote processing, so neither its text nor a `<<note` inside it
    // reaches the tokenizer (F1). The newline stays — it may end an operator
    // line whose bodies are still queued.
    if (ch === '#' && boundary) {
      const nl = command.indexOf('\n', i);
      i = nl === -1 ? command.length : nl;
      continue;
    }
    // PowerShell's `<# … #>` block comment is data, not commands: blank it
    // whole, the way a heredoc body is blanked (round 3, F8). Applied ONLY when
    // the TOOL is PowerShell (round 4, F8): bash has no such comment, and there
    // `sort <#tmp` is a redirect from a file named `#tmp` — blanking from it
    // to a later `#>` would swallow real commands. A `<#` inside a quoted
    // string never reaches here, because the quote arms run first.
    if (powershell && ch === '<' && command[i + 1] === '#') {
      const close = command.indexOf('#>', i + 2);
      i = close === -1 ? command.length : close + 2;
      boundary = true;
      continue;
    }
    if (ch === '$' && command.slice(i, i + 3) === '$((') {
      const end = skipArithmetic(command, i + 3);
      out += command.slice(i, end);
      i = end;
      boundary = false;
      continue;
    }
    if (ch === '(' && command[i + 1] === '(' && boundary) {
      const end = skipArithmetic(command, i + 2);
      out += command.slice(i, end);
      i = end;
      boundary = false;
      continue;
    }
    // `<<` opens a heredoc; `<<<` is a here-string and is left alone — at
    // BOTH of its first two characters (the preceding-character guard core's
    // scanner carries; without it the second `<` of `<<<` opened a heredoc
    // whose body swallowed every later line, a fail-open path — CodeRabbit on
    // mmnto-ai/totem#2855).
    if (ch === '<' && command[i + 1] === '<' && command[i - 1] !== '<' && command[i + 2] !== '<') {
      let j = i + 2;
      let head = '<<';
      let dash = false;
      if (command[j] === '-') {
        dash = true;
        head += '-';
        j++;
      }
      while (j < command.length && (command[j] === ' ' || command[j] === '\t')) {
        head += command[j];
        j++;
      }
      // The delimiter word, quoted (`<<'EOF'`, `<<"EOF"`) or bare, with a
      // backslash-quoted form (`<<\EOF`) read as bash reads it.
      let delim = '';
      const q = command[j] === "'" || command[j] === '"' ? command[j] : '';
      if (q !== '') {
        head += q;
        j++;
      }
      while (j < command.length) {
        const c = command[j];
        if (q !== '') {
          head += c;
          j++;
          if (c === q) break;
          delim += c;
          continue;
        }
        if (c === '\\' && j + 1 < command.length) {
          head += c + command[j + 1];
          delim += command[j + 1];
          j += 2;
          continue;
        }
        if (/[A-Za-z0-9_.\-\/]/.test(c)) {
          head += c;
          delim += c;
          j++;
          continue;
        }
        break;
      }
      out += head;
      i = j;
      boundary = false;
      if (delim !== '') pending.push({ delimiter: delim, stripTabs: dash });
      continue;
    }
    if (ch === '\n') {
      out += '\n';
      i += 1;
      if (pending.length > 0) i = consumeBodies(i);
      boundary = true;
      continue;
    }
    out += ch;
    boundary = isWordBoundary(ch);
    i++;
  }
  return out;
}

// The words the shell reads at command position that are NOT the command:
// reserved words that introduce a compound command (`time` and `coproc` are
// reserved words too — the round-2 leg found them missing), the negation, and
// the builtins that execute their operand as the command (`exec`, `command`,
// and `eval` on an UNQUOTED operand — `eval "gh pr merge 5"` hands the shell a
// single quoted word, which this walk reads as data, a disclosed miss below).
// Stripped from a segment's front, in any run, before the `gh pr merge`
// anchor is read.
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

/**
 * The argv after EVERY `gh pr merge` at command position in the command —
 * one array per merge, in command order — or an empty array when there is
 * none. A compound command that merges twice yields two, and the wrapper
 * judges each (mmnto-ai/totem#2844 round 1).
 */
function ghPrMergeArgvs(rawCommand, powershell) {
  const command = blankHeredocBodies(rawCommand, powershell === true);
  const segments = [];
  let current = [];
  let token = '';
  let hasToken = false;
  let i = 0;
  const endToken = () => {
    if (hasToken) {
      current.push(token);
      token = '';
      hasToken = false;
    }
  };
  const endSegment = () => {
    endToken();
    segments.push(current);
    current = [];
  };
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      hasToken = true;
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
  for (const segment of segments) {
    let tokens = segment;
    while (
      tokens.length > 0 &&
      (COMMAND_POSITION_WORDS.indexOf(tokens[0]) !== -1 || isAssignmentPrefix(tokens[0]))
    ) {
      tokens = tokens.slice(1);
    }
    if (tokens.length >= 3 && tokens[0] === 'gh' && tokens[1] === 'pr' && tokens[2] === 'merge') {
      found.push(tokens.slice(3));
    }
  }
  return found;
}

/** Run git read-only and return trimmed stdout, or '' when it did not answer. */
function gitRead(args) {
  const res = spawnSync('git', args, { encoding: 'utf-8', timeout: 10000 });
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

// Read the PreToolUse stdin envelope.
let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  stdin += chunk;
});
process.stdin.on('end', () => {
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
  // ONE 30-second budget across every payload, not 30 seconds each (round 2,
  // F5): the hook host kills a PreToolUse hook at its own default budget (60 s
  // on both Claude Code and Gemini, the same figure the session-hook templates
  // above cut their legs against) and a killed hook's exit code is never
  // applied — a fail-OPEN on a gate whose posture is fail-closed. With the
  // budget shared, the loop's wall time is bounded at 30 s plus the one-second
  // floor each payload past the budget still gets (round 3, F2), and a merge
  // that cannot be judged inside it lands in the fail-closed arm below (the
  // spawn times out → `result.error`) rather than in the host's kill. What the
  // budget does NOT cover, disclosed (round 3, F3): the projection above runs
  // up to three `gitRead`s per merge, each on its own 10 s timeout, before this
  // deadline exists — a hung git on a multi-merge envelope can still reach the
  // host's budget through them.
  const deadline = Date.now() + 30000;
  for (let p = 0; p < payloads.length; p++) {
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

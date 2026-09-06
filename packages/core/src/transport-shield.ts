import { TotemError } from './errors.js';
import type { GateEvaluator, GateVerdict } from './gate-types.js';

/**
 * transport-shield (mmnto-ai/totem#2799): a PreToolUse gate over the Bash and
 * PowerShell tools that refuses the KNOWN payload-mangling command shapes before
 * the shell sees them, naming the cure in every refusal.
 *
 * The pattern table lives HERE, once, beside the evaluator (the charter's
 * errata: provenance is the table in core; the CLI only installs). Every row is
 * a pure function of the payload — no filesystem, no environment, no clock
 * beyond the verdict's `checkedAt` — so the same command yields the same
 * verdict on every machine given the same `platform` and `tool` fields, and a
 * test can pin win32 on any runner.
 *
 * Evaluation order is the table order: the first DENY row that fires wins; a
 * WARN row is consulted only when no deny fired. A shape the table lacks is
 * allowed — the gate enumerates known shapes (the charter's positive corpus),
 * and a miss is a corpus gap counted by the charter's metric, never a fail-open
 * of an applicable gate.
 *
 * False-positive budget (ADR-109: a non-exact-match gate ships a stated budget
 * and the fixture that measures it): ZERO denies over the benign corpus in
 * `transport-shield.fold.test.ts` (everyday commands that share a token with a
 * row — `diff -b`, `curl -b`, `grep gh -b`, a Windows path as a sed operand,
 * `<<` inside a quoted argument, a here-string). A deny on a benign command in
 * the field is a corpus row plus a fix, never a hand-carved exemption; the
 * `--pilot` tier exists for a measurement week.
 *
 * Out of scope by design, disclosed: a bare backslash outside the four named
 * contexts (a heredoc body, a sed -i expression, an inline node/python body, a
 * gh --body) is not a shape this gate reads; a heredoc inside a `bash -c "…"`
 * or `sh -c '…'` operand is quoted text to this scanner and is not recursed
 * into (a corpus gap, not a fail-open of an applicable row); a wrapper that
 * takes operands of its own before the program (`sudo -u me gh …`, `timeout
 * 30 gh …`, `npx …`) hides the program from the position anchor — the same
 * class. The scanners read the shell's own grammar where a mis-read would
 * desynchronize them: a `#` that begins a word — after an unquoted blank,
 * newline, `;`, `|`, `&`, an opening `(` or an OPERATOR `)` (a subshell's, a
 * case pattern's) — is a comment to the end of the line, discarded WITHOUT
 * quote processing (POSIX 2.3 rule 9; bash §3.1.3), while a `#` that continues
 * a word is not one: `a#b`, and `$(x)#1` / `<(x)#1`, where the `)` closes a
 * substitution that is part of the word (rules 5 and 8 for `$( … )`; process
 * substitution is a bash extension, bash §3.5.6, that behaves the same way) —
 * the scanners track which `(` each `)` closes. `$(( … ))` / `(( … ))` arithmetic is skipped. So
 * neither an apostrophe in a comment nor a `<<` shift can hide a later heredoc
 * or expose comment text as arguments. For the PowerShell tool a `<# … #>`
 * block comment is blanked before the scanners run (PowerShell discards it
 * without quote processing, as bash discards a `#` line comment; the line
 * comment is handled by the same rule as bash's). Not read, disclosed:
 * PowerShell here-strings (`@" … "@`, `@' … '@`) are not parsed — a quote
 * inside one can still desynchronize the quote scan for that tool, the miss
 * direction. The MSYS opt-out is honoured only as an assignment the shell
 * would apply to the judged segment — its own `VAR=… prog` prefix, or an
 * earlier `export MSYS_NO_PATHCONV=1` — never as a substring: a comment or a
 * heredoc body that names the cure opts nothing out.
 */

export const TRANSPORT_SHIELD_EVENT = 'transport-shield';

/** The module label every verdict cites as its `provenance.source` (never a path). */
export const TRANSPORT_SHIELD_SOURCE = 'transport-shield pattern table';

/** A heredoc body at or above this many bytes WARNs (the banked ~4 KB harness trap). */
export const HEREDOC_OVERSIZE_BYTES = 4096;

/** `provenance.matched` is bounded to this many characters. */
export const MATCHED_FRAGMENT_MAX = 80;

export type TransportTool = 'Bash' | 'PowerShell';

export interface TransportShieldPayload {
  tool: TransportTool;
  command: string;
  /** The host's `process.platform` — REQUIRED so the verdict never reads it in core. */
  platform: string;
}

export type TransportPatternId =
  | 'heredoc-escape'
  | 'heredoc-oversize'
  | 'msys-body-slash'
  | 'sed-i-escape'
  | 'inline-body-escape'
  | 'msys-rev-path-subshell';

export interface TransportMatch {
  /** The offending fragment, raw and as written; the evaluator bounds and sanitizes it for provenance. */
  fragment: string;
  /** One clause naming what matched, for the reason text. */
  detail: string;
}

export interface TransportPattern {
  id: TransportPatternId;
  disposition: 'deny' | 'warn';
  /** The safe alternative, in the imperative; joined to the detail in the reason. */
  cure: string;
  find(payload: TransportShieldPayload): TransportMatch | null;
}

const TOOLS: ReadonlySet<string> = new Set<string>(['Bash', 'PowerShell']);

/**
 * Parse an unknown payload into the gate's shape. Throws `GATE_INVALID` on a
 * missing or non-string `command`, a `tool` outside the pair, or a missing
 * `platform` — never default-allows (ADR-109: an unparseable payload is a
 * broken source). The distributed wrapper never sends such a payload: it exits
 * 0 as not-applicable first, so this branch is reachable only by hand.
 */
export function parseTransportShieldPayload(payload: unknown): TransportShieldPayload {
  const rec =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
  const tool = rec && typeof rec.tool === 'string' ? rec.tool : '';
  const command = rec && typeof rec.command === 'string' ? rec.command : undefined;
  const platform = rec && typeof rec.platform === 'string' ? rec.platform.trim() : '';
  const hint = 'Pass --payload \'{"tool":"Bash","command":"<the command>","platform":"win32"}\'.';
  if (!TOOLS.has(tool)) {
    throw new TotemError(
      'GATE_INVALID',
      'transport-shield payload requires "tool" to be "Bash" or "PowerShell".',
      hint,
    );
  }
  if (command === undefined || command.trim() === '') {
    throw new TotemError(
      'GATE_INVALID',
      'transport-shield payload requires a non-empty "command" string.',
      hint,
    );
  }
  if (platform === '') {
    throw new TotemError(
      'GATE_INVALID',
      'transport-shield payload requires a non-empty "platform" string (the host\'s process.platform).',
      hint,
    );
  }
  return { tool: tool as TransportTool, command, platform };
}

// ─── Heredocs ──────────────────────────────────────────────────────────────

export interface HeredocSpan {
  /** The delimiter word as written (quotes stripped). */
  delimiter: string;
  /** Whether the delimiter was quoted (`<<'EOF'` / `<<"EOF"`). */
  quoted: boolean;
  /** Whether the operator was `<<-` (bash strips leading TABS from body and terminator lines). */
  stripTabs: boolean;
  /** The body text between the operator line and the terminator line (or the end). */
  body: string;
  /** True when no terminator line was found — the body runs to the end of the command. */
  unterminated: boolean;
  /** Offsets of the body within the command, for blanking. */
  bodyStart: number;
  bodyEnd: number;
}

/** Inside double quotes a backslash escapes only these (POSIX); elsewhere it is kept. */
const DQ_ESCAPABLE: ReadonlySet<string> = new Set(['$', '`', '"', '\\', '\n']);

/**
 * `<<` or `<<-`, optional blanks, then the delimiter WORD as bash delimits it:
 * single-quoted, double-quoted, backslash-quoted (`\EOF` — any quoted character
 * in the word quotes the whole delimiter, POSIX 2.7.4), or bare — a bare word
 * running to the next blank, quote, backslash or operator character, so
 * `EOF.TXT`, `EOF-1`, `1EOF` and `$X` are whole delimiter words (reading only a
 * prefix of one left the body unterminated and over-scanned everything after
 * it; not reading `<<1EOF` at all left its body to be scanned as shell text, the
 * miss direction). A `$X` delimiter is read literally, as bash reads it — a
 * heredoc delimiter word is never expanded, so bash and the scanner terminate
 * at the same literal `$X` line. Groups: 1 the dash, 2 a single-quoted word,
 * 3 a double-quoted word, 4 a backslash-quoted word, 5 a bare word. A partly
 * quoted word (`E'O'F`) is read to its first quote — over-scan direction.
 */
const HEREDOC_AT =
  /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\([^\s'"\\<>()|&;]+)|([^\s'"\\<>()|&;]+))/;

/**
 * Characters after which the next character begins a word — where a `#` starts
 * a comment (POSIX 2.3 rule 9, the comment rule; rule 8 appends to a word that
 * is still open). Parentheses are not here: an opening `(` and an OPERATOR `)`
 * begin a word, but the `)` that closes a `$( … )` or `<( … )` continues one
 * (rule 5 makes a `$( … )` part of the word; `<( … )` is bash's own extension,
 * §3.5.6, and bash treats it the same way) — `findHeredocs` tracks which `(`
 * each `)` closes and sets the boundary from that.
 */
const WORD_BOUNDARY: ReadonlySet<string> = new Set([' ', '\t', '\r', '\n', ';', '|', '&']);

/**
 * The index just past the `))` that closes an arithmetic expansion or command
 * whose opening `$((` / `((` ends at `from`; the end of the command when it is
 * unterminated. A `<<` inside is a shift, never a heredoc operator.
 */
function skipArithmetic(command: string, from: number): number {
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
 * Locate every heredoc in a command in ONE pass that tracks shell quoting and
 * SKIPS heredoc bodies: an operator inside a quoted argument is text, `<<<` is
 * a here-string, and an apostrophe inside a body never opens a quote (the
 * fold's own regression, mmnto-ai/totem#2799 pass 2). A body starts after the
 * newline that ends the operator's line and runs to the first line that IS the
 * delimiter — an exact line match, as bash reads it (a `EOF ` with trailing
 * space or a CRLF `EOF\r` does not terminate); for `<<-` leading tabs are
 * stripped first — or to the end of the command when no such line exists. An
 * operator with no newline after it yields a body of the remaining text: the
 * conservative reading, so a truncated command still refuses on its escapes.
 * A `#` that begins a word discards the rest of its line without quote
 * processing, as bash does, and `$(( … ))` / `(( … ))` arithmetic is skipped.
 * `parens` records what each open `(` is — a substitution (`$(`, `<(`, `>(`),
 * which is part of a word, or a grouping operator — so the `)` that closes it
 * can say whether the next character begins a word.
 */
export function findHeredocs(command: string): HeredocSpan[] {
  const spans: HeredocSpan[] = [];
  const pending: Array<{ delimiter: string; quoted: boolean; stripTabs: boolean }> = [];
  const parens: Array<'subst' | 'group'> = [];
  let inSingle = false;
  let inDouble = false;
  let boundary = true;
  let i = 0;
  const consumeBodies = (from: number): number => {
    let cursor = from;
    for (const h of pending) {
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
        body: command.slice(bodyStart, bodyEnd),
        unterminated,
        bodyStart,
        bodyEnd,
      });
      cursor = resume;
      if (unterminated) break;
    }
    pending.length = 0;
    return cursor;
  };
  while (i < command.length) {
    const ch = command[i] as string;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      i += 1;
      boundary = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && i + 1 < command.length && DQ_ESCAPABLE.has(command[i + 1] as string))
        i += 2;
      else {
        if (ch === '"') inDouble = false;
        i += 1;
      }
      boundary = false;
      continue;
    }
    if (ch === '#' && boundary) {
      // A comment: discarded to the end of the line without quote processing;
      // the newline itself stays (it may end an operator line).
      const nl = command.indexOf('\n', i);
      i = nl === -1 ? command.length : nl;
      continue;
    }
    if (ch === '$' && command.startsWith('$((', i)) {
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
      // A command or process substitution: part of the word that carries it. Its
      // first character begins a word (a `#` right after `$(` is a comment).
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
    if (ch === '<' && command[i + 1] === '<' && command[i - 1] !== '<' && command[i + 2] !== '<') {
      const m = HEREDOC_AT.exec(command.slice(i));
      if (m !== null) {
        pending.push({
          stripTabs: (m[1] ?? '') === '-',
          quoted: m[2] !== undefined || m[3] !== undefined || m[4] !== undefined,
          delimiter: m[2] ?? m[3] ?? m[4] ?? m[5] ?? '',
        });
        i += m[0].length;
        boundary = false;
        continue;
      }
    }
    boundary = WORD_BOUNDARY.has(ch);
    i += 1;
  }
  if (pending.length > 0) consumeBodies(command.length);
  return spans;
}

/**
 * The index just past the `)` that closes the substitution whose `(` sits at
 * `open`, counting parentheses only OUTSIDE quotes — a `)` inside `'…'` or
 * `"…"`, or after a backslash, is text (POSIX 2.2) and never closes it; the end
 * of the text when the substitution is unterminated.
 */
function substitutionEnd(text: string, open: number): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let j = open;
  while (j < text.length) {
    const c = text[j] as string;
    if (inSingle) {
      if (c === "'") inSingle = false;
    } else if (inDouble) {
      if (c === '\\' && j + 1 < text.length && DQ_ESCAPABLE.has(text[j + 1] as string)) j += 1;
      else if (c === '"') inDouble = false;
    } else if (c === '\\' && j + 1 < text.length) {
      j += 1;
    } else if (c === "'") {
      inSingle = true;
    } else if (c === '"') {
      inDouble = true;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return text.length;
}

/**
 * For the PowerShell tool: every `<# … #>` block comment replaced by spaces
 * (newlines kept, length preserved), so a quote inside one cannot desynchronize
 * the scanners — PowerShell discards the block without quote processing. An
 * unterminated `<#` runs to the end. A `<#` inside a PowerShell string literal
 * is blanked too (over-scan direction: text a string carries is never a command).
 */
function blankPowerShellBlockComments(command: string): string {
  let out = '';
  let i = 0;
  while (i < command.length) {
    if (command.startsWith('<#', i)) {
      const close = command.indexOf('#>', i + 2);
      const end = close === -1 ? command.length : close + 2;
      out += command.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    out += command[i];
    i += 1;
  }
  return out;
}

/** The command with every heredoc body replaced by spaces (length preserved), so tokenizing never reads a body. */
function blankHeredocBodies(command: string, spans: readonly HeredocSpan[]): string {
  let out = command;
  for (const s of spans) {
    out = out.slice(0, s.bodyStart) + ' '.repeat(s.bodyEnd - s.bodyStart) + out.slice(s.bodyEnd);
  }
  return out;
}

// ─── Shell tokens ──────────────────────────────────────────────────────────

export interface ShellSegment {
  /**
   * Tokens with quotes resolved: single-quoted text literal; inside double
   * quotes a backslash escapes only `$`, backtick, `"`, `\` and newline (POSIX)
   * and is otherwise kept; outside quotes a backslash escapes the next character
   * and backslash-newline is a line continuation (dropped).
   */
  tokens: string[];
  /** The raw text of the segment, for newline and substring checks. */
  raw: string;
}

const CONTROL_OPERATORS = ['&&', '||', '|', ';', '\n'];

/**
 * A minimal POSIX-shell tokenizer: splits a command into segments at control
 * operators (`&&`, `||`, `|`, `;`, a background `&`, newline) and each segment
 * into words with quotes resolved. Good enough to find an option's value and a
 * program name; it does not expand anything. Command substitutions `$( … )`
 * and process substitutions `<( … )` / `>( … )` stay inside the word that
 * carries them; grouping `(` and `)` are operators that delimit words. A `#`
 * that begins a word discards the rest of its line, as bash does — comment
 * text is never an argument.
 */
export function tokenizeShell(command: string): ShellSegment[] {
  const segments: ShellSegment[] = [];
  let tokens: string[] = [];
  let word = '';
  let inWord = false;
  let segStart = 0;
  let i = 0;
  const flushWord = (): void => {
    if (inWord) tokens.push(word);
    word = '';
    inWord = false;
  };
  const flushSegment = (end: number): void => {
    flushWord();
    segments.push({ tokens, raw: command.slice(segStart, end) });
    tokens = [];
  };
  while (i < command.length) {
    const ch = command[i] as string;
    // A line continuation is whitespace, never an operator or a word character.
    if (ch === '\\' && command[i + 1] === '\n') {
      flushWord();
      i += 2;
      continue;
    }
    if (ch === '\\' && command[i + 1] === '\r' && command[i + 2] === '\n') {
      flushWord();
      i += 3;
      continue;
    }
    if (ch === '#' && !inWord) {
      // A comment runs to the end of the line and is discarded without quote
      // processing; the newline stays, a separator like any other.
      const nl = command.indexOf('\n', i);
      i = nl === -1 ? command.length : nl;
      continue;
    }
    if (
      ch === '&' &&
      command[i + 1] !== '&' &&
      command[i + 1] !== '>' &&
      command[i - 1] !== '>' &&
      command[i - 1] !== '<'
    ) {
      // A background `&` ends the segment like `;`; `&&`, `&>`, `>&`, `<&` are not it.
      flushSegment(i);
      i += 1;
      segStart = i;
      continue;
    }
    const op = CONTROL_OPERATORS.find((o) => command.startsWith(o, i));
    if (op !== undefined) {
      flushSegment(i);
      i += op.length;
      segStart = i;
      continue;
    }
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      i += 1;
      inWord = true;
      while (i < command.length && command[i] !== '"') {
        if (
          command[i] === '\\' &&
          i + 1 < command.length &&
          DQ_ESCAPABLE.has(command[i + 1] as string)
        ) {
          if (command[i + 1] !== '\n') word += command[i + 1];
          i += 2;
        } else {
          word += command[i];
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flushWord();
      i += 1;
      continue;
    }
    if ((ch === '$' || ch === '<' || ch === '>') && command[i + 1] === '(') {
      // Keep a command or process substitution whole inside the word, its
      // parentheses balanced OUTSIDE quotes (a `)` inside `"…"` is text): it is
      // part of the word that carries it, so a `#` right after its `)` continues
      // that word.
      const end = substitutionEnd(command, i + 1);
      word += command.slice(i, end);
      inWord = true;
      i = end;
      continue;
    }
    if (ch === '(' || ch === ')') {
      // Grouping parentheses are operators: they delimit words and carry none,
      // so a `#` after a subshell's or a case pattern's `)` begins a comment.
      flushWord();
      i += 1;
      continue;
    }
    word += ch;
    inWord = true;
    i += 1;
  }
  flushSegment(command.length);
  return segments.filter((s) => s.tokens.length > 0 || s.raw.trim() !== '');
}

// ─── Helpers the rows share ────────────────────────────────────────────────

const hasEscape = (text: string): boolean => text.includes('\\') || text.includes('`');

/** The first line of `text` carrying a backslash or a backtick, for the fragment. */
function firstEscapedLine(text: string): string {
  for (const line of text.split('\n')) {
    if (hasEscape(line)) return line;
  }
  return text;
}

/** Prefix words a shell runs THROUGH: the real program follows them. */
const WRAPPERS: ReadonlySet<string> = new Set([
  'env',
  'time',
  'sudo',
  'nice',
  'nohup',
  'command',
  'exec',
  'builtin',
  'xargs',
]);

/**
 * The index of the segment's PROGRAM when it is `program` (a bare name or a
 * path ending in it), after any `VAR=VALUE` assignments and known wrappers;
 * -1 when the program is something else — a later mention of the name (`grep
 * gh …`, `git log --grep sed …`) is an argument, never an invocation.
 */
function programIndex(tokens: readonly string[], program: string): number {
  let i = 0;
  // Assignments and wrappers interleave: `env VAR=x prog`, `VAR=x sudo prog`.
  while (i < tokens.length) {
    const t = tokens[i] as string;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(t)) i += 1;
    else break;
  }
  const t = tokens[i];
  if (t === undefined) return -1;
  return t === program || t.endsWith('/' + program) ? i : -1;
}

/**
 * Every occurrence of an option with its value and the flag AS WRITTEN:
 * `--long X`, `--long=X`, `-s X`. Every occurrence, not the first — a `-b`
 * that is some other option's value would otherwise hide a later, real
 * `--body`. Empty when the option is absent. The short flag is required: the
 * one caller always has one (the github-code-quality inline on
 * mmnto-ai/totem#2804 at ac867140).
 */
function optionsAsWritten(
  tokens: readonly string[],
  long: string,
  short: string,
): Array<{ flag: string; value: string }> {
  const out: Array<{ flag: string; value: string }> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as string;
    if (t === long || t === short) {
      const value = tokens[i + 1];
      if (value !== undefined) out.push({ flag: t, value });
    } else if (t.startsWith(long + '=')) {
      out.push({ flag: long + '=', value: t.slice(long.length + 1) });
    }
  }
  return out;
}

/**
 * The text with every single-quoted region (outside double quotes) replaced by
 * spaces, length preserved: a `$(` inside one is a literal, not a subshell. An
 * unquoted backslash keeps the next character literal (POSIX 2.2.1), so `\'`
 * opens no region and `\"` closes none.
 */
function blankSingleQuoted(text: string): string {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inSingle) {
      if (ch === "'") inSingle = false;
      out += ch === "'" ? ch : ' ';
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + (text[i + 1] as string);
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      out += ch;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    out += ch;
  }
  return out;
}

/** The values of every `-e` / `--expression` / `--expression=` operand in a sed argv. */
function sedExpressions(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a === '-e' || a === '--expression') {
      if (args[i + 1] !== undefined) out.push(args[i + 1] as string);
    } else if (a.startsWith('--expression=')) {
      out.push(a.slice('--expression='.length));
    }
  }
  return out;
}

/** True when sed takes its script from a FILE (`-f X`, `--file X`, `--file=X`): then no positional operand is an expression. */
function sedHasScriptFile(args: readonly string[]): boolean {
  return args.some((a) => a === '-f' || a === '--file' || a.startsWith('--file='));
}

/**
 * The expression operands of a sed argv: every `-e` value, or — when there is
 * no `-e` and no script file — the first positional operand (a flag's own value
 * skipped). Never a filename: with `-f` every positional operand is an input
 * file, and a Windows path there carries backslashes that are not an escape.
 */
function sedExpressionOperands(args: readonly string[]): string[] {
  const explicit = sedExpressions(args);
  if (explicit.length > 0 || sedHasScriptFile(args)) return explicit;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (a === '-l' || a === '--line-length') {
      i += 1;
      continue;
    }
    if (a === '' || a.startsWith('-')) continue;
    return [a];
  }
  return [];
}

const INLINE_BODIES: ReadonlyArray<{ program: string; flags: readonly string[] }> = [
  { program: 'node', flags: ['-e', '--eval', '-p', '--print'] },
  { program: 'python', flags: ['-c'] },
  { program: 'python3', flags: ['-c'] },
];

/** The inline body of `node -e X`, `node --eval=X`, `python -c X`, … as written, or null. */
function inlineBody(
  args: readonly string[],
  flags: readonly string[],
): { flag: string; body: string } | null {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (flags.includes(a)) {
      const body = args[i + 1];
      return body === undefined ? null : { flag: a, body };
    }
    for (const f of flags) {
      if (f.startsWith('--') && a.startsWith(f + '='))
        return { flag: f + '=', body: a.slice(f.length + 1) };
    }
  }
  return null;
}

const REV_PATH_TOKEN = /(^|[\s(])([A-Za-z0-9_./~^-]+:[A-Za-z0-9_./-]+)(?=$|[\s)])/;

/** Bash + win32: the platform precondition both MSYS rows share. */
const msysApplies = (p: TransportShieldPayload): boolean =>
  p.platform === 'win32' && p.tool === 'Bash';

const MSYS_OPT_OUT = 'MSYS_NO_PATHCONV=1';
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when the segment's own assignment/wrapper prefix carries the opt-out (`MSYS_NO_PATHCONV=1 gh …`, `env MSYS_NO_PATHCONV=1 gh …`). */
function segmentOptsOut(tokens: readonly string[]): boolean {
  for (const t of tokens) {
    if (t === MSYS_OPT_OUT) return true;
    if (!ASSIGNMENT.test(t) && !WRAPPERS.has(t)) return false;
  }
  return false;
}

/** True when the segment exports the opt-out to every later segment: `export MSYS_NO_PATHCONV=1`. A bare assignment sets a shell variable a later program never sees, so it exports nothing. */
const segmentExportsOptOut = (tokens: readonly string[]): boolean =>
  tokens[0] === 'export' && tokens.slice(1).includes(MSYS_OPT_OUT);

/**
 * The segments an MSYS row may judge: each with its tokens and raw text, minus
 * those the opt-out reaches as an ASSIGNMENT the shell applies — the segment's
 * own prefix, or an earlier `export`. Never a substring: a comment, a heredoc
 * body or an unrelated segment naming the cure opts nothing out.
 */
function msysSegments(text: string): ShellSegment[] {
  const out: ShellSegment[] = [];
  let exported = false;
  for (const seg of tokenizeShell(text)) {
    if (segmentExportsOptOut(seg.tokens)) {
      exported = true;
      continue;
    }
    if (exported || segmentOptsOut(seg.tokens)) continue;
    out.push(seg);
  }
  return out;
}

// ─── The table ─────────────────────────────────────────────────────────────

/**
 * The pattern table, in evaluation order. Deny rows first, warn rows after.
 * Each `find` reads only the payload.
 */
export const TRANSPORT_PATTERNS: ReadonlyArray<TransportPattern> = Object.freeze([
  {
    id: 'heredoc-escape',
    disposition: 'deny',
    cure: 'author the file with the Write tool and reference it by path',
    find(p) {
      for (const h of findHeredocs(p.command)) {
        if (hasEscape(h.body)) {
          return {
            fragment: firstEscapedLine(h.body),
            detail:
              `a heredoc body (delimiter ${h.delimiter}${h.unterminated ? ', unterminated' : ''}) carries a backslash or a backtick, ` +
              'which this transport rewrites before the shell sees it',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'msys-body-slash',
    disposition: 'deny',
    cure: 'use --body-file <path>, or the PowerShell tool, or prefix MSYS_NO_PATHCONV=1',
    find(p) {
      // Scoped to segments whose PROGRAM is `gh`, the one program whose --body / -b
      // takes a free-text body that MSYS path-converts (`-b` means something else on
      // diff, curl, cp, sort, du, grep); the cure's MSYS_NO_PATHCONV=1 is honoured
      // per segment, as the assignment the shell would apply.
      if (!msysApplies(p)) return null;
      const blanked = blankHeredocBodies(p.command, findHeredocs(p.command));
      for (const seg of msysSegments(blanked)) {
        const at = programIndex(seg.tokens, 'gh');
        if (at === -1) continue;
        const hit = optionsAsWritten(seg.tokens.slice(at + 1), '--body', '-b').find((h) =>
          h.value.startsWith('/'),
        );
        if (hit !== undefined) {
          const written = hit.flag.endsWith('=')
            ? `${hit.flag}${hit.value}`
            : `${hit.flag} ${hit.value}`;
          return {
            fragment: written,
            detail:
              'a gh --body value beginning with / is path-converted by MSYS on win32 (the /gemini review that posted as a Program Files path)',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'sed-i-escape',
    disposition: 'deny',
    cure: 'use the Edit tool',
    find(p) {
      const blanked = blankHeredocBodies(p.command, findHeredocs(p.command));
      for (const seg of tokenizeShell(blanked)) {
        const at = programIndex(seg.tokens, 'sed');
        if (at === -1) continue;
        const args = seg.tokens.slice(at + 1);
        const inPlace = args.some(
          (a) =>
            a === '-i' || /^-i\S*$/.test(a) || a === '--in-place' || a.startsWith('--in-place='),
        );
        if (!inPlace) continue;
        // The EXPRESSION operands only — never a filename (a Windows path carries
        // backslashes), never a `-f` script path, never BSD sed's empty
        // backup-suffix operand (`-i ''`).
        const expressions = sedExpressionOperands(args);
        const escaped = expressions.find((e) => e.includes('\\'));
        if (escaped !== undefined) {
          return { fragment: escaped, detail: 'a sed -i expression carries a backslash' };
        }
        if (expressions.length > 1) {
          return {
            fragment: seg.raw.trim(),
            detail: `a sed -i invocation carries ${expressions.length} -e expressions`,
          };
        }
        // A newline INSIDE an expression operand only: a bare newline ends the
        // segment and an unquoted backslash-newline is a continuation the tokenizer
        // drops, so a newline reaches the operand only inside quotes (the shape that
        // mangles) or inside a `$( … )` the tokenizer copies whole (over-scan,
        // disclosed). A newline in a file operand is not this row's shape.
        const multiline = expressions.find((e) => e.includes('\n'));
        if (multiline !== undefined) {
          return {
            fragment: multiline,
            detail: 'a sed -i expression carries a newline inside quotes or a substitution',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'inline-body-escape',
    disposition: 'deny',
    cure: 'author the script with the Write tool and run it by path',
    find(p) {
      if (p.tool !== 'Bash') return null;
      const blanked = blankHeredocBodies(p.command, findHeredocs(p.command));
      for (const seg of tokenizeShell(blanked)) {
        for (const { program, flags } of INLINE_BODIES) {
          const at = programIndex(seg.tokens, program);
          if (at === -1) continue;
          const hit = inlineBody(seg.tokens.slice(at + 1), flags);
          if (hit !== null && hasEscape(hit.body)) {
            return {
              fragment: hit.body,
              detail: `an inline ${program} ${hit.flag} body carries a backslash or a backtick`,
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: 'heredoc-oversize',
    disposition: 'warn',
    cure: 'author the file with the Write tool and reference it by path',
    find(p) {
      for (const h of findHeredocs(p.command)) {
        const bytes = Buffer.byteLength(h.body, 'utf8');
        if (bytes >= HEREDOC_OVERSIZE_BYTES) {
          return {
            fragment: h.body.split('\n')[0] ?? '',
            detail: `a heredoc body (delimiter ${h.delimiter}) is ${bytes} bytes; this transport has dropped bodies past roughly ${HEREDOC_OVERSIZE_BYTES} bytes (a heuristic threshold)`,
          };
        }
      }
      return null;
    },
  },
  {
    id: 'msys-rev-path-subshell',
    disposition: 'warn',
    cure: 'prefix the command with MSYS_NO_PATHCONV=1',
    find(p) {
      if (!msysApplies(p)) return null;
      // Bodies and single-quoted text blanked first: a `$(` inside either is
      // literal. Judged per segment, so the opt-out applies where the shell applies it.
      const blanked = blankSingleQuoted(blankHeredocBodies(p.command, findHeredocs(p.command)));
      for (const seg of msysSegments(blanked)) {
        const text = seg.raw;
        let cursor = 0;
        while (cursor < text.length) {
          const open = text.indexOf('$(', cursor);
          if (open === -1) break;
          // Balanced outside quotes: a `)` inside `"…"` never closes the subshell.
          const end = substitutionEnd(text, open + 1);
          const inner = text.slice(open + 2, text[end - 1] === ')' ? end - 1 : end);
          const hit = REV_PATH_TOKEN.exec(inner);
          if (hit !== null && !(hit[2] as string).includes('//')) {
            return {
              fragment: hit[2] as string,
              detail: 'a <rev>:<path> argument inside $( … ) is path-converted by MSYS on win32',
            };
          }
          cursor = end;
        }
      }
      return null;
    },
  },
]);

// ─── The evaluator ─────────────────────────────────────────────────────────

/** Bound and sanitize a fragment for provenance: no control characters, at most MATCHED_FRAGMENT_MAX chars. */
function boundedFragment(fragment: string): string {
  let out = '';
  for (const ch of fragment) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  out = out.trim();
  return out.length > MATCHED_FRAGMENT_MAX ? out.slice(0, MATCHED_FRAGMENT_MAX - 1) + '…' : out;
}

/**
 * The gate: parse the payload (throws on an invalid one), walk the table, and
 * return the first deny, else the first warn, else allow. Pure over the payload.
 */
export const transportShieldEvaluator: GateEvaluator = (payload): GateVerdict => {
  const parsed = parseTransportShieldPayload(payload);
  // The PowerShell tool's block comments are discarded before any row reads the
  // command, as bash's line comments are discarded inside the scanners.
  const p: TransportShieldPayload =
    parsed.tool === 'PowerShell'
      ? { ...parsed, command: blankPowerShellBlockComments(parsed.command) }
      : parsed;
  const checkedAt = new Date().toISOString();
  let warn: { pattern: TransportPattern; match: TransportMatch } | null = null;
  for (const pattern of TRANSPORT_PATTERNS) {
    const match = pattern.find(p);
    if (match === null) continue;
    if (pattern.disposition === 'deny') {
      return {
        disposition: 'deny',
        reason: `${match.detail} — ${pattern.cure}.`,
        provenance: {
          source: TRANSPORT_SHIELD_SOURCE,
          ref: pattern.id,
          matched: boundedFragment(match.fragment),
          checkedAt,
        },
      };
    }
    if (warn === null) warn = { pattern, match };
  }
  if (warn !== null) {
    return {
      disposition: 'warn',
      reason: `${warn.match.detail} — ${warn.pattern.cure}.`,
      provenance: {
        source: TRANSPORT_SHIELD_SOURCE,
        ref: warn.pattern.id,
        matched: boundedFragment(warn.match.fragment),
        checkedAt,
      },
    };
  }
  return {
    disposition: 'allow',
    reason: `No known payload-mangling shape in the ${p.tool} command.`,
    provenance: { source: TRANSPORT_SHIELD_SOURCE, ref: 'no-match', matched: null, checkedAt },
  };
};

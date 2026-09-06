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
 * row — `diff -b`, `curl -b`, a Windows path as a sed operand, `<<` inside a
 * quoted argument, a here-string). A deny on a benign command in the field is
 * a corpus row plus a fix, never a hand-carved exemption; the `--pilot` tier
 * exists for a measurement week.
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

// ─── Quote regions ─────────────────────────────────────────────────────────

/**
 * The offsets of every quoted region in a command (single- and double-quoted),
 * so a scanner can tell an operator in the open from the same characters inside
 * an argument. A bare backslash escapes the next character outside quotes;
 * inside double quotes only the POSIX set (`$`, backtick, `"`, `\`, newline).
 * An unterminated quote runs to the end.
 */
function quotedRegions(command: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close + 1;
      regions.push([i, end]);
      i = end;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        if (
          command[j] === '\\' &&
          j + 1 < command.length &&
          DQ_ESCAPABLE.has(command[j + 1] as string)
        )
          j += 2;
        else j += 1;
      }
      const end = j < command.length ? j + 1 : command.length;
      regions.push([i, end]);
      i = end;
      continue;
    }
    i += 1;
  }
  return regions;
}

const DQ_ESCAPABLE: ReadonlySet<string> = new Set(['$', '`', '"', '\\', '\n']);

function insideQuotes(regions: ReadonlyArray<[number, number]>, offset: number): boolean {
  return regions.some(([start, end]) => offset > start && offset < end);
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

const HEREDOC_OPERATOR = /(?<!<)<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

/**
 * Locate every heredoc in a command: `<<`, `<<-`, quoted or bare delimiter, in
 * the OPEN (an operator inside a quoted argument is text, and `<<<` is a
 * here-string, not a heredoc). The body starts after the newline that ends the
 * operator's line and runs to the first line that IS the delimiter — an exact
 * line match, as bash reads it; for `<<-` leading tabs are stripped first — or
 * to the end of the command when no such line exists. An operator with no
 * newline after it yields a body of the remaining text: the conservative
 * reading, so a truncated command still refuses on its escapes.
 */
export function findHeredocs(command: string): HeredocSpan[] {
  const spans: HeredocSpan[] = [];
  const regions = quotedRegions(command);
  HEREDOC_OPERATOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEREDOC_OPERATOR.exec(command)) !== null) {
    if (insideQuotes(regions, match.index)) continue;
    const stripTabs = (match[1] ?? '') === '-';
    const quoted = (match[2] ?? '') !== '';
    const delimiter = match[3] ?? '';
    const lineEnd = command.indexOf('\n', match.index + match[0].length);
    const bodyStart = lineEnd === -1 ? command.length : lineEnd + 1;
    let bodyEnd = command.length;
    let unterminated = true;
    let cursor = bodyStart;
    while (cursor <= command.length) {
      const nextNewline = command.indexOf('\n', cursor);
      const lineStop = nextNewline === -1 ? command.length : nextNewline;
      let line = command.slice(cursor, lineStop);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (stripTabs) line = line.replace(/^\t+/, '');
      if (line === delimiter) {
        bodyEnd = cursor;
        unterminated = false;
        // Resume scanning for further heredocs after the terminator line.
        HEREDOC_OPERATOR.lastIndex = lineStop;
        break;
      }
      if (nextNewline === -1) break;
      cursor = nextNewline + 1;
    }
    if (unterminated) HEREDOC_OPERATOR.lastIndex = command.length;
    spans.push({
      delimiter,
      quoted,
      stripTabs,
      body: command.slice(bodyStart, bodyEnd),
      unterminated,
      bodyStart,
      bodyEnd,
    });
  }
  return spans;
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
 * operators (`&&`, `||`, `|`, `;`, newline) and each segment into words with
 * quotes resolved. Good enough to find an option's value and a program name; it
 * does not expand anything. Command substitutions `$( … )` stay inside the word
 * that carries them.
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
    if (ch === '$' && command[i + 1] === '(') {
      // Keep a command substitution whole inside the word (balanced parens).
      let depth = 0;
      let j = i;
      while (j < command.length) {
        if (command[j] === '(') depth += 1;
        else if (command[j] === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }
      const end = j < command.length ? j + 1 : command.length;
      word += command.slice(i, end);
      inWord = true;
      i = end;
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

/** The index of the first token equal to `program` (a bare name or a path ending in it). */
function indexOfProgram(tokens: readonly string[], program: string): number {
  return tokens.findIndex((t) => t === program || t.endsWith('/' + program));
}

/**
 * An option's value and the flag AS WRITTEN: `--long X`, `--long=X`, `-s X`.
 * Returns null when the option is absent.
 */
function optionAsWritten(
  tokens: readonly string[],
  long: string,
  short: string | null,
): { flag: string; value: string } | null {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as string;
    if (t === long || (short !== null && t === short)) {
      const value = tokens[i + 1];
      return value === undefined ? null : { flag: t, value };
    }
    if (t.startsWith(long + '=')) return { flag: long + '=', value: t.slice(long.length + 1) };
  }
  return null;
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
      // Scoped to `gh`, the one program whose --body / -b takes a free-text body
      // that MSYS path-converts; `-b` means something else on diff, curl, cp, sort, du, grep.
      if (p.platform !== 'win32' || p.tool !== 'Bash') return null;
      const blanked = blankHeredocBodies(p.command, findHeredocs(p.command));
      for (const seg of tokenizeShell(blanked)) {
        const at = indexOfProgram(seg.tokens, 'gh');
        if (at === -1) continue;
        const hit = optionAsWritten(seg.tokens.slice(at + 1), '--body', '-b');
        if (hit !== null && hit.value.startsWith('/')) {
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
        const at = indexOfProgram(seg.tokens, 'sed');
        if (at === -1) continue;
        const args = seg.tokens.slice(at + 1);
        const inPlace = args.some(
          (a) =>
            a === '-i' || /^-i\S*$/.test(a) || a === '--in-place' || a.startsWith('--in-place='),
        );
        if (!inPlace) continue;
        // The EXPRESSION operands only — never a filename (a Windows path carries backslashes).
        let expressions = sedExpressions(args);
        if (expressions.length === 0) {
          const first = args.find((a) => !a.startsWith('-'));
          if (first !== undefined) expressions = [first];
        }
        const escaped = expressions.find((e) => e.includes('\\'));
        if (escaped !== undefined) {
          return { fragment: escaped, detail: 'a sed -i expression carries a backslash' };
        }
        if (sedExpressions(args).length > 1) {
          return {
            fragment: seg.raw.trim(),
            detail: `a sed -i invocation carries ${sedExpressions(args).length} -e expressions`,
          };
        }
        if (seg.raw.includes('\n')) {
          return { fragment: seg.raw.trim(), detail: 'a sed -i invocation spans a newline' };
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
          const at = indexOfProgram(seg.tokens, program);
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
      if (p.platform !== 'win32' || p.tool !== 'Bash') return null;
      if (p.command.includes('MSYS_NO_PATHCONV=1')) return null;
      const blanked = blankHeredocBodies(p.command, findHeredocs(p.command));
      let cursor = 0;
      while (cursor < blanked.length) {
        const open = blanked.indexOf('$(', cursor);
        if (open === -1) break;
        let depth = 0;
        let j = open + 1;
        while (j < blanked.length) {
          if (blanked[j] === '(') depth += 1;
          else if (blanked[j] === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
          j += 1;
        }
        const inner = blanked.slice(open + 2, j);
        const hit = REV_PATH_TOKEN.exec(inner);
        if (hit !== null && !(hit[2] as string).includes('//')) {
          return {
            fragment: hit[2] as string,
            detail: 'a <rev>:<path> argument inside $( … ) is path-converted by MSYS on win32',
          };
        }
        cursor = j + 1;
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
  const p = parseTransportShieldPayload(payload);
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

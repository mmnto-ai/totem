import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemConfigError, TotemError } from './errors.js';
import type { GateContext, GateDisposition, GateEvaluator, GateVerdict } from './gate-types.js';
import { findRepoRootSync, getGitBranch } from './sys/git.js';
import { matchesPathGlob } from './sys/glob.js';
import {
  backtickBodies,
  blankHeredocBodies,
  findHeredocs,
  MATCHED_FRAGMENT_MAX,
  programSpellings,
  programStart,
  RESERVED_BEFORE_PROGRAM,
  substitutionBodies,
  tokenizeShell,
  WRAPPER_POSITIONALS,
  WRAPPER_VALUE_OPTIONS,
} from './transport-shield.js';

/**
 * The `action-policy` gate event (mmnto-ai/totem#3106).
 *
 * A consumer-authored `.totem/action-policy.json` classifies edits (Write |
 * Edit, by path glob) and shell commands (Bash | PowerShell, by token-prefix
 * pattern) into governed action kinds, each row carrying a disposition. The
 * evaluator returns the most severe matching row's verdict with provenance
 * citing that row. It ships the format and the engine; the rows are the
 * consumer's.
 *
 * A command row matches from the statement's program position (past
 * assignments, reserved words and the wrapper table's wrappers with their
 * options), against the program's spellings, in every statement the command
 * runs including `$( … )` bodies, Bash backtick bodies and the substitutions in
 * an unquoted heredoc; heredoc text is never a statement. A shell handed a
 * string (`eval`, `sh -c`, `pwsh -Command`, `cmd /c`, text fed to a shell's
 * stdin) is warned on as `opaque-shell-string` when the policy has command
 * rows. Not read, and disclosed: a renamed program, a script the agent wrote
 * and then runs, an interpreter's string, a command reached through another
 * program's arguments, `Invoke-Expression`, `env -S`, a process substitution, a
 * `case` arm, a substitution nested deeper than four.
 */

export const ACTION_POLICY_FILE = 'action-policy.json';

export const ACTION_POLICY_EVENT = 'action-policy';

/** The eight governed action kinds. */
export const ACTION_KINDS = [
  'code_edit',
  'secret_read',
  'db_migration',
  'db_data_write',
  'deploy_config_change',
  'deploy_trigger',
  'scheduled_job_change',
  'index_rebuild',
] as const;

/** The environment value a row carries when it applies on every branch. */
export const ACTION_POLICY_ANY_ENVIRONMENT = 'any';

/** The one policy-file format version this build reads. */
export const ACTION_POLICY_VERSION = 1;

/**
 * The audited escape: a comma-separated list of row ids whose `deny` verdicts
 * become `allow`, read from the gate context env else the process env, as
 * merge-ready reads `TOTEM_MERGE_GATE_OVERRIDE`.
 */
export const ACTION_POLICY_OVERRIDE_ENV = 'TOTEM_ACTION_POLICY_OVERRIDE';

/** The prefix on the gate's agent-facing stderr line. */
const ACTION_POLICY_NOTICE_PREFIX = '[action-policy]';

/**
 * The value `getGitBranch` returns when git cannot be read (it never throws).
 * The default branch reader treats it as the unevaluable read.
 */
const GIT_BRANCH_UNKNOWN_SENTINEL = '(unknown)';

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const REF_NO_POLICY_FILE = 'no-policy-file';
const REF_NO_POLICY_MATCH = 'no-policy-match';
const REF_OUTSIDE_REPO = 'outside-repo';
const REF_ENVIRONMENT_UNEVALUABLE = 'environment-unevaluable';
const REF_SUBJECT_TOO_LONG = 'subject-too-long';

// ─── Schema (the file boundary) ────────────────────────────────────────────

/** Most `*` a path glob may carry (`**` counts two): bounds the glob's backtracking. */
export const ACTION_POLICY_PATH_GLOB_STAR_MAX = 3;

/** Most `*` one command-pattern token may carry (`**` counts two). */
export const ACTION_POLICY_COMMAND_TOKEN_STAR_MAX = 2;

/**
 * A statement token or an edited path longer than this is NOT compared
 * against a glob carrying a wildcard: that comparison is unevaluable, and the
 * verdict is `subject-too-long` (`deny` under strict, `warn` under pilot, never
 * `allow`). Against a literal glob it still compares whole. Bounds the glob's
 * work on a pathological input without a silent bypass.
 */
export const ACTION_POLICY_WILDCARD_TOKEN_MAX = 1024;

const slug = (what: string) => z.string().regex(SLUG_RE, `${what} must be a kebab-case slug`);

const nonBlank = (what: string) =>
  z.string().refine((s) => s.trim() !== '', { message: `${what} must be a non-blank string` });

const starCount = (text: string): number => text.split('*').length - 1;

/** A drive-letter, slash or backslash start: an absolute spelling, never repo-relative. */
const ABSOLUTE_GLOB_RE = /^(?:[/\\]|[A-Za-z]:)/;

/** A `../`, `./` or `~` start: a spelling no repo-relative path can ever have. */
const NEVER_RELATIVE_GLOB_RE = /^(?:\.\.?[/\\]|~)/;

const pathGlob = nonBlank('path glob')
  .refine((g) => !ABSOLUTE_GLOB_RE.test(g), {
    message:
      'path globs are repo-relative: drop the leading "/", "\\" or drive letter (the gate makes every edited path relative to the repository root first)',
  })
  .refine((g) => !NEVER_RELATIVE_GLOB_RE.test(g), {
    message:
      'a path glob starting with "../", "./" or "~" can never match: the gate compares the path relative to the repository root, with no leading "./"',
  })
  .refine((g) => starCount(g) <= ACTION_POLICY_PATH_GLOB_STAR_MAX, {
    message: `a path glob may carry at most ${ACTION_POLICY_PATH_GLOB_STAR_MAX} "*" ("**" counts two)`,
  });

/**
 * Whether a pattern's first token names what the gate skips before the
 * program: a wrapper from the table (by basename), `time`, `coproc`,
 * `function`, a `NAME=value` assignment or a reserved word. Such a pattern could never match, because the comparison
 * starts at the program.
 */
function startsBeforeProgram(pattern: string): boolean {
  const first = pattern.trim().split(/\s+/)[0] ?? '';
  const names = programSpellings(first);
  return (
    first === 'coproc' ||
    first === 'function' ||
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(first) ||
    RESERVED_BEFORE_PROGRAM.has(first) ||
    [...names.exact, ...names.folded].some((n) => Object.hasOwn(WRAPPER_VALUE_OPTIONS, n))
  );
}

const commandPattern = nonBlank('command pattern')
  .refine(
    (p) =>
      p
        .trim()
        .split(/\s+/)
        .every((t) => starCount(t) <= ACTION_POLICY_COMMAND_TOKEN_STAR_MAX),
    {
      message: `each command-pattern token may carry at most ${ACTION_POLICY_COMMAND_TOKEN_STAR_MAX} "*" ("**" counts two)`,
    },
  )
  .refine(
    (p) => !startsBeforeProgram(p),
    (p) => {
      const first = p.trim().split(/\s+/)[0] ?? '';
      return {
        message: /[/\\]/.test(first)
          ? `a command pattern's first token "${first}" has the basename of a wrapper the gate skips before the program, so it could never match: a repository script whose basename is a wrapper's cannot be governed by a command row`
          : 'a command pattern starts at the program: drop the leading wrapper, reserved word, assignment, "function", "time" or "coproc" (the gate skips them before it compares, so this pattern could never match)',
      };
    },
  );

export const ActionKindSchema = z.enum(ACTION_KINDS);

export const ActionPolicyEnvironmentSchema = z
  .object({
    name: slug('environment name').refine((n) => n !== ACTION_POLICY_ANY_ENVIRONMENT, {
      message: `environment name "${ACTION_POLICY_ANY_ENVIRONMENT}" is reserved for rows that apply on every branch`,
    }),
    branches: z
      .array(
        nonBlank('branch glob').refine((g) => starCount(g) <= ACTION_POLICY_PATH_GLOB_STAR_MAX, {
          message: `a branch glob may carry at most ${ACTION_POLICY_PATH_GLOB_STAR_MAX} "*" ("**" counts two)`,
        }),
      )
      .min(1, 'an environment needs at least one branch glob'),
  })
  .strict();

export const ActionPolicyScopeSchema = z
  .object({
    paths: z.array(pathGlob).optional(),
    commands: z.array(commandPattern).optional(),
  })
  .strict()
  .refine((s) => (s.paths?.length ?? 0) > 0 || (s.commands?.length ?? 0) > 0, {
    message: 'scope needs at least one non-empty "paths" or "commands" list',
  });

export const ActionPolicyDispositionSchema = z.enum(['display', 'warn', 'deny']);

export const ActionPolicyRowSchema = z
  .object({
    id: slug('row id'),
    action_kind: ActionKindSchema,
    scope: ActionPolicyScopeSchema,
    environment: z.string().min(1).default(ACTION_POLICY_ANY_ENVIRONMENT),
    disposition: ActionPolicyDispositionSchema,
    reason: z.string().optional(),
  })
  .strict();

/**
 * Every object in the file is strict (mmnto-ai/totem#3106): an unknown key
 * fails the load with its path, so a typo (`enviroment`, `command`) can never
 * silently drop governance. The freeze file is read leniently; this one is not.
 */
export const ActionPolicyConfigSchema = z
  .object({
    version: z.literal(ACTION_POLICY_VERSION),
    _note: z.string().optional(),
    environments: z.array(ActionPolicyEnvironmentSchema).optional(),
    rows: z.array(ActionPolicyRowSchema),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    const declared = new Set((config.environments ?? []).map((e) => e.name));
    config.rows.forEach((row, index) => {
      if (seen.has(row.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'id'],
          message: `duplicate row id "${row.id}"`,
        });
      }
      seen.add(row.id);
      if (row.environment !== ACTION_POLICY_ANY_ENVIRONMENT && !declared.has(row.environment)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', index, 'environment'],
          message: `environment "${row.environment}" is neither "${ACTION_POLICY_ANY_ENVIRONMENT}" nor a declared environments[].name`,
        });
      }
    });
  });

export type ActionKind = z.infer<typeof ActionKindSchema>;
export type ActionPolicyEnvironment = z.infer<typeof ActionPolicyEnvironmentSchema>;
export type ActionPolicyScope = z.infer<typeof ActionPolicyScopeSchema>;
export type ActionPolicyDisposition = z.infer<typeof ActionPolicyDispositionSchema>;
export type ActionPolicyRow = z.infer<typeof ActionPolicyRowSchema>;
export type ActionPolicyConfig = z.infer<typeof ActionPolicyConfigSchema>;

/**
 * Read `<totemDir>/action-policy.json`, on the `readFreezeConfig` precedent.
 *
 * - **Absent file → `null`** (nothing is governed).
 * - **Present but unreadable, unparseable or schema-invalid → THROWS
 *   `TotemConfigError` (fail-closed).** A corrupt policy never yields a verdict.
 */
export function readActionPolicyConfig(totemDir: string): ActionPolicyConfig | null {
  const filePath = path.join(totemDir, ACTION_POLICY_FILE);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new TotemConfigError(
      `Failed to read ${ACTION_POLICY_FILE}`,
      'Check filesystem permissions for the .totem directory.',
      'CONFIG_MISSING',
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TotemConfigError(
      `Malformed ${ACTION_POLICY_FILE}`,
      'Fix the JSON syntax in .totem/action-policy.json, or remove the file if nothing is governed.',
      'CONFIG_INVALID',
      err,
    );
  }

  const result = ActionPolicyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new TotemConfigError(
      `Invalid ${ACTION_POLICY_FILE}: ${result.error.issues
        .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
        .join('; ')}`,
      'action-policy.json must be { version: 1, environments?: [{ name, branches }], rows: [{ id, action_kind, scope: { paths?, commands? }, environment?, disposition, reason? }] }.',
      'CONFIG_INVALID',
      result.error,
    );
  }

  return result.data;
}

// ─── Payload ───────────────────────────────────────────────────────────────

export type ActionPolicyPathTool = 'Write' | 'Edit';
export type ActionPolicyCommandTool = 'Bash' | 'PowerShell';

export type ActionPolicyPayload =
  | { tool: ActionPolicyPathTool; path: string; platform?: string }
  | { tool: ActionPolicyCommandTool; command: string; platform?: string };

const PATH_TOOLS: ReadonlySet<string> = new Set<string>(['Write', 'Edit']);
const COMMAND_TOOLS: ReadonlySet<string> = new Set<string>(['Bash', 'PowerShell']);

/**
 * Parse an unknown payload into the gate's shape. Throws `GATE_INVALID` on a
 * tool outside the four, on anything but exactly one of `path` (Write | Edit)
 * or `command` (Bash | PowerShell) as a non-blank string, or on a non-string
 * `platform`. Never default-allows.
 */
export function parseActionPolicyPayload(payload: unknown): ActionPolicyPayload {
  const rec =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : undefined;
  const hint =
    'Pass --payload \'{"tool":"Edit","path":"<file>"}\' or \'{"tool":"Bash","command":"<the command>","platform":"win32"}\'.';
  const fail = (message: string): never => {
    // totem-context: TotemError's constructor stamps the shared [Totem Error] prefix on every message, the same class and code the freeze-check and transport-shield payload parsers throw
    throw new TotemError('GATE_INVALID', `action-policy payload ${message}`, hint);
  };
  const tool = rec && typeof rec.tool === 'string' ? rec.tool : '';
  if (!PATH_TOOLS.has(tool) && !COMMAND_TOOLS.has(tool)) {
    fail('requires "tool" to be "Write", "Edit", "Bash" or "PowerShell".');
  }
  const platform = rec?.platform;
  if (platform !== undefined && typeof platform !== 'string') {
    fail('carries a non-string "platform".');
  }
  const hasPath = rec?.path !== undefined;
  const hasCommand = rec?.command !== undefined;
  if (PATH_TOOLS.has(tool)) {
    if (hasCommand) fail(`for ${tool} carries "command"; it takes "path" only.`);
    if (typeof rec?.path !== 'string' || rec.path.trim() === '') {
      fail(`for ${tool} requires a non-empty "path" string.`);
    }
    return {
      tool: tool as ActionPolicyPathTool,
      path: rec?.path as string,
      ...(platform !== undefined ? { platform: platform as string } : {}),
    };
  }
  if (hasPath) fail(`for ${tool} carries "path"; it takes "command" only.`);
  if (typeof rec?.command !== 'string' || rec.command.trim() === '') {
    fail(`for ${tool} requires a non-empty "command" string.`);
  }
  return {
    tool: tool as ActionPolicyCommandTool,
    command: rec?.command as string,
    ...(platform !== undefined ? { platform: platform as string } : {}),
  };
}

// ─── Matching ──────────────────────────────────────────────────────────────

/** Severity order for choosing among matched rows; ties go to file order. */
const SEVERITY: Readonly<Record<ActionPolicyDisposition, number>> = {
  display: 0,
  warn: 1,
  deny: 2,
};

interface RowMatch {
  row: ActionPolicyRow;
  /** The repo-relative path or the matched statement text. */
  matched: string;
}

/** One shell statement: its tokens, its raw text, and whether a pipe feeds it. */
interface Statement {
  tokens: string[];
  raw: string;
  /** True when the statement follows a `|` (it is not the first in its pipeline). */
  piped: boolean;
}

/** How deep substitution bodies are read (`$( $( … ) )`), the shield's own bound. */
const SUBSTITUTION_DEPTH_MAX = 4;

/** Executable suffixes stripped from a program token before it is compared. */
const PROGRAM_SUFFIXES: readonly string[] = ['.exe', '.cmd'];

/**
 * The program position: past assignments, reserved words, `coproc`, leading
 * redirections, and wrappers with their options.
 */
const PROGRAM_START_OPTIONS = {
  wrapperOptions: WRAPPER_VALUE_OPTIONS,
  wrapperPositionals: WRAPPER_POSITIONALS,
  skipRedirections: true,
};

/** The shells (a closed list) that run a string given with `-c` in a short-option cluster. */
const POSIX_SHELLS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'ash',
  'mksh',
  'fish',
  'csh',
  'tcsh',
]);

/**
 * PowerShell host options that take a separate value (lower-cased; a
 * `-opt:value` spelling carries its own), skipped with their value while the
 * first positional is sought.
 */
const POWERSHELL_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-file',
  '-f',
  '-command',
  '-c',
  '-commandwithargs',
  '-encodedcommand',
  '-e',
  '-ec',
  '-encodedarguments',
  '-ea',
  '-encodeda',
  '-executionpolicy',
  '-ex',
  '-ep',
  '-inputformat',
  '-i',
  '-if',
  '-outputformat',
  '-o',
  '-of',
  '-version',
  '-v',
  '-configurationname',
  '-config',
  '-configurationfile',
  '-settingsfile',
  '-workingdirectory',
  '-wd',
  '-psconsolefile',
  '-psc',
  '-windowstyle',
  '-w',
  '-custompipename',
]);

/** PowerShell hosts. */
const POWERSHELL_HOSTS: ReadonlySet<string> = new Set(['pwsh', 'powershell']);

/** POSIX shell options that take a separate value (`-o pipefail`, `--rcfile f`). */
const POSIX_SHELL_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-o',
  '+o',
  '-O',
  '+O',
  '--rcfile',
  '--init-file',
]);

const REF_OPAQUE_SHELL_STRING = 'opaque-shell-string';

const bound = (text: string): string => text.slice(0, MATCHED_FRAGMENT_MAX);

/**
 * The directory edited paths are made relative to: the repository root found
 * by walking up from `totemDir` for `.git`, else the parent of `totemDir` when
 * there is no repository (mmnto-ai/totem#3106).
 */
function policyRoot(totemDir: string): string {
  const abs = path.resolve(totemDir);
  return findRepoRootSync(abs) ?? path.dirname(abs);
}

/**
 * Repo-relative, `/`-separated form of `filePath`, or null when the path lies
 * outside the root. A relative path is read as already repo-relative.
 */
function repoRelativePath(filePath: string, root: string): string | null {
  const slashed = filePath.replace(/\\/g, '/');
  const rel = path.isAbsolute(slashed)
    ? path.relative(root, slashed).replace(/\\/g, '/')
    : path.posix.normalize(slashed);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    return null;
  }
  return rel;
}

const hasWildcard = (glob: string): boolean => /[*?{[]/.test(glob);

/** The outcome of one comparison: a match, no match, or not compared (too long for a wildcard). */
type Compare = 'match' | 'nomatch' | 'unevaluable';

/**
 * One path or token against one glob. A subject longer than
 * {@link ACTION_POLICY_WILDCARD_TOKEN_MAX} is not compared against a glob with
 * a wildcard (`unevaluable`, or `nomatch` when the glob's literal head does not
 * start it); against a literal glob it compares whole.
 */
function boundedGlobCompare(subject: string, glob: string): Compare {
  if (hasWildcard(glob) && subject.length > ACTION_POLICY_WILDCARD_TOKEN_MAX) {
    // The glob's literal head before its first wildcard must still start the
    // subject: `src/**` can never match a `db/…` path, however long.
    const head = glob.slice(0, glob.search(/[*?{[]/));
    return subject.startsWith(head) ? 'unevaluable' : 'nomatch';
  }
  return matchesPathGlob(subject, glob) ? 'match' : 'nomatch';
}

/** Any of several alternatives: a match wins, then an unevaluable one. */
function anyCompare(results: readonly Compare[]): Compare {
  if (results.includes('match')) return 'match';
  return results.includes('unevaluable') ? 'unevaluable' : 'nomatch';
}

/** All of several parts: a definite mismatch wins, then an unevaluable one. */
function allCompare(results: readonly Compare[]): Compare {
  if (results.includes('nomatch')) return 'nomatch';
  return results.includes('unevaluable') ? 'unevaluable' : 'match';
}

/**
 * The names a program token is compared by: the shield's program spellings
 * (the token, its name after the last `/`, and on PowerShell after the last
 * backslash; a `.exe` / `.cmd` spelling's lower-cased stem), plus the token
 * with a leading `./` dropped (backslashes read as `/` on PowerShell), so
 * `./scripts/deploy.sh` meets `scripts/deploy.sh`.
 */
function programNames(token: string, powershell: boolean): { exact: string[]; folded: string[] } {
  const names = programSpellings(token, { suffixes: PROGRAM_SUFFIXES, backslash: powershell });
  const slashed = powershell ? token.replace(/\\/g, '/') : token;
  const exact = slashed.startsWith('./') ? [...names.exact, slashed.slice(2)] : names.exact;
  return { exact, folded: names.folded };
}

function programCompare(token: string, glob: string, powershell: boolean): Compare {
  const names = programNames(token, powershell);
  return anyCompare([
    ...names.exact.map((n) => boundedGlobCompare(n, glob)),
    ...names.folded.map((n) => boundedGlobCompare(n, glob.toLowerCase())),
  ]);
}

/**
 * Whether a statement's program and the arguments after it match every token
 * of `pattern`, in order. The program position is the shield's
 * {@link programStart} with the wrapper-option table: past assignments, the
 * reserved words that can stand before a program, and each wrapper (by
 * basename) with its options.
 */
function commandPatternCompare(
  tokens: readonly string[],
  pattern: string,
  powershell: boolean,
): Compare {
  const patternTokens = pattern.trim().split(/\s+/);
  const start = programStart(tokens, undefined, PROGRAM_START_OPTIONS);
  if (tokens.length - start < patternTokens.length) return 'nomatch';
  return allCompare(
    patternTokens.map((glob, i) =>
      i === 0
        ? programCompare(tokens[start] as string, glob, powershell)
        : boundedGlobCompare(tokens[start + i] as string, glob),
    ),
  );
}

/**
 * Every statement the command runs, read as the shield reads them: heredoc
 * bodies blanked first (a body is never a statement), then each segment, then
 * the bodies of its `$( … )` substitutions and, for the Bash tool, the
 * backtick substitutions, recursively to the shield's depth bound. In an
 * UNQUOTED heredoc body bash runs the substitutions, so those bodies are read
 * too; a quoted-delimiter body (`<<'X'`, `<<"X"`) is text throughout.
 * PowerShell's backtick is its escape character, so no backtick body is read
 * there, and its backslashes are path characters.
 */
function commandStatements(command: string, powershell: boolean, depth = 0): Statement[] {
  // On the Bash tool the tokenizer joins line continuations as bash does
  // (heredoc bodies are blanked first, so nothing in a body is joined).
  const opts = { powershell, literalBackslash: powershell, joinContinuations: !powershell };
  const spans = findHeredocs(command, opts);
  const blanked = blankHeredocBodies(command, spans);
  const out: Statement[] = [];
  // A heredoc body has no quoting or comment rule: an apostrophe, a quoted span
  // or a `#` there is text, so its substitutions are read raw.
  const nested = (text: string, heredocBody: boolean): void => {
    if (depth >= SUBSTITUTION_DEPTH_MAX) return;
    for (const body of substitutionBodies(text, { raw: heredocBody, powershell })) {
      out.push(...commandStatements(body, powershell, depth + 1));
    }
  };
  let cursor = 0;
  for (const seg of tokenizeShell(blanked, opts)) {
    const at = blanked.indexOf(seg.raw, cursor);
    const before = at === -1 ? '' : blanked.slice(0, at).trimEnd();
    if (at !== -1) cursor = at + seg.raw.length;
    // `|` and bash's `|&` feed the statement; `||` does not.
    const piped = before.endsWith('|&') || (before.endsWith('|') && !before.endsWith('||'));
    if (seg.tokens.length > 0) out.push({ tokens: seg.tokens, raw: seg.raw, piped });
    nested(seg.raw, false);
  }
  const unquotedBodies = spans.filter((s) => !s.quoted).map((s) => s.body);
  for (const body of unquotedBodies) nested(body, true);
  if (!powershell && depth < SUBSTITUTION_DEPTH_MAX) {
    const texts: Array<[string, boolean]> = [
      [blanked, false],
      ...unquotedBodies.map((b): [string, boolean] => [b, true]),
    ];
    for (const [text, heredocBody] of texts) {
      for (const body of backtickBodies(text, undefined, { raw: heredocBody })) {
        out.push(...commandStatements(body, powershell, depth + 1));
      }
    }
  }
  return out;
}

/** What a shell's arguments show: a string flag, stdin fed by text, a script argument. */
interface ShellArgs {
  dashC: boolean;
  stdinText: boolean;
  inputRedirect: boolean;
  script: boolean;
}

/**
 * Read a POSIX shell's arguments up to its first non-option token: a `-c` in a
 * short-option cluster there, a heredoc or here-string (`<<…`, `0<<…`,
 * `<<<…`), an input redirection (`<f`, `0< f`), and whether a script argument
 * follows (never under `-s`). Output redirections are skipped with their
 * targets.
 */
function readShellArgs(args: readonly string[]): ShellArgs {
  const out: ShellArgs = { dashC: false, stdinText: false, inputRedirect: false, script: false };
  let optionsOpen = true;
  let readsStdin = false;
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k] as string;
    if (/^\d*<</.test(a)) {
      out.stdinText = true;
      if (/^\d*<<[<-]?$/.test(a)) k += 1;
      continue;
    }
    if (/^\d*<(?!\()/.test(a)) {
      out.inputRedirect = true;
      if (/^\d*<$/.test(a)) k += 1;
      continue;
    }
    if (/^(?:\d*>|&>)/.test(a)) {
      if (/^(?:\d*>>?|&>>?)$/.test(a)) k += 1;
      continue;
    }
    if (optionsOpen && a === '--') {
      optionsOpen = false;
      continue;
    }
    if (optionsOpen && a === '-') {
      // A lone `-` ends the options; the commands come from stdin.
      return out;
    }
    if (optionsOpen && /^[-+][A-Za-z-]/.test(a)) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(a)) out.dashC = true;
      if (/^-[A-Za-z]*s[A-Za-z]*$/.test(a)) readsStdin = true;
      if (POSIX_SHELL_VALUE_OPTIONS.has(a)) k += 1;
      continue;
    }
    // With `-s` the shell reads its commands from stdin and the rest are
    // positional parameters, never a script.
    out.script = !readsStdin;
    return out;
  }
  return out;
}

/**
 * A PowerShell option that hands the host a string: a prefix of `-command` or
 * `-encodedcommand`, or `-ec`, also in the colon spelling (`-Command:…`).
 * `--command` and `/c` are not read.
 */
function isPowerShellStringFlag(arg: string): boolean {
  const colon = arg.indexOf(':');
  const a = (colon === -1 ? arg : arg.slice(0, colon)).toLowerCase();
  if (a.length < 2 || !a.startsWith('-') || a.startsWith('--')) return false;
  return '-command'.startsWith(a) || '-encodedcommand'.startsWith(a) || a === '-ec';
}

/**
 * Whether the statement hands a shell a string this gate does not read. After
 * the redirection and wrapper skip, the program (by basename) is `eval`; or a
 * shell from {@link POSIX_SHELLS} with a `-c` in a short-option cluster
 * before its first non-option token; or `pwsh` / `powershell` with a
 * `-command` / `-encodedcommand` prefix or `-ec` (colon spellings included),
 * or a quoted first positional and no `-File`; or `cmd` with `/c` or `/k`
 * (glued text included); or any of those shells fed text on stdin by a
 * heredoc or here-string (glued, spaced, or standing before the program), or
 * with no script argument (a lone `-` or `-s` ends the options) while a pipe
 * (`|` or `|&`) or an input redirection feeds it.
 */
function isOpaqueShell(statement: Statement, powershell: boolean): boolean {
  const { tokens } = statement;
  const start = programStart(tokens, undefined, PROGRAM_START_OPTIONS);
  let program = tokens[start];
  if (program === undefined) return false;
  // A heredoc or an input redirection standing before the program feeds it too.
  const lead = tokens.slice(0, start);
  const leadStdinText = lead.some((t) => /^\d*<</.test(t));
  const leadInput = lead.some((t) => /^\d*<(?![<(])/.test(t));
  let args = tokens.slice(start + 1);
  const glued = program.indexOf('<<');
  if (glued > 0) {
    args = [program.slice(glued), ...args];
    program = program.slice(0, glued);
  }
  const names = programNames(program, powershell);
  const lower = [...names.exact.map((n) => n.toLowerCase()), ...names.folded];
  const exact = [...names.exact, ...names.folded];
  if (exact.includes('eval')) return true;
  const fedWithoutScript = (read: ShellArgs): boolean =>
    read.stdinText ||
    leadStdinText ||
    (!read.script && (statement.piped || read.inputRedirect || leadInput));
  if (exact.some((n) => POSIX_SHELLS.has(n))) {
    const read = readShellArgs(args);
    return read.dashC || fedWithoutScript(read);
  }
  if (lower.some((n) => POWERSHELL_HOSTS.has(n))) {
    if (args.some(isPowerShellStringFlag)) return true;
    const read = readShellArgs(args);
    const file = args.some((a) => /^-f(?:ile)?(?::|$)/i.test(a));
    if (!file && firstPositionalIsQuoted(statement.raw, program)) return true;
    const script = file || args.some((a) => /\.ps1$/i.test(a));
    return (
      read.stdinText ||
      leadStdinText ||
      (!script && (statement.piped || read.inputRedirect || leadInput))
    );
  }
  if (lower.includes('cmd')) {
    if (args.some((a) => /^\/[ck]/i.test(a))) return true;
    const read = readShellArgs(args);
    return read.stdinText || leadStdinText || statement.piped || read.inputRedirect || leadInput;
  }
  return false;
}

/**
 * Whether the first argument after `program` that is not an option starts
 * with a quote character in the statement's raw text (`powershell "…"`). Its
 * limits are stated in the configuration reference.
 */
function firstPositionalIsQuoted(raw: string, program: string): boolean {
  const words = raw.trim().split(/\s+/);
  const unquote = (w: string): string => w.replace(/["']/g, '');
  const at = words.findIndex((w) => {
    const bare = unquote(w);
    return bare === program || bare.endsWith(`/${program}`) || bare.endsWith(`\\${program}`);
  });
  if (at === -1) return false;
  for (let k = at + 1; k < words.length; k += 1) {
    const w = words[k] as string;
    if (!w.startsWith('-')) return /^["']/.test(w);
    // `-opt:value` carries its own value; a listed option takes the next word,
    // a quoted value with spaces running to its closing quote. Any other option
    // is skipped as a flag, so a value it takes ends the search.
    if (w.includes(':') || !isPowerShellValueOption(w)) continue;
    k += 1;
    const value = words[k];
    const quote = value?.[0];
    if (value !== undefined && (quote === '"' || quote === "'")) {
      const closed = (x: string, first: boolean): boolean =>
        x.endsWith(quote) && (!first || x.length > 1);
      if (!closed(value, true)) {
        while (k + 1 < words.length && !closed(words[k + 1] as string, false)) k += 1;
        k += 1;
      }
    }
  }
  return false;
}

/**
 * A PowerShell host option that takes a value: a listed name, or an
 * unambiguous prefix of one with at least two letters after the dash (the way
 * the host matches `-Exec` to `-ExecutionPolicy`). An ambiguous prefix is not.
 */
function isPowerShellValueOption(word: string): boolean {
  const w = word.toLowerCase();
  if (POWERSHELL_VALUE_OPTIONS.has(w)) return true;
  if (w.length < 3) return false;
  return [...POWERSHELL_VALUE_OPTIONS].filter((o) => o.startsWith(w)).length === 1;
}

/** Rows that matched, and rows whose comparison was unevaluable (a too-long subject). */
interface RowScan {
  matches: RowMatch[];
  tooLong: RowMatch[];
}

function matchPathRows(rows: readonly ActionPolicyRow[], relPath: string): RowScan {
  const scan: RowScan = { matches: [], tooLong: [] };
  for (const row of rows) {
    const result = anyCompare((row.scope.paths ?? []).map((g) => boundedGlobCompare(relPath, g)));
    if (result === 'match') scan.matches.push({ row, matched: relPath });
    else if (result === 'unevaluable') scan.tooLong.push({ row, matched: bound(relPath) });
  }
  return scan;
}

function matchCommandRows(
  rows: readonly ActionPolicyRow[],
  statements: readonly Statement[],
  powershell: boolean,
): RowScan {
  const scan: RowScan = { matches: [], tooLong: [] };
  for (const row of rows) {
    const patterns = row.scope.commands ?? [];
    let unevaluable: Statement | undefined;
    const hit = statements.find((s) => {
      const result = anyCompare(
        patterns.map((p) => commandPatternCompare(s.tokens, p, powershell)),
      );
      if (result === 'unevaluable' && unevaluable === undefined) unevaluable = s;
      return result === 'match';
    });
    if (hit) scan.matches.push({ row, matched: bound(hit.raw.trim()) });
    else if (unevaluable) scan.tooLong.push({ row, matched: bound(unevaluable.raw.trim()) });
  }
  return scan;
}

/** The most severe match, ties to file order (the input order). */
function mostSevere(matches: readonly RowMatch[]): RowMatch | undefined {
  let winner: RowMatch | undefined;
  for (const m of matches) {
    if (!winner || SEVERITY[m.row.disposition] > SEVERITY[winner.row.disposition]) winner = m;
  }
  return winner;
}

/** Outcome of deriving the current environments: every matching name, or unevaluable. */
type EnvironmentRead = { ok: true; names: string[] } | { ok: false; why: string };

function deriveEnvironments(
  config: ActionPolicyConfig,
  root: string,
  context: GateContext | undefined,
): EnvironmentRead {
  const reader = context?.gitBranchReader ?? getGitBranch;
  let branch: string;
  try {
    branch = reader(root).trim();
    // totem-context: fail-closed conversion, not a swallow: a thrown branch read becomes the unevaluable verdict (capped at the skipped rows' own dispositions, never allow) carrying the read's message
  } catch (err) {
    return {
      ok: false,
      why: err instanceof Error ? err.message : 'the branch reader threw a non-Error value',
    };
  }
  if (branch === '') {
    return { ok: false, why: 'the current branch name is empty (a detached HEAD)' };
  }
  if (branch === GIT_BRANCH_UNKNOWN_SENTINEL) {
    return { ok: false, why: 'git could not read the current branch' };
  }
  const names = (config.environments ?? [])
    .filter((e) => e.branches.some((glob) => matchesPathGlob(branch, glob)))
    .map((e) => e.name);
  return { ok: true, names };
}

// ─── Evaluator ─────────────────────────────────────────────────────────────

/** The row ids named in the override env var (trimmed, blanks dropped). */
function overriddenRowIds(context: GateContext | undefined): ReadonlySet<string> {
  const env = context?.env ?? process.env;
  const raw = env[ACTION_POLICY_OVERRIDE_ENV] ?? '';
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  );
}

/** A verdict plus the one stderr line it owes, written only if it is returned. */
interface Decision {
  verdict: GateVerdict;
  notice?: string;
}

/**
 * action-policy: classify the action against the policy rows and return the
 * most severe matching row's verdict. Synchronous; reads the policy file and,
 * only when a scope-matched row names an environment, the current branch.
 * Writes no file; prints one stderr line through the context writer when the
 * override env var turns the candidate `deny` rows, every one named, into
 * `allow`.
 */
export const actionPolicyEvaluator: GateEvaluator = (payload, totemDir, context): GateVerdict => {
  const parsed = parseActionPolicyPayload(payload);
  const checkedAt = new Date().toISOString();
  const source = `${path.basename(totemDir)}/${ACTION_POLICY_FILE}`;
  const config = readActionPolicyConfig(totemDir);

  if (config === null) {
    return {
      disposition: 'allow',
      reason: 'No action-policy file present; nothing is governed.',
      provenance: { source, ref: REF_NO_POLICY_FILE, matched: null, checkedAt },
    };
  }

  const root = policyRoot(totemDir);
  let scopeKind: 'path' | 'command';
  let matches: RowMatch[];
  let opaque: string | null = null;
  let opaqueStatements: string[] = [];
  let tooLong: RowMatch[] = [];
  if ('path' in parsed) {
    scopeKind = 'path';
    const rel = repoRelativePath(parsed.path, root);
    if (rel === null) {
      return {
        disposition: 'allow',
        reason: `Path "${parsed.path}" lies outside the repository; the policy does not govern it.`,
        provenance: { source, ref: REF_OUTSIDE_REPO, matched: parsed.path, checkedAt },
      };
    }
    const scan = matchPathRows(config.rows, rel);
    matches = scan.matches;
    tooLong = scan.tooLong;
  } else {
    scopeKind = 'command';
    const powershell = parsed.tool === 'PowerShell';
    const statements = commandStatements(parsed.command, powershell);
    const scan = matchCommandRows(config.rows, statements, powershell);
    matches = scan.matches;
    tooLong = scan.tooLong;
    if (config.rows.some((r) => (r.scope.commands?.length ?? 0) > 0)) {
      opaqueStatements = statements
        .filter((s) => isOpaqueShell(s, powershell))
        .map((s) => bound(s.raw.trim()));
      opaque = opaqueStatements[0] ?? null;
    }
  }

  // Environment: read only when a matched row names one.
  const envMatches = matches.filter((m) => m.row.environment !== ACTION_POLICY_ANY_ENVIRONMENT);
  let candidates = matches.filter((m) => m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT);
  let currentEnvironments: string[] | null = null;
  let skipped: RowMatch[] = [];
  let environmentWhy = '';
  const tooLongNamesEnvironment = tooLong.some(
    (m) => m.row.environment !== ACTION_POLICY_ANY_ENVIRONMENT,
  );
  if (envMatches.length > 0 || tooLongNamesEnvironment) {
    const env = deriveEnvironments(config, root, context);
    if (env.ok) {
      currentEnvironments = env.names;
      const applies = (m: RowMatch): boolean =>
        m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT ||
        env.names.includes(m.row.environment);
      candidates = matches.filter(applies);
      // A too-long comparison counts only for a row that applies on this branch.
      tooLong = tooLong.filter(applies);
    } else if (envMatches.length > 0) {
      skipped = envMatches;
      environmentWhy = env.why;
    }
  }
  const skippedDetail =
    skipped.length > 0 ? { skippedForEnvironment: skipped.map((m) => m.row.id) } : {};
  const skippedDeny = skipped.some((m) => m.row.disposition === 'deny');

  const opaqueVerdict = (
    matchedText: string,
    extra: Record<string, unknown> = {},
  ): GateVerdict => ({
    disposition: 'warn',
    reason:
      "This command hands a shell a string (sh -c, pwsh -Command, cmd /c, eval, or text on a shell's stdin); the action-policy gate does not read a shell string, so rows cannot judge what it runs.",
    provenance: {
      source,
      ref: REF_OPAQUE_SHELL_STRING,
      matched: matchedText,
      checkedAt,
      detail: {
        scopeKind,
        currentEnvironments,
        alsoMatched: candidates.map((m) => m.row.id),
        ...skippedDetail,
        ...extra,
      },
    },
  });

  const decide = (): Decision => {
    const winner = mostSevere(candidates);
    // A shell string the gate does not read warns, unless a row at warn or
    // deny already speaks for the call.
    if (opaque !== null && (winner === undefined || winner.row.disposition === 'display')) {
      return { verdict: opaqueVerdict(opaque) };
    }
    if (!winner) {
      return {
        verdict: {
          disposition: 'allow',
          reason: 'No action-policy row governs this action.',
          provenance: {
            source,
            ref: REF_NO_POLICY_MATCH,
            matched: null,
            checkedAt,
            ...(skipped.length > 0 ? { detail: { scopeKind, ...skippedDetail } } : {}),
          },
        },
      };
    }

    const denyMatches = candidates.filter((m) => m.row.disposition === 'deny');
    const named = overriddenRowIds(context);
    const allNamed = denyMatches.length > 0 && denyMatches.every((m) => named.has(m.row.id));
    const blocker = skipped.find((m) => m.row.disposition === 'deny');
    if (winner.row.disposition === 'deny' && allNamed && blocker !== undefined) {
      // The override is refused: cite the skipped deny row that refuses it.
      return {
        verdict: {
          disposition: 'deny',
          reason: `${ACTION_POLICY_OVERRIDE_ENV} refused: row ${blocker.row.id} (${blocker.row.action_kind}, deny) names environment "${blocker.row.environment}", which could not be read (${environmentWhy}); the override never applies while such a row is skipped.`,
          provenance: {
            source,
            ref: blocker.row.id,
            matched: blocker.matched,
            checkedAt,
            detail: {
              actionKind: blocker.row.action_kind,
              policyDisposition: blocker.row.disposition,
              environment: blocker.row.environment,
              currentEnvironments,
              scopeKind,
              overrideRefused: true,
              alsoMatched: candidates.map((m) => m.row.id),
              ...skippedDetail,
            },
          },
        },
      };
    }
    // The first unnamed deny row is what still blocks; with nothing named it is
    // the first deny row, which is the winner (ties go to file order).
    const cited =
      winner.row.disposition === 'deny'
        ? (denyMatches.find((m) => !named.has(m.row.id)) ?? winner)
        : winner;
    const { row } = cited;
    const policyDisposition = row.disposition;
    const reason = `${row.action_kind} (${policyDisposition}): ${row.reason ?? `governed by row ${row.id}`}`;
    const detail: Record<string, unknown> = {
      actionKind: row.action_kind,
      policyDisposition,
      environment: row.environment,
      currentEnvironments,
      scopeKind,
      alsoMatched: candidates.filter((m) => m !== cited).map((m) => m.row.id),
      ...skippedDetail,
    };

    const overridable = policyDisposition === 'deny' && !skippedDeny && allNamed;
    if (overridable) {
      // The named deny rows are lifted: the call proceeds with a warn citing the
      // first of them, every other matched row (warn and display included) kept
      // in alsoMatched, and any shell string listed rather than dropped.
      const ids = denyMatches.map((m) => m.row.id);
      const first = denyMatches[0] as RowMatch;
      const kinds = [...new Set(denyMatches.map((m) => m.row.action_kind))].join(', ');
      return {
        verdict: {
          disposition: 'warn',
          reason: `${ACTION_POLICY_OVERRIDE_ENV} lifted row(s) ${ids.join(', ')} (${kinds}, deny): ${first.row.reason ?? 'governed'}; proceeding`,
          provenance: {
            source,
            ref: first.row.id,
            matched: first.matched,
            checkedAt,
            detail: {
              ...detail,
              actionKind: first.row.action_kind,
              environment: first.row.environment,
              alsoMatched: candidates.filter((m) => m !== first).map((m) => m.row.id),
              overriddenBy: ACTION_POLICY_OVERRIDE_ENV,
              overriddenRows: ids,
              ...(opaqueStatements.length > 0 ? { opaqueStatements } : {}),
            },
          },
        },
        notice: `${ACTION_POLICY_NOTICE_PREFIX} OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing ${scopeKind} "${cited.matched}"; row(s) ${ids.join(', ')} would have denied.\n`,
      };
    }

    return {
      verdict: {
        disposition: policyDisposition === 'display' ? 'warn' : policyDisposition,
        reason,
        provenance: { source, ref: row.id, matched: cited.matched, checkedAt, detail },
      },
    };
  };

  let decision = decide();
  if (skipped.length > 0 && decision.verdict.disposition !== 'deny') {
    // The environment could not be read while rows naming one matched: never
    // allow, and never more severe than the skipped rows themselves.
    const disposition: GateDisposition = skippedDeny && context?.tier !== 'pilot' ? 'deny' : 'warn';
    const ids = skipped.map((m) => m.row.id);
    decision = {
      verdict: {
        disposition,
        reason: `The current environment could not be derived (${environmentWhy}) while row(s) ${ids.join(', ')} name an environment (tier=${context?.tier ?? 'strict'} → ${disposition}).`,
        provenance: {
          source,
          ref: REF_ENVIRONMENT_UNEVALUABLE,
          matched: null,
          checkedAt,
          detail: {
            scopeKind,
            currentEnvironments: null,
            alsoMatched: matches.map((m) => m.row.id),
            ...skippedDetail,
          },
        },
      },
    };
  }

  if (tooLong.length > 0 && decision.verdict.disposition !== 'deny') {
    // A subject too long to compare against a wildcard row that applies here:
    // never allow, never a silent miss, and never more severe than the rows
    // themselves. A matched deny elsewhere has already stood.
    const ids = tooLong.map((m) => m.row.id);
    const tooLongDeny = tooLong.filter((m) => m.row.disposition === 'deny');
    const named = overriddenRowIds(context);
    if (tooLongDeny.length > 0 && tooLongDeny.every((m) => named.has(m.row.id))) {
      // Every too-long deny row is named: lifted, like any other deny.
      const lifted = tooLongDeny.map((m) => m.row.id);
      const first = tooLongDeny[0] as RowMatch;
      const kinds = [...new Set(tooLongDeny.map((m) => m.row.action_kind))].join(', ');
      decision = {
        verdict: {
          disposition: 'warn',
          reason: `${ACTION_POLICY_OVERRIDE_ENV} lifted row(s) ${lifted.join(', ')} (${kinds}, deny): ${first.row.reason ?? 'governed'}; proceeding`,
          provenance: {
            source,
            ref: first.row.id,
            matched: first.matched,
            checkedAt,
            detail: {
              scopeKind,
              tooLongFor: ids,
              overriddenBy: ACTION_POLICY_OVERRIDE_ENV,
              overriddenRows: lifted,
              alsoMatched: matches.map((m) => m.row.id),
            },
          },
        },
        notice: `${ACTION_POLICY_NOTICE_PREFIX} OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing ${scopeKind} "${first.matched}"; row(s) ${lifted.join(', ')} would have denied.\n`,
      };
    } else if (tooLongDeny.length > 0 || decision.verdict.disposition === 'allow') {
      const disposition: GateDisposition =
        tooLongDeny.length > 0 && context?.tier !== 'pilot' ? 'deny' : 'warn';
      decision = {
        verdict: {
          disposition,
          reason: `A ${scopeKind} subject longer than ${ACTION_POLICY_WILDCARD_TOKEN_MAX} characters met a wildcard in row(s) ${ids.join(', ')}; the gate does not compare it (tier=${context?.tier ?? 'strict'} → ${disposition}).`,
          provenance: {
            source,
            ref: REF_SUBJECT_TOO_LONG,
            matched: (tooLong[0] as RowMatch).matched,
            checkedAt,
            detail: {
              scopeKind,
              tooLongFor: ids,
              alsoMatched: matches.map((m) => m.row.id),
            },
          },
        },
      };
    } else {
      // Already a warn, and the too-long rows cap at warn: keep the verdict
      // and name the rows it could not compare.
      decision = {
        ...decision,
        verdict: {
          ...decision.verdict,
          provenance: {
            ...decision.verdict.provenance,
            detail: { ...decision.verdict.provenance.detail, tooLongFor: ids },
          },
        },
      };
    }
  }

  if (decision.notice !== undefined) {
    const write = context?.writeStderr ?? ((line: string): void => void process.stderr.write(line));
    write(decision.notice);
  }
  return decision.verdict;
};

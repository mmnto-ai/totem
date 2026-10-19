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
  substitutionBodies,
  tokenizeShell,
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
 * assignments, wrappers and reserved words), against the program's basename,
 * in every statement the command runs including `$( … )` and backtick bodies;
 * heredoc bodies are text. A shell handed a string (`sh -c`, `pwsh -Command`,
 * `cmd /c`, a heredoc on stdin) is warned on as `opaque-shell-string` when the
 * policy has command rows. Disclosed limits: a renamed program, a script the
 * agent wrote and then runs, and anything a shell string contains match no
 * row.
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

// ─── Schema (the file boundary) ────────────────────────────────────────────

/** Most `*` a path glob may carry (`**` counts two): bounds the glob's backtracking. */
export const ACTION_POLICY_PATH_GLOB_STAR_MAX = 4;

/** Most `*` one command-pattern token may carry (`**` counts two). */
export const ACTION_POLICY_COMMAND_TOKEN_STAR_MAX = 2;

/**
 * A statement token longer than this is compared by its first this-many
 * characters against a wildcard pattern token; a literal token still compares
 * whole. Bounds the glob's work on a pathological argument.
 */
export const ACTION_POLICY_WILDCARD_TOKEN_MAX = 1024;

const slug = (what: string) => z.string().regex(SLUG_RE, `${what} must be a kebab-case slug`);

const nonBlank = (what: string) =>
  z.string().refine((s) => s.trim() !== '', { message: `${what} must be a non-blank string` });

const starCount = (text: string): number => text.split('*').length - 1;

/** A drive-letter, slash or backslash start: an absolute spelling, never repo-relative. */
const ABSOLUTE_GLOB_RE = /^(?:[/\\]|[A-Za-z]:)/;

const pathGlob = nonBlank('path glob')
  .refine((g) => !ABSOLUTE_GLOB_RE.test(g), {
    message:
      'path globs are repo-relative: drop the leading "/", "\\" or drive letter (the gate makes every edited path relative to the repository root first)',
  })
  .refine((g) => starCount(g) <= ACTION_POLICY_PATH_GLOB_STAR_MAX, {
    message: `a path glob may carry at most ${ACTION_POLICY_PATH_GLOB_STAR_MAX} "*" ("**" counts two)`,
  });

const commandPattern = nonBlank('command pattern').refine(
  (p) =>
    p
      .trim()
      .split(/\s+/)
      .every((t) => starCount(t) <= ACTION_POLICY_COMMAND_TOKEN_STAR_MAX),
  {
    message: `each command-pattern token may carry at most ${ACTION_POLICY_COMMAND_TOKEN_STAR_MAX} "*" ("**" counts two)`,
  },
);

export const ActionKindSchema = z.enum(ACTION_KINDS);

export const ActionPolicyEnvironmentSchema = z
  .object({
    name: slug('environment name').refine((n) => n !== ACTION_POLICY_ANY_ENVIRONMENT, {
      message: `environment name "${ACTION_POLICY_ANY_ENVIRONMENT}" is reserved for rows that apply on every branch`,
    }),
    branches: z
      .array(nonBlank('branch glob'))
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

/** One shell statement: its tokens and its raw text. */
interface Statement {
  tokens: string[];
  raw: string;
}

/** How deep substitution bodies are read (`$( $( … ) )`), the shield's own bound. */
const SUBSTITUTION_DEPTH_MAX = 4;

/** Executable suffixes stripped from a program token before it is compared. */
const PROGRAM_SUFFIXES: readonly string[] = ['.exe', '.cmd'];

/** Shells that run a string given with `-c` (in any short-option cluster). */
const POSIX_SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash']);

/** PowerShell hosts and the flags that hand them a string to run. */
const POWERSHELL_HOSTS: ReadonlySet<string> = new Set(['pwsh', 'powershell']);
const POWERSHELL_STRING_FLAG_RE = /^-(?:c|command|e|ec|encodedcommand)$/i;

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

/** One token against one pattern token; a long token meets a wildcard by its head. */
function tokenMatches(token: string, glob: string): boolean {
  const subject =
    hasWildcard(glob) && token.length > ACTION_POLICY_WILDCARD_TOKEN_MAX
      ? token.slice(0, ACTION_POLICY_WILDCARD_TOKEN_MAX)
      : token;
  return matchesPathGlob(subject, glob);
}

/**
 * The program token against the pattern's first token, through the shield's
 * program spellings: the token itself or its name after the last `/`
 * (case-sensitive), or, for a `.exe` / `.cmd` spelling, its lower-cased stem
 * after the last `/` or backslash against the lower-cased pattern token.
 */
function programMatches(token: string, glob: string): boolean {
  const names = programSpellings(token, { suffixes: PROGRAM_SUFFIXES });
  return (
    names.exact.some((n) => tokenMatches(n, glob)) ||
    names.folded.some((n) => tokenMatches(n, glob.toLowerCase()))
  );
}

/**
 * Whether a statement's program and the arguments after it match every token
 * of `pattern`, in order. The program position is the shield's: past
 * assignments, wrappers (`env`, `sudo`, `time`, `nohup`, `xargs` …) and the
 * reserved words that can stand before a program (`{`, `if`, `then`, `!` …).
 */
function commandPatternMatches(tokens: readonly string[], pattern: string): boolean {
  const patternTokens = pattern.trim().split(/\s+/);
  const start = programStart(tokens);
  if (tokens.length - start < patternTokens.length) return false;
  return patternTokens.every((glob, i) =>
    i === 0
      ? programMatches(tokens[start] as string, glob)
      : tokenMatches(tokens[start + i] as string, glob),
  );
}

/**
 * Every statement the command runs, read as the shield reads them: heredoc
 * bodies blanked first (a body is text, never a statement), then each segment,
 * then the bodies of its `$( … )` substitutions and, for the Bash tool, the
 * backtick substitutions, recursively to the shield's depth bound. PowerShell's
 * backtick is its escape character, so no backtick body is read there.
 */
function commandStatements(command: string, powershell: boolean, depth = 0): Statement[] {
  const opts = { powershell };
  const blanked = blankHeredocBodies(command, findHeredocs(command, opts));
  const out: Statement[] = [];
  for (const seg of tokenizeShell(blanked, opts)) {
    if (seg.tokens.length > 0) out.push(seg);
    if (depth < SUBSTITUTION_DEPTH_MAX) {
      for (const body of substitutionBodies(seg.raw)) {
        out.push(...commandStatements(body, powershell, depth + 1));
      }
    }
  }
  if (!powershell && depth < SUBSTITUTION_DEPTH_MAX) {
    for (const body of backtickBodies(blanked)) {
      out.push(...commandStatements(body, powershell, depth + 1));
    }
  }
  return out;
}

/**
 * Whether the statement's program is a shell handed a string this gate does
 * not read: `sh|bash|zsh|dash -c …` (`-c` in any short-option cluster),
 * `pwsh|powershell -Command|-c|-EncodedCommand …`, `cmd /c|/k …`, or a shell
 * reading a heredoc or here-string on stdin.
 */
function isOpaqueShell(tokens: readonly string[]): boolean {
  const start = programStart(tokens);
  const program = tokens[start];
  if (program === undefined) return false;
  const names = programSpellings(program, { suffixes: PROGRAM_SUFFIXES });
  const all = [...names.exact, ...names.folded];
  const args = tokens.slice(start + 1);
  const readsHeredoc = args.some((a) => a.startsWith('<<'));
  if (all.some((n) => POSIX_SHELLS.has(n))) {
    return readsHeredoc || args.some((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
  }
  if (all.some((n) => POWERSHELL_HOSTS.has(n.toLowerCase()))) {
    return readsHeredoc || args.some((a) => POWERSHELL_STRING_FLAG_RE.test(a));
  }
  if (all.some((n) => n.toLowerCase() === 'cmd')) {
    return args.some((a) => /^\/[ck]$/i.test(a));
  }
  return false;
}

function matchPathRows(rows: readonly ActionPolicyRow[], relPath: string): RowMatch[] {
  const matches: RowMatch[] = [];
  for (const row of rows) {
    if ((row.scope.paths ?? []).some((glob) => matchesPathGlob(relPath, glob))) {
      matches.push({ row, matched: relPath });
    }
  }
  return matches;
}

function matchCommandRows(
  rows: readonly ActionPolicyRow[],
  statements: readonly Statement[],
): RowMatch[] {
  const matches: RowMatch[] = [];
  for (const row of rows) {
    const patterns = row.scope.commands ?? [];
    const hit = statements.find((s) => patterns.some((p) => commandPatternMatches(s.tokens, p)));
    if (hit) matches.push({ row, matched: bound(hit.raw.trim()) });
  }
  return matches;
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
    matches = matchPathRows(config.rows, rel);
  } else {
    scopeKind = 'command';
    const statements = commandStatements(parsed.command, parsed.tool === 'PowerShell');
    matches = matchCommandRows(config.rows, statements);
    if (config.rows.some((r) => (r.scope.commands?.length ?? 0) > 0)) {
      const hidden = statements.find((s) => isOpaqueShell(s.tokens));
      if (hidden) opaque = bound(hidden.raw.trim());
    }
  }

  // Environment: read only when a matched row names one.
  const envMatches = matches.filter((m) => m.row.environment !== ACTION_POLICY_ANY_ENVIRONMENT);
  let candidates = matches.filter((m) => m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT);
  let currentEnvironments: string[] | null = null;
  let skipped: RowMatch[] = [];
  let environmentWhy = '';
  if (envMatches.length > 0) {
    const env = deriveEnvironments(config, root, context);
    if (env.ok) {
      currentEnvironments = env.names;
      candidates = matches.filter(
        (m) =>
          m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT ||
          env.names.includes(m.row.environment),
      );
    } else {
      skipped = envMatches;
      environmentWhy = env.why;
    }
  }
  const skippedDetail =
    skipped.length > 0 ? { skippedForEnvironment: skipped.map((m) => m.row.id) } : {};
  const skippedDeny = skipped.some((m) => m.row.disposition === 'deny');

  const decide = (): Decision => {
    const winner = mostSevere(candidates);
    // A shell string the gate does not read warns, unless a row at warn or
    // deny already speaks for the call.
    if (opaque !== null && (winner === undefined || winner.row.disposition === 'display')) {
      return {
        verdict: {
          disposition: 'warn',
          reason:
            'This command hands a shell a string (sh -c, pwsh -Command, cmd /c, or a heredoc on stdin); the action-policy gate does not read a shell string, so rows cannot judge what it runs.',
          provenance: {
            source,
            ref: REF_OPAQUE_SHELL_STRING,
            matched: opaque,
            checkedAt,
            detail: {
              scopeKind,
              currentEnvironments,
              alsoMatched: candidates.map((m) => m.row.id),
              ...skippedDetail,
            },
          },
        },
      };
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

    const overridable =
      policyDisposition === 'deny' &&
      !skippedDeny &&
      denyMatches.length > 0 &&
      denyMatches.every((m) => named.has(m.row.id));
    if (overridable) {
      const ids = denyMatches.map((m) => m.row.id);
      return {
        verdict: {
          disposition: 'allow',
          reason: `Allowed by ${ACTION_POLICY_OVERRIDE_ENV} (audited). Would have denied: ${reason}`,
          provenance: {
            source,
            ref: row.id,
            matched: cited.matched,
            checkedAt,
            detail: { ...detail, overriddenBy: ACTION_POLICY_OVERRIDE_ENV, overriddenRows: ids },
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

  if (decision.notice !== undefined) {
    const write = context?.writeStderr ?? ((line: string): void => void process.stderr.write(line));
    write(decision.notice);
  }
  return decision.verdict;
};

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemConfigError, TotemError } from './errors.js';
import type {
  GateContext,
  GateDisposition,
  GateEvaluator,
  GateTier,
  GateVerdict,
} from './gate-types.js';
import { getGitBranch } from './sys/git.js';
import { matchesPathGlob } from './sys/glob.js';
import { MATCHED_FRAGMENT_MAX, tokenizeShell } from './transport-shield.js';

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
 * Disclosed limit of every command-text gate: a governed program invoked by
 * path, inside `sh -c`, through a script the agent wrote, or renamed does not
 * match its row and evaluates to `allow` with `no-policy-match`.
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

const slug = (what: string) => z.string().regex(SLUG_RE, `${what} must be a kebab-case slug`);

const nonBlank = (what: string) =>
  z.string().refine((s) => s.trim() !== '', { message: `${what} must be a non-blank string` });

export const ActionKindSchema = z.enum(ACTION_KINDS);

export const ActionPolicyEnvironmentSchema = z.object({
  name: slug('environment name').refine((n) => n !== ACTION_POLICY_ANY_ENVIRONMENT, {
    message: `environment name "${ACTION_POLICY_ANY_ENVIRONMENT}" is reserved for rows that apply on every branch`,
  }),
  branches: z
    .array(nonBlank('branch glob'))
    .min(1, 'an environment needs at least one branch glob'),
});

export const ActionPolicyScopeSchema = z
  .object({
    paths: z.array(nonBlank('path glob')).optional(),
    commands: z.array(nonBlank('command pattern')).optional(),
  })
  .refine((s) => (s.paths?.length ?? 0) > 0 || (s.commands?.length ?? 0) > 0, {
    message: 'scope needs at least one non-empty "paths" or "commands" list',
  });

export const ActionPolicyDispositionSchema = z.enum(['display', 'warn', 'deny']);

export const ActionPolicyRowSchema = z.object({
  id: slug('row id'),
  action_kind: ActionKindSchema,
  scope: ActionPolicyScopeSchema,
  environment: z.string().min(1).default(ACTION_POLICY_ANY_ENVIRONMENT),
  disposition: ActionPolicyDispositionSchema,
  reason: z.string().optional(),
});

export const ActionPolicyConfigSchema = z
  .object({
    version: z.literal(ACTION_POLICY_VERSION),
    _note: z.string().optional(),
    environments: z.array(ActionPolicyEnvironmentSchema).optional(),
    rows: z.array(ActionPolicyRowSchema),
  })
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

const bound = (text: string): string => text.slice(0, MATCHED_FRAGMENT_MAX);

/**
 * Repo-relative, `/`-separated form of `filePath`, or null when the path lies
 * outside the config root.
 */
function repoRelativePath(filePath: string, configRoot: string): string | null {
  const slashed = filePath.replace(/\\/g, '/');
  const rel = path.isAbsolute(slashed)
    ? path.relative(configRoot, slashed).replace(/\\/g, '/')
    : path.posix.normalize(slashed);
  if (rel === '' || rel === '.' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    return null;
  }
  return rel;
}

/** Whether a statement's leading tokens match every token of `pattern`, in order. */
function commandPatternMatches(statementTokens: readonly string[], pattern: string): boolean {
  const patternTokens = pattern.trim().split(/\s+/);
  if (statementTokens.length < patternTokens.length) return false;
  return patternTokens.every((glob, i) => matchesPathGlob(statementTokens[i] as string, glob));
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
  command: string,
  powershell: boolean,
): RowMatch[] {
  const statements = tokenizeShell(command, { powershell }).filter((s) => s.tokens.length > 0);
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

/** Outcome of deriving the current environment: its name, or unevaluable. */
type EnvironmentRead = { ok: true; name: string } | { ok: false; why: string };

function deriveEnvironment(
  config: ActionPolicyConfig,
  configRoot: string,
  context: GateContext | undefined,
): EnvironmentRead {
  const reader = context?.gitBranchReader ?? getGitBranch;
  let branch: string;
  try {
    branch = reader(configRoot).trim();
    // totem-context: fail-closed conversion, not a swallow: a thrown branch read becomes the unevaluable verdict (deny under strict, warn under pilot, never allow) carrying the read's message
  } catch (err) {
    return {
      ok: false,
      why: err instanceof Error ? err.message : 'the branch reader threw a non-Error value',
    };
  }
  if (branch === '') return { ok: false, why: 'the current branch name is empty' };
  if (branch === GIT_BRANCH_UNKNOWN_SENTINEL) {
    return { ok: false, why: 'git could not read the current branch' };
  }
  const env = (config.environments ?? []).find((e) =>
    e.branches.some((glob) => matchesPathGlob(branch, glob)),
  );
  return { ok: true, name: env ? env.name : ACTION_POLICY_ANY_ENVIRONMENT };
}

// ─── Evaluator ─────────────────────────────────────────────────────────────

function unevaluableDisposition(tier: GateTier | undefined): GateDisposition {
  return tier === 'pilot' ? 'warn' : 'deny';
}

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

/**
 * action-policy: classify the action against the policy rows and return the
 * most severe matching row's verdict. Synchronous; reads the policy file and,
 * only when a scope-matched row names an environment, the current branch.
 * Writes no file; prints one stderr line through the context writer when the
 * override env var turns a named row's `deny` into `allow`.
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

  const configRoot = path.dirname(path.resolve(totemDir));
  let scopeKind: 'path' | 'command';
  let matches: RowMatch[];
  if ('path' in parsed) {
    scopeKind = 'path';
    const rel = repoRelativePath(parsed.path, configRoot);
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
    matches = matchCommandRows(config.rows, parsed.command, parsed.tool === 'PowerShell');
  }

  const anyRowMatches = matches.filter((m) => m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT);
  const needsEnvironment = matches.length !== anyRowMatches.length;

  let candidates: RowMatch[] = anyRowMatches;
  let currentEnvironment: string | null = null;
  if (needsEnvironment) {
    const env = deriveEnvironment(config, configRoot, context);
    if (!env.ok) {
      const anyWinner = mostSevere(anyRowMatches);
      if (anyWinner?.row.disposition === 'deny') {
        candidates = anyRowMatches;
      } else {
        const disposition = unevaluableDisposition(context?.tier);
        const envRows = matches
          .filter((m) => m.row.environment !== ACTION_POLICY_ANY_ENVIRONMENT)
          .map((m) => m.row.id);
        return {
          disposition,
          reason: `The current environment could not be derived (${env.why}) while row(s) ${envRows.join(', ')} name an environment (tier=${context?.tier ?? 'strict'} → ${disposition}).`,
          provenance: {
            source,
            ref: REF_ENVIRONMENT_UNEVALUABLE,
            matched: null,
            checkedAt,
            detail: { scopeKind, alsoMatched: matches.map((m) => m.row.id) },
          },
        };
      }
    } else {
      currentEnvironment = env.name;
      candidates = matches.filter(
        (m) =>
          m.row.environment === ACTION_POLICY_ANY_ENVIRONMENT || m.row.environment === env.name,
      );
    }
  }

  const winner = mostSevere(candidates);
  if (!winner) {
    return {
      disposition: 'allow',
      reason: 'No action-policy row governs this action.',
      provenance: { source, ref: REF_NO_POLICY_MATCH, matched: null, checkedAt },
    };
  }

  const { row } = winner;
  const policyDisposition = row.disposition;
  const reason = `${row.action_kind} (${policyDisposition}): ${row.reason ?? `governed by row ${row.id}`}`;
  const detail: Record<string, unknown> = {
    actionKind: row.action_kind,
    policyDisposition,
    environment: row.environment,
    currentEnvironment,
    scopeKind,
    alsoMatched: candidates.filter((m) => m !== winner).map((m) => m.row.id),
  };

  if (policyDisposition === 'deny' && overriddenRowIds(context).has(row.id)) {
    const write = context?.writeStderr ?? ((line: string): void => void process.stderr.write(line));
    write(
      `${ACTION_POLICY_NOTICE_PREFIX} OVERRIDE (${ACTION_POLICY_OVERRIDE_ENV}): allowing ${scopeKind} "${winner.matched}"; row ${row.id} would have denied.\n`,
    );
    return {
      disposition: 'allow',
      reason: `Allowed by ${ACTION_POLICY_OVERRIDE_ENV} (audited). Would have denied: ${reason}`,
      provenance: {
        source,
        ref: row.id,
        matched: winner.matched,
        checkedAt,
        detail: { ...detail, overriddenBy: ACTION_POLICY_OVERRIDE_ENV },
      },
    };
  }

  return {
    disposition: policyDisposition === 'display' ? 'warn' : policyDisposition,
    reason,
    provenance: {
      source,
      ref: row.id,
      matched: winner.matched,
      checkedAt,
      detail,
    },
  };
};

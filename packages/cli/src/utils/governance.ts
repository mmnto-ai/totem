/**
 * Governance-artifact scaffolding utilities (mmnto/totem#1288).
 *
 * Shared helpers for the `totem proposal new` and `totem adr new` commands.
 * Nothing in this module carries module-level state — every helper takes
 * its context via arguments so the tests can exercise both the submodule
 * (`<totem>/.strategy/`) and the standalone (strategy-repo root) cases.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  resolveGitRoot,
  resolveStrategyRoot,
  safeExec,
  type StrategyResolverConfig,
  TotemError,
} from '@mmnto/totem';

import { log } from '../ui.js';

export type GovernanceType = 'proposal' | 'adr';

export interface ScaffoldOptions {
  type: GovernanceType;
  title: string;
  cwd: string;
  /**
   * Loaded `TotemConfig` (or any object with a `strategyRoot?: string` field).
   * Forwarded to the strategy-root resolver so `TotemConfig.strategyRoot`
   * wins precedence-2 over the sibling / submodule layers (mmnto-ai/totem#1710).
   */
  config?: StrategyResolverConfig;
}

export interface GovernancePaths {
  /** Directory that anchors the governance layout (strategy repo root or submodule root). */
  rootDir: string;
  /** Directory that holds the NNN-prefixed artifact files. */
  targetDir: string;
  /** On-disk template path. May not exist; caller falls back to the hardcoded default. */
  templatePath: string;
  /** Dashboard README refreshed by `docs:inject`. */
  dashboardFile: string;
}

/**
 * Best-effort `TotemConfig` load for the governance commands. Returns
 * `undefined` when the config is missing, unparseable, OR resolves to the
 * global `~/.totem/` profile — both missing and unparseable are legitimate
 * states for a freshly-cloned consumer repo, and a global-profile config
 * is intentionally NOT used as a repo-local `strategyRoot` source (that
 * would let one user's personal pointer leak across every repo on disk).
 * The strategy-root resolver still has env / sibling / submodule layers
 * to fall back on (mmnto-ai/totem#1710 R3 — CR R3 global-config-leak fix).
 *
 * Shared by `proposalNewCommand` and `adrNewCommand` so the load idiom +
 * its `// totem-context: intentional best-effort` annotation live in one
 * place (mmnto-ai/totem#1710 R2).
 */
export async function loadGovernanceConfig(
  cwd: string,
): Promise<StrategyResolverConfig | undefined> {
  try {
    const { loadConfig, resolveConfigPath, isGlobalConfigPath } = await import('../utils.js');
    const configPath = resolveConfigPath(cwd);
    if (isGlobalConfigPath(configPath)) return undefined;
    const config = (await loadConfig(configPath)) as StrategyResolverConfig;
    return config;
    // totem-context: intentional best-effort load — missing/unparseable config is a legitimate state for a freshly-cloned consumer repo; resolver's other layers (env / sibling / submodule) still apply.
  } catch {
    return undefined;
  }
}

function targetSubpath(type: GovernanceType): string {
  return type === 'proposal' ? path.join('proposals', 'active') : 'adr';
}

function templateFilename(type: GovernanceType): string {
  return type === 'proposal' ? 'proposal.md' : 'adr.md';
}

/**
 * Resolve governance paths for the current invocation.
 *
 * Two layout shapes supported:
 *
 * 1. **Standalone (cwd IS the strategy repo)** — `<gitRoot>` itself contains
 *    `proposals/` or `adr/` at the top level. Used when the CLI runs from
 *    inside the strategy repo directly. Detected here in the helper before
 *    delegating to the resolver because the strategy-root resolver answers
 *    "where IS the strategy repo from somewhere else", not "are we INSIDE
 *    one already."
 *
 * 2. **Resolved (cwd is in a consuming repo)** — defer to
 *    `resolveStrategyRoot` (mmnto-ai/totem#1710). The resolver walks env →
 *    config → sibling → submodule precedence and returns an absolute path.
 *    Throws an actionable `TotemError` (ADR-088) when none of the layers
 *    resolve.
 *
 * Also throws `TotemError` when cwd is not inside a git repo.
 */
export function resolveGovernancePaths(
  cwd: string,
  type: GovernanceType,
  config?: StrategyResolverConfig,
): GovernancePaths {
  const gitRoot = resolveGitRoot(cwd);
  if (gitRoot === null) {
    throw new TotemError(
      'CONFIG_MISSING',
      `Not inside a git repository: ${cwd}`,
      'Run this command from inside a Totem or Totem-strategy repository checkout.',
    );
  }

  // Standalone detection requires BOTH the type-specific target subdir AND
  // a `templates/` folder at the repo root. The conjunction catches the
  // canonical strategy-repo layout (proposals/active/ + adr/ + templates/)
  // while avoiding false positives on consumer repos that happen to ship a
  // top-level `adr/` docs folder without a strategy substrate.
  const standaloneHasTarget = fs.existsSync(path.join(gitRoot, targetSubpath(type)));
  const standaloneHasTemplates = fs.existsSync(path.join(gitRoot, 'templates'));

  let rootDir: string;
  if (standaloneHasTarget && standaloneHasTemplates) {
    rootDir = gitRoot;
  } else {
    const status = resolveStrategyRoot(cwd, { gitRoot, config });
    if (!status.resolved) {
      throw new TotemError(
        'CONFIG_MISSING',
        `No Totem-strategy layout found from ${cwd}.`,
        `Clone the strategy repo as a sibling (e.g., \`git clone <strategy-url> ${path.join(path.dirname(gitRoot), 'totem-strategy')}\`), set the TOTEM_STRATEGY_ROOT env var, or initialize the legacy \`.strategy/\` submodule. Resolver detail: ${status.reason}`,
      );
    }
    rootDir = status.path;
  }

  const targetDir = path.join(rootDir, targetSubpath(type));
  const templatePath = path.join(rootDir, 'templates', templateFilename(type));
  const dashboardFile = path.join(rootDir, 'README.md');

  return {
    rootDir: path.normalize(rootDir),
    targetDir: path.normalize(targetDir),
    templatePath: path.normalize(templatePath),
    dashboardFile: path.normalize(dashboardFile),
  };
}

// ─── Auto-increment + filename sanitization ─────────────

const ARTIFACT_FILENAME_RE = /^(\d{3})-(.+)\.md$/;
const MAX_ARTIFACT_ID = 999;

/**
 * Scan `targetDir` for `NNN-slug.md` files, parse the prefix to an int,
 * and return `(max + 1)` zero-padded to three digits.
 *
 * Returns `'001'` when the directory is missing or contains no matching
 * files. Files that do not match `^(\d{3})-(.+)\.md$` are ignored so
 * README.md or non-padded prefixes (e.g. `42-x.md`) do not pollute the
 * count. Throws `TotemError` when the next id would exceed 999.
 */
export function getNextArtifactId(targetDir: string): string {
  if (!fs.existsSync(targetDir)) {
    return '001';
  }

  let highest = 0;
  const entries = fs.readdirSync(targetDir);
  for (const entry of entries) {
    const match = ARTIFACT_FILENAME_RE.exec(entry);
    if (!match) continue;
    const parsed = parseInt(match[1]!, 10);
    if (Number.isFinite(parsed) && parsed > highest) {
      highest = parsed;
    }
  }

  const next = highest + 1;
  if (next > MAX_ARTIFACT_ID) {
    throw new TotemError(
      'CONFIG_INVALID',
      `NNN-prefix format saturated at ${targetDir} (highest id is ${highest}).`,
      'Archive older artifacts or extend the numbering scheme before adding more.',
    );
  }

  return String(next).padStart(3, '0');
}

/**
 * Build the final artifact filename from a numeric id and a raw title.
 *
 * Sanitization: lowercase, any non-alphanumeric run becomes a single hyphen,
 * leading/trailing hyphens are stripped. Throws `TotemError` when the
 * sanitized slug is empty — the error fires BEFORE any filesystem write so
 * the caller never strands a half-written artifact.
 */
export function formatArtifactFilename(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Title "${title}" produces an empty slug.`,
      'Titles must contain at least one alphanumeric character.',
    );
  }

  return `${id}-${slug}.md`;
}

/**
 * Sanitize a raw title for safe inclusion in the scaffolded markdown body.
 *
 * Strips C0 control characters and `DEL` (0x00-0x1F, 0x7F) — most notably
 * newlines, carriage returns, and tabs — then collapses any remaining run
 * of whitespace to a single space and trims the edges. Without this pass,
 * a title like `Fix\n## Fake Heading` would inject a fresh markdown block
 * into the scaffolded artifact, shifting document structure out of the
 * scaffolder's control. The `#` character itself is allowed through on
 * purpose: a single-line heading that contains `#` characters stays a
 * single h1 heading in markdown.
 */
export function sanitizeArtifactTitle(title: string): string {
  return (
    title
      // eslint-disable-next-line no-control-regex -- intentional: strip ASCII C0 controls + DEL
      .replace(/[\x00-\x1F\x7F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ─── Template engine ────────────────────────────────────

/**
 * Default proposal template. Exported so tests and callers can inspect the
 * baseline shape without re-deriving it. Uses ADR-091's exact heading form
 * (`# Proposal NNN: Title` with a SPACE separator, not a hyphen). Keep in
 * sync with `DEFAULT_ADR_TEMPLATE` below.
 */
export const DEFAULT_PROPOSAL_TEMPLATE = `# Proposal {{ID}}: {{TITLE}}

**Status:** Draft
**Date:** {{DATE}}

## Problem Statement

_Describe the problem this proposal addresses._

## Proposal

_Describe the proposed change._

## Alternatives Considered

_List alternatives and why they were rejected._

## Impact

_Who / what does this affect?_
`;

/**
 * Default ADR template. Mirrors `DEFAULT_PROPOSAL_TEMPLATE` but with the
 * `# ADR NNN: Title` heading form required by ADR-091.
 */
export const DEFAULT_ADR_TEMPLATE = `# ADR {{ID}}: {{TITLE}}

**Status:** Draft
**Date:** {{DATE}}

## Context

_Describe the architectural context and forces at play._

## Decision

_State the decision._

## Consequences

_List the consequences. Note what improves and what regresses._
`;

export interface RenderTemplateOptions {
  type: GovernanceType;
  id: string;
  title: string;
  templatePath: string;
  date: string;
}

/**
 * Render the artifact template with variable substitution.
 *
 * If `templatePath` exists on disk, its contents are used; otherwise the
 * hardcoded `DEFAULT_PROPOSAL_TEMPLATE` / `DEFAULT_ADR_TEMPLATE` string is
 * used. Substitutes `{{TITLE}}`, `{{DATE}}`, and `{{ID}}` globally.
 *
 * MVP variable set per spec #1288: only `{{TITLE}}` and `{{DATE}}` are
 * user-facing; `{{ID}}` is internal to the default templates so the NNN
 * number lands in the heading without the caller having to splice it.
 */
export function renderArtifactTemplate(opts: RenderTemplateOptions): string {
  const { type, id, title, templatePath, date } = opts;

  let template: string;
  if (fs.existsSync(templatePath)) {
    template = fs.readFileSync(templatePath, 'utf-8');
  } else {
    template = type === 'proposal' ? DEFAULT_PROPOSAL_TEMPLATE : DEFAULT_ADR_TEMPLATE;
  }

  // Single-pass regex + keyed replacer function. Two reasons:
  //   1. Sequential `.replace()` calls allow template injection (a title of
  //      `{{DATE}}` would be substituted into the template and then picked
  //      up by the next pass as an actual DATE token). One pass eliminates
  //      that class of bug.
  //   2. The replacer-function form avoids `$&` / `$1` back-reference
  //      interpretation in the replacement string (see PR #1429 review
  //      cycle). A title like `Fix $foo bug` mis-renders otherwise.
  const replacements: Record<string, string> = { TITLE: title, DATE: date, ID: id };
  return template.replace(/\{\{(TITLE|DATE|ID)\}\}/g, (_match, key) => replacements[key]!);
}

// ─── Post-scaffold hooks ────────────────────────────────

/**
 * Thin injection seam so tests can verify exact argv without spawning a
 * real subprocess. Production callers omit the `exec` field and we default
 * to `safeExec`.
 */
export type ExecFn = (cmd: string, args: string[], cwd?: string) => void;

export interface PostScaffoldHookOptions {
  rootDir: string;
  newFilePath: string;
  dashboardFile: string;
  /** Override the exec function (test seam). Defaults to `safeExec`. */
  exec?: ExecFn;
}

export interface PostScaffoldHookResult {
  /** True if `pnpm run docs:inject` exited 0. False when the script is missing or failed. */
  dashboardRefreshed: boolean;
  /** True if `git add` staged the two paths. False if git returned non-zero. */
  staged: boolean;
}

const defaultExec: ExecFn = (cmd, args, cwd) => {
  safeExec(cmd, args, { cwd });
};

/**
 * Run the two post-scaffold side-effects in sequence:
 *
 * 1. `pnpm run docs:inject` (refresh the dashboard index). On non-zero exit
 *    or missing script, warn to stderr and continue — the scaffolded file
 *    already exists on disk, so a dashboard refresh failure should not
 *    strand the artifact.
 * 2. `git add <newFilePath> <dashboardFile>`. Stages ONLY those two paths;
 *    never `-A` or `.` (per lesson-8067935e / lesson-4a01b498). On failure,
 *    warn and return `staged: false` so the caller can surface the stage
 *    state in its user-facing summary.
 *
 * Neither step throws; both failures degrade gracefully so the user always
 * walks away with the new artifact on disk.
 */
export function runPostScaffoldHooks(opts: PostScaffoldHookOptions): PostScaffoldHookResult {
  const { rootDir, newFilePath, dashboardFile, exec = defaultExec } = opts;

  let dashboardRefreshed = false;
  try {
    exec('pnpm', ['run', 'docs:inject'], rootDir);
    dashboardRefreshed = true; // totem-context: intentional warn-and-continue per spec 1288 — dashboard refresh failure must not strand the scaffolded artifact on disk.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      'Totem',
      `docs:inject did not run cleanly (${msg}). Dashboard not refreshed; run 'pnpm run docs:inject' manually.`,
    );
  }

  let staged = false;
  try {
    exec('git', ['add', newFilePath, dashboardFile], rootDir);
    staged = true; // totem-context: intentional warn-and-continue per spec 1288 — git add failure must not strand the scaffolded artifact on disk.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      'Totem',
      `git add failed (${msg}). File created but not staged; run 'git add' manually.`,
    );
  }

  return { dashboardRefreshed, staged };
}

// ─── Orchestrator ───────────────────────────────────────

export interface ScaffoldArtifactResult {
  /** Zero-padded NNN id chosen for the artifact. */
  id: string;
  /** Basename of the new file (`NNN-kebab-title.md`). */
  filename: string;
  /** Absolute path the file was written to. */
  filePath: string;
  /** Absolute path to the dashboard README that `docs:inject` refreshes. */
  dashboardFile: string;
  /** True if `pnpm run docs:inject` succeeded. */
  dashboardRefreshed: boolean;
  /** True if `git add` staged the two paths. */
  staged: boolean;
}

export interface ScaffoldArtifactInternals {
  /** Override the exec function (test seam). Defaults to `safeExec`. */
  exec?: ExecFn;
  /** Override the date string (test seam). Defaults to today in `YYYY-MM-DD`. */
  date?: string;
  /**
   * Force a specific NNN id instead of calling `getNextArtifactId`. Test-only
   * seam for deterministic collision scenarios; production callers must not
   * pass this (the auto-increment is the spec behavior).
   */
  forceId?: string;
}

function todayIso(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Full scaffolding pipeline, invoked by both `totem proposal new` and
 * `totem adr new`:
 *
 *   resolve paths → compute id → sanitize filename → render template →
 *   collision guard → write file → run docs:inject + git add
 *
 * Pre-disk validation (path resolution, id computation, slug sanitization,
 * collision check) happens BEFORE the filesystem is touched so a bad input
 * never strands a half-written artifact.
 */
export function scaffoldGovernanceArtifact(
  options: ScaffoldOptions,
  internals: ScaffoldArtifactInternals = {},
): ScaffoldArtifactResult {
  const paths = resolveGovernancePaths(options.cwd, options.type, options.config);

  // Sanitize once at the orchestrator entry. Both the filename slug and the
  // template body render against the cleaned form so a title carrying
  // newlines, tabs, or control characters cannot inject markdown blocks
  // into the scaffolded artifact.
  const cleanTitle = sanitizeArtifactTitle(options.title);

  const id = internals.forceId ?? getNextArtifactId(paths.targetDir);
  const filename = formatArtifactFilename(id, cleanTitle);
  const filePath = path.join(paths.targetDir, filename);

  // Collision pre-check gives a clean user-facing error on the common path.
  // The authoritative collision guard is the `flag: 'wx'` on `writeFileSync`
  // below, which closes the TOCTOU race between the pre-check and the write
  // (a concurrent scaffolder could slip in between the two). Keeping both
  // gives a nice error when the file already exists AND safety against the
  // narrow race window.
  if (fs.existsSync(filePath)) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Artifact already exists at ${filePath}.`,
      'Choose a different title, or remove the existing file before re-scaffolding.',
    );
  }

  const date = internals.date ?? todayIso();
  const rendered = renderArtifactTemplate({
    type: options.type,
    id,
    title: cleanTitle,
    templatePath: paths.templatePath,
    date,
  });

  // Ensure parent dir exists (it should, from resolveGovernancePaths, but
  // cheap to defend against a manually-pruned target).
  fs.mkdirSync(paths.targetDir, { recursive: true });
  try {
    // `flag: 'wx'` = write exclusive. Atomic fail with EEXIST if the file
    // was created between the pre-check and now. Closes the TOCTOU race.
    fs.writeFileSync(filePath, rendered, { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TotemError(
        'CONFIG_INVALID',
        `Artifact already exists at ${filePath}.`,
        'A concurrent scaffolder created this file between the pre-check and the write. Re-run the command to pick up a fresh NNN.',
      );
    }
    throw err;
  }

  const hookResult = runPostScaffoldHooks({
    rootDir: paths.rootDir,
    newFilePath: filePath,
    dashboardFile: paths.dashboardFile,
    exec: internals.exec,
  });

  return {
    id,
    filename,
    filePath,
    dashboardFile: paths.dashboardFile,
    dashboardRefreshed: hookResult.dashboardRefreshed,
    staged: hookResult.staged,
  };
}

import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Eject';
const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
const TOTEM_HOOK_END = '[totem] end post-merge';
const TOTEM_CHECKOUT_MARKER = '[totem] post-checkout hook';
const TOTEM_CHECKOUT_END = '[totem] end post-checkout';
const TOTEM_FILE_MARKER = '// [totem] auto-generated';

/** Files that may have AI reflex blocks appended by `totem init`. */
const REFLEX_FILES = ['CLAUDE.md', '.cursorrules'];

/** Files scaffolded by `totem init` that are fully owned by Totem. */
const TOTEM_SCAFFOLDED_FILES = [
  '.gemini/hooks/SessionStart.js',
  // BeforeTool ships as `.cjs` (codex round-2 4a); the legacy `.js` is kept in the
  // roster so eject also cleans up a pre-migration artifact.
  '.gemini/hooks/BeforeTool.cjs',
  '.gemini/hooks/BeforeTool.js',
  '.gemini/skills/totem.md',
  '.totem/hooks/shield-gate.cjs',
  // Phase B PreWriteShield (mmnto-ai/totem#1853, eject parity closing
  // mmnto-ai/totem#1852).
  '.claude/hooks/PreWriteShield.cjs',
  // Phase C slice 1 SessionStart (mmnto-ai/totem#1845).
  '.claude/hooks/SessionStart.cjs',
  // PR-C action-gate wrapper (mmnto-ai/totem#2048, eject parity).
  '.claude/hooks/gate-wrapper.cjs',
];

// ─── Helpers ────────────────────────────────────────────

export interface EjectSummary {
  removed: string[];
  scrubbed: string[];
  skipped: string[];
}

/**
 * Resolved git-hook context for eject (mmnto-ai/totem#2426).
 *
 * `.git` is a DIRECTORY in a plain checkout / main working tree and a POINTER
 * FILE in a linked worktree (or submodule), where the hooks git actually runs
 * live in the SHARED common dir — so a blind `.git/hooks` join from `cwd` (the
 * pre-fix behavior) silently no-oped in a worktree AND missed the git root when
 * eject was run from a subdirectory.
 */
export interface EjectHooksContext {
  /**
   * The resolved git hooks directory (via the #2422 `resolveHooksDir` helper —
   * worktree/`commondir`/`core.hooksPath`-aware), or `null` when no repo/hooks
   * dir could be resolved (not-a-repo, unparseable `.git` pointer).
   */
  hooksDir: string | null;
  /**
   * `.git` is a POINTER FILE — a linked worktree (or submodule) whose resolved
   * hooks dir is SHARED across every worktree of the repo.
   */
  isLinkedWorktree: boolean;
}

/**
 * Resolve where eject should look for git hooks, reusing the SAME helpers every
 * `hook install` entry point uses (mmnto-ai/totem#2426, sibling of #2422): the
 * git root via `resolveGitRootForHookPath` (anchors from a subdirectory; maps an
 * unparseable pointer to a null root) and the hooks dir via `resolveHooksDir`
 * (git's own worktree/`commondir` walk — the rev-parse root resolution the
 * hardcode-`.git/hooks` lesson prescribes). Best-effort per Tenet 4's eject
 * cleanup carve-out — a genuine git failure is reported as unresolvable, never a
 * crash of the whole eject.
 */
export async function resolveEjectHooksContext(cwd: string): Promise<EjectHooksContext> {
  // Lazy-load the hook-path resolvers: they pull the core git barrel, so keeping
  // them off the static graph preserves this command file's cold-start discipline
  // (the same dynamic-import pattern `scrubClaudeSkills`/`ejectCommand` use).
  const { resolveGitRootForHookPath, resolveHooksDir } = await import('./install-hooks.js');
  let gitRoot: string | null;
  try {
    ({ gitRoot } = resolveGitRootForHookPath(cwd));
    // Eject is best-effort per Tenet 4's cleanup carve-out: a genuine git failure
    // (NOT not-a-repo / unparseable pointer, which return a null root WITHOUT
    // throwing) degrades to "unresolvable" rather than crashing the whole eject.
    // totem-context: intentional cleanup — best-effort git resolution for eject.
  } catch {
    return { hooksDir: null, isLinkedWorktree: false };
  }
  if (!gitRoot) {
    return { hooksDir: null, isLinkedWorktree: false };
  }
  // Worktree detection: git resolved the root, so the root itself is trusted;
  // `.git` here is only probed for its SHAPE — a pointer FILE marks a linked
  // worktree whose hooks are shared — not used to locate the root (that came
  // from rev-parse above).
  const dotGit = path.join(gitRoot, '.git');
  const isLinkedWorktree = fs.existsSync(dotGit) && fs.statSync(dotGit).isFile();
  return { hooksDir: resolveHooksDir(gitRoot), isLinkedWorktree };
}

/**
 * Generic hook scrubber — removes Totem block from a git hook file.
 * Uses deterministic end marker when present, falls back to heuristic for old format.
 * `hooksDir` is the RESOLVED git hooks directory (mmnto-ai/totem#2426), not a
 * blind `<cwd>/.git/hooks` join.
 */
function scrubHook(
  hooksDir: string,
  summary: EjectSummary,
  hookName: string,
  startMarker: string,
  endMarker: string,
): void {
  const hookFileName = `.git/hooks/${hookName}`;
  const hookPath = path.join(hooksDir, hookName);
  if (!fs.existsSync(hookPath)) {
    summary.skipped.push(`${hookFileName} (not found)`);
    return;
  }

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(startMarker)) {
    summary.skipped.push(`${hookFileName} (no Totem section)`);
    return;
  }

  const endSentinel = `# ${endMarker}`;
  const hasEndMarker = content.includes(endSentinel);
  const lines = content.split('\n');
  const filtered: string[] = [];
  let inTotemBlock = false;

  for (const line of lines) {
    if (line.includes(startMarker)) {
      inTotemBlock = true;
      continue;
    }
    if (inTotemBlock) {
      if (hasEndMarker) {
        // New format: skip everything until exact end sentinel line
        if (line.trim() === endSentinel) {
          inTotemBlock = false;
        }
        continue;
      }
      // Old format (no end marker): skip known totem lines only
      if (
        line === '' ||
        line.trim() === '' ||
        line.startsWith('echo "[totem]') ||
        line.startsWith('(')
      ) {
        continue;
      }
      // Unrecognised line — stop skipping to protect user content
      inTotemBlock = false;
    }
    filtered.push(line);
  }

  const remaining = filtered.join('\n').trim();

  try {
    if (!remaining || remaining === '#!/bin/sh') {
      fs.unlinkSync(hookPath);
      summary.removed.push(hookFileName);
    } else {
      fs.writeFileSync(hookPath, remaining + '\n', 'utf-8');
      summary.scrubbed.push(hookFileName);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.skipped.push(`${hookFileName} (${msg})`);
  }
}

/**
 * Remove the Totem section from the post-merge git hook.
 * Deletes the file entirely if it only contains the Totem hook.
 * `hooksDir` is the resolved git hooks directory (mmnto-ai/totem#2426).
 */
export function scrubPostMergeHook(hooksDir: string, summary: EjectSummary): void {
  scrubHook(hooksDir, summary, 'post-merge', TOTEM_HOOK_MARKER, TOTEM_HOOK_END);
}

/**
 * Remove the Totem section from the post-checkout git hook.
 * Deletes the file entirely if it only contains the Totem hook.
 * `hooksDir` is the resolved git hooks directory (mmnto-ai/totem#2426).
 */
export function scrubPostCheckoutHook(hooksDir: string, summary: EjectSummary): void {
  scrubHook(hooksDir, summary, 'post-checkout', TOTEM_CHECKOUT_MARKER, TOTEM_CHECKOUT_END);
}

/**
 * Remove scaffolded files that are fully owned by Totem.
 * Only removes files that contain the Totem marker to avoid deleting user files.
 */
function removeScaffoldedFiles(cwd: string, summary: EjectSummary): void {
  for (const rel of TOTEM_SCAFFOLDED_FILES) {
    const filePath = path.join(cwd, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes(TOTEM_FILE_MARKER) || content.includes('[totem] auto-generated')) {
      fs.unlinkSync(filePath);
      summary.removed.push(rel);
    } else {
      summary.skipped.push(`${rel} (no Totem marker)`);
    }
  }
}

/**
 * Remove the Totem PreToolUse hook entry from Claude's settings.local.json.
 */
function scrubClaudeSettings(cwd: string, summary: EjectSummary): void {
  const filePath = path.join(cwd, '.claude', 'settings.local.json');
  if (!fs.existsSync(filePath)) {
    summary.skipped.push('.claude/settings.local.json (not found)');
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    summary.skipped.push('.claude/settings.local.json (invalid JSON)');
    return;
  }

  const hooks = parsed.hooks as Record<string, unknown[]> | undefined;
  const preToolUse = hooks?.PreToolUse as
    | Array<{ matcher?: string; hooks?: Array<unknown> }>
    | undefined;
  if (!preToolUse) {
    summary.skipped.push('.claude/settings.local.json (no PreToolUse hooks)');
    return;
  }

  const filtered = preToolUse.filter((entry) => {
    if (entry.matcher !== 'Bash') return true;
    const entryHooks = entry.hooks ?? [];
    return !entryHooks.some((h) => {
      const cmd =
        typeof h === 'string'
          ? h
          : h && typeof h === 'object'
            ? ((h as { command?: string }).command ?? '')
            : '';
      return (
        cmd.includes('shield-gate') || cmd.includes('totem shield') || cmd.includes('totem review')
      );
    });
  });

  if (filtered.length === preToolUse.length) {
    summary.skipped.push('.claude/settings.local.json (no Totem hooks)');
    return;
  }

  hooks!.PreToolUse = filtered;
  if (filtered.length === 0) {
    delete hooks!.PreToolUse;
  }
  // Clean up empty hooks object
  if (Object.keys(hooks!).length === 0) {
    delete parsed.hooks;
  }

  if (Object.keys(parsed).length === 0) {
    fs.unlinkSync(filePath);
    summary.removed.push('.claude/settings.local.json');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    summary.scrubbed.push('.claude/settings.local.json');
  }
}

/**
 * Remove Totem-injected hook entries from the committed `.claude/settings.json`.
 * Targets both:
 *   - `hooks.PreToolUse` entries whose command references `PreWriteShield`
 *     (Phase B install — closes mmnto-ai/totem#1852, the eject parity gap
 *     left over from when Phase B added the install side).
 *   - `hooks.SessionStart` entries whose command references `SessionStart.cjs`
 *     (Phase C slice 1 install — mmnto-ai/totem#1845).
 *   - `hooks.PreToolUse` Write|Edit entries whose command references
 *     `gate-wrapper.cjs` (PR-C action-gate install — mmnto-ai/totem#2048;
 *     one per installed gate). Parity with `gate install` / `init --gates=`.
 *
 * User-defined entries (other matchers, other commands) are preserved.
 * Empty arrays/objects/files are pruned bottom-up to leave a clean
 * filesystem state, matching the legacy scrubClaudeSettings cleanup chain.
 */
function scrubCommittedClaudeSettings(cwd: string, summary: EjectSummary): void {
  const filePath = path.join(cwd, '.claude', 'settings.json');
  if (!fs.existsSync(filePath)) {
    summary.skipped.push('.claude/settings.json (not found)');
    return;
  }

  // Read separately from parse so permission errors fail loud (they are
  // a distinct failure mode from invalid JSON, which is recoverable as
  // a documented eject skip per Tenet 4's "best-effort cleanup" carve-out).
  const raw = fs.readFileSync(filePath, 'utf-8');
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      summary.skipped.push('.claude/settings.json (invalid JSON)');
      return;
    }
    throw err;
  }
  if (!rawParsed || typeof rawParsed !== 'object' || Array.isArray(rawParsed)) {
    summary.skipped.push('.claude/settings.json (unexpected root shape)');
    return;
  }
  const parsed = rawParsed as Record<string, unknown>;

  const hooksRaw = parsed.hooks;
  if (!hooksRaw || typeof hooksRaw !== 'object' || Array.isArray(hooksRaw)) {
    summary.skipped.push('.claude/settings.json (no hooks)');
    return;
  }
  const hooks = hooksRaw as Record<string, unknown>;

  const commandIncludes = (entry: { hooks?: Array<unknown> }, needle: string): boolean => {
    const entryHooks = entry.hooks ?? [];
    return entryHooks.some((h) => {
      const cmd = typeof h === 'string' ? h : ((h as { command?: string } | null)?.command ?? '');
      return cmd.includes(needle);
    });
  };

  let mutated = false;

  // PreToolUse → drop the PreWriteShield entry AND every action-gate
  // wrapper entry (matcher Write|Edit, command references gate-wrapper.cjs;
  // one per installed gate — PR-C eject parity, mmnto-ai/totem#2048). Other
  // matchers (Bash legacy, user-defined Write|Edit) preserved. Array guard
  // so a malformed-but-valid JSON shape (e.g., `"PreToolUse": null`) is
  // skipped instead of crashing the eject best-effort cleanup.
  const preToolUseRaw = hooks.PreToolUse;
  if (Array.isArray(preToolUseRaw)) {
    const preToolUse = preToolUseRaw as Array<{ matcher?: string; hooks?: Array<unknown> }>;
    const filtered = preToolUse.filter(
      (entry) =>
        !(
          entry.matcher === 'Write|Edit' &&
          (commandIncludes(entry, 'PreWriteShield') || commandIncludes(entry, 'gate-wrapper.cjs'))
        ),
    );
    if (filtered.length !== preToolUse.length) {
      mutated = true;
      if (filtered.length === 0) {
        delete hooks.PreToolUse;
      } else {
        hooks.PreToolUse = filtered;
      }
    }
  }

  // SessionStart → drop only the Totem entry (matches by command needle,
  // no matcher field on SessionStart entries).
  const sessionStartRaw = hooks.SessionStart;
  if (Array.isArray(sessionStartRaw)) {
    const sessionStart = sessionStartRaw as Array<{ hooks?: Array<unknown> }>;
    const filtered = sessionStart.filter((entry) => !commandIncludes(entry, 'SessionStart.cjs'));
    if (filtered.length !== sessionStart.length) {
      mutated = true;
      if (filtered.length === 0) {
        delete hooks.SessionStart;
      } else {
        hooks.SessionStart = filtered;
      }
    }
  }

  if (!mutated) {
    summary.skipped.push('.claude/settings.json (no Totem hooks)');
    return;
  }

  // Bottom-up pruning matches the .local.json cleanup chain.
  if (Object.keys(hooks).length === 0) {
    delete parsed.hooks;
  }

  if (Object.keys(parsed).length === 0) {
    fs.unlinkSync(filePath);
    summary.removed.push('.claude/settings.json');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    summary.scrubbed.push('.claude/settings.json');
  }
}

/**
 * Remove the distributed Claude session-utility skills installed by Phase C
 * slice 3 (mmnto-ai/totem#1890). Marker-checked: only removes files whose
 * canonical content (between SKILL_MARKER_START / SKILL_MARKER_END) is
 * present. User-authored skills without markers are preserved.
 *
 * Bottom-up directory pruning matches the existing scrub helper precedent —
 * empty `.claude/skills/<name>/` and `.claude/skills/` get unlinked so the
 * filesystem state is clean.
 */
async function scrubClaudeSkills(cwd: string, summary: EjectSummary): Promise<void> {
  // Lazy-load init-templates (CLI command files defer heavy imports to keep
  // startup fast, mmnto-ai/totem#2299 review). Derive the scrub list from the
  // canonical DISTRIBUTED_CLAUDE_SKILLS so eject stays in lockstep with
  // `totem init` — a new distributed skill can never orphan on eject because a
  // hand-mirrored list drifted.
  const { DISTRIBUTED_CLAUDE_SKILLS, SKILL_MARKER_START, SKILL_MARKER_END } =
    await import('./init-templates.js');
  const distributedSkillNames = DISTRIBUTED_CLAUDE_SKILLS.map((s) => s.name);

  const skillsRoot = path.join(cwd, '.claude', 'skills');

  for (const name of distributedSkillNames) {
    const rel = `.claude/skills/${name}/SKILL.md`;
    const filePath = path.join(skillsRoot, name, 'SKILL.md');
    if (!fs.existsSync(filePath)) {
      summary.skipped.push(`${rel} (not found)`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.includes(SKILL_MARKER_START) || !content.includes(SKILL_MARKER_END)) {
      summary.skipped.push(`${rel} (no Totem markers — user-authored)`);
      continue;
    }

    try {
      fs.unlinkSync(filePath);
      summary.removed.push(rel);
      // totem-context: intentional cleanup — eject best-effort per Tenet 4 carve-out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.skipped.push(`${rel} (${msg})`);
      continue;
    }

    // Prune the per-skill directory if empty.
    const skillDir = path.join(skillsRoot, name);
    try {
      if (fs.existsSync(skillDir) && fs.readdirSync(skillDir).length === 0) {
        fs.rmdirSync(skillDir);
      }
      // totem-context: intentional cleanup — best-effort directory pruning
    } catch {
      /* eject best-effort */
    }
  }

  // Prune the skills root if empty after per-skill pruning.
  try {
    if (fs.existsSync(skillsRoot) && fs.readdirSync(skillsRoot).length === 0) {
      fs.rmdirSync(skillsRoot);
    }
    // totem-context: intentional cleanup — best-effort skills-root pruning
  } catch {
    /* eject best-effort */
  }
}

/**
 * Remove the AI Integration block appended by `totem init` to reflex files.
 */
function scrubReflexFiles(cwd: string, summary: EjectSummary): void {
  for (const rel of REFLEX_FILES) {
    const filePath = path.join(cwd, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    // Match the block from the heading to end of file (init always appends at the end)
    const primaryMarker = /\n*## Totem AI Integration \(Auto-Generated\)[\s\S]*$/;
    const altMarker = /\n*## Totem Memory Reflexes[\s\S]*$/;
    const activeMarker = primaryMarker.test(content)
      ? primaryMarker
      : altMarker.test(content)
        ? altMarker
        : null;

    if (!activeMarker) {
      summary.skipped.push(`${rel} (no Totem block)`);
      continue;
    }

    fs.writeFileSync(filePath, content.replace(activeMarker, '\n'), 'utf-8');
    summary.scrubbed.push(rel);
  }
}

/**
 * Delete Totem directories and config file.
 */
function deleteArtifacts(cwd: string, summary: EjectSummary): void {
  const artifacts = ['.lancedb', '.totem'];
  for (const dir of artifacts) {
    const dirPath = path.join(cwd, dir);
    if (fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        summary.removed.push(`${dir}/`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.skipped.push(`${dir}/ (could not delete: ${msg})`);
      }
    } else {
      summary.skipped.push(`${dir}/ (not found)`);
    }
  }

  const configPath = path.join(cwd, 'totem.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      summary.removed.push('totem.config.ts');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.skipped.push(`totem.config.ts (could not delete: ${msg})`);
    }
  } else {
    summary.skipped.push('totem.config.ts (not found)');
  }
}

// ─── Main command ───────────────────────────────────────

export interface EjectOptions {
  force?: boolean;
}

export async function ejectCommand(options: EjectOptions): Promise<void> {
  const { stdin: input, stdout: output } = await import('node:process');
  const readline = await import('node:readline/promises');
  const { log } = await import('../ui.js');

  const cwd = process.cwd();

  if (!options.force) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        'This will remove all Totem hooks, config, and data from this project. Continue? (y/N): ',
      );
      if (answer.trim().toLowerCase() !== 'y' && answer.trim().toLowerCase() !== 'yes') {
        log.info(TAG, 'Aborted.');
        return;
      }
    } finally {
      rl.close();
    }
  }

  const summary: EjectSummary = { removed: [], scrubbed: [], skipped: [] };

  // 1. Scrub git hooks — worktree-aware (mmnto-ai/totem#2426). The pre-fix code
  //    blind-joined `<cwd>/.git/hooks/<name>`, so in a linked worktree (where
  //    `.git` is a gitdir POINTER FILE and hooks live in the shared common dir)
  //    every hook reported "not found" and the eject silently no-oped. Resolve
  //    the real hooks dir via the #2422 helpers instead.
  const hooks = await resolveEjectHooksContext(cwd);
  if (hooks.isLinkedWorktree) {
    // Conservative decline (mmnto-ai/totem#2426 semantics question, left
    // deliberately UNRESOLVED by the issue): the resolved hooks dir is SHARED
    // across every worktree of this repo, so scrubbing it from one linked
    // worktree silently changes hook behavior for the main checkout and every
    // sibling worktree. Rather than take that cross-worktree destructive action
    // on a bug-fix — or invent the "eject-from-worktree removes shared hooks"
    // policy (symmetric with install, but the issue flags it as owing its own
    // ruling) — decline the git-hook removal and point at the main working tree.
    // Everything else eject removes below is per-working-tree, so it still runs.
    const sharedLoc = hooks.hooksDir ? ` (${hooks.hooksDir})` : '';
    for (const name of ['post-merge', 'post-checkout']) {
      summary.skipped.push(
        `.git/hooks/${name} (shared across worktrees — run \`totem eject\` from the main working tree to remove)`,
      );
    }
    log.warn(
      TAG,
      `Git hooks live in the shared git directory${sharedLoc}, used by every worktree of this repo — skipping hook removal. Run \`totem eject\` from the main working tree to remove them.`,
    );
  } else if (!hooks.hooksDir) {
    // Not a git repo, or an unparseable `.git` pointer — nothing to resolve.
    for (const name of ['post-merge', 'post-checkout']) {
      summary.skipped.push(`.git/hooks/${name} (git hooks directory could not be resolved)`);
    }
  } else {
    scrubPostMergeHook(hooks.hooksDir, summary);
    scrubPostCheckoutHook(hooks.hooksDir, summary);
  }

  // 2. Remove scaffolded Gemini/Claude hook files
  removeScaffoldedFiles(cwd, summary);

  // 3. Scrub Claude settings.local.json (per-developer shield-gate)
  scrubClaudeSettings(cwd, summary);

  // 4. Scrub Claude settings.json (committed PreWriteShield + SessionStart entries)
  scrubCommittedClaudeSettings(cwd, summary);

  // 5. Scrub distributed Claude session-utility skills (Phase C slice 3)
  await scrubClaudeSkills(cwd, summary);

  // 6. Scrub AI reflex blocks from markdown files
  scrubReflexFiles(cwd, summary);

  // 7. Delete artifacts
  deleteArtifacts(cwd, summary);

  // Print summary
  if (summary.removed.length > 0) {
    log.info(TAG, 'Removed:');
    for (const item of summary.removed) {
      log.success(TAG, `  ${item}`);
    }
  }
  if (summary.scrubbed.length > 0) {
    log.info(TAG, 'Scrubbed (Totem content removed, file preserved):');
    for (const item of summary.scrubbed) {
      log.success(TAG, `  ${item}`);
    }
  }
  if (summary.skipped.length > 0) {
    log.dim(TAG, 'Skipped:');
    for (const item of summary.skipped) {
      log.dim(TAG, `  ${item}`);
    }
  }
  if (summary.removed.length === 0 && summary.scrubbed.length === 0) {
    log.info(TAG, 'Nothing to remove — project appears clean.');
  }

  log.success(TAG, 'Totem has been ejected from this project.');
}

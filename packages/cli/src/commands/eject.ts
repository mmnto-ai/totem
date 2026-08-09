import * as fs from 'node:fs';
import * as path from 'node:path';

// Subpath import, NOT the core barrel: fs-atomic pulls only node builtins, so
// the command file's cold-start discipline holds without threading a lazy seam
// through the sync scrub helpers that need it (mmnto-ai/totem#2620).
import { writeFileAtomicSync } from '@mmnto/totem/fs-atomic';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Eject';
const TOTEM_HOOK_MARKER = '[totem] post-merge hook';
const TOTEM_HOOK_END = '[totem] end post-merge';
const TOTEM_CHECKOUT_MARKER = '[totem] post-checkout hook';
const TOTEM_CHECKOUT_END = '[totem] end post-checkout';
// Comment-shape-agnostic: hooks open `// [totem] auto-generated …`, markdown
// skills `<!-- [totem] auto-generated … -->` — the first-line gate matches both.
const TOTEM_FILE_MARKER = '[totem] auto-generated';

/** Files scaffolded by `totem init` that are fully owned by Totem.
 *  Exported for the sense-roster set-equality test (mmnto-ai/totem#2620) —
 *  a sampled roster assertion cannot detect a dropped member. */
export const TOTEM_SCAFFOLDED_FILES = [
  // Current (BeforeTool: mmnto-ai/totem#2481; SessionStart: mmnto-ai/totem#2488) +
  // the pre-migration `.js` each one renamed — eject removes both shapes so an
  // upgraded-then-ejected consumer leaves no fail-open artifact behind.
  '.gemini/hooks/SessionStart.cjs',
  '.gemini/hooks/SessionStart.js',
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
 * hardcode-`.git/hooks` lesson prescribes). Resolution is a READ, not the
 * mutation boundary: a genuine git failure degrades to an unresolvable-hooks
 * result that the caller reports as per-hook skip lines. No backstop rides
 * this path — nothing has been mutated when it fires.
 */
export async function resolveEjectHooksContext(cwd: string): Promise<EjectHooksContext> {
  // Lazy-load the hook-path resolvers: they pull the core git barrel, so keeping
  // them off the static graph preserves this command file's cold-start discipline
  // (the same dynamic-import pattern `scrubClaudeSkills`/`ejectCommand` use).
  const { resolveGitRootForHookPath, resolveHooksDir } = await import('./install-hooks.js');
  let gitRoot: string | null;
  try {
    ({ gitRoot } = resolveGitRootForHookPath(cwd));
    // A genuine git failure (NOT not-a-repo / unparseable pointer, which
    // return a null root WITHOUT throwing) degrades to "unresolvable" — a
    // read-path degrade the caller reports per hook, not a mutation swallow.
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

  // Raw bytes first: the bak must be BYTE-exact (rule 3, "pre-mutation
  // bytes"), and a hook that does not round-trip through UTF-8 cannot be
  // line-scrubbed without silently substituting U+FFFD into the KEPT user
  // content — that class degrades to a reported skip instead (falsification
  // round: finding 3).
  const rawContent = fs.readFileSync(hookPath);
  const content = rawContent.toString('utf-8');
  if (!content.includes(startMarker)) {
    summary.skipped.push(`${hookFileName} (no Totem section)`);
    return;
  }
  if (Buffer.compare(Buffer.from(content, 'utf-8'), rawContent) !== 0) {
    summary.skipped.push(
      `${hookFileName} (non-UTF-8 content — not scrubbed; remove the Totem block manually)`,
    );
    return;
  }

  // Rule-3 recovery artifact (User-File Mutation Contract corollary,
  // mmnto-ai/totem#2620): `.git/hooks/*` is unrecoverable through git BY
  // SURFACE CLASS — no derivable-state escape, so the full-removal path baks
  // too (author intent-read Q1: "these bytes are fully ours" is a belief
  // produced by the same logic that would be the bug — the #2602 provenance).
  // Written BEFORE mutating, carrying the source hook's mode; a bak failure
  // skips the mutation entirely, because disclosure never substitutes for
  // recovery (the strategy#1045 addendum).
  const bakFileName = `${hookFileName}.totem-bak`;
  try {
    const sourceMode = fs.statSync(hookPath).mode & 0o7777;
    writeFileAtomicSync(`${hookPath}.totem-bak`, rawContent, { mode: sourceMode });
    // totem-context: intentional cleanup — bak failure degrades to a reported skip and WITHHOLDS the mutation
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.skipped.push(`${hookFileName} (recovery backup failed — hook left untouched: ${msg})`);
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
      summary.removed.push(`${hookFileName} (pre-removal bytes: ${bakFileName})`);
    } else {
      writeFileAtomicSync(hookPath, remaining + '\n');
      summary.scrubbed.push(`${hookFileName} (pre-scrub bytes: ${bakFileName})`);
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
 * Only removes files whose first line IS a generated header — prefix-anchored
 * in both comment shapes (`// [totem] auto-generated …` hooks,
 * `<!-- [totem] auto-generated … -->` markdown skills). A file that merely
 * QUOTES the marker — later in its body or in a first-line sentence (a
 * user-authored hook citing the managed version it replaced) — is not
 * totem-owned and must survive eject (mmnto-ai/totem#2488 review, rounds 1–2).
 */
function removeScaffoldedFiles(cwd: string, summary: EjectSummary): void {
  for (const rel of TOTEM_SCAFFOLDED_FILES) {
    const filePath = path.join(cwd, rel);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const newline = content.indexOf('\n');
    const firstLine = newline === -1 ? content : content.slice(0, newline);
    const normalizedFirstLine = firstLine.trimStart();
    if (
      normalizedFirstLine.startsWith(`// ${TOTEM_FILE_MARKER}`) ||
      normalizedFirstLine.startsWith(`<!-- ${TOTEM_FILE_MARKER}`)
    ) {
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
    writeFileAtomicSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
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
  // a distinct failure mode from invalid JSON, which is recoverable as a
  // documented eject skip — a read-path degrade, before any mutation).
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
    writeFileAtomicSync(filePath, JSON.stringify(parsed, null, 2) + '\n');
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
      // totem-context: intentional cleanup — per-item best-effort; the failure is a reported skip (no backstop rides this step)
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

/** Reflex files that predate the marker era and may carry a v1 marker-less
 *  block. REFLEX_START shipped before GEMINI.md / .junie/guidelines.md /
 *  .github/copilot-instructions.md joined the tool table, so on those files a
 *  bare legacy heading can only be user-authored — never scrubbed.
 *  `.gemini/gemini.md` is the RETIRED pre-marker Gemini target (replaced by
 *  GEMINI.md when the tool table landed): init no longer injects there, but an
 *  old block can still be sitting in it, so eject still visits it. */
export const LEGACY_REFLEX_FILES = ['CLAUDE.md', '.gemini/gemini.md', '.cursorrules'];

/** The alt heading of the oldest legacy block shape (pre-LEGACY_SENTINEL). */
const LEGACY_ALT_HEADING = '## Totem Memory Reflexes';

/**
 * Remove the AI Integration block appended by `totem init` to reflex files.
 *
 * Exported for the summary-contract tests (mmnto-ai/totem#2602).
 */
export async function scrubReflexFiles(cwd: string, summary: EjectSummary): Promise<void> {
  // Lazy-load both sources (the CLI command-file cold-start discipline
  // scrubClaudeSkills documents). The roster is derived from the SAME tool
  // table init injects through — the hand-mirrored pair this replaces silently
  // missed GEMINI.md, .junie/guidelines.md, and .github/copilot-instructions.md
  // (mmnto-ai/totem#2602).
  const { AI_TOOLS } = await import('./init-detect.js');
  const { LEGACY_SENTINEL, REFLEX_END, REFLEX_START } = await import('./init-templates.js');
  const reflexFiles = AI_TOOLS.flatMap((t) => (t.reflexFile === null ? [] : [t.reflexFile]));
  // Visit the union: the roster init injects through today, plus the retired
  // pre-marker targets that can still carry an old block (scoped fold round).
  const scanFiles = [...new Set([...reflexFiles, ...LEGACY_REFLEX_FILES])];

  // Tenet 4 licenses per-item best-effort ONLY together with failure
  // accounting and a loud backstop (the licensing gap this closes was
  // mmnto-ai/totem#2620 leg finding 4 — before it, an eject where every
  // scrub write failed still exited clean over a wall of skip lines).
  let failed = 0;
  let succeeded = 0;

  for (const rel of scanFiles) {
    const filePath = path.join(cwd, rel);
    // Per-file best-effort: one unreadable/locked file degrades to a reported
    // skip, never an abort that strands the remaining eject steps.
    try {
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');

      // Marker era (v2+): remove each complete REFLEX_START..REFLEX_END span.
      // The span AFTER an end marker is contractually user content
      // (mmnto-ai/totem#1890; regen preserves it byte-exactly since
      // mmnto-ai/totem#2599) — the pre-fix heading-to-EOF scrub deleted it and
      // left an orphan start+version pair that detectReflexStatus reads as
      // `current` (mmnto-ai/totem#2602). Pairing is END-anchored (lastIndexOf)
      // so an orphan START from that same pre-fix damage sitting ABOVE a
      // complete block never widens the removal span; the loop clears
      // double-injection damage instead of leaving a live block behind a
      // "Scrubbed" line.
      let out = content;
      let removedBlocks = 0;
      // A leading orphan END (no START anywhere before it) must not halt the
      // scan — later complete pairs are still totem's to remove, and the
      // changeset contract is "loops until no complete pair remains". Skip
      // past the orphan (it stays residue) and keep scanning; reset after a
      // removal since indices shifted (GCA round on this PR).
      let searchStart = 0;
      for (;;) {
        const endIdx = out.indexOf(REFLEX_END, searchStart);
        if (endIdx === -1) break;
        const startIdx = out.lastIndexOf(REFLEX_START, endIdx);
        if (startIdx === -1) {
          searchStart = endIdx + REFLEX_END.length;
          continue;
        }
        // Single-owner seams, mirroring upgradeReflexes with the block replaced
        // by nothing: the prefix keeps at most one trailing newline (the blank
        // line above the block was AI_PROMPT_BLOCK's own leading `\n`), and the
        // end marker's own line terminator leaves with the block. Seam
        // whitespace normalizes exactly as regen would — a seam contract, not a
        // byte-restore of the pre-init file.
        let before = out.slice(0, startIdx).replace(/(?:\r?\n)*$/, '\n');
        if (before === '\n') before = '';
        let after = out.slice(endIdx + REFLEX_END.length);
        if (/^[ \t\r\n]*$/.test(after)) {
          after = '';
        } else if (after.startsWith('\r\n')) {
          after = after.slice(2);
        } else if (after.startsWith('\n')) {
          after = after.slice(1);
        }
        out = before + after;
        removedBlocks++;
        searchStart = 0;
      }

      // Marker residue = an unpaired START or END (either shape of the pre-fix
      // corruption, or an inverted pair). The content around it cannot be
      // attributed, so it is never scrubbed — and while a version marker
      // remains, detectReflexStatus keeps reading the file as `current`
      // (the mmnto-ai/totem#2602 corrupt-but-green state): healing is manual.
      const residue = out.includes(REFLEX_START) || out.includes(REFLEX_END);

      if (removedBlocks > 0) {
        writeFileAtomicSync(filePath, out);
        succeeded++;
        summary.scrubbed.push(residue ? `${rel} (marker residue remains — remove manually)` : rel);
        continue;
      }
      if (residue) {
        summary.skipped.push(
          `${rel} (reflex marker residue — not scrubbed; remove manually, else init keeps reading the file as current)`,
        );
        continue;
      }

      // Legacy era (pre-marker v1), LEGACY_REFLEX_FILES only. init's own legacy
      // upgrade (upgradeReflexes Case 2) bounds a v1 block at the next
      // non-Totem H2, NOT at EOF — mirror it, or user content below a v1 block
      // takes the same mmnto-ai/totem#2602 loss the marker path just fixed.
      if (!LEGACY_REFLEX_FILES.includes(rel)) {
        summary.skipped.push(`${rel} (no Totem block)`);
        continue;
      }
      const primaryIdx = content.indexOf(LEGACY_SENTINEL);
      const altIdx = content.indexOf(LEGACY_ALT_HEADING);
      const legacyIdx =
        primaryIdx === -1 ? altIdx : altIdx === -1 ? primaryIdx : Math.min(primaryIdx, altIdx);
      if (legacyIdx === -1) {
        summary.skipped.push(`${rel} (no Totem block)`);
        continue;
      }
      const afterLegacy = content.slice(legacyIdx);
      // init.ts upgradeReflexes Case 2's boundary, VERBATIM: the next H2 that
      // is not a Totem AI Integration heading ends the block. No extra
      // alternatives — both injector generations guarded on the absence of
      // "Totem Memory Reflexes" before writing, so a second Totem-titled H2
      // below the block can only be user-authored (scoped fold round).
      const nextH2 = afterLegacy.match(/\r?\n## (?!Totem AI Integration)/);
      const blockEnd = nextH2?.index !== undefined ? legacyIdx + nextH2.index : content.length;
      let before = content.slice(0, legacyIdx).replace(/(?:\r?\n)*$/, '\n');
      if (before === '\n') before = '';
      let tail = content.slice(blockEnd);
      // The boundary newline is seam-owned: with a non-empty prefix it supplies
      // the blank-line separation; at byte 0 it would mint a leading blank line
      // the seam rules forbid.
      if (before === '') {
        if (tail.startsWith('\r\n')) tail = tail.slice(2);
        else if (tail.startsWith('\n')) tail = tail.slice(1);
      }
      writeFileAtomicSync(filePath, before + tail);
      succeeded++;
      summary.scrubbed.push(rel);
      // totem-context: intentional cleanup — per-file best-effort scrub; the failure is a reported skip the accounting below counts toward the loud backstop, never a silent drop.
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      summary.skipped.push(`${rel} (could not scrub: ${msg})`);
    }
  }

  // The loud systemic backstop Tenet 4's licensed shape requires alongside
  // the per-item accounting (mmnto-ai/totem#2620 leg finding 4): when every
  // attempted scrub failed, eject must not exit clean.
  if (failed > 0 && succeeded === 0) {
    const { TotemError } = await import('@mmnto/totem');
    throw new TotemError(
      'EJECT_FAILED',
      `all ${failed} reflex-file scrub attempt(s) failed — nothing was scrubbed; see the per-file skip reasons in the summary`,
      'Check permissions/locks on the listed reflex files, then re-run totem eject.',
    );
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

// ─── Dirty-tree sense (User-File Mutation Contract rule 2) ──────

/** Derived pre-consent VCS state for the files eject is about to mutate. */
export interface DirtyTreeSense {
  /** `git status --porcelain` lines for roster paths with uncommitted changes. */
  dirty: string[];
  /**
   * `!!` porcelain lines: gitignored roster paths. Git holds NO copy of these
   * at all — for a deletion target (`.totem/secrets.json`, `.lancedb/`) that
   * is the strongest no-revert-point class, and plain `git status` omits them
   * by design (falsification round: finding 2).
   */
  ignored: string[];
  /** Human sense lines to print ahead of the consent prompt (empty = clean derivation). */
  lines: string[];
}

/**
 * Rule-2 sense of the User-File Mutation Contract (mmnto-ai/totem#2620): the
 * git-native form of backup-before-modify is knowing whether a commit exists
 * to diff against, so eject SAYS which of its mutation targets carry
 * uncommitted changes before asking consent. Sense-and-say only (Tenet 13):
 * never a block, never an exit-code change; `--force` skips the prompt, not
 * the sense. Deletions count — deleting a tracked-dirty file is the limiting
 * case of mutation with no revert point (author intent-read Q3).
 *
 * The roster derives from the SAME constants the scrub/removal steps consume
 * (Tenet 20 — a hand-mirrored sense list would be the prohibited mirror
 * inside the very rule built to prevent silent loss). `.git/hooks/*` never
 * appears here: git cannot see that surface — its recovery is scrubHook's
 * rule-3 `.totem-bak` artifact.
 *
 * Exported for the sense-contract tests.
 */
export async function deriveDirtyTreeSense(cwd: string): Promise<DirtyTreeSense> {
  let porcelain: string;
  try {
    // The roster imports live INSIDE the try: a sensor that can throw before
    // its own catch is a sensor that can abort the eject it senses for
    // (falsification round: finding 11).
    const { AI_TOOLS } = await import('./init-detect.js');
    const { DISTRIBUTED_CLAUDE_SKILLS } = await import('./init-templates.js');
    const roster = [
      ...new Set([
        ...TOTEM_SCAFFOLDED_FILES,
        '.claude/settings.local.json',
        '.claude/settings.json',
        ...DISTRIBUTED_CLAUDE_SKILLS.map((s) => `.claude/skills/${s.name}/SKILL.md`),
        ...AI_TOOLS.flatMap((t) => (t.reflexFile === null ? [] : [t.reflexFile])),
        ...LEGACY_REFLEX_FILES,
        '.lancedb',
        '.totem',
        'totem.config.ts',
      ]),
    ];
    // Lazy barrel import — the established eject runtime pattern
    // (resolveEjectHooksContext pulls the core git barrel the same way).
    // `--ignored=matching`: plain porcelain omits ignored paths by design, so
    // without it the sense reads "invisible to git" as "committed and clean"
    // for exactly the paths with NO git copy at all (finding 2).
    const { safeExec } = await import('@mmnto/totem');
    porcelain = safeExec('git', ['status', '--porcelain', '--ignored=matching', '--', ...roster], {
      cwd,
    });
    // totem-context: intentional sensor degradation — the failure is SAID as an honest sense line (Tenet 13), never swallowed
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const line = msg.includes('not a git repository')
      ? 'Not a git repository — files eject modifies here have no VCS revert point.'
      : `Could not derive VCS state for eject targets (${msg.split('\n')[0]}) — proceeding without the dirty-tree sense.`;
    return { dirty: [], ignored: [], lines: [line] };
  }

  const rows = porcelain.length === 0 ? [] : porcelain.split('\n').filter((l) => l.trim() !== '');
  const ignored = rows.filter((l) => l.startsWith('!!'));
  const dirty = rows.filter((l) => !l.startsWith('!!'));
  const lines: string[] = [];
  if (dirty.length > 0) {
    lines.push(
      `Uncommitted changes in ${dirty.length} path(s) eject will modify — no revert point until committed:`,
      ...dirty.map((l) => `  ${l}`),
    );
  }
  if (ignored.length > 0) {
    lines.push(
      `${ignored.length} gitignored path(s) eject will remove — git holds no copy of these at all:`,
      ...ignored.map((l) => `  ${l}`),
    );
  }
  return { dirty, ignored, lines };
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

  // Rule-2 sense line(s) ride ahead of the consent prompt — and under
  // --force too: the flag skips the prompt, never the sense (mmnto-ai/totem#2620).
  const sense = await deriveDirtyTreeSense(cwd);
  for (const line of sense.lines) {
    log.warn(TAG, line);
  }

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

  // 6. Scrub AI reflex blocks from markdown files. Any throw here (the
  // Tenet-4 EJECT_FAILED backstop included) is DEFERRED past step 7 and the
  // summary print, then rethrown: a backstop that fires before the summary
  // destroys the very accounting surface — the skip reasons and the
  // `.totem-bak` paths — that licenses it, and leaves the error text pointing
  // at a summary that never printed (falsification round: finding 1).
  let deferredThrow: unknown;
  // totem-context: intentional cleanup — deferred rethrow after the summary below, never a swallow
  try {
    await scrubReflexFiles(cwd, summary);
  } catch (err) {
    deferredThrow = err;
  }

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

  // The sense line rides the summary under --force (mmnto-ai/totem#2620 leg
  // finding 5): the prompt was skipped, so the no-revert-point state is
  // restated where the operator is actually looking.
  const noRevertCount = sense.dirty.length + sense.ignored.length;
  if (options.force && noRevertCount > 0) {
    log.warn(
      TAG,
      `--force skipped the consent prompt with ${noRevertCount} touched path(s) lacking a revert point — see the sense lines above.`,
    );
  }

  if (deferredThrow !== undefined) {
    throw deferredThrow;
  }

  log.success(TAG, 'Totem has been ejected from this project.');
}

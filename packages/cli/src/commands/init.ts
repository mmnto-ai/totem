import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import type { IngestTarget } from '@mmnto/totem';

import {
  type HookCommandSchema,
  mergeClaudeHooksKey,
  type ParsedSettings,
  preToolUseHasMatcher,
  type ScaffoldOutcome,
} from './host-hooks.js';
import {
  AI_TOOLS,
  type AiToolInfo,
  type Ecosystem,
  type EmbeddingTier,
  type HookInstallerResult,
} from './init-detect.js';
import {
  AI_PROMPT_BLOCK,
  CLAUDE_PRETOOLUSE_ENTRY,
  CLAUDE_PREWRITESHIELD,
  CLAUDE_PREWRITESHIELD_ENTRY,
  CLAUDE_SESSION_START,
  CLAUDE_SESSION_START_ENTRY,
  DISTRIBUTED_CLAUDE_SKILLS,
  GEMINI_BEFORE_TOOL,
  GEMINI_SESSION_START,
  GEMINI_SKILL,
  isBoundedOwnedFile,
  LEGACY_SENTINEL,
  markerOpensFile,
  REFLEX_END,
  REFLEX_START,
  REFLEX_VERSION,
  REFLEX_VERSION_RE,
  SKILL_MARKER_END,
  SKILL_MARKER_START,
  TOTEM_FILE_END,
  TOTEM_FILE_MARKER,
} from './init-templates.js';

// Re-export moved items so existing consumers (including tests) don't break
export type { AiToolInfo, HookInstallerResult } from './init-detect.js';
export { buildNpxCommand, detectEmbeddingTier } from './init-detect.js';
export {
  AI_PROMPT_BLOCK,
  generateConfig,
  generateConfigForFormat,
  REFLEX_VERSION,
} from './init-templates.js';

// ─── Ollama floor probe (mmnto-ai/totem#1851 PR-2) ──────────
// Init-time companion to the doctor.ts `checkOllama` diagnostic shipped
// in PR-1 (mmnto-ai/totem#1860). Surfaces the embedder fallback floor
// before the user picks an embedding tier so cloud-key auto-detection
// doesn't silently bury Ollama as an option (Tenet 16).

export const OLLAMA_FLOOR_DEFAULT_BASE_URL = 'http://localhost:11434';

const OLLAMA_FLOOR_FRAMING = 'no API key, no quota, runs locally';

export async function probeOllamaFloor(): Promise<{
  available: boolean;
  baseUrl: string;
  message: string;
}> {
  const baseUrl = OLLAMA_FLOOR_DEFAULT_BASE_URL;
  let available = false;
  try {
    const { isOllamaAvailable } = await import('@mmnto/totem');
    available = await isOllamaAvailable(baseUrl);
  } catch (err) {
    // Probe is best-effort: import error or any contract regression in
    // `isOllamaAvailable` is treated as floor-absent so init does not
    // abort mid-flight (we run between buildTargets and embedding-tier
    // branching, so a throw here would leave the user in partial state).
    // Re-throw truly unexpected non-Error throws to surface them to the
    // top-level handler instead of silently swallowing them.
    if (!(err instanceof Error)) {
      throw err;
    }
    available = false;
  }
  const message = available
    ? `Ollama floor detected at ${baseUrl} (recommended fallback — ${OLLAMA_FLOOR_FRAMING}).`
    : `Ollama floor not detected (recommended fallback — ${OLLAMA_FLOOR_FRAMING}). Install: https://ollama.com.`;
  return { available, baseUrl, message };
}

/**
 * Scaffold a file with idempotency — skips any file the totem `marker` does NOT
 * OPEN (a user-owned file, or one that merely QUOTES the marker in its body — the
 * positional ownership gate shared with `regenerateManagedSessionHooks`,
 * mmnto-ai/totem#2413). When the caller threads an `endMarker`, a marker-headed
 * whole file that is a bounded totem-owned region (marker opens it, end marker
 * present, nothing after) and whose content has DRIFTED from canonical is repaired
 * in place (`refreshed`) — the #2406 git-hook bounded drift-repair, generalized to
 * the session-hook family (mmnto-ai/totem#2410, the lc#806 stale-SessionStart fix).
 * A marker-headed file that is NOT bounded (legacy template with no end marker, or
 * user content after the end marker) keeps the pre-#2410 `exists` behavior and emits
 * a one-line notice. Creates parent directories as needed.
 */
export function scaffoldFile(
  filePath: string,
  content: string,
  marker: string = TOTEM_FILE_MARKER,
  endMarker?: string,
): { action: 'created' | 'exists' | 'skipped' | 'refreshed'; err?: string } {
  try {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      // Positional ownership gate (mmnto-ai/totem#2413): the marker must OPEN the file.
      // A file that merely quotes the marker string is user-owned → `skipped`, never
      // written (harmonized with regenerateManagedSessionHooks; both non-destructive).
      if (markerOpensFile(existing, marker)) {
        if (existing === content) {
          return { action: 'exists' };
        }
        // Content drifted. Bounded drift-repair only when the caller threaded an end
        // marker AND the on-disk file is a bounded totem-owned whole file.
        if (endMarker !== undefined && isBoundedOwnedFile(existing, marker, endMarker)) {
          fs.writeFileSync(filePath, content, 'utf-8');
          return { action: 'refreshed' };
        }
        // Marker opens the file but we are not refreshing it. Two distinct causes,
        // two distinct notices (mmnto-ai/totem#2413 accuracy fix — the old message
        // asserted "unbounded" even when the caller simply withheld the end marker):
        if (endMarker === undefined) {
          // This caller did not request a bounded refresh (e.g. the Gemini skill,
          // which is marker-block replace territory, not whole-file regeneration).
          console.error(
            `[Totem] ${path.basename(filePath)} differs from canonical, but this installer does not manage its whole-file refresh — run \`totem hook install --force\` to regenerate a managed hook.`,
          );
        } else {
          // The caller threaded an end marker but the on-disk region is genuinely
          // unbounded (legacy no-end-marker file, or user content after the end
          // marker). The regenerated (post-force) artifact carries the end marker, so
          // subsequent bare self-repair works.
          console.error(
            `[Totem] ${path.basename(filePath)} has drifted but is not a bounded totem-owned region — run \`totem hook install --force\` to regenerate.`,
          );
        }
        return { action: 'exists' };
      }
      return { action: 'skipped' };
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return { action: 'created' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: `[Totem Error] ${message}` };
  }
}

// --- Gemini CLI hook installer ---

async function installGeminiHooks(cwd: string): Promise<HookInstallerResult[]> {
  const results: HookInstallerResult[] = [];
  // The two whole-file hooks carry the managed end marker (mmnto-ai/totem#2410) so a
  // drifted-but-bounded artifact self-repairs on re-init; the skill is marker-block
  // replace territory (no end marker threaded here).
  const files: Array<{ rel: string; content: string; marker: string; endMarker?: string }> = [
    {
      rel: '.gemini/hooks/SessionStart.js',
      content: GEMINI_SESSION_START,
      marker: TOTEM_FILE_MARKER,
      endMarker: TOTEM_FILE_END,
    },
    {
      rel: '.gemini/hooks/BeforeTool.js',
      content: GEMINI_BEFORE_TOOL,
      marker: TOTEM_FILE_MARKER,
      endMarker: TOTEM_FILE_END,
    },
    {
      rel: '.gemini/skills/totem.md',
      content: GEMINI_SKILL,
      marker: '<!-- [totem] auto-generated — Totem Architect skill -->',
    },
  ];

  for (const { rel, content, marker, endMarker } of files) {
    const filePath = path.join(cwd, rel);
    const result = scaffoldFile(filePath, content, marker, endMarker);
    // Map the scaffold action onto HookInstallerResult: a bounded drift-repair
    // (`refreshed`) surfaces as `merged` (file mutated) for installer summary parity
    // with scaffoldClaudeSkill's mapping.
    results.push({
      file: rel,
      action: result.action === 'refreshed' ? 'merged' : result.action,
      ...(result.err ? { err: result.err } : {}),
    });
  }

  return results;
}

// --- Claude Code hook installer ---

// The settings-merge primitive (ClaudeSettingsSchema, HookCommandSchema,
// mergeClaudeHooksKey, preToolUseHasMatcher, and the ScaffoldOutcome /
// ParsedSettings / ClaudeHooksKey types) lives in host-hooks.js — the
// namespace-neutral install primitive shared by gate-install, init, and
// later Prop 257 (PR-C, mmnto-ai/totem#2048). The Totem-specific
// idempotency probes (hasTotemShield, etc.) and the per-lifecycle scaffold
// wrappers stay here.

/** Check whether a hook entry already contains a totem review/shield reference. */
function hasTotemShield(entry: z.infer<typeof HookCommandSchema>): boolean {
  if (typeof entry === 'string')
    return entry.includes('totem review') || entry.includes('totem shield');
  return (
    entry.command.includes('totem review') ||
    entry.command.includes('totem shield') ||
    entry.command.includes('shield-gate')
  );
}

/** Check whether a hook entry already contains a PreWriteShield reference. */
function hasPreWriteShield(entry: z.infer<typeof HookCommandSchema>): boolean {
  if (typeof entry === 'string') return entry.includes('PreWriteShield');
  return entry.command.includes('PreWriteShield');
}

/** Check whether a hook entry already contains a SessionStart.cjs reference. */
function hasTotemSessionStart(entry: z.infer<typeof HookCommandSchema>): boolean {
  if (typeof entry === 'string') return entry.includes('SessionStart.cjs');
  return entry.command.includes('SessionStart.cjs');
}

function sessionStartHas(
  parsed: ParsedSettings,
  probe: (entry: z.infer<typeof HookCommandSchema>) => boolean,
): boolean {
  const sessionStart = parsed.hooks?.SessionStart ?? [];
  return sessionStart.some((h) => Array.isArray(h.hooks) && h.hooks.some(probe));
}

/**
 * Merge Totem hooks into .claude/settings.local.json without overwriting
 * existing user-defined hooks. Installs the Bash matcher for shield-gate.
 */
export function scaffoldClaudeHooks(filePath: string): ScaffoldOutcome {
  return mergeClaudeHooksKey(filePath, 'PreToolUse', CLAUDE_PRETOOLUSE_ENTRY, (parsed) =>
    preToolUseHasMatcher(parsed, 'Bash', hasTotemShield),
  );
}

/**
 * Merge the PreWriteShield hook into .claude/settings.json (committed,
 * team-level) without overwriting existing user-defined hooks. Installs
 * the Write|Edit matcher for write-time xrepo-qualify-refs enforcement.
 *
 * Distinct from scaffoldClaudeHooks: that targets settings.local.json
 * (per-developer environment safety); this targets settings.json
 * (team-level governance, sealed at mmnto-ai/totem-strategy#145).
 */
export function scaffoldClaudeWriteShield(filePath: string): ScaffoldOutcome {
  return mergeClaudeHooksKey(filePath, 'PreToolUse', CLAUDE_PREWRITESHIELD_ENTRY, (parsed) =>
    preToolUseHasMatcher(parsed, 'Write|Edit', hasPreWriteShield),
  );
}

/**
 * Merge the Claude SessionStart hook entry into .claude/settings.json
 * (committed, team-level) without overwriting existing user-defined
 * hooks. Symmetric with the Gemini-side .gemini/hooks/SessionStart.js
 * install (mmnto-ai/totem#1845 slice 1) — orientation IS a team-level
 * guarantee, so it shares the committed settings.json placement with
 * Phase B's PreWriteShield.
 */
export function scaffoldClaudeSessionStart(filePath: string): ScaffoldOutcome {
  return mergeClaudeHooksKey(filePath, 'SessionStart', CLAUDE_SESSION_START_ENTRY, (parsed) =>
    sessionStartHas(parsed, hasTotemSessionStart),
  );
}

async function installClaudeHooks(
  cwd: string,
  opts?: { forceSkillRefresh?: boolean },
): Promise<HookInstallerResult[]> {
  // Bash gate architecture removed (Proposal 207). Write-time enforcement
  // re-introduced via PreWriteShield hook (mmnto-ai/totem#1846): blocks
  // bare cross-repo refs in substrate-participating paths before disk write.
  // Sealed at mmnto-ai/totem-strategy#145. SessionStart hook added in
  // mmnto-ai/totem#1845 slice 1 for parity with Gemini-side install.
  const results: HookInstallerResult[] = [];
  const settingsPath = path.join(cwd, '.claude', 'settings.json');

  // 1. Scaffold the PreWriteShield hook script (committed to .claude/hooks/).
  //    Threads the managed end marker (mmnto-ai/totem#2410) so a drifted-but-bounded
  //    artifact self-repairs on re-init; `refreshed` maps to `merged` (file mutated).
  const preWritePath = path.join(cwd, '.claude', 'hooks', 'PreWriteShield.cjs');
  const preWriteResult = scaffoldFile(
    preWritePath,
    CLAUDE_PREWRITESHIELD,
    TOTEM_FILE_MARKER,
    TOTEM_FILE_END,
  );
  results.push({
    file: '.claude/hooks/PreWriteShield.cjs',
    action: preWriteResult.action === 'refreshed' ? 'merged' : preWriteResult.action,
    ...(preWriteResult.err ? { err: preWriteResult.err } : {}),
  });

  // 2. Scaffold the SessionStart hook script (committed to .claude/hooks/).
  //    Symmetric with .gemini/hooks/SessionStart.js — Tenet 16 parity.
  const sessionStartPath = path.join(cwd, '.claude', 'hooks', 'SessionStart.cjs');
  const sessionStartResult = scaffoldFile(
    sessionStartPath,
    CLAUDE_SESSION_START,
    TOTEM_FILE_MARKER,
    TOTEM_FILE_END,
  );
  results.push({
    file: '.claude/hooks/SessionStart.cjs',
    action: sessionStartResult.action === 'refreshed' ? 'merged' : sessionStartResult.action,
    ...(sessionStartResult.err ? { err: sessionStartResult.err } : {}),
  });

  // 3. Merge the PreWriteShield PreToolUse entry into committed
  //    .claude/settings.json (distinct from settings.local.json which
  //    holds the per-developer shield-gate from before Proposal 207).
  const writeShieldEntryResult = scaffoldClaudeWriteShield(settingsPath);
  results.push({
    file: '.claude/settings.json',
    ...writeShieldEntryResult,
  });

  // 4. Merge the SessionStart entry into committed .claude/settings.json.
  //    Same file as step 3; the merge helper appends idempotently under
  //    `hooks.SessionStart` without disturbing `hooks.PreToolUse`.
  const sessionStartEntryResult = scaffoldClaudeSessionStart(settingsPath);
  results.push({
    file: '.claude/settings.json (SessionStart)',
    ...sessionStartEntryResult,
  });

  // 5. Distribute session-utility skills (mmnto-ai/totem#1890 Phase C
  //    slice 3). Marker-based replace: fresh repos get the canonical
  //    content; refreshes replace the inside-marker section while
  //    preserving user customizations below the end marker.
  //
  //    scaffoldClaudeSkill's native action union ('created' | 'refreshed' |
  //    'unchanged' | 'preserved') is mapped onto the existing
  //    HookInstallerResult union for installer summary compatibility:
  //    refreshed → 'merged' (file mutated), unchanged → 'exists' (no-op),
  //    preserved → 'skipped' (user content protected).
  for (const skill of DISTRIBUTED_CLAUDE_SKILLS) {
    const skillPath = path.join(cwd, '.claude', 'skills', skill.name, 'SKILL.md');
    const skillRelative = `.claude/skills/${skill.name}/SKILL.md`;
    const skillResult = scaffoldClaudeSkill(skillPath, skill.content, {
      force: opts?.forceSkillRefresh === true,
    });

    // Per W3.5 (mmnto-ai/totem#2008): the per-file warn fires ONLY on the
    // no-marker suppression path. Marker-bearing refreshes (which ride the
    // normal `refreshed`/`unchanged` path) emit no warning — keeps the
    // signal-to-noise discipline tight (locked by invariant 8 in the spec).
    if (skillResult.forceSuppressed === true) {
      const { log } = await import('../ui.js');
      log.warn(
        'Totem',
        `Force-overwriting ${skillRelative}: no canonical markers found, user content overwritten`,
      );
    }

    const mappedAction: HookInstallerResult['action'] =
      skillResult.action === 'created'
        ? 'created'
        : skillResult.action === 'refreshed'
          ? 'merged'
          : skillResult.action === 'unchanged'
            ? 'exists'
            : 'skipped';
    results.push({
      file: skillRelative,
      action: mappedAction,
      ...(skillResult.forceSuppressed === true
        ? {
            summaryActionOverride:
              'Force-overwritten: no canonical markers found, user content overwritten',
          }
        : {}),
      ...(skillResult.err ? { err: skillResult.err } : {}),
    });
  }

  return results;
}

/**
 * Install or refresh a Claude Code skill file at the target path using
 * marker-based replacement. The canonical content lives between
 * `SKILL_MARKER_START` and `SKILL_MARKER_END`; content AFTER the end marker
 * is user-customization territory and survives across refreshes (Phase C
 * slice 3 design doc, mmnto-ai/totem#1890).
 *
 * Outcomes:
 * - `created` — file didn't exist; wrote canonical
 * - `refreshed` — file existed with markers; replaced inside-marker content,
 *   preserved everything after the end marker
 * - `unchanged` — file existed with markers and the merged content was
 *   byte-identical to the existing content
 * - `preserved` — file exists without the end marker (user-authored,
 *   pre-marker scaffold, or malformed); skipped to preserve user content.
 *   Surfaces a warning hint via `err` so callers can log a migration nudge.
 */
export function scaffoldClaudeSkill(
  filePath: string,
  canonicalContent: string,
  options?: { force?: boolean },
): {
  action: 'created' | 'refreshed' | 'unchanged' | 'preserved';
  /** True only when the no-marker guard was suppressed by `options.force`.
   *  Lets callers emit the destructive-by-consent warning + summary line
   *  surface (W3.5, mmnto-ai/totem#2008). */
  forceSuppressed?: boolean;
  err?: string;
} {
  try {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, canonicalContent, 'utf-8');
      return { action: 'created' };
    }

    const existing = fs.readFileSync(filePath, 'utf-8');
    const existingEnd = existing.indexOf(SKILL_MARKER_END);
    const existingStart = existing.indexOf(SKILL_MARKER_START);

    // No-marker guard: file exists without canonical markers — either a user-
    // authored skill or a malformed totem scaffold. Default behavior is
    // preserve (return a migration hint via `err`). When `options.force === true`,
    // the guard is suppressed: overwrite with canonical content and set
    // `forceSuppressed` so the caller can surface the destructive event.
    if (existingStart === -1 || existingEnd === -1 || existingStart > existingEnd) {
      if (options?.force === true) {
        fs.writeFileSync(filePath, canonicalContent, 'utf-8');
        return { action: 'refreshed', forceSuppressed: true };
      }
      return {
        action: 'preserved',
        err: `Skill file exists without canonical markers — preserving. To pick up the canonical refresh, move custom content below \`${SKILL_MARKER_END}\` (see mmnto-ai/totem#1890 migration checklist). Or pass \`--force-skill-refresh\` to overwrite (user content will be lost).`,
      };
    }

    const canonicalEnd = canonicalContent.indexOf(SKILL_MARKER_END);
    if (canonicalEnd === -1) {
      // Canonical content is missing its own end marker — shouldn't happen
      // (the source-of-truth invariant test guards this), but degrade safely.
      return {
        action: 'preserved',
        err: 'Canonical skill content is missing its end marker — preserving existing file.',
      };
    }

    const canonicalThroughEnd = canonicalContent.slice(0, canonicalEnd + SKILL_MARKER_END.length);
    const existingAfterEnd = existing.slice(existingEnd + SKILL_MARKER_END.length);
    const merged = canonicalThroughEnd + existingAfterEnd;

    if (merged === existing) {
      return { action: 'unchanged' };
    }

    fs.writeFileSync(filePath, merged, 'utf-8');
    return { action: 'refreshed' };
    // totem-context: intentional cleanup — preserve user's skill file on any IO failure rather than aborting init mid-flight; mirrors scaffoldFile's failure posture
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'preserved', err: `[Totem Error] ${message}` };
  }
}

// Wire up hook installers on the AI_TOOLS entries that need them.
// The AI_TOOLS array is defined in init-detect.ts without hook installers
// (to avoid circular deps), so we attach them here.
const claudeTool = AI_TOOLS.find((t) => t.name === 'Claude Code');
if (claudeTool) claudeTool.hookInstaller = installClaudeHooks;
const geminiTool = AI_TOOLS.find((t) => t.name === 'Gemini CLI');
if (geminiTool) geminiTool.hookInstaller = installGeminiHooks;

export function scaffoldMcpConfig(
  filePath: string,
  serverEntry: Record<string, unknown>,
): { action: 'created' | 'merged' | 'skipped'; err?: string } {
  try {
    if (!fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ mcpServers: { totem: serverEntry } }, null, 2) + '\n',
        'utf-8',
      );
      return { action: 'created' };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        action: 'skipped',
        err: `Could not parse ${path.basename(filePath)} (invalid JSON): ${message}`,
      };
    }

    if (
      parsed.mcpServers !== undefined &&
      (typeof parsed.mcpServers !== 'object' ||
        parsed.mcpServers === null ||
        Array.isArray(parsed.mcpServers))
    ) {
      return {
        action: 'skipped',
        err: `Could not merge config: "mcpServers" in ${path.basename(filePath)} must be an object.`,
      };
    }

    const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
    if ('totem' in servers) {
      return { action: 'skipped' };
    }

    servers.totem = serverEntry;
    parsed.mcpServers = servers;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: message };
  }
}

/**
 * Install the Universal AI Developer Baseline lessons into the lessons file.
 * Returns 'installed', 'exists' (already present), or 'skipped' (user declined).
 * In non-TTY mode (CI), defaults to installing without prompting.
 */
export async function installBaselineLessons(
  baselinePath: string,
  rl: import('node:readline/promises').Interface,
  ecosystems?: Ecosystem[],
): Promise<'installed' | 'exists' | 'skipped'> {
  const { UNIVERSAL_BASELINE_LESSONS, UNIVERSAL_BASELINE_MARKER } =
    await import('../assets/universal-baseline.js');
  const { log } = await import('../ui.js');

  try {
    if (fs.existsSync(baselinePath)) {
      const existing = fs.readFileSync(baselinePath, 'utf-8');
      if (
        existing.includes(UNIVERSAL_BASELINE_MARKER) ||
        existing.includes('<!-- totem:baseline -->')
      )
        return 'exists';
    }

    // In non-TTY mode (CI, piped input), default to installing
    let declined = false;
    if (process.stdin.isTTY) {
      const answer = await rl.question('Install baseline lessons? (Y/n): ');
      declined = answer.trim().toLowerCase() === 'n' || answer.trim().toLowerCase() === 'no';
    }

    if (declined) return 'skipped';

    const dir = path.dirname(baselinePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Build combined baseline: universal (core + JS) + detected ecosystem packs
    const { PYTHON_BASELINE, RUST_BASELINE, GO_BASELINE } =
      await import('../assets/baseline-packs.js');
    const allLessons = [...UNIVERSAL_BASELINE_LESSONS];
    const packs: string[] = [];
    if (ecosystems?.includes('python')) {
      allLessons.push(...PYTHON_BASELINE);
      packs.push('Python');
    }
    if (ecosystems?.includes('rust')) {
      allLessons.push(...RUST_BASELINE);
      packs.push('Rust');
    }
    if (ecosystems?.includes('go')) {
      allLessons.push(...GO_BASELINE);
      packs.push('Go');
    }
    if (packs.length > 0) {
      log.info('Totem', `Adding ${packs.join(', ')} baseline lessons`);
    }

    const markdown = [
      UNIVERSAL_BASELINE_MARKER,
      '',
      ...allLessons.map(
        (l) => `## Lesson — ${l.heading}\n\n**Tags:** ${l.tags.join(', ')}\n\n${l.body}`,
      ),
    ].join('\n\n');

    fs.writeFileSync(baselinePath, markdown, 'utf-8');
    return 'installed';
  } catch (err) {
    log.warn(
      'Totem',
      `Could not install baseline lessons: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'skipped';
  }
}

// ─── Reflex detection & upgrade ──────────────────────────

export type ReflexStatus = 'current' | 'outdated' | 'missing';

/** Detect whether the reflex block in a file is current, outdated, or missing. */
export function detectReflexStatus(content: string): ReflexStatus {
  // Check for versioned sentinel first
  const versionMatch = content.match(REFLEX_VERSION_RE);
  if (versionMatch) {
    const version = parseInt(versionMatch[1]!, 10);
    return version >= REFLEX_VERSION ? 'current' : 'outdated';
  }

  // Legacy sentinel — injected by older totem versions without version markers
  if (content.includes(LEGACY_SENTINEL) || content.includes('Totem Memory Reflexes')) {
    return 'outdated';
  }

  return 'missing';
}

/**
 * Upgrade a reflex block from legacy (v1, no boundaries) or older versioned
 * blocks to the current version. Returns the updated file content.
 *
 * Strategy:
 * - If start/end boundaries exist, replace between them (clean swap).
 * - If only the legacy sentinel exists (v1), find the block start and
 *   look for the next user-owned `## ` heading or EOF as the boundary.
 * - If the boundary can't be determined cleanly, append the new block
 *   and set `clean: false` so the caller can warn about manual cleanup.
 */
export function upgradeReflexes(content: string): { content: string; clean: boolean } {
  // Case 1: Has start/end boundaries (versioned block from a previous version)
  const startIdx = content.indexOf(REFLEX_START);
  const endIdx = content.indexOf(REFLEX_END);

  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    const before = content.slice(0, startIdx).replace(/\n+$/, '\n');
    const after = content.slice(endIdx + REFLEX_END.length);
    return { content: before + AI_PROMPT_BLOCK + after, clean: true };
  }

  // Case 2: Legacy block (v1) — no boundaries, appended at end of file
  const legacyIdx = content.indexOf(LEGACY_SENTINEL);
  if (legacyIdx !== -1) {
    // Walk backwards to include any leading whitespace before the heading
    let blockStart = legacyIdx;
    while (blockStart > 0 && content[blockStart - 1] === '\n') blockStart--;

    // Find the end: the next ## heading that isn't part of the Totem block, or EOF
    const afterLegacy = content.slice(legacyIdx);
    // Match a `\n## ` followed by text that is NOT "Totem AI" (user content after the block)
    const nextH2 = afterLegacy.match(/\r?\n## (?!Totem AI Integration)/);
    const blockEnd = nextH2?.index !== undefined ? legacyIdx + nextH2.index : content.length;

    const before = content.slice(0, blockStart);
    const after = content.slice(blockEnd);
    return { content: before + AI_PROMPT_BLOCK + after, clean: true };
  }

  // Case 3: Has "Totem Memory Reflexes" text but not the standard heading — can't locate cleanly
  return { content: content + '\n' + AI_PROMPT_BLOCK, clean: false };
}

/** Inject or upgrade reflex block in an AI context file. */
function injectReflexes(filePath: string): 'injected' | 'current' | 'missing' | 'outdated' {
  if (!fs.existsSync(filePath)) return 'missing';

  const content = fs.readFileSync(filePath, 'utf-8');
  const status = detectReflexStatus(content);

  if (status === 'current') return 'current';
  if (status === 'missing') {
    fs.appendFileSync(filePath, AI_PROMPT_BLOCK);
    return 'injected';
  }

  // 'outdated' — defer to caller for user confirmation
  return 'outdated';
}

/** Apply the reflex upgrade to a file. Returns true if clean, false if manual cleanup needed. */
function applyReflexUpgrade(filePath: string): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { content: updated, clean } = upgradeReflexes(content);
  fs.writeFileSync(filePath, updated, 'utf-8');
  return clean;
}

interface InitSummaryEntry {
  file: string;
  action: string;
}

export async function initCommand(options?: {
  bare?: boolean;
  pilot?: boolean;
  strict?: boolean;
  global?: boolean;
  /** Force-overwrite distributed skill files lacking canonical markers
   *  (W3.5, mmnto-ai/totem#2008). Default behavior preserves user-authored
   *  or pre-marker scaffold files; force-mode suppresses ONLY the no-marker
   *  guard. Marker-bearing files refresh via the normal path regardless. */
  forceSkillRefresh?: boolean;
  /** Install action-gate PreToolUse hooks (PR-C, mmnto-ai/totem#2048): a
   *  comma-list of gate names (validated against `knownGateEvents()`) or
   *  the literal `all`. Routes through the SAME `installGates` path the
   *  `gate install` verb uses — no second copy of the merge logic. */
  gates?: string;
  /** Wire `orient.parityManifest` to the installed doctrine pin and exit
   *  (mmnto-ai/totem#2088, Proposal 292 S1). Non-interactive; honest-absent
   *  when the `@mmnto/strategy-doctrine` pin is not installed. */
  doctrine?: boolean;
  /** Override home directory for testing. */
  _homeDir?: string;
}): Promise<void> {
  // ─── Doctrine pin wiring (mmnto-ai/totem#2088, Proposal 292 S1) ───
  // Self-contained non-interactive path: point orient.parityManifest at the
  // installed @mmnto/strategy-doctrine pin so `totem doctor --parity` stops
  // honest-absent-SKIPping. Mirrors the --global early-return shape.
  if (options?.doctrine) {
    const { log } = await import('../ui.js');
    const { TotemConfigError } = await import('@mmnto/totem');
    const { DOCTRINE_PIN_PACKAGE, wireDoctrineManifest } = await import('./init-doctrine.js');

    const outcome = await wireDoctrineManifest(process.cwd(), options._homeDir);
    switch (outcome.kind) {
      case 'pin-absent':
        log.warn(
          'Totem',
          `Doctrine pin ${DOCTRINE_PIN_PACKAGE} is not installed (looked for ${outcome.manifestPath}).`,
        );
        log.info(
          'Totem',
          'Add it as a dependency, then re-run `totem init --doctrine`. Until then `totem doctor --parity` stays an honest skip.',
        );
        return;
      case 'no-config':
        throw new TotemConfigError(
          'No Totem configuration found in this repo.',
          'Run `totem init` first, then `totem init --doctrine`.',
          'CONFIG_MISSING',
        );
      case 'global-only':
        throw new TotemConfigError(
          'Only a global ~/.totem profile was found — the parity manifest is a per-repo setting.',
          'Run `totem init` in this repo first, then `totem init --doctrine`.',
          'CONFIG_MISSING',
        );
      case 'already-set':
        log.info(
          'Totem',
          `orient.parityManifest already configured in ${outcome.configPath}. Nothing to do.`,
        );
        return;
      case 'manual': {
        const where =
          outcome.reason === 'orient-exists'
            ? 'You already have an `orient` block — add this line inside it:'
            : 'Could not safely auto-edit this config — add this manually:';
        log.warn('Totem', `Could not auto-wire orient.parityManifest in ${outcome.configPath}.`);
        log.info('Totem', `${where}\n${outcome.snippet}`);
        return;
      }
      case 'written':
        log.success(
          'Totem',
          `Wired orient.parityManifest → ${outcome.manifestPath} in ${outcome.configPath}.`,
        );
        log.dim('Totem', 'Run `totem doctor --parity` to sense cohort drift.');
        return;
    }
  }

  // ─── Global profile shortcut ───────────────────────
  // totem-context: fs and path are static imports at top of file (lines 1-2)
  if (options?.global) {
    const os = await import('node:os');
    const { log } = await import('../ui.js');
    const { CONFIG_FILES } = await import('../utils.js');

    const globalDir = path.join(options._homeDir ?? os.homedir(), '.totem');

    // Create ~/.totem/ if it doesn't exist
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }

    // Check if global config already exists
    const existingGlobalConfig = CONFIG_FILES.map((f: string) => path.join(globalDir, f)).find(
      (p: string) => fs.existsSync(p),
    );

    const compiledRulesPath = path.join(globalDir, 'compiled-rules.json');
    if (existingGlobalConfig && fs.existsSync(compiledRulesPath)) {
      log.warn('Totem', `Global profile already exists at ${globalDir}`);
      log.dim('Totem', `Config: ${existingGlobalConfig}`);
      return;
    }

    // Write minimal global config (only if no config exists yet — don't clobber during repair)
    if (!existingGlobalConfig) {
      const configPath = path.join(globalDir, 'totem.config.ts');
      const configContent = `import type { TotemConfig } from '@mmnto/totem';

export default {
  totemDir: '.',
  targets: [
    { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
  ],
} satisfies TotemConfig;
`;
      fs.writeFileSync(configPath, configContent, 'utf-8');
    }

    // Install universal baseline compiled rules (global profile gets all packs —
    // project-specific init gates on detected ecosystems)
    try {
      const {
        COMPILED_BASELINE_RULES,
        NEW_TYPESCRIPT_RULES,
        COMPILED_NODEJS_BASELINE,
        COMPILED_SHELL_BASELINE,
        COMPILED_PYTHON_BASELINE,
        COMPILED_RUST_BASELINE,
        COMPILED_GO_BASELINE,
      } = await import('../assets/compiled-baseline.js');
      const allRules = [
        ...COMPILED_BASELINE_RULES,
        ...NEW_TYPESCRIPT_RULES,
        ...COMPILED_NODEJS_BASELINE,
        ...COMPILED_SHELL_BASELINE,
        ...COMPILED_PYTHON_BASELINE,
        ...COMPILED_RUST_BASELINE,
        ...COMPILED_GO_BASELINE,
      ];
      const payload = { version: 1, rules: allRules };
      fs.writeFileSync(compiledRulesPath, JSON.stringify(payload, null, 2) + '\n');
      log.success('Totem', `Global profile created at ${globalDir}`);
      log.success('Totem', `${allRules.length} baseline rules installed.`);
      log.info('Totem', 'Run `totem lint` in any directory to apply your personal rules.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('Totem', `Could not install baseline rules: ${msg}`);
    }

    return; // Skip the rest of interactive init
  }

  // ─── Standard project init ─────────────────────────
  const { stdin: input, stdout: output } = await import('node:process');
  const readline = await import('node:readline/promises');
  const { bold, brand, dim, log, printBanner, success } = await import('../ui.js');
  const { buildTargets, detectAiTools, detectEmbeddingTier, detectProject } =
    await import('./init-detect.js');
  const { installEnforcementHooks, installPostMergeHook } = await import('./install-hooks.js');

  const cwd = process.cwd();
  const { CONFIG_FILES } = await import('../utils.js');
  const totemDir = path.join(cwd, '.totem');

  // Check if ANY config format already exists
  const existingConfig = CONFIG_FILES.map((f) => path.join(cwd, f)).find((p) => fs.existsSync(p));
  const configExists = !!existingConfig;

  const rl = readline.createInterface({ input, output });
  const summary: InitSummaryEntry[] = [];

  try {
    printBanner();

    if (!configExists) {
      // --- Fresh install: generate config ---
      log.info('Totem', 'Scanning project...');

      let targets: IngestTarget[] = [];
      let embeddingTier: EmbeddingTier = detectEmbeddingTier(cwd);

      if (options?.bare) {
        log.info('Totem', `Initializing in ${bold('bare mode')} (non-code repository)`);
        targets = [
          { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
          { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
          { glob: '**/*.md', type: 'spec', strategy: 'markdown-heading' },
        ];
        embeddingTier = 'none'; // Force Lite tier for bare repos
      } else {
        const detected = detectProject(cwd);

        const detections: string[] = [];
        if (detected.hasTypeScript) detections.push('TypeScript');
        if (detected.hasSrc) detections.push('src/');
        if (detected.hasDocs) detections.push('docs/');
        if (detected.hasSpecs) detections.push('specs/');
        if (detected.hasContext) detections.push('context/');
        if (detected.hasSessions) detections.push('session logs');

        if (detections.length > 0) {
          log.info('Totem', `Detected: ${bold(detections.join(', '))}`);
        } else {
          log.dim('Totem', 'No specific project structure detected. Using markdown defaults.');
        }

        targets = buildTargets(detected);

        // Surface the Ollama floor expectation BEFORE embedding-tier
        // branching, so cloud-key auto-detection doesn't silently bury
        // Ollama as a no-quota fallback option (mmnto-ai/totem#1851).
        const ollamaFloor = await probeOllamaFloor();
        log.info('Totem', ollamaFloor.message);

        if (embeddingTier === 'openai') {
          log.info(
            'Totem',
            `Detected ${bold('OPENAI_API_KEY')} in environment. Using OpenAI embeddings.`,
          );
        } else if (embeddingTier === 'gemini') {
          log.info(
            'Totem',
            `Detected ${bold('GEMINI_API_KEY')} in environment. Using Gemini embeddings (single-key DX).`,
          );
        } else {
          // No key detected — prompt the user
          const answer = await rl.question(
            'Enter your OpenAI API key, type "ollama" for a local model, or press Enter for Lite tier: ',
          );

          const input = answer.trim().replace(/[\r\n]/g, '');
          if (input.toLowerCase() === 'ollama') {
            embeddingTier = 'ollama';
            log.info('Totem', 'Configured for Ollama. Make sure it is running locally.');
          } else if (input) {
            if (!/^sk-[a-zA-Z0-9_-]+$/.test(input)) {
              log.warn(
                'Totem',
                'API key does not look like a valid OpenAI key (expected sk-...). Starting in Lite tier.',
              );
            } else {
              const envPath = path.join(cwd, '.env');
              const envLine = `OPENAI_API_KEY="${input}"\n`;

              if (fs.existsSync(envPath)) {
                const existing = fs.readFileSync(envPath, 'utf-8');
                if (!/^\s*OPENAI_API_KEY\s*=/m.test(existing)) {
                  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
                  fs.appendFileSync(envPath, prefix + envLine);
                }
              } else {
                fs.writeFileSync(envPath, envLine);
              }

              embeddingTier = 'openai';
              summary.push({ file: '.env', action: 'Saved OpenAI API key' });
            }
          }
        }
      }

      if (embeddingTier === 'none') {
        log.info('Totem', `Starting in ${bold('Lite')} tier (add-lesson, bridge, eject only).`);
        if (!options?.bare) {
          log.dim(
            'Totem',
            'Set OPENAI_API_KEY and re-run `totem init` to unlock sync/search/shield.',
          );
        }
      }

      const { generateConfigForFormat } = await import('./init-templates.js');
      const detected = detectProject(cwd);
      const { content: configContent, filename: configFilename } = await generateConfigForFormat(
        detected.preferredConfigFormat,
        targets,
        embeddingTier,
        cwd,
      );
      const configPath = path.join(cwd, configFilename);

      // Inject pilot: true into the generated config when --pilot is set
      let finalConfigContent = configContent;
      if (options?.pilot) {
        if (configFilename.endsWith('.ts')) {
          // Insert `pilot: true,` before the closing `};`
          finalConfigContent = finalConfigContent.replace(/\n};\s*$/, '\n\n  pilot: true,\n};\n');
        } else if (configFilename.endsWith('.yaml') || configFilename.endsWith('.yml')) {
          finalConfigContent = finalConfigContent.trimEnd() + '\npilot: true\n';
        } else if (configFilename.endsWith('.toml')) {
          finalConfigContent = finalConfigContent.trimEnd() + '\npilot = true\n';
        }
      }

      // Inject hooks.tier into the generated config when --strict is set
      if (options?.strict) {
        if (configFilename.endsWith('.ts')) {
          finalConfigContent = finalConfigContent.replace(
            /\n};\s*$/,
            "\n\n  hooks: { tier: 'strict' },\n};\n",
          );
        } else if (configFilename.endsWith('.yaml') || configFilename.endsWith('.yml')) {
          finalConfigContent = finalConfigContent.trimEnd() + '\nhooks:\n  tier: strict\n';
        } else if (configFilename.endsWith('.toml')) {
          finalConfigContent = finalConfigContent.trimEnd() + '\n\n[hooks]\ntier = "strict"\n';
        }
      }

      fs.writeFileSync(configPath, finalConfigContent, 'utf-8');
      const tierLabel =
        embeddingTier === 'none'
          ? 'Lite'
          : embeddingTier === 'openai'
            ? 'Standard'
            : 'Standard (Ollama)';
      summary.push({
        file: configFilename,
        action: `Created with auto-detected targets (${tierLabel} tier)`,
      });
    } else {
      const configName = existingConfig ? path.basename(existingConfig) : 'config';
      log.dim('Totem', `${configName} already exists. Checking reflexes and hooks...`);
    }

    // --- Always run: .totem/ directory ---
    if (!fs.existsSync(totemDir)) {
      fs.mkdirSync(totemDir, { recursive: true });
    }

    // --- Pilot mode initialization ---
    if (options?.pilot) {
      const { readPilotState } = await import('../utils/pilot.js');
      readPilotState(totemDir); // initializes pilot-state.json if missing
      log.info(
        'Totem',
        'Pilot mode enabled (14 days / 50 pushes). Hooks will warn instead of block.',
      );
      summary.push({ file: '.totem/pilot-state.json', action: 'Initialized pilot state' });
    }

    const lessonsDir = path.join(totemDir, 'lessons');
    if (!fs.existsSync(lessonsDir)) {
      fs.mkdirSync(lessonsDir, { recursive: true });
      // .gitkeep for git tracking of empty directory
      const gitkeepPath = path.join(lessonsDir, '.gitkeep');
      if (!fs.existsSync(gitkeepPath)) {
        fs.writeFileSync(gitkeepPath, '', 'utf-8');
      }
      summary.push({ file: '.totem/lessons/', action: 'Created lessons directory' });
    }

    // --- Baseline lessons (core + detected ecosystem packs) ---
    const baselinePath = path.join(lessonsDir, 'baseline.md');
    const detectedEcosystems = detectProject(cwd).ecosystems;
    const baselineResult = await installBaselineLessons(baselinePath, rl, detectedEcosystems);
    if (baselineResult === 'installed') {
      const extraPacks = detectedEcosystems.filter((e) => e !== 'javascript');
      const packLabel = extraPacks.length > 0 ? ` + ${extraPacks.join(', ')}` : '';
      summary.push({
        file: '.totem/lessons/baseline.md',
        action: `Installed baseline lessons (core${packLabel})`,
      });
      // Ecosystems with pre-compiled rules — no need to prompt for compile
      const compiledEcosystems = new Set(['javascript', 'python', 'rust', 'go']);
      const uncompiledPacks = detectedEcosystems.filter((e) => !compiledEcosystems.has(e));
      if (uncompiledPacks.length > 0) {
        log.dim(
          'Totem',
          `${uncompiledPacks.join(', ')} lessons require compilation. Run \`totem compile\` to generate lint rules.`,
        );
      }
    }

    // --- Pre-compiled baseline rules (zero-LLM protection from Day 1) ---
    let baselineRuleCount = 0;
    const compiledRulesPath = path.join(totemDir, 'compiled-rules.json');
    if (!fs.existsSync(compiledRulesPath)) {
      try {
        const {
          COMPILED_BASELINE_RULES,
          NEW_TYPESCRIPT_RULES,
          COMPILED_NODEJS_BASELINE,
          COMPILED_SHELL_BASELINE,
          COMPILED_PYTHON_BASELINE,
          COMPILED_RUST_BASELINE,
          COMPILED_GO_BASELINE,
        } = await import('../assets/compiled-baseline.js');
        const allRules = [
          ...COMPILED_BASELINE_RULES,
          ...COMPILED_SHELL_BASELINE, // Always included — totem hooks are shell scripts
        ];
        if (detectedEcosystems.includes('javascript')) {
          allRules.push(...NEW_TYPESCRIPT_RULES, ...COMPILED_NODEJS_BASELINE);
        }
        if (detectedEcosystems.includes('python')) allRules.push(...COMPILED_PYTHON_BASELINE);
        if (detectedEcosystems.includes('rust')) allRules.push(...COMPILED_RUST_BASELINE);
        if (detectedEcosystems.includes('go')) allRules.push(...COMPILED_GO_BASELINE);
        baselineRuleCount = allRules.length;
        const payload = { version: 1, rules: allRules };
        fs.writeFileSync(compiledRulesPath, JSON.stringify(payload, null, 2) + '\n');
        summary.push({
          file: '.totem/compiled-rules.json',
          action: `Installed ${baselineRuleCount} pre-compiled baseline rules`,
        });
      } catch (err) {
        log.dim(
          'Totem',
          `Could not install pre-compiled rules: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      // File already exists — read the rule count for the post-init message
      try {
        const existing = JSON.parse(fs.readFileSync(compiledRulesPath, 'utf-8'));
        baselineRuleCount = Array.isArray(existing?.rules) ? existing.rules.length : 0;
      } catch {
        // Parse failure — leave count as 0
      }
    }

    if (options?.bare) {
      log.info('Totem', 'Skipping AI tool and hook installation for bare mode.');
    } else {
      // --- Unified AI tool selection ---
      const detectedTools = detectAiTools(cwd);

      if (detectedTools.length > 0) {
        const toolNames = detectedTools.map((t) => t.name).join(', ');
        log.info('Totem', `Detected AI tools: ${bold(toolNames)}`);
        const toolAnswer = await rl.question(
          'Which tools should Totem configure? [all/none/select] (default: all): ',
        );

        let selectedTools: AiToolInfo[];
        const trimmed = toolAnswer.trim().toLowerCase();

        if (trimmed === 'none') {
          selectedTools = [];
        } else if (trimmed === 'select') {
          selectedTools = [];
          for (const tool of detectedTools) {
            const pick = await rl.question(`  Configure ${tool.name}? (Y/n): `);
            if (pick.trim().toLowerCase() !== 'n' && pick.trim().toLowerCase() !== 'no') {
              selectedTools.push(tool);
            }
          }
        } else {
          // 'all' or Enter (default)
          selectedTools = detectedTools;
        }

        // --- MCP scaffolding for selected tools ---
        for (const tool of selectedTools) {
          if (!tool.mcpPath || !tool.serverEntry) continue;
          const filePath = path.join(cwd, tool.mcpPath);
          const result = scaffoldMcpConfig(filePath, tool.serverEntry);

          if (result.err) {
            log.error('Totem Error', result.err); // totem-ignore — result.err is internal scaffolding error, not LLM output
            console.error(
              `To fix this, add the following manually to your ${tool.mcpPath} under "mcpServers":\n`,
            );
            console.error(`  "totem": ${JSON.stringify(tool.serverEntry, null, 2)}\n`);
          } else if (result.action === 'created') {
            summary.push({ file: tool.mcpPath, action: `Created with Totem MCP server` });
          } else if (result.action === 'merged') {
            summary.push({ file: tool.mcpPath, action: `Added totem to mcpServers` });
          }
        }

        // --- Reflex injection & upgrade for selected tools ---
        const outdatedFiles: Array<{ tool: AiToolInfo; filePath: string }> = [];

        for (const tool of selectedTools) {
          if (!tool.reflexFile) continue;
          const filePath = path.join(cwd, tool.reflexFile);
          try {
            const result = injectReflexes(filePath);
            if (result === 'injected') {
              summary.push({ file: tool.reflexFile, action: 'Injected memory reflexes (v2)' });
            } else if (result === 'outdated') {
              outdatedFiles.push({ tool, filePath });
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.error(
              'Totem Error',
              `Failed to inject reflexes into ${tool.reflexFile}: ${message}`,
            );
          }
        }

        // Prompt once for all outdated reflex files
        if (outdatedFiles.length > 0) {
          const fileList = outdatedFiles.map((f) => f.tool.reflexFile).join(', ');
          log.warn('Totem', `Outdated reflexes found in: ${bold(fileList)}`);

          let shouldUpgrade = false;
          if (process.stdin.isTTY) {
            const answer = await rl.question(`Upgrade reflexes to v${REFLEX_VERSION}? (Y/n): `);
            shouldUpgrade =
              answer.trim().toLowerCase() !== 'n' && answer.trim().toLowerCase() !== 'no';
          } else {
            // Non-TTY (CI/scripted): auto-upgrade to match baseline lessons behavior
            shouldUpgrade = true;
            log.info('Totem', 'Non-interactive mode — auto-upgrading reflexes.');
          }

          if (shouldUpgrade) {
            for (const { tool, filePath } of outdatedFiles) {
              try {
                const clean = applyReflexUpgrade(filePath);
                if (clean) {
                  summary.push({
                    file: tool.reflexFile!,
                    action: `Upgraded reflexes to v${REFLEX_VERSION}`,
                  });
                } else {
                  summary.push({
                    file: tool.reflexFile!,
                    action: `Appended v${REFLEX_VERSION} reflexes (manual cleanup needed — remove old block)`,
                  });
                  log.warn(
                    'Totem',
                    `Could not cleanly replace old reflexes in ${tool.reflexFile}. New block appended — please remove the old one manually.`,
                  );
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log.error(
                  'Totem Error',
                  `Failed to upgrade reflexes in ${tool.reflexFile}: ${message}`,
                );
              }
            }
          } else {
            for (const { tool } of outdatedFiles) {
              summary.push({
                file: tool.reflexFile!,
                action: 'Outdated reflexes — upgrade declined',
              });
            }
          }
        }

        // --- Hook installation for selected tools ---
        for (const tool of selectedTools) {
          if (!tool.hookInstaller) continue;
          const results = await tool.hookInstaller(cwd, {
            forceSkillRefresh: options?.forceSkillRefresh === true,
          });
          for (const result of results) {
            if (result.err) {
              log.error('Totem Error', `Hook scaffolding failed for ${result.file}: ${result.err}`); // totem-ignore — internal hook installer error
            } else if (result.action === 'created') {
              summary.push({
                file: result.file,
                action: result.summaryActionOverride ?? `Scaffolded ${tool.name} hook`,
              });
            } else if (result.action === 'merged') {
              summary.push({
                file: result.file,
                action:
                  result.summaryActionOverride ?? `Merged ${tool.name} hook into existing config`,
              });
            }
          }
        }
      }

      // --- Always run: enforcement hooks (pre-commit + pre-push) ---
      const hookTier = options?.strict ? 'strict' : undefined;
      const enforcement = await installEnforcementHooks(cwd, rl, { tier: hookTier });
      if (enforcement.preCommit === 'installed' || enforcement.preCommit === 'appended') {
        summary.push({
          file: '.git/hooks/pre-commit',
          action: `${enforcement.preCommit === 'installed' ? 'Installed' : 'Appended'} main-branch protection`,
        });
      } else if (enforcement.preCommit === 'skipped-non-shell') {
        summary.push({
          file: '.git/hooks/pre-commit',
          action: 'Skipped — non-shell hook detected (manual integration needed)',
        });
      }
      if (enforcement.prePush === 'installed' || enforcement.prePush === 'appended') {
        summary.push({
          file: '.git/hooks/pre-push',
          action: `${enforcement.prePush === 'installed' ? 'Installed' : 'Appended'} deterministic shield gate`,
        });
      } else if (enforcement.prePush === 'skipped-non-shell') {
        summary.push({
          file: '.git/hooks/pre-push',
          action: 'Skipped — non-shell hook detected (manual integration needed)',
        });
      }

      // --- Always run: post-merge git hook ---
      await installPostMergeHook(cwd, rl);

      // --- Always run: .gitignore ---
      const gitignorePath = path.join(cwd, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
        if (!gitignore.includes('.lancedb')) {
          fs.appendFileSync(gitignorePath, '\n# Totem\n.lancedb/\n');
          summary.push({ file: '.gitignore', action: 'Added .lancedb/ exclusion' });
        }
        // Ensure secrets.json is gitignored (safety net — add-secret also does this)
        const refreshed = fs.readFileSync(gitignorePath, 'utf-8');
        const lines = refreshed.split(/\r?\n/);
        if (!lines.some((line) => line.trim() === '.totem/secrets.json')) {
          const separator = refreshed.endsWith('\n') ? '' : '\n';
          fs.writeFileSync(gitignorePath, `${refreshed}${separator}.totem/secrets.json\n`, 'utf-8');
          summary.push({ file: '.gitignore', action: 'Added .totem/secrets.json exclusion' });
        }
      } else {
        // No .gitignore exists yet — create one with .lancedb/ and secrets entry
        fs.writeFileSync(gitignorePath, '# Totem\n.lancedb/\n.totem/secrets.json\n', 'utf-8');
        summary.push({
          file: '.gitignore',
          action: 'Created with .lancedb/ and .totem/secrets.json exclusions',
        });
      }

      // --- Auto-ingest cursor rules (ADR-048) ---
      const { scanCursorInstructions } = await import('@mmnto/totem');
      const cursorInstructions = scanCursorInstructions(cwd);
      if (cursorInstructions.length > 0) {
        const answer = await rl.question(
          `\nFound ${cursorInstructions.length} existing AI rule(s) (.cursorrules / .mdc). Compile into deterministic invariants? (Y/n): `,
        );
        if (answer.trim().toLowerCase() !== 'n' && answer.trim().toLowerCase() !== 'no') {
          try {
            const { compileCommand } = await import('./compile.js');
            await compileCommand({ fromCursor: true });
            summary.push({
              file: '.totem/compiled-rules.json',
              action: `Compiled ${cursorInstructions.length} cursor rule(s) into invariants`,
            });
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            log.warn('Totem', `Could not compile cursor rules: ${detail}`);
          }
        }
      }
    } // end of bare mode else block

    // --- Always run: action-gate install (--gates=, PR-C mmnto-ai/totem#2048) ---
    // Thin sugar that is INTENTIONALLY outside the bare-mode branch: gate
    // opt-in is an independent, explicit flag (it works in bare repos too).
    // Parses the comma-list (or `all`), validates each member against
    // knownGateEvents() (fail loud on unknown), and routes through the SAME
    // installGates() path the `gate install` verb uses — no second copy of
    // the merge logic.
    if (options?.gates) {
      const { resolveGateEvents } = await import('./gate.js');
      const { installGates } = await import('./gate-install.js');
      const { TotemError, knownGateEvents } = await import('@mmnto/totem');
      const requested = options.gates.trim();
      let gateEvents: string[];
      if (requested.toLowerCase() === 'all') {
        gateEvents = await resolveGateEvents({ all: true });
      } else {
        const names = requested
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n.length > 0);
        // Empty after parse/trim/filter (e.g. `--gates=,` or whitespace-only):
        // fail loud rather than scaffolding an orphan wrapper with no entry.
        // Restores parity with the verb's resolveGateEvents no-selection
        // fail-loud (no default-install).
        if (names.length === 0) {
          throw new TotemError(
            'GATE_INVALID',
            'No gate selected in --gates=.',
            `Pass --gates=all or one of: ${knownGateEvents().join(', ')}.`,
          );
        }
        gateEvents = [];
        for (const name of names) {
          // resolveGateEvents validates a single name against the registry
          // and throws (fail-loud) on unknown — no default-install.
          const [validated] = await resolveGateEvents({ name });
          // resolveGateEvents returns a non-empty array or throws, so this
          // never fires today — but guard explicitly (no fragile `!`): fail
          // loud rather than push `undefined` if it ever returns empty.
          if (!validated) {
            throw new TotemError(
              'GATE_INVALID',
              `Gate "${name}" did not resolve.`,
              'This is an internal error — the gate registry returned no event for a validated name.',
            );
          }
          gateEvents.push(validated);
        }
      }

      // Tier is derived from the existing init options (pilot vs strict) and
      // BAKED into the installed command at install time (the wrapper reads it
      // ONLY from argv — no env override). Default install bakes --strict.
      const gateTier = options?.pilot ? 'pilot' : 'strict';
      const gateResults = installGates(cwd, gateEvents, gateTier);
      for (const result of gateResults) {
        if (result.err) {
          log.error('Totem Error', `Gate install failed for ${result.file}: ${result.err}`);
        } else if (result.action === 'created') {
          summary.push({
            file: result.file,
            action: result.event ? `Scaffolded gate "${result.event}"` : 'Scaffolded gate wrapper',
          });
        } else if (result.action === 'merged') {
          summary.push({
            file: result.file,
            action: `Installed gate "${result.event}" into existing config`,
          });
        } else if (result.action === 'updated') {
          // Tier switch on a re-init — the one existing entry was rewritten in
          // place (NOT the misleading "already present — no change" no-op).
          summary.push({
            file: result.file,
            action: `Updated gate "${result.event}" tier to ${gateTier}`,
          });
        }
      }
    }

    // --- Print summary ---
    if (summary.length > 0) {
      console.error(`\n${brand('--- Totem Init Summary ---')}`);
      for (const entry of summary) {
        console.error(`  ${success('OK')} ${dim(entry.file)} — ${entry.action}`);
      }
      console.error(brand('--------------------------'));
    }

    log.success(
      'Totem',
      options?.bare
        ? `Init complete.${baselineRuleCount ? ` ${baselineRuleCount} baseline rules are active.` : ''}\n` +
            '[Totem] Try it: write an empty `catch(e) {}` block and run `npx totem lint` — watch what happens.'
        : 'Init complete. Run `totem sync` to index your project.',
    );
  } finally {
    rl.close();
  }
}

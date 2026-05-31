// ─── Host-hook settings-merge primitive (namespace-neutral) ──────────
//
// The single source of truth for idempotently merging ONE hook entry into a
// Claude settings JSON file (`settings.local.json` or committed
// `settings.json`) under `hooks.<key>`. Extracted from init.ts (PR-C,
// mmnto-ai/totem#2048) so `gate install`, `init --gates=`, and later
// Prop 257 / mmnto-ai/totem-strategy#448 share one merger — the
// "namespace-neutral install primitive" strategy-claude's T0225Z asked for.
//
// Deliberately NOT a vendor-neutral `installHostHook(vendor)` abstraction
// (YAGNI per ADR-109: the gate floor is Claude/PreToolUse-portability-
// conditional; no Gemini gate consumer exists — Gemini uses a separate
// whole-file scaffold path).

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

// Zod schema for the subset of a Claude settings JSON file that we validate.
// `.passthrough()` everywhere preserves unknown keys across read/write so the
// merge never drops user-defined config it does not understand.
export const HookCommandSchema = z.union([
  z.string(),
  z.object({ type: z.string(), command: z.string() }).passthrough(),
]);

const PreToolUseEntrySchema = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(HookCommandSchema).optional(),
  })
  .passthrough();

const SessionStartEntrySchema = z
  .object({
    // SessionStart entries do NOT carry a `matcher` field (unlike
    // PreToolUse entries). Adding it here would silently drop unknown
    // shapes; passthrough preserves any future fields without breaking
    // round-trip read/write.
    hooks: z.array(HookCommandSchema).optional(),
  })
  .passthrough();

export const ClaudeSettingsSchema = z
  .object({
    hooks: z
      .object({
        PreToolUse: z.array(PreToolUseEntrySchema).optional(),
        SessionStart: z.array(SessionStartEntrySchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ParsedSettings = z.infer<typeof ClaudeSettingsSchema>;

/** PreToolUse matcher values Totem installs under. */
export type PreToolUseMatcher = 'Bash' | 'Write|Edit';

/** Outcome of a settings-merge attempt. */
export type ScaffoldOutcome = { action: 'created' | 'merged' | 'skipped'; err?: string };

/** The `hooks.<key>` lifecycle a merge targets. */
export type ClaudeHooksKey = 'PreToolUse' | 'SessionStart';

/**
 * Structural shape of a single hook entry. Widened from the closed
 * 3-template `ClaudeHookEntry` union that lived in init.ts so a
 * gate-wrapper entry (`{ matcher: 'Write|Edit', hooks: [{ type, command }] }`)
 * is a valid argument without enumerating every concrete template. Any entry
 * carrying a `hooks` array of `{ type, command }` objects (optionally a
 * `matcher` / `timeout`) is accepted; passthrough fields (e.g. `timeout`) are
 * preserved by the merge because the entry is written verbatim.
 */
export interface HostHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/**
 * Outcome of the shared read+ensure-dir+parse+safeParse step.
 *
 * - `absent`  — the settings file does not exist yet (caller writes a fresh
 *               config and returns `'created'`).
 * - `parsed`  — the file exists and validated against `ClaudeSettingsSchema`.
 * - `shape-error` — the file is valid JSON but the wrong shape; the caller
 *                   surfaces `err` as a `'skipped'` outcome (never throws).
 *
 * Invalid JSON is NOT represented here: `readAndParseSettings` THROWS for that
 * case so the caller's `try/catch` maps it to a prefixed `[Totem Error]`,
 * preserving the exact behavior `mergeClaudeHooksKey` had before extraction.
 */
type SettingsReadResult =
  | { kind: 'absent' }
  | { kind: 'parsed'; parsed: ParsedSettings }
  | { kind: 'shape-error'; err: string };

/**
 * Shared read step for the settings-merge family: ensure the parent dir
 * exists, then (if the file is present) read → JSON.parse → safeParse against
 * `ClaudeSettingsSchema`. Extracted so `mergeClaudeHooksKey` (append) and
 * `upsertClaudeHookCommand` (in-place update) share ONE read+validate path
 * without either re-implementing it. Behavior is byte-identical to the inline
 * version `mergeClaudeHooksKey` carried before: same dir-create, same
 * invalid-JSON throw, same shape-error message.
 */
function readAndParseSettings(filePath: string): SettingsReadResult {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    return { kind: 'absent' };
  }

  const fileName = path.basename(filePath);
  const raw = fs.readFileSync(filePath, 'utf-8');
  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[Totem Error] Could not parse ${fileName} (invalid JSON)`, {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }

  const result = ClaudeSettingsSchema.safeParse(rawParsed);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    // Prefix not added here — call site (initCommand) emits via
    // log.error('Totem Error', ...) which adds the prefix automatically.
    return {
      kind: 'shape-error',
      err: `Could not merge config: ${fileName} has unexpected shape: ${detail}`,
    };
  }

  return { kind: 'parsed', parsed: result.data };
}

/**
 * Shared merge logic for installing a single hook entry into a Claude
 * settings JSON file (`settings.local.json` or `settings.json`) under
 * `hooks.<key>`. Both `PreToolUse` and `SessionStart` lifecycles share
 * the same read → safeparse → idempotency probe → append → write shape;
 * this is the single source of truth.
 *
 * Idempotent: returns `'skipped'` if `alreadyInstalled(parsed)` is true.
 */
export function mergeClaudeHooksKey(
  filePath: string,
  hookKind: ClaudeHooksKey,
  entry: HostHookEntry,
  alreadyInstalled: (parsed: ParsedSettings) => boolean,
): ScaffoldOutcome {
  try {
    const read = readAndParseSettings(filePath);

    if (read.kind === 'absent') {
      const fullConfig = { hooks: { [hookKind]: [entry] } };
      fs.writeFileSync(filePath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf-8');
      return { action: 'created' };
    }
    if (read.kind === 'shape-error') {
      return { action: 'skipped', err: read.err };
    }

    const parsed = read.parsed;
    if (alreadyInstalled(parsed)) {
      return { action: 'skipped' };
    }

    const existing = parsed.hooks?.[hookKind] ?? [];
    const hooks = parsed.hooks ?? {};
    hooks[hookKind] = [...existing, entry];
    parsed.hooks = hooks;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
    // totem-context: intentional — mergeClaudeHooksKey is a Result-returning installer; failures are reported to the caller via ScaffoldOutcome.err (surfaced by initCommand's log.error), never silently swallowed. Rethrowing would break the callers that branch on { action, err }, so Tenet 4 is satisfied by reporting the failure, not by throwing.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: 'skipped',
      err: message.startsWith('[Totem Error]') ? message : `[Totem Error] ${message}`,
    };
  }
}

/** Outcome of a tier-aware `PreToolUse` command upsert. */
export type HookUpsertOutcome = {
  /**
   * `created` — fresh settings file written; `merged` — a new entry appended;
   * `updated` — an existing matching entry's command rewritten in place (e.g.
   * a tier switch); `skipped` — the desired command was already present (true
   * no-op) or the file had an unexpected shape (with `err`).
   */
  action: 'created' | 'merged' | 'updated' | 'skipped';
  err?: string;
};

/**
 * Tier-AWARE upsert of a single `PreToolUse` command into a Claude settings
 * JSON file under `hooks.PreToolUse`. Unlike `mergeClaudeHooksKey` (which only
 * ever appends or no-ops), this guarantees AT MOST ONE entry can match
 * `(matcher, identifies)` and rewrites that entry's command in place when it
 * differs from `desiredEntry`'s command — so re-installing the same gate at a
 * different tier flips the baked command rather than silently no-opping or
 * duplicating the entry.
 *
 * `identifies(command)` decides whether an existing hook command is "the same
 * gate" (tier-INDEPENDENT). `desiredEntry` carries the canonical
 * matcher + the single hook whose `command` is the tier-correct target.
 *
 * Cases:
 *   1. no existing match  → append `desiredEntry`           → `merged` (or
 *      `created` if the file did not exist)
 *   2. match, same command → no write                        → `skipped`
 *   3. match, different command → rewrite that hook's command → `updated`
 *
 * Result-returning (never throws past its own boundary), mirroring
 * `mergeClaudeHooksKey`'s contract so callers branch on `{ action, err }`.
 */
export function upsertClaudeHookCommand(
  filePath: string,
  matcher: PreToolUseMatcher,
  desiredEntry: HostHookEntry,
  identifies: (command: string) => boolean,
): HookUpsertOutcome {
  try {
    const desiredCommand = desiredEntry.hooks[0]?.command;
    if (typeof desiredCommand !== 'string') {
      // Programmer error in the caller, not a user-file condition — fail loud.
      throw new Error('[Totem Error] upsertClaudeHookCommand: desiredEntry has no command');
    }

    const read = readAndParseSettings(filePath);

    if (read.kind === 'absent') {
      const fullConfig = { hooks: { PreToolUse: [desiredEntry] } };
      fs.writeFileSync(filePath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf-8');
      return { action: 'created' };
    }
    if (read.kind === 'shape-error') {
      return { action: 'skipped', err: read.err };
    }

    const parsed = read.parsed;
    const hooks = parsed.hooks ?? {};
    const entries = parsed.hooks?.PreToolUse ?? [];

    // Find the single existing hook (entry index + hook index) that installs
    // this same gate under the gate matcher, tier-independently. This installer
    // never CREATES a second matching entry (it updates in place or appends when
    // none), so a file it produced has at most one match per gate. It does NOT
    // dedupe PRE-EXISTING duplicates (e.g. a hand-edited config): it updates the
    // first match and leaves any others as-is.
    for (const entry of entries) {
      if (entry.matcher !== matcher || !Array.isArray(entry.hooks)) {
        continue;
      }
      for (const hook of entry.hooks) {
        const cmd = typeof hook === 'string' ? hook : hook.command;
        if (typeof cmd !== 'string' || !identifies(cmd)) {
          continue;
        }
        // Case 2: already the desired command (same tier) → true no-op.
        if (cmd === desiredCommand) {
          return { action: 'skipped' };
        }
        // Case 3: same gate, different command (tier switch) → update in place.
        // Object hooks are rewritten on `.command`; the degenerate
        // string-hook shape is replaced with the canonical object hook.
        if (typeof hook === 'string') {
          const hookList = entry.hooks as unknown[];
          hookList[hookList.indexOf(hook)] = { type: 'command', command: desiredCommand };
        } else {
          hook.command = desiredCommand;
        }
        parsed.hooks = hooks;
        fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
        return { action: 'updated' };
      }
    }

    // Case 1: no existing entry for this gate → append.
    hooks.PreToolUse = [...entries, desiredEntry];
    parsed.hooks = hooks;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
    // totem-context: intentional — upsertClaudeHookCommand is a Result-returning installer; failures are reported to the caller via HookUpsertOutcome.err (surfaced by the gate install logger), never silently swallowed. Rethrowing would break callers that branch on { action, err }, so Tenet 4 is satisfied by reporting the failure.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: 'skipped',
      err: message.startsWith('[Totem Error]') ? message : `[Totem Error] ${message}`,
    };
  }
}

/**
 * True iff `parsed.hooks.PreToolUse` contains an entry under `matcher`
 * whose hook list satisfies `probe`. The idempotency primitive both the
 * shield-gate and gate-install installers key on.
 */
export function preToolUseHasMatcher(
  parsed: ParsedSettings,
  matcher: PreToolUseMatcher,
  probe: (entry: z.infer<typeof HookCommandSchema>) => boolean,
): boolean {
  const preToolUse = parsed.hooks?.PreToolUse ?? [];
  return preToolUse.some(
    (h) => h.matcher === matcher && Array.isArray(h.hooks) && h.hooks.some(probe),
  );
}

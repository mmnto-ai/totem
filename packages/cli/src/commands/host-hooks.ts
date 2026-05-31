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
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName = path.basename(filePath);

    const fullConfig = { hooks: { [hookKind]: [entry] } };

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fullConfig, null, 2) + '\n', 'utf-8');
      return { action: 'created' };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Could not parse ${fileName} (invalid JSON)`, {
        cause: err instanceof Error ? err : new Error(String(err)),
      });
    }

    const result = ClaudeSettingsSchema.safeParse(rawParsed);
    if (!result.success) {
      const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      // Prefix not added here — call site (initCommand) emits via
      // log.error('Totem Error', ...) which adds the prefix automatically.
      return {
        action: 'skipped',
        err: `Could not merge config: ${fileName} has unexpected shape: ${detail}`,
      };
    }

    const parsed = result.data;
    if (alreadyInstalled(parsed)) {
      return { action: 'skipped' };
    }

    const existing = parsed.hooks?.[hookKind] ?? [];
    const hooks = parsed.hooks ?? {};
    hooks[hookKind] = [...existing, entry];
    parsed.hooks = hooks;
    fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
    return { action: 'merged' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { action: 'skipped', err: `[Totem Error] ${message}` };
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

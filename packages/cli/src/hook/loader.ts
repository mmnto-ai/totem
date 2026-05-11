import fs from 'node:fs';

import { TotemError } from '@mmnto/totem';

import {
  COMPILED_HOOKS_SCHEMA_VERSION,
  type CompiledHookRule,
  CompiledHooksManifestSchema,
} from './schema.js';

/**
 * Compiled-hooks manifest loader (ADR-104 § Decision 3 staleness check + a
 * forward-compat warn-and-skip path for an evolving manifest schema).
 *
 * The loader is a pure function over `(manifestPath, installedPackVersions)`.
 * It does NOT read `package.json` itself — callers (typically a
 * bootstrap helper) resolve installed pack versions once and pass them in.
 * Keeps the loader testable in isolation; mirrors the substrate-wiring
 * pattern from `bootstrapEngine` (1.25.0 wiring lesson).
 *
 * Three failure modes are surfaced via the `warnings` array, not by
 * throwing:
 *
 * 1. Manifest file missing — empty result, no warnings (a fresh repo without
 *    installed pack hooks is a valid state).
 * 2. Manifest schemaVersion is not the runner's expected version — warn and
 *    skip the entire manifest (no hooks loaded). Composes with ADR-104
 *    § Decision 4's forward-compat ethos.
 * 3. Pack version drift — for each pack whose installed version differs from
 *    the compiled-against version, emit a `[totem:hook-stale]` warning per
 *    the format in ADR-104 § Decision 3. Hooks still load (Tenet 4 carve-out:
 *    hooks are best-effort; staleness is signal, not a fail-closed condition).
 *
 * Structural errors (corrupt JSON, schema-validation failure on a manifest
 * claiming the supported schemaVersion) populate `errors` and yield an empty
 * hooks array — distinct from a missing manifest.
 */

export interface LoadCompiledHooksOptions {
  manifestPath: string;
  installedPackVersions: Record<string, string>;
}

export interface LoadCompiledHooksResult {
  hooks: CompiledHookRule[];
  warnings: string[];
  /**
   * Errors carry the original cause via `Error.cause` so debug consumers
   * can traverse the chain (per the codebase styleguide rule against
   * concatenating `err.message` into new strings — destroys the stack).
   * Callers that just need to log can use `err.message`; debug tooling
   * walks `err.cause` recursively.
   */
  errors: TotemError[];
}

export function loadCompiledHooks(options: LoadCompiledHooksOptions): LoadCompiledHooksResult {
  const warnings: string[] = [];
  const errors: TotemError[] = [];

  // No `fs.existsSync` pre-check: that returns false for any filesystem
  // error (permission denied, symlink loops, EBUSY, etc.), not just ENOENT.
  // Treating those as "missing manifest" would silently swallow real
  // diagnostics. Catch ENOENT explicitly inside the read; everything else
  // surfaces as a HOOKS_LOAD_FAILED entry.
  let raw: string;
  try {
    raw = fs.readFileSync(options.manifestPath, 'utf8');
    // totem-context: intentional — error captured into diagnostics array (the loader's contract is diagnostics-not-throws per Tenet 4 carve-out for hooks being best-effort)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Fresh repo without installed pack hooks is a valid state, not a fault.
      return { hooks: [], warnings, errors };
    }
    errors.push(
      new TotemError(
        'HOOKS_LOAD_FAILED',
        `failed to read compiled-hooks manifest at ${options.manifestPath}`,
        'verify the file is readable and re-run `totem sync` to regenerate',
        err,
      ),
    );
    return { hooks: [], warnings, errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // totem-context: intentional — error captured into diagnostics array (the loader's contract is diagnostics-not-throws per Tenet 4 carve-out for hooks being best-effort)
  } catch (err) {
    errors.push(
      new TotemError(
        'HOOKS_LOAD_FAILED',
        `compiled-hooks manifest at ${options.manifestPath} is not valid JSON`,
        're-run `totem sync` to regenerate the manifest',
        err,
      ),
    );
    return { hooks: [], warnings, errors };
  }

  // Forward-compat: peek at schemaVersion BEFORE invoking the strict z.literal
  // schema validator, so an unknown version surfaces as a warn-and-skip
  // rather than a thrown ZodError. Mirrors the per-pack warn-and-skip pattern
  // for `hooks.yaml :: version` from ADR-104 § Decision 4.
  const peekedVersion =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { schemaVersion?: unknown }).schemaVersion
      : undefined;

  if (peekedVersion !== COMPILED_HOOKS_SCHEMA_VERSION) {
    warnings.push(
      `[totem:hook-schema] compiled-hooks manifest schemaVersion ${JSON.stringify(peekedVersion)} unsupported by this runner (expected ${COMPILED_HOOKS_SCHEMA_VERSION})\n  → upgrade totem CLI or re-run \`totem sync\` to regenerate`,
    );
    return { hooks: [], warnings, errors };
  }

  const validation = CompiledHooksManifestSchema.safeParse(parsed);
  if (!validation.success) {
    const summary = validation.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    errors.push(
      new TotemError(
        'HOOKS_LOAD_FAILED',
        `compiled-hooks manifest at ${options.manifestPath} failed schema validation: ${summary}`,
        're-run `totem sync` to regenerate the manifest, or upgrade totem CLI if the manifest was authored by a newer version',
        validation.error,
      ),
    );
    return { hooks: [], warnings, errors };
  }

  const manifest = validation.data;

  for (const [packId, compiledVersion] of Object.entries(manifest.sourcePackVersions)) {
    const installedVersion = options.installedPackVersions[packId];
    if (installedVersion === undefined) {
      warnings.push(
        `[totem:hook-stale] ${packId}: compiled against ${compiledVersion}, not currently installed\n  → run \`totem sync\` to refresh .totem/compiled-hooks.json`,
      );
      continue;
    }
    if (installedVersion !== compiledVersion) {
      warnings.push(
        `[totem:hook-stale] ${packId}: compiled against ${compiledVersion}, installed ${installedVersion}\n  → run \`totem sync\` to refresh .totem/compiled-hooks.json`,
      );
    }
  }

  return { hooks: manifest.hooks, warnings, errors };
}

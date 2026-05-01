/**
 * Pack discovery substrate (ADR-097 § 5 Q5 + § 10, mmnto-ai/totem#1768).
 *
 * Reads `.totem/installed-packs.json` synchronously at engine boot,
 * resolves each registered pack's registration callback module, and
 * invokes the callback with a `PackRegistrationAPI` so the pack can
 * register its ChunkStrategy + ast-grep Lang + WASM grammar entries
 * before the engine seals.
 *
 * Sealing happens at the end of `loadInstalledPacks()` after every pack
 * callback has returned. Once sealed, subsequent `register()` calls on
 * either registry throw — see `chunker-registry.ts:seal()` and
 * `ast-classifier.ts:sealLangRegistry()`.
 *
 * The seal is the only synchronization boundary between the registration
 * phase and the runtime phase. CLI commands invoke `loadInstalledPacks()`
 * immediately after config load and before any other engine surface, so
 * pack registration is always complete before any chunker / language
 * lookup happens.
 *
 * Failure-mode discipline (Tenet 4):
 * - Missing manifest: silent (treated as no packs); user runs `totem sync`
 *   to generate.
 * - Malformed manifest: hard error.
 * - Pack require throws: hard error.
 * - peerDependencies engine version mismatch: structured error per ADR-097
 *   Q6.
 * - Pack callback throws: hard error.
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import * as semver from 'semver';
import { z } from 'zod';

import {
  registerLang as registerLangInRegistry,
  sealLangRegistry,
  type SupportedLanguage,
} from './ast-classifier.js';
import type { Chunker } from './chunkers/chunker.js';
import {
  isSealed as isChunkerRegistrySealed,
  register as registerChunkerInRegistry,
  seal as sealChunkerRegistry,
} from './chunkers/chunker-registry.js';

// ─── Schema ─────────────────────────────────────────

/**
 * `.totem/installed-packs.json` substrate. Written by `totem sync`,
 * consumed by `loadInstalledPacks()` at boot.
 *
 * `version: 1` is the load-bearing sentinel for forward compatibility:
 * future schema changes bump the version, callers fail loud on unknown
 * versions rather than silently mis-parsing.
 */
export const InstalledPacksManifestSchema = z
  .object({
    version: z.literal(1),
    packs: z.array(
      z
        .object({
          /** Pack package name as it appears in npm (e.g., `@totem/pack-rust-architecture`). */
          name: z.string().min(1),
          /**
           * Absolute filesystem path to the pack's package root. Refined to
           * `path.isAbsolute()` so a relative entry can't pass schema
           * validation and then probe two different locations downstream
           * (`existsSync` resolves from cwd, `require.resolve` from this
           * module).
           */
          resolvedPath: z
            .string()
            .min(1)
            .refine((value) => path.isAbsolute(value), 'resolvedPath must be an absolute path'),
          /** The pack's `peerDependencies['@mmnto/totem']` semver range, verbatim. */
          declaredEngineRange: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  // Duplicate pack names would let two callbacks run while `PACK_REGISTRY`
  // silently keeps only the first entry — the second callback's chunker
  // or language registrations surface later as a registry collision
  // instead of a clear manifest-boundary error. Fail loud here.
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    manifest.packs.forEach((pack, index) => {
      if (seen.has(pack.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['packs', index, 'name'],
          message: `duplicate pack entry '${pack.name}'`,
        });
        return;
      }
      seen.add(pack.name);
    });
  });

export type InstalledPacksManifest = z.infer<typeof InstalledPacksManifestSchema>;

// ─── Public surfaces ────────────────────────────────

/**
 * Surface a pack's registration callback uses to extend the engine's
 * built-in chunker + language tables. Callbacks are synchronous (per
 * ADR-097 § 5 Q5 — boot must remain synchronous); WASM grammar bytes
 * load lazily on first ast-grep dispatch via the `wasmLoader` thunk.
 */
export interface PackRegistrationAPI {
  /**
   * Register a pack-contributed `ChunkStrategy` name + chunker class.
   * The strategy name appears in `targets[].strategy` validation and
   * `totem describe` output. Built-in names are immutable; pack-vs-pack
   * collisions on the same name throw.
   */
  registerChunkStrategy(name: string, chunkerCtor: new () => Chunker): void;

  /**
   * Register a pack-contributed (extension, language, wasmLoader) triple.
   * The extension flows through `extensionToLanguage()` for ast-grep
   * dispatch; the language drives `loadGrammar()`; the wasmLoader thunk
   * resolves the grammar bytes lazily on first use.
   *
   * Built-in extensions/languages are immutable; pack-vs-pack collisions
   * on the same extension throw.
   */
  registerLanguage(
    extension: string,
    lang: SupportedLanguage,
    wasmLoader: () => string | Uint8Array | Promise<string | Uint8Array>,
  ): void;
}

/**
 * The shape a pack's registration callback module must export. Packs
 * default-export a function matching this signature; `loadInstalledPacks`
 * requires the module and invokes the function once with the API surface.
 */
export type PackRegisterCallback = (api: PackRegistrationAPI) => void;

/**
 * Runtime descriptor for a discovered + loaded pack. Returned from
 * `loadInstalledPacks` for diagnostics + `totem doctor` consumption.
 */
export interface LoadedPack {
  readonly name: string;
  readonly resolvedPath: string;
  readonly declaredEngineRange: string;
}

/** Options for `loadInstalledPacks` — primarily test-driven overrides. */
export interface LoadInstalledPacksOptions {
  /**
   * Project root for manifest resolution. The manifest is expected at
   * `<projectRoot>/<totemDir>/installed-packs.json`. Defaults to
   * `process.cwd()` when omitted.
   */
  projectRoot?: string;
  /**
   * `config.totemDir` from the resolved totem config. Defaults to
   * `'.totem'` so callers without a loaded config (e.g., simple CLIs,
   * tests) work out of the box.
   */
  totemDir?: string;
  /**
   * Engine semver to compare against each pack's declared
   * `peerDependencies['@mmnto/totem']` range. Defaults to the engine's
   * own `package.json#version`.
   */
  engineVersion?: string;
  /**
   * Test-only escape hatch: list of `{ pack, callback }` tuples that
   * bypass the manifest read + `require()` resolution and feed callbacks
   * directly into the registration phase. Useful for unit tests that
   * register fixture chunkers/languages without writing fixture packages
   * to disk.
   *
   * When provided, the manifest read is skipped entirely; only these
   * inMemoryPacks run.
   */
  inMemoryPacks?: ReadonlyArray<{ pack: LoadedPack; callback: PackRegisterCallback }>;
}

// ─── Internal state ─────────────────────────────────

const PACK_REGISTRY = new Map<string, LoadedPack>();
let engineSealed = false;

// ─── Core: loadInstalledPacks ───────────────────────

/**
 * Read `.totem/installed-packs.json` and run every registered pack's
 * registration callback synchronously. After all callbacks return, seal
 * both the chunker registry and the language registry.
 *
 * Idempotent: a second call after the first throws because the engine is
 * already sealed (callers must not "re-load" packs at runtime). For
 * tests, see `__resetForTests()`.
 */
export function loadInstalledPacks(options: LoadInstalledPacksOptions = {}): readonly LoadedPack[] {
  if (engineSealed) {
    throw new Error(
      'loadInstalledPacks() called after engine seal — engine has already started serving requests. Pack registration is a boot-time-only operation.',
    );
  }

  const projectRoot = options.projectRoot ?? process.cwd();
  const totemDir = options.totemDir ?? '.totem';
  const engineVersion = options.engineVersion ?? resolveEngineVersion();

  const packsToRegister: ReadonlyArray<{ pack: LoadedPack; callback: PackRegisterCallback }> =
    options.inMemoryPacks ?? readManifestAndResolveCallbacks(projectRoot, totemDir);

  // Engine version cross-check (ADR-097 Q6) — runs against every pack
  // before any callback executes, so a single mismatch fails loud before
  // touching the registries.
  for (const { pack } of packsToRegister) {
    assertEngineRangeSatisfied(pack, engineVersion);
  }

  // Run every callback. A throwing pack short-circuits registration —
  // the engine is left unsealed so a subsequent retry (e.g., test reset)
  // can recover, but the in-flight registration entries from prior packs
  // remain. Callers running in production should treat any throw here
  // as a hard error and not attempt to recover.
  for (const { pack, callback } of packsToRegister) {
    const api: PackRegistrationAPI = {
      registerChunkStrategy(name, chunkerCtor) {
        registerChunkerInRegistry(name, chunkerCtor);
      },
      registerLanguage(extension, lang, wasmLoader) {
        registerLangInRegistry(extension, lang, wasmLoader);
      },
    };
    let callbackResult: unknown;
    try {
      callbackResult = callback(api) as unknown;
    } catch (err) {
      throw new Error(
        `Pack '${pack.name}' registration callback threw. The pack at '${pack.resolvedPath}' must be fixed or removed.`,
        { cause: err instanceof Error ? err : new Error(String(err)) },
      );
    }
    // Per ADR-097 § 5 Q5 the registration callback contract is
    // synchronous; an `async register(api)` would resolve AFTER the
    // engine seals, leaving partial registry state. The
    // `PackRegisterCallback` type already says `void`, but TypeScript
    // can't enforce sync vs async at runtime — a JS-authored pack or
    // one that drifts from the type can still return a Promise. Detect
    // the thenable shape here and fail loud before the seal. Kept
    // outside the try-catch above so the contract-violation error
    // surfaces with its own message rather than getting wrapped as
    // "callback threw."
    if (
      callbackResult !== null &&
      // totem-context: null is excluded by the `!== null` guard on the line above; rule matcher only sees the `=== 'object'` token in isolation
      (typeof callbackResult === 'object' || typeof callbackResult === 'function') &&
      'then' in callbackResult &&
      typeof (callbackResult as { then: unknown }).then === 'function'
    ) {
      throw new Error(
        `Pack '${pack.name}' registration callback returned a Promise — registration must be synchronous per ADR-097 § 5 Q5. The pack at '${pack.resolvedPath}' must export a synchronous \`register\` (not \`async register\`).`,
      );
    }
    if (!PACK_REGISTRY.has(pack.name)) {
      PACK_REGISTRY.set(pack.name, pack);
    }
  }

  sealChunkerRegistry();
  sealLangRegistry();
  engineSealed = true;

  return [...PACK_REGISTRY.values()];
}

/**
 * Snapshot of currently-loaded packs. Empty until `loadInstalledPacks()`
 * runs; populated thereafter and stable for the engine lifetime.
 */
export function loadedPacks(): readonly LoadedPack[] {
  return [...PACK_REGISTRY.values()];
}

/** True iff the engine has sealed (registration phase complete). */
export function isEngineSealed(): boolean {
  return engineSealed;
}

// ─── Manifest read + callback resolution ────────────

function readManifestAndResolveCallbacks(
  projectRoot: string,
  totemDir: string,
): ReadonlyArray<{ pack: LoadedPack; callback: PackRegisterCallback }> {
  const manifestPath = path.join(projectRoot, totemDir, 'installed-packs.json');

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Pre-sync repo or fresh checkout. Treat as no packs — user can
      // run `totem sync` to populate.
      return [];
    }
    throw new Error(
      `Failed to read installed-packs manifest at '${manifestPath}'. Re-run \`totem sync\` to regenerate.`,
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `installed-packs manifest at '${manifestPath}' is not valid JSON. Re-run \`totem sync\` to regenerate.`,
      { cause: err instanceof Error ? err : new Error(String(err)) },
    );
  }

  const result = InstalledPacksManifestSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `installed-packs manifest at '${manifestPath}' failed schema validation: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}. Re-run \`totem sync\` to regenerate.`,
    );
  }

  const require = createRequire(import.meta.url);
  return result.data.packs.map((entry) => {
    const callback = resolvePackCallback(entry.name, entry.resolvedPath, require);
    const pack: LoadedPack = {
      name: entry.name,
      resolvedPath: entry.resolvedPath,
      declaredEngineRange: entry.declaredEngineRange,
    };
    return { pack, callback };
  });
}

function resolvePackCallback(
  name: string,
  resolvedPath: string,
  require: NodeJS.Require,
): PackRegisterCallback {
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Pack '${name}' is registered in installed-packs.json at '${resolvedPath}' but the path does not exist. Re-install the pack or re-run \`totem sync\`.`,
    );
  }

  // Synchronous `require()` is mandated by ADR-097 § 5 Q5: pack
  // registration runs at boot before the engine seal, and boot is
  // synchronous. This means the pack's registration entry must be
  // CommonJS-resolvable — either authored as CJS, or ESM packs must
  // ship a CJS-compatible registration entry (e.g., a built
  // `dist/register.cjs`). Pure-ESM registration entries will throw
  // `ERR_REQUIRE_ESM` at boot. Async-boot support (`await import()`)
  // would lift this constraint and is tracked separately.
  let mod: { default?: unknown; register?: unknown };
  try {
    mod = require(resolvedPath) as { default?: unknown; register?: unknown };
  } catch (err) {
    throw new Error(`Pack '${name}' at '${resolvedPath}' could not be loaded.`, {
      cause: err instanceof Error ? err : new Error(String(err)),
    });
  }

  // Pack callbacks may default-export OR named-export `register`. Default
  // export is the ADR-097 reference shape; `register` named export is the
  // CommonJS-friendly alternative.
  const candidate = mod.default ?? mod.register;
  if (typeof candidate !== 'function') {
    throw new Error(
      `Pack '${name}' at '${resolvedPath}' did not export a registration callback (expected default export or named \`register\` of type function).`,
    );
  }

  return candidate as PackRegisterCallback;
}

// ─── Engine version cross-check (ADR-097 Q6) ────────

function assertEngineRangeSatisfied(pack: LoadedPack, engineVersion: string): void {
  if (!semver.validRange(pack.declaredEngineRange)) {
    throw new Error(
      `Pack '${pack.name}' declares peerDependencies['@mmnto/totem'] = '${pack.declaredEngineRange}', which is not a valid semver range. Fix the pack's package.json.`,
    );
  }
  if (!semver.satisfies(engineVersion, pack.declaredEngineRange, { includePrerelease: true })) {
    throw new Error(
      `Pack '${pack.name}' requires @mmnto/totem '${pack.declaredEngineRange}' but the running engine is ${engineVersion}. Upgrade the pack to a version compatible with this engine, or pin the engine to a version satisfied by the pack's range.`,
    );
  }
}

function resolveEngineVersion(): string {
  // Resolve relative to this module's URL so the read works regardless
  // of cwd. The package.json sits at packages/core/package.json — two
  // levels up from packages/core/dist/pack-discovery.js when the build
  // output runs, and one level up from packages/core/src/pack-discovery.ts
  // during tsx test execution. Try both.
  const require = createRequire(import.meta.url);
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const pkg = require(candidate) as { version?: unknown };
      if (typeof pkg.version === 'string') return pkg.version;
    } catch (err) {
      const code =
        err instanceof Error && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === 'ENOENT' || code === 'MODULE_NOT_FOUND') continue;
      throw new Error(
        `Failed to resolve engine version from '${candidate}'. The file exists but could not be read or parsed; check permissions and JSON syntax.`,
        { cause: err instanceof Error ? err : new Error(String(err)) },
      );
    }
  }
  // Fall back to a sentinel that won't satisfy any reasonable range —
  // surfaces the missing-version-resolution as a peerDeps mismatch rather
  // than an undefined-behavior path. If a pack legitimately uses range
  // '*' this will still pass.
  return '0.0.0';
}

// ─── Test-only helpers ──────────────────────────────

/**
 * Test-only: reset pack-discovery local state (`PACK_REGISTRY` map and
 * `engineSealed` flag). NEVER call from production.
 *
 * **This does NOT reset downstream registries.** Tests that need a
 * fresh chunker or language registry must additionally invoke
 * `__resetForTests` from `chunker-registry.js` and `ast-classifier.js`
 * — those modules own their own lifecycle. Forgetting either reset
 * leaks built-in registrations across cases. The standard `afterEach`
 * pattern in `pack-discovery.test.ts` calls all three.
 */
export function __resetForTests(): void {
  PACK_REGISTRY.clear();
  engineSealed = false;
}

/** Test-only: inspect chunker registry seal state. */
export function __isChunkerRegistrySealedForTests(): boolean {
  return isChunkerRegistrySealed();
}

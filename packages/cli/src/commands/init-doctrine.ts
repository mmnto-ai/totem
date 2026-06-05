/**
 * `totem init --doctrine` — wire the cohort parity manifest into a consumer.
 *
 * Proposal 292 §10 (mmnto-ai/totem-strategy#548), build-slice S1. Under
 * emitter-B the strategy-canonical `parity-manifest.yaml` is distributed as a
 * private package (`@mmnto/strategy-doctrine`, npmjs-private); totem-core's
 * whole job is to point `orient.parityManifest` at the installed pin. The
 * consumer adds the pin dependency explicitly (the opt-in); this command writes
 * ONLY the config pointer — never `package.json`, never the manifest, never the
 * reader (the parity reader / honest-absent SKIP / `configured` self-gate
 * already ship, mmnto-ai/totem#2085). No pin installed ⇒ honest-absent: guide,
 * write nothing, exit 0.
 *
 * **Detection is parse-based, insertion is conservative** (bot review on #2089):
 * "already set" and "does an `orient` block exist" are read from the *parsed*
 * config (`loadConfig`) — ground truth, so comments, strings, quoted keys, and
 * nested objects can never produce a false positive. The only auto-edit is
 * adding a brand-new top-level `orient` field to a canonical `export default {`
 * config; any existing `orient` block or non-canonical shape bails to a
 * format-aware manual snippet rather than risk a wrong edit (Tenet 4).
 */

import type { TotemConfig } from '@mmnto/totem';

/** The private package carrying the strategy-canonical parity manifest snapshot. */
export const DOCTRINE_PIN_PACKAGE = '@mmnto/strategy-doctrine';

/**
 * Repo-root-relative path the config pointer is set to. Resolves through the
 * node_modules pin (pnpm's direct-dep symlink included) the same way the parity
 * reader resolves `orient.parityManifest` — zero-network, riding the install
 * that already ran (Tenet 6).
 */
export const DOCTRINE_MANIFEST_RELPATH = `node_modules/${DOCTRINE_PIN_PACKAGE}/parity-manifest.yaml`;

/** Result of the pure top-level-orient insertion. */
export type InsertOrientResult = { kind: 'written'; content: string } | { kind: 'unspliceable' };

/**
 * Offset just past the `{` of the SOLE top-level `export default {`, scanning
 * only CODE regions — line/block comments and single/double/backtick strings
 * are skipped so a decoy inside any of them can never be mistaken for the real
 * declaration (GCA + CodeRabbit review on #2089: a regex over raw text leaks
 * comment and template-literal cases). Returns null unless exactly one real
 * declaration exists — zero (a `defineConfig(...)` wrapper) or many bails. Any
 * mis-scan degrades to a bail (never an edit), so it can never corrupt.
 */
function findSoleExportDefaultBrace(src: string): number | null {
  const EXPORT_DEFAULT_RE = /^export\s+default\s*\{/;
  const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);
  const hits: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
    } else if (c === 'e' && !isWordChar(src[i - 1])) {
      const match = EXPORT_DEFAULT_RE.exec(src.slice(i));
      if (match) {
        hits.push(i + match[0].length);
        i += match[0].length;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Insert a NEW top-level `orient: { parityManifest }` field just after the sole
 * `export default {` of a TS/JS config. Called ONLY when the parsed config has
 * no `orient` key (detection is parse-based upstream), so there is no merge to
 * perform and no risk of a duplicate key. Conservative by construction: a
 * config without exactly one real (non-string, non-comment) `export default {`
 * declaration bails to `unspliceable` so the caller falls back to the manual
 * snippet. Never a wrong edit (Tenet 4).
 */
export function insertTopLevelOrient(
  configContent: string,
  manifestPath: string,
): InsertOrientResult {
  const insertAt = findSoleExportDefaultBrace(configContent);
  if (insertAt === null) {
    return { kind: 'unspliceable' };
  }
  const content =
    configContent.slice(0, insertAt) +
    `\n  orient: { parityManifest: '${manifestPath}' },` +
    configContent.slice(insertAt);
  return { kind: 'written', content };
}

/** The single field line to add inside an existing `orient` block, by config format. */
export function doctrineFieldSnippet(manifestPath: string, ext: string): string {
  switch (ext) {
    case '.yaml':
    case '.yml':
      return `  parityManifest: ${manifestPath}`;
    case '.toml':
      return `parityManifest = "${manifestPath}"`;
    default:
      return `  parityManifest: '${manifestPath}',`;
  }
}

/** The full `orient` block to add at the config's top level, by config format. */
export function doctrineBlockSnippet(manifestPath: string, ext: string): string {
  switch (ext) {
    case '.yaml':
    case '.yml':
      return `orient:\n  parityManifest: ${manifestPath}`;
    case '.toml':
      return `[orient]\nparityManifest = "${manifestPath}"`;
    default:
      return `  orient: { parityManifest: '${manifestPath}' },`;
  }
}

/** Structured outcome of the wiring flow; the caller maps each to UI + exit.
 *  Parse / read / write FAILURES are not outcomes — they throw a `TotemError`
 *  (with `cause`) from inside `wireDoctrineManifest` (the `.gemini/styleguide`
 *  CLI-layer error convention). */
export type DoctrineWireOutcome =
  | { kind: 'pin-absent'; manifestPath: string }
  | { kind: 'no-config' }
  | { kind: 'global-only' }
  | { kind: 'already-set'; configPath: string }
  | {
      kind: 'manual';
      configPath: string;
      snippet: string;
      reason: 'orient-exists' | 'no-splice-point';
    }
  | { kind: 'written'; configPath: string; manifestPath: string };

/**
 * Detect the doctrine pin and wire (or honest-absent-skip) the config pointer.
 * Takes `cwd` (and an optional `homeDir`) explicitly so it is testable without
 * `process.chdir`, mirroring the parity reader's cwd-in signature.
 */
export async function wireDoctrineManifest(
  cwd: string,
  homeDir?: string,
): Promise<DoctrineWireOutcome> {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Honest-absent: no pin installed ⇒ nothing to wire. `existsSync` follows the
  // pnpm direct-dep symlink, so this is true once the consumer adds the dep.
  const manifestAbs = path.join(cwd, DOCTRINE_MANIFEST_RELPATH);
  if (!fs.existsSync(manifestAbs)) {
    return { kind: 'pin-absent', manifestPath: DOCTRINE_MANIFEST_RELPATH };
  }

  const { resolveConfigPath, isGlobalConfigPath, loadConfig } = await import('../utils.js');
  const { TotemConfigError, TotemError } = await import('@mmnto/totem');

  let configPath: string;
  try {
    configPath = resolveConfigPath(cwd, homeDir);
  } catch (err) {
    // resolveConfigPath throws TotemConfigError only when no config exists
    // anywhere — that is this command's "run totem init first". Anything else
    // is unexpected and must propagate (Tenet 4 — never swallow it).
    if (err instanceof TotemConfigError) {
      return { kind: 'no-config' };
    }
    throw err;
  }

  // Per-repo only: the reader never reads a global `parityManifest`
  // (doctor-parity's repo-scoped guard), so a global-only profile has no repo
  // config to wire into.
  if (isGlobalConfigPath(configPath, homeDir)) {
    return { kind: 'global-only' };
  }

  // Ground-truth detection: parse the config so comments, strings, quoted keys,
  // and nested objects can never produce a false `already-set` or a phantom
  // `orient` (a no-AST text scan cannot see semantics — bot review on #2089).
  let parsed: TotemConfig;
  try {
    parsed = await loadConfig(configPath);
  } catch (cause) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Could not parse the Totem config at ${configPath}.`,
      'Fix the config syntax, then re-run `totem init --doctrine`.',
      cause,
    );
  }

  // Trim: a blank / whitespace-only placeholder is effectively unset
  // (CodeRabbit review on #2089) — don't silently no-op on `parityManifest: ''`.
  if (parsed.orient?.parityManifest?.trim()) {
    return { kind: 'already-set', configPath };
  }

  const ext = path.extname(configPath).toLowerCase();

  // An existing `orient` block: do NOT risk an in-place merge of arbitrary
  // config text (the fragile case the bots flagged) — surface the one line to
  // add. The common consumer (no `orient` yet) takes the auto path below.
  if (parsed.orient !== undefined) {
    return {
      kind: 'manual',
      configPath,
      reason: 'orient-exists',
      snippet: doctrineFieldSnippet(DOCTRINE_MANIFEST_RELPATH, ext),
    };
  }

  // The auto-insert understands TS/JS object syntax only. Non-JS configs
  // (YAML/TOML) go straight to the format-aware manual snippet — we never run
  // the JS scanner over them.
  const JS_CONFIG_EXTS = new Set(['.ts', '.js', '.mts', '.cts', '.mjs', '.cjs']);
  if (!JS_CONFIG_EXTS.has(ext)) {
    return {
      kind: 'manual',
      configPath,
      reason: 'no-splice-point',
      snippet: doctrineBlockSnippet(DOCTRINE_MANIFEST_RELPATH, ext),
    };
  }

  let content: string;
  try {
    content = await fs.promises.readFile(configPath, 'utf-8');
  } catch (cause) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Failed to read the Totem config at ${configPath}.`,
      'Ensure the file exists and is readable.',
      cause,
    );
  }

  const result = insertTopLevelOrient(content, DOCTRINE_MANIFEST_RELPATH);
  const candidate = result.kind === 'written' ? result.content : null;

  // Validate-by-reparse: the scanner is only a heuristic for WHERE to splice;
  // the real parser is the safety net. Confirm the candidate re-parses with the
  // intended value before writing, so ANY scanner edge case (a regex literal, a
  // division operator, etc.) degrades to a manual bail instead of a corrupt
  // write. Corruption is impossible by construction (GCA review on #2089).
  if (candidate === null || !(await reparseConfirms(candidate, configPath))) {
    return {
      kind: 'manual',
      configPath,
      reason: 'no-splice-point',
      snippet: doctrineBlockSnippet(DOCTRINE_MANIFEST_RELPATH, ext),
    };
  }

  try {
    await fs.promises.writeFile(configPath, candidate, 'utf-8');
  } catch (cause) {
    throw new TotemError(
      'CONFIG_INVALID',
      `Failed to write the updated Totem config at ${configPath}.`,
      'Ensure you have write permission for this file.',
      cause,
    );
  }
  return { kind: 'written', configPath, manifestPath: DOCTRINE_MANIFEST_RELPATH };
}

/**
 * Write the candidate config to a throwaway sibling temp file, parse it with the
 * real loader, and confirm `orient.parityManifest` landed as intended. A sibling
 * (same dir + extension) preserves the consumer's relative imports / module
 * resolution so the parse is faithful. Any parse failure or value mismatch ⇒
 * `false` (the caller bails to the manual snippet) — so a scanner mis-splice can
 * never reach disk. Best-effort temp cleanup either way.
 */
async function reparseConfirms(candidate: string, configPath: string): Promise<boolean> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { loadConfig } = await import('../utils.js');

  const dir = path.dirname(configPath);
  const ext = path.extname(configPath);
  const tmp = path.join(dir, `.totem-doctrine-candidate-${process.pid}-${Date.now()}-probe${ext}`);

  let ok = false;
  try {
    await fs.promises.writeFile(tmp, candidate, 'utf-8');
    const reparsed = await loadConfig(tmp);
    ok = reparsed.orient?.parityManifest === DOCTRINE_MANIFEST_RELPATH;
    // totem-context: a candidate that throws on re-parse is an unverified edit (bail to the manual snippet), not an error to surface
  } catch {
    ok = false;
  }
  try {
    await fs.promises.unlink(tmp);
    // totem-context: best-effort cleanup of the throwaway candidate temp file
  } catch {
    // a leftover dotfile temp is harmless
  }
  return ok;
}

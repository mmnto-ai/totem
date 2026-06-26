/**
 * Parity-manifest parser + config-path resolver (mmnto-ai/totem-strategy#448).
 *
 * The strategy repo owns `doctrine/parity-manifest.yaml` — the canonical,
 * machine-readable enumeration of cohort parity dimensions the `totem doctor
 * --parity` sensor checks for drift. This module is the SKELETON foundation:
 * it resolves the consumer-configured config-path to the manifest, parses +
 * Zod-validates the manifest at the system boundary, and maps the YAML
 * kebab-case keys to camelCase type fields. Per-contract drift detection
 * (per-dimension semantics against populated deps contracts) is OUT OF SCOPE
 * for this skeleton and lives in a follow-on.
 *
 * Design invariants:
 *   - **Honest-absent (Tenet 14):** absence is never an error. Unconfigured →
 *     a `not-configured` signal; configured-but-missing → a distinct
 *     `not-found` signal. The resolver and parser NEVER throw for absence.
 *   - **Zod at the boundary only:** the manifest is untrusted on-disk input;
 *     Zod validates it once at the parse boundary, then callers work with
 *     typed values.
 *   - **schema-version gate:** the supported schema version is `1`. An
 *     unsupported version does NOT parse contracts — the parser returns an
 *     `unsupported-schema` signal so the doctor can refuse an incompatible
 *     future shape (per the manifest's own header contract).
 *   - **Pure:** no caching, no logging, no process state. Each call reads from
 *     scratch.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// ─── Constants ──────────────────────────────────────────

/**
 * The single parity-manifest schema version this doctor build understands.
 * The manifest carries `schema-version: 1` as top-level lifecycle DATA so the
 * doctor can refuse to parse an incompatible future shape rather than
 * silently misread it. Bump in lockstep with a schema migration.
 */
export const SUPPORTED_PARITY_SCHEMA_VERSION = 1;

// ─── Tractability claim-class ───────────────────────────

/**
 * Tractability bounds what the doctor may assert about a contract (the
 * honest-absent rule):
 *   - `mechanical`         file-content / structural equality; doctor may
 *                          pass/warn/fail.
 *   - `version-pinned`     consumer pins a canonical version/SHA; doctor checks
 *                          pin currency only, never semantic content.
 *   - `manual-attestation` genuinely semantic, no mechanical sensor; doctor
 *                          surfaces staleness only, NEVER fails.
 */
export const ParityTractabilitySchema = z.enum([
  'mechanical',
  'version-pinned',
  'manual-attestation',
]);
export type ParityTractability = z.infer<typeof ParityTractabilitySchema>;

// ─── Promoted 296 deliverable-1 fields (mmnto-ai/totem#2140) ──

/**
 * The §6(a)2 manifestation-ladder rungs THIS doctor build recognizes (best →
 * weakest). Deliberately NOT a Zod enum at the parse boundary: a closed enum
 * would fail validation MANIFEST-WIDE on one future rung value — the exact
 * total-outage class the 296 settlement (strategy#605) ruled additive fields
 * around (and the `last-attested` format-unvalidation precedent). Routing
 * narrows against this list; an unrecognized value stays verbatim on the row
 * and surfaces as a per-row line, never a dark manifest.
 */
export const PARITY_MANIFESTATIONS = [
  'correct-by-construction',
  'managed-block',
  'version-pin',
  // `value-equality` (strategy#738 Slice A): a present-level mechanical scalar
  // check — stronger than `attestation`, weaker than the byte-exact managed-block
  // rung — promoting the bot-review-config rows. Order is cosmetic (routing
  // narrows on membership, not index), but kept ahead of `attestation` to read as
  // the promotion target.
  'value-equality',
  // `content-hash` (mmnto-ai/totem#2107, strategy#754): byte-for-byte
  // sha256(normalize(content)) equality of a DISTRIBUTED artifact vs its lock —
  // stronger than `value-equality` (a single typed scalar) / `attestation`; distinct
  // from `version-pin` (pin currency, NOT content). The detector is the lock reader
  // (`detectLockContentContract`). Order is cosmetic (routing narrows on membership).
  'content-hash',
  'attestation',
  'capability-probe',
] as const;
export type ParityManifestation = (typeof PARITY_MANIFESTATIONS)[number];

/**
 * The §6(a)3 sensed-state scale (post-#605: `declared` is the floor — the
 * minVersion-fallback honesty level). Ordered weakest → strongest so the
 * probe-vs-declared comparison (the green-halo cap, mmnto-ai/totem#2140) can
 * index into it. Same not-a-Zod-enum rationale as {@link PARITY_MANIFESTATIONS}.
 */
export const PARITY_SENSES = ['declared', 'present', 'loaded', 'usable'] as const;
export type ParitySense = (typeof PARITY_SENSES)[number];

// ─── Contract + manifest types ──────────────────────────

/**
 * Internal Zod schema for one raw manifest contract entry, keyed by the YAML
 * kebab-case field names. Mapped to the camelCase `ParityContract` after
 * validation. `.passthrough()` is intentionally NOT used — unknown keys are
 * dropped rather than carried, keeping the parsed shape bounded.
 *
 * `canonical-source` is `string | null` (null = no external canonical source);
 * it is the ONLY ref the resolver will ever touch. `source-note` is a
 * human-only context field and is NEVER parsed as a ref (per the schema
 * refinement in the manifest header).
 */
const RawParityContractSchema = z.object({
  id: z.string(),
  dimension: z.string(),
  'canonical-source': z.string().nullable(),
  'source-note': z.string().optional(),
  'detection-method': z.string(),
  'expected-value-or-derivation': z.string(),
  tractability: ParityTractabilitySchema,
  'tracking-issue': z.string(),
  // Optional schema-against fields raised by totem-claude per the manifest
  // header (raised AGAINST the schema rather than diverging silently).
  title: z.string().optional(),
  blocking: z.boolean().optional(),
  consumers: z.array(z.string()).optional(),
  // Explicit package identifier (mmnto-ai/totem-strategy#517) — the machine-
  // parseable name for version/vendor contracts, so the detector derives the
  // package rather than guessing it from the id convention.
  package: z.string().optional(),
  // Optional attestation date on manual-attestation rows (strategy#540 /
  // mmnto-ai/totem#2125) — the producer for the detector's reserved
  // `attested?:` seam. Message refinement only; never a verdict input.
  // DELIBERATELY format-unvalidated (Greptile R1 on mmnto-ai/totem#2126,
  // declined): a Zod rejection here is MANIFEST-WIDE — one malformed date
  // would take all contracts dark as `unparseable` (a total sensor outage)
  // versus rendering a verbatim blemish on one info line. Render-only field;
  // the producer side schema-reviews the manifest before publish.
  'last-attested': z.string().optional(),
  // The four promoted 296 deliverable-1 fields (strategy#605/#606,
  // mmnto-ai/totem#2140). Max-tolerance at the raw boundary (`z.unknown()`) for
  // the same manifest-wide-outage reason as `last-attested` above; shape
  // narrowing happens per-row in `mapContract` (mis-shaped → field absent on
  // that row, never a dark manifest). They are routing/render metadata, never
  // verdict inputs, so per-row narrowing does not launder a verdict.
  manifestation: z.unknown().optional(),
  senses: z.unknown().optional(),
  'vendor-adapter': z.unknown().optional(),
  'repo-role-variance': z.unknown().optional(),
});

/**
 * Internal Zod schema for the top-level manifest document. `schema-version`
 * and `status` are lifecycle DATA the doctor reads before trusting the
 * contracts array.
 */
const RawParityManifestSchema = z.object({
  'schema-version': z.number(),
  status: z.string(),
  contracts: z.array(RawParityContractSchema),
});

/**
 * One parsed parity contract — the camelCase public shape. Mirrors the #508
 * manifest schema exactly. `blocking` is parsed but UNUSED in the skeleton
 * (per-contract gating is post-skeleton). `consumers` (absent = applies to all
 * cohort repos) supports ADR-102 per-consumer applicability so the doctor can
 * later distinguish drift from cohort-permits-absence.
 */
export interface ParityContract {
  id: string;
  dimension: string;
  /** `null` = no external canonical source. The ONLY ref the resolver touches. */
  canonicalSource: string | null;
  /** Human-only context for `canonicalSource`. NEVER parsed as a ref. */
  sourceNote?: string;
  detectionMethod: string;
  expectedValueOrDerivation: string;
  tractability: ParityTractability;
  trackingIssue: string;
  /** Optional human-readable title. */
  title?: string;
  /**
   * Optional doctor exit-code policy flag. Parsed but UNUSED in the skeleton —
   * per-contract gating is deferred to a follow-on.
   */
  blocking?: boolean;
  /**
   * Optional cohort applicability (which repos carry this contract). Absent =
   * applies to all cohort repos (ADR-102 per-consumer applicability).
   */
  consumers?: string[];
  /**
   * Optional explicit package identifier (mmnto-ai/totem-strategy#517) — the
   * machine-parseable `@mmnto/*` (or vendor) package name a version/vendor
   * contract pins. Preferred over the id-convention guess when present.
   */
  package?: string;
  /**
   * Optional attestation marker (strategy#540 / mmnto-ai/totem#2125), present
   * on manual-attestation rows whose claim was actually reviewed. An
   * UNVALIDATED string carrying an intended ISO-8601 date — format is
   * deliberately not enforced at the schema boundary (see the raw-schema note:
   * rejection there is manifest-wide), so consumers must treat it as
   * render-only text. Absent = no citable attestation event (honest-absent —
   * the doctor renders "last attested: not recorded", never fabricates a date).
   */
  lastAttested?: string;
  /**
   * Optional §6(a)2 manifestation-ladder rung (promoted field, strategy#606).
   * An open string, NOT `ParityManifestation` — recognized values are narrowed
   * at the ROUTING edge against {@link PARITY_MANIFESTATIONS}; an unrecognized
   * value rides verbatim so the router can surface it loudly per-row.
   */
  manifestation?: string;
  /**
   * Optional §6(a)3 sensed-state level the row's detection-method probes BY
   * DESIGN (`declared|present|loaded|usable`). Open string for the same
   * reason as `manifestation`. Runtime degradation below this level is a
   * verdict-format concern (the declared-floor rendering), never a parse one.
   */
  senses?: string;
  /**
   * Optional vendor surfaces this row manifests through (promoted field).
   * Normalized to an array — the manifest authors both `[claude, gemini]`
   * lists and bare strings.
   */
  vendorAdapter?: string[];
  /** Optional one-line legitimate role-based manifestation difference (§6(c)). */
  repoRoleVariance?: string;
}

/** A fully parsed + validated parity manifest. */
export interface ParityManifest {
  schemaVersion: number;
  status: string;
  contracts: ParityContract[];
}

// ─── Config-path resolution ─────────────────────────────

/**
 * Honest-absent resolver outcome (discriminated union):
 *   - `not-configured` — no `orient.parityManifest` set. Sensor → `skip`.
 *   - `not-found`      — configured, but no file at the resolved path. Sensor
 *                        → `warn` (distinct, actionable).
 *   - `resolved`       — a file exists at `path` (absolute).
 *
 * Resolution NEVER throws for absence — both absent states are first-class
 * return values, not exceptions.
 */
export type ParityManifestPathStatus =
  | { status: 'not-configured' }
  | { status: 'not-found'; path: string }
  | { status: 'resolved'; path: string };

/**
 * Resolve the configured `orient.parityManifest` config-path to an absolute
 * manifest path. Relative values anchor at `root` (the config/repo root);
 * absolute values are normalized as-is. Mirrors `resolveStrategyRoot`'s
 * relative-anchoring behavior so a deep cwd doesn't mis-anchor the value.
 *
 * @param configValue The raw `orient.parityManifest` config string (or undefined).
 * @param root        The config/repo root to anchor relative values against.
 */
export function resolveParityManifestPath(
  configValue: string | undefined,
  root: string,
): ParityManifestPathStatus {
  // Honest-absent: unset (or whitespace-only) → not configured, not an error.
  if (typeof configValue !== 'string' || configValue.trim().length === 0) {
    return { status: 'not-configured' };
  }

  const trimmed = configValue.trim();
  // path.resolve (not join) so a relative `root` still yields an ABSOLUTE path —
  // the not-found / resolved branches document `path` as absolute.
  const absolute = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed);

  if (!fileExists(absolute)) {
    return { status: 'not-found', path: absolute };
  }

  return { status: 'resolved', path: absolute };
}

/**
 * `fs.statSync` raises on missing paths and on EACCES/ENOTDIR; treat any stat
 * failure (or a non-file) as "not present" so the resolver returns the
 * `not-found` signal rather than throwing.
 */
function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
    // totem-context: intentional fall-through — a stat failure (ENOENT/EACCES/ENOTDIR) is the honest-absent "not found" signal the resolver returns as data; rethrowing would force every caller to wrap a routine absence in try/catch.
  } catch {
    return false;
  }
}

// ─── Parsing ────────────────────────────────────────────

/**
 * Honest-absent parse outcome (discriminated union):
 *   - `unparseable`        — invalid YAML or Zod-schema validation failure.
 *                            Sensor → `warn` (never crash).
 *   - `unsupported-schema` — `schema-version` ≠ the supported version.
 *                            Contracts are NOT parsed. Sensor → `warn`.
 *   - `ok`                 — a fully parsed + validated manifest.
 *
 * Parsing NEVER throws — every failure is a first-class return value so the
 * doctor pipeline degrades to a `warn` line rather than crashing (mirrors the
 * `findStaleRules` best-effort fallback idiom).
 */
export type ParityManifestParseResult =
  | { status: 'unparseable'; reason: string }
  | { status: 'unsupported-schema'; schemaVersion: number }
  | { status: 'ok'; manifest: ParityManifest };

/**
 * Parse raw YAML manifest text into a validated `ParityManifest`.
 *
 * Order of operations matters: the `schema-version` gate runs BEFORE the full
 * contract validation so an unsupported future shape is rejected with a clear
 * `unsupported-schema` signal rather than a confusing Zod failure against a
 * v1-shaped schema. Within v1, contracts are Zod-validated and the kebab-case
 * YAML keys are mapped to the camelCase `ParityContract` fields.
 */
export function parseParityManifest(yamlText: string): ParityManifestParseResult {
  // ── YAML parse ──
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
    // totem-context: invalid YAML is returned as an `unparseable` signal (sensor degrades to warn), not rethrown — the doctor pipeline must not crash on a malformed strategy-owned manifest.
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'unparseable', reason: `Invalid YAML: ${reason}` };
  }

  // ── schema-version gate (BEFORE full validation) ──
  // Probe `schema-version` with a minimal Zod schema (NOT a type assertion) so
  // an unsupported version short-circuits before the v1-shaped contract schema
  // rejects an incompatible future shape with a misleading error. A non-mapping
  // doc or a missing / non-numeric version fails the probe → unparseable.
  const versionProbe = z.object({ 'schema-version': z.number() }).safeParse(doc);
  if (!versionProbe.success) {
    return {
      status: 'unparseable',
      reason: 'Manifest is not a mapping with a numeric `schema-version`',
    };
  }
  const rawVersion = versionProbe.data['schema-version'];
  if (rawVersion !== SUPPORTED_PARITY_SCHEMA_VERSION) {
    return { status: 'unsupported-schema', schemaVersion: rawVersion };
  }

  // ── Full Zod validation of the v1 shape ──
  const parsed = RawParityManifestSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      status: 'unparseable',
      reason: `Manifest failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    };
  }

  // ── Map kebab-case → camelCase ──
  const manifest: ParityManifest = {
    schemaVersion: parsed.data['schema-version'],
    status: parsed.data.status,
    contracts: parsed.data.contracts.map(mapContract),
  };

  return { status: 'ok', manifest };
}

/**
 * Narrow an unknown promoted-field value to a non-empty string, else undefined
 * (mis-shaped → treated as absent on that row; see the raw-schema note — the
 * field is routing/render metadata, so per-row absence beats manifest-wide
 * unparseable). Returns the TRIMMED value — a YAML-quoted field with stray
 * surrounding spaces must still hit routing comparisons and the green-halo cap
 * (Greptile outside-diff finding on the #2140 PR).
 */
function narrowString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Narrow an unknown `vendor-adapter` value to `string[]`: a YAML list of
 * strings passes through; a bare string normalizes to a one-element array
 * (both shapes appear in the promoted manifest). Any other shape — including a
 * list with one non-string member — narrows to undefined (absent on that row).
 */
function narrowStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
    // Trim members + drop empties so list and bare-string inputs normalize
    // identically (GCA + CR round-2 convergence on the #2140 PR) — equivalent
    // YAML must not parse differently by authoring shape.
    const trimmed = (value as string[]).map((v) => v.trim()).filter((v) => v.length > 0);
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/** Map one validated raw contract to the camelCase public `ParityContract`. */
function mapContract(raw: z.infer<typeof RawParityContractSchema>): ParityContract {
  const manifestation = narrowString(raw.manifestation);
  const senses = narrowString(raw.senses);
  const vendorAdapter = narrowStringArray(raw['vendor-adapter']);
  const repoRoleVariance = narrowString(raw['repo-role-variance']);
  return {
    id: raw.id,
    dimension: raw.dimension,
    canonicalSource: raw['canonical-source'],
    ...(raw['source-note'] !== undefined ? { sourceNote: raw['source-note'] } : {}),
    ...(raw['last-attested'] !== undefined ? { lastAttested: raw['last-attested'] } : {}),
    detectionMethod: raw['detection-method'],
    expectedValueOrDerivation: raw['expected-value-or-derivation'],
    tractability: raw.tractability,
    trackingIssue: raw['tracking-issue'],
    ...(raw.title !== undefined ? { title: raw.title } : {}),
    ...(raw.blocking !== undefined ? { blocking: raw.blocking } : {}),
    ...(raw.consumers !== undefined ? { consumers: raw.consumers } : {}),
    ...(raw.package !== undefined ? { package: raw.package } : {}),
    ...(manifestation !== undefined ? { manifestation } : {}),
    ...(senses !== undefined ? { senses } : {}),
    ...(vendorAdapter !== undefined ? { vendorAdapter } : {}),
    ...(repoRoleVariance !== undefined ? { repoRoleVariance } : {}),
  };
}

/**
 * Convenience: resolve the config-path, read the file, and parse it in one
 * call. Returns the resolver's honest-absent signals (`not-configured` /
 * `not-found`) directly, or the parse result. Read failures degrade to an
 * `unparseable` parse result (never throws), so the doctor surface has a single
 * exhaustive switch to render against.
 */
export type ParityManifestLoadResult =
  | { status: 'not-configured' }
  | { status: 'not-found'; path: string }
  | { status: 'unparseable'; reason: string; path: string }
  | { status: 'unsupported-schema'; schemaVersion: number; path: string }
  | { status: 'ok'; manifest: ParityManifest; path: string };

export function loadParityManifest(
  configValue: string | undefined,
  root: string,
): ParityManifestLoadResult {
  const resolved = resolveParityManifestPath(configValue, root);
  if (resolved.status === 'not-configured') return { status: 'not-configured' };
  if (resolved.status === 'not-found') {
    return { status: 'not-found', path: resolved.path };
  }

  let text: string;
  try {
    text = fs.readFileSync(resolved.path, 'utf-8');
    // totem-context: a read failure on a path that existSync'd a moment ago (race / permission flip) degrades to an `unparseable` warn, not a throw — the sensor must never crash the doctor pipeline.
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'unparseable', reason: `Unreadable: ${reason}`, path: resolved.path };
  }

  const result = parseParityManifest(text);
  if (result.status === 'ok') {
    return { status: 'ok', manifest: result.manifest, path: resolved.path };
  }
  if (result.status === 'unsupported-schema') {
    return {
      status: 'unsupported-schema',
      schemaVersion: result.schemaVersion,
      path: resolved.path,
    };
  }
  return { status: 'unparseable', reason: result.reason, path: resolved.path };
}

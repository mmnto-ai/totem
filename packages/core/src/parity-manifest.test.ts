/**
 * Tests for the parity-manifest parser + config-path resolver
 * (mmnto-ai/totem-strategy#448).
 *
 * The resolver is filesystem-driven, so tests construct real temp files. The
 * parser is pure-text and exercised directly. The round-trip fixture is built
 * from the real `doctrine/parity-manifest.yaml` shape — including a
 * `version-pinned` contract, a `null` canonical-source with a `source-note`,
 * and an entry carrying the optional `title`/`blocking`/`consumers` fields.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadParityManifest,
  parseParityManifest,
  resolveParityManifestPath,
  SUPPORTED_PARITY_SCHEMA_VERSION,
} from './parity-manifest.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-parity-manifest-'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
});

// A fixture mirroring the real parity-manifest.yaml shape: a `mechanical`
// contract with a repo:path canonical-source, a `version-pinned` contract, a
// `null` canonical-source + `source-note`, and one entry carrying the optional
// `title`/`blocking`/`consumers` fields.
const VALID_MANIFEST_YAML = `schema-version: 1
status: scaffold

contracts:
  - id: session-start-orientation
    dimension: orientation
    canonical-source: mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#SessionStart
    detection-method: SessionStart hook present and invokes \`totem orient --session\`
    expected-value-or-derivation: hook managed-block matches distributed template
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#438

  - id: mmnto-cli-version
    dimension: toolchain-version
    canonical-source: mmnto-ai/totem:packages/cli/package.json#version
    detection-method: consumer package.json caret range + resolved install
    expected-value-or-derivation: consumer pin resolves to the current published @mmnto/cli
    tractability: version-pinned
    tracking-issue: mmnto-ai/totem-strategy#482

  - id: mcp-corpus-indexing
    dimension: knowledge-index
    canonical-source: null
    source-note: consumer-local capability; no external canonical source
    detection-method: .lancedb index present + search responds
    expected-value-or-derivation: index present + fresh + search responsive
    tractability: mechanical
    tracking-issue: mmnto-ai/totem#2018

  - id: gate-config
    dimension: enforcement
    title: Canonical gate set
    canonical-source: mmnto-ai/totem
    detection-method: installed gates vs the expected canonical gate set
    expected-value-or-derivation: consumer installed gates == canonical gate set
    tractability: mechanical
    tracking-issue: mmnto-ai/totem-strategy#482
    blocking: false
    consumers:
      - mmnto-ai/totem
      - mmnto-ai/totem-strategy
`;

// ─── resolveParityManifestPath ──────────────────────────

describe('resolveParityManifestPath', () => {
  it('returns not-configured when the config value is undefined (honest-absent, no throw)', () => {
    expect(resolveParityManifestPath(undefined, tmpRoot)).toEqual({ status: 'not-configured' });
  });

  it('returns not-configured for a whitespace-only config value', () => {
    expect(resolveParityManifestPath('   ', tmpRoot)).toEqual({ status: 'not-configured' });
  });

  it('returns not-found (distinct signal) when configured path does not exist', () => {
    const result = resolveParityManifestPath('does/not/exist.yaml', tmpRoot);
    expect(result.status).toBe('not-found');
    if (result.status === 'not-found') {
      expect(result.path).toBe(path.normalize(path.join(tmpRoot, 'does/not/exist.yaml')));
    }
  });

  it('resolves a relative path against the config/repo root', () => {
    const rel = 'doctrine/parity-manifest.yaml';
    const abs = path.join(tmpRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, VALID_MANIFEST_YAML, 'utf-8');

    const result = resolveParityManifestPath(rel, tmpRoot);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.path).toBe(path.normalize(abs));
    }
  });

  it('honors an absolute path verbatim', () => {
    const abs = path.join(tmpRoot, 'manifest.yaml');
    fs.writeFileSync(abs, VALID_MANIFEST_YAML, 'utf-8');
    const result = resolveParityManifestPath(abs, tmpRoot);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.path).toBe(path.normalize(abs));
    }
  });

  it('returns not-found (not resolved) when the path points at a directory', () => {
    const dir = path.join(tmpRoot, 'a-dir');
    fs.mkdirSync(dir, { recursive: true });
    expect(resolveParityManifestPath('a-dir', tmpRoot).status).toBe('not-found');
  });
});

// ─── parseParityManifest ────────────────────────────────

describe('parseParityManifest', () => {
  it('round-trips the full manifest shape, mapping kebab-case → camelCase', () => {
    const result = parseParityManifest(VALID_MANIFEST_YAML);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const { manifest } = result;
    expect(manifest.schemaVersion).toBe(SUPPORTED_PARITY_SCHEMA_VERSION);
    expect(manifest.status).toBe('scaffold');
    expect(manifest.contracts).toHaveLength(4);

    // mechanical contract with a repo:path canonical-source.
    const orientation = manifest.contracts[0]!;
    expect(orientation.id).toBe('session-start-orientation');
    expect(orientation.dimension).toBe('orientation');
    expect(orientation.canonicalSource).toBe(
      'mmnto-ai/totem:packages/cli/src/commands/init-templates.ts#SessionStart',
    );
    expect(orientation.detectionMethod).toContain('SessionStart hook present');
    expect(orientation.expectedValueOrDerivation).toContain('managed-block');
    expect(orientation.tractability).toBe('mechanical');
    expect(orientation.trackingIssue).toBe('mmnto-ai/totem-strategy#438');

    // version-pinned contract.
    const cliVersion = manifest.contracts[1]!;
    expect(cliVersion.id).toBe('mmnto-cli-version');
    expect(cliVersion.tractability).toBe('version-pinned');

    // null canonical-source + source-note.
    const corpus = manifest.contracts[2]!;
    expect(corpus.canonicalSource).toBeNull();
    expect(corpus.sourceNote).toBe('consumer-local capability; no external canonical source');

    // title / blocking / consumers optional fields.
    const gate = manifest.contracts[3]!;
    expect(gate.title).toBe('Canonical gate set');
    expect(gate.blocking).toBe(false);
    expect(gate.consumers).toEqual(['mmnto-ai/totem', 'mmnto-ai/totem-strategy']);
  });

  it('omits optional fields that are absent (no undefined keys leak through)', () => {
    const result = parseParityManifest(VALID_MANIFEST_YAML);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const orientation = result.manifest.contracts[0]!;
    expect('sourceNote' in orientation).toBe(false);
    expect('title' in orientation).toBe(false);
    expect('blocking' in orientation).toBe(false);
    expect('consumers' in orientation).toBe(false);
    expect('lastAttested' in orientation).toBe(false);
  });

  it('maps last-attested to lastAttested; absent stays structurally absent (mmnto-ai/totem#2125)', () => {
    // strategy#540: optional quoted ISO-8601 date on manual-attestation rows.
    const dated = VALID_MANIFEST_YAML.replace(
      'tracking-issue: mmnto-ai/totem#2018\n',
      "tracking-issue: mmnto-ai/totem#2018\n    last-attested: '2026-06-08'\n",
    );
    const result = parseParityManifest(dated);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const corpus = result.manifest.contracts[2]!;
    expect(corpus.lastAttested).toBe('2026-06-08');
    // Sibling rows without the field carry no key at all (honest-absent, no
    // fabricated provenance).
    expect('lastAttested' in result.manifest.contracts[0]!).toBe(false);
  });

  it('returns unparseable on invalid YAML (no throw)', () => {
    const result = parseParityManifest('schema-version: 1\ncontracts: [unclosed');
    expect(result.status).toBe('unparseable');
  });

  it('returns unparseable on a Zod-invalid contract (missing required field)', () => {
    const bad = `schema-version: 1
status: scaffold
contracts:
  - id: broken
    dimension: orientation
    canonical-source: null
    detection-method: something
    tractability: mechanical
`; // missing expected-value-or-derivation + tracking-issue
    const result = parseParityManifest(bad);
    expect(result.status).toBe('unparseable');
  });

  it('returns unparseable on an invalid tractability claim-class', () => {
    const bad = VALID_MANIFEST_YAML.replace('tractability: mechanical', 'tractability: bogus');
    const result = parseParityManifest(bad);
    expect(result.status).toBe('unparseable');
  });

  it('does NOT parse contracts when schema-version is unsupported', () => {
    const future = VALID_MANIFEST_YAML.replace('schema-version: 1', 'schema-version: 2');
    const result = parseParityManifest(future);
    expect(result.status).toBe('unsupported-schema');
    if (result.status === 'unsupported-schema') {
      expect(result.schemaVersion).toBe(2);
    }
    // The discriminated union has no `manifest` on the unsupported branch.
    expect('manifest' in result).toBe(false);
  });

  it('returns unparseable when schema-version is missing entirely', () => {
    const noVersion = VALID_MANIFEST_YAML.replace('schema-version: 1\n', '');
    expect(parseParityManifest(noVersion).status).toBe('unparseable');
  });
});

// ─── loadParityManifest (resolve + read + parse) ────────

describe('loadParityManifest', () => {
  it('returns not-configured when unset', () => {
    expect(loadParityManifest(undefined, tmpRoot)).toEqual({ status: 'not-configured' });
  });

  it('returns not-found when configured path is missing', () => {
    const result = loadParityManifest('missing.yaml', tmpRoot);
    expect(result.status).toBe('not-found');
  });

  it('loads + parses a valid manifest end-to-end', () => {
    const rel = 'parity-manifest.yaml';
    fs.writeFileSync(path.join(tmpRoot, rel), VALID_MANIFEST_YAML, 'utf-8');
    const result = loadParityManifest(rel, tmpRoot);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.manifest.contracts).toHaveLength(4);
      expect(result.path).toBe(path.normalize(path.join(tmpRoot, rel)));
    }
  });

  it('surfaces unsupported-schema with the offending version + path', () => {
    const rel = 'parity-manifest.yaml';
    fs.writeFileSync(
      path.join(tmpRoot, rel),
      VALID_MANIFEST_YAML.replace('schema-version: 1', 'schema-version: 99'),
      'utf-8',
    );
    const result = loadParityManifest(rel, tmpRoot);
    expect(result.status).toBe('unsupported-schema');
    if (result.status === 'unsupported-schema') {
      expect(result.schemaVersion).toBe(99);
    }
  });

  it('degrades unparseable YAML to a warn-class signal (never throws)', () => {
    const rel = 'parity-manifest.yaml';
    fs.writeFileSync(path.join(tmpRoot, rel), 'schema-version: 1\ncontracts: [oops', 'utf-8');
    const result = loadParityManifest(rel, tmpRoot);
    expect(result.status).toBe('unparseable');
  });
});

// ─── Promoted 296 deliverable-1 fields (mmnto-ai/totem#2140) ──

// A contract carrying all four promoted optional fields, in the shapes the
// promoted manifest actually uses (strategy#606: `vendor-adapter` is a YAML
// LIST; the rest are strings).
const PROMOTED_FIELDS_YAML = `schema-version: 1
status: active

contracts:
  - id: knowledge-search-access
    dimension: knowledge-index
    canonical-source: null
    detection-method: capability probe, two rungs
    expected-value-or-derivation: at least one working query path per agent surface
    tractability: mechanical
    manifestation: capability-probe
    senses: usable
    vendor-adapter: [claude, gemini]
    repo-role-variance: publisher self-read skips on workspace pins (by design)
    tracking-issue: mmnto-ai/totem#2140
`;

describe('parseParityManifest — promoted 296 fields (mmnto-ai/totem#2140)', () => {
  it('parses all four promoted fields, mapping kebab-case → camelCase', () => {
    const result = parseParityManifest(PROMOTED_FIELDS_YAML);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const row = result.manifest.contracts[0]!;
    expect(row.manifestation).toBe('capability-probe');
    expect(row.senses).toBe('usable');
    expect(row.vendorAdapter).toEqual(['claude', 'gemini']);
    expect(row.repoRoleVariance).toBe('publisher self-read skips on workspace pins (by design)');
  });

  it('respects honest-absent mapping for promoted optional fields (no keys, no defaults)', () => {
    const result = parseParityManifest(VALID_MANIFEST_YAML);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    for (const row of result.manifest.contracts) {
      expect('manifestation' in row).toBe(false);
      expect('senses' in row).toBe(false);
      expect('vendorAdapter' in row).toBe(false);
      expect('repoRoleVariance' in row).toBe(false);
    }
  });

  it('normalizes a bare-string vendor-adapter to a one-element array', () => {
    const bare = PROMOTED_FIELDS_YAML.replace(
      'vendor-adapter: [claude, gemini]',
      'vendor-adapter: claude',
    );
    const result = parseParityManifest(bare);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.manifest.contracts[0]!.vendorAdapter).toEqual(['claude']);
  });

  it('keeps an UNRECOGNIZED manifestation value verbatim — never a manifest-wide failure', () => {
    // The total-outage guard (the 296 settlement class): a future rung value on
    // one row must not take all contracts dark. The field is render/routing
    // metadata, so an unknown value parses through verbatim; the ROUTER decides
    // how to surface it (per-row stub line), never the parser.
    const future = PROMOTED_FIELDS_YAML.replace(
      'manifestation: capability-probe',
      'manifestation: quantum-entanglement',
    );
    const result = parseParityManifest(future);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.manifest.contracts[0]!.manifestation).toBe('quantum-entanglement');
  });

  it('narrows a mis-shaped promoted field to absent without failing the manifest', () => {
    // A numeric senses (authoring error) drops to absent on that row — never
    // manifest-wide unparseable (the last-attested precedent: rejection at the
    // raw boundary is a TOTAL sensor outage; narrowing is per-row).
    const misShaped = PROMOTED_FIELDS_YAML.replace('senses: usable', 'senses: 3');
    const result = parseParityManifest(misShaped);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const row = result.manifest.contracts[0]!;
    expect('senses' in row).toBe(false);
    // The other promoted fields on the same row are unaffected.
    expect(row.manifestation).toBe('capability-probe');
  });

  it('narrows a mis-shaped vendor-adapter (non-string list member) to absent', () => {
    const misShaped = PROMOTED_FIELDS_YAML.replace(
      'vendor-adapter: [claude, gemini]',
      'vendor-adapter: [claude, 7]',
    );
    const result = parseParityManifest(misShaped);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect('vendorAdapter' in result.manifest.contracts[0]!).toBe(false);
  });
});

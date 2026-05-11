import { describe, expect, it } from 'vitest';

import {
  COMPILED_HOOKS_SCHEMA_VERSION,
  CompiledHooksManifestSchema,
  HookRuleSchema,
  HOOKS_YAML_SCHEMA_VERSION,
  HooksYamlSchema,
} from './schema.js';

describe('hook schema', () => {
  describe('HookRuleSchema', () => {
    it('accepts a minimal rule with required fields only', () => {
      const minimal = {
        id: 'gca-tag-xor-command',
        trigger: { tool: 'bash', pattern: 'gh\\s+(pr|issue)\\s+comment.*' },
        check: {
          pattern: '(?=.*@gemini-code-assist)(?=.*\\/gemini review)',
          type: 'reject-if-match',
        },
        message: 'GCA tag XOR — never both.',
      };
      const parsed = HookRuleSchema.parse(minimal);
      expect(parsed.recoveryHint).toBeUndefined();
      expect(parsed.verification_shadow).toBeUndefined();
    });

    it('accepts a rule with the optional recoveryHint field', () => {
      const withHint = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: 'x', type: 'reject-if-match' },
        message: 'm',
        recoveryHint: 'try y instead',
      };
      const parsed = HookRuleSchema.parse(withHint);
      expect(parsed.recoveryHint).toBe('try y instead');
    });

    it('accepts verification_shadow permissively (V1 warn-and-ignore at runtime)', () => {
      const withShadow = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: 'x', type: 'reject-if-match' },
        message: 'm',
        verification_shadow: { rego: 'package x' },
      };
      // V1 contract: schema accepts the block so a future Spine-Rule
      // promotion doesn't break the parser. Runtime drops/warns on it.
      expect(() => HookRuleSchema.parse(withShadow)).not.toThrow();
    });

    it('rejects rules with empty required strings', () => {
      const empty = {
        id: '',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: 'x', type: 'reject-if-match' },
        message: 'm',
      };
      expect(() => HookRuleSchema.parse(empty)).toThrow();
    });

    it('rejects an unknown check.type value', () => {
      const badType = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: 'x', type: 'maybe-reject' },
        message: 'm',
      };
      expect(() => HookRuleSchema.parse(badType)).toThrow();
    });
  });

  describe('HooksYamlSchema', () => {
    it('accepts a pack-level hooks.yaml with version 1 and an empty hooks array', () => {
      const empty = { version: HOOKS_YAML_SCHEMA_VERSION, hooks: [] };
      expect(() => HooksYamlSchema.parse(empty)).not.toThrow();
    });

    it('accepts version 2 — forward-compat path (runtime warn-and-skip per Decision 4)', () => {
      // Schema accepts any positive integer version. The warn-and-skip on
      // unknown-version is enforced at the load layer, not the schema layer,
      // so a future bot-pack publishing version 2 doesn't crash the parser.
      const future = { version: 2, hooks: [] };
      expect(() => HooksYamlSchema.parse(future)).not.toThrow();
    });

    it('rejects non-positive version values', () => {
      expect(() => HooksYamlSchema.parse({ version: 0, hooks: [] })).toThrow();
      expect(() => HooksYamlSchema.parse({ version: -1, hooks: [] })).toThrow();
    });
  });

  describe('CompiledHooksManifestSchema', () => {
    it('accepts a manifest with the required staleness metadata fields', () => {
      const manifest = {
        schemaVersion: COMPILED_HOOKS_SCHEMA_VERSION,
        compiledAt: '2026-05-11T18:43:00Z',
        sourcePackVersions: {
          '@mmnto/pack-bot-coderabbit': '1.0.0',
        },
        hooks: [],
      };
      expect(() => CompiledHooksManifestSchema.parse(manifest)).not.toThrow();
    });

    it('rejects a manifest missing sourcePackVersions (staleness check requires it)', () => {
      const bad = {
        schemaVersion: COMPILED_HOOKS_SCHEMA_VERSION,
        compiledAt: '2026-05-11T18:43:00Z',
        hooks: [],
      };
      expect(() => CompiledHooksManifestSchema.parse(bad)).toThrow();
    });

    it('rejects a non-ISO compiledAt string', () => {
      const bad = {
        schemaVersion: COMPILED_HOOKS_SCHEMA_VERSION,
        compiledAt: 'yesterday',
        sourcePackVersions: {},
        hooks: [],
      };
      expect(() => CompiledHooksManifestSchema.parse(bad)).toThrow();
    });

    it('rejects a future schemaVersion (uses z.literal — caller must handle upgrades)', () => {
      const future = {
        schemaVersion: 2,
        compiledAt: '2026-05-11T18:43:00Z',
        sourcePackVersions: {},
        hooks: [],
      };
      expect(() => CompiledHooksManifestSchema.parse(future)).toThrow();
    });

    it('preserves provenance via packId on each compiled rule', () => {
      const manifest = {
        schemaVersion: COMPILED_HOOKS_SCHEMA_VERSION,
        compiledAt: '2026-05-11T18:43:00Z',
        sourcePackVersions: { '@mmnto/pack-bot-coderabbit': '1.0.0' },
        hooks: [
          {
            id: 'r1',
            packId: '@mmnto/pack-bot-coderabbit',
            trigger: { tool: 'bash', pattern: '.*' },
            check: { pattern: 'x', type: 'reject-if-match' },
            message: 'm',
          },
        ],
      };
      const parsed = CompiledHooksManifestSchema.parse(manifest);
      expect(parsed.hooks[0].packId).toBe('@mmnto/pack-bot-coderabbit');
    });
  });
});

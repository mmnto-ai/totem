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

    it('rejects rules whose trigger.pattern is not a valid regex (parse-time)', () => {
      // Unterminated character class — `new RegExp('[')` throws SyntaxError.
      // Schema must catch this before any `evaluateHook` invocation so a
      // malformed pack rule surfaces at parse time rather than at first-fire.
      const badRegex = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '[' },
        check: { pattern: 'x', type: 'reject-if-match' },
        message: 'm',
      };
      expect(() => HookRuleSchema.parse(badRegex)).toThrow();
    });

    it('rejects rules whose check.pattern is not a valid regex (parse-time)', () => {
      const badRegex = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: '*invalid', type: 'reject-if-match' },
        message: 'm',
      };
      expect(() => HookRuleSchema.parse(badRegex)).toThrow();
    });

    it('rejects rules whose check.pattern has ReDoS risk (parse-time)', () => {
      // `(a+)+$` is the canonical exponential-backtracking ReDoS shape — runs
      // exponentially in the input length on near-matches. Pack-supplied
      // patterns get a parse-time safety check via safe-regex2 to keep the
      // engine's availability guarantee independent of pack quality.
      const redosRule = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: '.*' },
        check: { pattern: '(a+)+$', type: 'reject-if-match' },
        message: 'm',
      };
      const result = HookRuleSchema.safeParse(redosRule);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) =>
          i.message.includes('catastrophic-backtracking'),
        );
        expect(issue).toBeDefined();
      }
    });

    it('rejects rules whose pattern exceeds the length cap', () => {
      const oversized = {
        id: 'r1',
        trigger: { tool: 'bash', pattern: 'a'.repeat(600) },
        check: { pattern: 'x', type: 'reject-if-match' },
        message: 'm',
      };
      const result = HookRuleSchema.safeParse(oversized);
      expect(result.success).toBe(false);
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

    it('accepts hooks with distinct ids', () => {
      const distinct = {
        version: HOOKS_YAML_SCHEMA_VERSION,
        hooks: [
          {
            id: 'r1',
            trigger: { tool: 'bash', pattern: '.*' },
            check: { pattern: 'x', type: 'reject-if-match' },
            message: 'm1',
          },
          {
            id: 'r2',
            trigger: { tool: 'bash', pattern: '.*' },
            check: { pattern: 'y', type: 'reject-if-match' },
            message: 'm2',
          },
        ],
      };
      expect(() => HooksYamlSchema.parse(distinct)).not.toThrow();
    });

    it('rejects duplicate hook ids within a pack (provenance must stay deterministic)', () => {
      // Two rules with the same id within one pack would make
      // `<packId>/<ruleId>` rejection trails ambiguous (ADR-104 § Decision 1).
      const dup = {
        version: HOOKS_YAML_SCHEMA_VERSION,
        hooks: [
          {
            id: 'r1',
            trigger: { tool: 'bash', pattern: '.*' },
            check: { pattern: 'x', type: 'reject-if-match' },
            message: 'first',
          },
          {
            id: 'r1',
            trigger: { tool: 'bash', pattern: '.*' },
            check: { pattern: 'y', type: 'reject-if-match' },
            message: 'second',
          },
        ],
      };
      const result = HooksYamlSchema.safeParse(dup);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (i) => i.message === 'Duplicate hook id within pack: r1',
        );
        expect(issue).toBeDefined();
        expect(issue?.path).toEqual(['hooks', 1, 'id']);
      }
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

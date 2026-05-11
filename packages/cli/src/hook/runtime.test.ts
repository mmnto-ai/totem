import { describe, expect, it } from 'vitest';

import { evaluateHook, formatRejection, type RejectDecision } from './runtime.js';
import type { CompiledHookRule } from './schema.js';

function rule(overrides: Partial<CompiledHookRule> = {}): CompiledHookRule {
  return {
    id: 'gca-tag-xor-command',
    packId: '@mmnto/pack-bot-gemini-code-assist',
    trigger: { tool: 'bash', pattern: 'gh\\s+(pr|issue)\\s+comment' },
    check: {
      pattern: '(?=.*@gemini-code-assist)(?=.*\\/gemini review)',
      type: 'reject-if-match',
    },
    message: 'GCA tag XOR command — never both; doubling wastes GCA quota.',
    recoveryHint: 'Choose one: @-mention to comment, /gemini review for fresh review.',
    ...overrides,
  };
}

describe('evaluateHook', () => {
  describe('trigger gate', () => {
    it('allows when payload.tool does not match rule.trigger.tool', () => {
      const result = evaluateHook(rule(), { tool: 'write', args: 'whatever' });
      expect(result.decision).toBe('allow');
    });

    it('allows when payload.tool matches but trigger.pattern does not', () => {
      // Trigger requires `gh pr comment` or `gh issue comment`; this is `gh pr list`.
      const result = evaluateHook(rule(), { tool: 'bash', args: 'gh pr list' });
      expect(result.decision).toBe('allow');
    });
  });

  describe('check gate — reject-if-match', () => {
    it('rejects when both trigger and check patterns match', () => {
      const args = 'gh pr comment 123 --body "@gemini-code-assist /gemini review please"';
      const result = evaluateHook(rule(), { tool: 'bash', args });
      expect(result.decision).toBe('reject');
      if (result.decision === 'reject') {
        expect(result.message).toMatch(/GCA tag XOR/);
        expect(result.packId).toBe('@mmnto/pack-bot-gemini-code-assist');
        expect(result.ruleId).toBe('gca-tag-xor-command');
      }
    });

    it('allows when trigger matches but check does not (only one of the two tags present)', () => {
      // Trigger matches `gh pr comment` but the check requires BOTH the
      // @mention AND the slash command — this comment has only the mention.
      const args = 'gh pr comment 123 --body "@gemini-code-assist take a look"';
      const result = evaluateHook(rule(), { tool: 'bash', args });
      expect(result.decision).toBe('allow');
    });
  });

  describe('check gate — reject-if-no-match', () => {
    it('rejects when trigger matches but the required check pattern is absent', () => {
      const r = rule({
        id: 'requires-fixes-block',
        check: { pattern: '## Fixes', type: 'reject-if-no-match' },
        trigger: { tool: 'bash', pattern: 'git\\s+commit' },
        message: 'Commit message must include a `## Fixes` section.',
      });
      const result = evaluateHook(r, { tool: 'bash', args: 'git commit -m "wip"' });
      expect(result.decision).toBe('reject');
    });

    it('allows when the required check pattern is present', () => {
      const r = rule({
        check: { pattern: '## Fixes', type: 'reject-if-no-match' },
        trigger: { tool: 'bash', pattern: 'git\\s+commit' },
      });
      const result = evaluateHook(r, {
        tool: 'bash',
        args: 'git commit -m "feat: x\\n\\n## Fixes\\n- y"',
      });
      expect(result.decision).toBe('allow');
    });
  });

  describe('reject decision payload', () => {
    it('carries packId and ruleId for provenance', () => {
      const args = 'gh pr comment 1 --body "@gemini-code-assist /gemini review"';
      const result = evaluateHook(rule(), { tool: 'bash', args });
      expect(result).toMatchObject({
        decision: 'reject',
        packId: '@mmnto/pack-bot-gemini-code-assist',
        ruleId: 'gca-tag-xor-command',
      });
    });

    it('preserves recoveryHint when present', () => {
      const args = 'gh pr comment 1 --body "@gemini-code-assist /gemini review"';
      const result = evaluateHook(rule(), { tool: 'bash', args });
      if (result.decision === 'reject') {
        expect(result.recoveryHint).toMatch(/Choose one/);
      }
    });

    it('returns undefined recoveryHint when the rule omits it', () => {
      const r = rule({ recoveryHint: undefined });
      const args = 'gh pr comment 1 --body "@gemini-code-assist /gemini review"';
      const result = evaluateHook(r, { tool: 'bash', args });
      if (result.decision === 'reject') {
        expect(result.recoveryHint).toBeUndefined();
      }
    });
  });

  describe('verification_shadow ignored at runtime', () => {
    it('evaluates as Interpretive Rule even when verification_shadow is present', () => {
      // Per ADR-104 § Convergence: hooks fall into Interpretive Rule class
      // in V1. verification_shadow on a hook rule is reserved schema field
      // for future Spine-Rule promotion; the V1 runtime must not change
      // its decision based on its presence or absence.
      const args = 'gh pr comment 1 --body "@gemini-code-assist /gemini review"';
      const withShadow = rule({ verification_shadow: { rego: 'package x' } });
      const withoutShadow = rule();
      expect(evaluateHook(withShadow, { tool: 'bash', args })).toEqual(
        evaluateHook(withoutShadow, { tool: 'bash', args }),
      );
    });
  });
});

describe('formatRejection', () => {
  it('formats the structured prefix with packId/ruleId when recoveryHint is absent', () => {
    const decision: RejectDecision = {
      decision: 'reject',
      packId: '@mmnto/pack-bot-coderabbit',
      ruleId: 'r1',
      message: 'do not commit secrets',
    };
    expect(formatRejection(decision)).toBe(
      '[totem:hook-block] @mmnto/pack-bot-coderabbit/r1: do not commit secrets',
    );
  });

  it('includes the recovery-hint line when present', () => {
    const decision: RejectDecision = {
      decision: 'reject',
      packId: '@mmnto/pack-bot-coderabbit',
      ruleId: 'r1',
      message: 'do not commit secrets',
      recoveryHint: 'use git-crypt or vault',
    };
    expect(formatRejection(decision)).toBe(
      '[totem:hook-block] @mmnto/pack-bot-coderabbit/r1: do not commit secrets\n' +
        '  → use git-crypt or vault',
    );
  });

  // The previous "throws when given an allow decision" runtime guard is gone —
  // formatRejection's parameter is now narrowed to RejectDecision so the type
  // system prevents the caller bug at compile time. TS-only enforcement.
});

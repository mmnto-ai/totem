/**
 * Integration smoke tests — verify orchestrator providers work end-to-end
 * against live APIs. Gated behind CI_INTEGRATION=true env var.
 *
 * Run locally:  CI_INTEGRATION=true GEMINI_API_KEY=... ANTHROPIC_API_KEY=... pnpm vitest run -c vitest.integration.config.ts
 * Run in CI:    .github/workflows/ci-integration.yml (nightly schedule)
 *
 * @see https://github.com/mmnto-ai/totem/issues/245
 */
import { describe, expect, it } from 'vitest';

import type { OrchestratorResult } from './orchestrator.js';

const MINIMAL_PROMPT = 'Respond with exactly one word: TOTEM';
const TIMEOUT_MS = 90_000; // generous — cold starts can be slow

function assertSmokeResult(result: OrchestratorResult): void {
  expect(result.content).toBeTruthy();
  expect(result.durationMs).toBeGreaterThan(0);
  expect(typeof result.inputTokens).toBe('number');
  expect(typeof result.outputTokens).toBe('number');
}

describe.runIf(process.env['CI_INTEGRATION'] === 'true')('Integration Smoke Tests', () => {
  describe('Gemini', () => {
    it(
      'returns a valid response from the Gemini API',
      async () => {
        const { invokeGeminiOrchestrator } = await import('./gemini-orchestrator.js');

        const result = await invokeGeminiOrchestrator({
          prompt: MINIMAL_PROMPT,
          model: 'gemini-2.5-flash',
          cwd: '.',
          tag: 'Smoke',
          totemDir: '.totem',
        });

        assertSmokeResult(result);
      },
      TIMEOUT_MS,
    );
  });

  describe('Anthropic', () => {
    it(
      'returns a valid response from the Anthropic API',
      async () => {
        const { invokeAnthropicOrchestrator } = await import('./anthropic-orchestrator.js');

        const result = await invokeAnthropicOrchestrator({
          prompt: MINIMAL_PROMPT,
          model: 'claude-haiku-4-5-20251001',
          cwd: '.',
          tag: 'Smoke',
          totemDir: '.totem',
        });

        assertSmokeResult(result);
      },
      TIMEOUT_MS,
    );
  });
});

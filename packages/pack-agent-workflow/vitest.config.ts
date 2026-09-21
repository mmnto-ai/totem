import { defineConfig } from 'vitest/config';

// Mirrors @mmnto/pack-agent-security: Windows process spawn / kill is
// materially slower than Linux/macOS, and shared CI runners see cold-import
// variability, so the 5s vitest default is too tight.
const TEST_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 15_000;

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
    // Hooks ride the same floor (mmnto-ai/totem#2896): a fixture-building hook
    // is the same spawn class, and vitest's `hookTimeout` is a separate 10s
    // default that `testTimeout` never touched.
    hookTimeout: TEST_TIMEOUT_MS,
  },
});

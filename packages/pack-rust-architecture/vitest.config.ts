import { defineConfig } from 'vitest/config';

// Windows process spawn / kill is materially slower than Linux/macOS, and
// subprocess-driving tests (git, node -e children, doctor temp-cleanup) trip
// vitest's 5s default. Linux/macOS also see cold-import variability on shared
// CI runners — the `vi.resetModules() + await import` pattern (e.g.,
// ledger-writer in @mmnto/mcp) has spiked past 5s under load even though
// local runs land near 1s. Floor matches @mmnto/mcp post-#1928.
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

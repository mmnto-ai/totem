import { defineConfig } from 'vitest/config';

// Windows process spawn / kill is materially slower than Linux/macOS, and
// subprocess-driving tests (git, node -e children, doctor temp-cleanup) trip
// vitest's 5s default. Linux/macOS also see cold-import variability on shared
// CI runners — the `vi.resetModules() + await import` pattern (e.g.,
// ledger-writer in @mmnto/mcp) has spiked past 5s under load even though
// local runs land near 1s. Floor matches @mmnto/mcp post-#1928.
//
// Hooks ride the same floor (mmnto-ai/totem#2896). A `beforeEach` that builds
// a git fixture is the same spawn class, but vitest's `hookTimeout` is a
// SEPARATE 10s default that `testTimeout` never touched: review-fan.test.ts's
// eight-spawn `beforeEach` crossed it at 12.6s on windows-latest while the row
// beside it passed at 13s under the 30s test budget.
const TEST_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 15_000;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
    // mmnto-ai/totem#1942 — asserts the real `.git/hooks/pre-push` is not
    // mutated by any test in the suite. Localizes test-isolation defects in
    // CLI integration tests that spawn the built binary with a cwd that
    // resolves to the real repo (e.g., the shield alias's silent
    // pre-push hook upgrader).
    globalSetup: ['./vitest.global-setup.ts'],
  },
});

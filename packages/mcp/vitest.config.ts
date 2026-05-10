import { defineConfig } from 'vitest/config';

// Windows process spawn / kill is materially slower than Linux/macOS, and
// subprocess-driving tests (git, node -e children, doctor temp-cleanup) trip
// vitest's 5s default. Bump only on Windows to keep tight feedback elsewhere.
const TEST_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 5_000;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
  },
});

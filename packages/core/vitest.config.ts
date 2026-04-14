import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'spikes/**/*.spike.test.ts'],
  },
});

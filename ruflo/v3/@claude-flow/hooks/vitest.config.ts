import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    globals: true,
    // Disable coverage for hooks package (uses vitest v2)
    coverage: {
      enabled: false,
    },
  },
});

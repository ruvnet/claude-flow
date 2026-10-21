import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    // vitest suites are *.spec.ts; *.test.ts is reserved for the engine kit (claude plugin test).
    exclude: ['node_modules/**'],
    environment: 'node',
    globals: false,
  },
});

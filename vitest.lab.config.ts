import { defineConfig } from 'vitest/config';

// Lab runs against real models outside the repo (MOBIOS_LAB_MODEL / MOBIOS_LAB_OUT).
// npx vitest run --config vitest.lab.config.ts [file]
export default defineConfig({
  test: {
    include: ['tests/lab/**/*.lab.ts'],
    environment: 'node',
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 30 * 60 * 1000,
    reporters: ['verbose'],
  },
});

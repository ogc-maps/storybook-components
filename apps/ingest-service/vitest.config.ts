import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        // Baselined against unit-test-reachable files (contract, formats, identifiers,
        // ogr, semaphore, unzip). db.ts and ingest.ts are only covered by the
        // integration suite (INGEST_INTEGRATION=1). Tighten as unit tests are added.
        statements: 55,
        branches: 45,
        functions: 55,
        lines: 55,
      },
    },
  },
});

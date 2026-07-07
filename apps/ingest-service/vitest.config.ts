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
        // db, ogr, semaphore, unzip). ingest.ts (ingestFile/inspectSource) is only
        // covered by the integration suite (INGEST_INTEGRATION=1). Actuals as of the
        // db.ts unit tests are ~53.5% statements/lines — below the thresholds below —
        // because this config isn't wired into CI (see issue for tracking); tighten
        // both the CI wiring and these numbers as more of ingest.ts gets unit-tested.
        statements: 55,
        branches: 45,
        functions: 55,
        lines: 55,
      },
    },
  },
});

// Root Vitest configuration: one project per package so each can choose its own
// environment (node for shared/server, jsdom for core/react). Coverage thresholds here
// are the gates described in CLAUDE.md §7.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/test/**',
        '**/index.ts',
        '**/*.d.ts',
        'packages/server/src/db/migrations/**',
        // Process entry points and CLIs are exercised by the e2e suite, not unit tests.
        'packages/server/src/index.ts',
        'packages/server/src/db/migrate-cli.ts',
        'packages/server/src/db/drizzle.config.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 78,
        branches: 68,
        // Critical modules carry a higher bar (CLAUDE.md §7).
        'packages/core/src/geometry/**': { lines: 95, statements: 95, functions: 90, branches: 80 },
        'packages/core/src/sync/**': { lines: 95, statements: 90, functions: 90, branches: 75 },
        'packages/server/src/authz/**': { lines: 90, statements: 90, functions: 95, branches: 85 },
        'packages/server/src/services/asset-validation.ts': {
          lines: 90,
          statements: 85,
          functions: 95,
          branches: 80,
        },
      },
    },
  },
});

import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // API tests boot an embedded Postgres; give them room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

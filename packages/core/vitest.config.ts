import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'core',
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
  },
});

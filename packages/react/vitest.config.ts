import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'react',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});

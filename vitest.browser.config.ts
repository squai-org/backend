import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/browser/*.browser.ts'],
    testTimeout: 120000,
    hookTimeout: 30000,
  },
});

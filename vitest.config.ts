import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'certificate-template-text',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('.html'))
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))}`;
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.{ts,mjs}'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,mjs}'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { statements: 85, branches: 80, functions: 85, lines: 85 },
    },
  },
});

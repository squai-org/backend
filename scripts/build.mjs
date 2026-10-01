import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/worker.js',
  bundle: true,
  format: 'esm',
  target: 'es2024',
  platform: 'browser',
  loader: { '.html': 'text' },
  sourcemap: 'external',
  legalComments: 'none',
  minify: true,
});

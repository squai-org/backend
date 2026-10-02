import { copyFile } from 'node:fs/promises';
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

await build({
  entryPoints: ['src/modules/certificates/presentation/browser/viewer.mjs'],
  outfile: 'public/certificate-viewer/viewer.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  minify: true,
});
await build({
  entryPoints: ['node_modules/pdfjs-dist/build/pdf.worker.mjs'],
  outfile: 'public/certificate-viewer/pdf.worker.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  legalComments: 'none',
  minify: true,
});

await copyFile('node_modules/pdfjs-dist/LICENSE', 'public/certificate-viewer/LICENSE.txt');

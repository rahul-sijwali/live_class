// Copies the pdf.js worker into public/ so the browser can load it from the same origin.
// Runs before `next dev` and `next build` (see package.json scripts).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(publicDir, { recursive: true });
copyFileSync(workerPath, path.join(publicDir, 'pdf.worker.min.mjs'));
console.warn('copied pdf.js worker to public/pdf.worker.min.mjs');

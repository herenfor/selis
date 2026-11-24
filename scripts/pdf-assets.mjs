import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

// Both Tauri production URLs and Vite dev serve these assets from the app origin.
export function pdfAssets() {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const files = new Map(['pdf.min.mjs', 'pdf.worker.min.mjs'].map(name => [name, join(root, 'build', name)]));
  files.set('LICENSE', join(root, 'LICENSE'));
  for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.toLowerCase().includes('quickjs')) continue;
      files.set(`${dir}/${name}`, join(root, dir, name));
    }
  }
  return {
    name: 'offline-pdf-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const key = req.url.split('?')[0].slice(1);
        const file = files.get(key);
        if (!file) return next();
        res.setHeader('Content-Type', /\.m?js$/.test(key) ? 'application/javascript' : key.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: 'asset', fileName: `pdfjs/${name}`, source: readFileSync(file) });
    },
  };
}

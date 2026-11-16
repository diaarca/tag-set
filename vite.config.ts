import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export default defineConfig({
  root: fileURLToPath(new URL('./wrapper/', import.meta.url)),
  publicDir: false,
  plugins: [
    react(),
    {
      name: 'public-assets',
      generateBundle() {
        for (const [fileName, path] of [
          ['index.html', './wrapper/public/index.html'],
          ['LICENSE.txt', './LICENSE'],
          ['NOTICE.txt', './NOTICE'],
        ])
          this.emitFile({
            type: 'asset',
            fileName,
            source: readFileSync(new URL(path, import.meta.url), 'utf8'),
          });
      },
    },
  ],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'bundle',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./wrapper/src/main.tsx', import.meta.url)),
      name: 'TagSet',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'style',
    },
  },
});

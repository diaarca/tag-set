import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./wrapper/', import.meta.url)),
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'bundle',
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./wrapper/src/main.tsx', import.meta.url)),
      name: 'Setwise',
      formats: ['iife'],
      fileName: () => 'app.js',
      cssFileName: 'style',
    },
  },
});

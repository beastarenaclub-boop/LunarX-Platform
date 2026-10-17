import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'bike'),
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/bike',
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { host: '127.0.0.1', port: 5193, strictPort: true, watch: { ignored: ['**/public/fonts/**'] } },
  preview: { host: '127.0.0.1', port: 5193, strictPort: true },
});

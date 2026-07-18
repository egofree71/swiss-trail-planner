/**
 * Business context: serves and builds the local routing benchmark as a separate
 * Vite entry. The production Via Helvetica application never imports this page
 * or its fixtures, so GitHub Pages output remains unchanged.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './',
  appType: 'mpa',
  server: {
    open: '/benchmarks/routing/index.html',
  },
  build: {
    outDir: 'dist-benchmark',
    emptyOutDir: true,
    rollupOptions: {
      input: 'benchmarks/routing/index.html',
    },
  },
});

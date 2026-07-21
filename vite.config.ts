import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  /*
   * GitHub Pages publishes this repository below /via-helvetica/.
   * Vite prefixes generated production asset URLs with this base path.
   */
  base: '/',
  plugins: [react()],
});

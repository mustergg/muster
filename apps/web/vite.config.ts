import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Required for libp2p browser compatibility
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    // Force Vite to pre-bundle these CommonJS libs
    include: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
  server: {
    port: 3000,
    // Proxy API calls to the local Muster node during development
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

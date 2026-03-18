import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Polyfills necessários para as bibliotecas crypto e libp2p no browser
      include: ['buffer', 'crypto', 'stream', 'util', 'events'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
  server: {
    port: 3000,
    headers: {
      'Content-Security-Policy': "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    },
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:4000',  ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
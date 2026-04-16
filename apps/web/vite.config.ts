import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nobleCurvesDir = path.resolve(__dirname, '../../node_modules/@noble/curves');

export default defineConfig({
  base: './',
  plugins: [
    react(),
nodePolyfills({
  include: ['buffer', 'crypto', 'stream', 'util'],
  globals: { Buffer: false },
})
  ],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@noble/curves/ed25519.js': path.join(nobleCurvesDir, 'ed25519.js'),
      '@noble/curves/ed25519': path.join(nobleCurvesDir, 'ed25519.js'),
    },
    dedupe: ['@noble/curves', '@noble/hashes', '@noble/ciphers'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'i18next', 'react-i18next'],
  },
  server: {
    port: 3000,
    headers: {
      'Content-Security-Policy': "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      external: ['vite-plugin-node-polyfills/shims/buffer'],
    },
  },
});

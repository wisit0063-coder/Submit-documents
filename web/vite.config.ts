import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // Output goes straight into public_html on the shared host.
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split the heavy chart library out of the main bundle: most pages never
        // load it, and shared hosting serves these files without HTTP/2 push.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Inside a container the dev server must listen beyond loopback.
    host: process.env.VITE_HOST ?? 'localhost',
    // Docker Desktop on Windows does not forward file events from bind mounts,
    // so the dev container turns on polling.
    watch: process.env.VITE_USE_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      // In development the API runs separately; in production both sit on one
      // domain, so the client always calls /api with no host prefix.
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

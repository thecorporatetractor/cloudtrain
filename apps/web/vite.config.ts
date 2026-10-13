import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Assign by module id only. The object form would also drag the libraries' shared
        // dependencies (React itself) into these chunks, which made every page preload them.
        // The heavy chunks are then imported only by the lazily loaded routes (see router.tsx).
        manualChunks(id) {
          // React runtime gets its own chunk; otherwise Rollup may file react-dom under the
          // first library chunk that needs it, and the entry would preload that chunk for it.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(@xyflow\/|d3-|classcat\/|zustand\/)/.test(id)) return 'flow';
          if (id.includes('node_modules/@xterm/')) return 'xterm';
          if (id.includes('node_modules/@tanstack/')) return 'router';
          return undefined;
        },
      },
    },
  },
});

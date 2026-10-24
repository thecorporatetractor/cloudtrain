import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const real = (env.VITE_API_MODE ?? process.env.VITE_API_MODE) === 'real';
  const gateway = env.CT_GATEWAY_URL ?? 'http://127.0.0.1:8787';
  // `task dev:site` and `task dev:web` run two dev servers from this directory at once:
  // each keeps its own dependency pre-bundle cache so they never rewrite each other's.
  const surface = env.VITE_SURFACE ?? process.env.VITE_SURFACE;
  return {
    plugins: [react()],
    ...(surface === 'site' ? { cacheDir: 'node_modules/.vite-site' } : {}),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      // Real API mode: services/gateway behind /api, including the terminal WebSocket.
      ...(real ? { proxy: { '/api': { target: gateway, ws: true, changeOrigin: true } } } : {}),
    },
    preview: real ? { proxy: { '/api': { target: gateway, ws: true, changeOrigin: true } } } : {},
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rolldownOptions: {
        output: {
          // Vite 8 bundles with Rolldown: manualChunks is deprecated in favour of codeSplitting groups.
          // A group also captures its modules' dependencies (includeDependenciesRecursively), which
          // would drag shared dependencies such as React into the library chunks and make every page
          // preload them. The React runtime therefore has the highest priority: a module captured by
          // one group is removed from the others. The heavy chunks are then imported only by the
          // lazily loaded routes (see router.tsx).
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
              { name: 'router', test: /node_modules[\\/]@tanstack[\\/]/, priority: 30 },
              { name: 'flow', test: /node_modules[\\/](@xyflow[\\/]|d3-|classcat[\\/]|zustand[\\/])/, priority: 20 },
              { name: 'xterm', test: /node_modules[\\/]@xterm[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  };
});

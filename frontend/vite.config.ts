import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// maplibre-gl 6 starts its worker from ./maplibre-gl-worker.mjs next to the
// bundle that imports it, and that worker imports ./maplibre-gl-shared.mjs.
// Vite only bundles the main entry, so emit both files into assets/ or the map
// dies with "Worker failed to load" (404 on /assets/maplibre-gl-worker.mjs).
function maplibreWorkerFiles(): Plugin {
  const dist = join(dirname(createRequire(import.meta.url).resolve('maplibre-gl/package.json')), 'dist')
  return {
    name: 'maplibre-worker-files',
    apply: 'build',
    generateBundle() {
      for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        this.emitFile({ type: 'asset', fileName: `assets/${name}`, source: readFileSync(join(dist, name)) })
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    maplibreWorkerFiles(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: false,  // we use our own public/manifest.json
      injectManifest: {
        swSrc: 'src/sw.ts',
        swDest: 'dist/sw.js',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 80,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': 'http://backend:8000',
      '/ws': { target: 'ws://backend:8000', ws: true },
      '/health': 'http://backend:8000',
    },
  },
})

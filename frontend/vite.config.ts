import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: false,  // we use our own public/manifest.json
      injectManifest: {
        swSrc: 'src/sw.ts',
        swDest: 'dist/sw.js',
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
      '/stream': {
        target: 'http://backend:8000',
        changeOrigin: true,
      },
    },
  },
})

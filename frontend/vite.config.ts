import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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

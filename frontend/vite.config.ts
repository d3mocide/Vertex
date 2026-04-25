import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const icecastTarget = process.env.VITE_ICECAST_URL || env.VITE_ICECAST_URL || 'http://icecast:8000/'
  const op25Target = process.env.VITE_OP25_URL || env.VITE_OP25_URL || 'http://op25:8080/'

  return {
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
          target: icecastTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/stream/, ''),
        },
        '/op25/': {
          target: op25Target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/op25\//, ''),
        },
      },
    },
  }
})

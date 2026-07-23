import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '..', // read .env from project root
  build: {
    sourcemap: false,
  },
  server: {
    proxy: {
      // Proxy API requests to backend dev server (backend/src/dev.ts)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy LiveKit WebSocket to the dev-only LiveKit process (scripts/dev-livekit.ts).
      '/livekit': {
        target: 'ws://localhost:7880',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
    },
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
  },
})

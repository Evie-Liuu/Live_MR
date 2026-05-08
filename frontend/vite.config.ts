import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '..', // read .env from project root
  server: {
    proxy: {
      // Proxy API requests to backend dev server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy LiveKit WebSocket — mirrors the Nginx /livekit/ rule.
      // This lets VITE_LIVEKIT_URL=wss://192.168.0.145/livekit work in
      // both the local dev server AND the Docker/Nginx production stack.
      '/livekit': {
        target: 'ws://localhost:7880',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
    },
    host: '0.0.0.0',
    port: 80,
    hmr: {
      clientPort: 443,
    },
    watch: {
      usePolling: true,
    },
  },
})

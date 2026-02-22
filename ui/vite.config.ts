import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@gocodealone/workflow-ui/api', '@gocodealone/workflow-ui/auth', '@gocodealone/workflow-ui/sse', '@gocodealone/workflow-ui/theme'],
  },
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://localhost:9090',
        changeOrigin: true,
      },
    },
  },
})

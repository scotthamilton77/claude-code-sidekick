import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { sidekickApiPlugin } from './server/api-plugin'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Serve log files from .sidekick/logs during development
    sidekickApiPlugin({ preferProject: true }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Pre-bundle workspace dependencies to handle CommonJS/ESM interop
  optimizeDeps: {
    include: ['@sidekick/types'],
  },
  build: {
    commonjsOptions: {
      include: [/@sidekick\/types/, /node_modules/],
    },
  },
})

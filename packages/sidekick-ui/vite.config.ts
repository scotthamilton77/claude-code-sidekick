import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { sidekickApiPlugin } from './server/api-plugin.js'

export default defineConfig({
  plugins: [react(), sidekickApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

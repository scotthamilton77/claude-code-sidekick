import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { sessionsApiPlugin } from './server/api-plugin.js'

export default defineConfig({
  plugins: [react(), sessionsApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createApiMiddleware } from './src/server/api.js'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'laisen-retail-agent-api',
      configureServer(server) {
        server.middlewares.use(createApiMiddleware())
      },
      configurePreviewServer(server) {
        server.middlewares.use(createApiMiddleware())
      },
    },
  ],
})

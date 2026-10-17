import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createApiMiddleware } from './src/server/api.js'

export default defineConfig(({ mode }) => {
  // The custom API middleware reads notification and model settings from process.env.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
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
  }
})

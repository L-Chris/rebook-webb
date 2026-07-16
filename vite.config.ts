import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDirectory = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'ai', '@ai-sdk/openai'],
  },
  build: {
    sourcemap: false,
  },
  server: {
    host: true,
    port: 3132,
    allowedHosts: ['pi.tailc1b810.ts.net', 'read.rethinkos.com'],
    fs: {
      allow: [resolve(projectDirectory, '..')],
    },
  },
})

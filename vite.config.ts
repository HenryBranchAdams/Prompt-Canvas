import { cloudflare } from '@cloudflare/vite-plugin'
import { sites } from '@openai/sites-vite-plugin'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    sites(),
    cloudflare({
      viteEnvironment: { name: 'server' },
      config: {
        main: './worker/index.ts',
        compatibility_date: '2026-08-18',
        assets: {
          binding: 'ASSETS',
          not_found_handling: 'single-page-application',
          run_worker_first: ['/*'],
        },
      },
    }),
  ],
  server: { port: 4173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
})

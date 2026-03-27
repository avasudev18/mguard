import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true
    }
  },
  // ── NEW: multi-entry for admin console ────────────────────────────────────
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'index-admin.html'),
      },
    },
  },
  // ─────────────────────────────────────────────────────────────────────────
})

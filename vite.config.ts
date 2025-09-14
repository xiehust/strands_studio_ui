import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true // Allow all hosts for maximum compatibility with ALBs and cloud deployments
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  }
})

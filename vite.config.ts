import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite'

// Backend target can be overridden via VITE_BACKEND_URL environment variable
// Defaults to localhost:8000 for local development, but can be set to 'backend:8000' for Docker
const backendTarget = process.env.VITE_BACKEND_URL || 'localhost:8000';

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
    allowedHosts: true, // Allow all hosts for maximum compatibility with ALBs and cloud deployments
    proxy: {
      // Proxy all /api and /health requests to backend
      '/api': {
        target: `http://${backendTarget}`,
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: `http://${backendTarget}`,
        changeOrigin: true,
        secure: false
      },
      // Proxy WebSocket connections for real-time updates
      '/ws': {
        target: `ws://${backendTarget}`,
        ws: true,
        changeOrigin: true
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      // Same proxy configuration for development server
      '/api': {
        target: `http://${backendTarget}`,
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: `http://${backendTarget}`,
        changeOrigin: true,
        secure: false
      },
      '/ws': {
        target: `ws://${backendTarget}`,
        ws: true,
        changeOrigin: true
      }
    }
  }
})

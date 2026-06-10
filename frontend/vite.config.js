import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isMobile = mode === 'mobile'
  return {
    base: isMobile ? './' : '/SplitUp/',
    plugins: [react()],
    build: {
      outDir: isMobile ? 'dist-mobile' : 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'framer': ['framer-motion'],
            'icons': ['lucide-react'],
          }
        }
      }
    },
    server: {
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8001',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    }
  }
})

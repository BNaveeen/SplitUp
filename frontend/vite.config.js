import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function gitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim()
    const date = execSync('git log -1 --format=%cd --date=short').toString().trim()
    return { hash, date }
  } catch {
    return { hash: 'dev', date: new Date().toISOString().slice(0, 10) }
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isMobile = mode === 'mobile'
  const { hash, date } = gitInfo()
  return {
    base: isMobile ? './' : '/SplitUp/',
    define: {
      __GIT_HASH__: JSON.stringify(hash),
      __GIT_DATE__: JSON.stringify(date),
    },
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
        },
        '/ws': {
          target: 'ws://127.0.0.1:8001',
          ws: true,
        }
      }
    }
  }
})

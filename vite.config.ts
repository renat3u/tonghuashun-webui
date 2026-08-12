import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // 独立开发外壳从 client-plugin/src 引入 UI 源码
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})

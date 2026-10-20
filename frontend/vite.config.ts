import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // devtools 只在开发模式启用，避免把调试面板打进生产包
    ...(process.env.NODE_ENV === 'production' ? [] : [vueDevTools()]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    // Vite 8 使用 rolldown/oxc，默认 minify 即可做死代码消除；
    // 凭据类 console.log 已在源码中删除（2026-10-19 安全整改）。
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // 用函数形式（Vite 8 / rolldown 只接受 ManualChunksFunction）
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(vue|@vue|vue-router|pinia)\//.test(id)) return 'vue'
          if (/node_modules\/(element-plus|@element-plus)\//.test(id)) return 'element'
          if (/node_modules\/(marked|highlight\.js|dompurify)\//.test(id)) return 'markdown'
          if (/node_modules\/(echarts|zrender)\//.test(id)) return 'charts'
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3002',
        changeOrigin: true,
        // 禁用响应缓冲，支持 SSE 流式传输
        configure: (proxy, options) => {
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // 如果是 SSE 请求，禁用缓冲
            if (req.url?.includes('/api/events') || proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache';
              proxyRes.headers['connection'] = 'keep-alive';
              proxyRes.headers['x-accel-buffering'] = 'no'; // 禁用 nginx 缓冲
            }
          });
        },
        // 增加超时时间，支持长连接
        proxyTimeout: 0,
        timeout: 0,
      },
    },
  },
})

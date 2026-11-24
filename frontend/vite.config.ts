import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * 给图标字体注入 <link rel="preload">（2026-11-24）
 *
 * 为什么需要插件而不是直接写进 index.html：
 *   Vite 会把 woff2 产物重命名成带 hash 的文件（material-symbols-outlined-DzTrJqFk.woff2），
 *   index.html 里没法硬编码这个路径。只能在 generateBundle 阶段拿到真实文件名再注入。
 *
 * 为什么要 preload：
 *   图标字体 3.8MB，走的是 `.material-symbols-outlined` 的 ligature。
 *   没有 preload 时浏览器要等 CSS 解析到 @font-face 才发起请求，
 *   这段时间里图标名会以纯文本形式显示（checklist / smart_toy 一长串英文），
 *   撑破容器。preload 让它以最高优先级开始下载。
 *
 * `crossorigin` 是必须的：字体请求按 CORS 规则发起，
 * 不带这个属性浏览器会当成另一个 URL 重复下载一次。
 */
function fontPreloadPlugin(): Plugin {
  return {
    name: 'font-preload',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const fonts = Object.keys(bundle).filter((f) => f.endsWith('.woff2'))
      if (!fonts.length) return
      const htmlAsset = Object.values(bundle).find(
        (a): a is any => a.type === 'asset' && a.fileName === 'index.html',
      )
      if (!htmlAsset || typeof htmlAsset.source !== 'string') return

      const links = fonts
        .map((f) => `    <link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin>`)
        .join('\n')
      htmlAsset.source = htmlAsset.source.replace('</head>', `${links}\n  </head>`)
      this.warn(`[font-preload] 已注入 ${fonts.length} 个字体 preload: ${fonts.join(', ')}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    fontPreloadPlugin(),
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

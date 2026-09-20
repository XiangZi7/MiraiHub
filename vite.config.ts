import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { offlineIcons } from './scripts/vite-icons.ts'

const host = process.env.TAURI_DEV_HOST
const debugBuild = Boolean(process.env.TAURI_ENV_DEBUG)

const SKIN_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

/**
 * 浏览器预览没有安装目录，把 src-tauri/skins 挂在 /skins 下顶上。
 * 只在 dev server 生效；发布包里皮肤由 Tauri 作为资源放在 exe 旁边。
 */
function devSkins(): Plugin {
  const root = fileURLToPath(new URL('./src-tauri/skins', import.meta.url))
  return {
    name: 'mirai-dev-skins',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/skins', (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost')
          .pathname
        const file = resolve(root, `.${decodeURIComponent(pathname)}`)
        if (
          !file.startsWith(root + sep) ||
          !existsSync(file) ||
          !statSync(file).isFile()
        )
          return next()
        response.setHeader(
          'Content-Type',
          SKIN_MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
        )
        response.setHeader('Content-Length', statSync(file).size)
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        createReadStream(file).pipe(response)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue(), tailwindcss(), offlineIcons(), devSkins()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 产物只跑在 WebView2 里，按它的基线编译，省掉一轮向下兼容转译。
    target: 'chrome105',
    // 默认压缩器是 oxc；debug 构建保留可读产物便于排查
    minify: !debugBuild,
    sourcemap: debugBuild,
    // 桌面应用本地加载，产物 gzip 体积统计没有意义，去掉能省下收尾的压缩耗时。
    reportCompressedSize: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        /**
         * 分包。
         *
         * 所有窗口（工作区 / 设置 / 连接配置 / 远端编辑器）共用 index.html + main.ts，
         * 靠 hash 路由分流，公共依赖分出来后每个子窗口只解析自己用得到的那几个 chunk。
         * Vite 8 的打包内核是 Rolldown，这里用 advancedChunks 而不是 manualChunks。
         */
        advancedChunks: {
          groups: [
            {
              name: 'vendor-xterm',
              test: /node_modules[\\/]@xterm[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-i18n',
              test: /node_modules[\\/](@intlify|vue-i18n)[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-markdown',
              test: /node_modules[\\/](markdown-it|entities|linkify-it|mdurl|punycode\.js|uc\.micro)[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-vue',
              test: /node_modules[\\/](vue|vue-router|pinia|@vue)[\\/]/,
              priority: 20,
            },
            // 离线图标集是几份体量不小的纯数据，与业务代码分开更新更划算。
            {
              name: 'icons',
              test: /(mirai-icons|database-icons|constants[\\/]icons)/,
              priority: 20,
            },
            { name: 'vendor', test: /node_modules/, priority: 10 },
          ],
        },
      },
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))

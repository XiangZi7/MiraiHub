import { fileURLToPath } from 'node:url'
import { build } from 'vite'

// 与 Tauri 发布构建使用同一份 Vite 配置、Tailwind 扫描及压缩器。
// 仅将入口替换成 mock IPC 的数据库预览，不连接用户数据库。
await build({
  build: {
    outDir: 'test-results/database-preview',
    rollupOptions: {
      input: fileURLToPath(
        new URL('./database-editor-preview.html', import.meta.url)
      ),
    },
  },
})

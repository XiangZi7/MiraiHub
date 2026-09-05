import { createApp } from 'vue'
import { addCollection, type IconifyJSON } from '@iconify/vue'
import lucideIcons from '@iconify-json/lucide/icons.json'
import App from './App.vue'

// 离线字体：打包进产物，断网也能正常渲染
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource-variable/jetbrains-mono'

import '@/assets/styles/main.css'
import { MIRAI_ICONS } from '@/constants/icons'
import { startSettingsRuntime } from '@/utils/settings-runtime'
import { appReady, IS_TAURI } from '@/utils/window'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { pinia } from '@/stores'
import { createAppRouter } from '@/router'
import { resolveWindowEntry } from '@/router/window-entry'

// 图标离线化：本地注册整套 lucide，避免 @iconify/vue 运行时去请求远端 API
addCollection(lucideIcons as IconifyJSON)
// 自绘补充集：实心文件/文件夹 + Windows 窗口控制符号
addCollection(MIRAI_ICONS)

// Tauri 里窗口是透明的，交给系统 acrylic 打底；
// 浏览器预览时没有系统效果，保留 CSS 兜底桌面背景
if (IS_TAURI) document.documentElement.classList.add('is-tauri')

// 启动画面使用独立 Logo 与 Blur，不参与工作区缩放 / 材质设置；其余窗口在挂载前先应用设置
const entry = resolveWindowEntry(
  window.location.search,
  window.location.hash,
  IS_TAURI ? getCurrentWindow().label : undefined
)
const app = createApp(App)
app.use(pinia)
if (entry.surface !== 'splash') startSettingsRuntime()
// 保留旧版子窗口 query，同时让第一次导航直接命中正式路由。
if (!window.location.hash && entry.surface !== 'workspace')
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search + '#' + entry.path
  )
const router = createAppRouter(pinia, entry)
app.use(router)
router.onError(error => {
  console.error('页面加载失败：', error)
})
router
  .isReady()
  .then(() => app.mount('#app'))
  .catch(() => {
    const root = document.getElementById('app')
    if (root) {
      root.textContent = '页面加载失败，请重新启动 MiraiHub。'
      root.style.cssText = 'padding:32px;color:#eee'
      // 启动失败也显示可读错误，避免主窗口一直隐藏在启动画面后。
      if (entry.surface === 'workspace') void appReady()
    }
  })

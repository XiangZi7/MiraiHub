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
import { IS_TAURI } from '@/utils/window'

// 图标离线化：本地注册整套 lucide，避免 @iconify/vue 运行时去请求远端 API
addCollection(lucideIcons as IconifyJSON)
// 自绘补充集：实心文件/文件夹 + Windows 窗口控制符号
addCollection(MIRAI_ICONS)

// Tauri 里窗口是透明的，交给系统 acrylic 打底；
// 浏览器预览时没有系统效果，保留 CSS 兜底桌面背景
if (IS_TAURI)
  document.documentElement.classList.add('is-tauri')

// 启动画面使用独立 Logo 与 Blur，不参与工作区缩放 / 材质设置；其余窗口在挂载前先应用设置
const windowSurface = new URLSearchParams(window.location.search).get('window')
if (windowSurface !== 'splash')
  startSettingsRuntime()

createApp(App).mount('#app')

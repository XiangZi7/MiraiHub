import { readonly, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * 是否运行在 Tauri 容器内。
 * 浏览器里直接预览（pnpm dev 开 localhost）时为 false，
 * 此时所有窗口操作降级为空操作，避免抛错。
 */
export const IS_TAURI: boolean
  = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function withWindow(action: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): void {
  if (!IS_TAURI)
    return

  void action(getCurrentWindow())
}

/** 最小化窗口 */
export function minimizeWindow(): void {
  withWindow(win => win.minimize())
}

/** 最大化 / 还原窗口 */
export function toggleMaximizeWindow(): void {
  withWindow(win => win.toggleMaximize())
}

/** 关闭窗口 */
export function closeWindow(): void {
  withWindow(win => win.close())
}

/**
 * 请求 Rust 创建原生连接配置子窗口。
 *
 * `kind` 决定窗口打开时默认选中哪个连接类型 ——
 * 从 Databases 视图点"新建"却落在 SSH 表单上，用户还要再点一次。
 *
 * 浏览器开发态用 popup 降级，方便不启动 Tauri 也能检查表单 UI。
 */
export function openConnectionWindow(kind?: 'ssh' | 'mysql' | 'postgresql'): void {
  const query = kind ? `&type=${kind}` : ''

  if (!IS_TAURI) {
    window.open(
      `/?window=connection${query}`,
      'miraihub-connection',
      'popup=yes,width=620,height=640,resizable=no',
    )?.focus()
    return
  }

  void invoke('open_connection_window', { kind: kind ?? null }).catch((error: unknown) => {
    console.error('Failed to open connection window:', error)
  })
}

const maximized = ref(false)

/**
 * 窗口是否处于最大化。
 * Windows 的窗口按钮要据此在「最大化」与「还原」两个图标间切换，
 * 而 Tauri 只提供命令式的 isMaximized()，这里包一层响应式镜像。
 */
export const isMaximized = readonly(maximized)

/**
 * 开始跟踪窗口最大化状态，返回取消订阅函数。
 * 最大化/还原必然伴随 resize，所以监听 onResized 就够了。
 */
export function trackMaximized(): () => void {
  if (!IS_TAURI)
    return () => {}

  const win = getCurrentWindow()
  const sync = async (): Promise<void> => {
    maximized.value = await win.isMaximized()
  }

  void sync()

  // onResized 是异步注册的，取消时可能监听还没建立，故用 Promise 链兜住
  const unlisten = win.onResized(() => void sync())

  return () => void unlisten.then(stop => stop())
}

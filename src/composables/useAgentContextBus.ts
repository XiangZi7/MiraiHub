import { inject, onScopeDispose, provide, type InjectionKey, type Ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { onContextFromWindows } from '@/api/agent'
import { toast } from '@/composables/useToast'
import { i18n } from '@/i18n'
import type { AgentContextRequest } from '@/types/agent'

/**
 * 跨组件向 SSH 工作区的 AI Agent 投递上下文的轻量总线。
 *
 * 监控栏、批量执行结果等入口与 SshTerminalWorkspace 之间隔着多层组件，
 * 逐层 emit 成本太高；这里只做“谁能接就交给谁”的同步分发。
 */
export interface AgentContextAsk {
  /** 指定 SSH 会话；为空时交给当前活动的工作区 */
  sessionId?: string
  intent: AgentContextRequest['intent']
  name?: string
  content: string
}

type AgentContextHandler = (ask: AgentContextAsk) => boolean

const handlers = new Set<AgentContextHandler>()

// 投递上下文：优先交给会话匹配的工作区，找不到时退回当前活动工作区；返回是否被接收。
export function requestAgentContext(ask: AgentContextAsk): boolean {
  for (const handler of handlers) if (handler(ask)) return true
  if (!ask.sessionId) return false
  const fallback = { ...ask, sessionId: undefined }
  for (const handler of handlers) if (handler(fallback)) return true
  return false
}

// 注册上下文接收方，随所在作用域销毁自动注销。
export function onAgentContextRequest(handler: AgentContextHandler): void {
  handlers.add(handler)
  onScopeDispose(() => handlers.delete(handler))
}

// 主窗口接收原生子窗口（远端编辑器等）转交的上下文：交给 SSH 工作区并把主窗口带到前台；只在主窗口布局挂载一次。
export function useWindowAgentContextBridge(): void {
  let disposed = false
  let stop: (() => void) | undefined
  void onContextFromWindows(ask => {
    if (!requestAgentContext(ask)) {
      toast.error(i18n.global.t('没有可用的 AI 助手，请先连接终端'))
      return
    }
    const win = getCurrentWindow()
    void win
      .unminimize()
      .then(() => win.show())
      .then(() => win.setFocus())
      .catch(error => console.warn('切换到主窗口失败：', error))
    toast.success(i18n.global.t('已添加到 AI 助手'))
  })
    .then(unlisten => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    .catch(error => console.warn('订阅子窗口 AI 上下文失败：', error))
  onScopeDispose(() => {
    disposed = true
    stop?.()
  })
}

/** Agent 面板向其 Markdown 子组件提供的活动终端会话 id，空串表示未连接 */
export const AGENT_TERMINAL_SESSION: InjectionKey<Readonly<Ref<string>>> =
  Symbol('agent-terminal-session')

// 在 Agent 面板中提供可插入文本的终端会话。
export function provideAgentTerminalSession(
  sessionId: Readonly<Ref<string>>
): void {
  provide(AGENT_TERMINAL_SESSION, sessionId)
}

// 读取所在 Agent 面板的终端会话；不在 SSH Agent 面板内时返回 null。
export function useAgentTerminalSession(): Readonly<Ref<string>> | null {
  return inject(AGENT_TERMINAL_SESSION, null)
}

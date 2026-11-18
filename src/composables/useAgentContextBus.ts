import {
  inject,
  onScopeDispose,
  provide,
  type InjectionKey,
  type Ref,
} from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { onContextFromWindows } from '@/api/agent'
import { toast } from '@/composables/useToast'
import { i18n } from '@/i18n'
import type { AgentContextRequest } from '@/types/agent'
import type { TerminalInsertTarget } from '@/composables/useTerminalInsert'

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

export type AgentTerminalTarget = Pick<TerminalInsertTarget, 'paste'> &
  Partial<Pick<TerminalInsertTarget, 'focus'>> & { singleLineOnly?: boolean }

const AGENT_TERMINAL_TARGET: InjectionKey<
  Readonly<Ref<AgentTerminalTarget | undefined>>
> = Symbol('agent-terminal-target')

/** 将当前绑定的终端插入动作提供给 Agent 回复中的代码块。 */
export function provideAgentTerminalTarget(
  target: Readonly<Ref<AgentTerminalTarget | undefined>>
): void {
  provide(AGENT_TERMINAL_TARGET, target)
}

/** 取当前 Agent 面板绑定的终端插入动作；数据库面板没有终端目标。 */
export function useAgentTerminalTarget(): Readonly<
  Ref<AgentTerminalTarget | undefined>
> | null {
  return inject(AGENT_TERMINAL_TARGET, null)
}

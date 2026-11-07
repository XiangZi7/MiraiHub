import { inject, onScopeDispose, provide, type InjectionKey, type Ref } from 'vue'
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

/**
 * 工作台标签页。
 *
 * 一个标签 = 一个打开的连接。侧栏点服务器、命令面板、最近会话
 * 都汇到这里的 `open()`，标签栏与主视图都从这份状态渲染。
 *
 * 同样是模块级单例：标签页要在 MainWindow、AppSidebar、TabBar
 * 之间共享，逐层传 props 会把中间组件都变成透传管道。
 */

import { computed, reactive, readonly } from 'vue'
import type { SavedConnection } from '@/types/connection'
import type { SshSessionStatus } from '@/types/ssh'

/** 一个打开的标签页 */
export interface WorkspaceTab {
  /** 标签 id。与连接 id 一致 —— 同一个连接只开一个标签 */
  id: string
  connection: SavedConnection
  /** SSH / 本地终端 / 数据库共享的会话状态 */
  status: SshSessionStatus
  /**
   * 后端会话 id，未连上时为空。
   *
   * 由终端面板建立连接后回填 —— 机器面板要用它去查系统指标、列目录，
   * 而那两个面板是终端的兄弟节点，只能通过这份共享状态拿到。
   */
  sessionId: string
}

const state = reactive({
  tabs: [] as WorkspaceTab[],
  activeId: '',
})

/** 当前激活的标签 */
const active = computed(() => state.tabs.find(tab => tab.id === state.activeId))

/**
 * 打开连接。
 *
 * 已经开过就只是切过去，不重复建标签 ——
 * 否则反复点侧栏会攒出一排同名标签，而它们连的是同一台机器。
 */
function open(connection: SavedConnection): void {
  const existing = state.tabs.find(tab => tab.id === connection.id)

  if (existing) {
    // 连接配置可能被改过（改了端口、换了密钥），用最新的覆盖
    existing.connection = connection
    state.activeId = existing.id
    return
  }

  state.tabs.push({
    id: connection.id,
    connection,
    status: 'disconnected',
    sessionId: '',
  })

  state.activeId = connection.id
}

/**
 * 关闭标签。
 *
 * 关掉的是当前标签时，焦点落到它右边的邻居，没有右邻居才往左找 ——
 * 与浏览器、编辑器的行为一致，符合肌肉记忆。
 */
function close(id: string): void {
  const index = state.tabs.findIndex(tab => tab.id === id)
  if (index === -1)
    return

  state.tabs.splice(index, 1)

  if (state.activeId !== id)
    return

  const next = state.tabs[index] ?? state.tabs[index - 1]
  state.activeId = next?.id ?? ''
}

/** 切换激活标签 */
function activate(id: string): void {
  if (state.tabs.some(tab => tab.id === id))
    state.activeId = id
}

/** 按标签栏给出的最终索引移动标签，不改变当前激活项或会话实例。 */
function reorder(fromIndex: number, toIndex: number): void {
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= state.tabs.length
    || toIndex >= state.tabs.length
  ) return

  const [tab] = state.tabs.splice(fromIndex, 1)
  if (tab) state.tabs.splice(toIndex, 0, tab)
}

/**
 * 更新标签的会话状态，由终端面板在连上 / 断开时回调。
 *
 * sessionId 与 status 一起更新：断开时会话 id 立刻失效，
 * 分开更新会留下"状态已断开但 id 还在"的窗口，
 * 机器面板可能正好在这时拿着废 id 去查指标。
 */
function setStatus(id: string, status: SshSessionStatus, sessionId = ''): void {
  const tab = state.tabs.find(item => item.id === id)
  if (!tab)
    return

  tab.status = status
  tab.sessionId = status === 'connected' ? sessionId : ''
}

/**
 * 连接被删除时同步关掉它的标签。
 * 留着标签会指向一份已经不存在的配置，重连时报错莫名其妙。
 */
function closeByConnection(connectionId: string): void {
  close(connectionId)
}

export function useWorkspaceTabs() {
  return {
    tabs: readonly(state).tabs,
    activeId: computed(() => state.activeId),
    active,
    open,
    close,
    activate,
    reorder,
    setStatus,
    closeByConnection,
  }
}

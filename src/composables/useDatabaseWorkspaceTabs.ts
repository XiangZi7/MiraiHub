import {
  inject,
  onScopeDispose,
  provide,
  shallowReactive,
  type InjectionKey,
} from 'vue'
import type { TabItem } from '@/components/ui/TabBar.vue'
import type { ContextMenuItem } from '@/types/context-menu'
import type { WorkspaceTab } from '@/stores/workspace'

export interface WorkspaceViewTab extends WorkspaceTab {
  contentId?: string
  label?: string
  icon?: string
  tooltip?: TabItem['tooltip']
}

export interface DatabaseWorkspaceTabs {
  tabs: () => readonly TabItem[]
  activeId: () => string
  select: (id: string) => void
  add: () => void
  close: (ids: string[]) => void
  reorder: (from: number, to: number) => void
  contextItems: (id: string) => ContextMenuItem[]
  action: (id: string, action: string) => Promise<void>
}
export type DatabaseWorkspaceTabRegistry = Map<string, DatabaseWorkspaceTabs>
type Registry = DatabaseWorkspaceTabRegistry
const key: InjectionKey<Registry> = Symbol('database-workspace-tabs')

// 顶层标签栏共享数据库内容入口；会话、编辑器和结果仍由所属连接实例管理。
export function provideDatabaseWorkspaceTabs(): Registry {
  const registry = shallowReactive(new Map<string, DatabaseWorkspaceTabs>())
  provide(key, registry)
  return registry
}

// 查询、表和设计器通过连接 ID 注册，卸载连接时同步移除顶部内容标签。
export function registerDatabaseWorkspaceTabs(
  connectionId: string | undefined,
  tabs: DatabaseWorkspaceTabs
): void {
  const registry = inject(key, null)
  if (!registry || !connectionId) return
  registry.set(connectionId, tabs)
  onScopeDispose(() => {
    if (registry.get(connectionId) === tabs) registry.delete(connectionId)
  })
}

// 顶部各分组使用同一个注册表，无布局宿主的独立预览可返回空值。
export function useDatabaseWorkspaceTabs(): Registry | null {
  return inject(key, null)
}

// 内容标签使用连接及内容的双重编码，避免不同连接的 Query 1 或同名表冲突。
export function databaseWorkspaceTabId(
  connectionId: string,
  tabId: string
): string {
  return `database-content:${encodeURIComponent(connectionId)}:${encodeURIComponent(tabId)}`
}

// 解析内容标签的连接归属，路由仍指向连接，分屏布局则保留内容标签本身的 ID。
export function databaseWorkspaceTabTarget(
  id: string
): { connectionId: string; tabId: string } | undefined {
  const parts = id.split(':')
  if (parts.length !== 3 || parts[0] !== 'database-content') return
  try {
    return {
      connectionId: decodeURIComponent(parts[1]!),
      tabId: decodeURIComponent(parts[2]!),
    }
  } catch {
    return
  }
}

// 将数据库内容展开为主标签；关闭总览后仍保留该连接的内容入口与会话实例。
export function workspaceViewTabs(
  tabs: readonly WorkspaceTab[],
  registry: Registry | null
): WorkspaceViewTab[] {
  return tabs.flatMap(connection => [
    ...(connection.databaseOverviewClosed ? [] : [connection]),
    ...(registry?.get(connection.id)?.tabs() ?? []).map(tab => ({
      ...connection,
      id: databaseWorkspaceTabId(connection.id, tab.id),
      contentId: tab.id,
      label: tab.label,
      icon: tab.icon,
      tooltip: tab.tooltip,
    })),
  ])
}

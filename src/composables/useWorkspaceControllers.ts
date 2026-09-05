import { inject, onScopeDispose, provide, type InjectionKey } from 'vue'

interface WorkspaceController {
  action?: (id: string, action: string) => Promise<void>
  closeWarning?: (ids: string[]) => string
  newQuery?: (connectionId: string, database: string) => Promise<void>
  refreshDatabase?: (connectionId: string) => void
}
type Controllers = Map<'servers' | 'databases', WorkspaceController>
const key: InjectionKey<Controllers> = Symbol('workspace-controllers')

/** 实例方法留在组件树中，不把终端实例、连接句柄或函数序列化进 Pinia。 */
export function provideWorkspaceControllers(): Controllers {
  const controllers: Controllers = new Map()
  provide(key, controllers)
  return controllers
}

export function registerWorkspaceController(page: 'servers' | 'databases', controller: WorkspaceController): void {
  const controllers = inject(key)
  if (!controllers) throw new Error('Workspace page requires WorkspaceLayout')
  controllers.set(page, controller)
  // KeepAlive 停用时保留方法，真正卸载时才移除。
  onScopeDispose(() => { if (controllers.get(page) === controller) controllers.delete(page) })
}

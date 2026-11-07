import { computed, shallowRef } from 'vue'

/** 生产环境危险操作的确认请求，由 API 层发起、DatabaseGuardDialog 响应。 */
export interface DatabaseGuardPrompt {
  action: string
  expected: string
  resolve: (confirm: string | null) => void
}

const current = shallowRef<DatabaseGuardPrompt | null>(null)
const waiting: DatabaseGuardPrompt[] = []
// 每个缓存的连接视图都挂着对话框，只由最早挂载的那个显示，请求排队逐个确认。
const hosts = shallowRef<symbol[]>([])

/** 没有对话框可用（如独立子窗口）时返回 null，调用方按未确认处理。 */
export function requestGuardConfirm(
  action: string,
  expected: string
): Promise<string | null> {
  if (!hosts.value.length) return Promise.resolve(null)
  return new Promise(resolve => {
    const prompt = { action, expected, resolve }
    if (current.value) waiting.push(prompt)
    else current.value = prompt
  })
}

function settle(confirm: string | null): void {
  current.value?.resolve(confirm)
  current.value = waiting.shift() ?? null
}

/** 供对话框组件注册；返回当前实例应显示的请求。 */
export function useDatabaseGuardHost() {
  const id = Symbol('database-guard-host')
  return {
    prompt: computed(() => (hosts.value[0] === id ? current.value : null)),
    register: () => {
      hosts.value = [...hosts.value, id]
    },
    unregister: () => {
      hosts.value = hosts.value.filter(host => host !== id)
      if (hosts.value.length) return
      while (current.value) settle(null)
    },
    settle,
  }
}

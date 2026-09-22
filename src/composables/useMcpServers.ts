import { onBeforeUnmount, onMounted, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import * as api from '@/api/agent'
import type {
  McpSecret,
  McpSecretDraft,
  McpServer,
  McpServerDraft,
  McpServerInput,
  McpTarget,
} from '@/types/agent'
import { IS_TAURI } from '@/utils/window'

const TARGETS: McpTarget[] = ['ssh', 'database', 'redis']

function secrets(stored: McpSecret[]): McpSecretDraft[] {
  return stored.map(secret => ({
    key: secret.key,
    value: '',
    clear: false,
    hasValue: secret.hasValue,
  }))
}

export function draftFrom(server: McpServer): McpServerDraft {
  return {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    command: server.command,
    argsText: server.args.join('\n'),
    env: secrets(server.env),
    url: server.url,
    headers: secrets(server.headers),
    targets: [...server.targets],
    tools: [...server.tools],
  }
}

export function emptyDraft(): McpServerDraft {
  return {
    name: '',
    enabled: true,
    transport: 'stdio',
    command: '',
    argsText: '',
    env: [],
    url: '',
    headers: [],
    targets: [],
    tools: [],
  }
}

/** Turns the form into what the backend stores. Rejects a draft it would refuse. */
export function toInput(draft: McpServerDraft): McpServerInput | string {
  const name = draft.name.trim()
  if (!name) return '请填写 MCP 服务器名称'
  const pairs = (secrets: McpSecretDraft[]) =>
    secrets
      .filter(secret => secret.key.trim())
      .map(secret => ({
        key: secret.key.trim(),
        value: secret.value,
        clear: secret.clear,
      }))
  const base = {
    id: draft.id,
    name,
    enabled: draft.enabled,
    targets: TARGETS.filter(target => draft.targets.includes(target)),
  }
  if (draft.transport === 'http') {
    if (!draft.url.trim()) return '请填写 MCP 服务地址'
    return {
      ...base,
      transport: 'http',
      command: '',
      args: [],
      env: [],
      url: draft.url.trim(),
      headers: pairs(draft.headers),
    }
  }
  if (!draft.command.trim()) return '请填写启动命令'
  return {
    ...base,
    transport: 'stdio',
    command: draft.command.trim(),
    args: draft.argsText
      .split('\n')
      .map(arg => arg.trim())
      .filter(Boolean),
    env: pairs(draft.env),
    url: '',
    headers: [],
  }
}

export function useMcpServers() {
  const { t } = useI18n()
  let disposed = false
  const state = reactive({
    servers: [] as McpServer[],
    draft: null as McpServerDraft | null,
    selectedId: '',
    loading: true,
    busy: false,
    error: '',
    message: '',
    probe: '',
  })

  function select(server: McpServer): void {
    state.selectedId = server.id
    state.draft = draftFrom(server)
    state.error = ''
    state.probe = ''
  }

  function create(): void {
    state.selectedId = ''
    state.draft = emptyDraft()
    state.error = ''
    state.message = ''
    state.probe = ''
  }

  onMounted(async () => {
    try {
      if (IS_TAURI) state.servers = await api.listMcpServers()
      if (disposed) return
      const first = state.servers[0]
      if (first) select(first)
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.loading = false
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    for (const secret of [
      ...(state.draft?.env ?? []),
      ...(state.draft?.headers ?? []),
    ])
      secret.value = ''
  })

  async function save(): Promise<void> {
    const current = state.draft
    if (!current || state.busy) return
    const input = toInput(current)
    if (typeof input === 'string') {
      state.error = t(input)
      return
    }
    state.busy = true
    state.error = ''
    state.message = ''
    try {
      state.servers = await api.saveMcpServer(input)
      if (disposed) return
      const saved =
        state.servers.find(server => server.id === input.id) ??
        state.servers[state.servers.length - 1]
      if (saved) select(saved)
      state.message = t('MCP 服务器已保存。')
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }

  async function remove(): Promise<void> {
    const id = state.draft?.id
    if (!id || state.busy) return
    state.busy = true
    state.error = ''
    state.message = ''
    try {
      state.servers = await api.deleteMcpServer(id)
      if (disposed) return
      const first = state.servers[0]
      if (first) select(first)
      else state.draft = null
      state.message = t('MCP 服务器已删除。')
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }

  async function test(): Promise<void> {
    const id = state.draft?.id
    if (!id || state.busy) return
    state.busy = true
    state.error = ''
    state.message = ''
    state.probe = ''
    try {
      const probe = await api.testMcpServer(id)
      if (disposed) return
      state.servers = await api.listMcpServers()
      const refreshed = state.servers.find(server => server.id === id)
      if (refreshed && state.draft) state.draft.tools = [...refreshed.tools]
      state.probe = probe.tools.length
        ? t('已发现 {value0} 个工具。', { value0: probe.tools.length })
        : t('已连接，该服务器没有提供工具。')
    } catch (error) {
      state.error = api.errorMessage(error)
    } finally {
      state.busy = false
    }
  }

  return { ...toRefs(state), select, create, save, remove, test }
}

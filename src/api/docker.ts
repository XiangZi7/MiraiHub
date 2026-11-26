import { Channel, invoke } from '@tauri-apps/api/core'
import { get as getConnection } from '@/api/connections'
import * as ssh from '@/api/ssh'
import { i18n } from '@/i18n'
import { isSshConnection, toSshConfig } from '@/types/connection'
import type {
  DockerConnectionSettings,
  DockerContainer,
  DockerContainerAction,
} from '@/types/docker'

/** 从 Docker 配置找到保存的 SSH 凭据及跳板引用。 */
async function tunnelConfig(settings: DockerConnectionSettings) {
  const host = settings.sshConnectionId
    ? await getConnection(settings.sshConnectionId)
    : undefined
  if (!host || !isSshConnection(host))
    throw new Error(i18n.global.t('隧道使用的 SSH 连接不存在，请重新选择'))
  return toSshConfig(host)
}

function targetOf(settings: DockerConnectionSettings, sshSessionId?: string) {
  return {
    protocol: settings.protocol,
    endpoint: settings.endpoint,
    transport: settings.transport,
    sshSessionId: settings.transport === 'ssh' ? sshSessionId : undefined,
    proxyUrl: settings.proxyUrl || undefined,
  }
}

/** 为一次 Docker 请求准备端点；仅释放本次临时建立的 SSH 会话。 */
async function request<T>(
  command: string,
  settings: DockerConnectionSettings,
  args: Record<string, unknown>,
  sshSessionId?: string
): Promise<T> {
  let temporarySession: string | undefined
  try {
    if (settings.transport === 'ssh' && !sshSessionId) {
      temporarySession = await ssh.connect(await tunnelConfig(settings))
    }
    const target = targetOf(settings, sshSessionId || temporarySession)
    return await invoke<T>(command, { target, ...args })
  } finally {
    if (temporarySession) await ssh.disconnect(temporarySession).catch(() => {})
  }
}

/** 用真实 Engine 版本响应校验当前表单中的端点。 */
export function testConnection(
  settings: DockerConnectionSettings,
  sshSessionId?: string
) {
  return request<void>('docker_test', settings, {}, sshSessionId)
}

/** 列出全部容器，包括已退出的容器。 */
export function listContainers(
  settings: DockerConnectionSettings,
  sshSessionId?: string
) {
  return request<DockerContainer[]>(
    'docker_containers',
    settings,
    {},
    sshSessionId
  )
}

/** 对所选连接里的指定容器执行单次生命周期操作。 */
export function containerAction(
  settings: DockerConnectionSettings,
  id: string,
  action: DockerContainerAction,
  sshSessionId?: string
) {
  return request<void>(
    'docker_container_action',
    settings,
    { id, action },
    sshSessionId
  )
}

async function logArgs(
  settings: DockerConnectionSettings,
  id: string,
  connectionId: string
) {
  const sshConfig =
    settings.transport === 'ssh'
      ? await ssh.resolveSshRoute(await tunnelConfig(settings))
      : undefined
  return {
    target: targetOf(settings),
    id,
    connectionId,
    sshConfig,
  }
}

/** 读取指定容器最近 200 行带时间戳的标准输出和错误输出。 */
export async function containerLogs(
  settings: DockerConnectionSettings,
  id: string,
  connectionId: string
) {
  return invoke<string>(
    'docker_container_logs',
    await logArgs(settings, id, connectionId)
  )
}

/** 订阅同一容器的历史和新增文本；停止时等原生端关闭流及临时 SSH 隧道。 */
export function followContainerLogs(
  settings: DockerConnectionSettings,
  id: string,
  connectionId: string,
  onText: (text: string) => void
) {
  const subscriptionId = crypto.randomUUID()
  let registered = false
  let stopped = false
  let stopRequest: Promise<void> | undefined
  let deliveryError: unknown
  const cancel = () =>
    (stopRequest ??= invoke<void>('docker_logs_follow_stop', {
      subscriptionId,
    }))
  const receive = (
    event: { type: 'ready' } | { type: 'text'; text: string }
  ) => {
    if (event.type === 'ready') {
      registered = true
      if (stopped) void cancel().catch(() => {})
      return
    }
    if (stopped) return
    const deliver = async () => {
      onText(event.text)
      await invoke<void>('docker_logs_follow_ack', { subscriptionId })
    }
    void deliver().catch(error => {
      stopped = true
      deliveryError = error
      void cancel().catch(() => {})
    })
  }
  const done = (async () => {
    const args = await logArgs(settings, id, connectionId)
    if (stopped) return
    try {
      const output = new Channel(receive)
      await invoke<void>('docker_logs_follow', {
        ...args,
        subscriptionId,
        output,
      })
      if (deliveryError) throw deliveryError
    } finally {
      registered = false
    }
  })()
  return {
    done,
    async stop() {
      stopped = true
      if (registered) await cancel()
      await done
    },
  }
}

import type { DatabaseEnvironment } from '@/types/database'

/** Docker 连接配置，SSH 隧道引用已保存的 SSH 连接。 */
export interface DockerConnectionSettings {
  protocol: 'unix' | 'npipe' | 'http' | 'https'
  endpoint: string
  transport: 'direct' | 'ssh'
  sshConnectionId?: string
  proxyUrl?: string
  environment?: DatabaseEnvironment
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
}

export type DockerContainerAction = 'start' | 'stop' | 'restart'

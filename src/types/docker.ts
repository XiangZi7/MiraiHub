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
  composeProject?: string
  composeService?: string
}

export type DockerContainerAction = 'start' | 'stop' | 'restart'

/** 当前日志窗口的包含词、排除词和可选的 Unix 秒时间边界。 */
export interface DockerLogFilter {
  include: string
  exclude: string
  since?: number
  until?: number
}

/** 单个容器的只读详情；运行资源由同一引擎采样，未提供的测量值为 null。 */
export interface DockerContainerDetails {
  id: string
  name: string
  image: string
  state: string
  createdAt: string | null
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  oomKilled: boolean
  error: string
  restartCount: number
  health: {
    status: string
    failingStreak: number
    log: {
      start: string | null
      end: string | null
      exitCode: number
      output: string
    }[]
  } | null
  ports: { containerPort: string; hostIp: string; hostPort: string }[]
  mounts: {
    type: string
    name: string
    source: string
    destination: string
    writable: boolean
  }[]
  stats: {
    cpuPercent: number | null
    memoryBytes: number | null
    memoryLimitBytes: number | null
  } | null
}

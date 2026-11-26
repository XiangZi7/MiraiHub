import type { DockerConnectionSettings } from '@/types/docker'

export const DOCKER_UNIX_SOCKET = '/var/run/docker.sock'
export const DOCKER_NAMED_PIPE = String.raw`\\.\pipe\docker_engine`

/** Docker 与代理均只接受源地址，避免把凭据、查询参数或路径保存到配置中。 */
function validOrigin(value: string, protocol?: string): boolean {
  if (!/^https?:\/\/[^/?#@\\\s]+\/?$/i.test(value)) return false
  try {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      (!protocol || url.protocol === protocol + ':')
    )
  } catch {
    return false
  }
}

/** 配置窗口与备份导入共用校验，返回可直接翻译的表单错误。 */
export function dockerSettingsProblem(
  settings: DockerConnectionSettings
): string {
  const { protocol, endpoint, transport, sshConnectionId, proxyUrl } = settings
  if (!endpoint || /[\u0000-\u001f\u007f]/u.test(endpoint))
    return '请输入有效的 Docker 端点'
  if (protocol === 'unix' && !endpoint.startsWith('/'))
    return '请输入 Unix Socket 的绝对路径'
  if (protocol === 'npipe' && !/^\\\\\.\\pipe\\[^\\/:*?"<>|]+$/i.test(endpoint))
    return '请输入有效的本地命名管道路径'
  if (
    (protocol === 'http' || protocol === 'https') &&
    !validOrigin(endpoint, protocol)
  )
    return '端点需为所选协议的主机地址，可包含端口'
  if (transport === 'ssh') {
    if (protocol === 'npipe') return '命名管道仅支持本地直连'
    if (!sshConnectionId?.trim()) return '请选择 SSH 隧道连接'
  }
  if (
    proxyUrl &&
    (transport !== 'direct' ||
      (protocol !== 'http' && protocol !== 'https') ||
      !validOrigin(proxyUrl))
  )
    return '请为直接 HTTP(S) 连接填写有效的代理地址'
  return ''
}

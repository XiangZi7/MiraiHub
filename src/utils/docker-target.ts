import {
  connectionFingerprint,
  isSshConnection,
  type SavedConnection,
} from '@/types/connection'
import type { DockerConnectionSettings } from '@/types/docker'

/** 仅在内存中比较列表与日志所用的引擎、SSH 代理及跳板配置。 */
export function dockerTargetFingerprint(
  profile: SavedConnection & { settings: DockerConnectionSettings },
  find: (id: string) => SavedConnection | undefined
): string {
  const tunnel =
    profile.settings.transport === 'ssh'
      ? find(profile.settings.sshConnectionId ?? '')
      : undefined
  const jumps =
    tunnel && isSshConnection(tunnel) ? (tunnel.settings.jumpHostIds ?? []) : []
  return JSON.stringify([
    connectionFingerprint(profile),
    connectionFingerprint(tunnel),
    ...jumps.map(id => connectionFingerprint(find(id))),
  ])
}

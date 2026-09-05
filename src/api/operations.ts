import { invoke } from '@tauri-apps/api/core'
import type { RemoteEditRequest } from '@/composables/useRemoteEditor'
import { IS_TAURI } from '@/utils/window'
export { errorMessage } from './ssh'
function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(new Error('此功能需要在 MiraiHub 桌面程序中使用'))
  return invoke<T>(command, args)
}
export interface Tunnel {
  id: string
  sessionId: string
  endpoint: string
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
  status: 'running' | 'stopped'
  error: string
  connections: number
}
export interface BatchPlan {
  id: string
  command: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'expired'
  expiresAt: number
  targets: {
    sessionId: string
    endpoint: string
    status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
    output: { stdout: string; stderr: string; exitCode: number | null } | null
    error: string
  }[]
}
export interface TextDocument {
  id: string
  sessionId: string
  endpoint: string
  path: string
  text: string
  lineEnding: string
  bom: boolean
  backupPath: string | null
}
export const listTunnels = () => call<Tunnel[]>('ssh_tunnel_list')
export const startTunnel = (request: {
  sessionId: string
  bindHost: string
  bindPort: number
  targetHost: string
  targetPort: number
}) => call<Tunnel>('ssh_tunnel_start', { request })
export const stopTunnel = (id: string) => call<void>('ssh_tunnel_stop', { id })
export const removeTunnel = (id: string) =>
  call<void>('ssh_tunnel_remove', { id })
export const prepareBatch = (sessionIds: string[], command: string) =>
  call<BatchPlan>('ssh_batch_prepare', { sessionIds, command })
export const runBatch = (id: string) => call<BatchPlan>('ssh_batch_run', { id })
export const getBatch = (id: string) => call<BatchPlan>('ssh_batch_get', { id })
export const cancelBatch = (id: string) =>
  call<void>('ssh_batch_cancel', { id })
export const forgetBatch = (id: string) =>
  call<void>('ssh_batch_forget', { id })
export const openText = (sessionId: string, path: string) =>
  call<TextDocument>('ssh_text_open', { sessionId, path })
export const saveText = (id: string, text: string) =>
  call<TextDocument>('ssh_text_save', { id, text })
export const closeText = (id: string) => call<void>('ssh_text_close', { id })
export const writeBackup = (path: string, payload: unknown, password: string) =>
  call<void>('connection_backup_write', { path, payload, password })
export const readBackup = (path: string, password: string) =>
  call<unknown>('connection_backup_read', { path, password })

export const openRemoteEditorWindow = (request: RemoteEditRequest) =>
  call<void>('open_remote_editor_window', { request })
export const remoteEditorTarget = () =>
  call<RemoteEditRequest>('remote_editor_target')
export const remoteEditorStatus = (dirty: boolean, busy: boolean) =>
  call<void>('remote_editor_status', { dirty, busy })
export const finishRemoteEditor = () => call<void>('remote_editor_finish')

import { invoke } from '@tauri-apps/api/core'
export interface LocalFileEntry {
  path: string
  name: string
  directory: boolean
  size: number
  modifiedAt: number
}
export interface LocalListing {
  path: string
  parent: string | null
  entries: LocalFileEntry[]
}
export interface SyncScan {
  localRoot: string
  remoteRoot: string
  local: LocalFileEntry[]
  remote: LocalFileEntry[]
}
/** 本地面板只读浏览文件，上传仍由现有传输队列处理。 */
export const listLocalDirectory = (path = '') =>
  invoke<LocalListing>('local_list_directory', { path })
/** 获取双端目录的只读快照，先预览差异再创建传输任务。 */
export const scanSyncDirectories = (
  sessionId: string,
  localPath: string,
  remotePath: string
) => invoke<SyncScan>('ssh_sync_scan', { sessionId, localPath, remotePath })

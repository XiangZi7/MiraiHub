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
/** 读取本地面板的当前目录。 */
export const listLocalDirectory = (path = '') =>
  invoke<LocalListing>('local_list_directory', { path })

/** 由系统默认应用打开本地文件面板中的文件。 */
export const openLocalFile = (path: string) =>
  invoke<void>('local_open_file', { path })

/** 将拖入的文件和目录复制到当前本地目录，返回实际名称和逐项失败原因。 */
export const copyLocalEntries = (paths: string[], directory: string) =>
  invoke<{ copied: string[]; failed: { path: string; message: string }[] }>(
    'local_copy_entries',
    { paths, directory }
  )

/** 获取双端目录的只读快照，先预览差异再创建传输任务。 */
export const scanSyncDirectories = (
  sessionId: string,
  localPath: string,
  remotePath: string
) => invoke<SyncScan>('ssh_sync_scan', { sessionId, localPath, remotePath })

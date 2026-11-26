import { computed, shallowRef } from 'vue'
import { useFileTransfers } from '@/composables/useFileTransfers'
import type { SshRemoteFile } from '@/types/ssh'

type FileLocation = Pick<SshRemoteFile, 'path' | 'name'>
const clipboard = shallowRef<{ sessionId: string; files: FileLocation[] }>()

/** 在 SSH 文件面板之间共享远端文件的位置，以相同的传输队列处理粘贴和拖放。 */
export function useRemoteFileClipboard() {
  const transfers = useFileTransfers()
  const hasFiles = computed(() => Boolean(clipboard.value))

  /** 复制时固定会话与文件路径，离开原目录后仍可重复粘贴。 */
  function copy(sessionId: string, files: readonly SshRemoteFile[]): void {
    if (!sessionId || !files.length) return
    clipboard.value = {
      sessionId,
      files: files.map(({ path, name }) => ({ path, name })),
    }
  }

  /** 为每个文件排入独立任务，粘贴由原生端在写入时分配可用名称。 */
  async function copyInto(
    source: { sessionId: string; files: readonly FileLocation[] },
    target: { sessionId: string; connectionName: string; directory: string },
    autoRename: boolean
  ): Promise<void> {
    await Promise.all(
      source.files.map(file =>
        transfers.copyRemote({
          sourceSessionId: source.sessionId,
          sessionId: target.sessionId,
          connectionName: target.connectionName,
          source: file.path,
          remotePath: `${target.directory.replace(/\/$/, '')}/${file.name}`,
          autoRename,
        })
      )
    )
  }

  /** 粘贴时获取剪贴板快照，后续复制操作不会更改已入队的任务。 */
  async function paste(target: Parameters<typeof copyInto>[1]): Promise<void> {
    if (clipboard.value) await copyInto(clipboard.value, target, true)
  }

  return { hasFiles, copy, paste, copyInto }
}

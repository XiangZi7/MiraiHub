import type { LocalFileEntry, SyncScan } from '@/api/workspace-files'
export interface SyncDifference { path: string; size: number; conflict: boolean; reason: 'missing' | 'changed' }
/** 只比较文件大小和秒级修改时间；类型冲突显式标记，永远不生成删除操作。 */
export function directoryDifferences(scan: SyncScan, direction: 'upload' | 'download'): SyncDifference[] {
  const [source, target] = direction === 'upload' ? [scan.local, scan.remote] : [scan.remote, scan.local]
  const targets = new Map<string, LocalFileEntry>(target.map(item => [item.path, item]))
  return source.filter(item => !item.directory).flatMap(item => {
    const previous = targets.get(item.path)
    const ancestors = item.path.split('/').slice(0, -1)
    const conflict = Boolean(previous?.directory) || ancestors.some((_, index) => targets.get(ancestors.slice(0, index + 1).join('/'))?.directory === false)
    if (previous && !conflict && previous.size === item.size && Math.abs(previous.modifiedAt - item.modifiedAt) < 2000) return []
    return [{ path: item.path, size: item.size, conflict, reason: previous ? 'changed' as const : 'missing' as const }]
  })
}

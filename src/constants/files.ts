import type { FileEntry, TreeNode } from '@/types'

/** 文件管理器左侧目录树 */
export const FILE_TREE: TreeNode[] = [
  { id: 'root', label: '/', depth: 0, expanded: true },
  { id: 'home', label: 'home', depth: 1, expanded: true },
  { id: 'user', label: 'user', depth: 2, expanded: true },
  { id: 'project', label: 'project', depth: 3, leaf: true, active: true },
  { id: 'logs', label: 'logs', depth: 3, leaf: true },
  { id: 'backup', label: 'backup', depth: 3, leaf: true },
  { id: 'var', label: 'var', depth: 1 },
  { id: 'etc', label: 'etc', depth: 1 },
  { id: 'usr', label: 'usr', depth: 1 },
  { id: 'tmp', label: 'tmp', depth: 1 },
]

/** 文件列表 */
export const FILE_ENTRIES: FileEntry[] = [
  { id: 'f1', name: 'project', size: '–', modified: 'Today 09:42', kind: 'folder' },
  { id: 'f2', name: 'logs', size: '–', modified: 'Yesterday 18:30', kind: 'folder' },
  { id: 'f3', name: 'package.json', size: '2 KB', modified: 'Today 09:41', kind: 'json' },
  { id: 'f4', name: 'README.md', size: '8 KB', modified: 'Today 09:41', kind: 'markdown' },
  { id: 'f5', name: 'app.js', size: '3 KB', modified: 'Today 09:40', kind: 'js' },
  { id: 'f6', name: '.env', size: '1 KB', modified: 'Yesterday 21:15', kind: 'env' },
  { id: 'f7', name: 'config.yaml', size: '2 KB', modified: 'Yesterday 20:11', kind: 'yaml' },
]

/** 文件类型 → 图标与配色 */
export const FILE_KIND_META: Record<FileEntry['kind'], { icon: string, tone: string }> = {
  folder: { icon: 'lucide:folder', tone: 'text-blue' },
  json: { icon: 'lucide:file-json', tone: 'text-amber' },
  markdown: { icon: 'lucide:file-text', tone: 'text-orange' },
  js: { icon: 'lucide:file-code-2', tone: 'text-amber' },
  env: { icon: 'lucide:file-cog', tone: 'text-txt-3' },
  yaml: { icon: 'lucide:file-text', tone: 'text-cyan' },
}

/** 面包屑路径 */
export const BREADCRUMBS = ['home', 'user', 'project'] as const

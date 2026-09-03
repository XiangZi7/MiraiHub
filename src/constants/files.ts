import type { FileEntry } from '@/types'

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

/** 文件类型 → 图标与配色。图标一律实心（对齐 UI 稿），类型靠颜色区分 */
export const FILE_KIND_META: Record<FileEntry['kind'], { icon: string, tone: string }> = {
  folder: { icon: 'mirai:folder', tone: 'text-blue' },
  json: { icon: 'mirai:file', tone: 'text-amber' },
  markdown: { icon: 'mirai:file', tone: 'text-orange' },
  js: { icon: 'mirai:file', tone: 'text-accent' },
  env: { icon: 'mirai:file', tone: 'text-txt-3' },
  yaml: { icon: 'mirai:file', tone: 'text-cyan' },
}

/** 面包屑路径 */
export const BREADCRUMBS = ['home', 'user', 'project'] as const

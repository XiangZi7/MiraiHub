/**
 * 文件类型 → 图标与配色。
 *
 * 图标一律实心（对齐 UI 稿），类型靠颜色区分。
 * 远端目录项没有"类型"字段，只能按扩展名归类。
 */

/** 归类后的文件种类 */
export type FileKindKey =
  | 'folder'
  | 'json'
  | 'markdown'
  | 'code'
  | 'config'
  | 'archive'
  | 'image'
  | 'log'
  | 'plain'

export const FILE_KIND_META: Record<
  FileKindKey,
  { icon: string; tone: string }
> = {
  folder: { icon: 'mirai:folder', tone: 'text-blue' },
  json: { icon: 'mirai:file', tone: 'text-amber' },
  markdown: { icon: 'mirai:file', tone: 'text-orange' },
  code: { icon: 'mirai:file', tone: 'text-accent' },
  config: { icon: 'mirai:file', tone: 'text-cyan' },
  archive: { icon: 'mirai:file', tone: 'text-pink' },
  image: { icon: 'mirai:file', tone: 'text-violet' },
  log: { icon: 'mirai:file', tone: 'text-txt-3' },
  plain: { icon: 'mirai:file', tone: 'text-txt-3' },
}

/** 扩展名 → 种类。没列到的一律 plain */
const EXTENSION_MAP: Record<string, FileKindKey> = {
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',

  js: 'code',
  mjs: 'code',
  cjs: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  vue: 'code',
  rs: 'code',
  go: 'code',
  py: 'code',
  rb: 'code',
  php: 'code',
  java: 'code',
  c: 'code',
  h: 'code',
  cpp: 'code',
  sh: 'code',
  bash: 'code',
  zsh: 'code',
  sql: 'code',

  yaml: 'config',
  yml: 'config',
  toml: 'config',
  ini: 'config',
  conf: 'config',
  cfg: 'config',
  env: 'config',

  zip: 'archive',
  gz: 'archive',
  tar: 'archive',
  bz2: 'archive',
  xz: 'archive',
  rar: 'archive',
  '7z': 'archive',

  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  svg: 'image',
  webp: 'image',
  ico: 'image',

  log: 'log',
}

/**
 * 按文件名判定种类。
 *
 * 点开头的文件（.env、.gitignore）整体当扩展名看 ——
 * 它们没有"名字 + 扩展名"的结构，按最后一个点切会得到空的基名。
 */
export function extensionOf(name: string): FileKindKey {
  const lower = name.toLowerCase()

  if (lower.startsWith('.')) {
    const bare = lower.slice(1)
    return EXTENSION_MAP[bare] ?? 'config'
  }

  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return 'plain'

  return EXTENSION_MAP[lower.slice(dot + 1)] ?? 'plain'
}

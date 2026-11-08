/**
 * 文件类型 → 图标与配色。
 *
 * 统一使用与工作台一致的 Lucide 线条图标，类型通过图形和主题配色区分。
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

// 两端文件列表共用离线线条图标和主题色，避免混入不同风格的文件图案。
const FILE_ICONS: ReadonlyArray<readonly [string, string, string]> = [
  ['doc docx docm dot dotx odt rtf', 'lucide:file-text', 'text-blue'],
  ['xls xlsx xlsm xlsb csv tsv ods', 'lucide:file-spreadsheet', 'text-success'],
  ['ppt pptx pps ppsx odp', 'lucide:presentation', 'text-orange'],
  ['pdf', 'lucide:file-type', 'text-danger'],
  [
    'png jpg jpeg gif webp avif bmp ico tif tiff heic psd svg',
    'lucide:image',
    'text-violet',
  ],
  ['mp3 wav flac aac ogg m4a opus wma midi', 'lucide:music-2', 'text-pink'],
  ['mp4 mkv mov avi webm m4v wmv flv', 'lucide:film', 'text-pink'],
  [
    'zip rar 7z tar gz bz2 xz tgz zst cab iso',
    'lucide:file-archive',
    'text-amber',
  ],
  ['js mjs cjs', 'lucide:file-code', 'text-amber'],
  ['ts mts cts', 'lucide:file-code-2', 'text-blue'],
  ['vue jsx tsx', 'lucide:component', 'text-success'],
  ['json jsonc json5 jsonl', 'lucide:braces', 'text-amber'],
  ['md markdown mdx', 'lucide:notebook-text', 'text-blue'],
  ['html htm css scss sass less', 'lucide:code-xml', 'text-orange'],
  [
    'py pyw pyc ipynb rs go java jar class kt kts c h cpp cxx cc hpp hxx cs php rb',
    'lucide:file-code-2',
    'text-cyan',
  ],
  [
    'sh bash zsh fish bat cmd ps1 psm1 psd1',
    'lucide:file-terminal',
    'text-success',
  ],
  ['sql db sqlite sqlite3 db3', 'lucide:database', 'text-blue'],
  [
    'yaml yml toml ini conf config cfg env properties xml',
    'lucide:file-cog',
    'text-cyan',
  ],
  ['log', 'lucide:scroll-text', 'text-txt-3'],
  ['txt text', 'lucide:file-text', 'text-txt-3'],
  ['ttf otf woff woff2 eot', 'lucide:letter-text', 'text-violet'],
  ['exe dll bin msi dmg deb rpm apk appimage', 'lucide:binary', 'text-txt-3'],
  ['pem key pub crt cer p12 pfx', 'lucide:file-key-2', 'text-amber'],
]
const iconsByExtension = new Map(
  FILE_ICONS.flatMap(([extensions, icon, tone]) =>
    extensions.split(' ').map(extension => [extension, { icon, tone }] as const)
  )
)

// 常见服务器目录补充语义图标，普通目录沿用工作台的蓝色文件夹。
const FOLDER_ICONS: Record<string, string> = {
  '.ssh': 'lucide:folder-key',
  '.config': 'lucide:folder-cog',
  '.git': 'lucide:folder-git-2',
  '.cache': 'lucide:folder-sync',
  '.docker': 'lucide:folder-code',
  '.local': 'lucide:folder-dot',
  '.npm': 'lucide:folder-archive',
  '.nvm': 'lucide:folder-code',
  '.pm2': 'lucide:folder-cog',
  node_modules: 'lucide:folder-archive',
}

/** 按完整文件名、扩展名和目录类型选择对应图标，未知格式保留通用文件图标。 */
export function fileIcon(
  name: string,
  kind = 'file'
): { icon: string; tone: string } {
  const lower = name.toLowerCase()
  if (kind === 'directory')
    return { icon: FOLDER_ICONS[lower] ?? 'lucide:folder', tone: 'text-blue' }
  if (kind === 'symlink' || /\.(lnk|url)$/i.test(name))
    return { icon: 'lucide:file-symlink', tone: 'text-violet' }
  if (lower === 'dockerfile' || lower.startsWith('docker-compose.'))
    return { icon: 'lucide:container', tone: 'text-blue' }
  if (
    lower === '.gitignore' ||
    lower === '.gitconfig' ||
    lower === '.gitattributes' ||
    lower === '.gitmodules'
  )
    return { icon: 'lucide:git-branch', tone: 'text-orange' }
  if (lower === '.env' || lower.startsWith('.env.'))
    return { icon: 'lucide:file-cog', tone: 'text-cyan' }
  if (/^\.(bash|zsh|profile|zprofile|zlogin)/.test(lower))
    return { icon: 'lucide:file-terminal', tone: 'text-success' }
  if (
    /^(id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|authorized_keys|known_hosts)$/.test(
      lower
    )
  )
    return { icon: 'lucide:file-key-2', tone: 'text-amber' }
  const meta = iconsByExtension.get(lower.split('.').at(-1) ?? '')
  if (meta) return meta
  if (lower.startsWith('.'))
    return { icon: 'lucide:file-cog', tone: 'text-txt-3' }
  return { icon: 'lucide:file', tone: 'text-txt-3' }
}

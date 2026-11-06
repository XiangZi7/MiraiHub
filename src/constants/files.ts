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

// 两端文件列表共用离线彩色图标；同类扩展名共享对应格式的图案。
const FILE_ICONS: ReadonlyArray<readonly [string, string]> = [
  ['doc docx docm dot dotx odt rtf', 'vscode-icons:file-type-word'],
  ['xls xlsx xlsm xlsb csv tsv ods', 'vscode-icons:file-type-excel'],
  ['ppt pptx pps ppsx odp', 'vscode-icons:file-type-powerpoint'],
  ['pdf', 'vscode-icons:file-type-pdf2'],
  [
    'png jpg jpeg gif webp avif bmp ico tif tiff heic psd',
    'vscode-icons:file-type-image',
  ],
  ['svg', 'vscode-icons:file-type-svg'],
  ['mp3 wav flac aac ogg m4a opus wma midi', 'vscode-icons:file-type-audio'],
  ['mp4 mkv mov avi webm m4v wmv flv', 'vscode-icons:file-type-video'],
  ['zip rar 7z tar gz bz2 xz tgz zst cab iso', 'vscode-icons:file-type-zip'],
  ['js mjs cjs', 'vscode-icons:file-type-js-official'],
  ['jsx', 'vscode-icons:file-type-reactjs'],
  ['ts mts cts', 'vscode-icons:file-type-typescript-official'],
  ['tsx', 'vscode-icons:file-type-reactts'],
  ['vue', 'vscode-icons:file-type-vue'],
  ['json jsonc json5 jsonl', 'vscode-icons:file-type-json'],
  ['md markdown mdx', 'vscode-icons:file-type-markdown'],
  ['html htm', 'vscode-icons:file-type-html'],
  ['css scss sass less', 'vscode-icons:file-type-css'],
  ['py pyw pyc ipynb', 'vscode-icons:file-type-python'],
  ['rs', 'vscode-icons:file-type-rust'],
  ['go', 'vscode-icons:file-type-go'],
  ['java jar class kt kts', 'vscode-icons:file-type-java'],
  ['c h', 'vscode-icons:file-type-c'],
  ['cpp cxx cc hpp hxx', 'vscode-icons:file-type-cpp'],
  ['cs', 'vscode-icons:file-type-csharp'],
  ['php', 'vscode-icons:file-type-php'],
  ['rb', 'vscode-icons:file-type-ruby'],
  ['sh bash zsh fish bat cmd', 'vscode-icons:file-type-shell'],
  ['ps1 psm1 psd1', 'vscode-icons:file-type-powershell'],
  ['sql', 'vscode-icons:file-type-sql'],
  ['db sqlite sqlite3 db3', 'vscode-icons:file-type-sqlite'],
  ['yaml yml', 'vscode-icons:file-type-yaml'],
  ['toml', 'vscode-icons:file-type-toml'],
  ['ini conf config cfg env properties xml', 'vscode-icons:file-type-config'],
  ['log', 'vscode-icons:file-type-log'],
  ['txt text', 'vscode-icons:file-type-text'],
  ['ttf otf woff woff2 eot', 'vscode-icons:file-type-font'],
  ['exe dll bin msi dmg deb rpm apk appimage', 'vscode-icons:file-type-binary'],
]
const iconsByExtension = new Map(
  FILE_ICONS.flatMap(([extensions, icon]) =>
    extensions.split(' ').map(extension => [extension, icon] as const)
  )
)

/** 按完整文件名、扩展名和目录类型选择对应图标，未知格式保留通用文件图标。 */
export function fileIcon(
  name: string,
  kind = 'file'
): { icon: string; tone: string } {
  if (kind === 'directory')
    return { icon: 'vscode-icons:default-folder', tone: '' }
  if (kind === 'symlink' || /\.(lnk|url)$/i.test(name))
    return { icon: 'lucide:file-symlink', tone: 'text-violet' }
  const lower = name.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('docker-compose.'))
    return { icon: 'vscode-icons:file-type-docker', tone: '' }
  if (
    lower === '.gitignore' ||
    lower === '.gitattributes' ||
    lower === '.gitmodules'
  )
    return { icon: 'vscode-icons:file-type-git', tone: '' }
  if (lower === '.env' || lower.startsWith('.env.'))
    return { icon: 'vscode-icons:file-type-config', tone: '' }
  if (lower.endsWith('.d.ts'))
    return { icon: 'vscode-icons:file-type-typescriptdef', tone: '' }
  return {
    icon:
      iconsByExtension.get(lower.split('.').at(-1) ?? '') ??
      'vscode-icons:default-file',
    tone: '',
  }
}

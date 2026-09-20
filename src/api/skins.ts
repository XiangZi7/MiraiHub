import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { IS_TAURI } from '@/utils/window'

/**
 * 皮肤目录。
 *
 * 内置皮肤的图片、样式和清单随安装包放在 `<安装目录>/skins/<id>/`，
 * 用户直接改文件夹里的东西就能换皮。浏览器预览时没有这个目录，
 * 由 Vite 开发服务器把 `src-tauri/skins` 挂在 `/skins` 下顶上。
 */
export interface SkinFolder {
  id: string
  path: string
}

export interface SkinDirectory {
  root: string
  skins: SkinFolder[]
}

/** 皮肤目录里的 skin.json。字段都可选，缺了就用主题默认值。 */
export interface SkinManifest {
  /** 卡片标题 */
  name?: string
  /** 卡片副标题（例如作品出处） */
  description?: string
  /** 卡片右下角的小字（例如角色名） */
  caption?: string
  /** 卡片中的引言 */
  quote?: string
  /** 亮色皮肤时终端配色与取色器默认值按浅色处理 */
  colorScheme?: 'light' | 'dark'
  /** 背景图文件名，默认 background.png */
  background?: string
  /** 样式表文件名，默认 skin.css */
  stylesheet?: string
}

/**
 * 随安装包发布的皮肤 id，目录名就是 id。
 * 目录扫描到的其他文件夹同样会作为皮肤展示；这份清单只用来在目录尚未读取时认得已保存的选择。
 */
export const BUILTIN_SKIN_IDS = ['kuriyama-mirai'] as const

const PREVIEW_ROOT = '/skins'

let directory: Promise<SkinDirectory> | undefined

export function skinDirectory(force = false): Promise<SkinDirectory> {
  if (force) directory = undefined
  return (directory ??= IS_TAURI
    ? invoke<SkinDirectory>('skin_directory')
    : Promise.resolve({
        root: PREVIEW_ROOT,
        skins: BUILTIN_SKIN_IDS.map(id => ({
          id,
          path: `${PREVIEW_ROOT}/${id}`,
        })),
      }))
}

/** 把皮肤目录里的文件路径换成 WebView 能加载的 URL。 */
export function skinFileUrl(folder: SkinFolder, file: string): string {
  if (!IS_TAURI) return `${folder.path}/${file}`
  const separator = folder.path.includes('\\') ? '\\' : '/'
  return convertFileSrc(`${folder.path}${separator}${file}`)
}

export async function openSkinDirectory(id?: string): Promise<void> {
  if (!IS_TAURI) return
  await invoke('open_skin_directory', { id: id ?? null })
}

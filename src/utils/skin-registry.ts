import { shallowReactive } from 'vue'
import {
  BUILTIN_SKIN_IDS,
  skinDirectory,
  skinFileUrl,
  type SkinFolder,
  type SkinManifest,
} from '@/api/skins'

/**
 * 内置皮肤注册表。
 *
 * 皮肤的图片、样式表和清单都放在安装目录的 skins 文件夹里，启动时读一遍进内存；
 * 之后 `skinCss` / `skinBackground` 这些同步函数直接查表。
 * 用户改了文件夹里的东西，「重新加载皮肤」会把这里刷一遍。
 */
export interface BuiltinSkin {
  id: string
  name: string
  description: string
  caption: string
  quote: string
  colorScheme: 'light' | 'dark'
  /** 背景图 URL，没有背景图时为空串 */
  background: string
  /** 样式表内容，缺失时为空串 */
  css: string
  /** 所在目录，浏览器预览时为 public 路径 */
  folder?: SkinFolder
}

export const skinRegistry = shallowReactive({
  loaded: false,
  loading: false,
  /** 每次重新加载递增，让依赖皮肤资源的 watch 重新执行 */
  version: 0,
  skins: new Map<string, BuiltinSkin>(),
})

/** 皮肤 id 只允许安全的目录名，避免拼进路径时越界。 */
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export function builtinSkin(id: string): BuiltinSkin | undefined {
  return skinRegistry.skins.get(id)
}

export function builtinSkins(): BuiltinSkin[] {
  return [...skinRegistry.skins.values()]
}

/**
 * 这个 id 是否指向内置主题（含 default）。
 *
 * 目录还没读完时不能贸然把用户保存的 id 归零，否则设置一加载皮肤就丢了；
 * 此时凡是合法目录名都先认，等目录读完再由 refresh 纠正。
 */
export function isBuiltinSkinId(id: string): boolean {
  if (id === 'default') return true
  if ((BUILTIN_SKIN_IDS as readonly string[]).includes(id)) return true
  if (skinRegistry.skins.has(id)) return true
  return !skinRegistry.loaded && SKIN_ID.test(id)
}

/** 手动登记一套皮肤：测试用，运行时也可给没有目录的兜底皮肤用。 */
export function registerBuiltinSkin(
  skin: Partial<BuiltinSkin> & { id: string }
): BuiltinSkin {
  const entry: BuiltinSkin = {
    name: skin.id,
    description: '',
    caption: '',
    quote: '',
    colorScheme: 'dark',
    background: '',
    css: '',
    ...skin,
  }
  // 换一个新 Map 而不是原地 set：shallowReactive 只追踪属性替换。
  skinRegistry.skins = new Map(skinRegistry.skins).set(entry.id, entry)
  skinRegistry.version += 1
  return entry
}

async function readText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url)
    return response.ok ? await response.text() : undefined
  } catch {
    return undefined
  }
}

async function readSkin(folder: SkinFolder): Promise<BuiltinSkin | undefined> {
  if (!SKIN_ID.test(folder.id)) return undefined
  const raw = await readText(skinFileUrl(folder, 'skin.json'))
  let manifest: SkinManifest = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      manifest = parsed as SkinManifest
  } catch {
    // 清单写坏了也不至于让皮肤消失，其余字段走默认值。
  }
  const text = (value: unknown, fallback = ''): string =>
    typeof value === 'string' ? value.trim() : fallback
  // 文件名只认纯文件，不允许带路径。
  const file = (value: unknown, fallback: string): string => {
    const name = text(value, fallback)
    return /^[\w.-]+$/.test(name) ? name : fallback
  }
  const stylesheet = file(manifest.stylesheet, 'skin.css')
  const background = file(manifest.background, 'background.png')
  const [css, hasBackground] = await Promise.all([
    readText(skinFileUrl(folder, stylesheet)),
    // 明确的 404 才算没有背景图；协议不支持 HEAD 之类的异常按"有"处理，交给 CSS 兜底。
    fetch(skinFileUrl(folder, background), { method: 'HEAD' })
      .then(response => response.ok)
      .catch(() => true),
  ])
  return {
    id: folder.id,
    name: text(manifest.name, folder.id),
    description: text(manifest.description),
    caption: text(manifest.caption),
    quote: text(manifest.quote),
    colorScheme: manifest.colorScheme === 'light' ? 'light' : 'dark',
    background: hasBackground ? skinFileUrl(folder, background) : '',
    css: css ?? '',
    folder,
  }
}

let pending: Promise<void> | undefined

/**
 * 读取皮肤目录。幂等：并发调用共用同一次读取；`force` 重新扫描。
 */
export function loadSkinRegistry(force = false): Promise<void> {
  if (pending && !force) return pending
  if (skinRegistry.loaded && !force) return Promise.resolve()
  skinRegistry.loading = true
  pending = (async () => {
    try {
      const directory = await skinDirectory(force)
      const skins = await Promise.all(directory.skins.map(readSkin))
      const next = new Map<string, BuiltinSkin>()
      for (const skin of skins) if (skin) next.set(skin.id, skin)
      skinRegistry.skins = next
    } catch (error) {
      console.warn('读取皮肤目录失败：', error)
    } finally {
      skinRegistry.loaded = true
      skinRegistry.loading = false
      skinRegistry.version += 1
      pending = undefined
    }
  })()
  return pending
}

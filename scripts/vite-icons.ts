import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import type { IconifyJSON } from '@iconify/vue'

const require = createRequire(import.meta.url)
const collection: IconifyJSON = JSON.parse(
  readFileSync(require.resolve('@iconify-json/lucide/icons.json'), 'utf8')
)
const fileCollection: IconifyJSON = JSON.parse(
  readFileSync(require.resolve('@iconify-json/vscode-icons/icons.json'), 'utf8')
)

/** Collect literal names from templates and metadata, including alias parents. */
export function collectIcons(root: string, source = collection): IconifyJSON {
  const names = new Set<string>()
  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (/\.(vue|[cm]?[jt]sx?)$/.test(entry.name)) {
        for (const match of readFileSync(file, 'utf8').matchAll(
          new RegExp(`${source.prefix}:([a-z0-9-]+)`, 'g')
        ))
          names.add(match[1])
      }
    }
  }
  scan(root)
  const icons: IconifyJSON['icons'] = {}
  const aliases: NonNullable<IconifyJSON['aliases']> = {}
  function include(name: string): void {
    if (icons[name] || aliases[name]) return
    if (source.icons[name]) icons[name] = source.icons[name]
    else if (source.aliases?.[name]) {
      aliases[name] = source.aliases[name]
      include(aliases[name].parent)
    } else throw new Error(`Unknown offline icon: ${source.prefix}:${name}`)
  }
  for (const name of [...names].sort()) include(name)
  return {
    prefix: source.prefix,
    width: source.width,
    height: source.height,
    icons,
    aliases,
  }
}

export function offlineIcons(): Plugin {
  const collections = new Map([
    ['virtual:mirai-icons', collection],
    ['virtual:mirai-file-icons', fileCollection],
  ])
  let root: string
  const sources = new Map<string, string>()
  // 各图标集只打包源码实际使用的图标，桌面端离线使用无需网络请求。
  const generate = (source: IconifyJSON) =>
    `export default ${JSON.stringify(collectIcons(root, source))}`
  return {
    name: 'mirai-offline-icons',
    configResolved(config) {
      root = resolve(config.root, 'src')
    },
    resolveId(name) {
      if (collections.has(name)) return `\0${name}`
    },
    load(name) {
      const source = collections.get(name.slice(1))
      if (source) {
        const code = generate(source)
        sources.set(name, code)
        return code
      }
    },
    handleHotUpdate(context) {
      if (
        !context.file
          .replaceAll('\\', '/')
          .startsWith(root.replaceAll('\\', '/') + '/')
      )
        return
      let changed = false
      for (const [name, collection] of collections) {
        const id = `\0${name}`
        const next = generate(collection)
        if (next === sources.get(id)) continue
        sources.set(id, next)
        const module = context.server.moduleGraph.getModuleById(id)
        if (module) context.server.moduleGraph.invalidateModule(module)
        changed = true
      }
      if (changed) context.server.ws.send({ type: 'full-reload' })
    },
  }
}

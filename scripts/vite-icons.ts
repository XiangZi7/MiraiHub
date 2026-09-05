import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import type { IconifyJSON } from '@iconify/vue'

const require = createRequire(import.meta.url)
const collection: IconifyJSON = JSON.parse(
  readFileSync(require.resolve('@iconify-json/lucide/icons.json'), 'utf8')
)

/** Collect literal names from templates and metadata, including alias parents. */
export function collectIcons(root: string): IconifyJSON {
  const names = new Set<string>()
  function scan(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (/\.(vue|[cm]?[jt]sx?)$/.test(entry.name)) {
        for (const match of readFileSync(file, 'utf8').matchAll(
          /lucide:([a-z0-9-]+)/g
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
    if (collection.icons[name]) icons[name] = collection.icons[name]
    else if (collection.aliases?.[name]) {
      aliases[name] = collection.aliases[name]
      include(aliases[name].parent)
    } else throw new Error(`Unknown offline icon: lucide:${name}`)
  }
  for (const name of [...names].sort()) include(name)
  return {
    prefix: collection.prefix,
    width: collection.width,
    height: collection.height,
    icons,
    aliases,
  }
}

export function offlineIcons(): Plugin {
  const id = '\0virtual:mirai-icons'
  let root: string
  let source = ''
  const generate = () => `export default ${JSON.stringify(collectIcons(root))}`
  return {
    name: 'mirai-offline-icons',
    configResolved(config) {
      root = resolve(config.root, 'src')
    },
    resolveId(name) {
      if (name === 'virtual:mirai-icons') return id
    },
    load(name) {
      if (name === id) return (source = generate())
    },
    handleHotUpdate(context) {
      if (
        !context.file
          .replaceAll('\\', '/')
          .startsWith(root.replaceAll('\\', '/') + '/')
      )
        return
      const next = generate()
      if (next === source) return
      source = next
      const module = context.server.moduleGraph.getModuleById(id)
      if (module) context.server.moduleGraph.invalidateModule(module)
      context.server.ws.send({ type: 'full-reload' })
    },
  }
}
